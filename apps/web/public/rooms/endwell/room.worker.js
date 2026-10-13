// ../../packages/flow/src/worker.ts
import { defineRoom } from "@parti/worker-sdk";

// ../../packages/flow/src/parti.ts
var PARTI_FLOW_ACTION_EVENT = "partiflow:action";
var PARTI_FLOW_REJECT_EVENT = "partiflow:reject";
var PARTI_FLOW_PAYLOAD = "__partiflow";

// ../../packages/flow/src/worker.ts
var asPlayer = (player2) => player2;
function createFlowRoom(game) {
  let sequence = 0;
  const makeAction = (type, payload2, actor, id) => {
    const seq = ++sequence;
    return { id: id ?? `${actor.id}:authority:${seq}`, type, payload: payload2, from: actor.id, seq, origin: "host", createdAt: Date.now() };
  };
  const execute = (room, action, actor, validate = true) => {
    const definition = game.actions[action.type];
    if (!definition) return false;
    if (definition.sync.mode === "localOnly") {
      room.send(actor.id, PARTI_FLOW_REJECT_EVENT, { actionId: action.id, reason: "local-only" });
      return false;
    }
    const context = makeContext(room, actor);
    let payload2 = action.payload;
    if (validate && definition.validate) {
      const result = definition.validate(context, payload2);
      if (!result.ok) {
        room.send(actor.id, PARTI_FLOW_REJECT_EVENT, { actionId: action.id, reason: result.reason });
        return false;
      }
      payload2 = result.payload;
    }
    const authoritative = { ...action, payload: payload2, origin: "host", createdAt: room.now() };
    if (definition.sync.mode !== "optimisticBroadcast") definition.reduce(context, payload2, authoritative);
    room.broadcast(PARTI_FLOW_ACTION_EVENT, { action: authoritative });
    return true;
  };
  const makeContext = (room, actor) => ({
    state: room.state,
    role: "authority",
    actor,
    players: room.players.map(asPlayer),
    host: asPlayer(room.host),
    now: room.now,
    random: room.random,
    timers: { dispatch(name, delay, type, payload2, actorId) {
      room.setTimer(name, delay, () => {
        const timerActor = room.players.find((p) => p.id === actorId) ?? room.host;
        execute(room, makeAction(type, payload2 ?? null, asPlayer(timerActor)), asPlayer(timerActor), false);
      });
    }, clear: room.clearTimer },
    emit() {
    },
    dispatch(type, payload2, actorId) {
      const nestedActor = room.players.find((p) => p.id === actorId) ?? room.host;
      execute(room, makeAction(type, payload2 ?? null, asPlayer(nestedActor)), asPlayer(nestedActor), false);
    },
    kick: room.kick
  });
  const startSystems = (room) => {
    for (const [index, system] of (game.systems ?? []).entries()) {
      if (system.runOn === "client") continue;
      const interval = system.intervalMs ?? 50, name = `partiflow:system:${index}`;
      const tick = () => {
        system.update(makeContext(room, asPlayer(room.host)), interval / 1e3);
        room.setTimer(name, interval, tick);
      };
      room.setTimer(name, interval, tick);
    }
  };
  const actions = Object.fromEntries(Object.keys(game.actions).map((type) => [type, (room, event) => {
    const wire = event.payload;
    const incoming = wire?.[PARTI_FLOW_PAYLOAD];
    const actor = asPlayer(event.player);
    execute(room, incoming ? { ...incoming, from: actor.id } : makeAction(type, event.payload, actor, event.actionId), actor);
  }]));
  actions["partiflow:state"] = (room, event) => {
    const patch = event.payload;
    if (!patch || typeof patch.path !== "string") return;
    const path = patch.path.split(".");
    const rule = Object.entries(game.state ?? {}).find(([pattern]) => {
      const expected = pattern.split(".");
      return expected.length === path.length && expected.every((part, index) => part === "*" || part === path[index]);
    });
    if (!rule || rule[1].write !== "owner") {
      room.send(event.player.id, PARTI_FLOW_REJECT_EVENT, { reason: "state-not-writable", path: patch.path });
      return;
    }
    const wildcard = rule[0].split(".").indexOf("*");
    if (wildcard < 0 || path[wildcard] !== event.player.id) {
      room.send(event.player.id, PARTI_FLOW_REJECT_EVENT, { reason: "not-state-owner", path: patch.path });
      return;
    }
    let target = room.state;
    for (const key of path.slice(0, -1)) target = target?.[key];
    if (target && path.length) target[path.at(-1)] = patch.value;
  };
  return defineRoom({
    meta: game.meta,
    initialState: game.initialState,
    onCreate(room) {
      game.lifecycle?.create?.(makeContext(room, asPlayer(room.host)));
      startSystems(room);
    },
    onRestore(room) {
      game.lifecycle?.restore?.(makeContext(room, asPlayer(room.host)));
      startSystems(room);
    },
    onJoin(room, player2) {
      game.lifecycle?.join?.(makeContext(room, asPlayer(player2)), asPlayer(player2));
    },
    onReconnect(room, player2) {
      game.lifecycle?.reconnect?.(makeContext(room, asPlayer(player2)), asPlayer(player2));
    },
    onLeave(room, player2) {
      game.lifecycle?.leave?.(makeContext(room, asPlayer(player2)), asPlayer(player2));
    },
    onReady(room, player2) {
      game.lifecycle?.ready?.(makeContext(room, asPlayer(player2)), asPlayer(player2));
    },
    actions
  });
}

// ../../packages/flow/src/types.ts
var accept = (payload2) => ({ ok: true, payload: payload2 });
var reject = (reason) => ({ ok: false, reason });
function defineGame(definition) {
  return definition;
}

// src/content/spells.ts
var ELEMENTS = ["rock", "fire", "ice", "life", "lightning", "water", "shield"];
var attachedTargeting = { canHitSelf: false, canHitAllies: false, canHitEnemies: true, canHitNeutral: true };
var projectileTargeting = { canHitSelf: false, canHitAllies: true, canHitEnemies: true, canHitNeutral: true };
var hostileAreaTargeting = { canHitSelf: true, canHitAllies: true, canHitEnemies: true, canHitNeutral: true };
var hostileFieldTargeting = hostileAreaTargeting;
var detachedTargeting = hostileAreaTargeting;
var allTargeting = { canHitSelf: true, canHitAllies: true, canHitEnemies: true, canHitNeutral: true };
var healingTargeting = { canHitSelf: false, canHitAllies: true, canHitEnemies: false, canHitNeutral: false, beneficial: true };
var fieldHealingTargeting = { ...healingTargeting, canHitSelf: true };
var attachedBlocking = { blockBySelf: false, blockByAllies: false, blockByEnemies: true, blockByNeutral: true, blockByWalls: false, blockBySummons: true };
var beamBlocking = { ...attachedBlocking, blockByWalls: true };
var detachedBlocking = { blockBySelf: false, blockByAllies: true, blockByEnemies: true, blockByNeutral: true, blockByWalls: true, blockBySummons: true };
var selfTargeting = { canHitSelf: true, canHitAllies: false, canHitEnemies: false, canHitNeutral: false, beneficial: true };
var noBlocking = { blockBySelf: false, blockByAllies: false, blockByEnemies: false, blockByNeutral: false, blockByWalls: false, blockBySummons: false };
var names = { rock: "\u5CA9", fire: "\u706B", ice: "\u51B0", life: "\u751F\u547D", lightning: "\u96F7", water: "\u6C34", shield: "\u76FE" };
function elementVector(elements) {
  const vector = Object.fromEntries(ELEMENTS.map((element) => [element, 0]));
  for (const element of elements) vector[element] += 1;
  return vector;
}
function offensive(elements) {
  return elements.filter((element) => element !== "life" && element !== "shield");
}
function hitPayload(elements, allowHeal = true) {
  const vector = elementVector(elements), attack = offensive(elements), damage = {}, statusBuildup = {}, effects = [];
  if (!attack.length && vector.life && allowHeal) return { heal: 12 * vector.life };
  if (vector.fire) {
    damage.fire = 8 * vector.fire;
    statusBuildup.burning = 30 * vector.fire;
  }
  if (vector.water) {
    damage.water = 5 * vector.water;
    statusBuildup.wet = 38 * vector.water;
    effects.push({ type: "knockback", force: 120 + vector.water * 35 });
  }
  if (vector.lightning) {
    damage.lightning = 7 * vector.lightning;
    statusBuildup.shocked = 28 * vector.lightning;
    effects.push({ type: "interrupt", power: 18 + vector.lightning * 8 });
  }
  if (vector.ice) {
    damage.ice = 6 * vector.ice;
    statusBuildup.chilled = 45 * vector.ice;
  }
  if (vector.rock) {
    damage.rock = 10 * vector.rock;
    damage.physical = 3 * vector.rock;
    effects.push({ type: "knockback", force: 180 + vector.rock * 55 });
  }
  return { damage, statusBuildup, effects };
}
function base(elements, delivery, values) {
  const count = elements.length;
  return { id: `${delivery}:${elements.join("-")}`, name: `${elements.map((element) => names[element]).join("\xB7")}${{ spray: "\u55B7\u5C04", beam: "\u5C04\u7EBF", projectile: "\u5F39", summon: "\u53EC\u5524", area: "\u9668\u77F3", environment: "\u964D\u96E8", shield: "\u62A4\u76FE", instant: "\u79D8\u672F" }[delivery]}`, elements: [...elements], elementVector: elementVector(elements), delivery, payload: hitPayload(elements), chantMs: 160 + Math.max(0, count - 1) * 120, recoveryMs: 240 + count * 45, detached: false, channelled: false, lifetimeMs: 4e3, range: 240, radius: 42, targeting: attachedTargeting, blocking: attachedBlocking, tags: ["spell", ...new Set(elements)], visualKey: `${delivery}.${elements.join("-")}`, ...values };
}
function payload(values) {
  return values;
}
var largeImpactTags = (elements) => ["spell", "large-impact", ...new Set(elements)];
function instantSpec(elements, id, name, instant, values = {}) {
  return base(elements, "instant", { id, name, instant, payload: {}, detached: true, channelled: false, targeting: selfTargeting, blocking: noBlocking, range: 0, radius: instant.radius ?? 0, lifetimeMs: 0, chantMs: 420, recoveryMs: 300, visualKey: `instant.${id}`, ...values });
}
function specialShieldSpec(elements, id, name, shield, ward) {
  return base(elements, "shield", { id, name, payload: {}, shield, targeting: selfTargeting, blocking: noBlocking, range: 0, radius: 30, lifetimeMs: 9e3, chantMs: 300, recoveryMs: 360, tags: ["spell", "shield", ...ward ? [ward] : [], ...new Set(elements)], visualKey: `shield.${id}` });
}
function fieldSpec(elements, id, name, archetype, values) {
  return base(elements, "summon", { id, name, detached: true, lifetimeMs: 6e3, range: 460, radius: 120, summon: { archetype, positionMode: "targetPoint" }, targeting: hostileFieldTargeting, blocking: detachedBlocking, chantMs: 520, recoveryMs: 450, visualKey: `summon.${archetype}`, ...values });
}
function spraySpec(elements) {
  return base(elements, "spray", { channelled: true, lifetimeMs: 5e3, range: 230 + elements.length * 15, radius: 54, coneAngle: Math.PI / 3, targeting: attachedTargeting, blocking: attachedBlocking });
}
function beamSpec(elements) {
  const healing = offensive(elements).length === 0, beamPayload = hitPayload(elements, true);
  if (elements.includes("water")) beamPayload.effects = [...(beamPayload.effects ?? []).filter((effect) => effect.type !== "knockback"), { type: "knockback", force: 80 }];
  return base(elements, "beam", { payload: beamPayload, channelled: true, lifetimeMs: 5e3, range: 820, radius: 14, beam: { width: 14, tickInterval: 140, mode: "normal", maxBounces: 0, turnSpeed: Math.PI * 1.5 }, targeting: healing ? healingTargeting : attachedTargeting, blocking: beamBlocking, chantMs: 260 + elements.length * 120 });
}
function selfHealSpec(elements) {
  return instantSpec(elements, "self-heal", "\u751F\u547D\u6CBB\u6108", { kind: "selfHeal", amount: 20 }, { range: 0, radius: 0, targeting: healingTargeting, chantMs: 180, recoveryMs: 260 });
}
function projectileSpec(elements) {
  return base(elements, "projectile", { detached: true, lifetimeMs: 2400, speed: 460, range: 920, radius: 16 + elements.length * 2, targeting: projectileTargeting, blocking: detachedBlocking, chantMs: 320 + elements.length * 110 });
}
function summonArchetype(elements) {
  const shaped = elements.slice(0, -1).filter((element) => element !== "rock" && element !== "shield").at(-1);
  if (shaped === "ice") return "ice-wall";
  if (shaped === "fire") return "fire-field";
  if (shaped === "lightning") return "lightning-field";
  if (shaped === "water") return "water-pool";
  if (shaped === "life") return "healing-field";
  return "rock-wall";
}
function summonSpec(elements) {
  const archetype = summonArchetype(elements), wall = archetype === "rock-wall" || archetype === "ice-wall", healing = archetype === "healing-field";
  return base(elements, "summon", { payload: healing ? { heal: 10 + elements.length * 4 } : hitPayload(elements.filter((element) => element !== "shield")), detached: true, lifetimeMs: wall ? 9e3 : 6500, range: 430, radius: wall ? 44 : 105, summon: { archetype, positionMode: "targetPoint" }, targeting: healing ? fieldHealingTargeting : hostileFieldTargeting, blocking: detachedBlocking, chantMs: 430 + elements.length * 120, visualKey: `summon.${archetype}` });
}
function shieldValues(elements) {
  const vector = elementVector(elements), absorbElements = { physical: 0.2 };
  for (const element of ELEMENTS) if (vector[element] && element !== "life" && element !== "shield") absorbElements[element] = 0.8;
  if (Object.keys(absorbElements).length === 1) for (const element of ["fire", "water", "ice", "lightning", "rock"]) absorbElements[element] = 0.35;
  return { amount: 55 + elements.length * 20, absorbElements };
}
function shieldSpec(elements) {
  return base(elements, "shield", { payload: {}, shield: shieldValues(elements), targeting: selfTargeting, blocking: noBlocking, range: 0, radius: 30, lifetimeMs: 1e4, chantMs: 180 + elements.length * 70 });
}
function meteorSpec(elements) {
  return base(elements, "area", { id: "meteor", name: "\u9668\u77F3", payload: hitPayload(elements), detached: true, range: 720, radius: 125, lifetimeMs: 500, area: { warningMs: 700, impactDelay: 700 }, targeting: hostileAreaTargeting, blocking: noBlocking, chantMs: 850, recoveryMs: 650, tags: largeImpactTags(elements), visualKey: "area.meteor" });
}
function rainSpec(elements) {
  return base(elements, "environment", { id: "rain", name: "\u5168\u573A\u964D\u96E8", payload: {}, detached: true, range: 0, radius: 0, lifetimeMs: 8e3, environment: { kind: "rain", duration: 8e3, tickInterval: 500 }, targeting: selfTargeting, blocking: noBlocking, chantMs: 900, recoveryMs: 700, visualKey: "environment.rain" });
}
function resurrectSpec(elements) {
  return instantSpec(elements, "resurrect", "\u590D\u6D3B\u672F", { kind: "resurrect", radius: 150, amount: 0.25 }, { range: 520, radius: 150, targeting: healingTargeting, chantMs: 650, recoveryMs: 520 });
}
function teleportSpec(elements) {
  return instantSpec(elements, "teleport", "\u77AC\u95F4\u79FB\u52A8", { kind: "teleport" }, { range: 600, chantMs: 280, recoveryMs: 220 });
}
function cleanseSpec(elements) {
  return instantSpec(elements, "cleanse", "\u6D88\u9664\u672F", { kind: "cleanse", radius: 150 }, { range: 520, radius: 150, targeting: allTargeting, chantMs: 520, recoveryMs: 380 });
}
function hasteSpec(elements) {
  return instantSpec(elements, "haste", "\u52A0\u901F", { kind: "haste", durationMs: 6e3 }, { chantMs: 360, recoveryMs: 280 });
}
function lifeSpringSpec(elements) {
  return fieldSpec(elements, "life-spring", "\u751F\u547D\u4E4B\u6CC9", "healing-field", { payload: payload({ heal: 35, statusBuildup: { wet: 100 } }), lifetimeMs: 700, radius: 130, targeting: fieldHealingTargeting, blocking: noBlocking, chantMs: 420, recoveryMs: 360 });
}
function chainHealSpec(elements) {
  return fieldSpec(elements, "chain-heal", "\u8FDE\u9501\u6CBB\u7597", "healing-field", { payload: payload({ heal: 32 }), lifetimeMs: 700, radius: 165, targeting: fieldHealingTargeting, blocking: noBlocking, chantMs: 520, recoveryMs: 420 });
}
function rockShieldSpec(elements) {
  return specialShieldSpec(elements, "rock-shield", "\u5CA9\u77F3\u62A4\u76FE", { amount: 95, absorbElements: { physical: 0.75, rock: 0.8, fire: 0.25, ice: 0.25, lightning: 0.25, water: 0.25 } });
}
function fireShieldSpec(elements) {
  return specialShieldSpec(elements, "fire-shield", "\u706B\u7130\u62A4\u76FE", { amount: 75, absorbElements: { physical: 0.25, fire: 0.9, ice: 0.35 } }, "fireWard");
}
function frostShieldSpec(elements) {
  return specialShieldSpec(elements, "frost-shield", "\u5BD2\u51B0\u62A4\u76FE", { amount: 75, absorbElements: { physical: 0.25, ice: 0.9, fire: 0.2 } }, "frostWard");
}
function groundingShieldSpec(elements) {
  return specialShieldSpec(elements, "grounding-shield", "\u63A5\u5730\u62A4\u76FE", { amount: 75, absorbElements: { physical: 0.25, lightning: 0.9, water: 0.35 } }, "grounded");
}
function waterShieldSpec(elements) {
  return specialShieldSpec(elements, "water-shield", "\u6D41\u6C34\u62A4\u76FE", { amount: 75, absorbElements: { physical: 0.25, water: 0.9, fire: 0.35 } }, "waterWard");
}
function lifeFlameSpec(elements) {
  return base(elements, "beam", { id: "life-flame", name: "\u751F\u547D\u70C8\u7130", payload: payload({ damage: { fire: 9 }, statusBuildup: { burning: 45 } }), channelled: true, lifetimeMs: 5e3, range: 820, radius: 14, beam: { width: 14, tickInterval: 140, mode: "normal" }, targeting: attachedTargeting, blocking: beamBlocking, chantMs: 420, recoveryMs: 360, visualKey: "beam.life-flame" });
}
function frostStreamSpec(elements) {
  return base(elements, "beam", { id: "frost-stream", name: "\u51BB\u7ED3\u6C34\u6D41", payload: payload({ damage: { ice: 7, water: 2 }, statusBuildup: { wet: 45, chilled: 45 }, effects: [{ type: "knockback", force: 70 }] }), channelled: true, lifetimeMs: 5e3, range: 760, radius: 16, beam: { width: 16, tickInterval: 140, mode: "normal" }, targeting: attachedTargeting, blocking: beamBlocking, chantMs: 420, recoveryMs: 360, visualKey: "beam.frost-stream" });
}
function lavaBoltSpec(elements) {
  return base(elements, "projectile", { id: "lava-bolt", name: "\u7194\u5CA9\u5F39", payload: payload({ damage: { rock: 34, fire: 26 }, statusBuildup: { burning: 70 }, effects: [{ type: "knockback", force: 190 }] }), detached: true, lifetimeMs: 2400, speed: 430, range: 860, radius: 20, targeting: projectileTargeting, blocking: detachedBlocking, chantMs: 430, recoveryMs: 380, visualKey: "projectile.lava-bolt" });
}
function shatterIceBoltSpec(elements) {
  return base(elements, "projectile", { id: "shatter-ice-bolt", name: "\u788E\u51B0\u5CA9\u5F39", payload: payload({ damage: { rock: 40, ice: 18 }, statusBuildup: { chilled: 70 }, effects: [{ type: "knockback", force: 240 }] }), detached: true, lifetimeMs: 2400, speed: 480, range: 900, radius: 18, targeting: projectileTargeting, blocking: detachedBlocking, chantMs: 430, recoveryMs: 380, visualKey: "projectile.shatter-ice-bolt" });
}
function conductiveWaterSpec(elements) {
  return base(elements, "area", { id: "conductive-water-chain", name: "\u5BFC\u7535\u6C34\u94FE", payload: payload({ damage: { lightning: 42, water: 4 }, statusBuildup: { wet: 100, shocked: 85 }, effects: [{ type: "interrupt", power: 45 }] }), detached: true, range: 620, radius: 130, lifetimeMs: 350, area: { warningMs: 0, impactDelay: 0 }, targeting: detachedTargeting, blocking: noBlocking, chantMs: 500, recoveryMs: 430, visualKey: "area.conductive-water-chain" });
}
function flameJetSpec(elements) {
  return base(elements, "spray", { id: "flame-jet", name: "\u70C8\u7130\u55B7\u5C04", payload: payload({ damage: { fire: 40 }, statusBuildup: { burning: 90 } }), channelled: true, lifetimeMs: 4200, range: 280, radius: 64, coneAngle: Math.PI * 70 / 180, targeting: attachedTargeting, blocking: attachedBlocking, chantMs: 320, recoveryMs: 320, visualKey: "spray.flame-jet" });
}
function iceLanceSpec(elements) {
  return base(elements, "projectile", { id: "ice-lance", name: "\u5BD2\u51B0\u957F\u77DB", payload: payload({ damage: { ice: 52 }, statusBuildup: { chilled: 90 } }), detached: true, lifetimeMs: 2600, speed: 620, range: 1050, radius: 12, targeting: projectileTargeting, blocking: detachedBlocking, chantMs: 520, recoveryMs: 460, tags: ["spell", "ice", "rock", "pierce"], visualKey: "projectile.ice-lance" });
}
function tidalImpactSpec(elements) {
  return fieldSpec(elements, "tidal-impact", "\u6F6E\u6C50\u51B2\u51FB", "water-pool", { payload: payload({ damage: { water: 30 }, statusBuildup: { wet: 100 }, effects: [{ type: "knockback", force: 280 }] }), lifetimeMs: 4200, radius: 135, targeting: allTargeting, blocking: noBlocking, chantMs: 500, recoveryMs: 420 });
}
function lightningStrikeSpec(elements) {
  return fieldSpec(elements, "lightning-strike", "\u96F7\u51FB\u672F", "lightning-storm", { payload: payload({ damage: { lightning: 24 }, statusBuildup: { shocked: 60 }, effects: [{ type: "interrupt", power: 35 }] }), lifetimeMs: 3e3, radius: 145, targeting: detachedTargeting, blocking: noBlocking, chantMs: 760, recoveryMs: 520, tags: largeImpactTags(elements) });
}
function blizzardSpec(elements) {
  return base(elements, "environment", { id: "blizzard", name: "\u66B4\u98CE\u96EA", payload: {}, detached: true, range: 0, radius: 0, lifetimeMs: 1e4, environment: { kind: "blizzard", duration: 1e4, tickInterval: 500 }, targeting: selfTargeting, blocking: noBlocking, chantMs: 900, recoveryMs: 700, visualKey: "environment.blizzard" });
}
function steamCloudSpec(elements) {
  return fieldSpec(elements, "steam-cloud", "\u84B8\u6C7D\u4E91", "steam-cloud", { payload: payload({ damage: { fire: 18, water: 3 }, statusBuildup: { wet: 25 } }), lifetimeMs: 5500, radius: 125, targeting: detachedTargeting, blocking: noBlocking, chantMs: 420, recoveryMs: 360 });
}
function magickaIceWallSpec(elements) {
  return fieldSpec(elements, "magicka-ice-wall", "\u51B0\u5899", "ice-wall", { payload: payload({ damage: { ice: 3 }, statusBuildup: { chilled: 55 } }), lifetimeMs: 6500, radius: 110, targeting: detachedTargeting, blocking: detachedBlocking, chantMs: 620, recoveryMs: 520 });
}
function thunderstormSpec(elements) {
  return fieldSpec(elements, "thunderstorm", "\u96F7\u66B4\u9886\u57DF", "lightning-field", { payload: payload({ damage: { lightning: 12 }, statusBuildup: { shocked: 42 }, effects: [{ type: "interrupt", power: 24 }] }), lifetimeMs: 6e3, radius: 155, targeting: detachedTargeting, blocking: noBlocking, chantMs: 700, recoveryMs: 520 });
}
function gravityWellSpec(elements) {
  return fieldSpec(elements, "gravity-well", "\u91CD\u529B\u4E95", "gravity-well", { payload: payload({ damage: { rock: 35 }, effects: [{ type: "knockback", force: -120 }] }), lifetimeMs: 4200, radius: 170, targeting: detachedTargeting, blocking: noBlocking, chantMs: 720, recoveryMs: 560, tags: largeImpactTags(elements) });
}
function fireRingSpec(elements) {
  return fieldSpec(elements, "fire-ring", "\u706B\u7130\u73AF", "fire-ring", { payload: payload({ damage: { fire: 8 }, statusBuildup: { burning: 40 } }), lifetimeMs: 5e3, range: 0, radius: 135, summon: { archetype: "fire-ring", positionMode: "self" }, targeting: detachedTargeting, blocking: noBlocking, chantMs: 450, recoveryMs: 360 });
}
function lifeBarrierSpec(elements) {
  return fieldSpec(elements, "life-barrier", "\u751F\u547D\u5C4F\u969C", "life-barrier", { payload: payload({ heal: 6 }), lifetimeMs: 6500, radius: 145, targeting: fieldHealingTargeting, blocking: noBlocking, chantMs: 650, recoveryMs: 500 });
}
function supernovaSpec(elements) {
  return instantSpec(elements, "supernova", "\u8D85\u65B0\u661F\u7206\u53D1", { kind: "supernova", amount: 0.5 }, { chantMs: 650, recoveryMs: 700, targeting: allTargeting, tags: largeImpactTags(elements), visualKey: "scroll.supernova" });
}
function equilibriumSpec(elements) {
  return instantSpec(elements, "equilibrium", "\u5747\u8861\u672F", { kind: "equilibrium", amount: 0.5 }, { chantMs: 650, recoveryMs: 650, targeting: allTargeting, visualKey: "scroll.equilibrium" });
}
function annihilationSpec(elements) {
  return instantSpec(elements, "annihilation", "\u6E6E\u706D\u672F", { kind: "annihilation", radius: 120, amount: 0.99 }, { range: 620, radius: 120, chantMs: 650, recoveryMs: 760, targeting: detachedTargeting, visualKey: "scroll.annihilation" });
}
function blackHoleSpec(elements) {
  return fieldSpec(elements, "black-hole", "\u9ED1\u6D1E", "black-hole", { payload: payload({ damage: { pure: 8 }, effects: [{ type: "knockback", force: -160 }] }), lifetimeMs: 8e3, tickMs: 500, range: 680, radius: 340, targeting: allTargeting, blocking: noBlocking, chantMs: 650, recoveryMs: 760, tags: largeImpactTags(elements), visualKey: "scroll.black-hole" });
}

// src/game/rules/scrolls.ts
var SCROLL_COOLDOWN_MS = 2e4;
var SCROLLS = [
  { id: "supernova", name: "\u8D85\u65B0\u661F\u7206\u53D1\u5377\u8F74", elements: ["lightning", "life", "shield", "fire"], description: "\u89E3\u9501\u8D85\u65B0\u661F\u7206\u53D1\uFF1A\u5168\u573A\u5B58\u6D3B\u5B9E\u4F53\u635F\u5931 50% \u5F53\u524D\u751F\u547D\u3002", value: 180, cooldownMs: SCROLL_COOLDOWN_MS, spec: supernovaSpec },
  { id: "equilibrium", name: "\u5747\u8861\u672F\u5377\u8F74", elements: ["rock", "shield", "ice", "life"], description: "\u89E3\u9501\u5747\u8861\u672F\uFF1A\u5168\u573A\u5B58\u6D3B\u5B9E\u4F53\u751F\u547D\u8C03\u6574\u4E3A 50% \u6700\u5927\u751F\u547D\u3002", value: 160, cooldownMs: SCROLL_COOLDOWN_MS, spec: equilibriumSpec },
  { id: "annihilation", name: "\u6E6E\u706D\u672F\u5377\u8F74", elements: ["rock", "ice", "life"], description: "\u89E3\u9501\u6E6E\u706D\u672F\uFF1A\u5B9A\u70B9\u8303\u56F4\u5185\u6070\u597D\u4E00\u4E2A\u76EE\u6807\u65F6\u635F\u5931 99% \u5F53\u524D\u751F\u547D\u3002", value: 220, cooldownMs: SCROLL_COOLDOWN_MS, spec: annihilationSpec },
  { id: "black-hole", name: "\u9ED1\u6D1E\u5377\u8F74", elements: ["shield", "rock", "rock", "shield"], description: "\u89E3\u9501\u9ED1\u6D1E\uFF1A\u843D\u70B9\u751F\u6210\u957F\u65F6\u95F4\u65E0\u5DEE\u522B\u4F24\u5BB3\u573A\u3002", value: 200, cooldownMs: SCROLL_COOLDOWN_MS, spec: blackHoleSpec }
];
var sameElements = (left, right) => left.length === right.length && right.every((element, index) => left[index] === element);
function isScroll(item) {
  return Boolean(item && typeof item === "object" && item.kind === "scroll");
}
function scrollForElements(elements) {
  return SCROLLS.find((scroll) => sameElements(elements, scroll.elements));
}
function ownedReadyScrollFor(elements, player2, now) {
  const definition = scrollForElements(elements);
  if (!definition) return null;
  const item = player2.inventory.find((entry) => isScroll(entry) && entry.scrollId === definition.id);
  if (!item || (player2.scrollCooldowns[definition.id] ?? 0) > now) return null;
  return { definition, item };
}
function resolveScrollSpell(elements, player2, now) {
  const owned = ownedReadyScrollFor(elements, player2, now);
  return owned ? owned.definition.spec(elements) : null;
}

// src/game/rules/equipment.ts
var NON_SHIELD_ELEMENTS = ["rock", "fire", "ice", "life", "lightning", "water"];
var DAMAGE_ELEMENTS = ["physical", "rock", "fire", "ice", "life", "lightning", "water", "shield", "pure"];
var PROTOTYPES = [
  { slot: "staff", name: "\u7126\u9ED1\u6A61\u6728\u6CD5\u6756", visualKey: "staff.charred_oak", tags: ["staff", "fire", "ruins"], description: "\u4ECE\u9057\u8FF9\u4F59\u70EC\u4E2D\u5BFB\u56DE\u7684\u706B\u5143\u7D20\u6CD5\u6756\u3002" },
  { slot: "staff", name: "\u96F7\u7EB9\u767D\u8721\u6CD5\u6756", visualKey: "staff.storm_ash", tags: ["staff", "lightning", "ruins"], description: "\u53E4\u8001\u96F7\u7EB9\u4ECD\u5728\u6756\u8EAB\u4E2D\u4F4E\u9E23\u3002" },
  { slot: "staff", name: "\u6D3B\u6839\u6CD5\u6756", visualKey: "staff.living_root", tags: ["staff", "life"], description: "\u5F3A\u5316\u751F\u547D\u5143\u7D20\u6CBB\u7597\uFF0C\u9002\u5408\u591A\u4EBA\u914D\u5408\u3002" },
  { slot: "robe", name: "\u8E0F\u971C\u6CD5\u888D", visualKey: "robe.frostwalker", tags: ["robe", "ice"], description: "\u8F7B\u4FBF\u7684\u9632\u62A4\u6CD5\u888D\uFF0C\u517C\u987E\u51CF\u4F24\u548C\u79FB\u52A8\u3002" },
  { slot: "robe", name: "\u5B88\u8A93\u6CD5\u888D", visualKey: "robe.oathguard", tags: ["robe", "defense", "ruins"], description: "\u9057\u8FF9\u5B88\u536B\u7559\u4E0B\u7684\u539A\u91CD\u6CD5\u888D\u3002" },
  { slot: "ring", name: "\u6269\u57DF\u6CD5\u6212", visualKey: "ring.widecast", tags: ["ring", "range"], description: "\u8BA9\u6CD5\u672F\u5F71\u54CD\u8303\u56F4\u66F4\u5BB9\u6613\u88AB\u770B\u89C1\u3002" },
  { slot: "ring", name: "\u75BE\u548F\u6CD5\u6212", visualKey: "ring.quickchant", tags: ["ring", "cast"], description: "\u7F29\u77ED\u65BD\u6CD5\u8282\u594F\uFF0C\u65B9\u4FBF\u8FDE\u7EED\u6D4B\u8BD5\u6280\u80FD\u3002" }
];
function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ value >>> 15, 2246822507);
    value = Math.imul(value ^ value >>> 13, 3266489909);
    value ^= value >>> 16;
    return (value >>> 0) / 4294967295;
  };
}
function hashText(value) {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}
function randomAffix(slot, random) {
  const value = 0.08 + Math.round(random() * 10) / 100;
  if (slot === "staff") {
    const element = NON_SHIELD_ELEMENTS[Math.floor(random() * NON_SHIELD_ELEMENTS.length)];
    return element === "life" ? { type: "lifeHealBonus", value } : { type: "elementDamageBonus", element, value };
  }
  if (slot === "robe") {
    const roll2 = random();
    if (roll2 < 0.35) return { type: "moveSpeedBonus", value: value * 0.75 };
    if (roll2 < 0.7) return { type: "globalDamageReduction", value: value * 0.7 };
    return { type: "elementDamageReduction", element: DAMAGE_ELEMENTS[Math.floor(random() * DAMAGE_ELEMENTS.length)], value };
  }
  const roll = random();
  if (roll < 0.2) return { type: "chantTimeReduction", value: value * 0.75 };
  if (roll < 0.4) return { type: "recoveryTimeReduction", value: value * 0.75 };
  if (roll < 0.55) return { type: "sprayRangeBonus", value };
  if (roll < 0.7) return { type: "sprayAngleBonus", value };
  if (roll < 0.78) return { type: "beamReflect", value: 1 };
  const deliveries = ["spray", "beam", "projectile", "area", "summon"];
  return { type: "rangeBonus", delivery: deliveries[Math.floor(random() * deliveries.length)], value };
}
function isCatalyst(item) {
  return Boolean(item && "kind" in item && item.kind === "catalyst");
}
function isEquipment(item) {
  return Boolean(item && !("kind" in item));
}
function createCatalyst(seed, source) {
  return { id: `orb:${seed.toString(36)}:${source}`, kind: "catalyst", name: "\u5408\u6210\u5B9D\u73E0", description: "\u53EF\u66FF\u4EE3\u7B2C\u4E09\u4EF6\u540C\u7C7B\u88C5\u5907\uFF0C\u4F7F\u5408\u6210\u4FDD\u7559\u66F4\u591A\u8BCD\u7F00\u3002", value: 80 };
}
function generateEquipment(seed, index) {
  const random = rng((seed ^ Math.imul(index + 1, 2654435761)) >>> 0), prototype = PROTOTYPES[Math.floor(random() * PROTOTYPES.length)], rarityRoll = random();
  const rarity = rarityRoll > 0.82 ? "rare" : rarityRoll > 0.45 ? "excellent" : "normal", affixCount = rarity === "rare" ? 2 : rarity === "excellent" ? 1 : 0;
  const affixes = [];
  for (let i = 0; i < affixCount; i++) {
    const affix = randomAffix(prototype.slot, random);
    if (!affixes.some((existing) => affixKey(existing) === affixKey(affix))) affixes.push(affix);
  }
  const value = rarity === "rare" ? 110 : rarity === "excellent" ? 70 : 40;
  return { id: `item:${seed.toString(36)}:${index}`, slot: prototype.slot, rarity, name: prototype.name, visualKey: prototype.visualKey, affixes, tags: [...prototype.tags, rarity], description: prototype.description, value, fusionGeneration: 0, sourceItemValues: [value] };
}
function sellPrice(item) {
  return isEquipment(item) || isScroll(item) ? Math.floor(item.value * 0.5) : 0;
}
function fusionPrice(uses) {
  return (uses + 1) * 50;
}
function canFuse(items) {
  const equipment = items.filter(isEquipment), catalysts = items.filter(isCatalyst);
  return items.length === 3 && (equipment.length === 3 && catalysts.length === 0 || equipment.length === 2 && catalysts.length === 1) && new Set(equipment.map((item) => item.slot)).size === 1;
}
function fuseEquipment(items, seed) {
  if (!canFuse(items)) return null;
  const equipment = items.filter(isEquipment), stabilized = items.some(isCatalyst), first = equipment[0], sourceAffixes = equipment.flatMap((item) => item.affixes), legal = [];
  for (const affix of sourceAffixes) {
    const existing = legal.find((value2) => affixKey(value2) === affixKey(affix));
    if (!existing) legal.push({ ...affix });
    else if ("value" in existing) existing.value = Math.max(existing.value, affix.value);
  }
  const random = rng(seed), kept = legal.filter(() => stabilized || random() < 0.7).slice(0, 3);
  if (!kept.length && legal.length) kept.push(legal[Math.floor(random() * legal.length)]);
  const value = equipment.reduce((sum, item) => sum + item.value, 0), generation = Math.max(...equipment.map((item) => item.fusionGeneration)) + 1;
  return { id: `fusion:${(seed >>> 0).toString(36)}:${generation}`, slot: first.slot, rarity: equipment.some((item) => item.rarity === "rare") ? "rare" : "excellent", name: `\u7194\u94F8${first.name}`, visualKey: first.visualKey, affixes: kept, tags: [first.slot, "fusion"], description: stabilized ? "\u7531\u4E24\u4EF6\u88C5\u5907\u4E0E\u5408\u6210\u5B9D\u73E0\u7A33\u5B9A\u5408\u6210\u3002" : "\u7531\u4E09\u4EF6\u540C\u7C7B\u578B\u88C5\u5907\u5408\u6210\u3002", value, fusionGeneration: generation, sourceItemValues: equipment.flatMap((item) => item.sourceItemValues) };
}
function applyEquipmentToSpell(spell, equipment) {
  const result = structuredClone(spell);
  for (const item of Object.values(equipment)) {
    if (!item) continue;
    for (const affix of item.affixes) {
      if (item.slot === "staff" && affix.type === "elementDamageBonus" && result.payload.damage?.[affix.element]) result.payload.damage[affix.element] *= 1 + affix.value;
      else if (item.slot === "staff" && affix.type === "lifeHealBonus" && result.payload.heal && result.elements.includes("life")) result.payload.heal *= 1 + affix.value;
      else if (item.slot === "ring" && affix.type === "chantTimeReduction") result.chantMs = Math.max(60, Math.round(result.chantMs * (1 - affix.value)));
      else if (item.slot === "ring" && affix.type === "recoveryTimeReduction") result.recoveryMs = Math.max(80, Math.round(result.recoveryMs * (1 - affix.value)));
      else if (item.slot === "ring" && affix.type === "sprayRangeBonus" && result.delivery === "spray") result.range = Math.round(result.range * (1 + affix.value));
      else if (item.slot === "ring" && affix.type === "sprayAngleBonus" && result.delivery === "spray") result.coneAngle = Math.min(Math.PI * 100 / 180, (result.coneAngle ?? Math.PI / 3) * (1 + affix.value));
      else if (item.slot === "ring" && affix.type === "beamReflect" && result.delivery === "beam" && result.beam?.mode !== "pierce") {
        result.beam.mode = "reflect";
        result.beam.maxBounces = (result.beam.maxBounces ?? 0) + affix.value;
      } else if (item.slot === "ring" && affix.type === "rangeBonus" && result.delivery === affix.delivery) {
        result.range = Math.round(result.range * (1 + affix.value));
        result.radius = Math.round(result.radius * (1 + affix.value));
      }
    }
  }
  return result;
}
function damageMultiplier(equipment, element) {
  let result = 1;
  for (const item of Object.values(equipment)) if (item?.slot === "robe") for (const affix of item.affixes) {
    if (affix.type === "globalDamageReduction") result *= 1 - affix.value;
    else if (affix.type === "elementDamageReduction" && affix.element === element) result *= 1 - affix.value;
  }
  return Math.max(0.35, result);
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function fusionSeed(seed, playerId, ids, uses) {
  return (seed ^ hashText(`${playerId}:${ids.join(":")}:${uses}`)) >>> 0;
}
function affixKey(affix) {
  return `${affix.type}:${"element" in affix ? affix.element : ""}:${"delivery" in affix ? affix.delivery : ""}`;
}

// src/game/rules/combat.ts
var STATUS_THRESHOLD = 100;
var MAX_FORCE_SPEED = 180;
var positionAt = (entity, now) => entity.velocity ? { x: entity.position.x + entity.velocity.x * Math.max(0, now - entity.createdAt) / 1e3, y: entity.position.y + entity.velocity.y * Math.max(0, now - entity.createdAt) / 1e3 } : entity.position;
var clamp01 = (value) => Math.max(0, Math.min(1, value));
function clampLength(value, max) {
  const length = Math.hypot(value.x, value.y);
  return length > max ? { x: value.x / length * max, y: value.y / length * max } : value;
}
function relation(source, target) {
  return source.faction.id === target.faction.id || source.faction.team === target.faction.team ? "ally" : "enemy";
}
function canTarget(sourceId, targetId, source, target, spec) {
  if (sourceId === targetId) return spec.canHitSelf;
  if (target.faction.team === "neutral" || target.faction.team === "environment") return spec.canHitNeutral;
  return relation(source, target) === "ally" ? spec.canHitAllies : spec.canHitEnemies;
}
function consume(target, status3) {
  delete target.statuses[status3];
  target.buildup[status3] = 0;
}
function status(target, type, now, sourceId, duration = 3e3) {
  target.statuses[type] = { type, endsAt: now + duration, potency: 1, stacks: 1, sourceId, tags: [] };
}
function immune(target, type) {
  return type === "burning" && target.statuses.fireWard || (type === "chilled" || type === "frozen") && target.statuses.frostWard || type === "wet" && target.statuses.waterWard || type === "shocked" && target.statuses.grounded;
}
function movableTarget(state, id) {
  const player2 = state.players[id];
  if (player2) return player2;
  const entity = state.entities[id];
  return entity?.kind === "monster" ? entity : null;
}
function hasPosition(value) {
  return Boolean(value && typeof value.position?.x === "number" && typeof value.position?.y === "number");
}
function fallbackDirection(source, owner, target) {
  if (source.direction) return source.direction;
  if (hasPosition(owner)) {
    const dx = target.position.x - owner.position.x, dy = target.position.y - owner.position.y, length = Math.hypot(dx, dy);
    if (length > 1e-3) return { x: dx / length, y: dy / length };
  }
  return { x: 1, y: 0 };
}
function applyForce(state, source, owner, targetId, force, now) {
  const target = movableTarget(state, targetId);
  if (!target || !Number.isFinite(force) || force === 0) return;
  const sourcePosition = positionAt(source, now), dx = target.position.x - sourcePosition.x, dy = target.position.y - sourcePosition.y, length = Math.hypot(dx, dy);
  const direction = length > 1e-3 ? { x: dx / length, y: dy / length } : fallbackDirection(source, owner, target);
  const radius = Math.max(1, source.radius), falloff = source.kind === "field" ? clamp01(1 - length / radius) : 1;
  if (falloff <= 0) return;
  const dt = source.source?.tickMs ? source.source.tickMs / 1e3 : 0.12, impulse = force * dt * falloff, current = target.forceVelocity ?? { x: 0, y: 0 };
  target.forceVelocity = clampLength({ x: current.x + direction.x * impulse, y: current.y + direction.y * impulse }, MAX_FORCE_SPEED);
}
function applyHit(state, hit, now) {
  if (state.seen.hits[hit.hitId]) return { accepted: false, events: [] };
  const sourceEntity = state.entities[hit.sourceId], owner = hit.ownerId ? state.players[hit.ownerId] ?? state.entities[hit.ownerId] : sourceEntity, target = state.players[hit.targetId] ?? state.entities[hit.targetId], hasDamage = Object.values(hit.payload.damage ?? {}).some((amount) => (amount ?? 0) > 0), hasHeal = (hit.payload.heal ?? 0) > 0;
  if (!owner || !target || "alive" in owner && !owner.alive || "alive" in target && !target.alive || hasHeal && !target.damageable.canReceiveHeal || !canTarget(hit.ownerId ?? hit.sourceId, hit.targetId, owner, target, sourceEntity?.source?.spell.targeting ?? { canHitSelf: false, canHitAllies: false, canHitEnemies: true, canHitNeutral: true })) return { accepted: false, events: [] };
  if (hasDamage && (!target.damageable.canReceiveDamage || target.damageable.invincible)) {
    state.seen.hits[hit.hitId] = true;
    return { accepted: true, events: [{ type: "damage_immune", targetId: hit.targetId, reason: "invincible" }] };
  }
  state.seen.hits[hit.hitId] = true;
  const events = [], damage = { ...hit.payload.damage ?? {} };
  let reaction = null;
  if (target.statuses.wet && damage.lightning) {
    damage.lightning *= 1.25;
    status(target, "shocked", now, hit.ownerId, 1200);
    reaction = "electro-charged";
    if (target.cast.phase !== "idle") target.cast = { ...target.cast, phase: "interrupted", phaseEndsAt: now + 350 };
  } else if (target.statuses.wet && damage.fire) {
    damage.fire *= 1.4;
    consume(target, "wet");
    reaction = "vaporize";
  } else if (target.statuses.wet && damage.ice) {
    consume(target, "wet");
    status(target, "frozen", now, hit.ownerId, 2e3);
    reaction = "freeze";
  } else if (target.statuses.burning && damage.water) {
    consume(target, "burning");
    status(target, "wet", now, hit.ownerId, 5e3);
    reaction = "extinguish";
  }
  if (target.statuses.frozen && ((damage.rock ?? 0) > 0 || (damage.physical ?? 0) > 0)) {
    damage.rock = (damage.rock ?? 0) + 20;
    consume(target, "frozen");
    reaction = "shatter";
  } else if (target.statuses.frozen && damage.fire) {
    consume(target, "frozen");
    reaction ??= "thaw";
  }
  const targetEntity = state.entities[hit.targetId];
  if (targetEntity?.obstacle?.material === "ice" && damage.fire) damage.fire *= 1.5;
  if (reaction) events.push({ type: "reaction_triggered", id: reaction, targetId: hit.targetId });
  for (const [element, raw] of Object.entries(damage)) {
    const robeMultiplier = "equipment" in target ? damageMultiplier(target.equipment, element) : 1, resisted = raw * robeMultiplier * (1 - Math.max(-1, Math.min(0.9, target.resistances[element] ?? 0)));
    let remaining = resisted;
    for (const shield of [...target.shields].sort((a, b) => b.priority - a.priority)) {
      const absorbed = Math.min(shield.amount, remaining * (shield.absorbElements[element] ?? 0));
      shield.amount -= absorbed;
      remaining -= absorbed;
    }
    target.shields = target.shields.filter((shield) => shield.amount > 0);
    if (remaining > 0) target.health.current = Math.max(0, target.health.current - remaining);
    events.push({ type: "damage_applied", targetId: hit.targetId, amount: Math.max(0, remaining), element, sourceId: hit.sourceId, largeImpact: hit.tags.includes("large-impact") });
  }
  if (hasHeal) {
    const amount = Math.min(hit.payload.heal, target.health.max - target.health.current);
    if (amount > 0) {
      target.health.current += amount;
      events.push({ type: "heal_applied", targetId: hit.targetId, amount });
    }
  }
  for (const effect of hit.payload.effects ?? []) {
    if (effect.type === "interrupt" && target.cast.phase !== "idle") {
      const spellId = target.cast.spell?.id;
      target.cast = { ...target.cast, phase: "interrupted", phaseEndsAt: now + 350 };
      events.push({ type: "cast_interrupted", casterId: hit.targetId, spellId, reason: "control" });
    } else if (effect.type === "knockback" && sourceEntity) applyForce(state, sourceEntity, owner, hit.targetId, effect.force, now);
  }
  for (const [key, amount] of Object.entries(hit.payload.statusBuildup ?? {})) {
    const type = key;
    if (immune(target, type)) {
      target.buildup[type] = 0;
      events.push({ type: "damage_immune", targetId: hit.targetId, reason: "status" });
      continue;
    }
    target.buildup[type] = (target.buildup[type] ?? 0) + (amount ?? 0);
    if ((target.buildup[type] ?? 0) >= STATUS_THRESHOLD) {
      target.buildup[type] = 0;
      status(target, type, now, hit.ownerId, type === "shocked" ? 1200 : type === "chilled" ? 3e3 : 5e3);
      events.push({ type: "status_applied", targetId: hit.targetId, status: type });
    }
  }
  return { accepted: true, events };
}

// src/game/rules/casting.ts
function beginCast(caster, castId, spell, aim, target, now) {
  if ("aim" in caster) caster.aim = aim;
  caster.cast = { phase: "chanting", castId, spell, startedAt: now, phaseEndsAt: now + spell.chantMs, aim, target };
}
function beginRecovery(caster, now, recoveryMs) {
  const spell = caster.cast.spell;
  caster.cast.phase = "recovery";
  caster.cast.phaseEndsAt = now + (recoveryMs ?? spell?.recoveryMs ?? 0);
}
function resetCast(caster) {
  caster.cast = idleCast(caster.aim ?? caster.cast.aim);
}
function idleCast(aim = { x: 1, y: 0 }) {
  return { phase: "idle", castId: null, spell: null, startedAt: 0, phaseEndsAt: null, aim, target: { x: 0, y: 0 } };
}

// src/game/rules/state.ts
function combatant(team, factionId, hp) {
  return { health: { current: hp, max: hp }, damageable: { canReceiveDamage: true, canReceiveHeal: true }, faction: { id: factionId, team }, statuses: {}, buildup: {}, buffs: [], shields: [], resistances: {}, cast: idleCast() };
}
function player(id, name, index) {
  return { id, name, connected: true, alive: true, position: { x: 0, y: index * 54 }, aim: { x: 1, y: 0 }, selectedElements: [], positionEpoch: 0, lastPoseSequence: 0, lastCastSequence: 0, gold: 50, inventory: [], equipment: {}, scrollCooldowns: {}, ...combatant("player", "players", 100) };
}
function initialState() {
  return { schemaVersion: 5, phase: "lobby", hostId: null, seed: 1, worldTime: 0, startedAt: null, run: { seed: 1, stageIndex: 0, stage: null, exploredRoomIds: [], discoveredSpellIds: ["resurrect"], completedRewardIds: [], portal: null, startedAt: null, completedAt: null }, players: {}, entities: {}, environment: { global: null, fields: [] }, loot: {}, merchant: null, forge: null, forgeUses: {}, seen: { hits: {}, spawns: {} }, message: "\u7B49\u5F85\u8FDC\u5F81" };
}
function normalize(value) {
  const length = Math.hypot(value.x, value.y);
  return length > 1e-4 ? { x: value.x / length, y: value.y / length } : { x: 1, y: 0 };
}

// src/game/rules/entities.ts
function add(state, entity) {
  state.entities[entity.id] = entity;
  state.seen.spawns[entity.id] = true;
  if (entity.kind === "field" && entity.source?.spell.delivery === "summon") state.environment.fields.push(entity.id);
  return entity;
}
function spawnSpellEntity(state, caster, spell, now) {
  const castId = caster.cast.castId, aim = caster.cast.aim, target = caster.cast.target, projectile = spell.delivery === "projectile", summon = spell.delivery === "summon", attached = spell.delivery === "spray" || spell.delivery === "beam", wall = spell.summon?.archetype === "rock-wall" || spell.summon?.archetype === "ice-wall";
  const position = summon ? spell.summon?.positionMode === "self" ? { ...caster.position } : spell.summon?.positionMode === "casterFront" ? { x: caster.position.x + aim.x * 80, y: caster.position.y + aim.y * 80 } : target : projectile ? { x: caster.position.x + aim.x * 30, y: caster.position.y + aim.y * 30 } : { ...caster.position };
  const travelMs = projectile && spell.speed ? spell.range / spell.speed * 1e3 : spell.lifetimeMs, tickMs = spell.tickMs ?? spell.beam?.tickInterval ?? (spell.delivery === "spray" ? 150 : summon && !wall ? 350 : 0);
  const entity = { id: `${castId}:${spell.delivery}:0`, kind: projectile ? "projectile" : wall ? "wall" : "field", archetype: spell.summon?.archetype, ownerId: caster.id, position, velocity: projectile ? { x: aim.x * (spell.speed ?? 0), y: aim.y * (spell.speed ?? 0) } : void 0, direction: attached ? aim : void 0, targetDirection: spell.delivery === "beam" ? aim : void 0, radius: spell.radius, createdAt: now, expiresAt: now + Math.min(spell.lifetimeMs, travelMs), detached: spell.detached, source: { spell, tickMs, nextTickAt: caster.faction.team === "monster" ? now + 100 : now }, ...combatant(wall ? "neutral" : caster.faction.team, caster.faction.id, wall ? spell.summon?.archetype === "ice-wall" ? 130 : 180 : 1) };
  if (wall) entity.obstacle = { blocksMovement: true, blocksProjectile: true, blocksBeam: true, blocksSpray: false, material: spell.summon?.archetype === "ice-wall" ? "ice" : "stone", width: 36, height: 140 };
  return add(state, entity);
}
function spawnMeteorWarning(state, caster, spell, now) {
  const entity = { id: `${caster.cast.castId}:warning:0`, kind: "warning", archetype: "meteor-warning", ownerId: caster.id, position: { ...caster.cast.target }, radius: spell.radius, createdAt: now, expiresAt: now + (spell.area?.warningMs ?? 700), detached: true, ...combatant("environment", caster.faction.id, 1) };
  entity.damageable.canReceiveDamage = false;
  return add(state, entity);
}
function spawnMeteorImpact(state, caster, spell, now) {
  const entity = { id: `${caster.cast.castId}:area:0`, kind: "area", archetype: "meteor-impact", ownerId: caster.id, position: { ...caster.cast.target }, radius: spell.radius, createdAt: now, expiresAt: now + spell.lifetimeMs, detached: true, source: { spell, tickMs: 0, nextTickAt: caster.faction.team === "monster" ? now + 100 : now }, ...combatant("environment", caster.faction.id, 1) };
  return add(state, entity);
}
function positionAt2(entity, now) {
  if (!entity.velocity) return entity.position;
  const elapsed = Math.max(0, now - entity.createdAt) / 1e3;
  return { x: entity.position.x + entity.velocity.x * elapsed, y: entity.position.y + entity.velocity.y * elapsed };
}

// src/game/rules/modifiers.ts
function applySpellModifiers(spell, modifiers) {
  const result = structuredClone(spell);
  const ordered = [...modifiers].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  for (const modifier of ordered) {
    const path = modifier.stat.split(".");
    let target = result;
    for (const key2 of path.slice(0, -1)) {
      const next = target[key2];
      if (!next || typeof next !== "object") break;
      target = next;
    }
    const key = path.at(-1);
    const current = target[key];
    if (modifier.op === "override") target[key] = modifier.value;
    else if (typeof current === "number" && typeof modifier.value === "number") target[key] = modifier.op === "add" ? current + modifier.value : modifier.op === "multiply" ? current * modifier.value : modifier.op === "min" ? Math.min(current, modifier.value) : Math.max(current, modifier.value);
  }
  return result;
}

// src/game/rules/terrainGeometry.ts
function terrainBounds(terrain) {
  return terrain.width != null && terrain.height != null ? { shape: "rect", width: terrain.width, height: terrain.height } : { shape: "circle", radius: terrain.radius };
}
function terrainOverlaps(terrain, point, radius) {
  const bounds = terrainBounds(terrain);
  return bounds.shape === "rect" ? Math.abs(point.x - terrain.position.x) <= bounds.width / 2 + radius && Math.abs(point.y - terrain.position.y) <= bounds.height / 2 + radius : Math.hypot(point.x - terrain.position.x, point.y - terrain.position.y) <= bounds.radius + radius;
}

// src/game/roguelike.ts
var GENERATION_VERSION = 1;
var WORLD_WIDTH = 7800;
var WORLD_HEIGHT = 5100;
var COLS = 6;
var ROWS = 5;
var CELL_W = 1250;
var CELL_H = 950;
var MARGIN_X = 150;
var MARGIN_Y = 150;
var ROOM_COUNT = 14;
var monsterSpell = (id, name, delivery, values) => ({ id, name, elements: [values.element], elementVector: { rock: 0, fire: 0, ice: 0, life: 0, lightning: 0, water: 0, shield: 0, [values.element]: 1 }, delivery, payload: { damage: { [values.element]: values.damage }, statusBuildup: values.buildup ? { [values.element === "fire" ? "burning" : values.element === "lightning" ? "shocked" : "chilled"]: values.buildup } : void 0, effects: values.knockback ? [{ type: "knockback", force: values.knockback }] : void 0 }, chantMs: values.chant, recoveryMs: values.recovery, detached: true, channelled: false, lifetimeMs: values.lifetime, speed: values.speed, tickMs: 0, range: values.range, radius: values.radius, coneAngle: delivery === "spray" ? Math.PI * 0.48 : void 0, area: delivery === "area" ? { warningMs: values.warning ?? 800, impactDelay: values.warning ?? 800 } : void 0, targeting: { canHitSelf: false, canHitAllies: false, canHitEnemies: true, canHitNeutral: true }, blocking: { blockBySelf: false, blockByAllies: true, blockByEnemies: true, blockByNeutral: true, blockByWalls: true, blockBySummons: true }, tags: ["monster-ability", values.element], visualKey: `monster.${id}` });
var CLAW = monsterSpell("ruins-claw", "\u5CA9\u722A", "spray", { element: "rock", damage: 10.4, chant: 470, recovery: 805, range: 68, radius: 24, lifetime: 160, knockback: 45 });
var RUNE_BOLT = monsterSpell("ruins-rune-bolt", "\u96F7\u7EB9\u5F39", "projectile", { element: "lightning", damage: 8.5, chant: 675, recovery: 990, range: 410, radius: 13, lifetime: 1800, speed: 260, buildup: 45 });
var GUARDIAN_WAVE = monsterSpell("ruins-guardian-wave", "\u5B88\u536B\u9707\u6CE2", "spray", { element: "rock", damage: 15, chant: 805, recovery: 1170, range: 115, radius: 34, lifetime: 180, knockback: 90 });
var BOSS_FLAME = monsterSpell("ruins-boss-flame", "\u9057\u8FF9\u70C8\u7130", "area", { element: "fire", damage: 25.5, chant: 485, recovery: 1125, range: 440, radius: 95, lifetime: 180, warning: 1e3, buildup: 55 });
var MONSTERS = {
  "ruins.chaser": { id: "ruins.chaser", health: 78, radius: 25, speed: 94, ai: "chaser", abilities: [{ id: "claw", spell: CLAW, minRange: 0, maxRange: 74, preferredRange: 52, priority: 1 }], resistances: {}, dropClass: "normal" },
  "ruins.shooter": { id: "ruins.shooter", health: 59, radius: 23, speed: 66, ai: "shooter", abilities: [{ id: "rune-bolt", spell: RUNE_BOLT, minRange: 95, maxRange: 390, preferredRange: 245, priority: 1 }], resistances: { lightning: 0.1 }, dropClass: "normal" },
  "ruins.guardian": { id: "ruins.guardian", health: 120, radius: 31, speed: 58, ai: "guardian", abilities: [{ id: "guardian-wave", spell: GUARDIAN_WAVE, minRange: 0, maxRange: 125, preferredRange: 78, priority: 1 }], resistances: { physical: 0.2 }, dropClass: "elite" },
  "ruins.boss": { id: "ruins.boss", health: 765, radius: 58, speed: 52, ai: "guardian", abilities: [{ id: "boss-flame", spell: BOSS_FLAME, minRange: 80, maxRange: 430, preferredRange: 210, priority: 2 }, { id: "guardian-wave", spell: GUARDIAN_WAVE, minRange: 0, maxRange: 145, preferredRange: 90, priority: 3 }, { id: "rune-bolt", spell: RUNE_BOLT, minRange: 120, maxRange: 390, preferredRange: 240, priority: 1 }], resistances: { physical: 0.15 }, dropClass: "boss" }
};
var BOSSES = { "ruins.guardian": { id: "ruins.guardian", monsterId: "ruins.boss", phaseThresholds: [0.66, 0.33], mechanicIntervalMs: 8e3, addDefinitionId: "ruins.chaser", baseAddCap: 3, rewardClass: "boss" } };
var STAGES = [
  { index: 0, themeId: "ruins", bossId: "ruins.guardian", requiredObjectives: 2, difficulty: 1, rewardMultiplier: 1, mechanicSpeed: 1, addBonus: 0 },
  { index: 1, themeId: "ruins", bossId: "ruins.guardian", requiredObjectives: 2, difficulty: 1.28, rewardMultiplier: 1.25, mechanicSpeed: 0.86, addBonus: 1 },
  { index: 2, themeId: "ruins", bossId: "ruins.guardian", requiredObjectives: 2, difficulty: 1.62, rewardMultiplier: 1.55, mechanicSpeed: 0.72, addBonus: 2 }
];
function createRng(seed) {
  let state = seed >>> 0 || 1831565813;
  return () => {
    state = state + 1831565813 | 0;
    let t = state;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashText2(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function deriveSeed(seed, domain) {
  return Math.imul((seed ^ hashText2(domain)) >>> 0, 2654435761) + 2246822507 >>> 0;
}
function deriveStageSeed(runSeed, stageIndex) {
  return deriveSeed(runSeed, `stage:${stageIndex}`);
}
function generateStage(runSeed, stageIndex) {
  const definition = STAGES[stageIndex] ?? STAGES[STAGES.length - 1], stageSeed = deriveStageSeed(runSeed, stageIndex), map = generateMap(deriveSeed(stageSeed, "map"));
  const terrain = generateTerrain(map.rooms, deriveSeed(stageSeed, "terrain")), progress = generateProgress(map.rooms, map.spawn, stageIndex, deriveSeed(stageSeed, "progress"));
  const encounters = generateEncounters(map.rooms, progress, deriveSeed(stageSeed, "encounters")), merchant = generateMerchant(map.rooms, progress, terrain, deriveSeed(stageSeed, "merchant"), stageIndex), forgeRoom = map.rooms.find((room) => !progress.used.has(room.id) && room.id !== "room-0") ?? map.rooms[1];
  const blueprint = { generationVersion: GENERATION_VERSION, index: stageIndex, stageSeed, themeId: definition.themeId, bossDefinitionId: definition.bossId, difficulty: definition.difficulty, rewardMultiplier: definition.rewardMultiplier, world: { width: WORLD_WIDTH, height: WORLD_HEIGHT, spawn: map.spawn, rooms: map.rooms, corridors: map.corridors }, terrains: terrain, encounters, objectives: progress.objectives, boss: progress.boss, merchant, forge: { id: `forge:${stageIndex}`, position: safeEconomyPosition(forgeRoom, terrain, 64), radius: 64 }, rewardSeeds: Object.fromEntries(encounters.map((encounter) => [encounter.id, deriveSeed(stageSeed, `reward:${encounter.id}`)])) };
  return { ...blueprint, fingerprint: fingerprint(blueprint) };
}
function generateMap(seed) {
  const random = createRng(seed), rooms = [makeRoom("room-0", { gridX: 2, gridY: 2, gridWidth: 1, gridHeight: 1, template: "standard", neighbors: [] }, random)], occupied = /* @__PURE__ */ new Map([["2,2", "room-0"]]), edges = [];
  for (let index = 1; index < ROOM_COUNT; index++) {
    const preferred = index % 5 === 2 ? "wide" : index % 5 === 4 ? "tall" : "standard", candidates = placements(preferred, occupied), fallback = candidates.length ? candidates : placements("standard", occupied), selected = fallback[Math.floor(random() * fallback.length)];
    const room = makeRoom(`room-${index}`, selected, random);
    rooms.push(room);
    for (let y = selected.gridY; y < selected.gridY + selected.gridHeight; y++) for (let x = selected.gridX; x < selected.gridX + selected.gridWidth; x++) occupied.set(`${x},${y}`, room.id);
    edges.push([selected.neighbors[Math.floor(random() * selected.neighbors.length)], room.id]);
  }
  const connected = new Set(edges.map(([a, b]) => edgeKey(a, b))), loops = [];
  for (const room of rooms) for (const other of rooms) if (room.id < other.id && touches(room, other) && !connected.has(edgeKey(room.id, other.id))) loops.push([room.id, other.id]);
  shuffle(loops, random);
  edges.push(...loops.slice(0, 3));
  const byId = new Map(rooms.map((room) => [room.id, room])), corridors = edges.map(([a, b], index) => {
    const from = byId.get(a), to = byId.get(b);
    if (!from.connections.includes(to.id)) from.connections.push(to.id);
    if (!to.connections.includes(from.id)) to.connections.push(from.id);
    return corridor(`corridor-${index}`, from, to);
  });
  return { rooms, corridors, spawn: center(rooms[0]) };
}
function placements(template, occupied) {
  const [gridWidth, gridHeight] = template === "wide" ? [2, 1] : template === "tall" ? [1, 2] : [1, 1], result = [];
  for (let gridY = 0; gridY <= ROWS - gridHeight; gridY++) for (let gridX = 0; gridX <= COLS - gridWidth; gridX++) {
    let free = true;
    const neighbors = /* @__PURE__ */ new Set();
    for (let y = gridY; y < gridY + gridHeight; y++) for (let x = gridX; x < gridX + gridWidth; x++) {
      if (occupied.has(`${x},${y}`)) free = false;
      for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
        const id = occupied.get(`${nx},${ny}`);
        if (id) neighbors.add(id);
      }
    }
    if (free && neighbors.size) result.push({ gridX, gridY, gridWidth, gridHeight, template, neighbors: [...neighbors] });
  }
  return result;
}
function makeRoom(id, p, random) {
  const footprintW = p.gridWidth * CELL_W, footprintH = p.gridHeight * CELL_H, width = Math.min(footprintW - 40, p.template === "wide" ? 2100 + Math.floor(random() * 4) * 50 : 980 + Math.floor(random() * 4) * 50), height = Math.min(footprintH - 40, p.template === "tall" ? 1700 + Math.floor(random() * 3) * 50 : 700 + Math.floor(random() * 4) * 50);
  return { id, gridX: p.gridX, gridY: p.gridY, gridWidth: p.gridWidth, gridHeight: p.gridHeight, template: p.template, position: { x: MARGIN_X + p.gridX * CELL_W + (footprintW - width) / 2, y: MARGIN_Y + p.gridY * CELL_H + (footprintH - height) / 2 }, width, height, connections: [] };
}
function corridor(id, a, b) {
  const ac = center(a), bc = center(b);
  if (Math.abs(ac.x - bc.x) > Math.abs(ac.y - bc.y)) return { id, fromRoomId: a.id, toRoomId: b.id, position: { x: Math.min(ac.x, bc.x), y: (ac.y + bc.y) / 2 - 60 }, width: Math.abs(ac.x - bc.x), height: 120 };
  return { id, fromRoomId: a.id, toRoomId: b.id, position: { x: (ac.x + bc.x) / 2 - 60, y: Math.min(ac.y, bc.y) }, width: 120, height: Math.abs(ac.y - bc.y) };
}
function touches(a, b) {
  const row = Math.max(a.gridY, b.gridY) < Math.min(a.gridY + a.gridHeight, b.gridY + b.gridHeight), col = Math.max(a.gridX, b.gridX) < Math.min(a.gridX + a.gridWidth, b.gridX + b.gridWidth);
  return row && (a.gridX + a.gridWidth === b.gridX || b.gridX + b.gridWidth === a.gridX) || col && (a.gridY + a.gridHeight === b.gridY || b.gridY + b.gridHeight === a.gridY);
}
function generateTerrain(rooms, seed) {
  const random = createRng(seed), result = [{ id: "terrain:safe-spawn", roomId: "room-0", kind: "safe-zone", position: center(rooms[0]), radius: 135, blocksMovement: false, active: true, warningAt: null, activatesAt: null, endsAt: null }];
  for (const room of rooms.slice(1)) {
    const roll = random(), kind = roll < 0.26 ? "falling-rock" : roll < 0.48 ? "rune-wall" : roll < 0.67 ? "rune" : "obstacle", position = { x: room.position.x + room.width * (0.28 + random() * 0.44), y: room.position.y + room.height * (0.28 + random() * 0.44) }, radius = kind === "rune-wall" ? 52 : 55 + Math.floor(random() * 55);
    result.push({ id: `terrain:${room.id}:0`, roomId: room.id, kind, position, radius, width: kind === "rune-wall" ? 42 : void 0, height: kind === "rune-wall" ? Math.min(220, room.height * 0.35) : void 0, blocksMovement: kind === "rune-wall" || kind === "obstacle", active: true, warningAt: null, activatesAt: null, endsAt: null });
  }
  return result;
}
function generateProgress(rooms, spawn, stageIndex, seed) {
  const distances = roomDistances(rooms, "room-0"), ranked = rooms.slice(1).sort((a, b) => (distances.get(b.id) ?? 0) - (distances.get(a.id) ?? 0) || a.id.localeCompare(b.id)), bossRoom = ranked.find((room) => room.gridWidth * room.gridHeight > 1) ?? ranked[0], used = /* @__PURE__ */ new Set([bossRoom.id]), take = () => {
    const room = ranked.find((candidate) => !used.has(candidate.id));
    used.add(room.id);
    return room;
  }, kinds = ["elite", "altar", "puzzle"], objectives = kinds.map((kind) => ({ id: `objective:${stageIndex}:${kind}`, roomId: take().id, kind, status: "dormant", progress: 0, target: kind === "altar" ? 2 : kind === "puzzle" ? 3 : 1 }));
  const c = center(bossRoom), runes = Array.from({ length: 4 }, (_, index) => ({ id: `boss-rune:${stageIndex}:${index}`, position: { x: c.x + Math.cos(index / 4 * Math.PI * 2) * 210, y: c.y + Math.sin(index / 4 * Math.PI * 2) * 155 }, active: index < 2 }));
  const boss = { definitionId: "ruins.guardian", roomId: bossRoom.id, status: "locked", entityId: null, phase: 0, nextMechanicAt: 0, runes, shielded: true };
  return { objectives, boss, used, spawn, random: createRng(seed) };
}
function encounterWaves(roomId, playerCount, cycle = 0) {
  const bonus = (Math.max(1, playerCount) - 1) * 2;
  return [4, 6, 8].map((base2, wave) => Array.from({ length: base2 + bonus }, (_, index) => `monster:${roomId}:cycle:${cycle}:wave:${wave}:${index}`));
}
function generateEncounters(rooms, progress, seed) {
  const random = createRng(seed), objectiveRooms = new Set(progress.objectives.map((objective) => objective.roomId));
  return rooms.slice(1).filter((room) => room.id !== progress.boss.roomId).map((room, index) => {
    const waves = encounterWaves(room.id, 1), monsterIds = waves.flat();
    return { id: `encounter:${room.id}`, roomId: room.id, kind: objectiveRooms.has(room.id) || index % 4 === 2 || random() < 0.2 ? "sealed" : "roaming", status: "dormant", monsterIds, waves, currentWave: 0, totalWaves: waves.length, nextWaveAt: null, scaledForPlayers: null, activatedAt: null, clearedAt: null };
  });
}
function safeEconomyPosition(room, terrains, radius) {
  const c = center(room), offsets = [[0, 0], [-0.22, 0], [0.22, 0], [0, -0.22], [0, 0.22], [-0.22, -0.22], [0.22, 0.22], [-0.22, 0.22], [0.22, -0.22]];
  for (const [ox, oy] of offsets) {
    const point = { x: c.x + room.width * ox, y: c.y + room.height * oy };
    if (point.x - radius < room.position.x || point.x + radius > room.position.x + room.width || point.y - radius < room.position.y || point.y + radius > room.position.y + room.height) continue;
    if (!terrains.some((terrain) => terrain.active && terrain.blocksMovement && terrainBlocks(terrain, point, radius + 12))) return point;
  }
  return c;
}
function generateMerchant(rooms, progress, terrains, seed, stageIndex) {
  const room = rooms.find((candidate) => candidate.id !== "room-0" && !progress.used.has(candidate.id)) ?? rooms[1];
  progress.used.add(room.id);
  const stock = [0, 1, 2, 3].map((index) => {
    const item = generateEquipment(deriveSeed(seed, "equipment"), stageIndex * 10 + index);
    return { item, price: Math.round(item.value * (1 + stageIndex * 0.12)) };
  });
  if (createRng(deriveSeed(seed, "catalyst"))() < 0.3) stock.push({ item: createCatalyst(seed, `merchant:${stageIndex}`), price: 80 });
  return { id: `merchant:${stageIndex}`, position: safeEconomyPosition(room, terrains, 56), radius: 56, stock };
}
function roomAt(stage, point, inset = 0) {
  return stage.world.rooms.find((room) => contains(room.position, room.width, room.height, point, inset));
}
function isWalkable(stage, point, radius = 24) {
  const floor = stage.world.rooms.some((room) => contains(room.position, room.width, room.height, point, radius)) || stage.world.corridors.some((corridor2) => contains(corridor2.position, corridor2.width, corridor2.height, point, radius));
  if (!floor) return false;
  return !stage.terrains.some((terrain) => terrain.active && terrain.blocksMovement && terrainBlocks(terrain, point, radius));
}
function moveWithinStage(stage, from, to, radius = 24) {
  const currentRoom = roomAt(stage, from), sealed = currentRoom && (stage.encounters.some((encounter) => encounter.roomId === currentRoom.id && encounter.kind === "sealed" && encounter.status === "active") || stage.boss.roomId === currentRoom.id && stage.boss.status === "active");
  if (sealed && roomAt(stage, to)?.id !== currentRoom.id) return { ...from };
  if (isWalkable(stage, to, radius)) return to;
  const x = { x: to.x, y: from.y };
  if (isWalkable(stage, x, radius)) return x;
  const y = { x: from.x, y: to.y };
  return isWalkable(stage, y, radius) ? y : { ...from };
}
function onlineLivingPlayers(players) {
  return Object.values(players).filter((player2) => player2.connected && player2.alive);
}
function allPlayersInRoom(players, stage, roomId) {
  const party = onlineLivingPlayers(players);
  return party.length > 0 && party.every((player2) => roomAt(stage, player2.position)?.id === roomId);
}
function completedObjectives(stage) {
  return stage.objectives.filter((objective) => objective.status === "completed").length;
}
function stageDefinition(index) {
  return STAGES[index] ?? STAGES[STAGES.length - 1];
}
function monsterDefinition(id) {
  return MONSTERS[id] ?? MONSTERS["ruins.chaser"];
}
function bossDefinition(id) {
  return BOSSES[id] ?? BOSSES["ruins.guardian"];
}
function monsterEntity(id, definitionId, roomId, position, difficulty, now, elite = false, boss = false) {
  const definition = monsterDefinition(definitionId), health = Math.round(definition.health * difficulty * (elite ? 1.45 : 1));
  return { id, kind: "monster", monsterDefinitionId: definition.id, roomId, elite, boss, position, radius: definition.radius, createdAt: now, expiresAt: null, detached: true, health: { current: health, max: health }, damageable: { canReceiveDamage: true, canReceiveHeal: true }, faction: { id: "monsters", team: "monster" }, statuses: {}, buildup: {}, buffs: [], shields: [], resistances: { ...definition.resistances }, cast: { phase: "idle", castId: null, spell: null, startedAt: 0, phaseEndsAt: null, aim: { x: 1, y: 0 }, target: { ...position } }, ai: { targetId: null, currentAbilityId: null, nextThinkAt: now + 500, movement: "hold", phase: 1 } };
}
function roomDistances(rooms, start) {
  const result = /* @__PURE__ */ new Map([[start, 0]]), queue = [start];
  while (queue.length) {
    const id = queue.shift(), room = rooms.find((candidate) => candidate.id === id);
    if (!room) continue;
    for (const next of room.connections) if (!result.has(next)) {
      result.set(next, result.get(room.id) + 1);
      queue.push(next);
    }
  }
  return result;
}
function center(room) {
  return { x: room.position.x + room.width / 2, y: room.position.y + room.height / 2 };
}
function contains(position, width, height, point, inset) {
  return point.x >= position.x + inset && point.x <= position.x + width - inset && point.y >= position.y + inset && point.y <= position.y + height - inset;
}
var terrainBlocks = terrainOverlaps;
function edgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function shuffle(values, random) {
  for (let i = values.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}
function fingerprint(value) {
  return hashText2(JSON.stringify(value)).toString(16).padStart(8, "0");
}

// src/game/rules/hitDetection.ts
var EPSILON = 1.5;
var add2 = (a, b, scale = 1) => ({ x: a.x + b.x * scale, y: a.y + b.y * scale });
var normalize2 = (value) => {
  const length = Math.hypot(value.x, value.y) || 1;
  return { x: value.x / length, y: value.y / length };
};
var reflect = (direction, normal) => normalize2({ x: direction.x - 2 * (direction.x * normal.x + direction.y * normal.y) * normal.x, y: direction.y - 2 * (direction.x * normal.x + direction.y * normal.y) * normal.y });
function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y, lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + dx * t), point.y - (start.y + dy * t));
}
function targets(state, source, now) {
  return [...Object.values(state.players).filter((p) => p.alive).map((p) => ({ id: p.id, position: p.position, radius: 24, combatant: p, kind: "player" })), ...Object.values(state.entities).filter((e) => e.id !== source.id && (e.kind === "monster" || e.kind === "wall")).map((e) => ({ id: e.id, position: positionAt2(e, now), radius: e.radius, combatant: e, kind: e.kind }))];
}
function blocks(source, target) {
  const spec = source.source.spell.blocking;
  if (target.kind === "wall") return spec.blockByWalls;
  if (target.kind !== "player") return spec.blockBySummons || spec.blockByNeutral;
  if (target.id === source.ownerId) return spec.blockBySelf;
  const ownerFaction = source.faction, targetFaction = target.combatant.faction, allied = ownerFaction.id === targetFaction.id || ownerFaction.team === targetFaction.team;
  return allied ? spec.blockByAllies : spec.blockByEnemies;
}
function rayCircle(origin, direction, center2, radius, max) {
  const delta = { x: center2.x - origin.x, y: center2.y - origin.y }, along = delta.x * direction.x + delta.y * direction.y, perpendicular2 = delta.x * delta.x + delta.y * delta.y - along * along, radius2 = radius * radius;
  if (perpendicular2 > radius2) return null;
  const distance2 = along - Math.sqrt(Math.max(0, radius2 - perpendicular2));
  return distance2 >= EPSILON && distance2 <= max ? distance2 : null;
}
function worldHit(state, origin, direction, max, width) {
  const stage = state.run.stage;
  if (!stage) return null;
  const step = Math.max(3, Math.min(8, width * 0.5));
  let previous = 0;
  for (let distance2 = step; distance2 <= max + step; distance2 += step) {
    const at = Math.min(max, distance2), point = add2(origin, direction, at);
    if (!isWalkable(stage, point, width)) {
      let low = previous, high = at;
      for (let i = 0; i < 7; i++) {
        const middle = (low + high) / 2;
        if (isWalkable(stage, add2(origin, direction, middle), width)) low = middle;
        else high = middle;
      }
      const hit = add2(origin, direction, low), probe = Math.max(5, width), walkX = isWalkable(stage, { x: hit.x - Math.sign(direction.x || 1) * probe, y: hit.y }, width), walkY = isWalkable(stage, { x: hit.x, y: hit.y - Math.sign(direction.y || 1) * probe }, width);
      let normal;
      if (walkX && !walkY) normal = { x: -Math.sign(direction.x || 1), y: 0 };
      else if (walkY && !walkX) normal = { x: 0, y: -Math.sign(direction.y || 1) };
      else normal = Math.abs(direction.x) > Math.abs(direction.y) ? { x: -Math.sign(direction.x), y: 0 } : { x: 0, y: -Math.sign(direction.y) };
      return { distance: low, point: hit, normal };
    }
    previous = at;
    if (at === max) break;
  }
  return null;
}
function beamSegments(state, source, now) {
  const spell = source.source?.spell;
  if (!spell || spell.delivery !== "beam") return [];
  const mode = spell.beam?.mode ?? "normal", maxBounces = mode === "reflect" ? spell.beam?.maxBounces ?? 1 : 0, width = spell.beam?.width ?? spell.radius;
  let origin = { ...source.position }, direction = normalize2(source.direction ?? { x: 1, y: 0 }), remaining = spell.range, ignoredId = null;
  const result = [];
  for (let bounce = 0; remaining > EPSILON && bounce <= maxBounces; bounce++) {
    const staticHit = mode === "pierce" ? null : worldHit(state, origin, direction, remaining, width), entities = mode === "pierce" ? [] : targets(state, source, now).filter((target) => target.id !== ignoredId && blocks(source, target)).map((target) => ({ target, distance: rayCircle(origin, direction, target.position, target.radius + width, remaining) })).filter((entry) => entry.distance != null).sort((a, b) => a.distance - b.distance), entityHit = entities[0], hitDistance = Math.min(staticHit?.distance ?? remaining, entityHit?.distance ?? remaining), end = add2(origin, direction, hitDistance);
    result.push({ from: { ...origin }, to: end });
    if (mode !== "reflect" || bounce === maxBounces || hitDistance >= remaining - EPSILON) break;
    const normal = entityHit && entityHit.distance <= (staticHit?.distance ?? Infinity) ? normalize2({ x: end.x - entityHit.target.position.x, y: end.y - entityHit.target.position.y }) : staticHit.normal;
    ignoredId = entityHit && entityHit.distance <= (staticHit?.distance ?? Infinity) ? entityHit.target.id : null;
    remaining -= hitDistance;
    direction = reflect(direction, normal);
    origin = add2(end, direction, EPSILON);
  }
  return result;
}
function intersectsSource(source, target, now, previous, state, tolerance = 0) {
  const spell = source.source?.spell;
  if (!spell) return false;
  const position = positionAt2(source, now);
  if (spell.delivery === "projectile") return pointSegmentDistance(target.position, previous ?? position, position) <= source.radius + target.radius + tolerance;
  if (spell.delivery === "spray") {
    const origin = source.position, delta = { x: target.position.x - origin.x, y: target.position.y - origin.y }, distance2 = Math.hypot(delta.x, delta.y);
    if (distance2 > spell.range + target.radius + tolerance || distance2 < 1e-3) return false;
    const direction = source.direction ?? { x: 1, y: 0 }, halfAngle = (spell.coneAngle ?? Math.PI / 3) / 2 + Math.asin(Math.min(0.45, (target.radius + tolerance) / distance2));
    return (delta.x * direction.x + delta.y * direction.y) / distance2 >= Math.cos(halfAngle);
  }
  if (spell.delivery === "beam") {
    const segments = state ? beamSegments(state, source, now) : [{ from: source.position, to: add2(source.position, source.direction ?? { x: 1, y: 0 }, spell.range) }];
    return segments.some((segment) => pointSegmentDistance(target.position, segment.from, segment.to) <= (spell.beam?.width ?? spell.radius) + target.radius + tolerance);
  }
  if (spell.delivery === "area" || spell.delivery === "summon" && source.kind === "field") return Math.hypot(target.position.x - source.position.x, target.position.y - source.position.y) <= source.radius + target.radius + tolerance;
  return false;
}
function collisionCandidates(state, source, now, previous, tolerance = 0) {
  const spell = source.source?.spell, owner = source.ownerId ? state.players[source.ownerId] ?? state.entities[source.ownerId] : void 0;
  if (!spell || !owner || "alive" in owner && !owner.alive) return [];
  const candidates = targets(state, source, now).flatMap((target) => {
    if (target.id === source.ownerId && !spell.targeting.canHitSelf || !intersectsSource(source, target, now, previous, state, tolerance)) return [];
    const hittable = canTarget(source.ownerId ?? source.id, target.id, owner, target.combatant, spell.targeting);
    if (!hittable && !blocks(source, target)) return [];
    return [{ target, reason: hittable ? "hit" : "blocked" }];
  });
  if (spell.delivery === "beam") {
    const segments = beamSegments(state, source, now), order = (target) => {
      let total = 0;
      for (const segment of segments) {
        if (pointSegmentDistance(target.position, segment.from, segment.to) <= target.radius + (spell.beam?.width ?? spell.radius)) return total + Math.hypot(target.position.x - segment.from.x, target.position.y - segment.from.y);
        total += Math.hypot(segment.to.x - segment.from.x, segment.to.y - segment.from.y);
      }
      return Infinity;
    };
    return candidates.sort((a, b) => order(a.target) - order(b.target));
  }
  candidates.sort((a, b) => Math.hypot(a.target.position.x - source.position.x, a.target.position.y - source.position.y) - Math.hypot(b.target.position.x - source.position.x, b.target.position.y - source.position.y));
  return spell.delivery === "projectile" && !spell.tags.includes("pierce") ? candidates.slice(0, 1) : candidates;
}
function verifiesHit(state, source, targetId, reason, now) {
  return collisionCandidates(state, source, now, source.position, 18).some((candidate) => candidate.target.id === targetId && candidate.reason === reason);
}

// src/game/rules/worldCollision.ts
function obstacleHalfSize(entity) {
  return { x: (entity.obstacle?.width ?? entity.radius * 2) / 2, y: (entity.obstacle?.height ?? entity.radius * 2) / 2 };
}
function overlapsObstacle(point, radius, entity) {
  const half = obstacleHalfSize(entity), dx = Math.max(0, Math.abs(point.x - entity.position.x) - half.x), dy = Math.max(0, Math.abs(point.y - entity.position.y) - half.y);
  return Math.hypot(dx, dy) < radius;
}
function movementObstacles(state, moverId) {
  return Object.values(state.entities).filter((entity) => entity.id !== moverId && entity.obstacle?.blocksMovement && entity.expiresAt !== 0);
}
function isWorldPositionWalkable(state, point, radius, moverId) {
  const stage = state.run.stage;
  return Boolean(stage && isWalkable(stage, point, radius) && !movementObstacles(state, moverId).some((entity) => overlapsObstacle(point, radius, entity)));
}
function resolveStep(state, from, to, radius, moverId) {
  const stage = state.run.stage;
  if (!stage) return from;
  const mapResolved = moveWithinStage(stage, from, to, radius);
  if (isWorldPositionWalkable(state, mapResolved, radius, moverId)) return mapResolved;
  const x = moveWithinStage(stage, from, { x: to.x, y: from.y }, radius);
  if (isWorldPositionWalkable(state, x, radius, moverId)) return x;
  const y = moveWithinStage(stage, from, { x: from.x, y: to.y }, radius);
  return isWorldPositionWalkable(state, y, radius, moverId) ? y : from;
}
function resolveWorldMovement(state, from, to, radius, moverId) {
  const distance2 = Math.hypot(to.x - from.x, to.y - from.y), steps = Math.max(1, Math.ceil(distance2 / Math.max(8, radius * 0.45)));
  let current = { ...from };
  for (let index = 1; index <= steps; index++) {
    const target = { x: from.x + (to.x - from.x) * index / steps, y: from.y + (to.y - from.y) * index / steps }, next = resolveStep(state, current, target, radius, moverId);
    if (next.x === current.x && next.y === current.y) break;
    current = next;
  }
  return current;
}
function roomIsSealed(state, roomId) {
  const stage = state.run.stage;
  return Boolean(stage && roomId && (stage.encounters.some((encounter) => encounter.roomId === roomId && encounter.kind === "sealed" && encounter.status === "active") || stage.boss.roomId === roomId && stage.boss.status === "active"));
}
function resolveTeleportDestination(state, from, target, radius = 24, moverId) {
  const stage = state.run.stage;
  if (!stage) return target;
  const dx = target.x - from.x, dy = target.y - from.y, distance2 = Math.hypot(dx, dy);
  if (distance2 < 1e-3) return from;
  const direction = { x: dx / distance2, y: dy / distance2 }, startRoom = roomAt(stage, from)?.id, startSealed = roomIsSealed(state, startRoom);
  let best = { ...from }, low = 0;
  for (let travelled = Math.min(8, distance2); travelled <= distance2; travelled += 8) {
    const point = { x: from.x + direction.x * travelled, y: from.y + direction.y * travelled }, roomId = roomAt(stage, point)?.id;
    if (startSealed && roomId !== startRoom || roomId !== startRoom && roomIsSealed(state, roomId) || !isWorldPositionWalkable(state, point, radius + 2, moverId)) break;
    best = point;
    low = travelled;
  }
  let high = Math.min(distance2, low + 8);
  for (let index = 0; index < 7 && high > low; index++) {
    const middle = (low + high) / 2, point = { x: from.x + direction.x * middle, y: from.y + direction.y * middle }, roomId = roomAt(stage, point)?.id, allowed = !(startSealed && roomId !== startRoom) && !(roomId !== startRoom && roomIsSealed(state, roomId)) && isWorldPositionWalkable(state, point, radius + 2, moverId);
    if (allowed) {
      best = point;
      low = middle;
    } else high = middle;
  }
  return best;
}
function canPlaceObstacle(state, position, width, height, _ownerId) {
  const stage = state.run.stage;
  if (!stage) return true;
  const room = roomAt(stage, position, Math.max(width, height) / 2);
  if (!room) return false;
  const corners = [{ x: position.x - width / 2, y: position.y - height / 2 }, { x: position.x + width / 2, y: position.y - height / 2 }, { x: position.x - width / 2, y: position.y + height / 2 }, { x: position.x + width / 2, y: position.y + height / 2 }];
  if (corners.some((corner) => !isWalkable(stage, corner, 8))) return false;
  if (Object.values(state.players).some((player2) => player2.alive && Math.abs(player2.position.x - position.x) < width / 2 + 28 && Math.abs(player2.position.y - position.y) < height / 2 + 28)) return false;
  return !movementObstacles(state).some((entity) => {
    const half = obstacleHalfSize(entity);
    return Math.abs(entity.position.x - position.x) < half.x + width / 2 && Math.abs(entity.position.y - position.y) < half.y + height / 2;
  });
}

// src/game/rules/spells.ts
var exact = (elements, sequence) => elements.length === sequence.length && sequence.every((element, index) => elements[index] === element);
var SPECIAL_RECIPES = [
  { sequence: ["lightning", "life", "lightning"], spec: resurrectSpec },
  { sequence: ["lightning", "shield", "lightning"], spec: teleportSpec },
  { sequence: ["life", "ice", "shield"], spec: cleanseSpec },
  { sequence: ["lightning", "shield", "fire"], spec: hasteSpec },
  { sequence: ["water", "life"], spec: lifeSpringSpec },
  { sequence: ["life", "lightning", "life"], spec: chainHealSpec },
  { sequence: ["shield", "rock"], spec: rockShieldSpec },
  { sequence: ["shield", "fire"], spec: fireShieldSpec },
  { sequence: ["shield", "ice"], spec: frostShieldSpec },
  { sequence: ["shield", "lightning"], spec: groundingShieldSpec },
  { sequence: ["shield", "water"], spec: waterShieldSpec },
  { sequence: ["fire", "life"], spec: lifeFlameSpec },
  { sequence: ["water", "ice"], spec: frostStreamSpec },
  { sequence: ["fire", "rock", "rock", "fire"], spec: meteorSpec },
  { sequence: ["rock", "fire"], spec: lavaBoltSpec },
  { sequence: ["rock", "ice"], spec: shatterIceBoltSpec },
  { sequence: ["water", "lightning"], spec: conductiveWaterSpec },
  { sequence: ["fire", "fire"], spec: flameJetSpec },
  { sequence: ["ice", "ice", "rock"], spec: iceLanceSpec },
  { sequence: ["water", "rock", "water"], spec: tidalImpactSpec },
  { sequence: ["lightning", "fire", "fire", "lightning"], spec: lightningStrikeSpec },
  { sequence: ["water", "ice", "ice", "water"], spec: blizzardSpec },
  { sequence: ["fire", "water", "water", "fire"], spec: rainSpec },
  { sequence: ["fire", "water"], spec: steamCloudSpec },
  { sequence: ["ice", "shield", "shield", "ice"], spec: magickaIceWallSpec },
  { sequence: ["lightning", "water", "lightning", "shield"], spec: thunderstormSpec },
  { sequence: ["rock", "shield", "lightning", "rock"], spec: gravityWellSpec },
  { sequence: ["fire", "shield", "fire"], spec: fireRingSpec },
  { sequence: ["life", "shield", "life", "shield"], spec: lifeBarrierSpec }
];
function resolveSpell(elements) {
  if (!elements.length || elements.length > 4) throw new Error("Element sequence must contain 1-4 elements");
  if (elements.length === 1 && elements[0] === "life") return selfHealSpec(elements);
  for (const recipe of SPECIAL_RECIPES) if (exact(elements, recipe.sequence)) return recipe.spec(elements);
  const last = elements.at(-1);
  if (last === "shield") return elements.slice(0, -1).includes("rock") ? summonSpec(elements) : shieldSpec(elements);
  if (last === "life") return beamSpec(elements);
  if (last === "rock") return projectileSpec(elements);
  return spraySpec(elements);
}
function spellTargetMode(spell) {
  if (spell.delivery === "shield" || spell.delivery === "environment" || spell.summon?.positionMode === "self" || spell.instant && ["selfHeal", "haste", "supernova", "equilibrium"].includes(spell.instant.kind)) return "self";
  if (spell.delivery === "spray" || spell.delivery === "beam" || spell.delivery === "projectile") return "direction";
  return "point";
}
function isSpecialSpellId(id) {
  return SPECIAL_RECIPES.some((recipe) => recipe.spec(recipe.sequence).id === id);
}

// src/game/definition.ts
var finiteVec = (value) => Number.isFinite(value?.x) && Number.isFinite(value?.y);
var clampPosition = (state, value, from = value, moverId) => state.run.stage ? resolveWorldMovement(state, from, value, 24, moverId) : value;
var emitAll = (ctx, events) => {
  for (const event of events) ctx.emit(`endwell.${event.type}`, event);
};
var playerAlive = (ctx) => Boolean(ctx.state.players[ctx.actor.id]?.alive);
var discoveredSpells = (state) => state.run.discoveredSpellIds ??= ["resurrect"];
var playerInCombat = (state, playerId) => {
  const stage = state.run.stage, p = state.players[playerId];
  if (!stage || !p) return false;
  const roomId = roomAt(stage, p.position)?.id;
  return stage.encounters.some((encounter) => encounter.roomId === roomId && encounter.status === "active") || stage.boss.roomId === roomId && stage.boss.status === "active";
};
var FORCE_DAMPING_PER_SECOND = 0.18;
function integrateForceMotion(state, target, dt) {
  const velocity = target.forceVelocity;
  if (!velocity) return false;
  const desired = { x: target.position.x + velocity.x * dt, y: target.position.y + velocity.y * dt }, next = resolveWorldMovement(state, target.position, desired, "alive" in target ? 24 : target.radius, target.id);
  const moved = Math.hypot(next.x - target.position.x, next.y - target.position.y) > 0.01;
  target.position = next;
  const damping = Math.pow(FORCE_DAMPING_PER_SECOND, dt), slowed = { x: velocity.x * damping, y: velocity.y * damping };
  if (Math.hypot(slowed.x, slowed.y) < 4) delete target.forceVelocity;
  else target.forceVelocity = slowed;
  if (moved && "positionEpoch" in target) target.positionEpoch += 1;
  return moved;
}
function turnToward(current, target, maxRadians) {
  const from = Math.atan2(current.y, current.x), to = Math.atan2(target.y, target.x), delta = Math.atan2(Math.sin(to - from), Math.cos(to - from)), angle = from + Math.max(-maxRadians, Math.min(maxRadians, delta));
  return { x: Math.cos(angle), y: Math.sin(angle) };
}
function updateAttachedDirections(state, step) {
  for (const entity of Object.values(state.entities)) {
    if (!entity.source || entity.detached || !entity.targetDirection) continue;
    if (entity.source.spell.delivery === "beam") entity.direction = turnToward(entity.direction ?? entity.targetDirection, entity.targetDirection, (entity.source.spell.beam?.turnSpeed ?? Math.PI * 1.5) * step);
    else entity.direction = entity.targetDirection;
  }
}
function clampTarget(state, origin, target, range) {
  const dx = target.x - origin.x, dy = target.y - origin.y, distance2 = Math.hypot(dx, dy), value = !range || distance2 <= range ? target : { x: origin.x + dx / Math.max(1, distance2) * range, y: origin.y + dy / Math.max(1, distance2) * range };
  return clampPosition(state, value, origin);
}
function recovery(ctx, p, castId, spell) {
  beginRecovery(p, ctx.now(), spell.recoveryMs);
  if (ctx.role === "authority") ctx.timers.dispatch(`cast:${castId}:idle`, spell.recoveryMs, "internal.castIdle", { playerId: p.id, castId }, p.id);
}
function livingTargets(state) {
  return [...Object.values(state.players).filter((target) => target.alive), ...Object.values(state.entities).filter((entity) => entity.kind === "monster")];
}
function removeOwnedActiveEntities(state, playerId) {
  for (const entity of Object.values(state.entities)) if (entity.ownerId === playerId && !entity.detached) {
    delete state.entities[entity.id];
    state.environment.fields = state.environment.fields.filter((id) => id !== entity.id);
  }
}
function killPlayer(ctx, p) {
  if (!p.alive) return;
  const interrupted = p.cast.phase !== "idle";
  removeOwnedActiveEntities(ctx.state, p.id);
  p.alive = false;
  p.health.current = 0;
  p.cast = idleCast(p.aim);
  p.selectedElements = [];
  p.shields = [];
  delete p.forceVelocity;
  if (interrupted) ctx.emit("endwell.cast_interrupted", { type: "cast_interrupted", casterId: p.id, reason: "dead" });
}
function applyRain(state, now, ownerId) {
  for (const target of livingTargets(state)) {
    delete target.statuses.burning;
    target.buildup.burning = 0;
    target.buildup.wet = (target.buildup.wet ?? 0) + 18;
    if ((target.buildup.wet ?? 0) >= 100) {
      target.buildup.wet = 0;
      target.statuses.wet = { type: "wet", endsAt: now + 2400, potency: 1, stacks: 1, sourceId: ownerId, tags: ["rain"] };
    }
  }
}
function applyBlizzard(state, now, ownerId) {
  for (const target of livingTargets(state)) {
    if (target.statuses.frostWard) {
      target.buildup.chilled = 0;
      continue;
    }
    target.buildup.chilled = (target.buildup.chilled ?? 0) + 22;
    if ((target.buildup.chilled ?? 0) >= 100) {
      target.buildup.chilled = 0;
      target.statuses.chilled = { type: "chilled", endsAt: now + 3e3, potency: 1, stacks: 1, sourceId: ownerId, tags: ["blizzard"] };
    }
  }
}
function applyEnvironment(state, now, ownerId) {
  const environment = state.environment.global;
  if (environment?.kind === "rain") applyRain(state, now, ownerId);
  else if (environment?.kind === "blizzard") applyBlizzard(state, now, ownerId);
}
function status2(p, type, now, duration, sourceId) {
  p.statuses[type] = { type, endsAt: now + duration, potency: 1, stacks: 1, sourceId, tags: ["spell"] };
  p.buildup[type] = 0;
}
function applyShieldStatuses(p, spell, now) {
  for (const type of ["fireWard", "frostWard", "waterWard", "grounded"]) if (spell.tags.includes(type)) status2(p, type, now, spell.lifetimeMs, p.id);
}
function applyInstant(state, p, spell, now) {
  const instant = spell.instant;
  if (!instant) return;
  if (instant.kind === "teleport") {
    p.position = resolveTeleportDestination(state, p.position, p.cast.target, 24, p.id);
    p.positionEpoch += 1;
    return;
  }
  if (instant.kind === "selfHeal") {
    p.health.current = Math.min(p.health.max, p.health.current + (instant.amount ?? 20));
    return;
  }
  if (instant.kind === "haste") {
    status2(p, "hasted", now, instant.durationMs ?? 6e3, p.id);
    return;
  }
  if (instant.kind === "supernova") {
    for (const target of livingTargets(state)) target.health.current = Math.max(0, target.health.current * (1 - (instant.amount ?? 0.5)));
    return;
  }
  if (instant.kind === "equilibrium") {
    for (const target of livingTargets(state)) target.health.current = Math.max(0, target.health.max * (instant.amount ?? 0.5));
    return;
  }
  const radius = instant.radius ?? spell.radius, center2 = p.cast.target;
  if (instant.kind === "cleanse") {
    for (const target of livingTargets(state)) if (distance(target.position, center2) <= radius) {
      target.statuses = {};
      target.buildup = {};
    }
  }
  if (instant.kind === "resurrect") {
    for (const target of Object.values(state.players)) if (target.faction.id === p.faction.id && !target.alive && distance(target.position, center2) <= radius) {
      target.alive = true;
      target.health.current = Math.max(1, Math.round(target.health.max * (instant.amount ?? 0.25)));
      target.statuses = {};
      target.buildup = {};
      delete target.forceVelocity;
    }
  }
  if (instant.kind === "annihilation") {
    const targets2 = livingTargets(state).filter((target) => distance(target.position, center2) <= radius);
    if (targets2.length === 1) targets2[0].health.current = Math.max(0, targets2[0].health.current * (1 - (instant.amount ?? 0.99)));
  }
}
function activatePlayerCast(ctx, playerId, castId) {
  const p = ctx.state.players[playerId], spell = p?.cast.spell;
  if (!p?.alive || !spell || p.cast.castId !== castId || p.cast.phase !== "chanting") return;
  p.cast.phase = "active";
  p.cast.phaseEndsAt = spell.channelled ? ctx.now() + spell.lifetimeMs : ctx.now();
  if (isSpecialSpellId(spell.id) && !discoveredSpells(ctx.state).includes(spell.id)) discoveredSpells(ctx.state).push(spell.id);
  if (spell.delivery === "instant") {
    const before = spell.tags.includes("large-impact") ? new Map(livingTargets(ctx.state).map((target) => [target.id, target.health.current])) : null;
    applyInstant(ctx.state, p, spell, ctx.now());
    if (before) for (const target of livingTargets(ctx.state)) {
      const amount = Math.max(0, (before.get(target.id) ?? target.health.current) - target.health.current);
      if (amount > 0) ctx.emit("endwell.damage_applied", { type: "damage_applied", targetId: target.id, amount, element: "pure", sourceId: castId, largeImpact: true });
    }
    recovery(ctx, p, castId, spell);
    return;
  }
  if (spell.delivery === "shield" && spell.shield) {
    p.shields.push({ id: castId, amount: spell.shield.amount, maxAmount: spell.shield.amount, absorbElements: spell.shield.absorbElements, priority: 10, tags: spell.tags });
    applyShieldStatuses(p, spell, ctx.now());
    recovery(ctx, p, castId, spell);
    return;
  }
  if (spell.delivery === "environment" && spell.environment) {
    ctx.state.environment.global = { id: castId, kind: spell.environment.kind, ownerId: p.id, startedAt: ctx.now(), endsAt: ctx.now() + spell.environment.duration, tickInterval: spell.environment.tickInterval, nextTickAt: ctx.now() };
    recovery(ctx, p, castId, spell);
    return;
  }
  if (spell.delivery === "area" && spell.area) {
    const warning = spawnMeteorWarning(ctx.state, p, spell, ctx.now());
    p.cast.phase = "warning";
    p.cast.phaseEndsAt = ctx.now() + spell.area.warningMs;
    ctx.emit("endwell.entity_spawned", { type: "entity_spawned", entityId: warning.id });
    if (ctx.role === "authority") ctx.timers.dispatch(`cast:${castId}:impact`, spell.area.warningMs, "internal.areaImpact", { playerId: p.id, castId }, p.id);
    return;
  }
  const wall = spell.summon?.archetype === "rock-wall" || spell.summon?.archetype === "ice-wall";
  if (wall && !canPlaceObstacle(ctx.state, p.cast.target, 36, 140, p.id)) {
    recovery(ctx, p, castId, spell);
    return;
  }
  const entity = spawnSpellEntity(ctx.state, p, spell, ctx.now());
  ctx.emit("endwell.entity_spawned", { type: "entity_spawned", entityId: entity.id });
  if (spell.channelled) {
    if (ctx.role === "authority") ctx.timers.dispatch(`cast:${castId}:interrupt`, spell.lifetimeMs, "cast.interrupt", { playerId: p.id, castId, reason: "timeout" }, p.id);
  } else recovery(ctx, p, castId, spell);
}
function resolveCastSpell(p, elements, now) {
  return resolveScrollSpell(elements, p, now) ?? resolveSpell(elements);
}
function drop(state, p, item, now, prefix) {
  const id = `${prefix}:${p.id}:${item.id}:${now}`;
  state.loot[id] = { id, position: { ...p.position }, item, droppedByPlayerId: p.id, ownerPriorityUntil: now + 1800 };
}
function itemPayload(value) {
  return typeof value?.itemId === "string";
}
function pickupPayload(value) {
  return typeof value?.lootId === "string";
}
function merchantPayload(value) {
  const payload2 = value;
  return typeof payload2?.merchantId === "string" && typeof payload2?.itemId === "string";
}
function forgePayload(value) {
  const payload2 = value;
  return typeof payload2?.forgeId === "string" && Array.isArray(payload2.itemIds) && payload2.itemIds.every((id) => typeof id === "string");
}
function roomCenter(state, roomId) {
  const room = state.run.stage?.world.rooms.find((candidate) => candidate.id === roomId);
  return room ? { x: room.position.x + room.width / 2, y: room.position.y + room.height / 2 } : { x: 0, y: 0 };
}
function scaleEncounter(encounter, playerCount) {
  if (encounter.scaledForPlayers != null) return;
  const count = Math.max(1, playerCount), cycle = encounter.id.includes(":altar:") ? Number(encounter.id.split(":").at(-1)) || 0 : 0;
  encounter.waves = encounterWaves(encounter.roomId, count, cycle);
  encounter.monsterIds = encounter.waves.flat();
  encounter.totalWaves = encounter.waves.length;
  encounter.scaledForPlayers = count;
}
function encounterSpawnPosition(state, room, wave, index, count) {
  const stage = state.run.stage, c = roomCenter(state, room.id), facilities = [stage.merchant, stage.forge], players = onlineLivingPlayers(state.players);
  for (let attempt = 0; attempt < 12; attempt++) {
    const angle = (index / Math.max(1, count) + attempt * 0.381 + wave * 0.13) * Math.PI * 2, distanceFromCenter = Math.min(room.width, room.height) * (0.27 + attempt % 3 * 0.045), point = { x: c.x + Math.cos(angle) * distanceFromCenter, y: c.y + Math.sin(angle) * distanceFromCenter };
    if (!isWalkable(stage, point, 34)) continue;
    if (players.some((player2) => distance(player2.position, point) < 120)) continue;
    if (facilities.some((facility) => distance(facility.position, point) < facility.radius + 54)) continue;
    return point;
  }
  for (let y = 0.18; y <= 0.82; y += 0.16) for (let x = 0.18; x <= 0.82; x += 0.16) {
    const point = { x: room.position.x + room.width * x, y: room.position.y + room.height * y };
    if (isWalkable(stage, point, 34) && !players.some((player2) => distance(player2.position, point) < 120) && !facilities.some((facility) => distance(facility.position, point) < facility.radius + 54)) return point;
  }
  return null;
}
function spawnEncounterWave(state, encounter, now) {
  const stage = state.run.stage, room = stage?.world.rooms.find((candidate) => candidate.id === encounter.roomId), waveIndex = encounter.currentWave, ids = encounter.waves[waveIndex] ?? [];
  if (!stage || !room || !ids.length) return;
  const objective = stage.objectives.find((candidate) => candidate.roomId === room.id);
  ids.forEach((id, index) => {
    if (state.seen.spawns[id]) return;
    const elite = waveIndex === 2 && index === ids.length - 1, definitionId = elite ? "ruins.guardian" : waveIndex === 0 ? "ruins.chaser" : waveIndex === 1 && index % 3 === 1 ? "ruins.shooter" : waveIndex === 2 && index % 3 === 0 ? "ruins.shooter" : "ruins.chaser", objectiveElite = objective?.kind === "elite" && waveIndex === 2 && index === 0, position = encounterSpawnPosition(state, room, waveIndex, index, ids.length);
    if (!position) return;
    state.entities[id] = monsterEntity(id, objectiveElite ? "ruins.guardian" : definitionId, room.id, position, stage.difficulty, now, elite || objectiveElite);
    state.seen.spawns[id] = true;
  });
  encounter.currentWave += 1;
  encounter.nextWaveAt = null;
}
function spawnEncounter(state, encounter, now) {
  const stage = state.run.stage;
  if (!stage || encounter.status !== "dormant") return;
  scaleEncounter(encounter, onlineLivingPlayers(state.players).length);
  encounter.status = "active";
  encounter.activatedAt ??= now;
  encounter.currentWave = 0;
  encounter.nextWaveAt = now + 900;
  const room = stage.world.rooms.find((candidate) => candidate.id === encounter.roomId);
  if (!room) return;
  for (const rock of stage.terrains.filter((terrain) => terrain.roomId === room.id && terrain.kind === "falling-rock")) {
    rock.warningAt = now;
    rock.activatesAt = now + 1200;
    rock.endsAt = now + 2200;
  }
  const objective = stage.objectives.find((candidate) => candidate.roomId === room.id);
  if (objective) objective.status = "active";
}
function rewardEncounter(state, encounterId, position, now) {
  const stage = state.run.stage;
  if (!stage || state.run.completedRewardIds.includes(encounterId)) return;
  state.run.completedRewardIds.push(encounterId);
  const seed = stage.rewardSeeds[encounterId] ?? stage.stageSeed, item = generateEquipment(seed, state.run.completedRewardIds.length + stage.index * 20), id = `loot:${encounterId}`;
  state.loot[id] = { id, position, item, droppedByPlayerId: null, ownerPriorityUntil: now };
  for (const player2 of onlineLivingPlayers(state.players)) player2.gold += Math.round(18 * stage.rewardMultiplier);
}
function updateEncounters(state, now) {
  const stage = state.run.stage;
  if (!stage) return;
  const livingPlayers = onlineLivingPlayers(state.players), playerRooms = livingPlayers.map((player2) => roomAt(stage, player2.position)?.id);
  for (const encounter of stage.encounters) {
    if (encounter.status === "dormant") {
      const shouldStart = encounter.kind === "sealed" ? allPlayersInRoom(state.players, stage, encounter.roomId) : playerRooms.includes(encounter.roomId);
      if (shouldStart) spawnEncounter(state, encounter, now);
    }
    if (encounter.status !== "active") continue;
    const objective = stage.objectives.find((candidate) => candidate.roomId === encounter.roomId);
    if (objective?.kind === "puzzle" && objective.progress < objective.target) {
      const room = stage.world.rooms.find((candidate) => candidate.id === objective.roomId);
      const rune = { x: room.position.x + room.width * (0.25 + objective.progress * 0.25), y: room.position.y + room.height * (objective.progress % 2 ? 0.68 : 0.32) };
      if (livingPlayers.some((player2) => distance(player2.position, rune) <= 48)) objective.progress += 1;
    }
    const alive = encounter.monsterIds.filter((id) => state.entities[id]).length;
    if (alive > 0) {
      encounter.nextWaveAt = null;
      continue;
    }
    if (encounter.currentWave < encounter.totalWaves) {
      encounter.nextWaveAt ??= now + 900;
      if (now >= encounter.nextWaveAt) spawnEncounterWave(state, encounter, now);
      continue;
    }
    if (objective?.kind === "puzzle" && objective.progress < objective.target) continue;
    if (objective?.kind === "altar" && objective.progress + 1 < objective.target) {
      objective.progress += 1;
      encounter.status = "dormant";
      encounter.id = `encounter:${encounter.roomId}:altar:${objective.progress}`;
      encounter.scaledForPlayers = null;
      encounter.activatedAt = null;
      encounter.currentWave = 0;
      encounter.nextWaveAt = null;
      encounter.waves = [];
      encounter.monsterIds = [];
      continue;
    }
    encounter.status = "cleared";
    encounter.clearedAt = now;
    encounter.nextWaveAt = null;
    if (objective) {
      objective.progress = objective.target;
      objective.status = "completed";
    }
    rewardEncounter(state, encounter.id, roomCenter(state, encounter.roomId), now);
  }
  if (stage.boss.status === "locked" && completedObjectives(stage) >= stageDefinition(stage.index).requiredObjectives) stage.boss.status = "available";
}
function startBoss(state, now) {
  const stage = state.run.stage;
  if (!stage || stage.boss.status !== "available" || !allPlayersInRoom(state.players, stage, stage.boss.roomId)) return;
  const definition = bossDefinition(stage.boss.definitionId), id = `boss:${stage.index}:${stage.boss.roomId}`, entity = monsterEntity(id, definition.monsterId, stage.boss.roomId, roomCenter(state, stage.boss.roomId), stage.difficulty * Math.max(1, 0.72 + onlineLivingPlayers(state.players).length * 0.28), now, true, true);
  stage.boss.status = "active";
  stage.boss.entityId = id;
  stage.boss.phase = 1;
  stage.boss.shielded = true;
  stage.boss.nextMechanicAt = now + definition.mechanicIntervalMs * stageDefinition(stage.index).mechanicSpeed;
  state.entities[id] = entity;
  state.seen.spawns[id] = true;
}
function updateBoss(state, now) {
  const stage = state.run.stage;
  if (!stage) return;
  startBoss(state, now);
  if (stage.boss.status !== "active") return;
  const boss = stage.boss.entityId ? state.entities[stage.boss.entityId] : void 0;
  if (!boss) {
    stage.boss.status = "defeated";
    stage.boss.shielded = false;
    rewardEncounter(state, `boss:${stage.index}`, roomCenter(state, stage.boss.roomId), now);
    state.run.portal = { id: `portal:${stage.index}`, roomId: stage.boss.roomId, position: roomCenter(state, stage.boss.roomId), active: true };
    return;
  }
  const definition = bossDefinition(stage.boss.definitionId), ratio = boss.health.current / boss.health.max, nextPhase = ratio <= definition.phaseThresholds[1] ? 3 : ratio <= definition.phaseThresholds[0] ? 2 : 1;
  if (nextPhase > stage.boss.phase) {
    stage.boss.phase = nextPhase;
    stage.boss.shielded = true;
    for (const rune of stage.boss.runes) rune.active = true;
  }
  for (const rune of stage.boss.runes.filter((candidate) => candidate.active)) if (onlineLivingPlayers(state.players).some((player2) => distance(player2.position, rune.position) <= 55)) rune.active = false;
  stage.boss.shielded = stage.boss.runes.some((rune) => rune.active);
  if (now >= stage.boss.nextMechanicAt) {
    stage.boss.nextMechanicAt = now + definition.mechanicIntervalMs * stageDefinition(stage.index).mechanicSpeed;
    const current = Object.values(state.entities).filter((entity) => entity.roomId === stage.boss.roomId && !entity.boss && entity.kind === "monster").length, cap = definition.baseAddCap + stageDefinition(stage.index).addBonus + Math.min(3, onlineLivingPlayers(state.players).length);
    for (let index = current; index < Math.min(cap, current + stage.boss.phase); index++) {
      let ordinal = index;
      while (state.seen.spawns[`boss-add:${stage.index}:${stage.boss.phase}:${ordinal}`]) ordinal += 1;
      const id = `boss-add:${stage.index}:${stage.boss.phase}:${ordinal}`;
      state.entities[id] = monsterEntity(id, definition.addDefinitionId, stage.boss.roomId, { x: boss.position.x + Math.cos(ordinal) * 180, y: boss.position.y + Math.sin(ordinal) * 140 }, stage.difficulty, now);
      state.seen.spawns[id] = true;
    }
    const rocks = stage.terrains.filter((terrain) => terrain.kind === "falling-rock" && terrain.roomId === stage.boss.roomId);
    for (const rock of rocks) {
      rock.active = true;
      rock.warningAt = now;
      rock.activatesAt = now + 900;
      rock.endsAt = now + 1800;
    }
  }
}
function scaledMonsterSpell(ability, difficulty, boss = false) {
  const spell = structuredClone(ability.spell);
  if (spell.payload.damage) {
    for (const key of Object.keys(spell.payload.damage)) if (spell.payload.damage[key] != null) spell.payload.damage[key] *= difficulty * (boss && spell.id !== "ruins-boss-flame" ? 1.3 : 1);
  }
  return spell;
}
function selectAbility(abilities, range) {
  return abilities.filter((ability) => range >= ability.minRange && range <= ability.maxRange).sort((a, b) => b.priority - a.priority)[0];
}
function updateMonsterAi(state, now, dt) {
  const stage = state.run.stage, players = onlineLivingPlayers(state.players);
  if (!stage || !players.length) return;
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== "monster" || !entity.monsterDefinitionId || !entity.ai) continue;
    const definition = monsterDefinition(entity.monsterDefinitionId), candidates = players.filter((player2) => roomAt(stage, player2.position)?.id === entity.roomId);
    if (!candidates.length) continue;
    const target = candidates.sort((a, b) => distance(a.position, entity.position) - distance(b.position, entity.position))[0], dx = target.position.x - entity.position.x, dy = target.position.y - entity.position.y, range = Math.hypot(dx, dy) || 1, aim = { x: dx / range, y: dy / range };
    entity.ai.targetId = target.id;
    if (entity.cast.phase === "idle" && now >= entity.ai.nextThinkAt) {
      const ability = selectAbility(definition.abilities, range);
      if (ability) {
        const spell = scaledMonsterSpell(ability, stage.difficulty, entity.boss), castId = `${entity.id}:cast:${Math.floor(now)}`;
        entity.ai.currentAbilityId = ability.id;
        entity.ai.movement = "hold";
        beginCast(entity, castId, spell, aim, { ...target.position }, now);
        continue;
      }
      entity.ai.nextThinkAt = now + 160;
    }
    if (entity.cast.phase !== "idle" && entity.cast.phase !== "recovery") continue;
    const nearest = [...definition.abilities].sort((a, b) => Math.abs(range - a.preferredRange) - Math.abs(range - b.preferredRange))[0];
    entity.ai.movement = range < nearest.minRange ? "retreat" : range > nearest.preferredRange ? "approach" : "hold";
    if (entity.ai.movement === "hold") continue;
    const sign = entity.ai.movement === "retreat" ? -1 : 1, statusSpeed = entity.statuses.frozen ? 0 : entity.statuses.chilled ? 0.55 : 1, desired = { x: entity.position.x + aim.x * definition.speed * statusSpeed * dt * sign, y: entity.position.y + aim.y * definition.speed * statusSpeed * dt * sign };
    entity.position = resolveWorldMovement(state, entity.position, desired, entity.radius, entity.id);
  }
}
function updateMonsterCasts(state, now) {
  for (const entity of Object.values(state.entities)) {
    if (entity.kind !== "monster" || !entity.ai || !entity.cast.spell || entity.cast.phaseEndsAt == null || now < entity.cast.phaseEndsAt) continue;
    const spell = entity.cast.spell;
    if (entity.cast.phase === "chanting") {
      if (spell.delivery === "area" && spell.area) {
        spawnMeteorWarning(state, entity, spell, now);
        entity.cast.phase = "warning";
        entity.cast.phaseEndsAt = now + spell.area.warningMs;
      } else {
        spawnSpellEntity(state, entity, spell, now);
        beginRecovery(entity, now);
      }
    } else if (entity.cast.phase === "warning") {
      delete state.entities[`${entity.cast.castId}:warning:0`];
      spawnMeteorImpact(state, entity, spell, now);
      beginRecovery(entity, now);
    } else if (entity.cast.phase === "recovery" || entity.cast.phase === "interrupted") {
      resetCast(entity);
      entity.ai.currentAbilityId = null;
      entity.ai.nextThinkAt = now + 180;
    }
  }
}
function updateMonsterHitSources(ctx, now) {
  for (const source of Object.values(ctx.state.entities)) {
    const owner = source.ownerId ? ctx.state.entities[source.ownerId] : void 0;
    if (!source.source || owner?.kind !== "monster" || now < source.source.nextTickAt) continue;
    const tick = source.source.tickMs > 0 ? Math.floor(now / source.source.tickMs) : 0, candidates = collisionCandidates(ctx.state, source, now, source.position);
    for (const candidate of candidates) {
      const eventId = `${source.id}:hit:${candidate.target.id}:${tick}`;
      if (ctx.state.seen.hits[eventId]) continue;
      ctx.dispatch("combat.resolveHit", { hitId: eventId, sourceId: source.id, targetId: candidate.target.id, tick, reason: candidate.reason }, ctx.host.id);
      if (source.kind === "projectile" && !source.source.spell.tags.includes("pierce")) break;
    }
    source.source.nextTickAt = source.kind === "projectile" && !candidates.length ? now + 50 : source.source.tickMs > 0 ? now + source.source.tickMs : Number.MAX_SAFE_INTEGER;
  }
}
function updateTerrain(state, now) {
  for (const terrain of state.run.stage?.terrains ?? []) {
    if (terrain.kind !== "falling-rock" || terrain.activatesAt == null) continue;
    if (terrain.endsAt != null && now >= terrain.endsAt) {
      terrain.active = false;
      terrain.warningAt = terrain.activatesAt = terrain.endsAt = null;
      continue;
    }
    if (now >= terrain.activatesAt) {
      for (const player2 of onlineLivingPlayers(state.players)) if (distance(player2.position, terrain.position) <= terrain.radius) {
        player2.health.current = Math.max(0, player2.health.current - 22);
        terrain.activatesAt = Number.MAX_SAFE_INTEGER;
      }
    }
  }
}
function advancePortal(state, now) {
  const portal = state.run.portal;
  if (!portal || !portal.active || !onlineLivingPlayers(state.players).every((player2) => distance(player2.position, portal.position) <= 58)) return;
  if (state.run.stageIndex >= 2) {
    state.phase = "victory";
    state.run.completedAt = now;
    state.message = "\u8FDC\u5F81\u80DC\u5229";
    return;
  }
  const nextIndex = state.run.stageIndex + 1, stage = generateStage(state.run.seed, nextIndex);
  state.run.stageIndex = nextIndex;
  state.run.stage = stage;
  state.run.exploredRoomIds = ["room-0"];
  state.run.portal = null;
  state.entities = {};
  state.loot = {};
  state.merchant = stage.merchant;
  state.forge = stage.forge;
  state.seen = { hits: {}, spawns: {} };
  for (const [index, player2] of onlineLivingPlayers(state.players).entries()) {
    player2.position = { x: stage.world.spawn.x + index * 54, y: stage.world.spawn.y };
    player2.positionEpoch += 1;
    player2.health.current = player2.health.max;
    player2.cast = idleCast();
  }
  state.message = `\u9057\u8FF9\u8FDC\u5F81 \xB7 \u7B2C${nextIndex + 1}\u5173`;
}
function resolveCombatHit(ctx, payload2) {
  const source = ctx.state.entities[payload2.sourceId], targetBefore = ctx.state.entities[payload2.targetId];
  if (!source?.source) return;
  const owner = source.ownerId ? ctx.state.players[source.ownerId] ?? ctx.state.entities[source.ownerId] : void 0;
  if (!owner || "alive" in owner && !owner.alive) return;
  const hitPayload2 = structuredClone(source.source.spell.payload);
  if (targetBefore?.boss && ctx.state.run.stage?.boss.shielded && hitPayload2.damage) {
    for (const key of Object.keys(hitPayload2.damage)) if (hitPayload2.damage[key] != null) hitPayload2.damage[key] *= 0.2;
  }
  const event = { hitId: payload2.hitId, sourceId: source.id, ownerId: source.ownerId, targetId: payload2.targetId, payload: hitPayload2, delivery: source.source.spell.delivery, detached: source.detached, tags: source.source.spell.tags }, resolution = applyHit(ctx.state, event, ctx.now());
  emitAll(ctx, resolution.events);
  if (!resolution.accepted && payload2.reason !== "blocked") return;
  const target = ctx.state.players[payload2.targetId] ?? ctx.state.entities[payload2.targetId];
  if (resolution.accepted && target && target.health.current <= 0) {
    if ("alive" in target) killPlayer(ctx, target);
    else {
      delete ctx.state.entities[payload2.targetId];
      ctx.emit("endwell.entity_destroyed", { type: "entity_destroyed", entityId: payload2.targetId, kind: targetBefore?.kind ?? "monster", reason: "killed" });
    }
  }
  if (source.kind === "projectile" && !source.source.spell.tags.includes("pierce")) delete ctx.state.entities[source.id];
}
var endwellGame = defineGame({
  meta: { name: "Endwell", minPlayers: 1, maxPlayers: 4 },
  initialState,
  lifecycle: {
    create(ctx) {
      ctx.state.seed = Math.floor(ctx.random() * 2147483647);
      ctx.state.schemaVersion = 5;
      ctx.state.run.discoveredSpellIds ??= ["resurrect"];
      for (const p of Object.values(ctx.state.players)) p.selectedElements ??= [];
      for (const encounter of ctx.state.run.stage?.encounters ?? []) {
        encounter.waves ??= [encounter.monsterIds];
        encounter.totalWaves ??= encounter.waves.length;
        encounter.currentWave ??= encounter.status === "dormant" ? 0 : encounter.totalWaves;
        encounter.nextWaveAt ??= null;
        encounter.scaledForPlayers ??= encounter.status === "dormant" ? null : Math.max(1, onlineLivingPlayers(ctx.state.players).length);
      }
    },
    join(ctx, joined) {
      ctx.state.hostId ??= joined.id;
      const existing = ctx.state.players[joined.id];
      if (existing) {
        existing.connected = true;
        existing.selectedElements ??= [];
        return;
      }
      const index = Object.keys(ctx.state.players).length, joinedPlayer = player(joined.id, joined.name || `\u5DEB\u5E08 ${index + 1}`, index), stage = ctx.state.run.stage;
      if (ctx.state.phase === "running" && stage) {
        joinedPlayer.position = { x: stage.world.spawn.x + index * 54, y: stage.world.spawn.y };
        joinedPlayer.positionEpoch += 1;
      }
      ctx.state.players[joined.id] = joinedPlayer;
    },
    reconnect(ctx, joined) {
      if (ctx.state.players[joined.id]) ctx.state.players[joined.id].connected = true;
    },
    leave(ctx, leaving) {
      if (ctx.state.players[leaving.id]) ctx.state.players[leaving.id].connected = false;
      if (ctx.state.hostId === leaving.id) ctx.state.hostId = Object.values(ctx.state.players).find((p) => p.connected)?.id ?? null;
    }
  },
  actions: {
    "game.start": { sync: { mode: "hostAuthoritative" }, validate(ctx) {
      return ctx.actor.id === ctx.state.hostId ? accept(null) : reject("host-only");
    }, reduce(ctx) {
      const now = ctx.now(), stage = generateStage(ctx.state.seed, 0);
      ctx.state.phase = "running";
      ctx.state.startedAt = now;
      ctx.state.worldTime = now;
      ctx.state.run = { seed: ctx.state.seed, stageIndex: 0, stage, exploredRoomIds: ["room-0"], discoveredSpellIds: ["resurrect"], completedRewardIds: [], portal: null, startedAt: now, completedAt: null };
      ctx.state.entities = {};
      ctx.state.environment = { global: null, fields: [] };
      ctx.state.loot = {};
      ctx.state.merchant = stage.merchant;
      ctx.state.forge = stage.forge;
      ctx.state.forgeUses = {};
      ctx.state.seen = { hits: {}, spawns: {} };
      for (const [index, p] of Object.values(ctx.state.players).entries()) {
        p.position = { x: stage.world.spawn.x + index * 54, y: stage.world.spawn.y };
        p.positionEpoch += 1;
        p.alive = true;
        p.gold = 50;
        p.inventory = [];
        p.equipment = {};
        p.health.current = p.health.max;
        p.cast = idleCast();
        p.aim = { x: 1, y: 0 };
        p.selectedElements = [];
        p.statuses = {};
        p.buildup = {};
        p.buffs = [];
        p.shields = [];
        delete p.forceVelocity;
        p.scrollCooldowns = {};
      }
      ctx.state.message = "\u9057\u8FF9\u8FDC\u5F81 \xB7 \u7B2C\u4E00\u5173";
    } },
    "game.finish": { sync: { mode: "hostAuthoritative" }, validate(ctx) {
      return ctx.actor.id === ctx.state.hostId ? accept(null) : reject("host-only");
    }, reduce(ctx) {
      ctx.state.phase = "gameover";
      ctx.state.message = "\u8BD5\u70BC\u7ED3\u675F";
    } },
    "player.pose": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id], stage = ctx.state.run.stage, selected = payload2.selectedElements ?? [];
      if (!stage || !p?.alive || !Number.isInteger(payload2.sequence) || payload2.sequence <= p.lastPoseSequence || !Number.isFinite(payload2.sentAt) || !finiteVec(payload2.position) || !finiteVec(payload2.aim) || !Array.isArray(selected) || selected.length > 4 || !selected.every((element) => ELEMENTS.includes(element))) return reject("invalid-pose");
      const dt = Math.max(0.064, Math.min(1, (payload2.sentAt - ctx.state.worldTime) / 1e3)), maxDistance = 420 * dt + 45, dx = payload2.position.x - p.position.x, dy = payload2.position.y - p.position.y, distance2 = Math.hypot(dx, dy), limited = distance2 > maxDistance ? { x: p.position.x + dx / distance2 * maxDistance, y: p.position.y + dy / distance2 * maxDistance } : payload2.position;
      return accept({ ...payload2, selectedElements: [...selected], sentAt: Math.max(ctx.now() - 5e3, Math.min(ctx.now() + 1e3, payload2.sentAt)), position: clampPosition(ctx.state, limited, p.position, p.id), aim: normalize(payload2.aim) });
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p?.alive || payload2.sequence <= p.lastPoseSequence) return;
      p.lastPoseSequence = payload2.sequence;
      p.position = payload2.position;
      p.aim = payload2.aim;
      p.selectedElements = [...payload2.selectedElements ?? []];
      const room = ctx.state.run.stage && roomAt(ctx.state.run.stage, p.position);
      if (room && !ctx.state.run.exploredRoomIds.includes(room.id)) ctx.state.run.exploredRoomIds.push(room.id);
      if (p.cast.phase === "active" && p.cast.spell?.channelled) {
        p.cast.aim = payload2.aim;
        for (const entity of Object.values(ctx.state.entities)) if (entity.ownerId === p.id && !entity.detached) {
          entity.position = { ...p.position };
          if (entity.source?.spell.delivery === "beam") entity.targetDirection = payload2.aim;
          else entity.direction = payload2.aim;
        }
      }
      ctx.emit("endwell.player_pose", { playerId: p.id, ...payload2, selectedElements: [...payload2.selectedElements ?? []] });
    } },
    "cast.request": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (ctx.state.phase !== "running" || !p?.alive || p.cast.phase !== "idle" || !Number.isInteger(payload2.sequence) || payload2.sequence <= p.lastCastSequence || payload2.castId !== `${ctx.actor.id}:cast:${payload2.sequence}` || !Array.isArray(payload2.elements) || payload2.elements.length < 1 || payload2.elements.length > 4 || !payload2.elements.every((element) => ELEMENTS.includes(element)) || !finiteVec(payload2.aim) || !finiteVec(payload2.target)) return reject("invalid-cast");
      const spell = applyEquipmentToSpell(resolveCastSpell(p, payload2.elements, ctx.now()), p.equipment);
      return accept({ ...payload2, aim: normalize(payload2.aim), target: spellTargetMode(spell) === "self" ? { ...p.position } : clampTarget(ctx.state, p.position, payload2.target, spell.range) });
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p || payload2.sequence <= p.lastCastSequence || p.cast.phase !== "idle") return;
      const scroll = ownedReadyScrollFor(payload2.elements, p, ctx.now());
      const baseSpell = scroll ? scroll.definition.spec(payload2.elements) : resolveSpell(payload2.elements);
      const spell = applySpellModifiers(applyEquipmentToSpell(baseSpell, p.equipment), p.buffs.flatMap((buff) => buff.modifiers));
      if (scroll) p.scrollCooldowns[scroll.definition.id] = ctx.now() + scroll.definition.cooldownMs;
      p.lastCastSequence = payload2.sequence;
      beginCast(p, payload2.castId, spell, normalize(payload2.aim), payload2.target, ctx.now());
      ctx.emit("endwell.cast_started", { type: "cast_started", casterId: p.id, spellId: spell.id });
      if (ctx.role === "authority") ctx.timers.dispatch(`cast:${payload2.castId}:activate`, spell.chantMs, "internal.castActivate", { playerId: p.id, castId: payload2.castId }, p.id);
    } },
    "cast.aim": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && finiteVec(payload2.aim) && Number.isInteger(payload2.sequence) ? accept({ ...payload2, aim: normalize(payload2.aim) }) : reject("invalid-aim");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p?.alive) return;
      p.aim = payload2.aim;
      if (p.cast.phase === "chanting" || p.cast.phase === "active") p.cast.aim = payload2.aim;
      if (p.cast.phase === "active") {
        for (const entity of Object.values(ctx.state.entities)) if (entity.ownerId === p.id && !entity.detached) {
          entity.position = { ...p.position };
          if (entity.source?.spell.delivery === "beam") entity.targetDirection = payload2.aim;
          else entity.direction = payload2.aim;
        }
      }
    } },
    "cast.release": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      return p?.alive && p.cast.castId === payload2.castId ? accept(payload2) : reject("cast-mismatch");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p?.alive || p.cast.castId !== payload2.castId || !p.cast.spell?.channelled) return;
      removeOwnedActiveEntities(ctx.state, p.id);
      const early = p.cast.phase === "chanting";
      if (early) ctx.emit("endwell.cast_interrupted", { type: "cast_interrupted", casterId: p.id, reason: "cancelled" });
      recovery(ctx, p, payload2.castId, p.cast.spell);
    } },
    "cast.activate": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p?.alive || p.cast.castId !== payload2.castId || p.cast.phase !== "chanting") return reject("cast-mismatch");
      if (p.cast.phaseEndsAt != null && ctx.now() + 80 < p.cast.phaseEndsAt) return reject("chanting");
      return accept(payload2);
    }, reduce(ctx, payload2) {
      activatePlayerCast(ctx, ctx.actor.id, payload2.castId);
    } },
    "internal.castActivate": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload2) {
      activatePlayerCast(ctx, payload2.playerId, payload2.castId);
    } },
    "internal.areaImpact": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload2) {
      const p = ctx.state.players[payload2.playerId], spell = p?.cast.spell;
      if (!p?.alive || !spell || p.cast.castId !== payload2.castId || spell.delivery !== "area") return;
      delete ctx.state.entities[`${payload2.castId}:warning:0`];
      const impact = spawnMeteorImpact(ctx.state, p, spell, ctx.now());
      ctx.emit("endwell.entity_spawned", { type: "entity_spawned", entityId: impact.id });
      recovery(ctx, p, payload2.castId, spell);
    } },
    "internal.castIdle": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload2) {
      const p = ctx.state.players[payload2.playerId];
      if (p?.cast.castId === payload2.castId) resetCast(p);
    } },
    "cast.interrupt": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload2) {
      const p = ctx.state.players[payload2.playerId];
      if (!p || p.cast.castId !== payload2.castId) return;
      removeOwnedActiveEntities(ctx.state, p.id);
      p.cast.phase = "interrupted";
      p.cast.phaseEndsAt = ctx.now() + 350;
      ctx.emit("endwell.cast_interrupted", { type: "cast_interrupted", casterId: p.id, reason: payload2.reason });
      if (ctx.role === "authority") ctx.timers.dispatch(`cast:${payload2.castId}:idle`, 350, "internal.castIdle", { playerId: p.id, castId: payload2.castId }, p.id);
    } },
    "combat.hit": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      const source = ctx.state.entities[payload2.sourceId], owner = source?.ownerId ? ctx.state.players[source.ownerId] : void 0;
      if (!source?.source || source.ownerId !== ctx.actor.id || !owner?.alive || !ctx.state.players[payload2.targetId] && !ctx.state.entities[payload2.targetId] || typeof payload2.hitId !== "string" || payload2.hitId.length > 160 || payload2.reason !== "hit" && payload2.reason !== "blocked" || ctx.state.seen.hits[payload2.hitId] || !verifiesHit(ctx.state, source, payload2.targetId, payload2.reason, ctx.now())) return reject("invalid-hit");
      return accept(payload2);
    }, reduce: resolveCombatHit },
    "combat.resolveHit": { sync: { mode: "hostAuthoritative" }, reduce: resolveCombatHit },
    "inventory.equip": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && itemPayload(payload2) ? accept(payload2) : reject("invalid-item");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p?.alive || playerInCombat(ctx.state, p.id)) return;
      const index = p.inventory.findIndex((item2) => item2.id === payload2.itemId), item = p.inventory[index];
      if (index < 0 || !isEquipment(item)) return;
      const old = p.equipment[item.slot];
      p.inventory.splice(index, 1);
      if (old) p.inventory.push(old);
      p.equipment[item.slot] = item;
    } },
    "inventory.unequip": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && itemPayload(payload2) ? accept(payload2) : reject("invalid-item");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p?.alive || playerInCombat(ctx.state, p.id)) return;
      const slot = ["staff", "robe", "ring"].find((key) => p.equipment[key]?.id === payload2.itemId);
      if (!slot) return;
      const item = p.equipment[slot];
      delete p.equipment[slot];
      if (p.inventory.length < 9) p.inventory.push(item);
      else drop(ctx.state, p, item, ctx.now(), "unequip");
    } },
    "inventory.drop": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && itemPayload(payload2) ? accept(payload2) : reject("invalid-item");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id];
      if (!p?.alive) return;
      const index = p.inventory.findIndex((item2) => item2.id === payload2.itemId), item = p.inventory[index];
      if (index < 0 || !item) return;
      p.inventory.splice(index, 1);
      drop(ctx.state, p, item, ctx.now(), "drop");
    } },
    "inventory.pickup": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && pickupPayload(payload2) ? accept(payload2) : reject("invalid-loot");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id], loot = ctx.state.loot[payload2.lootId];
      if (!p?.alive || !loot || p.inventory.length >= 9 || distance(p.position, loot.position) > 115 || loot.droppedByPlayerId && loot.droppedByPlayerId !== p.id && ctx.now() < loot.ownerPriorityUntil) return;
      delete ctx.state.loot[payload2.lootId];
      p.inventory.push(loot.item);
    } },
    "merchant.buy": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && merchantPayload(payload2) ? accept(payload2) : reject("invalid-merchant");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id], merchant = ctx.state.merchant;
      if (!p?.alive || !merchant || merchant.id !== payload2.merchantId || p.inventory.length >= 9 || distance(p.position, merchant.position) > merchant.radius + 90) return;
      const index = merchant.stock.findIndex((entry2) => entry2.item.id === payload2.itemId), entry = merchant.stock[index];
      if (index < 0 || !entry || p.gold < entry.price) return;
      p.gold -= entry.price;
      p.inventory.push(entry.item);
      merchant.stock.splice(index, 1);
    } },
    "merchant.sell": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && merchantPayload(payload2) ? accept(payload2) : reject("invalid-merchant");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id], merchant = ctx.state.merchant;
      if (!p?.alive || !merchant || merchant.id !== payload2.merchantId || distance(p.position, merchant.position) > merchant.radius + 90) return;
      const index = p.inventory.findIndex((item2) => item2.id === payload2.itemId), item = p.inventory[index];
      if (index < 0 || !item || !isEquipment(item) && !isScroll(item)) return;
      const price = sellPrice(item);
      if (price <= 0) return;
      p.inventory.splice(index, 1);
      p.gold += price;
    } },
    "forge.fuse": { sync: { mode: "hostRelay" }, validate(ctx, payload2) {
      return playerAlive(ctx) && forgePayload(payload2) ? accept({ ...payload2, itemIds: payload2.itemIds.slice(0, 3) }) : reject("invalid-forge");
    }, reduce(ctx, payload2) {
      const p = ctx.state.players[ctx.actor.id], forge = ctx.state.forge, ids = payload2.itemIds;
      if (!p?.alive || !forge || forge.id !== payload2.forgeId || ids.length !== 3 || new Set(ids).size !== 3 || distance(p.position, forge.position) > forge.radius + 90) return;
      const materials = ids.map((id) => p.inventory.find((item) => item.id === id));
      if (materials.some((item) => !item) || !canFuse(materials)) return;
      const uses = ctx.state.forgeUses[forge.id]?.[p.id] ?? 0, price = fusionPrice(uses), wasFull = p.inventory.length >= 9;
      if (p.gold < price) return;
      const result = fuseEquipment(materials, fusionSeed(ctx.state.run.stage?.stageSeed ?? ctx.state.seed, p.id, [...ids].sort(), uses));
      if (!result) return;
      p.gold -= price;
      p.inventory = p.inventory.filter((item) => !ids.includes(item.id));
      ctx.state.forgeUses[forge.id] ??= {};
      ctx.state.forgeUses[forge.id][p.id] = uses + 1;
      if (!wasFull && p.inventory.length < 9) p.inventory.push(result);
      else drop(ctx.state, p, result, ctx.now(), "fusion");
    } },
    "internal.environmentTick": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload2) {
      const environment = ctx.state.environment.global;
      if (!environment || environment.id !== payload2.environmentId) return;
      applyEnvironment(ctx.state, ctx.now(), environment.ownerId);
      environment.nextTickAt = ctx.now() + environment.tickInterval;
    } },
    "internal.environmentExpire": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload2) {
      if (ctx.state.environment.global?.id === payload2.environmentId) ctx.state.environment.global = null;
    } },
    "entity.expire": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload2) {
      const entity = ctx.state.entities[payload2.entityId];
      if (!entity) return;
      delete ctx.state.entities[payload2.entityId];
      ctx.state.environment.fields = ctx.state.environment.fields.filter((id) => id !== payload2.entityId);
      ctx.emit("endwell.entity_destroyed", { type: "entity_destroyed", entityId: payload2.entityId, kind: entity.kind, reason: "expired" });
    } }
  },
  systems: [{ runOn: "authority", intervalMs: 100, update(ctx, dt = 0.1) {
    const now = ctx.now(), step = Math.min(0.2, Math.max(1e-3, dt));
    ctx.state.worldTime = now;
    updateAttachedDirections(ctx.state, step);
    for (const target of Object.values(ctx.state.players).filter((p) => p.alive)) integrateForceMotion(ctx.state, target, step);
    for (const entity of Object.values(ctx.state.entities).filter((e) => e.kind === "monster")) integrateForceMotion(ctx.state, entity, step);
    for (const [id, entity] of Object.entries(ctx.state.entities)) if (entity.expiresAt != null && entity.expiresAt <= now) ctx.dispatch("entity.expire", { entityId: id }, ctx.host.id);
    const environment = ctx.state.environment.global;
    if (environment && environment.endsAt <= now) ctx.dispatch("internal.environmentExpire", { environmentId: environment.id }, ctx.host.id);
    else if (environment && environment.nextTickAt <= now) ctx.dispatch("internal.environmentTick", { environmentId: environment.id }, ctx.host.id);
    for (const target of [...Object.values(ctx.state.players), ...Object.values(ctx.state.entities)]) for (const [key, instance] of Object.entries(target.statuses)) if (instance && instance.endsAt <= now) delete target.statuses[key];
    if (ctx.state.phase === "running") {
      updateEncounters(ctx.state, now);
      updateBoss(ctx.state, now);
      updateMonsterCasts(ctx.state, now);
      updateMonsterAi(ctx.state, now, step);
      updateMonsterHitSources(ctx, now);
      updateTerrain(ctx.state, now);
      advancePortal(ctx.state, now);
      if (onlineLivingPlayers(ctx.state.players).length === 0 && Object.values(ctx.state.players).some((player2) => player2.connected)) {
        ctx.state.phase = "gameover";
        ctx.state.message = "\u8FDC\u5F81\u5931\u8D25";
      }
    }
  } }]
});

// src/worker/index.ts
var index_default = createFlowRoom(endwellGame);
export default index_default;

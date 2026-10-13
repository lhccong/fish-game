// ../../packages/flow/src/worker.ts
import { defineRoom } from "@parti/worker-sdk";

// ../../packages/flow/src/parti.ts
var PARTI_FLOW_ACTION_EVENT = "partiflow:action";
var PARTI_FLOW_REJECT_EVENT = "partiflow:reject";
var PARTI_FLOW_PAYLOAD = "__partiflow";

// ../../packages/flow/src/worker.ts
var asPlayer = (player) => player;
function createFlowRoom(game) {
  let sequence = 0;
  const makeAction = (type, payload, actor, id) => {
    const seq = ++sequence;
    return { id: id ?? `${actor.id}:authority:${seq}`, type, payload, from: actor.id, seq, origin: "host", createdAt: Date.now() };
  };
  const execute = (room, action, actor, validate = true) => {
    const definition = game.actions[action.type];
    if (!definition) return false;
    if (definition.sync.mode === "localOnly") {
      room.send(actor.id, PARTI_FLOW_REJECT_EVENT, { actionId: action.id, reason: "local-only" });
      return false;
    }
    const context = makeContext(room, actor);
    let payload = action.payload;
    if (validate && definition.validate) {
      const result = definition.validate(context, payload);
      if (!result.ok) {
        room.send(actor.id, PARTI_FLOW_REJECT_EVENT, { actionId: action.id, reason: result.reason });
        return false;
      }
      payload = result.payload;
    }
    const authoritative = { ...action, payload, origin: "host", createdAt: room.now() };
    if (definition.sync.mode !== "optimisticBroadcast") definition.reduce(context, payload, authoritative);
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
    timers: { dispatch(name, delay, type, payload, actorId) {
      room.setTimer(name, delay, () => {
        const timerActor = room.players.find((p) => p.id === actorId) ?? room.host;
        execute(room, makeAction(type, payload ?? null, asPlayer(timerActor)), asPlayer(timerActor), false);
      });
    }, clear: room.clearTimer },
    emit() {
    },
    dispatch(type, payload, actorId) {
      const nestedActor = room.players.find((p) => p.id === actorId) ?? room.host;
      execute(room, makeAction(type, payload ?? null, asPlayer(nestedActor)), asPlayer(nestedActor), false);
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
    onJoin(room, player) {
      game.lifecycle?.join?.(makeContext(room, asPlayer(player)), asPlayer(player));
    },
    onReconnect(room, player) {
      game.lifecycle?.reconnect?.(makeContext(room, asPlayer(player)), asPlayer(player));
    },
    onLeave(room, player) {
      game.lifecycle?.leave?.(makeContext(room, asPlayer(player)), asPlayer(player));
    },
    onReady(room, player) {
      game.lifecycle?.ready?.(makeContext(room, asPlayer(player)), asPlayer(player));
    },
    actions
  });
}

// ../../packages/flow/src/types.ts
var accept = (payload) => ({ ok: true, payload });
var reject = (reason) => ({ ok: false, reason });
function defineGame(definition) {
  return definition;
}

// src/game/contracts.ts
var SCHEMA_VERSION = 3;
var WORLD_WIDTH = 900;
var CHUNK_HEIGHT = 1600;
var PLAYER_RADIUS = 32;
var BOSS_INTERVAL = 12;
var BOSS_TRIGGER_OFFSET = 700;
var BOSS_ARENA_FLOOR_OFFSET = 120;
var BOSS_SPAWN_Y_MIN = 1580;
var BOSS_SPAWN_Y_MAX = 1620;

// src/game/registry.ts
var Registry = class {
  items = /* @__PURE__ */ new Map();
  register(item) {
    if (this.items.has(item.id)) throw new Error(`Duplicate strategy id: ${item.id}`);
    if (item.version != null && (!Number.isInteger(item.version) || item.version < 1)) throw new Error(`Invalid strategy version: ${item.id}`);
    this.items.set(item.id, item);
    return this;
  }
  require(id) {
    const item = this.items.get(id);
    if (!item) throw new Error(`Unknown strategy id: ${id}`);
    return item;
  }
  values() {
    return [...this.items.values()].sort((a, b) => a.id.localeCompare(b.id));
  }
};

// src/runtime/physics.ts
var GRAVITY = -1750;
var JUMP_SPEED = 1320;
var SPRING_JUMP_SPEED = 1850;
var MOVE_SPEED = 420;
var MAX_ROUTE_RISE = 400;
var FLIGHT_PROFILES = {
  rocket: { accelerationMs: 1e3, cruiseMs: 3500, unpoweredMs: 1e3, maxSpeed: 1050 },
  propeller: { accelerationMs: 1200, cruiseMs: 4100, unpoweredMs: 1200, maxSpeed: 760 }
};
function wrapX(x) {
  return (x % WORLD_WIDTH + WORLD_WIDTH) % WORLD_WIDTH;
}
function wrappedDistance(a, b) {
  const d = Math.abs(a - b);
  return Math.min(d, WORLD_WIDTH - d);
}
function canReachPlatform(from, to) {
  const rise = to.y - from.y;
  if (rise < 0 || rise > MAX_ROUTE_RISE) return false;
  const g = Math.abs(GRAVITY);
  const disc = JUMP_SPEED ** 2 - 2 * g * rise;
  if (disc < 0) return false;
  const time = (JUMP_SPEED + Math.sqrt(disc)) / g;
  return wrappedDistance(from.x, to.x) <= MOVE_SPEED * time + from.width / 2 + to.width / 2 + PLAYER_RADIUS * 0.45;
}

// src/content/index.ts
var colors = { normal: "#68d8d6", moving: "#59c3ff", fragile: "#d5b895", recovering: "#c57bff", spikes: "#ff5577", trigger: "#46e0b3", bridge: "#46e0b3", spring: "#ffe16a", "boss-exit": "#ffd35a" };
var none = () => ({ effects: [] });
var biomes = new Registry();
biomes.register({ id: "aurora", name: "\u6781\u5149\u5C42", background: "#101c3d", platform: "#68d8d6", accent: "#b9f5ff", content: { environment: "calm", platforms: [{ id: "moving", weight: 4 }, { id: "recovering", weight: 3 }, { id: "fragile", weight: 1 }, { id: "spikes", weight: 1 }, { id: "trigger", weight: 2 }, { id: "spring", weight: 2 }], enemies: [{ id: "sentry", weight: 3 }, { id: "patroller", weight: 3 }, { id: "charger", weight: 1 }], pickups: pickupPool(), bosses: [{ id: "mechanical-core", weight: 5 }, { id: "sky-behemoth", weight: 2 }, { id: "storm-warden", weight: 1 }] } });
biomes.register({ id: "garden", name: "\u6D6E\u7A7A\u82B1\u56ED", background: "#102f2a", platform: "#80d86b", accent: "#e3ff8b", content: { environment: "updraft", platforms: [{ id: "spring", weight: 4 }, { id: "trigger", weight: 3 }, { id: "moving", weight: 2 }, { id: "recovering", weight: 2 }, { id: "fragile", weight: 1 }, { id: "spikes", weight: 1 }], enemies: [{ id: "floater", weight: 4 }, { id: "occupier", weight: 3 }, { id: "patroller", weight: 1 }], pickups: pickupPool(), bosses: [{ id: "sky-behemoth", weight: 5 }, { id: "mechanical-core", weight: 2 }, { id: "storm-warden", weight: 1 }] } });
biomes.register({ id: "storm", name: "\u96F7\u66B4\u5C42", background: "#24183f", platform: "#b18cff", accent: "#ffe66d", content: { environment: "storm", platforms: [{ id: "spikes", weight: 4 }, { id: "fragile", weight: 3 }, { id: "moving", weight: 2 }, { id: "recovering", weight: 1 }, { id: "trigger", weight: 1 }, { id: "spring", weight: 1 }], enemies: [{ id: "sentry", weight: 4 }, { id: "charger", weight: 3 }, { id: "floater", weight: 2 }], pickups: pickupPool(), bosses: [{ id: "storm-warden", weight: 5 }, { id: "sky-behemoth", weight: 2 }, { id: "mechanical-core", weight: 1 }] } });
function pickupPool() {
  return [["shield", 2], ["rapid", 3], ["power", 2], ["spread", 1], ["pierce", 1], ["rocket", 1], ["propeller", 2], ["super-jump", 2], ["slow-fall", 2]].map(([id, weight]) => ({ id, weight }));
}
function runtimeEffect(entityId, state) {
  return { kind: "entity-state", entityId, state };
}
function basePlatform(id, safe, weight, generate = (p) => ({ ...p, kind: id }), contact = () => ({ bounceVelocity: JUMP_SPEED, effects: [] })) {
  return { id, version: 2, safe, weight, generate: (p, c, i) => generate({ ...p, kind: id }, c, i), contact, transition: (p, c, state) => transitionPlatform(p, c, state), render: (p, c, state) => renderPlatform(p, c, state) };
}
var platformStrategies = new Registry();
platformStrategies.register(basePlatform("normal", true, 5));
platformStrategies.register(basePlatform("moving", false, 2, (p, c, i) => {
  const r = c.rng(`moving:${i}`);
  const axis = r.pick(["x", "y", "path"]);
  return { ...p, config: { movement: { axis, range: r.int(60, 135), periodMs: r.int(2200, 4e3), phase: r.float(), delayMs: r.int(0, 1200), pauseMs: r.int(0, 500), path: axis === "path" ? [{ x: p.x, y: p.y }, { x: wrapX(p.x + r.int(-130, 130)), y: p.y + r.int(-50, 90) }] : void 0 } } };
}));
platformStrategies.register(basePlatform("fragile", false, 1.4, (p) => ({ ...p, config: { breakDelayMs: 700 } }), (p, c, state) => state?.kind === "platform" && state.phase !== "active" ? none() : { effects: [runtimeEffect(p.id, { kind: "platform", phase: "breaking", changedAt: c.now, until: c.now + 700 })] }));
platformStrategies.register(basePlatform("recovering", false, 1.5, (p, c, i) => {
  const r = c.rng(`recover:${i}`);
  return { ...p, config: { breakDelayMs: 320, warningMs: 320, recoverMs: r.int(2800, 4200) } };
}, (p, c, state) => state?.kind === "platform" && state.phase !== "active" ? none() : { bounceVelocity: JUMP_SPEED, effects: [runtimeEffect(p.id, { kind: "platform", phase: "warning", changedAt: c.now, until: c.now + 320 })] }));
platformStrategies.register(basePlatform("spikes", false, 1.1, (p, c, i) => {
  const r = c.rng(`spike:${i}`);
  return { ...p, config: { spike: { start: r.float() * 0.35, end: 0.65 + r.float() * 0.35, periodMs: r.int(2600, 4200), warningMs: 500, activeMs: 1100, phase: r.float() } } };
}, (p, c) => spikeActive(p, c) ? { damageReason: "\u5C16\u523A", effects: [] } : { bounceVelocity: JUMP_SPEED, effects: [] }));
platformStrategies.register(basePlatform("trigger", false, 0.8, (p, c, i) => {
  const r = c.rng(`trigger:${i}`);
  const outputCount = r.int(1, 3);
  return { ...p, config: { trigger: { mode: r.pick(["permanent", "timed", "sequence"]), durationMs: r.int(6500, 1e4), requiredHits: r.int(2, 3), resetMs: 4e3, outputs: Array.from({ length: outputCount }, (_, n) => `${p.id}:output:${n}`) } } };
}, (p, c, state) => {
  const cfg = p.config.trigger;
  const previous = state?.kind === "trigger" && (state.until == null || state.until > c.now) ? state.count : 0;
  const count = Math.min(cfg.requiredHits, previous + 1);
  const active = cfg.mode !== "sequence" || count >= cfg.requiredHits;
  const until = cfg.mode === "permanent" && active ? null : c.now + (active ? cfg.durationMs : cfg.resetMs);
  return { bounceVelocity: JUMP_SPEED, effects: [runtimeEffect(p.id, { kind: "trigger", count, activatedAt: active ? c.now : 0, until }), ...cfg.outputs.map((id) => runtimeEffect(id, { kind: "platform", phase: active ? "active" : "hidden", changedAt: c.now, until }))] };
}));
platformStrategies.register(basePlatform("bridge", false, 0));
platformStrategies.register(basePlatform("spring", false, 1.2, (p) => ({ ...p, config: { spring: { start: 0.28, end: 0.72, velocity: SPRING_JUMP_SPEED } } }), (p) => ({ bounceVelocity: p.config?.spring?.velocity ?? SPRING_JUMP_SPEED, effects: [] })));
platformStrategies.register(basePlatform("boss-exit", false, 0));
function transitionPlatform(p, c, state) {
  if (p.kind === "fragile" && state?.kind === "platform") return state.phase === "breaking" && c.now >= (state.until ?? 0) ? { ...state, phase: "hidden", until: null } : state;
  if (state?.kind !== "platform" || state.phase === "active") return state ?? null;
  const breakDelay = p.config?.breakDelayMs ?? 0, recover = p.config?.recoverMs ?? 0, restoreWarning = p.config?.warningMs ?? 500, elapsed = c.now - state.changedAt;
  if (elapsed < breakDelay) return { ...state, phase: "warning", until: state.changedAt + breakDelay };
  if (!recover) return { ...state, phase: "hidden", until: null };
  if (elapsed < breakDelay + recover) return { ...state, phase: "hidden", until: state.changedAt + breakDelay + recover };
  if (elapsed < breakDelay + recover + restoreWarning) return { ...state, phase: "restoring", until: state.changedAt + breakDelay + recover + restoreWarning };
  return { ...state, phase: "active", until: null };
}
function spikeActive(p, c) {
  const s = p.config?.spike;
  if (!s) return false;
  const t = ((c.now - c.startedAt + s.phase * s.periodMs) % s.periodMs + s.periodMs) % s.periodMs;
  return t >= s.warningMs && t < s.warningMs + s.activeMs;
}
function renderPlatform(p, c, state) {
  const phase = state?.kind === "platform" ? state.phase : "active";
  const warning = phase === "warning" || phase === "restoring" || p.kind === "spikes" && !spikeActive(p, c);
  return { color: colors[p.kind], label: p.kind, warning, hidden: phase === "hidden", breaking: phase === "breaking", changedAt: state?.kind === "platform" ? state.changedAt : void 0, spikeRange: p.config?.spike ? [p.config.spike.start, p.config.spike.end] : void 0 };
}
var attacks = {
  shot: { id: "shot", kind: "shot", warningMs: 700, activeMs: 700, cooldownMs: 2800, radius: 36 },
  charge: { id: "charge", kind: "charge", warningMs: 700, activeMs: 500, cooldownMs: 3400, radius: 70 }
};
function enemy(id, weight, hp, stompable, controller, attackList = [], boss2 = false) {
  return {
    id,
    version: 2,
    weight,
    boss: boss2,
    create(c, i, anchor) {
      const r = c.rng(`enemy:${id}:${i}`), strength = c.difficultyAxes.enemyStrength;
      return { id: `${c.chunkIndex}:enemy:${id}:${i}`, kind: id, x: anchor?.x ?? (boss2 ? WORLD_WIDTH / 2 : r.int(90, 810)), y: (anchor?.y ?? c.chunkIndex * CHUNK_HEIGHT + (boss2 ? r.int(BOSS_SPAWN_Y_MIN, BOSS_SPAWN_Y_MAX) : r.int(260, 1380))) + (anchor ? 54 : 0), hp: Math.ceil(hp * (1 + strength * 0.9)), radius: boss2 ? 105 : 34, boss: boss2, stompable, controller: tuneController(controller, r.float(), anchor), attacks: attackList, drops: [{ pickup: "shield", weight: 1 }, { pickup: "rapid", weight: 2 }], anchorId: anchor?.id };
    },
    position(e, c) {
      return enemyPosition(e, c);
    },
    contact(e) {
      return e.stompable ? { effects: [] } : { damageReason: "\u4E0D\u53EF\u8E29\u8E0F\u602A\u7269", effects: [] };
    },
    hit(e, damage) {
      return [{ kind: "damage", targetId: e.id, amount: damage }];
    },
    attack(e, _context, sequence) {
      return e.attacks.length ? e.attacks[sequence % e.attacks.length] : null;
    },
    death(e, c) {
      const r = c.rng(`drop:${e.id}`);
      return r.float() < 0.35 ? [{ kind: "message", text: "\u602A\u7269\u6389\u843D\u5956\u52B1" }] : [];
    }
  };
}
function tuneController(c, phase, anchor) {
  if (c.kind === "stationary") return c;
  if (c.kind === "occupy") return { ...c, platformId: anchor?.id ?? c.platformId, phase };
  return { ...c, phase };
}
function smoothstep(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}
function chargeWave(cycle) {
  if (cycle < 0.18) return -1;
  if (cycle < 0.43) return -1 + smoothstep((cycle - 0.18) / 0.25) * 2;
  if (cycle < 0.61) return 1;
  return 1 - smoothstep((cycle - 0.61) / 0.39) * 2;
}
function enemyPosition(e, c) {
  const control = e.controller;
  if (control.kind === "stationary" || control.kind === "occupy") return { x: e.x, y: e.y };
  const elapsedCycles = (c.now - c.startedAt) / control.periodMs + control.phase;
  if (control.kind === "float" && control.axis === "y") return { x: e.x, y: e.y + Math.sin(elapsedCycles * Math.PI * 2) * control.range };
  const center = Math.max(e.radius, Math.min(WORLD_WIDTH - e.radius, e.x));
  const range = Math.max(0, Math.min(control.range, center - e.radius, WORLD_WIDTH - e.radius - center));
  const wave = control.kind === "charge" ? chargeWave((elapsedCycles % 1 + 1) % 1) : Math.sin(elapsedCycles * Math.PI * 2);
  return { x: center + wave * range, y: e.y };
}
var enemyStrategies = new Registry();
enemyStrategies.register(enemy("sentry", 3, 1, true, { kind: "stationary" }, [attacks.shot]));
enemyStrategies.register(enemy("floater", 2, 1, true, { kind: "float", axis: "y", range: 70, periodMs: 3e3, phase: 0 }, [attacks.shot]));
enemyStrategies.register(enemy("patroller", 2, 2, true, { kind: "patrol", axis: "x", range: 130, periodMs: 3200, phase: 0 }));
enemyStrategies.register(enemy("charger", 1.5, 2, false, { kind: "charge", range: 180, periodMs: 3800, warningMs: 700, phase: 0 }, [attacks.charge]));
enemyStrategies.register(enemy("occupier", 1.5, 2, true, { kind: "occupy", platformId: "", periodMs: 4e3, openMs: 1600, phase: 0 }));
var pickupStrategies = new Registry();
var PICKUP_PRESENTATION = { shield: { name: "\u62A4\u76FE", description: "\u62B5\u6D88\u4E00\u6B21\u4F24\u5BB3" }, rapid: { name: "\u5FEB\u901F\u5C04\u51FB", description: "\u5927\u5E45\u63D0\u5347\u5C04\u901F" }, power: { name: "\u5F3A\u529B", description: "\u5B50\u5F39\u4F24\u5BB3\u63D0\u5347" }, spread: { name: "\u6563\u5C04", description: "\u540C\u65F6\u53D1\u5C04\u4E09\u679A\u5B50\u5F39" }, pierce: { name: "\u7A7F\u900F", description: "\u5B50\u5F39\u53EF\u8D2F\u7A7F\u654C\u4EBA" }, rocket: { name: "\u706B\u7BAD", description: "\u9AD8\u901F\u98DE\u884C\u5E76\u514D\u75AB\u4F24\u5BB3" }, propeller: { name: "\u87BA\u65CB\u6868", description: "\u7A33\u5B9A\u98DE\u884C\u5E76\u514D\u75AB\u4F24\u5BB3" }, "super-jump": { name: "\u8D85\u7EA7\u8DF3\u8DC3", description: "\u5F3A\u5316\u6BCF\u6B21\u5F39\u8DF3" }, "slow-fall": { name: "\u7F13\u964D", description: "\u964D\u4F4E\u4E0B\u843D\u901F\u5EA6" } };
for (const [id, weight, durationMs] of [["shield", 1.2, 0], ["rapid", 1.4, 12e3], ["power", 1.2, 14e3], ["spread", 0.65, 1e4], ["pierce", 0.65, 1e4], ["rocket", 0.7, 5500], ["propeller", 0.9, 6500], ["super-jump", 1, 12e3], ["slow-fall", 1, 12e3]]) {
  pickupStrategies.register({ id, version: 3, weight, durationMs, create(c, i, anchor) {
    return { id: `${c.chunkIndex}:pickup:${id}:${i}`, kind: id, x: anchor.x, y: anchor.y + 70, durationMs };
  }, claim(p, c) {
    return [{ kind: "apply-effect", effect: effectFor(p.kind, p.id, p.durationMs, c.now) }];
  }, refresh(current, p, now) {
    return { ...current, startedAt: now, endsAt: p.kind === "shield" ? null : now + p.durationMs, stacks: 1, sourceId: p.id, phase: "starting", forcedEndingAt: void 0 };
  }, end(effect) {
    return effect.id === "rocket" || effect.id === "propeller" ? [{ kind: "message", text: "\u98DE\u884C\u7ED3\u675F\uFF0C\u6B63\u5728\u4E0B\u843D" }] : [];
  }, hud(effect, now) {
    const label = PICKUP_PRESENTATION[id].name;
    return effect.endsAt == null ? `${label} \xD71` : `${label} ${Math.max(0, Math.ceil((effect.endsAt - now) / 1e3))}s`;
  } });
}
function effectFor(id, sourceId, durationMs, now) {
  return { id, startedAt: now, endsAt: id === "shield" ? null : now + durationMs, stacks: 1, sourceId, phase: "starting" };
}
var bossPhases = (attacks2) => [{ id: "phase-1", minHpRatio: 0.6, warningScale: 1, cooldownScale: 1, attacks: attacks2 }, { id: "phase-2", minHpRatio: 0.3, warningScale: 0.82, cooldownScale: 0.88, attacks: attacks2 }, { id: "phase-3", minHpRatio: 0, warningScale: 0.65, cooldownScale: 0.76, attacks: attacks2 }];
function boss(id, attackKinds) {
  const base = enemy(id, 0, 32, false, { kind: "patrol", axis: "x", range: 250, periodMs: 4600, phase: 0 }, [], true);
  return { ...base, id, boss: true, phases: bossPhases(attackKinds), arenaPlatforms(c) {
    return bossArena(c);
  }, selectAttack(e, c, phase, sequence, target) {
    const picked = weightedKind(phase.attacks, c.rng(`boss-attack:${sequence}`).float());
    const warning = Math.round({ lightning: 1900, "lock-zone": 1500, "platform-hazard": 1500, summon: 1100, slam: 1400, "tilt-zone": 1500, laser: 1600, "platform-toggle": 1200 }[picked] * phase.warningScale);
    const active = picked === "lock-zone" ? 2600 : picked === "laser" ? 1500 : 800;
    const now = c.now;
    return { id: `${e.id}:attack:${sequence}`, kind: picked, x: target?.x ?? WORLD_WIDTH / 2, y: target?.y ?? c.chunkIndex * CHUNK_HEIGHT + 720, radius: picked === "lightning" ? 90 : 130, startedAt: now, activeAt: now + warning, endsAt: now + warning + active, direction: picked === "laser" ? c.rng(`laser:${sequence}`).pick(["up", "down", "left", "right"]) : void 0 };
  }, summons(_e, c, sequence) {
    return id === "storm-warden" ? [enemyStrategies.require("floater").create(c, 1e3 + sequence, null)] : [];
  }, victory(e) {
    return [{ kind: "message", text: `${e.kind} \u5DF2\u51FB\u8D25` }];
  } };
}
var stormWarden = boss("storm-warden", [{ id: "lightning", weight: 4 }, { id: "lock-zone", weight: 3 }, { id: "summon", weight: 2 }]);
var skyBehemoth = boss("sky-behemoth", [{ id: "slam", weight: 4 }, { id: "tilt-zone", weight: 3 }, { id: "platform-hazard", weight: 2 }]);
var mechanicalCore = boss("mechanical-core", [{ id: "laser", weight: 4 }, { id: "platform-toggle", weight: 3 }, { id: "platform-hazard", weight: 2 }]);
mechanicalCore.phases[1].weak = true;
enemyStrategies.register(stormWarden);
enemyStrategies.register(skyBehemoth);
enemyStrategies.register(mechanicalCore);
var bossStrategies = new Registry();
bossStrategies.register(stormWarden);
bossStrategies.register(skyBehemoth);
bossStrategies.register(mechanicalCore);
function bossArena(c) {
  const base = c.chunkIndex * CHUNK_HEIGHT;
  const r = c.rng("boss-arena");
  const middle = r.int(380, 520);
  const points = [[c.chunkIndex + ":boss:entry", middle, 120, 280, "normal"], [c.chunkIndex + ":boss:left", r.int(170, 280), 340, 190, "normal"], [c.chunkIndex + ":boss:right", r.int(620, 730), 520, 190, "normal"], [c.chunkIndex + ":boss:arena", middle, 710, 360, "normal"], [c.chunkIndex + ":boss:exit0", middle, 900, 220, "boss-exit"], [c.chunkIndex + ":boss:exit1", r.int(580, 700), 1090, 190, "boss-exit"], [c.chunkIndex + ":boss:exit2", r.int(260, 430), 1280, 190, "boss-exit"], [c.chunkIndex + ":boss:top", middle, 1530, 240, "boss-exit"]];
  return points.map(([id, x, y, width, kind]) => ({ id, kind, x, y: base + y, width, optional: false }));
}
function weightedKind(items, value) {
  const total = items.reduce((n, i) => n + i.weight, 0);
  let cursor = value * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item.id;
  }
  return items.at(-1).id;
}
function weightedFromPool(items, value) {
  return weightedKind(items, value);
}
var encounterStrategies = new Registry();
encounterStrategies.register({ id: "mixed", version: 1, populate(context, route, optional) {
  const enemies = [], pickups = [];
  const r = context.rng("encounter");
  const safe = optional.filter((a) => route.every((p) => Math.abs(a.y - p.y) > 250 || Math.abs(a.x - p.x) > p.width / 2 + a.width / 2 + 90));
  const count = Math.min(safe.length, Math.round(context.difficultyAxes.enemyDensity * 3));
  for (let i = 0; i < count; i += 1) {
    const id = weightedFromPool(context.biome.content.enemies, context.rng(`enemy-kind:${i}`).float());
    enemies.push(enemyStrategies.require(id).create(context, i, safe[i]));
  }
  if (r.float() < 0.72) {
    const id = weightedFromPool(context.biome.content.pickups, context.rng("pickup-kind").float());
    pickups.push(pickupStrategies.require(id).create(context, 0, optional[0] ?? route[Math.floor(route.length / 2)]));
  }
  return { enemies, pickups };
} });
function biomeForChunk(index) {
  return biomes.values()[Math.floor(index / 10) % biomes.values().length];
}
function bossForContext(c) {
  return bossStrategies.require(weightedFromPool(c.biome.content.bosses, c.rng("boss-kind").float()));
}

// src/game/random.ts
function hashText(text2) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < text2.length; i += 1) {
    hash ^= text2.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
function scopedSeed(seed, chunk, channel) {
  return hashText(`${seed >>> 0}:${chunk}:${channel}`);
}
function createRandom(seed) {
  let value = seed >>> 0;
  const float = () => {
    value += 1831565813;
    let n = value;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
  return { float, int(min, max) {
    return Math.floor(float() * (max - min + 1)) + min;
  }, pick(items) {
    return items[Math.floor(float() * items.length)];
  } };
}

// src/game/generation.ts
function difficultyFor(index) {
  return Math.min(10, Math.floor(index / 3));
}
function difficultyAxesFor(index) {
  return { sparsity: Math.min(1, index / 45), hazardRate: Math.min(0.75, 0.12 + index * 0.012), enemyDensity: Math.min(1, 0.18 + index * 0.022), enemyStrength: Math.min(1, index / 55), bossLevel: Math.min(5, 1 + Math.floor(index / 20)) };
}
function boundaryX(seed, boundary) {
  return boundary === 0 ? WORLD_WIDTH / 2 : createRandom(scopedSeed(seed, boundary, "boundary")).int(130, WORLD_WIDTH - 130);
}
function isBossChunk(index) {
  return index > 0 && (index + 1) % BOSS_INTERVAL === 0;
}
function bossOrdinalForChunk(index) {
  return Math.floor((index + 1) / BOSS_INTERVAL);
}
function contextFor(seed, chunkIndex, players) {
  return { seed, chunkIndex, players, difficulty: difficultyFor(chunkIndex), difficultyAxes: difficultyAxesFor(chunkIndex), biome: biomeForChunk(chunkIndex), rng(channel) {
    return createRandom(scopedSeed(seed, chunkIndex, channel));
  } };
}
function runtimeContext(context, startedAt, now) {
  return { ...context, startedAt, now };
}
function recipeFor(context) {
  if (isBossChunk(context.chunkIndex)) return "boss";
  if ((context.chunkIndex + 2) % BOSS_INTERVAL === 0) return "boss-buffer";
  const r = context.rng("recipe").float();
  return r < 0.14 ? "reward" : r < 0.31 ? "danger" : r < 0.45 ? "mechanism" : "normal";
}
function platform(id, x, y, width, optional = false) {
  return { id, kind: "normal", x: wrapX(x), y, width, optional };
}
function occupationBox(platform2) {
  let halfW = platform2.width / 2;
  let y1 = platform2.y, y2 = platform2.y;
  const m = platform2.config?.movement;
  if (m) {
    if (m.axis === "x") halfW += m.range;
    else if (m.axis === "y") {
      y1 -= m.range;
      y2 += m.range;
    } else if (m.axis === "path" && m.path?.length === 2) {
      const dx = m.path[1].x - m.path[0].x, dy = m.path[1].y - m.path[0].y;
      halfW += Math.abs(dx) / 2;
      y1 = Math.min(y1, platform2.y + dy);
      y2 = Math.max(y2, platform2.y + dy);
    }
  }
  return { cx: platform2.x, halfW, y1, y2 };
}
function occupationOverlaps(a, b) {
  return wrappedDistance(a.cx, b.cx) < a.halfW + b.halfW + 40 && Math.abs((a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2) < 80;
}
function graphRoute(layers) {
  const parents = /* @__PURE__ */ new Map();
  let reachable = /* @__PURE__ */ new Set([layers[0][0].id]);
  for (let layer = 1; layer < layers.length; layer += 1) {
    const next = /* @__PURE__ */ new Set();
    for (const candidate of layers[layer]) {
      const parent = layers[layer - 1].find((item) => reachable.has(item.id) && canReachPlatform(item, candidate));
      if (parent) {
        parents.set(candidate.id, parent);
        next.add(candidate.id);
      }
    }
    reachable = next;
  }
  const exit = layers.at(-1)[0];
  if (!reachable.has(exit.id)) return null;
  const result = [exit];
  while (parents.has(result[0].id)) result.unshift(parents.get(result[0].id));
  return result;
}
function candidateCount(context, rng) {
  const maximum = Math.max(2, 4 - Math.floor(context.difficultyAxes.sparsity * 2));
  const minimum = context.difficultyAxes.sparsity > 0.75 ? 1 : 2;
  return rng.int(minimum, maximum);
}
function generatePlatformField(context, entryX, exitX, recipe) {
  const baseY = context.chunkIndex * CHUNK_HEIGHT, sparsity = context.difficultyAxes.sparsity;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const rng = context.rng(`field:${attempt}`), layerCount = sparsity > 0.72 ? 4 : 5, laneCount = candidateCount(context, rng);
    const entry = platform(`${context.chunkIndex}:field:entry`, entryX, baseY + 70, 220);
    const exit = platform(`${context.chunkIndex}:field:exit`, exitX, baseY + CHUNK_HEIGHT - 70, 220);
    const layers = [[entry]];
    for (let layer = 1; layer <= layerCount; layer += 1) {
      const progress = layer / (layerCount + 1), y = Math.round(baseY + 70 + progress * (CHUNK_HEIGHT - 140) + rng.int(-22, 22));
      const width = laneCount >= 4 ? rng.int(105, 115) : rng.int(125, 150), fan = 0.9 + Math.sin(progress * Math.PI) * 0.1, candidates = [];
      const verticalOrder = Array.from({ length: laneCount }, (_, node) => ({ node, key: rng.float() })).sort((a, b) => a.key - b.key);
      const verticalRank = new Map(verticalOrder.map((item, rank) => [item.node, rank]));
      for (let node = 0; node < laneCount; node += 1) {
        const laneX = 70 + (node + 0.5) * (WORLD_WIDTH - 140) / laneCount;
        const centerX = entryX * (1 - progress) + exitX * progress + (laneX - WORLD_WIDTH / 2) * fan;
        const jitter = laneCount >= 4 ? 8 : 20;
        const stagger = (verticalRank.get(node) - (laneCount - 1) / 2) * 56;
        candidates.push(platform(`${context.chunkIndex}:field:${layer}:${node}`, centerX + rng.int(-jitter, jitter), y + stagger + rng.int(-10, 10), width, true));
      }
      const previous = layers.at(-1);
      if (candidates.some((candidate, node) => !canReachPlatform(previous[Math.min(node, previous.length - 1)], candidate))) continue;
      layers.push(candidates);
    }
    if (layers.length !== layerCount + 1 || layers.at(-1).some((candidate) => !canReachPlatform(candidate, exit))) continue;
    layers.push([exit]);
    const route2 = graphRoute(layers);
    if (!route2) continue;
    const routeIds = new Set(route2.map((item) => item.id)), occupation = route2.map(occupationBox), optional = [];
    const platformPool = [{ id: "normal", weight: 4 }, { id: "fragile", weight: 10 }, ...context.biome.content.platforms];
    for (const base of layers.slice(1, -1).flat().filter((item) => !routeIds.has(item.id))) {
      const pool = recipe === "mechanism" ? platformPool.filter((item) => item.id === "trigger" || item.id === "spring") : platformPool;
      const kind = weightedFromPool(pool.length ? pool : platformPool, context.rng(`field-kind:${base.id}`).float());
      let candidate = platformStrategies.require(kind).generate({ ...base, optional: true, rewardMultiplier: recipe === "danger" ? 1.75 : 1 }, context, optional.length);
      const trigger = candidate.config?.trigger;
      const bridges = trigger ? trigger.outputs.map((id, bridgeIndex) => ({ id, kind: "bridge", x: wrapX(candidate.x + (bridgeIndex + 1) * 155), y: candidate.y + 105 + bridgeIndex * 55, width: 145, optional: true, rewardMultiplier: candidate.rewardMultiplier })) : [];
      const boxes = [occupationBox(candidate), ...bridges.map(occupationBox)];
      if (boxes.some((box) => occupation.some((existing) => occupationOverlaps(box, existing)))) {
        candidate = { ...base, kind: "normal", optional: true };
        const baseBox = occupationBox(candidate);
        if (!occupation.some((existing) => occupationOverlaps(baseBox, existing))) {
          optional.push(candidate);
          occupation.push(baseBox);
        }
      } else {
        optional.push(candidate, ...bridges);
        occupation.push(...boxes);
      }
    }
    return { route: route2.map((item) => ({ ...item, optional: false })), optional };
  }
  const route = [platform(`${context.chunkIndex}:field:fallback:0`, entryX, baseY + 70, 220)];
  for (let i = 1; i <= 5; i += 1) route.push(platform(`${context.chunkIndex}:field:fallback:${i}`, entryX + (exitX - entryX) * i / 6, baseY + 70 + i * (CHUNK_HEIGHT - 140) / 6, 220));
  route.push(platform(`${context.chunkIndex}:field:fallback:6`, exitX, baseY + CHUNK_HEIGHT - 70, 220));
  return { route, optional: [] };
}
function generateChunk(seed, index, players) {
  const context = contextFor(seed, index, players), recipe = recipeFor(context), entryX = boundaryX(seed, index), exitX = boundaryX(seed, index + 1);
  if (recipe === "boss") {
    const strategy = bossForContext(context), platforms = strategy.arenaPlatforms(context), boss2 = strategy.create(context, 0, null);
    return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, difficultyAxes: context.difficultyAxes, recipe, boss: true, entryX, exitX, route: platforms.map((p) => p.id), platforms, enemies: [boss2], pickups: [] };
  }
  const { route, optional } = generatePlatformField(context, entryX, exitX, recipe);
  const populated = recipe === "boss-buffer" ? { enemies: [], pickups: [] } : encounterStrategies.require("mixed").populate(context, route, optional);
  const encounter = { ...populated, enemies: index < 2 ? [] : populated.enemies, pickups: index === 0 ? [] : populated.pickups };
  return { index, biomeId: context.biome.id, baseY: index * CHUNK_HEIGHT, difficulty: context.difficulty, difficultyAxes: context.difficultyAxes, recipe, boss: false, entryX, exitX, route: route.map((p) => p.id), platforms: [...route, ...optional], ...encounter };
}
function findEntity(seed, players, id) {
  const index = Number(id.split(":")[0]);
  if (!Number.isInteger(index) || index < 0) return null;
  const chunk = generateChunk(seed, index, players);
  return chunk.platforms.find((x) => x.id === id) ?? chunk.enemies.find((x) => x.id === id) ?? chunk.pickups.find((x) => x.id === id) ?? null;
}

// src/game/boss.ts
function isBossDefeated(completedBossCount, chunkIndex) {
  return bossOrdinalForChunk(chunkIndex) <= completedBossCount;
}
function canStartBoss(state, chunkIndex) {
  return !state.boss && isBossChunk(chunkIndex) && !isBossDefeated(state.completedBossCount, chunkIndex);
}

// src/game/definition.ts
var RESPAWN_MS = 4e3;
var INVULNERABLE_MS = 2200;
var latestPoses = /* @__PURE__ */ new Map();
var ok = (payload) => accept(payload);
var skywardGame = defineGame({
  meta: { name: "\u4E91\u7AEF\u8FDC\u5F81 2", minPlayers: 1, maxPlayers: 4 },
  initialState,
  lifecycle: {
    create(ctx) {
      latestPoses.clear();
      ctx.state.hostId = ctx.host.id;
    },
    join(ctx, player) {
      ctx.state.hostId = ctx.host.id;
      if (ctx.state.phase !== "lobby" && !ctx.state.players[player.id]) {
        ctx.kick(player.id, "\u8FDC\u5F81\u5DF2\u7ECF\u5F00\u59CB");
        return;
      }
      const current = ctx.state.players[player.id];
      if (current) {
        current.connected = true;
        current.name = player.name;
      } else ctx.state.players[player.id] = createPlayer(player.id, player.name);
    },
    reconnect(ctx, player) {
      const current = ctx.state.players[player.id];
      if (current) {
        current.connected = true;
        current.name = player.name;
        latestPoses.set(player.id, poseFrom(current, ctx.now()));
      }
    },
    leave(ctx, player) {
      const current = ctx.state.players[player.id];
      if (!current) return;
      if (ctx.state.phase === "lobby") delete ctx.state.players[player.id];
      else {
        current.connected = false;
        current.direction = 0;
        updateVoid(ctx.state);
        checkWipe(ctx);
      }
    }
  },
  actions: {
    setReady: { sync: { mode: "hostAuthoritative" }, validate(ctx, payload) {
      return ctx.state.phase === "lobby" && ctx.state.players[ctx.actor.id] ? ok({ ready: Boolean(payload?.ready) }) : reject("not-in-lobby");
    }, reduce(ctx, payload) {
      const player = ctx.state.players[ctx.actor.id];
      player.ready = payload.ready;
      const all = Object.values(ctx.state.players);
      if (all.length && all.every((item) => item.ready && item.connected)) startRun(ctx);
    } },
    restart: { sync: { mode: "hostAuthoritative" }, validate(ctx) {
      return ctx.state.phase === "gameover" && ctx.actor.id === ctx.host.id ? ok(null) : reject("host-only");
    }, reduce(ctx) {
      resetLobby(ctx.state);
    } },
    publishPose: { sync: { mode: "hostRelay" }, validate(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), sequence = Number(payload?.sequence), x = Number(payload?.x), y = Number(payload?.y), vy = Number(payload?.vy), cameraBottom = Number(payload?.cameraBottom), direction = Number(payload?.direction), previous = latestPoses.get(ctx.actor.id);
      if (!player?.alive || !Number.isInteger(sequence) || ![x, y, vy, cameraBottom, direction].every(Number.isFinite) || previous && sequence <= previous.sequence) return reject("invalid-pose");
      const boundary = flightBoundary(ctx.state, player, ctx.now()), arenaFloor = bossArenaFloor(ctx.state);
      const limited = boundary != null && y >= boundary;
      return ok({ sequence, x: wrap(x), y: limited ? boundary : y, vy: limited ? 0 : vy, cameraBottom: arenaFloor ?? (limited ? Math.min(cameraBottom, boundary - 140) : cameraBottom), direction, forceFlightEnd: limited });
    }, reduce(ctx, payload) {
      const now = ctx.now(), player = activePlayer(ctx.state, ctx.actor.id);
      if (!player) return;
      if (payload.forceFlightEnd) forceFlightEnding(player, now);
      const packet = { playerId: ctx.actor.id, sequence: payload.sequence, x: payload.x, y: payload.y, vy: payload.vy, direction: payload.direction, sentAt: now };
      ctx.emit("skyward.pose", packet);
      const previous = latestPoses.get(ctx.actor.id), pose = { ...payload, persistedAt: previous?.persistedAt ?? 0 };
      latestPoses.set(ctx.actor.id, pose);
      if (now - pose.persistedAt >= 500) persistPose(ctx, player, pose, now);
    } },
    shoot: { sync: { mode: "optimisticBroadcast" }, validate(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), shotId = text(payload?.shotId, 96), x = Number(payload?.x), y = Number(payload?.y);
      if (!player?.alive || !shotId || !Number.isFinite(x) || !Number.isFinite(y)) return reject("invalid-shot");
      return ok({ shotId, x, y, damage: effectActive(player, "power", ctx.now()) ? 2 : 1, spread: effectActive(player, "spread", ctx.now()), pierce: effectActive(player, "pierce", ctx.now()) });
    }, reduce(ctx, payload) {
      const player = ctx.state.players[ctx.actor.id], damage = payload.damage ?? (player && effectActive(player, "power", ctx.now()) ? 2 : 1), spread = payload.spread ?? Boolean(player && effectActive(player, "spread", ctx.now())), pierce = payload.pierce ?? Boolean(player && effectActive(player, "pierce", ctx.now()));
      ctx.emit("skyward.shot", { ...payload, playerId: ctx.actor.id, damage, spread, pierce });
    } },
    hitEnemy: { sync: { mode: "hostRelay" }, validate(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), sequence = Number(payload?.sequence), eventId = text(payload?.eventId, 120), enemyId = text(payload?.enemyId, 120), damage = Number(payload?.damage);
      if (!player?.alive || !eventId || !enemyId || !Number.isInteger(sequence) || sequence <= player.lastHitSequence || !Number.isFinite(damage)) return reject("invalid-hit");
      return ok({ ...payload, eventId, enemyId, sequence, damage: Math.max(1, Math.min(3, Math.round(damage))) });
    }, reduce(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id);
      if (!player) return;
      player.lastHitSequence = payload.sequence;
      damageEnemy(ctx, player, payload.enemyId, payload.damage);
    } },
    stompEnemy: { sync: { mode: "hostRelay" }, validate(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), sequence = Number(payload?.sequence), eventId = text(payload?.eventId, 120), enemyId = text(payload?.enemyId, 120), enemy2 = enemyById(ctx.state, enemyId);
      return player?.alive && eventId && Number.isInteger(sequence) && sequence > player.lastHitSequence && enemy2?.stompable ? ok({ eventId, enemyId, sequence }) : reject("invalid-stomp");
    }, reduce(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id);
      if (!player) return;
      player.lastHitSequence = payload.sequence;
      damageEnemy(ctx, player, payload.enemyId, 1);
    } },
    landPlatform: { sync: { mode: "hostRelay" }, validate(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), platformId = text(payload?.platformId, 120), sequence = Number(payload?.sequence), entity = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, platformId);
      return player?.alive && platformId && Number.isInteger(sequence) && sequence > player.lastOutcomeSequence && entity && "width" in entity ? ok({ platformId, sequence }) : reject("invalid-platform");
    }, reduce(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), entity = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, payload.platformId);
      if (!player || !entity || !("width" in entity)) return;
      player.lastOutcomeSequence = payload.sequence;
      const now = ctx.now(), strategy = platformStrategies.require(entity.kind), runtime = runtimeFor(ctx.state, entity.id, now), transitioned = strategy.transition(entity, runtime, ctx.state.entities[entity.id]);
      if (transitioned) ctx.state.entities[entity.id] = transitioned;
      applyEffects(ctx, player, strategy.contact(entity, runtime, transitioned ?? void 0).effects);
    } },
    claimPickup: { sync: { mode: "hostRelay" }, validate(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), pickupId = text(payload?.pickupId, 120), sequence = Number(payload?.sequence), dynamic = ctx.state.entities[pickupId], generated = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, pickupId), pickup = dynamic?.kind === "pickup" && dynamic.pickup ? dynamic.pickup : generated && "durationMs" in generated ? generated : null;
      return player?.alive && pickupId && Number.isInteger(sequence) && sequence > player.lastOutcomeSequence && !(dynamic?.kind === "pickup" && dynamic.claimedBy) && pickup ? ok({ pickupId, sequence }) : reject("invalid-pickup");
    }, reduce(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), dynamic = ctx.state.entities[payload.pickupId], generated = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, payload.pickupId), pickup = dynamic?.kind === "pickup" && dynamic.pickup ? dynamic.pickup : generated && "durationMs" in generated ? generated : null;
      if (!player || !pickup) return;
      player.lastOutcomeSequence = payload.sequence;
      const now = ctx.now();
      ctx.state.entities[payload.pickupId] = { kind: "pickup", pickup: dynamic?.kind === "pickup" ? dynamic.pickup : void 0, claimedBy: player.id, claimedAt: now };
      applyEffects(ctx, player, pickupStrategies.require(pickup.kind).claim(pickup, runtimeFor(ctx.state, payload.pickupId, now)));
      ctx.emit("skyward.pickup", { playerId: player.id, kind: pickup.kind });
    } },
    playerOutcome: { sync: { mode: "hostRelay" }, validate(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id), sequence = Number(payload?.sequence), eventId = text(payload?.eventId, 120), outcome = payload?.outcome;
      if (outcome === "death" && player && flyingActive(player, ctx.now())) return reject("flight-invulnerable");
      return player?.alive && eventId && Number.isInteger(sequence) && sequence > player.lastOutcomeSequence && (outcome === "shield" || outcome === "death") ? ok({ eventId, sequence, outcome, reason: text(payload?.reason, 40) || "\u5371\u9669" }) : reject("invalid-outcome");
    }, reduce(ctx, payload) {
      const player = activePlayer(ctx.state, ctx.actor.id);
      if (!player) return;
      player.lastOutcomeSequence = payload.sequence;
      if (payload.outcome === "shield" && player.effects.shield) {
        delete player.effects.shield;
        player.killStreak = 0;
        ctx.emit("skyward.outcome", { playerId: player.id, ...payload });
        return;
      }
      if (!flyingActive(player, ctx.now())) kill(ctx, player.id, payload.reason);
    } },
    enableTilt: { sync: { mode: "hostRelay" }, validate(_, payload) {
      return ok({ enabled: Boolean(payload?.enabled) });
    }, reduce(ctx, payload) {
      const player = ctx.state.players[ctx.actor.id];
      if (player) player.tilt = payload.enabled;
    } },
    "internal.respawn": { sync: { mode: "hostAuthoritative" }, reduce(ctx, payload) {
      const player = ctx.state.players[payload.playerId];
      if (!player || player.alive || ctx.state.phase !== "running") return;
      player.alive = true;
      player.respawnAt = null;
      player.invulnerableUntil = ctx.now() + INVULNERABLE_MS;
      player.x = WORLD_WIDTH / 2;
      player.y = Math.max(ctx.state.teamVoidY + 180, player.cameraBottom + 180);
      player.vy = 760;
      player.positionEpoch += 1;
    } },
    "internal.bossTick": { sync: { mode: "hostAuthoritative" }, reduce(ctx) {
      bossTick(ctx);
    } }
  }
});
function initialState() {
  return { schemaVersion: SCHEMA_VERSION, phase: "lobby", hostId: null, seed: 0, startedAt: null, startedPlayers: [], players: {}, teamVoidY: 0, highestY: 0, completedBossCount: 0, entities: {}, boss: null, bestRun: { height: 0, bosses: 0, kills: 0, noDamageHeight: 0 }, message: "\u6240\u6709\u4EBA\u51C6\u5907\u540E\u5F00\u59CB" };
}
function createPlayer(id, name) {
  return { id, name, ready: false, connected: true, alive: true, respawnAt: null, invulnerableUntil: 0, x: WORLD_WIDTH / 2, y: 120, vy: 0, cameraBottom: 0, direction: 0, positionEpoch: 0, kills: 0, deaths: 0, shots: 0, killStreak: 0, noDamageHeight: 0, tilt: false, lastHitSequence: 0, lastOutcomeSequence: 0, effects: {} };
}
function poseFrom(player, now) {
  return { sequence: -1, x: player.x, y: player.y, vy: player.vy, cameraBottom: player.cameraBottom, direction: player.direction, persistedAt: now };
}
function text(value, max) {
  return typeof value === "string" ? value.slice(0, max) : "";
}
function wrap(x) {
  return (x % WORLD_WIDTH + WORLD_WIDTH) % WORLD_WIDTH;
}
function activePlayer(state, id) {
  return state.phase === "running" && state.startedPlayers.includes(id) ? state.players[id] : void 0;
}
function startRun(ctx) {
  const state = ctx.state;
  Object.assign(state, { phase: "running", seed: Math.floor(ctx.random() * 4294967295) >>> 0, startedAt: ctx.now(), startedPlayers: Object.keys(state.players), teamVoidY: 0, highestY: 0, completedBossCount: 0, entities: {}, boss: null, message: "\u5411\u4E0A\u6500\u767B" });
  for (const player of Object.values(state.players)) {
    const epoch = player.positionEpoch + 1;
    Object.assign(player, createPlayer(player.id, player.name), { positionEpoch: epoch });
  }
  ctx.emit("skyward.started", {});
}
function resetLobby(state) {
  for (const [id, player] of Object.entries(state.players)) {
    if (!player.connected) delete state.players[id];
    else {
      const epoch = player.positionEpoch;
      Object.assign(player, createPlayer(id, player.name), { positionEpoch: epoch });
    }
  }
  Object.assign(state, { phase: "lobby", seed: 0, startedAt: null, startedPlayers: [], teamVoidY: 0, highestY: 0, completedBossCount: 0, entities: {}, boss: null, message: "\u6240\u6709\u4EBA\u51C6\u5907\u540E\u5F00\u59CB" });
}
function runtimeFor(state, entityId, now) {
  return runtimeContext(contextFor(state.seed, Number(entityId.split(":")[0]), Math.max(1, state.startedPlayers.length)), state.startedAt ?? now, now);
}
function effectActive(player, id, now) {
  const effect = player.effects[id];
  return Boolean(effect && (effect.endsAt == null || effect.endsAt > now));
}
function flyingActive(player, now) {
  return effectActive(player, "rocket", now) || effectActive(player, "propeller", now);
}
function flightBoundary(state, player, now) {
  if (!flyingActive(player, now)) return null;
  const nextBossChunk = (state.completedBossCount + 1) * BOSS_INTERVAL - 1;
  return nextBossChunk * CHUNK_HEIGHT + BOSS_TRIGGER_OFFSET;
}
function bossArenaFloor(state) {
  return state.boss ? state.boss.chunkIndex * CHUNK_HEIGHT + BOSS_ARENA_FLOOR_OFFSET : null;
}
function forceFlightEnding(player, now) {
  for (const id of ["rocket", "propeller"]) {
    const effect = player.effects[id];
    if (!effect || effect.forcedEndingAt != null) continue;
    effect.forcedEndingAt = now;
    effect.endsAt = now + FLIGHT_PROFILES[id].unpoweredMs;
    effect.phase = "ending";
  }
}
function applyEffects(ctx, player, effects) {
  for (const effect of effects) {
    if (effect.kind === "entity-state") ctx.state.entities[effect.entityId] = effect.state;
    else if (effect.kind === "apply-effect") applyEffect(player, effect.effect);
    else if (effect.kind === "remove-effect") delete player.effects[effect.effectId];
    else if (effect.kind === "stat") {
      if (effect.stat === "kills") player.kills += effect.amount;
      else player.noDamageHeight = Math.max(player.noDamageHeight, effect.amount);
    } else if (effect.kind === "message") ctx.state.message = effect.text;
    else if (effect.kind === "spawn-enemy") ctx.state.entities[effect.enemy.id] = { kind: "summon", enemy: effect.enemy, hp: effect.enemy.hp, defeated: false, changedAt: ctx.now() };
    else if (effect.kind === "spawn-hazard") ctx.state.entities[`hazard:${effect.hazard.activeAt}:${Object.keys(ctx.state.entities).length}`] = effect.hazard;
  }
}
function applyEffect(player, effect) {
  if (effect.id === "rocket") delete player.effects.propeller;
  if (effect.id === "propeller") delete player.effects.rocket;
  player.effects[effect.id] = { ...effect, stacks: 1 };
}
function updateVoid(state) {
  const alive = state.startedPlayers.map((id) => state.players[id]).filter((player) => player?.connected && player.alive);
  if (alive.length) state.teamVoidY = Math.max(state.teamVoidY, Math.min(...alive.map((player) => player.cameraBottom)));
}
function kill(ctx, id, reason) {
  const player = ctx.state.players[id];
  if (!player?.alive || ctx.state.phase !== "running") return;
  player.alive = false;
  player.deaths += 1;
  player.killStreak = 0;
  player.respawnAt = ctx.now() + RESPAWN_MS;
  player.vy = 0;
  ctx.emit("skyward.death", { playerId: id, reason });
  if (!checkWipe(ctx)) ctx.timers.dispatch(`respawn:${id}`, RESPAWN_MS, "internal.respawn", { playerId: id }, id);
}
function checkWipe(ctx) {
  if (ctx.state.startedPlayers.some((id) => ctx.state.players[id]?.connected && ctx.state.players[id].alive)) return false;
  const kills = Math.max(0, ...Object.values(ctx.state.players).map((player) => player.kills)), height = Math.max(0, ...Object.values(ctx.state.players).map((player) => player.noDamageHeight));
  ctx.state.bestRun = { height: Math.max(ctx.state.bestRun.height, ctx.state.highestY), bosses: Math.max(ctx.state.bestRun.bosses, ctx.state.completedBossCount), kills: Math.max(ctx.state.bestRun.kills, kills), noDamageHeight: Math.max(ctx.state.bestRun.noDamageHeight, height) };
  ctx.state.phase = "gameover";
  ctx.state.boss = null;
  ctx.state.message = "\u8FDC\u5F81\u7ED3\u675F";
  for (const id of ctx.state.startedPlayers) ctx.timers.clear(`respawn:${id}`);
  return true;
}
function enemyById(state, id) {
  const dynamic = state.entities[id];
  if (dynamic?.kind === "summon") return dynamic.enemy;
  const entity = findEntity(state.seed, state.startedPlayers.length, id);
  return entity && "hp" in entity ? entity : null;
}
function damageEnemy(ctx, player, id, damage) {
  const enemy2 = enemyById(ctx.state, id);
  if (!enemy2 || enemy2.boss && ctx.state.boss?.enemyId !== id) return;
  if (ctx.state.boss?.enemyId === id) {
    const strategy = bossStrategies.require(ctx.state.boss.bossId), phase = strategy.phases.find((item) => ctx.state.boss.hp / ctx.state.boss.maxHp >= item.minHpRatio);
    const applied = strategy.id === "mechanical-core" && !phase.weak && phase.id !== "phase-3" ? Math.max(1, Math.floor(damage / 2)) : damage;
    ctx.state.boss.hp = Math.max(0, ctx.state.boss.hp - applied);
    if (!ctx.state.boss.hp) defeatBoss(ctx);
    return;
  }
  const current = ctx.state.entities[id], hp = (current?.kind === "enemy" || current?.kind === "summon" ? current.hp : enemy2.hp) - damage;
  if (current?.kind === "summon") ctx.state.entities[id] = { ...current, hp, defeated: hp <= 0, changedAt: ctx.now() };
  else ctx.state.entities[id] = { kind: "enemy", hp, defeated: hp <= 0, changedAt: ctx.now() };
  if (hp <= 0) {
    player.kills += 1;
    player.killStreak += 1;
    spawnDrop(ctx.state, enemy2, ctx.now());
    ctx.emit("skyward.enemyDefeated", { enemyId: id, playerId: player.id });
  }
}
function spawnDrop(state, enemy2, now) {
  const runtime = runtimeFor(state, enemy2.id, now), roll = runtime.rng(`drop:${enemy2.id}`).float();
  if (roll >= 0.35 || !enemy2.drops.length) return;
  const total = enemy2.drops.reduce((sum, item) => sum + item.weight, 0);
  let cursor = runtime.rng(`drop-kind:${enemy2.id}`).float() * total, chosen = enemy2.drops[0];
  for (const item of enemy2.drops) {
    cursor -= item.weight;
    if (cursor <= 0) {
      chosen = item;
      break;
    }
  }
  const id = `${enemy2.id}:drop`;
  state.entities[id] = { kind: "pickup", pickup: { id, kind: chosen.pickup, x: enemy2.x, y: enemy2.y, durationMs: pickupStrategies.require(chosen.pickup).durationMs, sourceId: enemy2.id } };
}
function startBoss(ctx, chunkIndex) {
  if (!canStartBoss(ctx.state, chunkIndex)) return;
  const chunk = generateChunk(ctx.state.seed, chunkIndex, ctx.state.startedPlayers.length), enemy2 = chunk.enemies.find((item) => item.boss);
  if (!enemy2) return;
  const now = ctx.now(), arenaFloor = chunkIndex * CHUNK_HEIGHT + BOSS_ARENA_FLOOR_OFFSET;
  ctx.state.boss = { enemyId: enemy2.id, bossId: enemy2.kind, ordinal: bossOrdinalForChunk(chunkIndex), chunkIndex, hp: enemy2.hp, maxHp: enemy2.hp, phaseId: "phase-1", startedAt: now, nextAttackAt: now + 3e3, sequence: 0, attacks: [], summons: [] };
  ctx.state.teamVoidY = arenaFloor;
  for (const player of Object.values(ctx.state.players)) if (player.connected && player.alive) player.cameraBottom = arenaFloor;
  ctx.state.message = `${enemy2.kind} \u5C01\u9501\u4E86\u4E0A\u884C\u901A\u8DEF`;
  ctx.timers.dispatch("boss:tick", 200, "internal.bossTick");
}
function bossTick(ctx) {
  const boss2 = ctx.state.boss;
  if (!boss2 || ctx.state.phase !== "running") return;
  const now = ctx.now(), strategy = bossStrategies.require(boss2.bossId), generated = findEntity(ctx.state.seed, ctx.state.startedPlayers.length, boss2.enemyId);
  if (!generated || !("hp" in generated)) return;
  boss2.attacks = boss2.attacks.filter((attack) => attack.endsAt > now);
  const ratio = boss2.hp / boss2.maxHp, phase = strategy.phases.find((item) => ratio >= item.minHpRatio) ?? strategy.phases.at(-1);
  boss2.phaseId = phase.id;
  if (now >= boss2.nextAttackAt) {
    const targets = ctx.state.startedPlayers.map((id) => ctx.state.players[id]).filter((player) => player?.connected && player.alive), target = targets[boss2.sequence % Math.max(1, targets.length)], runtime = runtimeFor(ctx.state, boss2.enemyId, now), attack = strategy.selectAttack(generated, runtime, phase, boss2.sequence, target);
    if (attack.kind === "platform-hazard" || attack.kind === "platform-toggle" || attack.kind === "slam") {
      const arena = generateChunk(ctx.state.seed, boss2.chunkIndex, ctx.state.startedPlayers.length).platforms.filter((platform2) => platform2.kind !== "boss-exit");
      attack.platformId = arena[boss2.sequence % arena.length]?.id;
    }
    boss2.attacks.push(attack);
    if (attack.kind !== "summon") ctx.state.entities[attack.id] = { kind: "hazard", hazardKind: attack.kind, x: attack.x, y: attack.y, radius: attack.radius, activeAt: attack.activeAt, endsAt: attack.endsAt, platformId: attack.platformId, direction: attack.direction };
    else {
      const summons = strategy.summons(generated, runtime, boss2.sequence);
      boss2.summons.push(...summons);
      for (const summon of summons) ctx.state.entities[summon.id] = { kind: "summon", enemy: summon, hp: summon.hp, defeated: false, changedAt: now };
    }
    boss2.sequence += 1;
    boss2.nextAttackAt = now + Math.round(4400 * phase.cooldownScale);
  }
  ctx.timers.dispatch("boss:tick", 200, "internal.bossTick");
}
function defeatBoss(ctx) {
  const boss2 = ctx.state.boss;
  if (!boss2) return;
  ctx.timers.clear("boss:tick");
  for (const summon of boss2.summons) delete ctx.state.entities[summon.id];
  ctx.state.completedBossCount = Math.max(ctx.state.completedBossCount, boss2.ordinal);
  ctx.state.boss = null;
  ctx.state.message = "\u901A\u8DEF\u6062\u590D\uFF0C\u7EE7\u7EED\u5411\u4E0A";
  ctx.emit("skyward.bossDefeated", { chunkIndex: boss2.chunkIndex, ordinal: boss2.ordinal });
}
function persistPose(ctx, player, pose, now) {
  player.x = pose.x;
  player.y = pose.y;
  player.vy = pose.vy;
  player.direction = pose.direction;
  const arenaFloor = bossArenaFloor(ctx.state);
  player.cameraBottom = arenaFloor ?? Math.max(player.cameraBottom, Math.min(pose.cameraBottom, pose.y - 140));
  player.noDamageHeight = Math.max(player.noDamageHeight, pose.y);
  pose.persistedAt = now;
  ctx.state.highestY = Math.max(ctx.state.highestY, pose.y);
  for (const [id, effect] of Object.entries(player.effects)) if (effect?.endsAt != null && effect.endsAt <= now) delete player.effects[id];
  if (arenaFloor == null) updateVoid(ctx.state);
  else ctx.state.teamVoidY = arenaFloor;
  const below = Math.floor(ctx.state.teamVoidY / CHUNK_HEIGHT) - 2;
  for (const [id, value] of Object.entries(ctx.state.entities)) {
    const chunk2 = Number(id.split(":")[0]);
    if (value.kind === "hazard" && value.endsAt <= now || Number.isInteger(chunk2) && chunk2 < below) delete ctx.state.entities[id];
  }
  const chunk = Math.floor(pose.y / CHUNK_HEIGHT), triggerY = chunk * CHUNK_HEIGHT + BOSS_TRIGGER_OFFSET;
  if (pose.y >= triggerY && !ctx.state.boss) {
    const allArrived = ctx.state.startedPlayers.map((id) => ctx.state.players[id]).filter((p) => p?.connected).every((p) => p.y >= triggerY - 100);
    if (allArrived) startBoss(ctx, chunk);
  }
}

// src/worker/index.ts
var index_default = createFlowRoom(skywardGame);
export default index_default;

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

// src/game/maps.ts
var W = 26;
var H = 20;
var point = (x, y) => ({ x: x + 0.5, y: y + 0.5 });
var indexOf = (x, y) => y * W + x;
function painter() {
  const tiles = Array(W * H).fill("ground");
  const set = (x, y, tile) => {
    if (x >= 0 && y >= 0 && x < W && y < H) tiles[indexOf(x, y)] = tile;
  };
  return {
    tiles,
    set,
    rect(x, y, width, height, tile) {
      for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) set(px, py, tile);
    },
    h(y, x1, x2, tile, gaps = []) {
      for (let x = x1; x <= x2; x++) if (!gaps.includes(x)) set(x, y, tile);
    },
    v(x, y1, y2, tile, gaps = []) {
      for (let y = y1; y <= y2; y++) if (!gaps.includes(y)) set(x, y, tile);
    }
  };
}
function fortress(p, x, y, facing) {
  const bricks = [];
  const steel = [];
  if (facing === "right") {
    bricks.push([x - 1, y - 1], [x - 1, y], [x - 1, y + 1]);
    steel.push([x, y - 1], [x, y + 1]);
  }
  if (facing === "left") {
    bricks.push([x + 1, y - 1], [x + 1, y], [x + 1, y + 1]);
    steel.push([x, y - 1], [x, y + 1]);
  }
  if (facing === "down") {
    bricks.push([x - 1, y - 1], [x, y - 1], [x + 1, y - 1]);
    steel.push([x - 1, y], [x + 1, y]);
  }
  if (facing === "up") {
    bricks.push([x - 1, y + 1], [x, y + 1], [x + 1, y + 1]);
    steel.push([x - 1, y], [x + 1, y]);
  }
  bricks.forEach(([bx, by]) => p.set(bx, by, "brick"));
  steel.forEach(([sx, sy]) => p.set(sx, sy, "steel"));
  p.set(x, y, "ground");
  return { position: point(x, y), facing, protectionTiles: bricks.map(([bx, by]) => indexOf(bx, by)) };
}
function layouts(p) {
  const top = fortress(p, 13, 2, "down");
  const bottom = fortress(p, 13, 17, "up");
  const left = fortress(p, 3, 10, "right");
  const right = fortress(p, 22, 10, "left");
  const lowerLeft = fortress(p, 5, 16, "right");
  const lowerRight = fortress(p, 20, 16, "left");
  const make = (bases, spawns) => ({ bases, spawns });
  const ffaLayouts = {
    2: make([top, bottom], [point(13, 4), point(13, 15)]),
    3: make([top, lowerLeft, lowerRight], [point(13, 4), point(7, 16), point(18, 16)]),
    4: make([top, bottom, left, right], [point(13, 4), point(13, 15), point(5, 10), point(20, 10)])
  };
  return {
    ffaLayouts,
    teamBases: { red: left, blue: right },
    teamSpawns: { red: [point(5, 8), point(5, 12)], blue: [point(20, 8), point(20, 12)] }
  };
}
function finish(id, name, draw) {
  const p = painter();
  for (let x = 0; x < W; x++) {
    p.set(x, 0, "steel");
    p.set(x, H - 1, "steel");
  }
  for (let y = 0; y < H; y++) {
    p.set(0, y, "steel");
    p.set(W - 1, y, "steel");
  }
  draw(p);
  const placement = layouts(p);
  const clear = (pos) => p.set(Math.floor(pos.x), Math.floor(pos.y), "ground");
  Object.values(placement.ffaLayouts).forEach((layout) => layout.spawns.forEach(clear));
  placement.teamSpawns.red.forEach(clear);
  placement.teamSpawns.blue.forEach(clear);
  const aiSpawns = [point(10, 2), point(15, 17), point(2, 7), point(23, 12)];
  const powerUpSpawns = [point(8, 5), point(17, 5), point(8, 14), point(17, 14), point(12, 9)];
  aiSpawns.forEach(clear);
  powerUpSpawns.forEach(clear);
  return {
    id,
    name,
    width: W,
    height: H,
    tiles: p.tiles,
    ...placement,
    center: point(12, 9),
    aiSpawns,
    powerUpSpawns
  };
}
var MAPS = [
  finish("crossfire", "\u4E2D\u592E\u4E89\u593A", (p) => {
    p.h(7, 5, 20, "brick", [9, 10, 15, 16]);
    p.h(12, 5, 20, "brick", [9, 10, 15, 16]);
    p.v(10, 4, 15, "brick", [8, 9, 10, 11]);
    p.v(15, 4, 15, "brick", [8, 9, 10, 11]);
    p.rect(12, 8, 2, 4, "forest");
  }),
  finish("twin-flanks", "\u53CC\u4FA7\u7FFC", (p) => {
    p.v(8, 3, 16, "steel", [6, 7, 12, 13]);
    p.v(17, 3, 16, "steel", [6, 7, 12, 13]);
    p.h(6, 9, 16, "brick", [12, 13]);
    p.h(13, 9, 16, "brick", [12, 13]);
    p.rect(3, 4, 3, 2, "forest");
    p.rect(20, 14, 3, 2, "forest");
  }),
  finish("river-bridges", "\u6CB3\u6865\u93D6\u6218", (p) => {
    p.rect(11, 1, 4, 18, "water");
    p.rect(11, 4, 4, 3, "ground");
    p.rect(11, 9, 4, 2, "ground");
    p.rect(11, 14, 4, 3, "ground");
    p.h(8, 3, 9, "brick", [6]);
    p.h(11, 16, 22, "brick", [19]);
  }),
  finish("steel-maze", "\u94A2\u5899\u8FF7\u5BAB", (p) => {
    p.v(7, 3, 16, "steel", [5, 10, 14]);
    p.v(12, 2, 17, "steel", [6, 9, 13]);
    p.v(18, 3, 16, "steel", [5, 10, 14]);
    p.h(6, 3, 22, "brick", [7, 8, 12, 13, 18, 19]);
    p.h(13, 3, 22, "brick", [5, 6, 11, 12, 17, 18]);
  }),
  finish("forest-ambush", "\u68EE\u6797\u4F0F\u51FB", (p) => {
    p.rect(6, 4, 5, 4, "forest");
    p.rect(15, 12, 5, 4, "forest");
    p.rect(6, 13, 4, 3, "forest");
    p.rect(16, 4, 4, 3, "forest");
    p.h(9, 5, 20, "brick", [8, 12, 13, 17]);
    p.h(11, 5, 20, "brick", [8, 12, 13, 17]);
  }),
  finish("ice-ring", "\u51B0\u9762\u73AF\u8DEF", (p) => {
    p.rect(6, 4, 14, 12, "ice");
    p.rect(9, 7, 8, 6, "ground");
    p.h(6, 8, 17, "brick", [12, 13]);
    p.h(13, 8, 17, "brick", [12, 13]);
    p.v(8, 7, 12, "steel", [9, 10]);
    p.v(17, 7, 12, "steel", [9, 10]);
  }),
  finish("brick-city", "\u7816\u5899\u57CE\u533A", (p) => {
    [[5, 4], [10, 3], [16, 4], [20, 7], [5, 12], [10, 14], [16, 13], [20, 11]].forEach(([x, y]) => p.rect(x, y, 3, 2, "brick"));
    p.h(9, 3, 22, "brick", [6, 7, 12, 13, 18, 19]);
    p.h(11, 3, 22, "brick", [4, 5, 10, 11, 16, 17, 22]);
  }),
  finish("four-quadrants", "\u56DB\u533A\u901A\u9053", (p) => {
    p.v(12, 2, 17, "water", [5, 9, 10, 14]);
    p.v(13, 2, 17, "water", [5, 9, 10, 14]);
    p.h(9, 3, 22, "steel", [6, 12, 13, 19]);
    p.h(10, 3, 22, "steel", [6, 12, 13, 19]);
    p.rect(5, 4, 3, 3, "forest");
    p.rect(18, 13, 3, 3, "forest");
  }),
  finish("broken-factory", "\u7834\u788E\u5DE5\u5382", (p) => {
    p.rect(5, 4, 5, 2, "steel");
    p.rect(16, 14, 5, 2, "steel");
    p.rect(7, 12, 4, 2, "brick");
    p.rect(15, 5, 4, 2, "brick");
    p.v(12, 3, 16, "brick", [6, 9, 10, 13]);
    p.v(14, 3, 16, "brick", [5, 9, 10, 14]);
    p.rect(3, 8, 4, 4, "forest");
  }),
  finish("open-arena", "\u5F00\u653E\u6218\u573A", (p) => {
    p.rect(10, 7, 6, 6, "forest");
    p.h(5, 5, 20, "brick", [8, 9, 13, 14, 18]);
    p.h(14, 5, 20, "brick", [7, 11, 12, 16, 17]);
    p.rect(6, 8, 2, 4, "steel");
    p.rect(18, 8, 2, 4, "steel");
  })
];
var MAP_BY_ID = new Map(MAPS.map((map) => [map.id, map]));
function tileAt(map, x, y) {
  const tx = Math.floor(x);
  const ty = Math.floor(y);
  if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return "steel";
  return map.tiles[ty * map.width + tx];
}

// src/game/contracts.ts
var TANK_SIZE = 0.78;
var PLAYER_SPEED = 3.2;
var AI_SPEED = 1.75;
var BULLET_SPEED = 8;
var MATCH_DURATION_MS = 12 * 60 * 1e3;
var RESPAWN_MS = 2e3;
var MAX_AI = 3;
var MAX_BULLETS = 28;
var MAX_POWER_UPS = 3;

// src/game/rules.ts
var DIRECTIONS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
};
function initialState() {
  return {
    schema: "tank-battle-v1",
    phase: "lobby",
    config: { mode: "freeForAll", mapId: "crossfire" },
    hostId: null,
    players: {},
    bases: {},
    bullets: {},
    ai: {},
    powerUps: {},
    destroyedTiles: [],
    startedAt: null,
    deadlineAt: null,
    lastTickAt: null,
    nextAiSpawnAt: 0,
    nextPowerUpAt: 0,
    sequence: 0,
    result: null
  };
}
function createPlayer(id, name, index) {
  return {
    id,
    name,
    ready: false,
    team: index % 2 ? "blue" : "red",
    connected: true,
    alive: false,
    eliminated: false,
    x: 0,
    y: 0,
    direction: "up",
    input: "none",
    kills: 0,
    aiKills: 0,
    shieldUntil: 0,
    rapidFireUntil: 0,
    armor: 0,
    nextFireAt: 0,
    respawnAt: null
  };
}
function nextId(state, prefix) {
  state.sequence += 1;
  return `${prefix}:${state.sequence}`;
}
function teamPlayers(state, team) {
  return Object.values(state.players).filter((player) => player.team === team);
}
function canStart(state) {
  const players = Object.values(state.players);
  if (players.length < 2 || players.some((player) => !player.ready)) return false;
  if (state.config.mode === "team2v2") {
    return players.length === 4 && teamPlayers(state, "red").length === 2 && teamPlayers(state, "blue").length === 2;
  }
  return players.length <= 4;
}
function startMatch(state, now) {
  const map = MAP_BY_ID.get(state.config.mapId);
  if (!map || !canStart(state)) return false;
  state.phase = "running";
  state.bases = {};
  state.bullets = {};
  state.ai = {};
  state.powerUps = {};
  state.destroyedTiles = [];
  state.startedAt = now;
  state.deadlineAt = now + MATCH_DURATION_MS;
  state.lastTickAt = now;
  state.nextAiSpawnAt = now + 15e3;
  state.nextPowerUpAt = now + 8e3;
  state.result = null;
  const players = Object.values(state.players);
  const ffaLayout = map.ffaLayouts[players.length];
  players.forEach((player, index) => {
    const spawn = state.config.mode === "team2v2" ? map.teamSpawns[player.team][teamPlayers(state, player.team).findIndex((p) => p.id === player.id)] : ffaLayout.spawns[index];
    Object.assign(player, {
      ready: false,
      connected: true,
      alive: true,
      eliminated: false,
      x: spawn.x,
      y: spawn.y,
      direction: player.team === "red" ? "right" : "left",
      input: "none",
      kills: 0,
      aiKills: 0,
      shieldUntil: now + 1800,
      rapidFireUntil: 0,
      armor: 0,
      nextFireAt: now,
      respawnAt: null
    });
  });
  if (state.config.mode === "team2v2") {
    for (const team of ["red", "blue"]) {
      const base = map.teamBases[team];
      state.bases[`team:${team}`] = { id: `team:${team}`, team, x: base.position.x, y: base.position.y, hp: 3, maxHp: 3, fortifiedUntil: 0, protectionTiles: base.protectionTiles };
    }
  } else {
    players.forEach((player, index) => {
      const base = ffaLayout.bases[index];
      state.bases[`player:${player.id}`] = { id: `player:${player.id}`, ownerId: player.id, x: base.position.x, y: base.position.y, hp: 3, maxHp: 3, fortifiedUntil: 0, protectionTiles: base.protectionTiles };
    });
  }
  return true;
}
function baseFor(state, player) {
  return state.config.mode === "team2v2" ? state.bases[`team:${player.team}`] : state.bases[`player:${player.id}`];
}
function isDestroyed(state, x, y) {
  const map = MAP_BY_ID.get(state.config.mapId);
  return state.destroyedTiles.includes(Math.floor(y) * map.width + Math.floor(x));
}
function blocksMovement(state, x, y) {
  const map = MAP_BY_ID.get(state.config.mapId);
  const tile = tileAt(map, x, y);
  return !isDestroyed(state, x, y) && (tile === "brick" || tile === "steel" || tile === "water");
}
function canOccupy(state, x, y, size = TANK_SIZE) {
  const half = size / 2;
  return !blocksMovement(state, x - half, y - half) && !blocksMovement(state, x + half, y - half) && !blocksMovement(state, x - half, y + half) && !blocksMovement(state, x + half, y + half);
}
function moveTank(state, tank, direction, speed, dt) {
  if (direction === "none") return;
  tank.direction = direction;
  const delta = DIRECTIONS[direction];
  const nx = tank.x + delta.x * speed * dt;
  const ny = tank.y + delta.y * speed * dt;
  if (canOccupy(state, nx, ny)) {
    tank.x = nx;
    tank.y = ny;
  }
}
function overlaps(a, b, distance = 0.58) {
  return Math.abs(a.x - b.x) < distance && Math.abs(a.y - b.y) < distance;
}
function firePlayer(state, playerId, now) {
  const player = state.players[playerId];
  if (state.phase !== "running" || !player?.alive || player.direction === "none" || now < player.nextFireAt || Object.keys(state.bullets).length >= MAX_BULLETS) return false;
  const direction = player.direction;
  const delta = DIRECTIONS[direction];
  const id = nextId(state, `bullet:${player.id}`);
  state.bullets[id] = {
    id,
    ownerId: player.id,
    ownerKind: "player",
    team: player.team,
    direction,
    x: player.x + delta.x * 0.55,
    y: player.y + delta.y * 0.55,
    speed: BULLET_SPEED,
    steelPiercing: player.armor > 0
  };
  player.nextFireAt = now + (player.rapidFireUntil > now ? 220 : 480);
  return true;
}
function killPlayer(state, target, killerId, now) {
  if (!target.alive || target.shieldUntil > now) return;
  if (target.armor > 0) {
    target.armor -= 1;
    target.shieldUntil = now + 500;
    return;
  }
  target.alive = false;
  target.input = "none";
  if (killerId && state.players[killerId] && killerId !== target.id) state.players[killerId].kills += 1;
  const base = baseFor(state, target);
  target.respawnAt = base && base.hp > 0 ? now + RESPAWN_MS : null;
  target.eliminated = target.respawnAt === null;
}
function applyPowerUp(state, player, kind, now) {
  if (kind === "armor") player.armor = Math.min(3, player.armor + 1);
  if (kind === "shield") player.shieldUntil = now + 8e3;
  if (kind === "rapidFire") player.rapidFireUntil = now + 1e4;
  if (kind === "bomb") Object.values(state.ai).forEach((ai) => {
    delete state.ai[ai.id];
    player.aiKills += 1;
  });
  if (kind === "fortify") {
    const base = baseFor(state, player);
    if (base && base.hp > 0) base.fortifiedUntil = now + 1e4;
  }
}
function spawnAi(state, now) {
  const map = MAP_BY_ID.get(state.config.mapId);
  const spawn = map.aiSpawns[state.sequence % map.aiSpawns.length];
  const id = nextId(state, "ai");
  state.ai[id] = {
    id,
    x: spawn.x,
    y: spawn.y,
    hp: 1,
    direction: "down",
    nextDecisionAt: now,
    nextFireAt: now + 2500,
    behavior: "patrol",
    targetPlayerId: null,
    path: [],
    lastProgressX: spawn.x,
    lastProgressY: spawn.y,
    lastProgressAt: now,
    stuckSince: null,
    bulletId: null
  };
}
function spawnPowerUp(state, now) {
  const map = MAP_BY_ID.get(state.config.mapId);
  const spawn = map.powerUpSpawns[state.sequence % map.powerUpSpawns.length];
  const kinds = ["armor", "shield", "bomb", "fortify", "rapidFire"];
  const id = nextId(state, "powerup");
  state.powerUps[id] = { id, x: spawn.x, y: spawn.y, kind: kinds[state.sequence % kinds.length], expiresAt: now + 12e3 };
}
function aiPassable(state, x, y) {
  const map = MAP_BY_ID.get(state.config.mapId);
  const index = Math.floor(y) * map.width + Math.floor(x);
  const tile = tileAt(map, x + 0.5, y + 0.5);
  return state.destroyedTiles.includes(index) || tile !== "brick" && tile !== "steel" && tile !== "water";
}
function findPath(state, from, to) {
  const map = MAP_BY_ID.get(state.config.mapId);
  const start = [Math.floor(from.x), Math.floor(from.y)];
  const goal = [Math.floor(to.x), Math.floor(to.y)];
  const key = (x, y) => `${x},${y}`;
  const queue = [[...start]];
  const previous = /* @__PURE__ */ new Map([[key(...start), null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current2 = queue[cursor];
    if (current2[0] === goal[0] && current2[1] === goal[1]) break;
    for (const delta of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = current2[0] + delta[0];
      const ny = current2[1] + delta[1];
      const nextKey = key(nx, ny);
      if (nx <= 0 || ny <= 0 || nx >= map.width - 1 || ny >= map.height - 1 || previous.has(nextKey) || !aiPassable(state, nx, ny)) continue;
      previous.set(nextKey, current2);
      queue.push([nx, ny]);
    }
  }
  if (!previous.has(key(...goal))) return [];
  const result = [];
  let current = [...goal];
  while (current && (current[0] !== start[0] || current[1] !== start[1])) {
    result.push(pointCenter(current[0], current[1]));
    current = previous.get(key(...current)) ?? null;
  }
  return result.reverse().slice(0, 12);
}
function pointCenter(x, y) {
  return { x: x + 0.5, y: y + 0.5 };
}
function hasLineOfSight(state, ai, target) {
  const dx = target.x - ai.x;
  const dy = target.y - ai.y;
  if (Math.hypot(dx, dy) > 7) return null;
  const alignedX = Math.abs(dx) < 0.55;
  const alignedY = Math.abs(dy) < 0.55;
  if (!alignedX && !alignedY) return null;
  const direction = alignedX ? dy < 0 ? "up" : "down" : dx < 0 ? "left" : "right";
  const d = DIRECTIONS[direction];
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  for (let step = 0.75; step < distance - 0.5; step += 0.25) if (blocksMovement(state, ai.x + d.x * step, ai.y + d.y * step)) return null;
  return direction;
}
function fireAiBullet(state, ai, direction, now) {
  if (ai.bulletId || now < ai.nextFireAt || Object.keys(state.bullets).length >= MAX_BULLETS) return;
  ai.direction = direction;
  const d = DIRECTIONS[direction];
  const id = nextId(state, `bullet:${ai.id}`);
  state.bullets[id] = { id, ownerId: ai.id, ownerKind: "ai", direction, x: ai.x + d.x * 0.5, y: ai.y + d.y * 0.5, speed: BULLET_SPEED * 0.75, steelPiercing: false };
  ai.bulletId = id;
  ai.nextFireAt = now + 2500 + state.sequence % 7 * 250;
}
function brickAhead(state, ai) {
  const map = MAP_BY_ID.get(state.config.mapId);
  const d = DIRECTIONS[ai.direction];
  const x = Math.floor(ai.x + d.x * 0.7);
  const y = Math.floor(ai.y + d.y * 0.7);
  const index = y * map.width + x;
  return !state.destroyedTiles.includes(index) && tileAt(map, x + 0.5, y + 0.5) === "brick";
}
function stepAi(state, ai, now, dt) {
  if (ai.bulletId && !state.bullets[ai.bulletId]) ai.bulletId = null;
  const living = Object.values(state.players).filter((player) => player.alive);
  if (now >= ai.nextDecisionAt || !state.players[ai.targetPlayerId ?? ""]?.alive) {
    const target2 = living.sort((a, b) => Math.abs(a.x - ai.x) + Math.abs(a.y - ai.y) - Math.abs(b.x - ai.x) - Math.abs(b.y - ai.y))[0];
    ai.targetPlayerId = target2?.id ?? null;
    ai.behavior = target2 && Math.hypot(target2.x - ai.x, target2.y - ai.y) <= 10 ? "chase" : "patrol";
    const destination = ai.behavior === "chase" && target2 ? target2 : MAP_BY_ID.get(state.config.mapId).center;
    ai.path = findPath(state, ai, destination);
    ai.nextDecisionAt = now + 1200 + state.sequence % 6 * 180;
  }
  const waypoint = ai.path[0];
  if (waypoint) {
    const dx = waypoint.x - ai.x;
    const dy = waypoint.y - ai.y;
    if (Math.abs(dx) < 0.14 && Math.abs(dy) < 0.14) ai.path.shift();
    else ai.direction = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? "left" : "right" : dy < 0 ? "up" : "down";
  }
  moveTank(state, ai, ai.direction, AI_SPEED, dt);
  if (Math.hypot(ai.x - ai.lastProgressX, ai.y - ai.lastProgressY) >= 0.08) {
    ai.lastProgressX = ai.x;
    ai.lastProgressY = ai.y;
    ai.lastProgressAt = now;
    ai.stuckSince = null;
  } else if (now - ai.lastProgressAt >= 600) {
    ai.stuckSince ??= now;
    ai.behavior = "unstuck";
    ai.path = [];
    ai.direction = ["up", "right", "down", "left"][state.sequence++ % 4];
    ai.nextDecisionAt = now + 700;
    if (now - ai.stuckSince >= 2500) {
      ai.targetPlayerId = null;
      ai.stuckSince = now;
    }
  }
  const target = ai.targetPlayerId ? state.players[ai.targetPlayerId] : void 0;
  const fireDirection = target ? hasLineOfSight(state, ai, target) : null;
  if (fireDirection) fireAiBullet(state, ai, fireDirection, now);
  else if (brickAhead(state, ai)) fireAiBullet(state, ai, ai.direction, now);
}
function stepBullets(state, now, dt) {
  const map = MAP_BY_ID.get(state.config.mapId);
  for (const bullet of Object.values(state.bullets)) {
    const d = DIRECTIONS[bullet.direction];
    bullet.x += d.x * bullet.speed * dt;
    bullet.y += d.y * bullet.speed * dt;
    const tx = Math.floor(bullet.x);
    const ty = Math.floor(bullet.y);
    const index = ty * map.width + tx;
    const tile = tileAt(map, bullet.x, bullet.y);
    const fortified = Object.values(state.bases).some((base) => base.fortifiedUntil > now && base.protectionTiles.includes(index));
    const effectiveTile = fortified && tile === "brick" ? "steel" : tile;
    if (!state.destroyedTiles.includes(index) && (effectiveTile === "brick" || effectiveTile === "steel" || effectiveTile === "water")) {
      if (effectiveTile === "brick" || effectiveTile === "steel" && bullet.steelPiercing) state.destroyedTiles.push(index);
      delete state.bullets[bullet.id];
      continue;
    }
    let consumed = false;
    for (const player of Object.values(state.players)) {
      if (!player.alive || player.id === bullet.ownerId || !overlaps(bullet, player)) continue;
      if (bullet.ownerKind === "player" && state.config.mode === "team2v2" && player.team === bullet.team) {
        consumed = true;
        break;
      }
      killPlayer(state, player, bullet.ownerKind === "player" ? bullet.ownerId : null, now);
      consumed = true;
      break;
    }
    if (consumed) {
      delete state.bullets[bullet.id];
      continue;
    }
    for (const ai of Object.values(state.ai)) {
      if (bullet.ownerKind !== "player" || !overlaps(bullet, ai)) continue;
      delete state.ai[ai.id];
      const owner = state.players[bullet.ownerId];
      if (owner) owner.aiKills += 1;
      consumed = true;
      break;
    }
    if (consumed) {
      delete state.bullets[bullet.id];
      continue;
    }
    if (bullet.ownerKind === "player") for (const base of Object.values(state.bases)) {
      const ownBase = state.config.mode === "team2v2" ? base.team === bullet.team : base.ownerId === bullet.ownerId;
      if (ownBase || !overlaps(bullet, base, 0.7)) continue;
      base.hp = Math.max(0, base.hp - 1);
      delete state.bullets[bullet.id];
      break;
    }
  }
}
function respawnAndCollect(state, now) {
  const map = MAP_BY_ID.get(state.config.mapId);
  const players = Object.values(state.players);
  players.forEach((player, index) => {
    const base = baseFor(state, player);
    if (!player.alive && player.respawnAt && now >= player.respawnAt && base && base.hp > 0) {
      const spawn = state.config.mode === "team2v2" ? map.teamSpawns[player.team][teamPlayers(state, player.team).findIndex((p) => p.id === player.id)] : map.ffaLayouts[players.length].spawns[index];
      Object.assign(player, { alive: true, eliminated: false, x: spawn.x, y: spawn.y, respawnAt: null, shieldUntil: now + 1600 });
    }
    if (base?.hp === 0 && !player.alive) {
      player.respawnAt = null;
      player.eliminated = true;
    }
    if (player.alive) {
      for (const powerUp of Object.values(state.powerUps)) if (overlaps(player, powerUp, 0.65)) {
        applyPowerUp(state, player, powerUp.kind, now);
        delete state.powerUps[powerUp.id];
      }
    }
  });
  for (const powerUp of Object.values(state.powerUps)) if (powerUp.expiresAt <= now) delete state.powerUps[powerUp.id];
}
function factionResult(state) {
  if (state.config.mode === "team2v2") {
    const aliveTeams = ["red", "blue"].filter((team) => {
      const base = state.bases[`team:${team}`];
      return (base?.hp ?? 0) > 0 || teamPlayers(state, team).some((p) => p.alive);
    });
    return aliveTeams.length === 1 ? { winnerTeam: aliveTeams[0], draw: false, reason: "elimination" } : aliveTeams.length === 0 ? { draw: true, reason: "elimination" } : null;
  }
  const contenders = Object.values(state.players).filter((player) => (baseFor(state, player)?.hp ?? 0) > 0 || player.alive);
  return contenders.length === 1 ? { winnerId: contenders[0].id, draw: false, reason: "elimination" } : contenders.length === 0 ? { draw: true, reason: "elimination" } : null;
}
function timeoutResult(state) {
  const score = (players, base) => [(base?.hp ?? 0) > 0 ? 1 : 0, base?.hp ?? 0, players.filter((p) => p.alive).length, players.reduce((n, p) => n + p.kills, 0)];
  const compare = (a, b) => a.findIndex((value, index) => value !== b[index]) < 0 ? 0 : a[a.findIndex((value, index) => value !== b[index])] - b[a.findIndex((value, index) => value !== b[index])];
  if (state.config.mode === "team2v2") {
    const red = score(teamPlayers(state, "red"), state.bases["team:red"]);
    const blue = score(teamPlayers(state, "blue"), state.bases["team:blue"]);
    const result = compare(red, blue);
    return result === 0 ? { draw: true, reason: "timeout" } : { winnerTeam: result > 0 ? "red" : "blue", draw: false, reason: "timeout" };
  }
  const ranked = Object.values(state.players).map((player) => ({ player, score: score([player], baseFor(state, player)) })).sort((a, b) => compare(b.score, a.score));
  return ranked.length < 2 || compare(ranked[0].score, ranked[1].score) !== 0 ? { winnerId: ranked[0]?.player.id, draw: false, reason: "timeout" } : { draw: true, reason: "timeout" };
}
function stepGame(state, now) {
  if (state.phase !== "running") return;
  const dt = Math.min(0.1, Math.max(0, (now - (state.lastTickAt ?? now)) / 1e3));
  state.lastTickAt = now;
  for (const player of Object.values(state.players)) if (player.alive) moveTank(state, player, player.input, PLAYER_SPEED, dt);
  for (const ai of Object.values(state.ai)) stepAi(state, ai, now, dt);
  stepBullets(state, now, dt);
  respawnAndCollect(state, now);
  if (now >= state.nextAiSpawnAt && Object.keys(state.ai).length < MAX_AI) {
    spawnAi(state, now);
    state.nextAiSpawnAt = now + 18e3 + state.sequence % 8 * 1e3;
  }
  if (now >= state.nextPowerUpAt && Object.keys(state.powerUps).length < MAX_POWER_UPS) {
    spawnPowerUp(state, now);
    state.nextPowerUpAt = now + 9e3;
  }
  const result = factionResult(state) ?? (state.deadlineAt && now >= state.deadlineAt ? timeoutResult(state) : null);
  if (result) {
    state.phase = "finished";
    state.result = result;
    for (const player of Object.values(state.players)) player.input = "none";
  }
}
function returnToLobby(state) {
  state.phase = "lobby";
  state.bases = {};
  state.bullets = {};
  state.ai = {};
  state.powerUps = {};
  state.destroyedTiles = [];
  state.startedAt = null;
  state.deadlineAt = null;
  state.lastTickAt = null;
  state.result = null;
  Object.values(state.players).forEach((player) => Object.assign(player, { ready: false, alive: false, eliminated: false, input: "none", respawnAt: null }));
}

// src/game/definition.ts
var DIRECTIONS2 = /* @__PURE__ */ new Set(["up", "down", "left", "right", "none"]);
var tankBattleDefinition = defineGame({
  meta: { name: "\u50CF\u7D20\u5766\u514B\u5927\u6218", minPlayers: 2, maxPlayers: 4 },
  initialState,
  lifecycle: {
    join(ctx, player) {
      if (!ctx.state.hostId) ctx.state.hostId = player.id;
      const existing = ctx.state.players[player.id];
      if (existing) {
        existing.connected = true;
        return;
      }
      ctx.state.players[player.id] = createPlayer(player.id, player.name, Object.keys(ctx.state.players).length);
    },
    reconnect(ctx, player) {
      const existing = ctx.state.players[player.id];
      if (existing) existing.connected = true;
    },
    leave(ctx, player) {
      const leaving = ctx.state.players[player.id];
      if (!leaving) return;
      if (ctx.state.phase === "lobby") delete ctx.state.players[player.id];
      else {
        leaving.connected = false;
        leaving.alive = false;
        leaving.eliminated = true;
        leaving.respawnAt = null;
        leaving.input = "none";
        if (ctx.state.config.mode === "freeForAll" && ctx.state.bases[`player:${player.id}`]) ctx.state.bases[`player:${player.id}`].hp = 0;
      }
      if (ctx.state.hostId === player.id) ctx.state.hostId = Object.values(ctx.state.players).find((candidate) => candidate.connected)?.id ?? null;
    }
  },
  systems: [{
    runOn: "authority",
    intervalMs: 50,
    update(ctx) {
      stepGame(ctx.state, Date.now());
    }
  }],
  actions: {
    "lobby.ready": {
      sync: { mode: "hostRelay" },
      validate(ctx, payload) {
        if (ctx.state.phase !== "lobby" || !ctx.state.players[ctx.actor.id] || typeof payload?.ready !== "boolean") return reject("invalid-ready");
        return accept({ ready: payload.ready });
      },
      reduce(ctx, payload) {
        ctx.state.players[ctx.actor.id].ready = payload.ready;
      }
    },
    "lobby.configure": {
      sync: { mode: "hostAuthoritative" },
      validate(ctx, payload) {
        if (ctx.state.phase !== "lobby" || ctx.actor.id !== ctx.state.hostId) return reject("host-only");
        if (payload?.mode !== "freeForAll" && payload?.mode !== "team2v2") return reject("invalid-mode");
        if (typeof payload.mapId !== "string" || !MAP_BY_ID.has(payload.mapId)) return reject("invalid-map");
        return accept({ mode: payload.mode, mapId: payload.mapId });
      },
      reduce(ctx, payload) {
        ctx.state.config = payload;
        Object.values(ctx.state.players).forEach((player) => {
          player.ready = false;
        });
      }
    },
    "lobby.team": {
      sync: { mode: "hostRelay" },
      validate(ctx, payload) {
        if (ctx.state.phase !== "lobby" || payload?.team !== "red" && payload?.team !== "blue") return reject("invalid-team");
        const nextTeam = payload.team;
        const occupied = Object.values(ctx.state.players).filter((player) => player.team === nextTeam && player.id !== ctx.actor.id).length;
        return occupied >= 2 ? reject("team-full") : accept({ team: nextTeam });
      },
      reduce(ctx, payload) {
        ctx.state.players[ctx.actor.id].team = payload.team;
        ctx.state.players[ctx.actor.id].ready = false;
      }
    },
    "game.start": {
      sync: { mode: "hostAuthoritative" },
      validate(ctx) {
        return ctx.actor.id === ctx.state.hostId && canStart(ctx.state) ? accept(null) : reject("cannot-start");
      },
      reduce(ctx) {
        startMatch(ctx.state, Date.now());
      }
    },
    "player.input": {
      sync: { mode: "hostRelay" },
      validate(ctx, payload) {
        const direction = payload?.direction;
        return ctx.state.phase === "running" && ctx.state.players[ctx.actor.id]?.alive && DIRECTIONS2.has(direction) ? accept({ direction }) : reject("invalid-input");
      },
      reduce(ctx, payload) {
        ctx.state.players[ctx.actor.id].input = payload.direction;
      }
    },
    "player.fire": {
      sync: { mode: "hostAuthoritative" },
      validate(ctx) {
        return ctx.state.phase === "running" && ctx.state.players[ctx.actor.id]?.alive ? accept(null) : reject("cannot-fire");
      },
      reduce(ctx) {
        firePlayer(ctx.state, ctx.actor.id, Date.now());
      }
    },
    "game.rematch": {
      sync: { mode: "hostAuthoritative" },
      validate(ctx) {
        return ctx.state.phase === "finished" && ctx.actor.id === ctx.state.hostId ? accept(null) : reject("host-only");
      },
      reduce(ctx) {
        returnToLobby(ctx.state);
      }
    },
    "game.returnToLobby": {
      sync: { mode: "hostAuthoritative" },
      validate(ctx) {
        return ctx.state.phase === "finished" && ctx.actor.id === ctx.state.hostId ? accept(null) : reject("host-only");
      },
      reduce(ctx) {
        returnToLobby(ctx.state);
      }
    }
  }
});

// src/worker/index.ts
var index_default = createFlowRoom(tankBattleDefinition);
export default index_default;

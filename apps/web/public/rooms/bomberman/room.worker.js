// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";

// src/game/maps.ts
var MAP_WIDTH = 19;
var MAP_HEIGHT = 15;
var spawns = [{ x: 1, y: 1 }, { x: 17, y: 1 }, { x: 1, y: 13 }, { x: 17, y: 13 }];
var safeCells = new Set(spawns.flatMap(({ x, y }) => [[x, y], [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]).map(([x, y]) => `${x},${y}`));
function arena(brickAt) {
  return Array.from({ length: MAP_HEIGHT }, (_, y) => Array.from({ length: MAP_WIDTH }, (_2, x) => {
    if (x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1) return "#";
    if (x % 2 === 0 && y % 2 === 0) return "#";
    if (safeCells.has(`${x},${y}`)) return ".";
    return brickAt(x, y) ? "+" : ".";
  }).join(""));
}
var dense = (seed, x, y) => (x * 17 + y * 29 + seed * 13 + x * y * 3) % 11 < 7;
var MAPS = [
  { id: "garden-cross", name: "\u82D4\u5EAD\u5341\u5B57", theme: "garden", spawns, rows: arena((x, y) => x !== 9 && y !== 7 && dense(1, x, y)) },
  { id: "garden-court", name: "\u85E4\u8513\u5EAD\u9662", theme: "garden", spawns, rows: arena((x, y) => !(x >= 7 && x <= 11 && y >= 5 && y <= 9) && dense(2, x, y)) },
  { id: "frost-bridge", name: "\u971C\u6865", theme: "frost", spawns, rows: arena((x, y) => y !== 7 && !(x === 5 || x === 13) && dense(3, x, y)) },
  { id: "frost-vault", name: "\u51B0\u6676\u7A79\u7A9F", theme: "frost", spawns, rows: arena((x, y) => !(x >= 7 && x <= 11 && y >= 5 && y <= 9) && ((x + y) % 4 !== 0 || dense(4, x, y))) },
  { id: "volcano-core", name: "\u7194\u706B\u6838\u5FC3", theme: "volcano", spawns, rows: arena((x, y) => !(Math.abs(x - 9) <= 2 && Math.abs(y - 7) <= 2) && dense(5, x, y)) },
  { id: "volcano-rift", name: "\u8D64\u7EA2\u88C2\u8C37", theme: "volcano", spawns, rows: arena((x, y) => x !== y + 2 && x !== 16 - y && dense(6, x, y)) },
  { id: "neon-grid", name: "\u9713\u8679\u77E9\u9635", theme: "neon", spawns, rows: arena((x, y) => (x % 4 !== 1 || y % 4 !== 3) && dense(7, x, y)) },
  { id: "neon-loop", name: "\u5149\u8F68\u56DE\u73AF", theme: "neon", spawns, rows: arena((x, y) => !((x === 5 || x === 13) && (y >= 3 && y <= 11)) && !((y === 3 || y === 11) && (x >= 5 && x <= 13)) && dense(8, x, y)) }
];
var getMap = (id) => MAPS.find((map) => map.id === id) ?? MAPS[0];
var cellKey = (x, y) => `${x},${y}`;
var isSolid = (map, x, y, destroyed) => {
  const tile = map.rows[y]?.[x] ?? "#";
  return tile === "#" || tile === "+" && !destroyed.includes(cellKey(x, y));
};

// src/game/rules.ts
var MATCH_MS = 24e4;
var OVERTIME_MS = 3e4;
var RESPAWN_MS = 2e3;
var INVULNERABLE_MS = 2e3;
var NORMAL_BOMB_FUSE_MS = 2500;
var REMOTE_BOMB_FUSE_MS = 5e3;
var BASE_FLAME = 1;
var BASE_CAPACITY = 1;
var BASE_SPEED = 1;
var MAX_FLAME = 4;
var MAX_CAPACITY = 3;
var MAX_SPEED = 3;
var POWERUP_DROP_CHANCE = 0.3;
var KICKED_BOMB_STEP_MS = 100;
function playerSpawn(state, player) {
  const map = getMap(state.mapId);
  return map.spawns[player.spawnIndex % map.spawns.length];
}
function moveDelayFor(player) {
  if (!player.bot) return Math.max(100, 260 - player.speed * 40);
  const base = player.difficulty === "easy" ? 420 : player.difficulty === "hard" ? 280 : 340;
  const minimum = player.difficulty === "easy" ? 320 : player.difficulty === "hard" ? 210 : 260;
  return Math.max(minimum, base - (player.speed - 1) * 25);
}
function canMove(state, player, x, y) {
  return !isSolid(getMap(state.mapId), x, y, state.destroyed) && !state.bombs.some((b) => b.x === x && b.y === y && !(player.x === x && player.y === y));
}
function canBombMoveTo(state, bomb, x, y) {
  return !isSolid(getMap(state.mapId), x, y, state.destroyed) && !state.bombs.some((other) => other.id !== bomb.id && other.x === x && other.y === y);
}
function movePlayer(state, player, direction, now) {
  const x = player.x + direction.dx, y = player.y + direction.dy;
  if (canMove(state, player, x, y)) {
    player.x = x;
    player.y = y;
    return true;
  }
  if (!player.kick) return false;
  const bomb = state.bombs.find((candidate) => candidate.x === x && candidate.y === y);
  if (!bomb || !canBombMoveTo(state, bomb, x + direction.dx, y + direction.dy)) return false;
  bomb.x += direction.dx;
  bomb.y += direction.dy;
  bomb.motion = { ...direction };
  bomb.nextMoveAt = now + KICKED_BOMB_STEP_MS;
  player.x = x;
  player.y = y;
  return true;
}
function blastCells(state, bomb) {
  const map = getMap(state.mapId);
  const result = [{ x: bomb.x, y: bomb.y }];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let n = 1; n <= bomb.flame; n++) {
      const x = bomb.x + dx * n, y = bomb.y + dy * n;
      const tile = map.rows[y]?.[x] ?? "#";
      if (tile === "#") break;
      result.push({ x, y });
      if (tile === "+" && !state.destroyed.includes(cellKey(x, y))) break;
    }
  }
  return result;
}
function leaders(state) {
  const active = Object.values(state.players).filter((p) => !p.waiting);
  const high = Math.max(0, ...active.map((p) => p.score));
  return active.filter((p) => p.score === high).map((p) => p.id);
}
function applyPowerup(player, type) {
  if (type === "flame") player.flame = Math.min(MAX_FLAME, player.flame + 1);
  if (type === "capacity") player.capacity = Math.min(MAX_CAPACITY, player.capacity + 1);
  if (type === "speed") player.speed = Math.min(MAX_SPEED, player.speed + 1);
  if (type === "kick") player.kick = true;
  if (type === "remote") player.remote = true;
}
function resetPlayerAbilities(player) {
  player.flame = BASE_FLAME;
  player.capacity = BASE_CAPACITY;
  player.speed = BASE_SPEED;
  player.kick = false;
  player.remote = false;
}
function bombFuseFor(remote) {
  return remote ? REMOTE_BOMB_FUSE_MS : NORMAL_BOMB_FUSE_MS;
}
function powerupDropForRoll(roll) {
  if (roll < 0 || roll >= POWERUP_DROP_CHANCE) return null;
  const weighted = roll / POWERUP_DROP_CHANCE;
  if (weighted < 0.35) return "flame";
  if (weighted < 0.65) return "capacity";
  if (weighted < 0.85) return "speed";
  if (weighted < 0.95) return "kick";
  return "remote";
}
function deterministicDropRoll(x, y, tick2) {
  const mixed = Math.imul(x + 11, 73856093) ^ Math.imul(y + 17, 19349663) ^ Math.imul(tick2 + 23, 83492791);
  return (mixed >>> 0) / 4294967296;
}
function removePowerupsInCells(powerups, cells) {
  const keys = new Set(cells.map((cell) => cellKey(cell.x, cell.y)));
  return powerups.filter((item) => !keys.has(cellKey(item.x, item.y)));
}
function chooseBotDirection(state, bot) {
  const choices = [{ dx: 1, dy: 0 }, { dx: -1, dy: 0 }, { dx: 0, dy: 1 }, { dx: 0, dy: -1 }];
  const dangerous = (x, y) => state.flames.some((f) => f.cells.some((c) => c.x === x && c.y === y)) || state.bombs.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) <= b.flame);
  const safe = choices.filter((d) => canMove(state, bot, bot.x + d.dx, bot.y + d.dy) && !dangerous(bot.x + d.dx, bot.y + d.dy));
  const pool = safe.length ? safe : choices.filter((d) => canMove(state, bot, bot.x + d.dx, bot.y + d.dy));
  return pool[(state.tick + bot.color * 3) % Math.max(1, pool.length)] ?? { dx: 0, dy: 0 };
}

// src/worker/index.ts
var TICK_MS = 50;
var BOT_NAMES = ["\u94DC\u9489", "\u706B\u82B1", "\u9F7F\u8F6E"];
var sequence = 0;
var freshPlayer = (id, name, color, bot = false, difficulty) => ({
  id,
  name,
  bot,
  difficulty,
  ready: bot,
  connected: true,
  waiting: false,
  x: 1,
  y: 1,
  input: { dx: 0, dy: 0 },
  alive: true,
  score: 0,
  deaths: 0,
  flame: BASE_FLAME,
  capacity: BASE_CAPACITY,
  speed: BASE_SPEED,
  kick: false,
  remote: false,
  respawnAt: 0,
  invulnerableUntil: 0,
  nextMoveAt: 0,
  color,
  spawnIndex: color
});
function resetRound(state, now) {
  state.bombs = [];
  state.flames = [];
  state.powerups = [];
  state.destroyed = [];
  state.winners = [];
  state.overtimeLeaders = [];
  state.startedAt = now;
  state.endsAt = now + MATCH_MS;
  state.overtimeEndsAt = 0;
  state.tick = 0;
  const map = getMap(state.mapId);
  Object.values(state.players).filter((p) => !p.waiting).forEach((p, index) => Object.assign(p, freshPlayer(p.id, p.name, p.color, p.bot, p.difficulty), { ready: p.ready, connected: p.connected, score: 0, spawnIndex: index % 4, x: map.spawns[index % 4].x, y: map.spawns[index % 4].y }));
}
function explode(state, bombId, now) {
  const bomb = state.bombs.find((b) => b.id === bombId);
  if (!bomb) return;
  const cells = blastCells(state, bomb);
  state.bombs = state.bombs.filter((b) => b.id !== bombId);
  const flameId = `flame-${++sequence}`;
  state.flames.push({ id: flameId, ownerId: bomb.ownerId, cells, expiresAt: now + 550 });
  state.powerups = removePowerupsInCells(state.powerups, cells);
  for (const cell of cells) {
    const key = cellKey(cell.x, cell.y);
    const map = getMap(state.mapId);
    if (map.rows[cell.y]?.[cell.x] === "+" && !state.destroyed.includes(key)) {
      state.destroyed.push(key);
      const type = powerupDropForRoll(deterministicDropRoll(cell.x, cell.y, state.tick));
      if (type) state.powerups.push({ id: `item-${++sequence}`, type, x: cell.x, y: cell.y });
    }
    state.bombs.filter((next) => next.x === cell.x && next.y === cell.y).forEach((next) => explode(state, next.id, now));
  }
}
function placeBomb(state, player, now) {
  if (!player.alive || state.bombs.some((b) => b.x === player.x && b.y === player.y)) return;
  if (state.bombs.filter((b) => b.ownerId === player.id).length >= player.capacity) return;
  state.bombs.push({ id: `bomb-${++sequence}`, ownerId: player.id, x: player.x, y: player.y, flame: player.flame, explodeAt: now + bombFuseFor(player.remote), remote: player.remote, motion: { dx: 0, dy: 0 }, nextMoveAt: 0 });
}
function eliminate(state, victim, ownerId, now) {
  if (!victim.alive || victim.invulnerableUntil > now) return;
  victim.alive = false;
  victim.deaths++;
  victim.respawnAt = now + RESPAWN_MS;
  victim.input = { dx: 0, dy: 0 };
  resetPlayerAbilities(victim);
  if (ownerId !== victim.id && state.players[ownerId]) {
    state.players[ownerId].score++;
    if (state.phase === "overtime" && state.overtimeLeaders.includes(ownerId)) {
      state.winners = [ownerId];
      state.phase = "finished";
    }
  }
}
function tick(ctx) {
  const state = ctx.state, now = ctx.now();
  if (state.phase !== "playing" && state.phase !== "overtime") return;
  state.tick++;
  state.flames = state.flames.filter((f) => f.expiresAt > now);
  state.bombs.filter((b) => b.explodeAt <= now).forEach((b) => explode(state, b.id, now));
  for (const bomb of [...state.bombs]) {
    if (!bomb.motion.dx && !bomb.motion.dy || now < bomb.nextMoveAt) continue;
    const nx = bomb.x + bomb.motion.dx, ny = bomb.y + bomb.motion.dy;
    if (canBombMoveTo(state, bomb, nx, ny)) {
      bomb.x = nx;
      bomb.y = ny;
      bomb.nextMoveAt = now + KICKED_BOMB_STEP_MS;
    } else {
      bomb.motion = { dx: 0, dy: 0 };
      bomb.nextMoveAt = 0;
    }
    if (state.flames.some((flame) => flame.cells.some((cell) => cell.x === bomb.x && cell.y === bomb.y))) explode(state, bomb.id, now);
  }
  for (const player of Object.values(state.players).filter((p) => !p.waiting)) {
    if (!player.alive && player.respawnAt <= now) {
      const spawn = playerSpawn(state, player);
      player.x = spawn.x;
      player.y = spawn.y;
      player.alive = true;
      player.invulnerableUntil = now + INVULNERABLE_MS;
      player.nextMoveAt = now + 100;
    }
    if (!player.alive) continue;
    if (player.bot) {
      const interval = player.difficulty === "hard" ? 4 : player.difficulty === "normal" ? 8 : 14;
      if (state.tick % interval === 0) player.input = chooseBotDirection(state, player);
      const adjacentBrick = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => getMap(state.mapId).rows[player.y + dy]?.[player.x + dx] === "+" && !state.destroyed.includes(cellKey(player.x + dx, player.y + dy)));
      if (adjacentBrick && state.tick % (player.difficulty === "hard" ? 16 : 28) === 0) placeBomb(state, player, now);
    }
    const moveDelay = moveDelayFor(player);
    if (now >= player.nextMoveAt && (player.input.dx || player.input.dy)) {
      if (movePlayer(state, player, player.input, now)) player.nextMoveAt = now + moveDelay;
    }
    const item = state.powerups.find((i) => i.x === player.x && i.y === player.y);
    if (item) {
      applyPowerup(player, item.type);
      state.powerups = state.powerups.filter((i) => i.id !== item.id);
    }
    for (const flame of state.flames) if (flame.cells.some((c) => c.x === player.x && c.y === player.y)) eliminate(state, player, flame.ownerId, now);
  }
  if (state.phase === "playing" && now >= state.endsAt) {
    const top = leaders(state);
    if (top.length === 1) {
      state.winners = top;
      state.phase = "finished";
    } else {
      state.phase = "overtime";
      state.overtimeLeaders = top;
      state.overtimeEndsAt = now + OVERTIME_MS;
    }
  }
  if (state.phase === "overtime" && now >= state.overtimeEndsAt) {
    state.winners = leaders(state);
    state.phase = "finished";
  }
  if (state.phase === "playing" || state.phase === "overtime") ctx.setTimer("game-tick", TICK_MS, () => tick(ctx));
}
var index_default = defineRoom({
  meta: { name: "\u7206\u7834\u6D3E\u5BF9", minPlayers: 1, maxPlayers: 4 },
  initialState() {
    return { schema: "bomberman-v1", phase: "lobby", hostId: null, mapId: MAPS[0].id, players: {}, bombs: [], flames: [], powerups: [], destroyed: [], startedAt: 0, endsAt: 0, overtimeEndsAt: 0, overtimeLeaders: [], winners: [], tick: 0 };
  },
  onJoin(ctx, player) {
    const state = ctx.state;
    if (!state.hostId) state.hostId = ctx.host.id;
    const color = Object.keys(state.players).length % 4;
    state.players[player.id] = freshPlayer(player.id, player.name, color, false);
    if (state.phase !== "lobby") state.players[player.id].waiting = true;
  },
  onReconnect(ctx, player) {
    if (ctx.state.players[player.id]) ctx.state.players[player.id].connected = true;
  },
  onLeave(ctx, player) {
    const state = ctx.state;
    const p = state.players[player.id];
    if (!p) return;
    p.connected = false;
    p.ready = false;
    if (state.phase === "lobby") delete state.players[player.id];
    if (player.id === state.hostId) {
      ctx.clearTimer("game-tick");
      state.phase = "lobby";
      state.hostId = ctx.host?.id ?? null;
    }
  },
  actions: {
    "lobby:set-ready"(ctx, { player, payload }) {
      const p = ctx.state.players[player.id];
      if (ctx.state.phase === "lobby" && p && !p.bot) p.ready = payload?.ready === true;
    },
    "lobby:set-map"(ctx, { player, payload }) {
      if (ctx.state.phase === "lobby" && player.id === ctx.state.hostId && MAPS.some((m) => m.id === payload?.mapId)) ctx.state.mapId = payload.mapId;
    },
    "lobby:add-bot"(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== "lobby" || player.id !== state.hostId || Object.keys(state.players).length >= 4) return;
      const difficulty = ["easy", "normal", "hard"].includes(payload?.difficulty) ? payload.difficulty : "normal";
      const index = Object.values(state.players).filter((p) => p.bot).length;
      const id = `bot-${++sequence}`;
      state.players[id] = freshPlayer(id, BOT_NAMES[index % BOT_NAMES.length], Object.keys(state.players).length % 4, true, difficulty);
    },
    "lobby:remove-bot"(ctx, { player, payload }) {
      if (ctx.state.phase === "lobby" && player.id === ctx.state.hostId && ctx.state.players[payload?.botId]?.bot) delete ctx.state.players[payload.botId];
    },
    "lobby:set-bot-difficulty"(ctx, { player, payload }) {
      const bot = ctx.state.players[payload?.botId];
      if (ctx.state.phase === "lobby" && player.id === ctx.state.hostId && bot?.bot && ["easy", "normal", "hard"].includes(payload?.difficulty)) bot.difficulty = payload.difficulty;
    },
    "game:start"(ctx, { player }) {
      const state = ctx.state;
      const humans = Object.values(state.players).filter((p) => !p.bot);
      if (state.phase !== "lobby" || player.id !== state.hostId || Object.keys(state.players).length < 2 || humans.some((p) => !p.ready)) return;
      resetRound(state, ctx.now());
      state.phase = "playing";
      ctx.setTimer("game-tick", TICK_MS, () => tick(ctx));
    },
    "player:move"(ctx, { player, payload }) {
      const p = ctx.state.players[player.id];
      if (!p || p.bot || p.waiting) return;
      const dx = Number(payload?.dx), dy = Number(payload?.dy);
      if (![-1, 0, 1].includes(dx) || ![-1, 0, 1].includes(dy) || Math.abs(dx) + Math.abs(dy) > 1) return;
      p.input = { dx, dy };
    },
    "player:place-bomb"(ctx, { player }) {
      if (ctx.state.phase === "playing" || ctx.state.phase === "overtime") placeBomb(ctx.state, ctx.state.players[player.id], ctx.now());
    },
    "player:detonate"(ctx, { player }) {
      const state = ctx.state;
      if (!state.players[player.id]?.remote) return;
      state.bombs.filter((b) => b.ownerId === player.id && b.remote).forEach((b) => explode(state, b.id, ctx.now()));
    },
    "game:return-to-lobby"(ctx, { player }) {
      const state = ctx.state;
      if (player.id !== state.hostId || state.phase !== "finished") return;
      ctx.clearTimer("game-tick");
      state.phase = "lobby";
      state.bombs = [];
      state.flames = [];
      state.powerups = [];
      state.destroyed = [];
      state.winners = [];
      for (const p of Object.values(state.players)) {
        p.ready = p.bot;
        p.waiting = false;
        p.score = 0;
      }
    }
  }
});
export default index_default;
// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";

// src/shared/constants.ts
var TAU = Math.PI * 2;
var INITIAL_TURN_MS = 15e3;
var TURN_DECAY_MS = 2e3;
var MIN_TURN_MS = 5e3;
var SHOT_FLIGHT_MS = 520;
var WATCHDOG_MS = 2e4;
var BASE_ROTATION_MS = 8e3;
var ZONE_ARC = Math.PI / 5;
var ZONE_CANDIDATES = 16;
var MAX_HEALTH = 3;
var MIN_PLAYERS = 2;
var MAX_PLAYERS = 8;
var TIMING_TOLERANCE_MS = 0.5;
var EVENT_INTERVAL_MIN = 3;
var EVENT_INTERVAL_MAX = 5;
var SLOW_SPEED_FACTOR = 0.7;
var SPEED_UP_FACTOR = 1.5;
var WIDE_WIDTH_FACTOR = 1.5;
var MULTISHOT_MIN = 2;
var MULTISHOT_MAX = 3;

// src/shared/lobby.ts
function lobbyReadiness(players) {
  const waiting = players.filter((p) => p.status === "waiting");
  const readyCount = waiting.filter((p) => p.ready).length;
  if (waiting.length < MIN_PLAYERS || waiting.length > MAX_PLAYERS) {
    return { canStart: false, reason: "too-few-players", playerCount: waiting.length, readyCount };
  }
  if (readyCount !== waiting.length) {
    return { canStart: false, reason: "not-all-ready", playerCount: waiting.length, readyCount };
  }
  return { canStart: true, reason: null, playerCount: waiting.length, readyCount };
}

// src/shared/protocol.ts
var STATE_SCHEMA = "dart-now@1";

// src/shared/rules.ts
function normalizeAngle(angle) {
  const a = angle % TAU;
  return a < 0 ? a + TAU : a;
}
function angularDistance(a, b) {
  const d = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return d > Math.PI ? TAU - d : d;
}
function isValidAngle(angle) {
  return Number.isFinite(angle) && angle >= 0 && angle < TAU;
}
function rotationAngleAt(rotation, elapsed) {
  const turns = (elapsed - rotation.anchorElapsed) / BASE_ROTATION_MS * rotation.speedFactor * rotation.direction;
  return normalizeAngle(rotation.anchorAngle + turns * TAU);
}
function turnDurationForRound(round) {
  return Math.max(MIN_TURN_MS, INITIAL_TURN_MS - (round - 1) * TURN_DECAY_MS);
}
function clampHealth(health) {
  return Math.max(0, Math.min(MAX_HEALTH, health));
}
function pickZoneAngle(darts, random) {
  let bestAngle = 0;
  let bestClearance = -1;
  let ties = 0;
  for (let i = 0; i < ZONE_CANDIDATES; i += 1) {
    const candidate = i * TAU / ZONE_CANDIDATES;
    let clearance = Math.PI;
    for (const dart of darts) {
      const dist = angularDistance(candidate, dart.boardAngle);
      if (dist < clearance) clearance = dist;
    }
    if (clearance > bestClearance + 1e-9) {
      bestClearance = clearance;
      bestAngle = candidate;
      ties = 1;
    } else if (Math.abs(clearance - bestClearance) <= 1e-9) {
      ties += 1;
      if (random() < 1 / ties) bestAngle = candidate;
    }
  }
  return bestAngle;
}
function shuffled(items, random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// src/shared/shot.ts
var VALID_SCORES = /* @__PURE__ */ new Set([10, 30, 60, 100]);
function near(a, b) {
  return Math.abs(a - b) <= TIMING_TOLERANCE_MS;
}
function validateShotCommit(ctx, playerId, commit) {
  const { turn } = ctx;
  if (ctx.phase !== "playing" || !turn) return { ok: false, reason: "NO_ACTIVE_TURN" };
  if (playerId !== turn.playerId) return { ok: false, reason: "NOT_CURRENT_PLAYER" };
  if (commit.turnId !== turn.id || commit.revision !== turn.revision) {
    return { ok: false, reason: "STALE_TURN" };
  }
  if (turn.acceptedShotIds.includes(commit.shotId)) return { ok: false, reason: "DUPLICATE" };
  if (commit.seq !== turn.lastAcceptedSeq + 1) return { ok: false, reason: "OUT_OF_ORDER" };
  if (!Number.isFinite(commit.windowElapsed) || commit.windowElapsed < 0 || commit.windowElapsed > turn.durationMs || !near(commit.fireElapsed, turn.logicalElapsed + commit.windowElapsed) || commit.fireElapsed > turn.durationMs + TIMING_TOLERANCE_MS || !near(commit.impactElapsed, commit.fireElapsed + SHOT_FLIGHT_MS)) {
    return { ok: false, reason: "BAD_TIMING" };
  }
  if (!isValidAngle(commit.boardAngle)) return { ok: false, reason: "BAD_ANGLE" };
  if (commit.widthFactor !== turn.dartWidth) return { ok: false, reason: "BAD_WIDTH" };
  const ra = commit.rotationAfter;
  if (!near(ra.anchorElapsed, commit.impactElapsed) || !isValidAngle(ra.anchorAngle)) {
    return { ok: false, reason: "BAD_ROTATION" };
  }
  if (commit.outcome.zoneEffect?.kind === "slow") {
    if (ra.speedFactor !== SLOW_SPEED_FACTOR || ra.direction !== 1) {
      return { ok: false, reason: "BAD_ROTATION" };
    }
  } else if (ra.speedFactor !== ctx.rotation.speedFactor || ra.direction !== ctx.rotation.direction) {
    return { ok: false, reason: "BAD_ROTATION" };
  }
  const { outcome } = commit;
  if (outcome.collision) {
    if (!ctx.darts.some((d) => d.id === outcome.collision.targetShotId)) {
      return { ok: false, reason: "BAD_COLLISION_TARGET" };
    }
    if (outcome.score !== 0 || outcome.zoneEffect !== null) {
      return { ok: false, reason: "BAD_COLLISION_RESULT" };
    }
  } else if (!VALID_SCORES.has(outcome.score)) {
    return { ok: false, reason: "BAD_SCORE" };
  }
  if (outcome.zoneEffect) {
    const expected = {
      heal: "heal_zone",
      slow: "slow_zone",
      wide: "wide_zone",
      multishot: "multishot_zone"
    };
    if (!ctx.event || ctx.event.kind !== expected[outcome.zoneEffect.kind]) {
      return { ok: false, reason: "BAD_ZONE_EFFECT" };
    }
  }
  return { ok: true };
}
function applyShotOutcome(target, playerId, commit, opts) {
  const player = target.players[playerId];
  if (!player || !target.turn) {
    throw new Error("applyShotOutcome: missing player or turn");
  }
  const turn = target.turn;
  turn.committed += 1;
  turn.lastAcceptedSeq = commit.seq;
  turn.acceptedShotIds.push(commit.shotId);
  turn.logicalElapsed = commit.impactElapsed;
  player.stats.shots += 1;
  const healthBefore = player.health;
  let healthReason = null;
  let scoreDelta = 0;
  if (commit.outcome.collision) {
    player.health = clampHealth(player.health - 1);
    player.stats.collisions += 1;
    healthReason = "collision";
  } else {
    target.darts.push({
      id: commit.shotId,
      ownerId: playerId,
      boardAngle: commit.boardAngle,
      widthFactor: commit.widthFactor
    });
    player.score += commit.outcome.score;
    player.stats.safeHits += 1;
    scoreDelta = commit.outcome.score;
  }
  const zoneEffect = commit.outcome.zoneEffect;
  if (zoneEffect) {
    switch (zoneEffect.kind) {
      case "heal":
        player.health = clampHealth(player.health + 1);
        healthReason = "zone";
        break;
      case "wide":
        player.nextTurnWidth = WIDE_WIDTH_FACTOR;
        break;
      case "multishot":
        player.nextTurnShots = opts?.multishotShots ?? MULTISHOT_MAX;
        break;
      case "slow":
        break;
    }
  }
  target.rotation = { ...commit.rotationAfter };
  let eliminated = false;
  if (player.status === "alive" && player.health <= 0) {
    player.status = "eliminated";
    eliminated = true;
  }
  return {
    playerId,
    collisionTargetId: commit.outcome.collision?.targetShotId ?? null,
    scoreDelta,
    zoneEffect,
    healthBefore,
    healthAfter: player.health,
    healthReason,
    eliminated
  };
}
function timeoutDamage(turn) {
  return Math.max(0, turn.required - turn.committed);
}

// src/worker/context.ts
function asCtx(ctx) {
  return ctx;
}

// src/worker/events.ts
var EVENT_KINDS = [
  "speed_up",
  "reverse",
  "heal_zone",
  "slow_zone",
  "wide_zone",
  "multishot_zone"
];
function rollEventInterval(random) {
  return EVENT_INTERVAL_MIN + Math.floor(random() * (EVENT_INTERVAL_MAX - EVENT_INTERVAL_MIN + 1));
}
function rollMultishotCount(random) {
  return MULTISHOT_MIN + Math.floor(random() * (MULTISHOT_MAX - MULTISHOT_MIN + 1));
}
function triggerRandomEvent(ctx) {
  const { state } = ctx;
  const candidates = EVENT_KINDS.filter((k) => k !== state.lastEventKind);
  const kind = candidates[Math.floor(ctx.random() * candidates.length)];
  let speedFactor = 1;
  let direction = 1;
  if (kind === "speed_up") speedFactor = SPEED_UP_FACTOR;
  if (kind === "reverse") direction = -1;
  state.rotation = {
    anchorAngle: state.rotation.anchorAngle,
    anchorElapsed: 0,
    speedFactor,
    direction
  };
  const zoneAngle = kind.endsWith("_zone") ? pickZoneAngle(state.darts, ctx.random) : null;
  state.event = { kind, zoneAngle };
  state.lastEventKind = kind;
  state.shotsSinceEvent = 0;
  state.nextEventAt = rollEventInterval(ctx.random);
  state.eventDue = false;
  ctx.broadcast("dart:event", { event: state.event });
}

// src/worker/turns.ts
var WATCHDOG_TIMER = "turn-watchdog";
function normalizeRotationAt(state, elapsed) {
  state.rotation = {
    anchorAngle: rotationAngleAt(state.rotation, elapsed),
    anchorElapsed: 0,
    speedFactor: state.rotation.speedFactor,
    direction: state.rotation.direction
  };
}
function eliminate(ctx, player) {
  if (player.status !== "alive") return;
  player.status = "eliminated";
  ctx.broadcast("dart:player-eliminated", { playerId: player.id });
}
function armWatchdog(ctx) {
  ctx.setTimer(WATCHDOG_TIMER, WATCHDOG_MS, () => {
    applyTimeout(ctx, true);
  });
}
function beginTurn(ctx, playerId) {
  const { state } = ctx;
  const player = state.players[playerId];
  if (!player) return;
  state.turnRevision += 1;
  state.turn = {
    id: `turn-${state.turnRevision}-${playerId}`,
    revision: state.turnRevision,
    playerId,
    required: player.nextTurnShots,
    committed: 0,
    durationMs: turnDurationForRound(state.round),
    dartWidth: player.nextTurnWidth,
    logicalElapsed: 0,
    lastAcceptedSeq: 0,
    acceptedShotIds: []
  };
  player.nextTurnShots = 1;
  player.nextTurnWidth = 1;
  ctx.broadcast("dart:turn-granted", { turn: state.turn });
  armWatchdog(ctx);
}
function advanceTurn(ctx) {
  const { state } = ctx;
  ctx.clearTimer(WATCHDOG_TIMER);
  state.turn = null;
  if (finishIfNeeded(ctx)) return;
  if (state.eventDue) triggerRandomEvent(ctx);
  const order = state.activeOrder;
  const from = state.currentIndex;
  for (let step = 1; step <= order.length; step += 1) {
    const next = (from + step) % order.length;
    const candidate = state.players[order[next]];
    if (candidate?.status === "alive") {
      if (next <= from) {
        state.round += 1;
        ctx.broadcast("dart:round-started", {
          round: state.round,
          durationMs: turnDurationForRound(state.round)
        });
      }
      state.currentIndex = next;
      beginTurn(ctx, candidate.id);
      return;
    }
  }
  finishGame(ctx, null);
}
function finishIfNeeded(ctx) {
  const { state } = ctx;
  if (state.phase !== "playing") return false;
  const alive = state.activeOrder.filter((id) => state.players[id]?.status === "alive");
  if (alive.length > 1) return false;
  finishGame(ctx, alive[0] ?? null);
  return true;
}
function finishGame(ctx, winnerId) {
  const { state } = ctx;
  ctx.clearTimer(WATCHDOG_TIMER);
  state.phase = "finished";
  state.turn = null;
  state.winnerId = winnerId;
  ctx.broadcast("dart:game-over", { winnerId });
}
function applyAcceptedShot(ctx, playerId, commit) {
  const { state } = ctx;
  const turn = state.turn;
  if (!turn) return;
  const effects = applyShotOutcome(state, playerId, commit, {
    // 多镖支数由 Worker 随机裁定（2~3），客户端预测值随下回合快照覆盖
    multishotShots: commit.outcome.zoneEffect?.kind === "multishot" ? rollMultishotCount(ctx.random) : void 0
  });
  state.boardRevision += 1;
  state.shotsSinceEvent += 1;
  if (state.shotsSinceEvent >= state.nextEventAt) state.eventDue = true;
  ctx.broadcast("dart:shot-committed", { commit, playerId });
  if (effects.zoneEffect && state.event) {
    ctx.broadcast("dart:zone-triggered", {
      playerId,
      effect: effects.zoneEffect,
      eventKind: state.event.kind
    });
  }
  if (effects.healthAfter !== effects.healthBefore && effects.healthReason) {
    ctx.broadcast("dart:health-changed", {
      playerId,
      health: effects.healthAfter,
      delta: effects.healthAfter - effects.healthBefore,
      reason: effects.healthReason
    });
  }
  if (effects.eliminated) {
    const player = state.players[playerId];
    if (player) eliminate(ctx, player);
  }
  if (effects.eliminated || turn.committed >= turn.required) {
    normalizeRotationAt(state, turn.logicalElapsed);
    advanceTurn(ctx);
  }
}
function isTimeoutCommitValid(state, playerId, commit) {
  const turn = state.turn;
  if (state.phase !== "playing" || !turn) return false;
  if (playerId !== turn.playerId) return false;
  if (commit.turnId !== turn.id || commit.revision !== turn.revision) return false;
  const finalElapsed = Math.max(turn.durationMs, turn.logicalElapsed);
  if (Math.abs(commit.finalElapsed - finalElapsed) > TIMING_TOLERANCE_MS) return false;
  const expectedAngle = rotationAngleAt(state.rotation, finalElapsed);
  const angleTolerance = TIMING_TOLERANCE_MS / BASE_ROTATION_MS * TAU * state.rotation.speedFactor + 1e-9;
  return angularDistance(commit.rotationEndAngle, expectedAngle) <= angleTolerance;
}
function applyTimeout(ctx, watchdog) {
  const { state } = ctx;
  const turn = state.turn;
  if (state.phase !== "playing" || !turn) return;
  const player = state.players[turn.playerId];
  const damage = timeoutDamage(turn);
  const finalElapsed = Math.max(turn.durationMs, turn.logicalElapsed);
  normalizeRotationAt(state, finalElapsed);
  ctx.broadcast("dart:timeout", { playerId: turn.playerId, damage, watchdog });
  if (player && damage > 0) {
    const before = player.health;
    player.health = clampHealth(player.health - damage);
    player.stats.timeouts += 1;
    state.boardRevision += 1;
    if (player.health !== before) {
      ctx.broadcast("dart:health-changed", {
        playerId: player.id,
        health: player.health,
        delta: player.health - before,
        reason: watchdog ? "connection-timeout" : "turn-timeout"
      });
    }
    if (player.health <= 0) eliminate(ctx, player);
  }
  advanceTurn(ctx);
}
function resetGameData(player) {
  player.health = MAX_HEALTH;
  player.score = 0;
  player.stats = { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 };
  player.nextTurnShots = 1;
  player.nextTurnWidth = 1;
}

// src/worker/index.ts
function newPlayer(player, status) {
  return {
    id: player.id,
    name: player.name,
    isHost: player.role === "host",
    status,
    connected: true,
    ready: false,
    seat: -1,
    health: MAX_HEALTH,
    score: 0,
    stats: { shots: 0, safeHits: 0, collisions: 0, timeouts: 0 },
    nextTurnShots: 1,
    nextTurnWidth: 1
  };
}
function lobbyError(ctx, playerId, reason) {
  ctx.send(playerId, "dart:lobby-error", { reason });
}
function startGame(ctx, player) {
  const { state } = ctx;
  if (state.phase !== "lobby") return lobbyError(ctx, player.id, "bad-phase");
  if (player.id !== state.hostId) return lobbyError(ctx, player.id, "not-host");
  const waiting = Object.values(state.players).filter((p) => p.status === "waiting");
  const readiness = lobbyReadiness(waiting);
  if (!readiness.canStart) return lobbyError(ctx, player.id, readiness.reason ?? "bad-phase");
  const order = shuffled(
    waiting.map((p) => p.id),
    ctx.random
  );
  state.activeOrder = order;
  order.forEach((id, seat) => {
    const p = state.players[id];
    p.status = "alive";
    p.seat = seat;
    resetGameData(p);
  });
  state.currentIndex = 0;
  state.round = 1;
  state.turn = null;
  state.darts = [];
  state.rotation = {
    anchorAngle: ctx.random() * TAU,
    anchorElapsed: 0,
    speedFactor: 1,
    direction: 1
  };
  state.event = null;
  state.lastEventKind = null;
  state.shotsSinceEvent = 0;
  state.nextEventAt = rollEventInterval(ctx.random);
  state.eventDue = false;
  state.winnerId = null;
  state.boardRevision += 1;
  state.phase = "playing";
  ctx.broadcast("dart:game-started", { activeOrder: order });
  beginTurn(ctx, order[0]);
}
function returnToLobby(ctx, player) {
  const { state } = ctx;
  if (state.phase !== "finished") return lobbyError(ctx, player.id, "not-finished");
  if (player.id !== state.hostId) return lobbyError(ctx, player.id, "not-host");
  for (const p of Object.values(state.players)) {
    if (!p.connected) {
      delete state.players[p.id];
    } else {
      p.status = "waiting";
      p.ready = false;
      p.seat = -1;
      resetGameData(p);
    }
  }
  state.phase = "lobby";
  state.activeOrder = [];
  state.currentIndex = 0;
  state.turn = null;
  state.darts = [];
  state.event = null;
  state.lastEventKind = null;
  state.eventDue = false;
  state.winnerId = null;
  state.round = 1;
  state.boardRevision += 1;
}
var index_default = defineRoom({
  meta: { name: "\u98DE\u9556\u65F6\u523B", minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS },
  initialState() {
    return {
      schema: STATE_SCHEMA,
      phase: "lobby",
      hostId: null,
      players: {},
      activeOrder: [],
      currentIndex: 0,
      turn: null,
      rotation: { anchorAngle: 0, anchorElapsed: 0, speedFactor: 1, direction: 1 },
      darts: [],
      event: null,
      lastEventKind: null,
      shotsSinceEvent: 0,
      nextEventAt: rollEventInterval(Math.random),
      eventDue: false,
      boardRevision: 0,
      turnRevision: 0,
      winnerId: null,
      round: 1
    };
  },
  onCreate(ctxRaw) {
    const ctx = asCtx(ctxRaw);
    ctx.state.hostId = ctx.host.id;
  },
  // 房主刷新恢复：重新武装看门狗，避免回合永久悬停
  onRestore(ctxRaw) {
    const ctx = asCtx(ctxRaw);
    if (ctx.state.phase === "playing" && ctx.state.turn) armWatchdog(ctx);
  },
  onJoin(ctxRaw, player) {
    const ctx = asCtx(ctxRaw);
    const { state } = ctx;
    if (!state.hostId || player.role === "host") state.hostId = ctx.host.id;
    if (state.players[player.id]) return;
    state.players[player.id] = newPlayer(player, state.phase === "lobby" ? "waiting" : "queued");
  },
  onLeave(ctxRaw, player) {
    const ctx = asCtx(ctxRaw);
    const { state } = ctx;
    const p = state.players[player.id];
    if (!p) return;
    if (state.phase === "playing") {
      p.connected = false;
      p.ready = false;
    } else {
      delete state.players[player.id];
    }
  },
  onReconnect(ctxRaw, player) {
    const ctx = asCtx(ctxRaw);
    const { state } = ctx;
    if (!state.hostId || player.role === "host") state.hostId = ctx.host.id;
    const p = state.players[player.id];
    if (p) {
      p.connected = true;
      p.name = player.name;
    } else {
      state.players[player.id] = newPlayer(player, state.phase === "lobby" ? "waiting" : "queued");
    }
  },
  actions: {
    toggle_ready(ctxRaw, { player }) {
      const ctx = asCtx(ctxRaw);
      const { state } = ctx;
      if (state.phase !== "lobby") return lobbyError(ctx, player.id, "bad-phase");
      const p = state.players[player.id];
      if (!p || p.status !== "waiting") return lobbyError(ctx, player.id, "unknown-player");
      p.ready = !p.ready;
    },
    start_game(ctxRaw, { player }) {
      startGame(asCtx(ctxRaw), player);
    },
    accept_turn(ctxRaw, { player, payload }) {
      const ctx = asCtx(ctxRaw);
      const turn = ctx.state.turn;
      const p = payload;
      if (!turn || !p) return;
      if (player.id !== turn.playerId) return;
      if (p.turnId !== turn.id || p.revision !== turn.revision) return;
      armWatchdog(ctx);
    },
    commit_shot(ctxRaw, { player, payload }) {
      const ctx = asCtx(ctxRaw);
      const commit = payload;
      const result = validateShotCommit(ctx.state, player.id, commit);
      if (!result.ok) {
        if (result.reason === "DUPLICATE") return;
        ctx.send(player.id, "dart:commit-rejected", {
          turnId: commit?.turnId ?? "",
          revision: commit?.revision ?? 0,
          reason: result.reason,
          boardRevision: ctx.state.boardRevision
        });
        return;
      }
      applyAcceptedShot(ctx, player.id, commit);
    },
    commit_timeout(ctxRaw, { player, payload }) {
      const ctx = asCtx(ctxRaw);
      const commit = payload;
      if (!isTimeoutCommitValid(ctx.state, player.id, commit)) return;
      applyTimeout(ctx, false);
    },
    return_to_lobby(ctxRaw, { player }) {
      returnToLobby(asCtx(ctxRaw), player);
    }
  }
});
export default index_default;

// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";

// src/worker/rules.ts
var SUITS = ["m", "p", "s"];
var KINDS = SUITS.flatMap((suit) => Array.from({ length: 9 }, (_, index) => `${suit}${index + 1}`));
function createDeck() {
  const deck = [];
  for (const kind of [...KINDS, "z"]) {
    for (let copy = 0; copy < 4; copy += 1) deck.push({ id: `${kind}-${copy}`, kind });
  }
  return deck;
}
function shuffle(values, random) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
function sortTiles(tiles) {
  return [...tiles].sort((a, b) => kindIndex(a.kind) - kindIndex(b.kind) || a.id.localeCompare(b.id));
}
function analyzeWin(tiles, melds) {
  const wild = tiles.filter((tile) => tile.kind === "z").length;
  const counts = KINDS.map((kind) => tiles.filter((tile) => tile.kind === kind).length);
  const groupsNeeded = 4 - melds.length;
  const tileCountValid = tiles.length === groupsNeeded * 3 + 2;
  const sevenPairs = melds.length === 0 && tiles.length === 14 && canSevenPairs(counts, wild);
  const standardResult = tileCountValid ? canStandard(counts, wild, groupsNeeded) : null;
  const standard = Boolean(standardResult);
  const visibleKinds = [...tiles, ...melds.flatMap((meld) => meld.tiles)].filter((tile) => tile.kind !== "z").map((tile) => tile.kind[0]);
  const pureSuit = visibleKinds.length > 0 && new Set(visibleKinds).size === 1;
  const meldsAllPungs = melds.every((meld) => meld.kind !== "chi");
  return {
    winning: standard || sevenPairs,
    standard,
    sevenPairs,
    allPungs: Boolean(standardResult?.allPungs && meldsAllPungs),
    pureSuit
  };
}
function canSevenPairs(counts, wild) {
  const odd = counts.filter((count) => count % 2 === 1).length;
  return odd <= wild && (wild - odd) % 2 === 0;
}
function canStandard(counts, wild, groupsNeeded) {
  for (let pairIndex = -1; pairIndex < counts.length; pairIndex += 1) {
    const next = [...counts];
    const natural = pairIndex < 0 ? 0 : Math.min(2, next[pairIndex]);
    const needed = 2 - natural;
    if (needed > wild) continue;
    if (pairIndex >= 0) next[pairIndex] -= natural;
    const groupResult = consumeGroups(next, wild - needed, groupsNeeded);
    if (groupResult) return groupResult;
  }
  return null;
}
function consumeGroups(counts, wild, groupsLeft) {
  const remaining = counts.reduce((sum, count) => sum + count, 0) + wild;
  if (groupsLeft === 0) return remaining === 0 ? { allPungs: true } : null;
  if (remaining !== groupsLeft * 3) return null;
  const first = counts.findIndex((count) => count > 0);
  if (first < 0) return wild === groupsLeft * 3 ? { allPungs: true } : null;
  const pungCounts = [...counts];
  const naturalPung = Math.min(3, pungCounts[first]);
  const pungWild = 3 - naturalPung;
  if (pungWild <= wild) {
    pungCounts[first] -= naturalPung;
    const result = consumeGroups(pungCounts, wild - pungWild, groupsLeft - 1);
    if (result) return { allPungs: result.allPungs };
  }
  const rank = first % 9;
  if (rank <= 6) {
    const sequenceCounts = [...counts];
    let sequenceWild = 0;
    for (const index of [first, first + 1, first + 2]) {
      if (sequenceCounts[index] > 0) sequenceCounts[index] -= 1;
      else sequenceWild += 1;
    }
    if (sequenceWild <= wild) {
      const result = consumeGroups(sequenceCounts, wild - sequenceWild, groupsLeft - 1);
      if (result) return { allPungs: false };
    }
  }
  return null;
}
function scoreWin(config, features) {
  const patterns = [];
  if (features.standard && !features.allPungs && !features.pureSuit) patterns.push({ name: "\u5E73\u80E1", fan: 1 });
  if (features.selfDraw) patterns.push({ name: "\u81EA\u6478", fan: 1 });
  if (features.allPungs) patterns.push({ name: "\u78B0\u78B0\u80E1", fan: 2 });
  if (features.pureSuit) patterns.push({ name: "\u6E05\u4E00\u8272", fan: 3 });
  if (features.sevenPairs) patterns.push({ name: "\u4E03\u5BF9", fan: 2 });
  if (features.gangBloom) patterns.push({ name: "\u6760\u4E0A\u82B1", fan: 1 });
  const rawFan = patterns.reduce((sum, pattern) => sum + pattern.fan, 0);
  const fan = Math.min(config.maxFan, rawFan);
  const eventMultiplier = (features.robGang ? 2 : 1) * (features.lastTile ? 2 : 1);
  return { fan, rawFan, patterns, eventMultiplier, points: config.baseScore * 2 ** fan * eventMultiplier };
}
function scoreGang(kind, baseScore) {
  if (kind === "concealed") return { winner: baseScore * 6, payments: [baseScore * 2, baseScore * 2, baseScore * 2] };
  if (kind === "discard") return { winner: baseScore * 6, payments: [baseScore * 6] };
  return { winner: baseScore * 3, payments: [baseScore, baseScore, baseScore] };
}
function rankReactions(claims, discarderSeat, multiWin) {
  const priority = { win: 3, gang: 2, peng: 2, chi: 1 };
  const sorted = [...claims].sort((a, b) => priority[b.kind] - priority[a.kind] || seatDistance(a.seat, discarderSeat) - seatDistance(b.seat, discarderSeat));
  if (sorted[0]?.kind === "win" && multiWin) return sorted.filter((claim) => claim.kind === "win");
  return sorted.slice(0, 1);
}
function seatDistance(seat, fromSeat) {
  return (seat - fromSeat + 4) % 4;
}
function tileSuit(kind) {
  return kind === "z" ? null : kind[0];
}
function tileRank(kind) {
  return kind === "z" ? 0 : Number(kind[1]);
}
function kindIndex(kind) {
  return kind === "z" ? 27 : KINDS.indexOf(kind);
}

// src/worker/index.ts
var hands = {};
var wall = [];
var reaction = null;
var lastDrawWasGang = false;
var actionSequence = 0;
var roundStartingScores = [0, 0, 0, 0];
var DEFAULT_RULES = { winSource: "both", allowChi: true, allowMultiWin: true, allowRobGang: true, allowLastTile: true, rounds: 4, baseScore: 1, maxFan: 8 };
var index_default = defineRoom({
  meta: { name: "\u8D85\u7EA7\u9EBB\u5C06", minPlayers: 1, maxPlayers: 4 },
  initialState: () => initialState(),
  onRestore(ctx) {
    clearSecrets();
    ctx.state.phase = "lobby";
    ctx.state.currentSeat = null;
    ctx.state.reaction = null;
    ctx.state.lastDiscard = null;
    ctx.state.result = null;
    ctx.state.message = "\u623F\u4E3B\u6062\u590D\u4E86\u623F\u95F4\uFF0C\u5F53\u524D\u5C0F\u5C40\u5DF2\u5B89\u5168\u4E2D\u6B62\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907";
    for (const seat of occupied(ctx.state)) {
      seat.ready = false;
      seat.handCount = 0;
      seat.melds = [];
      seat.discards = [];
    }
  },
  onJoin(ctx, player) {
    const existing = ctx.state.seats.find((seat) => seat?.id === player.id);
    if (existing) {
      existing.connected = true;
      existing.name = player.name;
      sendPrivate(ctx, existing.seat);
      return;
    }
    if (ctx.state.phase !== "lobby") {
      ctx.kick(player.id, "\u724C\u5C40\u8FDB\u884C\u4E2D");
      return;
    }
    const index = ctx.state.seats.findIndex((seat) => seat === null || seat.bot);
    if (index < 0) {
      ctx.kick(player.id, "\u623F\u95F4\u5DF2\u6EE1");
      return;
    }
    ctx.state.seats[index] = makeSeat(player.id, player.name, index, false);
    if (!ctx.state.hostId) ctx.state.hostId = player.id;
    ctx.state.message = "\u8C03\u6574\u89C4\u5219\uFF0C\u6240\u6709\u771F\u4EBA\u51C6\u5907\u540E\u5373\u53EF\u5F00\u5C40";
  },
  onReconnect(ctx, player) {
    const seat = ctx.state.seats.find((candidate) => candidate?.id === player.id);
    if (seat) {
      seat.connected = true;
      seat.name = player.name;
      sendPrivate(ctx, seat.seat);
    }
  },
  onLeave(ctx, player) {
    const seat = ctx.state.seats.find((candidate) => candidate?.id === player.id);
    if (!seat) return;
    if (ctx.state.phase === "lobby" || ctx.state.phase === "matchEnd") ctx.state.seats[seat.seat] = null;
    else {
      seat.connected = false;
      seat.name = `${seat.name}\uFF08\u6258\u7BA1\uFF09`;
      scheduleBots(ctx);
    }
  },
  actions: {
    configureRules(ctx, { player, payload }) {
      if (ctx.state.phase !== "lobby" || player.id !== ctx.state.hostId) return;
      ctx.state.rules = normalizeRules(payload, ctx.state.rules);
    },
    setReady(ctx, { player, payload }) {
      if (ctx.state.phase !== "lobby") return;
      const seat = seatForPlayer(ctx.state, player.id);
      if (!seat) return;
      seat.ready = Boolean(payload?.ready);
    },
    startMatch(ctx, { player }) {
      if (ctx.state.phase !== "lobby" || player.id !== ctx.state.hostId) return;
      const humans = occupied(ctx.state).filter((seat) => !seat.bot);
      if (humans.length === 0 || humans.some((seat) => !seat.ready)) {
        ctx.send(player.id, "mahjong:notice", { message: "\u8BF7\u7B49\u5F85\u6240\u6709\u771F\u4EBA\u51C6\u5907" });
        return;
      }
      fillBots(ctx.state);
      ctx.state.roundIndex = 0;
      ctx.state.dealerSeat = 0;
      for (const seat of occupied(ctx.state)) seat.score = 0;
      startRound(ctx);
    },
    discard(ctx, { player, payload }) {
      const seat = seatForPlayer(ctx.state, player.id);
      if (!seat || !seat.connected) return;
      discardFromSeat(ctx, seat.seat, String(payload?.tileId ?? ""));
    },
    passReaction(ctx, { player }) {
      submitHumanReaction(ctx, player.id, null);
    },
    chi(ctx, { player, payload }) {
      submitHumanReaction(ctx, player.id, { kind: "chi", tiles: validIds(payload?.tileIds) });
    },
    peng(ctx, { player }) {
      submitHumanReaction(ctx, player.id, { kind: "peng" });
    },
    gang(ctx, { player, payload }) {
      const seat = seatForPlayer(ctx.state, player.id);
      if (!seat || !seat.connected) return;
      if (ctx.state.phase === "reaction") submitHumanReaction(ctx, player.id, { kind: "gang" });
      else declareOwnGang(ctx, seat.seat, String(payload?.kind ?? ""));
    },
    declareWin(ctx, { player }) {
      const seat = seatForPlayer(ctx.state, player.id);
      if (!seat || !seat.connected) return;
      if (ctx.state.phase === "reaction") submitHumanReaction(ctx, player.id, { kind: "win" });
      else if (ctx.state.phase === "playing" && ctx.state.currentSeat === seat.seat) settleWins(ctx, [seat.seat], null, false);
    },
    syncPrivate(ctx, { player }) {
      const seat = seatForPlayer(ctx.state, player.id);
      if (seat) sendPrivate(ctx, seat.seat);
    },
    nextRound(ctx, { player }) {
      if (player.id !== ctx.state.hostId || ctx.state.phase !== "settlement") return;
      ctx.state.roundIndex += 1;
      ctx.state.dealerSeat = (ctx.state.dealerSeat + 1) % 4;
      startRound(ctx);
    },
    restartMatch(ctx, { player }) {
      if (player.id !== ctx.state.hostId || ctx.state.phase !== "matchEnd" && ctx.state.phase !== "settlement") return;
      clearSecrets();
      ctx.state.phase = "lobby";
      ctx.state.roundIndex = 0;
      ctx.state.result = null;
      ctx.state.currentSeat = null;
      ctx.state.seats = ctx.state.seats.map((seat) => seat?.bot ? null : seat ? { ...seat, ready: false, score: 0, dealer: false, handCount: 0, melds: [], discards: [] } : null);
      ctx.state.message = "\u65B0\u6BD4\u8D5B\uFF0C\u8BF7\u51C6\u5907";
    }
  }
});
function initialState() {
  return { phase: "lobby", rules: { ...DEFAULT_RULES }, seats: [null, null, null, null], hostId: null, roundIndex: 0, dealerSeat: 0, currentSeat: null, wallCount: 0, lastDiscard: null, reaction: null, result: null, message: "\u7B49\u5F85\u73A9\u5BB6\u52A0\u5165" };
}
function makeSeat(id, name, seat, bot) {
  return { id, name, seat, bot, connected: true, ready: bot, score: 0, dealer: false, handCount: 0, melds: [], discards: [] };
}
function occupied(state) {
  return state.seats.filter((seat) => Boolean(seat));
}
function seatForPlayer(state, id) {
  return state.seats.find((seat) => seat?.id === id) ?? null;
}
function validIds(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
}
function normalizeRules(raw, current) {
  const source = raw && typeof raw === "object" ? raw : {};
  const winSource = ["both", "selfDrawOnly", "discardOnly"].includes(source.winSource) ? source.winSource : current.winSource;
  const rounds = [1, 4, 8].includes(Number(source.rounds)) ? Number(source.rounds) : current.rounds;
  return { winSource, rounds, allowChi: bool(source.allowChi, current.allowChi), allowMultiWin: bool(source.allowMultiWin, current.allowMultiWin), allowRobGang: bool(source.allowRobGang, current.allowRobGang), allowLastTile: bool(source.allowLastTile, current.allowLastTile), baseScore: clampInt(source.baseScore, 1, 10, current.baseScore), maxFan: clampInt(source.maxFan, 1, 16, current.maxFan) };
}
function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function clampInt(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}
function fillBots(state) {
  for (let seat = 0; seat < 4; seat += 1) if (!state.seats[seat]) state.seats[seat] = makeSeat(`bot:${seat}`, `\u96C0\u4FA0 ${seat + 1}`, seat, true);
}
function startRound(ctx) {
  roundStartingScores = ctx.state.seats.map((seat) => seat?.score ?? 0);
  clearSecrets();
  ctx.state.phase = "dealing";
  ctx.state.result = null;
  ctx.state.reaction = null;
  ctx.state.lastDiscard = null;
  wall = shuffle(createDeck(), () => ctx.random());
  for (const seat of occupied(ctx.state)) {
    hands[seat.seat] = sortTiles(wall.splice(0, 13));
    seat.handCount = 13;
    seat.melds = [];
    seat.discards = [];
    seat.dealer = seat.seat === ctx.state.dealerSeat;
    seat.ready = false;
  }
  hands[ctx.state.dealerSeat].push(wall.shift());
  hands[ctx.state.dealerSeat] = sortTiles(hands[ctx.state.dealerSeat]);
  ctx.state.seats[ctx.state.dealerSeat].handCount = 14;
  ctx.state.wallCount = wall.length;
  ctx.state.currentSeat = ctx.state.dealerSeat;
  ctx.state.phase = "playing";
  ctx.state.message = `\u7B2C ${ctx.state.roundIndex + 1}/${ctx.state.rules.rounds} \u5C40 \xB7 \u5E84\u5BB6\u51FA\u724C`;
  sendAllPrivate(ctx);
  broadcastActionFx(ctx, "deal", ctx.state.dealerSeat, []);
  scheduleBots(ctx);
}
function discardFromSeat(ctx, seatIndex, tileId) {
  if (ctx.state.phase !== "playing" || ctx.state.currentSeat !== seatIndex) return;
  const index = hands[seatIndex]?.findIndex((tile2) => tile2.id === tileId) ?? -1;
  if (index < 0) return;
  const tile = hands[seatIndex][index];
  if (tile.kind === "z") {
    sendNotice(ctx, seatIndex, "\u4E07\u80FD\u7EA2\u4E2D\u4E0D\u80FD\u6253\u51FA");
    return;
  }
  hands[seatIndex].splice(index, 1);
  const seat = ctx.state.seats[seatIndex];
  seat.handCount = hands[seatIndex].length;
  seat.discards.push(tile);
  ctx.state.lastDiscard = { seat: seatIndex, tile };
  lastDrawWasGang = false;
  broadcastActionFx(ctx, "discard", seatIndex, [tile.kind]);
  beginDiscardReaction(ctx, seatIndex, tile);
}
function beginDiscardReaction(ctx, discarderSeat, tile) {
  const eligible = {};
  const chiOptions = {};
  for (const seat of occupied(ctx.state)) {
    if (seat.seat === discarderSeat) continue;
    const options = [];
    const candidate = [...hands[seat.seat], tile];
    if (ctx.state.rules.winSource !== "selfDrawOnly" && analyzeWin(candidate, seat.melds).winning) options.push("win");
    const same = hands[seat.seat].filter((item) => item.kind === tile.kind).length;
    if (tile.kind !== "z" && same >= 3) options.push("gang");
    else if (tile.kind !== "z" && same >= 2) options.push("peng");
    if (ctx.state.rules.allowChi && seatDistance(seat.seat, discarderSeat) === 1) {
      const sequences = findChiOptions(hands[seat.seat], tile.kind);
      if (sequences.length) {
        options.push("chi");
        chiOptions[seat.seat] = sequences;
      }
    }
    if (options.length) eligible[seat.seat] = options;
  }
  if (Object.keys(eligible).length === 0) {
    advanceAndDraw(ctx, discarderSeat);
    return;
  }
  reaction = { discarderSeat, tile, eligible, chiOptions, responses: {} };
  publishReaction(ctx);
}
function publishReaction(ctx) {
  if (!reaction) return;
  const awaitingSeats = Object.keys(reaction.eligible).map(Number).filter((seat) => !(seat in reaction.responses));
  ctx.state.phase = "reaction";
  ctx.state.reaction = { discarderSeat: reaction.discarderSeat, tile: reaction.tile, awaitingSeats };
  ctx.state.message = "\u7B49\u5F85\u5403\u3001\u78B0\u3001\u6760\u3001\u80E1\u54CD\u5E94";
  sendAllPrivate(ctx);
  scheduleBots(ctx);
}
function submitHumanReaction(ctx, playerId, choice) {
  const seat = seatForPlayer(ctx.state, playerId);
  if (!seat || !reaction || !(seat.seat in reaction.eligible)) return;
  submitReaction(ctx, seat.seat, choice);
}
function submitReaction(ctx, seat, choice) {
  if (!reaction || seat in reaction.responses) return;
  if (!choice) reaction.responses[seat] = null;
  else if (reaction.eligible[seat]?.includes(choice.kind)) reaction.responses[seat] = { playerId: ctx.state.seats[seat].id, seat, kind: choice.kind, tiles: choice.tiles };
  else return;
  if (Object.keys(reaction.responses).length < Object.keys(reaction.eligible).length) {
    publishReaction(ctx);
    return;
  }
  resolveReaction(ctx);
}
function resolveReaction(ctx) {
  if (!reaction) return;
  const current = reaction;
  const claims = Object.values(current.responses).filter((value) => Boolean(value));
  if (claims.length === 0) {
    reaction = null;
    ctx.state.reaction = null;
    if (current.robGang) {
      completeAddedGang(ctx, current.robGang.seat, current.robGang.kind);
      return;
    }
    advanceAndDraw(ctx, current.discarderSeat);
    return;
  }
  const winners = rankReactions(claims, current.discarderSeat, ctx.state.rules.allowMultiWin);
  if (winners[0]?.kind === "win") {
    reaction = null;
    ctx.state.reaction = null;
    settleWins(ctx, winners.map((winner) => winner.seat), current.discarderSeat, Boolean(current.robGang), current.tile);
    return;
  }
  const claim = winners[0];
  reaction = null;
  ctx.state.reaction = null;
  if (claim.kind === "peng") claimPeng(ctx, claim.seat, current);
  else if (claim.kind === "gang") claimDiscardGang(ctx, claim.seat, current);
  else claimChi(ctx, claim.seat, current, claim.tiles ?? []);
}
function claimPeng(ctx, seat, source) {
  const taken = takeKind(hands[seat], source.tile.kind, 2);
  if (!taken) return advanceAndDraw(ctx, source.discarderSeat);
  const meld = { kind: "peng", tiles: [...taken, source.tile], fromSeat: source.discarderSeat };
  removeLastDiscard(ctx.state, source.discarderSeat);
  ctx.state.seats[seat].melds.push(meld);
  finishClaim(ctx, seat, "peng", meld.tiles.map((tile) => tile.kind), "\u78B0");
}
function claimDiscardGang(ctx, seat, source) {
  const taken = takeKind(hands[seat], source.tile.kind, 3);
  if (!taken) return advanceAndDraw(ctx, source.discarderSeat);
  removeLastDiscard(ctx.state, source.discarderSeat);
  ctx.state.seats[seat].melds.push({ kind: "gang", tiles: [...taken, source.tile], fromSeat: source.discarderSeat });
  applyGangScore(ctx, seat, "discard", source.discarderSeat);
  drawReplacement(ctx, seat, "discardGang", source.tile.kind, source.discarderSeat);
}
function claimChi(ctx, seat, source, tileIds) {
  if (seatDistance(seat, source.discarderSeat) !== 1) return advanceAndDraw(ctx, source.discarderSeat);
  const chosen = tileIds.map((id) => hands[seat].find((tile) => tile.id === id)).filter((tile) => Boolean(tile));
  const kinds = chosen.map((tile) => tile.kind).sort();
  const allowed = source.chiOptions[seat]?.some((option) => [...option].sort().join() === kinds.join());
  if (chosen.length !== 2 || !allowed) return advanceAndDraw(ctx, source.discarderSeat);
  hands[seat] = hands[seat].filter((tile) => !tileIds.includes(tile.id));
  removeLastDiscard(ctx.state, source.discarderSeat);
  const meldTiles = sortTiles([...chosen, source.tile]);
  ctx.state.seats[seat].melds.push({ kind: "chi", tiles: meldTiles, fromSeat: source.discarderSeat });
  finishClaim(ctx, seat, "chi", meldTiles.map((tile) => tile.kind), "\u5403");
}
function finishClaim(ctx, seat, kind, tiles, label) {
  ctx.state.currentSeat = seat;
  ctx.state.phase = "playing";
  ctx.state.seats[seat].handCount = hands[seat].length;
  ctx.state.message = `${ctx.state.seats[seat].name}${label}\u724C\u540E\u51FA\u724C`;
  sendAllPrivate(ctx);
  broadcastActionFx(ctx, kind, seat, tiles);
  scheduleBots(ctx);
}
function declareOwnGang(ctx, seat, kindRaw) {
  if (ctx.state.phase !== "playing" || ctx.state.currentSeat !== seat || kindRaw === "z") return;
  const kind = kindRaw;
  const concealed = hands[seat].filter((tile) => tile.kind === kind).length >= 4;
  const peng = ctx.state.seats[seat].melds.find((meld) => meld.kind === "peng" && meld.tiles[0]?.kind === kind);
  if (concealed) {
    const tiles = takeKind(hands[seat], kind, 4);
    ctx.state.seats[seat].melds.push({ kind: "gang", tiles, fromSeat: null, concealed: true });
    applyGangScore(ctx, seat, "concealed");
    drawReplacement(ctx, seat, "concealedGang", kind);
    return;
  }
  if (!peng || !hands[seat].some((tile) => tile.kind === kind)) return;
  if (ctx.state.rules.allowRobGang) {
    const eligible = {};
    for (const other of occupied(ctx.state)) if (other.seat !== seat && ctx.state.rules.winSource !== "selfDrawOnly" && analyzeWin([...hands[other.seat], hands[seat].find((tile) => tile.kind === kind)], other.melds).winning) eligible[other.seat] = ["win"];
    if (Object.keys(eligible).length) {
      reaction = { discarderSeat: seat, tile: hands[seat].find((tile) => tile.kind === kind), eligible, chiOptions: {}, responses: {}, robGang: { seat, kind } };
      publishReaction(ctx);
      return;
    }
  }
  completeAddedGang(ctx, seat, kind);
}
function completeAddedGang(ctx, seat, kind) {
  const tile = takeKind(hands[seat], kind, 1)?.[0];
  const meld = ctx.state.seats[seat].melds.find((item) => item.kind === "peng" && item.tiles[0]?.kind === kind);
  if (!tile || !meld) return;
  meld.kind = "gang";
  meld.tiles.push(tile);
  applyGangScore(ctx, seat, "added");
  drawReplacement(ctx, seat, "addedGang", kind);
}
function drawReplacement(ctx, seat, kind, tile, sourceSeat) {
  lastDrawWasGang = true;
  broadcastActionFx(ctx, kind, seat, [tile], sourceSeat);
  drawForSeat(ctx, seat);
}
function advanceAndDraw(ctx, fromSeat) {
  drawForSeat(ctx, (fromSeat + 1) % 4);
}
function drawForSeat(ctx, seat) {
  if (wall.length === 0) {
    settleDraw(ctx);
    return;
  }
  const tile = wall.shift();
  hands[seat].push(tile);
  hands[seat] = sortTiles(hands[seat]);
  ctx.state.seats[seat].handCount = hands[seat].length;
  ctx.state.wallCount = wall.length;
  ctx.state.currentSeat = seat;
  ctx.state.phase = "playing";
  ctx.state.reaction = null;
  ctx.state.message = `${ctx.state.seats[seat].name} \u6478\u724C`;
  sendAllPrivate(ctx);
  broadcastActionFx(ctx, "draw", seat, []);
  scheduleBots(ctx);
}
function settleWins(ctx, winnerSeats, sourceSeat, robGang, claimedTile) {
  if (winnerSeats.length === 0) return;
  const deltas = [0, 0, 0, 0];
  const winners = [];
  for (const seat of winnerSeats) {
    const winningTile = sourceSeat === null ? null : claimedTile ?? ctx.state.lastDiscard?.tile ?? null;
    const analysis = analyzeWin(sourceSeat === null ? hands[seat] : [...hands[seat], winningTile], ctx.state.seats[seat].melds);
    if (!analysis.winning) continue;
    const scored = scoreWin(ctx.state.rules, { ...analysis, selfDraw: sourceSeat === null, gangBloom: sourceSeat === null && lastDrawWasGang, robGang, lastTile: ctx.state.rules.allowLastTile && wall.length === 0 });
    if (sourceSeat === null) {
      for (let payer = 0; payer < 4; payer += 1) if (payer !== seat) {
        deltas[payer] -= scored.points;
        deltas[seat] += scored.points;
      }
    } else {
      deltas[sourceSeat] -= scored.points;
      deltas[seat] += scored.points;
    }
    winners.push({ seat, sourceSeat, points: scored.points, fan: scored.fan, patterns: scored.patterns.map((pattern) => pattern.name).concat(robGang ? ["\u62A2\u6760\u80E1\xD72"] : [], ctx.state.rules.allowLastTile && wall.length === 0 ? ["\u6D77\u5E95\xD72"] : []) });
  }
  if (!winners.length) return;
  finishRound(ctx, { draw: false, winners, deltas, message: winners.map((winner) => `${ctx.state.seats[winner.seat].name} \u80E1\u724C`).join("\u3001") });
}
function settleDraw(ctx) {
  finishRound(ctx, { draw: true, winners: [], deltas: [0, 0, 0, 0], message: "\u724C\u5899\u8017\u5C3D\uFF0C\u672C\u5C40\u6D41\u5C40" });
}
function finishRound(ctx, result) {
  result.deltas.forEach((delta, seat) => {
    if (ctx.state.seats[seat]) ctx.state.seats[seat].score += delta;
  });
  result.deltas = ctx.state.seats.map((seat, index) => seat ? seat.score - (roundStartingScores[index] ?? 0) : 0);
  ctx.state.result = result;
  ctx.state.currentSeat = null;
  ctx.state.reaction = null;
  ctx.state.phase = ctx.state.roundIndex + 1 >= ctx.state.rules.rounds ? "matchEnd" : "settlement";
  ctx.state.message = result.message;
  if (result.draw) broadcastActionFx(ctx, "drawGame", ctx.state.dealerSeat, [], void 0, result.message);
  else for (const winner of result.winners) broadcastActionFx(ctx, "win", winner.seat, [], winner.sourceSeat ?? void 0, `${ctx.state.seats[winner.seat]?.name ?? "\u73A9\u5BB6"} ${winner.sourceSeat === null ? "\u81EA\u6478" : "\u80E1\u724C"} \xB7 ${winner.patterns.join(" \xB7 ")}`);
  ctx.broadcast("mahjong:settlement", result);
  clearRoundTimer(ctx);
  sendAllPrivate(ctx);
}
function applyGangScore(ctx, winnerSeat, kind, sourceSeat) {
  const score = scoreGang(kind, ctx.state.rules.baseScore);
  if (kind === "discard" && sourceSeat !== void 0) {
    ctx.state.seats[sourceSeat].score -= score.payments[0];
    ctx.state.seats[winnerSeat].score += score.winner;
  } else {
    for (let seat = 0; seat < 4; seat += 1) if (seat !== winnerSeat) ctx.state.seats[seat].score -= score.payments[0];
    ctx.state.seats[winnerSeat].score += score.winner;
  }
}
function takeKind(source, kind, count) {
  const found = source.filter((tile) => tile.kind === kind).slice(0, count);
  if (found.length !== count) return null;
  const ids = new Set(found.map((tile) => tile.id));
  source.splice(0, source.length, ...source.filter((tile) => !ids.has(tile.id)));
  return found;
}
function removeLastDiscard(state, seat) {
  state.seats[seat].discards.pop();
}
function findChiOptions(hand, kind) {
  if (kind === "z") return [];
  const suit = tileSuit(kind);
  const rank = tileRank(kind);
  const kinds = new Set(hand.map((tile) => tile.kind));
  const options = [];
  for (const start of [rank - 2, rank - 1, rank]) {
    if (start < 1 || start > 7) continue;
    const sequence = [start, start + 1, start + 2].map((value) => `${suit}${value}`).filter((value) => value !== kind);
    if (sequence.every((value) => kinds.has(value))) options.push(sequence);
  }
  return options;
}
function ownGangKinds(seat, melds) {
  const counts = /* @__PURE__ */ new Map();
  for (const tile of hands[seat] ?? []) counts.set(tile.kind, (counts.get(tile.kind) ?? 0) + 1);
  return { concealed: [...counts].filter(([kind, count]) => kind !== "z" && count >= 4).map(([kind]) => kind), added: melds.filter((meld) => meld.kind === "peng").map((meld) => meld.tiles[0].kind).filter((kind) => counts.has(kind)) };
}
function privateFor(state, seat) {
  const gangs = ownGangKinds(seat, state.seats[seat]?.melds ?? []);
  const selfCanWin = state.phase === "playing" && state.currentSeat === seat && state.rules.winSource !== "discardOnly" && analyzeWin(hands[seat] ?? [], state.seats[seat]?.melds ?? []).winning;
  return { hand: sortTiles(hands[seat] ?? []), canWin: selfCanWin, concealedGangKinds: gangs.concealed, addedGangKinds: gangs.added, reactionOptions: reaction?.eligible[seat] ?? [], chiOptions: reaction?.chiOptions[seat] ?? [] };
}
function sendPrivate(ctx, seat) {
  const player = ctx.state.seats[seat];
  if (player && !player.bot && player.connected) ctx.send(player.id, "mahjong:private-state", privateFor(ctx.state, seat));
}
function sendAllPrivate(ctx) {
  for (const seat of occupied(ctx.state)) sendPrivate(ctx, seat.seat);
}
function sendNotice(ctx, seat, message) {
  const player = ctx.state.seats[seat];
  if (player && !player.bot) ctx.send(player.id, "mahjong:notice", { message });
}
function broadcastActionFx(ctx, kind, actorSeat, tiles, sourceSeat, label) {
  const occurredAt = Date.now();
  ctx.broadcast("mahjong:action-fx", { actionId: `mahjong:${occurredAt}:${++actionSequence}`, occurredAt, kind, actorSeat, actorName: ctx.state.seats[actorSeat]?.name ?? "\u73A9\u5BB6", sourceSeat, tiles, label });
}
function scheduleBots(ctx) {
  ctx.clearTimer("mahjong:bot");
  ctx.setTimer("mahjong:bot", 800 + Math.floor(ctx.random() * 700), () => runBots(ctx));
}
function clearRoundTimer(ctx) {
  ctx.clearTimer("mahjong:bot");
}
function controlledByBot(state, seat) {
  const player = state.seats[seat];
  return Boolean(player && (player.bot || !player.connected));
}
function runBots(ctx) {
  if (ctx.state.phase === "reaction" && reaction) {
    const pending = Object.keys(reaction.eligible).map(Number).find((seat2) => !(seat2 in reaction.responses) && controlledByBot(ctx.state, seat2));
    if (pending !== void 0) {
      const options = reaction.eligible[pending];
      const kind = options.includes("win") ? "win" : options.includes("gang") ? "gang" : options.includes("peng") && botShouldMeld(pending, reaction.tile.kind) ? "peng" : options.includes("chi") && botShouldChi(pending, reaction.chiOptions[pending] ?? []) ? "chi" : null;
      const tiles = kind === "chi" ? idsForKinds(hands[pending], reaction.chiOptions[pending][0]) : void 0;
      submitReaction(ctx, pending, kind ? { kind, tiles } : null);
      return;
    }
  }
  if (ctx.state.phase !== "playing" || ctx.state.currentSeat === null || !controlledByBot(ctx.state, ctx.state.currentSeat)) return;
  const seat = ctx.state.currentSeat;
  const privateState = privateFor(ctx.state, seat);
  if (privateState.canWin) {
    settleWins(ctx, [seat], null, false);
    return;
  }
  const gangKind = privateState.concealedGangKinds[0] ?? privateState.addedGangKinds[0];
  if (gangKind && ctx.random() < 0.65) {
    declareOwnGang(ctx, seat, gangKind);
    return;
  }
  const discard = chooseBotDiscard(hands[seat]);
  if (discard) discardFromSeat(ctx, seat, discard.id);
}
function botShouldMeld(seat, kind) {
  return handUsefulness(hands[seat], kind) >= 2;
}
function botShouldChi(_seat, options) {
  return options.length > 0;
}
function idsForKinds(hand, kinds) {
  const used = /* @__PURE__ */ new Set();
  return kinds.map((kind) => {
    const tile = hand.find((candidate) => candidate.kind === kind && !used.has(candidate.id));
    used.add(tile.id);
    return tile.id;
  });
}
function chooseBotDiscard(hand) {
  const candidates = hand.filter((tile) => tile.kind !== "z");
  return candidates.sort((a, b) => handUsefulness(hand, a.kind) - handUsefulness(hand, b.kind) || b.id.localeCompare(a.id))[0];
}
function handUsefulness(hand, kind) {
  if (kind === "z") return 99;
  const same = hand.filter((tile) => tile.kind === kind).length;
  const suit = tileSuit(kind);
  const rank = tileRank(kind);
  const neighbors = hand.filter((tile) => tileSuit(tile.kind) === suit && Math.abs(tileRank(tile.kind) - rank) <= 2).length;
  return same * 3 + neighbors;
}
function clearSecrets() {
  hands = {};
  wall = [];
  reaction = null;
  lastDrawWasGang = false;
}
export default index_default;

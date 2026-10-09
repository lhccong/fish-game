// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";

// src/worker/cards.ts
var SUITS = ["spades", "hearts", "clubs", "diamonds"];
var RANK_LABELS = {
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
  15: "2",
  16: "\u5C0F\u738B",
  17: "\u5927\u738B"
};
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (let rank = 3; rank <= 15; rank += 1) {
      deck.push({
        id: `${suit}-${rank}`,
        suit,
        rank,
        label: RANK_LABELS[rank]
      });
    }
  }
  deck.push({ id: "joker-16", suit: "joker", rank: 16, label: RANK_LABELS[16] });
  deck.push({ id: "joker-17", suit: "joker", rank: 17, label: RANK_LABELS[17] });
  return deck;
}
function shuffle(items, random) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}
function sortCards(cards) {
  return [...cards].sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id));
}
function removeCards(hand, ids) {
  const remaining = [...hand];
  const selected = [];
  for (const id of ids) {
    const index = remaining.findIndex((card) => card.id === id);
    if (index < 0) return null;
    selected.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return selected;
}

// src/worker/rules.ts
var PLAY_LABELS = {
  single: "\u5355\u5F20",
  pair: "\u5BF9\u5B50",
  triple: "\u4E09\u5F20",
  "triple-single": "\u4E09\u5E26\u4E00",
  "triple-pair": "\u4E09\u5E26\u4E8C",
  straight: "\u987A\u5B50",
  "pair-straight": "\u8FDE\u5BF9",
  airplane: "\u98DE\u673A",
  "airplane-singles": "\u98DE\u673A\u5E26\u5355",
  "airplane-pairs": "\u98DE\u673A\u5E26\u5BF9",
  "four-two-singles": "\u56DB\u5E26\u4E8C",
  "four-two-pairs": "\u56DB\u5E26\u4E24\u5BF9",
  bomb: "\u70B8\u5F39",
  rocket: "\u706B\u7BAD"
};
function analyzePlay(cards) {
  if (cards.length === 0) return null;
  const groups = rankGroups(cards);
  const counts = groups.map((g) => g.count).sort((a, b) => b - a);
  const ranks = groups.map((g) => g.rank).sort((a, b) => a - b);
  const length = cards.length;
  if (length === 2 && ranks.includes(16) && ranks.includes(17)) {
    return analysis("rocket", 17, length);
  }
  if (length === 4 && groups.length === 1) {
    return analysis("bomb", groups[0].rank, length);
  }
  if (length === 1) return analysis("single", ranks[0], length);
  if (length === 2 && groups.length === 1) return analysis("pair", ranks[0], length);
  if (length === 3 && groups.length === 1) return analysis("triple", ranks[0], length);
  if (length === 4 && counts[0] === 3) return analysis("triple-single", rankOfCount(groups, 3), length);
  if (length === 5 && counts[0] === 3 && counts[1] === 2) {
    return analysis("triple-pair", rankOfCount(groups, 3), length);
  }
  if (length >= 5 && groups.every((g) => g.count === 1) && isConsecutive(ranks)) {
    return analysis("straight", ranks.at(-1), length, ranks.length);
  }
  if (length >= 6 && length % 2 === 0 && groups.every((g) => g.count === 2) && isConsecutive(ranks)) {
    return analysis("pair-straight", ranks.at(-1), length, ranks.length);
  }
  const triples = groups.filter((g) => g.count === 3).map((g) => g.rank).sort((a, b) => a - b);
  if (triples.length >= 2) {
    const chains = consecutiveSlices(triples);
    for (const chain of chains) {
      const n = chain.length;
      const mainRank = chain.at(-1);
      if (length === n * 3) return analysis("airplane", mainRank, length, n);
      if (length === n * 4 && countNonChainCards(groups, chain) === n) {
        return analysis("airplane-singles", mainRank, length, n);
      }
      if (length === n * 5 && countPairAttachments(groups, chain) === n) {
        return analysis("airplane-pairs", mainRank, length, n);
      }
    }
  }
  if (length === 6 && counts[0] === 4) return analysis("four-two-singles", rankOfCount(groups, 4), length);
  if (length === 8 && counts[0] === 4 && groups.filter((g) => g.count === 2).length === 2) {
    return analysis("four-two-pairs", rankOfCount(groups, 4), length);
  }
  return null;
}
function canBeat(candidate, previous) {
  if (!previous) return true;
  if (candidate.type === "rocket") return previous.type !== "rocket";
  if (previous.type === "rocket") return false;
  if (candidate.type === "bomb" && previous.type !== "bomb") return true;
  if (previous.type === "bomb" && candidate.type !== "bomb") return false;
  if (candidate.type !== previous.type) return false;
  if (candidate.length !== previous.length) return false;
  if ((candidate.chainLength ?? 0) !== (previous.chainLength ?? 0)) return false;
  return candidate.rank > previous.rank;
}
function isMultiplierPlay(play) {
  return play.type === "bomb" || play.type === "rocket";
}
function analysis(type, rank, length, chainLength) {
  return {
    type,
    rank,
    length,
    chainLength,
    label: PLAY_LABELS[type]
  };
}
function rankGroups(cards) {
  const counts = /* @__PURE__ */ new Map();
  for (const card of cards) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  return [...counts.entries()].map(([rank, count]) => ({ rank, count })).sort((a, b) => b.count - a.count || b.rank - a.rank);
}
function rankOfCount(groups, count) {
  return groups.find((g) => g.count === count).rank;
}
function isConsecutive(ranks) {
  if (ranks.some((rank) => rank >= 15)) return false;
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] !== ranks[i - 1] + 1) return false;
  }
  return true;
}
function consecutiveSlices(ranks) {
  const valid = ranks.filter((rank) => rank < 15).sort((a, b) => a - b);
  const slices = [];
  let start = 0;
  for (let i = 1; i <= valid.length; i += 1) {
    if (i === valid.length || valid[i] !== valid[i - 1] + 1) {
      const run = valid.slice(start, i);
      for (let len = run.length; len >= 2; len -= 1) {
        for (let offset = 0; offset + len <= run.length; offset += 1) {
          slices.push(run.slice(offset, offset + len));
        }
      }
      start = i;
    }
  }
  return slices.sort((a, b) => b.length - a.length || b.at(-1) - a.at(-1));
}
function countNonChainCards(groups, chain) {
  const chainRanks = new Set(chain);
  return groups.reduce((sum, group) => sum + (chainRanks.has(group.rank) ? Math.max(0, group.count - 3) : group.count), 0);
}
function countPairAttachments(groups, chain) {
  const chainRanks = new Set(chain);
  return groups.filter((group) => !chainRanks.has(group.rank) && group.count === 2).length;
}

// src/worker/index.ts
var hands = {};
var landlordCardsHidden = [];
var actionSequence = 0;
function broadcastAction(ctx, kind, payload = {}) {
  const occurredAt = Date.now();
  ctx.broadcast("game:action", { actionId: `doudizhu:${occurredAt}:${++actionSequence}`, occurredAt, kind, ...payload });
}
function setGameJoinable(ctx, joinable) {
  ctx.broadcast("game:joinable-changed", joinable);
}
var index_default = defineRoom({
  meta: { name: "\u6597\u5730\u4E3B", minPlayers: 3, maxPlayers: 3 },
  initialState() {
    return createInitialState();
  },
  onRestore(ctx) {
    resetRoundPublicState(ctx.state, "\u623F\u95F4\u5DF2\u6062\u590D\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907\u5F00\u59CB\u4E0B\u4E00\u5C40");
    hands = {};
    landlordCardsHidden = [];
  },
  onJoin(ctx, player) {
    const existing = ctx.state.players[player.id];
    if (existing) {
      existing.connected = true;
      existing.name = player.name;
      ctx.state.rejoinDeadline = null;
      sendHand(ctx, player.id);
      return;
    }
    const seat = ctx.state.seats.findIndex((id) => id === null);
    if (seat < 0) {
      ctx.kick(player.id, "\u623F\u95F4\u5DF2\u6EE1");
      return;
    }
    ctx.state.seats[seat] = player.id;
    ctx.state.players[player.id] = {
      id: player.id,
      name: player.name,
      seat,
      ready: false,
      score: 0,
      connected: true,
      role: null
    };
    ctx.state.message = playersCount(ctx.state) < 3 ? "\u7B49\u5F85\u4E09\u540D\u73A9\u5BB6\u52A0\u5165" : "\u8BF7\u51C6\u5907";
    if (playersCount(ctx.state) === 3 && ctx.state.phase === "waiting") ctx.state.phase = "ready";
  },
  onReconnect(ctx, player) {
    const statePlayer = ctx.state.players[player.id];
    if (statePlayer) {
      statePlayer.connected = true;
      statePlayer.name = player.name;
      ctx.state.rejoinDeadline = null;
      sendHand(ctx, player.id);
    }
  },
  onLeave(ctx, player) {
    const statePlayer = ctx.state.players[player.id];
    if (!statePlayer) return;
    const wasMidRound = ctx.state.phase === "bidding" || ctx.state.phase === "playing";
    ctx.state.rejoinDeadline = null;
    ctx.state.seats[statePlayer.seat] = null;
    delete ctx.state.players[player.id];
    delete ctx.state.handCounts[player.id];
    delete hands[player.id];
    if (playersCount(ctx.state) < 3) {
      if (wasMidRound) {
        voidRound(ctx, statePlayer.name);
      } else {
        ctx.state.phase = "waiting";
        ctx.state.message = "\u7B49\u5F85\u4E09\u540D\u73A9\u5BB6\u52A0\u5165";
        setGameJoinable(ctx, true);
      }
    }
  },
  actions: {
    setReady(ctx, { player, payload }) {
      const me = ctx.state.players[player.id];
      if (!me || !canPrepare(ctx.state)) return;
      me.ready = Boolean(payload && payload.ready);
      ctx.state.message = "\u7B49\u5F85\u6240\u6709\u73A9\u5BB6\u51C6\u5907";
      if (playersCount(ctx.state) === 3 && allPlayers(ctx.state).every((p) => p.ready)) {
        startRound(ctx);
      }
    },
    bid(ctx, { player, payload }) {
      const score = Number(payload && payload.score);
      if (!Number.isInteger(score) || score < 0 || score > 3) return;
      if (score > 0 && score <= ctx.state.bidState.highestScore) return;
      applyBid(ctx, player.id, score);
    },
    playCards(ctx, { player, payload }) {
      if (ctx.state.phase !== "playing" || ctx.state.currentPlayerId !== player.id) return;
      const ids = Array.isArray(payload?.cardIds) ? payload.cardIds.filter((id) => typeof id === "string") : [];
      const selected = removeCards(hands[player.id] ?? [], ids);
      if (!selected || selected.length === 0) {
        ctx.send(player.id, "game:invalid", { message: "\u8BF7\u9009\u62E9\u8981\u51FA\u7684\u724C" });
        return;
      }
      const analysis2 = analyzePlay(selected);
      if (!analysis2) {
        ctx.send(player.id, "game:invalid", { message: "\u724C\u578B\u4E0D\u5408\u6CD5" });
        return;
      }
      if (!canBeat(analysis2, ctx.state.lastPlay?.analysis ?? null)) {
        ctx.send(player.id, "game:invalid", { message: "\u9700\u8981\u51FA\u540C\u724C\u578B\u66F4\u5927\u7684\u724C\uFF0C\u6216\u4F7F\u7528\u70B8\u5F39/\u706B\u7BAD" });
        return;
      }
      hands[player.id] = sortCards((hands[player.id] ?? []).filter((card) => !ids.includes(card.id)));
      ctx.state.handCounts[player.id] = hands[player.id].length;
      ctx.state.round.playCounts[player.id] = (ctx.state.round.playCounts[player.id] ?? 0) + 1;
      if (isMultiplierPlay(analysis2)) {
        ctx.state.round.multiplier *= 2;
        broadcastAction(ctx, "multiplierChanged", { actorId: player.id, value: ctx.state.round.multiplier, label: analysis2.type === "rocket" ? "\u706B\u7BAD" : "\u70B8\u5F39" });
      }
      const record = {
        playerId: player.id,
        cards: sortCards(selected),
        analysis: analysis2
      };
      ctx.state.lastPlay = record;
      ctx.state.playedCards.push(record);
      ctx.state.round.passCount = 0;
      sendHand(ctx, player.id);
      broadcastAction(ctx, "cardsPlayed", { actorId: player.id, cards: record.cards, label: record.analysis.label, playType: record.analysis.type });
      if (hands[player.id].length <= 2 && hands[player.id].length > 0) broadcastAction(ctx, "lowCards", { actorId: player.id, value: hands[player.id].length, label: `\u53EA\u5269 ${hands[player.id].length} \u5F20` });
      if (hands[player.id].length === 0) {
        settleRound(ctx, player.id);
        return;
      }
      ctx.state.currentPlayerId = nextPlayerId(ctx.state, player.id);
    },
    pass(ctx, { player }) {
      if (ctx.state.phase !== "playing" || ctx.state.currentPlayerId !== player.id) return;
      if (!ctx.state.lastPlay || ctx.state.lastPlay.playerId === player.id) return;
      applyPass(ctx, player.id);
    },
    syncHand(ctx, { player }) {
      sendHand(ctx, player.id);
    }
  }
});
function createInitialState() {
  return {
    phase: "waiting",
    players: {},
    seats: [null, null, null],
    dealer: null,
    landlordCardsVisible: [],
    currentPlayerId: null,
    bidState: null,
    lastPlay: null,
    playedCards: [],
    handCounts: {},
    round: {
      number: 0,
      starterSeat: 0,
      passCount: 0,
      multiplier: 1,
      baseScore: 0,
      playCounts: {}
    },
    result: null,
    rejoinDeadline: null,
    message: "\u7B49\u5F85\u4E09\u540D\u73A9\u5BB6\u52A0\u5165"
  };
}
function startRound(ctx) {
  const state = ctx.state;
  const players = allPlayers(state);
  if (players.length !== 3) return;
  const deck = shuffle(createDeck(), () => ctx.random());
  hands = {};
  for (const player of players) hands[player.id] = sortCards(deck.splice(0, 17));
  landlordCardsHidden = deck.splice(0, 3);
  state.phase = "bidding";
  state.dealer = null;
  state.landlordCardsVisible = [];
  state.currentPlayerId = null;
  state.lastPlay = null;
  state.playedCards = [];
  state.handCounts = Object.fromEntries(players.map((player) => [player.id, 17]));
  state.result = null;
  state.rejoinDeadline = null;
  state.round = {
    number: state.round.number + 1,
    starterSeat: state.round.number % 3,
    passCount: 0,
    multiplier: 1,
    baseScore: 0,
    playCounts: Object.fromEntries(players.map((player) => [player.id, 0]))
  };
  for (const player of players) {
    player.ready = false;
    player.role = null;
    sendHand(ctx, player.id);
  }
  const starterId = state.seats[state.round.starterSeat] ?? players[0].id;
  state.bidState = {
    currentPlayerId: starterId,
    highestScore: 0,
    highestPlayerId: null,
    turns: 0,
    passed: []
  };
  state.message = "\u5F00\u59CB\u53EB\u5730\u4E3B";
  ctx.broadcast("game:notice", { message: "\u65B0\u4E00\u5C40\u5F00\u59CB\uFF0C\u53EB\u5730\u4E3B" });
  broadcastAction(ctx, "dealStarted", { actorId: starterId });
  setGameJoinable(ctx, false);
}
function beginPlaying(ctx, landlordId, baseScore) {
  const state = ctx.state;
  state.phase = "playing";
  state.dealer = landlordId;
  state.landlordCardsVisible = sortCards(landlordCardsHidden);
  state.currentPlayerId = landlordId;
  state.bidState = null;
  state.rejoinDeadline = null;
  state.round.baseScore = baseScore;
  state.round.multiplier = Math.max(1, baseScore);
  state.message = `${state.players[landlordId].name} \u6210\u4E3A\u5730\u4E3B`;
  for (const player of allPlayers(state)) player.role = player.id === landlordId ? "landlord" : "farmer";
  hands[landlordId] = sortCards([...hands[landlordId] ?? [], ...landlordCardsHidden]);
  state.handCounts[landlordId] = hands[landlordId].length;
  sendHand(ctx, landlordId);
  ctx.broadcast("game:notice", { message: `${state.players[landlordId].name} \u6210\u4E3A\u5730\u4E3B` });
  broadcastAction(ctx, "landlordAssigned", { actorId: landlordId, cards: state.landlordCardsVisible, value: state.round.multiplier, label: "\u5730\u4E3B" });
}
function settleRound(ctx, winnerId) {
  const state = ctx.state;
  const landlordId = state.dealer;
  if (!landlordId) return;
  const landlordWon = winnerId === landlordId;
  const farmerIds = allPlayers(state).filter((player) => player.id !== landlordId).map((player) => player.id);
  const spring = landlordWon ? farmerIds.every((id) => (state.round.playCounts[id] ?? 0) === 0) : (state.round.playCounts[landlordId] ?? 0) <= 1;
  if (spring) state.round.multiplier *= 2;
  const unit = Math.max(1, state.round.baseScore) * state.round.multiplier;
  const deltas = {};
  if (landlordWon) {
    deltas[landlordId] = unit * 2;
    for (const id of farmerIds) deltas[id] = -unit;
  } else {
    deltas[landlordId] = -unit * 2;
    for (const id of farmerIds) deltas[id] = unit;
  }
  for (const [id, delta] of Object.entries(deltas)) {
    state.players[id].score += delta;
    state.players[id].ready = false;
  }
  state.phase = "settlement";
  state.currentPlayerId = null;
  state.rejoinDeadline = null;
  state.result = {
    winnerTeam: landlordWon ? "landlord" : "farmers",
    winnerIds: landlordWon ? [landlordId] : farmerIds,
    deltas,
    spring,
    multiplier: state.round.multiplier
  };
  state.message = "\u672C\u5C40\u7ED3\u675F\uFF0C\u8BF7\u51C6\u5907\u4E0B\u4E00\u5C40";
  if (spring) broadcastAction(ctx, "multiplierChanged", { actorId: winnerId, value: state.round.multiplier, label: landlordWon ? "\u6625\u5929" : "\u53CD\u6625" });
  broadcastAction(ctx, "roundSettled", { actorId: winnerId, value: state.round.multiplier, label: landlordWon ? "\u5730\u4E3B\u80DC\u5229" : "\u519C\u6C11\u80DC\u5229" });
  ctx.broadcast("game:notice", { message: landlordWon ? "\u5730\u4E3B\u80DC\u5229" : "\u519C\u6C11\u80DC\u5229" });
  setGameJoinable(ctx, true);
}
function voidRound(ctx, leaverName) {
  const state = ctx.state;
  for (const player of allPlayers(state)) {
    player.ready = false;
    player.role = null;
  }
  state.dealer = null;
  state.landlordCardsVisible = [];
  state.currentPlayerId = null;
  state.bidState = null;
  state.lastPlay = null;
  state.playedCards = [];
  state.handCounts = {};
  state.result = {
    winnerTeam: "landlord",
    winnerIds: [],
    deltas: {},
    spring: false,
    multiplier: 1
  };
  state.rejoinDeadline = null;
  state.phase = "settlement";
  state.message = `${leaverName} \u79BB\u5F00\uFF0C\u672C\u5C40\u6D41\u5C40`;
  hands = {};
  landlordCardsHidden = [];
  ctx.broadcast("game:notice", { message: state.message });
  setGameJoinable(ctx, true);
}
function resetRoundPublicState(state, message) {
  state.phase = playersCount(state) === 3 ? "ready" : "waiting";
  state.dealer = null;
  state.landlordCardsVisible = [];
  state.currentPlayerId = null;
  state.bidState = null;
  state.lastPlay = null;
  state.playedCards = [];
  state.handCounts = {};
  state.result = null;
  state.rejoinDeadline = null;
  state.message = message;
  for (const player of allPlayers(state)) {
    player.ready = false;
    player.role = null;
  }
}
function canPrepare(state) {
  return playersCount(state) === 3 && (state.phase === "ready" || state.phase === "settlement");
}
function allPlayers(state) {
  return state.seats.map((id) => id ? state.players[id] : null).filter((player) => Boolean(player));
}
function playersCount(state) {
  return allPlayers(state).length;
}
function nextPlayerId(state, playerId) {
  const player = state.players[playerId];
  const nextSeat = (player.seat + 1) % 3;
  return state.seats[nextSeat] ?? playerId;
}
function applyBid(ctx, playerId, score) {
  const state = ctx.state;
  if (state.phase !== "bidding" || state.bidState?.currentPlayerId !== playerId) return;
  if (!state.players[playerId]) return;
  const bid = state.bidState;
  bid.turns += 1;
  if (score === 0) {
    if (!bid.passed.includes(playerId)) bid.passed.push(playerId);
  } else {
    bid.highestScore = score;
    bid.highestPlayerId = playerId;
  }
  ctx.broadcast("game:notice", { message: `${state.players[playerId].name}${score === 0 ? "\u4E0D\u53EB" : `\u53EB ${score} \u5206`}` });
  broadcastAction(ctx, "bidPlaced", { actorId: playerId, value: score, label: score === 0 ? "\u4E0D\u53EB" : `\u53EB ${score} \u5206` });
  state.rejoinDeadline = null;
  if (score === 3 || bid.turns >= 3) {
    if (!bid.highestPlayerId) {
      ctx.broadcast("game:notice", { message: "\u65E0\u4EBA\u53EB\u5730\u4E3B\uFF0C\u91CD\u65B0\u53D1\u724C" });
      startRound(ctx);
      return;
    }
    beginPlaying(ctx, bid.highestPlayerId, bid.highestScore);
    return;
  }
  bid.currentPlayerId = nextPlayerId(state, playerId);
}
function applyPass(ctx, playerId) {
  const state = ctx.state;
  if (state.phase !== "playing" || state.currentPlayerId !== playerId) return;
  if (!state.lastPlay || state.lastPlay.playerId === playerId) return;
  state.playedCards.push({ playerId, pass: true });
  broadcastAction(ctx, "playerPassed", { actorId: playerId, label: "\u4E0D\u51FA" });
  state.round.passCount += 1;
  state.rejoinDeadline = null;
  if (state.round.passCount >= 2) {
    state.currentPlayerId = state.lastPlay.playerId;
    state.lastPlay = null;
    state.round.passCount = 0;
    broadcastAction(ctx, "trickCleared", { actorId: state.currentPlayerId });
    return;
  }
  state.currentPlayerId = nextPlayerId(state, playerId);
}
function sendHand(ctx, playerId) {
  if (!hands[playerId]) return;
  ctx.send(playerId, "hand:update", { hand: sortCards(hands[playerId]) });
}
export default index_default;
//# sourceMappingURL=worker.js.map

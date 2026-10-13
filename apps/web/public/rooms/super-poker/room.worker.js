// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";

// src/worker/cards.ts
var SUITS = ["spades", "hearts", "clubs", "diamonds"];
var LABELS = { 1: "A", 2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10", 11: "J", 12: "Q", 13: "K", 14: "A", 15: "2", 16: "\u5C0F\u738B", 17: "\u5927\u738B" };
function createDeck(options = {}) {
  const result2 = [];
  const copies = options.copies ?? 1;
  for (let copy = 0; copy < copies; copy += 1) for (const suit of SUITS) for (let raw = 1; raw <= 13; raw += 1) {
    const rank = options.aceHigh ? raw === 1 ? 14 : raw === 2 ? 15 : raw : raw;
    result2.push({ id: `${copy}:${suit}:${raw}`, suit, rank, label: LABELS[rank] });
  }
  if (options.jokers) for (let copy = 0; copy < copies; copy += 1) {
    result2.push({ id: `${copy}:joker:16`, suit: "joker", rank: 16, label: LABELS[16] });
    result2.push({ id: `${copy}:joker:17`, suit: "joker", rank: 17, label: LABELS[17] });
  }
  return result2;
}
function shuffle(items, random) {
  const result2 = [...items];
  for (let i = result2.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result2[i], result2[j]] = [result2[j], result2[i]];
  }
  return result2;
}
function sortCards(cards) {
  return [...cards].sort((a, b) => b.rank - a.rank || a.suit.localeCompare(b.suit) || a.id.localeCompare(b.id));
}
function takeCards(hand, ids) {
  if (new Set(ids).size !== ids.length) return null;
  const picked = [];
  for (const id of ids) {
    const card = hand.find((item) => item.id === id);
    if (!card) return null;
    picked.push(card);
  }
  return picked;
}

// src/worker/variants/chameleon.ts
function isChameleonLegal(card, activeSuit, activeRank) {
  return card.rank === 11 || card.suit === activeSuit || card.rank === activeRank;
}
function validateChoice(value) {
  if (!value || typeof value !== "object") return null;
  const choice = value;
  if (!["spades", "hearts", "clubs", "diamonds"].includes(String(choice.suit)) || !Number.isInteger(choice.rank) || choice.rank < 1 || choice.rank > 13) return null;
  return { suit: choice.suit, rank: choice.rank };
}
function chameleonCardPoints(card) {
  if (card.rank === 11) return 20;
  if (card.rank === 1) return 1;
  if (card.rank >= 10) return 10;
  return card.rank;
}
function chooseChameleon(hand, activeSuit, activeRank) {
  const legal = hand.filter((c) => isChameleonLegal(c, activeSuit, activeRank)).sort((a, b) => {
    const aj = a.rank === 11 ? 100 : chameleonCardPoints(a), bj = b.rank === 11 ? 100 : chameleonCardPoints(b);
    return aj - bj;
  });
  const card = legal[0];
  if (!card) return null;
  if (card.rank !== 11) return { card };
  const nonJ = hand.filter((c) => c.rank !== 11);
  const suits = ["spades", "hearts", "clubs", "diamonds"];
  const suit = suits.sort((a, b) => nonJ.filter((c) => c.suit === b).length - nonJ.filter((c) => c.suit === a).length)[0];
  const ranks = /* @__PURE__ */ new Map();
  for (const c of nonJ) ranks.set(c.rank, (ranks.get(c.rank) ?? 0) + 1);
  const rank = [...ranks].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 1;
  return { card, choice: { suit, rank } };
}

// src/worker/variants/doudizhu.ts
var LABELS2 = { single: "\u5355\u5F20", pair: "\u5BF9\u5B50", triple: "\u4E09\u5F20", "triple-single": "\u4E09\u5E26\u4E00", "triple-pair": "\u4E09\u5E26\u4E8C", straight: "\u987A\u5B50", "pair-straight": "\u8FDE\u5BF9", airplane: "\u98DE\u673A", "airplane-singles": "\u98DE\u673A\u5E26\u5355", "airplane-pairs": "\u98DE\u673A\u5E26\u5BF9", "four-two-singles": "\u56DB\u5E26\u4E8C", "four-two-pairs": "\u56DB\u5E26\u4E24\u5BF9", bomb: "\u70B8\u5F39", rocket: "\u706B\u7BAD" };
function analyzeDoudizhu(cards) {
  if (!cards.length) return null;
  const groups = rankGroups(cards), counts = groups.map((g) => g.count).sort((a, b) => b - a), ranks = groups.map((g) => g.rank).sort((a, b) => a - b), n = cards.length;
  if (n === 2 && ranks.includes(16) && ranks.includes(17)) return out("rocket", 17, n);
  if (n === 4 && groups.length === 1) return out("bomb", groups[0].rank, n);
  if (n === 1) return out("single", ranks[0], n);
  if (n === 2 && groups.length === 1) return out("pair", ranks[0], n);
  if (n === 3 && groups.length === 1) return out("triple", ranks[0], n);
  if (n === 4 && counts[0] === 3) return out("triple-single", rankOf(groups, 3), n);
  if (n === 5 && counts[0] === 3 && counts[1] === 2) return out("triple-pair", rankOf(groups, 3), n);
  if (n >= 5 && groups.every((g) => g.count === 1) && consecutive(ranks)) return out("straight", ranks.at(-1), n, ranks.length);
  if (n >= 6 && n % 2 === 0 && groups.every((g) => g.count === 2) && consecutive(ranks)) return out("pair-straight", ranks.at(-1), n, ranks.length);
  const triples = groups.filter((g) => g.count === 3).map((g) => g.rank).sort((a, b) => a - b);
  for (const chain of slices(triples)) {
    const length = chain.length, rank = chain.at(-1);
    if (n === length * 3) return out("airplane", rank, n, length);
    if (n === length * 4 && nonChain(groups, chain) === length) return out("airplane-singles", rank, n, length);
    if (n === length * 5 && pairAttachments(groups, chain) === length) return out("airplane-pairs", rank, n, length);
  }
  if (n === 6 && counts[0] === 4) return out("four-two-singles", rankOf(groups, 4), n);
  if (n === 8 && counts[0] === 4 && groups.filter((g) => g.count === 2).length === 2) return out("four-two-pairs", rankOf(groups, 4), n);
  return null;
}
function canBeatDoudizhu(candidate, previous) {
  if (!previous) return true;
  if (candidate.type === "rocket") return previous.type !== "rocket";
  if (previous.type === "rocket") return false;
  if (candidate.type === "bomb" && previous.type !== "bomb") return true;
  if (previous.type === "bomb" && candidate.type !== "bomb") return false;
  return candidate.type === previous.type && candidate.length === previous.length && (candidate.chainLength ?? 0) === (previous.chainLength ?? 0) && candidate.rank > previous.rank;
}
function enumerateDoudizhu(hand, previous) {
  const plays = [];
  const add = (cards) => {
    const analysis = analyzeDoudizhu(cards);
    if (analysis && canBeatDoudizhu(analysis, previous)) plays.push(cards);
  };
  for (const card of hand) add([card]);
  const groups = /* @__PURE__ */ new Map();
  for (const card of hand) groups.set(card.rank, [...groups.get(card.rank) ?? [], card]);
  for (const cards of groups.values()) {
    if (cards.length >= 2) add(cards.slice(0, 2));
    if (cards.length >= 3) add(cards.slice(0, 3));
    if (cards.length >= 4) add(cards.slice(0, 4));
  }
  const small = hand.find((c) => c.rank === 16), big = hand.find((c) => c.rank === 17);
  if (small && big) add([small, big]);
  return plays.sort((a, b) => score(a) - score(b));
}
function score(cards) {
  const a = analyzeDoudizhu(cards);
  return (a.type === "rocket" ? 1e4 : a.type === "bomb" ? 5e3 : 0) + a.rank + cards.length * 0.01;
}
function out(type, rank, length, chainLength) {
  return { type, rank, length, chainLength, label: LABELS2[type] };
}
function rankGroups(cards) {
  const m = /* @__PURE__ */ new Map();
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1);
  return [...m].map(([rank, count]) => ({ rank, count })).sort((a, b) => b.count - a.count || b.rank - a.rank);
}
function rankOf(groups, count) {
  return groups.find((g) => g.count === count).rank;
}
function consecutive(ranks) {
  return !ranks.some((r) => r >= 15) && ranks.every((r, i) => i === 0 || r === ranks[i - 1] + 1);
}
function slices(ranks) {
  const valid = ranks.filter((r) => r < 15).sort((a, b) => a - b), result2 = [];
  let start = 0;
  for (let i = 1; i <= valid.length; i += 1) if (i === valid.length || valid[i] !== valid[i - 1] + 1) {
    const run = valid.slice(start, i);
    for (let len = run.length; len >= 2; len -= 1) for (let off = 0; off + len <= run.length; off += 1) result2.push(run.slice(off, off + len));
    start = i;
  }
  return result2;
}
function nonChain(groups, chain) {
  const set = new Set(chain);
  return groups.reduce((sum, g) => sum + (set.has(g.rank) ? Math.max(0, g.count - 3) : g.count), 0);
}
function pairAttachments(groups, chain) {
  const set = new Set(chain);
  return groups.filter((g) => !set.has(g.rank) && g.count === 2).length;
}

// src/worker/variants/gandengyan.ts
function analyzeGandengyan(cards) {
  if (!cards.length) return null;
  const jokers = cards.filter((c) => c.suit === "joker").length, natural = cards.filter((c) => c.suit !== "joker");
  if (!natural.length) return null;
  const ranks = /* @__PURE__ */ new Map();
  for (const c of natural) ranks.set(c.rank, (ranks.get(c.rank) ?? 0) + 1);
  const distinct = [...ranks.keys()].sort((a, b) => a - b), n = cards.length;
  if (distinct.length === 1 && n <= 4 && natural.length + jokers === n) {
    const type = n === 1 ? "single" : n === 2 ? "pair" : n === 3 ? "triple" : "bomb";
    return result(type, distinct[0], n);
  }
  if (n >= 3 && distinct.every((r, i) => i === 0 || r === distinct[i - 1] + 1) && distinct.at(-1) < 15 && natural.length + jokers === n && n - distinct.length === jokers) return result("straight", distinct.at(-1), n, n);
  if (n >= 4 && n % 2 === 0 && distinct.every((r, i) => i === 0 || r === distinct[i - 1] + 1) && distinct.at(-1) < 15 && [...ranks.values()].every((v) => v <= 2) && natural.length + jokers === n) return result("pair-straight", distinct.at(-1), n, n / 2);
  return null;
}
function canBeatGandengyan(candidate, previous) {
  if (!previous) return true;
  if (candidate.type === "bomb") return previous.type !== "bomb" || candidate.rank > previous.rank;
  if (previous.type === "bomb" || candidate.type !== previous.type || candidate.length !== previous.length) return false;
  return candidate.rank === nextRank(previous.rank);
}
function enumerateGandengyan(hand, previous) {
  const out2 = [];
  for (let i = 0; i < hand.length; i += 1) {
    const one = [hand[i]], a = analyzeGandengyan(one);
    if (a && canBeatGandengyan(a, previous)) out2.push(one);
    for (let j = i + 1; j < hand.length; j += 1) {
      const two = [hand[i], hand[j]], b = analyzeGandengyan(two);
      if (b && canBeatGandengyan(b, previous)) out2.push(two);
    }
  }
  const groups = /* @__PURE__ */ new Map();
  for (const c of hand) if (c.suit !== "joker") groups.set(c.rank, [...groups.get(c.rank) ?? [], c]);
  for (const cards of groups.values()) {
    for (const n of [3, 4]) if (cards.length >= n) {
      const play = cards.slice(0, n), a = analyzeGandengyan(play);
      if (a && canBeatGandengyan(a, previous)) out2.push(play);
    }
  }
  return dedupe(out2).sort((a, b) => (analyzeGandengyan(a).type === "bomb" ? 1e3 : 0) + analyzeGandengyan(a).rank - ((analyzeGandengyan(b).type === "bomb" ? 1e3 : 0) + analyzeGandengyan(b).rank));
}
function nextRank(rank) {
  return rank === 14 ? 15 : rank + 1;
}
function result(type, rank, length, chainLength) {
  return { type, rank, length, chainLength, label: { single: "\u5355\u5F20", pair: "\u5BF9\u5B50", triple: "\u4E09\u5F20", straight: "\u987A\u5B50", "pair-straight": "\u8FDE\u5BF9", bomb: "\u70B8\u5F39" }[type] };
}
function dedupe(plays) {
  const seen = /* @__PURE__ */ new Set();
  return plays.filter((p) => {
    const key = p.map((c) => c.id).sort().join();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// src/worker/variants/registry.ts
var VARIANTS = {
  doudizhu: { meta: { id: "doudizhu", name: "\u6597\u5730\u4E3B", minPlayers: 3, maxPlayers: 3, rules: ["\u56FA\u5B9A\u4E09\u4EBA\uFF0C\u53EB\u5206\u6700\u9AD8\u8005\u6210\u4E3A\u5730\u4E3B", "\u540C\u724C\u578B\u3001\u540C\u5F20\u6570\u624D\u80FD\u538B\u8FC7\uFF1B\u70B8\u5F39\u548C\u706B\u7BAD\u4F8B\u5916", "\u5730\u4E3B\u5148\u51FA\u5B8C\u5219\u5730\u4E3B\u80DC\uFF0C\u5426\u5219\u519C\u6C11\u80DC"] } },
  gandengyan: { meta: { id: "gandengyan", name: "\u5E72\u77AA\u773C", minPlayers: 2, maxPlayers: 6, rules: ["\u5E84\u5BB66\u5F20\u3001\u95F2\u5BB65\u5F20\uFF1B2\u4EBA\u4E00\u526F\u724C\uFF0C3\u20136\u4EBA\u4E24\u526F", "\u666E\u901A\u724C\u5FC5\u987B\u4EE5\u540C\u724C\u578B\u6070\u597D\u5927\u4E00\u7EA7\u63A5\u724C\uFF0C2\u63A5A", "\u5927\u5C0F\u738B\u53EA\u80FD\u914D\u724C\uFF1B\u65E0\u4EBA\u53EF\u63A5\u65F6\u6E05\u684C\u5E76\u4F9D\u6B21\u8865\u724C"] } },
  chameleon: { meta: { id: "chameleon", name: "\u53D8\u8272\u9F99", minPlayers: 2, maxPlayers: 8, rules: ["\u6BCF\u4EBA5\u5F20\uFF0C\u540C\u70B9\u6570\u6216\u540C\u82B1\u8272\u53EF\u4EE5\u63A5\u724C", "J\u662F\u53D8\u8272\u9F99\uFF1A\u51FA\u724C\u65F6\u6307\u5B9A\u4E0B\u4E00\u82B1\u8272\u548C\u70B9\u6570", "\u65E0\u724C\u53EF\u51FA\u5219\u6478\u4E00\u5F20\uFF1B\u5148\u51FA\u5B8C\u8005\u83B7\u80DC"] } }
};
var variantList = () => Object.values(VARIANTS).map((item) => item.meta);

// src/worker/index.ts
var hands = {};
var deck = [];
var landlordHidden = [];
var discardPile = [];
var trickPasses = 0;
var playCounts = {};
var index_default = defineRoom({
  meta: { name: "\u8D85\u7EA7\u6251\u514B", minPlayers: 1, maxPlayers: 8 },
  initialState: () => initialState(),
  onRestore(ctx) {
    resetRoundSecrets(ctx);
    ctx.state.phase = "lobby";
    ctx.state.currentPlayerId = null;
    ctx.state.lastPlay = null;
    ctx.state.settlement = null;
    ctx.state.variant = {};
    ctx.state.message = "\u623F\u95F4\u5DF2\u6062\u590D\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907";
    for (const seat of occupied(ctx.state)) {
      seat.ready = seat.bot;
      seat.handCount = 0;
      seat.role = null;
      if (!seat.bot) seat.connected = false;
    }
  },
  onJoin(ctx, player) {
    const old = ctx.state.seats.find((s) => s?.id === player.id);
    if (old) {
      old.connected = true;
      old.name = player.name;
      sendPrivate(ctx, old.id);
      return;
    }
    if (ctx.state.phase !== "lobby") {
      ctx.kick(player.id, "\u724C\u5C40\u8FDB\u884C\u4E2D");
      return;
    }
    const botIndex = ctx.state.seats.findIndex((s) => s?.bot);
    const emptyIndex = ctx.state.seats.findIndex((s) => !s);
    const seat = botIndex >= 0 ? botIndex : emptyIndex;
    if (seat < 0) {
      ctx.kick(player.id, "\u623F\u95F4\u5DF2\u6EE1");
      return;
    }
    ctx.state.seats[seat] = makeSeat(player.id, player.name, seat, false);
    if (!ctx.state.hostId) ctx.state.hostId = player.id;
    ctx.state.message = "\u9009\u62E9\u73A9\u6CD5\u3001\u5B89\u6392AI\uFF0C\u6240\u6709\u771F\u4EBA\u51C6\u5907\u540E\u5F00\u5C40";
  },
  onReconnect(ctx, player) {
    const seat = findSeat(ctx.state, player.id);
    if (seat) {
      seat.connected = true;
      seat.name = player.name;
      sendPrivate(ctx, player.id);
    }
  },
  onLeave(ctx, player) {
    const seat = findSeat(ctx.state, player.id);
    if (!seat) return;
    if (ctx.state.phase === "lobby" || ctx.state.phase === "settlement") {
      ctx.state.seats[seat.seat] = null;
      if (ctx.state.hostId === player.id) ctx.state.hostId = occupied(ctx.state).find((s) => !s.bot)?.id ?? null;
      return;
    }
    seat.connected = false;
    scheduleBot(ctx);
  },
  actions: {
    selectVariant(ctx, { player, payload }) {
      if (!hostLobby(ctx, player.id)) return;
      const id = String(payload?.variantId);
      if (!VARIANTS[id]) return;
      const meta = VARIANTS[id].meta;
      const humans = occupied(ctx.state).filter((s) => !s.bot);
      if (humans.length > meta.maxPlayers) {
        notice(ctx, player.id, `\u5F53\u524D\u6709 ${humans.length} \u4F4D\u771F\u4EBA\uFF0C\u8D85\u8FC7${meta.name}\u4E0A\u9650`);
        return;
      }
      for (let seat = ctx.state.seats.length - 1; seat >= meta.maxPlayers; seat -= 1) {
        const current = ctx.state.seats[seat];
        if (current && !current.bot) {
          notice(ctx, player.id, "\u8BF7\u5148\u8BA9\u8D85\u51FA\u4EBA\u6570\u4E0A\u9650\u7684\u771F\u4EBA\u79BB\u5F00");
          return;
        }
        ctx.state.seats[seat] = null;
      }
      ctx.state.variantId = id;
      ctx.state.message = `\u5DF2\u9009\u62E9${meta.name}\uFF0C\u8BF7\u5B89\u6392\u5E2D\u4F4D\u5E76\u51C6\u5907`;
      clearReady(ctx.state);
    },
    addBot(ctx, { player, payload }) {
      if (!hostLobby(ctx, player.id)) return;
      const index = Number(payload?.seat), meta = VARIANTS[ctx.state.variantId].meta;
      if (!Number.isInteger(index) || index < 0 || index >= meta.maxPlayers || ctx.state.seats[index]) return;
      ctx.state.seats[index] = makeSeat(`bot:${index}`, `\u724C\u4FA0 ${index + 1}`, index, true);
    },
    removeBot(ctx, { player, payload }) {
      if (!hostLobby(ctx, player.id)) return;
      const index = Number(payload?.seat), seat = ctx.state.seats[index];
      if (seat?.bot) ctx.state.seats[index] = null;
    },
    setReady(ctx, { player, payload }) {
      if (ctx.state.phase !== "lobby") return;
      const seat = findSeat(ctx.state, player.id);
      if (seat && !seat.bot) seat.ready = Boolean(payload?.ready);
    },
    startGame(ctx, { player }) {
      if (!hostLobby(ctx, player.id)) return;
      const seats = occupied(ctx.state), meta = VARIANTS[ctx.state.variantId].meta;
      if (seats.length < meta.minPlayers || seats.length > meta.maxPlayers) {
        notice(ctx, player.id, `${meta.name}\u9700\u8981 ${meta.minPlayers}${meta.minPlayers === meta.maxPlayers ? "" : `\u2013${meta.maxPlayers}`} \u4EBA`);
        return;
      }
      if (seats.some((s) => !s.bot && !s.ready)) {
        notice(ctx, player.id, "\u8BF7\u7B49\u5F85\u6240\u6709\u771F\u4EBA\u51C6\u5907");
        return;
      }
      startGame(ctx);
    },
    playCards(ctx, { player, payload }) {
      const seat = findSeat(ctx.state, player.id);
      if (!seat || !seat.connected) return;
      if (ctx.state.phase === "bidding") {
        bidDoudizhu(ctx, seat, Number(payload?.choice?.score));
        return;
      }
      const ids = Array.isArray(payload?.cardIds) ? payload.cardIds.filter((id) => typeof id === "string") : [];
      playCards(ctx, seat, ids, payload?.choice);
    },
    pass(ctx, { player }) {
      const seat = findSeat(ctx.state, player.id);
      if (seat?.connected) RUNTIMES[ctx.state.variantId].pass?.(ctx, seat);
    },
    drawCard(ctx, { player }) {
      const seat = findSeat(ctx.state, player.id);
      if (seat?.connected) RUNTIMES[ctx.state.variantId].draw?.(ctx, seat);
    },
    syncPrivate(ctx, { player }) {
      if (findSeat(ctx.state, player.id)) sendPrivate(ctx, player.id);
    },
    returnToLobby(ctx, { player }) {
      if (ctx.state.phase !== "settlement" || player.id !== ctx.state.hostId) return;
      returnLobby(ctx);
    }
  }
});
function initialState() {
  return { schema: 1, phase: "lobby", variantId: "doudizhu", variants: variantList(), hostId: null, seats: Array(8).fill(null), currentPlayerId: null, lastPlay: null, variant: {}, settlement: null, message: "\u7B49\u5F85\u73A9\u5BB6\u52A0\u5165", actionSeq: 0 };
}
function makeSeat(id, name, seat, bot) {
  return { id, name, seat, bot, connected: true, ready: bot, handCount: 0, score: 0, role: null };
}
function occupied(state) {
  return state.seats.filter((s) => Boolean(s)).sort((a, b) => a.seat - b.seat);
}
function findSeat(state, id) {
  return state.seats.find((s) => s?.id === id) ?? null;
}
function hostLobby(ctx, id) {
  return ctx.state.phase === "lobby" && ctx.state.hostId === id;
}
function clearReady(state) {
  for (const s of occupied(state)) s.ready = s.bot;
}
function nextId(state, id) {
  const seats = occupied(state), index = seats.findIndex((s) => s.id === id);
  return seats[(index + 1) % seats.length].id;
}
function notice(ctx, id, message) {
  ctx.send(id, "poker:notice", { message });
}
function fx(ctx, kind, actorId, cards, label) {
  ctx.broadcast("poker:action-fx", { actionId: `poker:${Date.now()}:${++ctx.state.actionSeq}`, occurredAt: Date.now(), kind, actorId, cards, label });
}
function resetRoundSecrets(ctx) {
  ctx.clearTimer("poker:bot");
  hands = {};
  deck = [];
  landlordHidden = [];
  discardPile = [];
  trickPasses = 0;
  playCounts = {};
}
function startGame(ctx) {
  resetRoundSecrets(ctx);
  const state = ctx.state;
  state.phase = "dealing";
  state.currentPlayerId = null;
  state.lastPlay = null;
  state.settlement = null;
  state.variant = {};
  for (const s of occupied(state)) {
    s.ready = s.bot;
    s.handCount = 0;
    s.score = 0;
    s.role = null;
  }
  RUNTIMES[state.variantId].start(ctx);
  sendAllPrivate(ctx);
  fx(ctx, "deal", void 0, void 0, "\u53D1\u724C");
  scheduleBot(ctx);
}
function startDoudizhu(ctx) {
  const seats = occupied(ctx.state);
  deck = shuffle(createDeck({ jokers: true, aceHigh: true }), () => ctx.random());
  hands = {};
  for (const s of seats) hands[s.id] = sortCards(deck.splice(0, 17));
  landlordHidden = deck.splice(0, 3);
  const starter = seats[0].id;
  ctx.state.phase = "bidding";
  ctx.state.variant = { bid: { currentPlayerId: starter, highestScore: 0, highestPlayerId: null, turns: 0 }, landlordCards: [], multiplier: 1, passCount: 0 };
  ctx.state.message = `${findSeat(ctx.state, starter).name} \u5F00\u59CB\u53EB\u5730\u4E3B`;
  for (const s of seats) s.handCount = 17;
  ctx.state.currentPlayerId = starter;
}
function startGandengyan(ctx) {
  const seats = occupied(ctx.state), copies = seats.length === 2 ? 1 : 2;
  deck = shuffle(createDeck({ jokers: true, copies, aceHigh: true }), () => ctx.random());
  hands = {};
  for (const s of seats) hands[s.id] = sortCards(deck.splice(0, s.seat === seats[0].seat ? 6 : 5));
  for (const s of seats) s.handCount = hands[s.id].length;
  ctx.state.phase = "playing";
  ctx.state.currentPlayerId = seats[0].id;
  ctx.state.variant = { bombs: 0, deckCount: deck.length, passCount: 0 };
  ctx.state.message = `${seats[0].name} \u5148\u51FA\u724C`;
}
function startChameleon(ctx) {
  const seats = occupied(ctx.state);
  deck = shuffle(createDeck(), () => ctx.random());
  hands = {};
  for (const s of seats) hands[s.id] = sortCards(deck.splice(0, 5));
  let firstIndex = deck.findIndex((c) => c.rank !== 11);
  if (firstIndex < 0) firstIndex = 0;
  const [first] = deck.splice(firstIndex, 1);
  discardPile = [first];
  for (const s of seats) s.handCount = 5;
  ctx.state.phase = "playing";
  ctx.state.currentPlayerId = seats[0].id;
  ctx.state.lastPlay = { playerId: "table", cards: [first] };
  ctx.state.variant = { activeSuit: first.suit, activeRank: first.rank, deckCount: deck.length, drawPending: false };
  ctx.state.message = `${seats[0].name} \u51FA\u724C`;
}
function playCards(ctx, seat, ids, choice) {
  if (ctx.state.phase !== "playing" || ctx.state.currentPlayerId !== seat.id) return invalid(ctx, seat.id, "\u8FD8\u6CA1\u8F6E\u5230\u4F60");
  const selected = takeCards(hands[seat.id] ?? [], ids);
  if (!selected?.length) return invalid(ctx, seat.id, "\u8BF7\u9009\u62E9\u6709\u6548\u624B\u724C");
  RUNTIMES[ctx.state.variantId].play(ctx, seat, selected, choice);
}
function removeSelected(id, cards) {
  const ids = new Set(cards.map((c) => c.id));
  hands[id] = sortCards(hands[id].filter((c) => !ids.has(c.id)));
}
function invalid(ctx, id, message) {
  notice(ctx, id, message);
}
function playDoudizhu(ctx, seat, cards) {
  const analysis = analyzeDoudizhu(cards);
  if (!analysis) return invalid(ctx, seat.id, "\u724C\u578B\u4E0D\u5408\u6CD5");
  const previous = ctx.state.lastPlay?.analysis ?? null;
  if (!canBeatDoudizhu(analysis, previous)) return invalid(ctx, seat.id, "\u9700\u8981\u51FA\u540C\u724C\u578B\u66F4\u5927\u7684\u724C\uFF0C\u6216\u4F7F\u7528\u70B8\u5F39/\u706B\u7BAD");
  removeSelected(seat.id, cards);
  seat.handCount = hands[seat.id].length;
  playCounts[seat.id] = (playCounts[seat.id] ?? 0) + 1;
  ctx.state.lastPlay = { playerId: seat.id, cards: sortCards(cards), analysis };
  trickPasses = 0;
  ctx.state.variant.passCount = 0;
  if (analysis.type === "bomb" || analysis.type === "rocket") ctx.state.variant.multiplier = (ctx.state.variant.multiplier ?? 1) * 2;
  fx(ctx, "play", seat.id, cards, analysis.label);
  if (!seat.handCount) return settleDoudizhu(ctx, seat.id);
  ctx.state.currentPlayerId = nextId(ctx.state, seat.id);
  ctx.state.message = `\u8F6E\u5230 ${findSeat(ctx.state, ctx.state.currentPlayerId).name}`;
  sendAllPrivate(ctx);
  scheduleBot(ctx);
}
function settleDoudizhu(ctx, winnerId) {
  const seats = occupied(ctx.state), landlord = seats.find((s) => s.role === "landlord"), landlordWon = winnerId === landlord.id, multiplier = ctx.state.variant.multiplier ?? 1;
  const farmers = seats.filter((s) => s.role === "farmer");
  const spring = landlordWon ? farmers.every((s) => (playCounts[s.id] ?? 0) === 0) : (playCounts[landlord.id] ?? 0) <= 1;
  const total = multiplier * (spring ? 2 : 1), deltas = {};
  deltas[landlord.id] = landlordWon ? total * 2 : -total * 2;
  for (const f of farmers) deltas[f.id] = landlordWon ? -total : total;
  settle(ctx, { winnerIds: landlordWon ? [landlord.id] : farmers.map((s) => s.id), deltas, title: landlordWon ? "\u5730\u4E3B\u80DC\u5229" : "\u519C\u6C11\u80DC\u5229", detail: `\u500D\u6570 x${total}${spring ? " \xB7 \u6625\u5929" : ""}` });
}
function bidDoudizhu(ctx, seat, score2) {
  const bid = ctx.state.variant.bid;
  if (ctx.state.phase !== "bidding" || !bid || bid.currentPlayerId !== seat.id || !Number.isInteger(score2) || score2 < 0 || score2 > 3 || score2 > 0 && score2 <= bid.highestScore) return;
  bid.turns += 1;
  if (score2 > 0) {
    bid.highestScore = score2;
    bid.highestPlayerId = seat.id;
  }
  fx(ctx, "bid", seat.id, void 0, score2 ? "\u53EB " + score2 + " \u5206" : "\u4E0D\u53EB");
  if (score2 === 3 || bid.turns >= 3) {
    if (!bid.highestPlayerId) {
      startDoudizhu(ctx);
      sendAllPrivate(ctx);
      scheduleBot(ctx);
      return;
    }
    const landlord = findSeat(ctx.state, bid.highestPlayerId);
    for (const s of occupied(ctx.state)) s.role = s.id === landlord.id ? "landlord" : "farmer";
    hands[landlord.id] = sortCards([...hands[landlord.id], ...landlordHidden]);
    landlord.handCount = 20;
    ctx.state.variant.landlordCards = [...landlordHidden];
    ctx.state.variant.multiplier = bid.highestScore;
    ctx.state.variant.bid = void 0;
    ctx.state.phase = "playing";
    ctx.state.currentPlayerId = landlord.id;
    ctx.state.message = `${landlord.name} \u6210\u4E3A\u5730\u4E3B`;
    sendAllPrivate(ctx);
    fx(ctx, "landlord", landlord.id, landlordHidden, "\u5730\u4E3B");
    scheduleBot(ctx);
    return;
  }
  bid.currentPlayerId = nextId(ctx.state, seat.id);
  ctx.state.currentPlayerId = bid.currentPlayerId;
  scheduleBot(ctx);
}
function playGandengyan(ctx, seat, cards) {
  const analysis = analyzeGandengyan(cards);
  if (!analysis) return invalid(ctx, seat.id, "\u724C\u578B\u4E0D\u5408\u6CD5\uFF0C\u738B\u4E0D\u80FD\u5355\u72EC\u51FA");
  if (!canBeatGandengyan(analysis, ctx.state.lastPlay?.analysis ?? null)) return invalid(ctx, seat.id, "\u5FC5\u987B\u4EE5\u76F8\u540C\u724C\u578B\u6070\u597D\u5927\u4E00\u7EA7\u63A5\u724C");
  removeSelected(seat.id, cards);
  seat.handCount = hands[seat.id].length;
  ctx.state.lastPlay = { playerId: seat.id, cards: sortCards(cards), analysis };
  trickPasses = 0;
  ctx.state.variant.passCount = 0;
  if (analysis.type === "bomb") ctx.state.variant.bombs = (ctx.state.variant.bombs ?? 0) + 1;
  fx(ctx, "play", seat.id, cards, analysis.label);
  if (!seat.handCount) return settleGandengyan(ctx, seat.id);
  ctx.state.currentPlayerId = nextId(ctx.state, seat.id);
  sendAllPrivate(ctx);
  scheduleBot(ctx);
}
function settleGandengyan(ctx, winnerId) {
  const factor = 2 ** (ctx.state.variant.bombs ?? 0), deltas = {}, seats = occupied(ctx.state);
  let sum = 0;
  for (const s of seats) if (s.id !== winnerId) {
    const loss = (hands[s.id]?.length ?? 0) * factor;
    deltas[s.id] = -loss;
    sum += loss;
  }
  deltas[winnerId] = sum;
  settle(ctx, { winnerIds: [winnerId], deltas, title: `${findSeat(ctx.state, winnerId).name} \u80DC\u5229`, detail: `\u70B8\u5F39\u500D\u7387 x${factor}` });
}
function pass(ctx, seat) {
  if (ctx.state.phase !== "playing" || ctx.state.currentPlayerId !== seat.id || !ctx.state.lastPlay || ctx.state.lastPlay.playerId === seat.id) return;
  if (ctx.state.variantId === "doudizhu" || ctx.state.variantId === "gandengyan") {
    trickPasses += 1;
    ctx.state.variant.passCount = trickPasses;
    fx(ctx, "pass", seat.id, void 0, "\u4E0D\u51FA");
    const count = occupied(ctx.state).length;
    if (trickPasses >= count - 1) {
      const leader = ctx.state.lastPlay.playerId;
      ctx.state.lastPlay = null;
      trickPasses = 0;
      ctx.state.variant.passCount = 0;
      if (ctx.state.variantId === "gandengyan") refillGandengyan(ctx, leader);
      ctx.state.currentPlayerId = leader;
      fx(ctx, "clear", leader, void 0, "\u65B0\u4E00\u8F6E");
    } else ctx.state.currentPlayerId = nextId(ctx.state, seat.id);
    sendAllPrivate(ctx);
    scheduleBot(ctx);
  }
}
function refillGandengyan(ctx, leader) {
  const seats = occupied(ctx.state), start = seats.findIndex((s) => s.id === leader);
  for (let offset = 0; offset < seats.length && deck.length; offset += 1) {
    const s = seats[(start + offset) % seats.length];
    hands[s.id].push(deck.shift());
    hands[s.id] = sortCards(hands[s.id]);
    s.handCount = hands[s.id].length;
  }
  ctx.state.variant.deckCount = deck.length;
}
function playChameleon(ctx, seat, cards, rawChoice) {
  if (cards.length !== 1) return invalid(ctx, seat.id, "\u53D8\u8272\u9F99\u6BCF\u6B21\u53EA\u80FD\u51FA\u4E00\u5F20");
  const card = cards[0], suit = ctx.state.variant.activeSuit, rank = ctx.state.variant.activeRank;
  if (!isChameleonLegal(card, suit, rank)) return invalid(ctx, seat.id, "\u53EA\u80FD\u51FA\u540C\u82B1\u8272\u3001\u540C\u70B9\u6570\u6216J");
  const choice = card.rank === 11 ? validateChoice(rawChoice) : null;
  if (card.rank === 11 && !choice) return invalid(ctx, seat.id, "\u8BF7\u4E3A\u53D8\u8272\u9F99\u6307\u5B9A\u82B1\u8272\u548C\u70B9\u6570");
  removeSelected(seat.id, cards);
  discardPile.push(card);
  seat.handCount = hands[seat.id].length;
  ctx.state.lastPlay = { playerId: seat.id, cards: [card], choice: choice ?? void 0 };
  ctx.state.variant.activeSuit = choice?.suit ?? card.suit;
  ctx.state.variant.activeRank = choice?.rank ?? card.rank;
  ctx.state.variant.drawPending = false;
  fx(ctx, "play", seat.id, cards, card.rank === 11 ? `\u53D8\u4E3A ${suitName(choice.suit)} ${choice.rank}` : "\u51FA\u724C");
  if (!seat.handCount) return settleChameleon(ctx, seat.id);
  ctx.state.currentPlayerId = nextId(ctx.state, seat.id);
  sendAllPrivate(ctx);
  scheduleBot(ctx);
}
function drawChameleon(ctx, seat) {
  if (ctx.state.variantId !== "chameleon" || ctx.state.phase !== "playing" || ctx.state.currentPlayerId !== seat.id) return;
  const legal = hands[seat.id].some((c) => isChameleonLegal(c, ctx.state.variant.activeSuit, ctx.state.variant.activeRank));
  if (legal) return invalid(ctx, seat.id, "\u6709\u724C\u53EF\u51FA\u65F6\u4E0D\u80FD\u6478\u724C");
  if (!deck.length && discardPile.length > 1) {
    const top = discardPile.pop();
    deck = shuffle(discardPile, () => ctx.random());
    discardPile = [top];
  }
  if (!deck.length) {
    ctx.state.currentPlayerId = nextId(ctx.state, seat.id);
    sendAllPrivate(ctx);
    scheduleBot(ctx);
    return;
  }
  const card = deck.shift();
  hands[seat.id] = sortCards([...hands[seat.id], card]);
  seat.handCount = hands[seat.id].length;
  ctx.state.variant.deckCount = deck.length;
  fx(ctx, "draw", seat.id, void 0, "\u6478\u724C");
  if (isChameleonLegal(card, ctx.state.variant.activeSuit, ctx.state.variant.activeRank)) {
    ctx.state.variant.drawPending = true;
    sendAllPrivate(ctx);
    scheduleBot(ctx);
    return;
  }
  ctx.state.variant.drawPending = false;
  ctx.state.currentPlayerId = nextId(ctx.state, seat.id);
  sendAllPrivate(ctx);
  scheduleBot(ctx);
}
function settleChameleon(ctx, winnerId) {
  const deltas = {}, seats = occupied(ctx.state);
  let sum = 0;
  for (const s of seats) if (s.id !== winnerId) {
    const loss = (hands[s.id] ?? []).reduce((n, c) => n + chameleonCardPoints(c), 0);
    deltas[s.id] = -loss;
    sum += loss;
  }
  deltas[winnerId] = sum;
  settle(ctx, { winnerIds: [winnerId], deltas, title: `${findSeat(ctx.state, winnerId).name} \u80DC\u5229`, detail: `\u83B7\u5F97 ${sum} \u5206` });
}
function suitName(suit) {
  return { spades: "\u9ED1\u6843", hearts: "\u7EA2\u5FC3", clubs: "\u6885\u82B1", diamonds: "\u65B9\u5757", joker: "\u738B" }[suit];
}
function settle(ctx, result2) {
  ctx.clearTimer("poker:bot");
  ctx.state.phase = "settlement";
  ctx.state.currentPlayerId = null;
  ctx.state.settlement = result2;
  for (const [id, delta] of Object.entries(result2.deltas)) {
    const s = findSeat(ctx.state, id);
    if (s) s.score += delta;
  }
  ctx.state.message = result2.title;
  ctx.broadcast("poker:settlement", result2);
  fx(ctx, "settlement", result2.winnerIds[0], void 0, result2.title);
  sendAllPrivate(ctx);
}
function returnLobby(ctx) {
  resetRoundSecrets(ctx);
  ctx.state.phase = "lobby";
  ctx.state.currentPlayerId = null;
  ctx.state.lastPlay = null;
  ctx.state.variant = {};
  ctx.state.settlement = null;
  for (const s of occupied(ctx.state)) {
    if (!s.bot && !s.connected) {
      ctx.state.seats[s.seat] = null;
      continue;
    }
    s.ready = s.bot;
    s.handCount = 0;
    s.role = null;
    s.score = 0;
  }
  ensureHost(ctx);
  ctx.state.message = "\u53EF\u4EE5\u91CD\u65B0\u9009\u62E9\u73A9\u6CD5\u548C\u5E2D\u4F4D\uFF0C\u8BF7\u51C6\u5907";
}
function ensureHost(ctx) {
  if (!ctx.state.hostId || !findSeat(ctx.state, ctx.state.hostId)) ctx.state.hostId = occupied(ctx.state).find((s) => !s.bot)?.id ?? null;
}
function privateFor(ctx, id) {
  const hand = hands[id] ?? [], isTurn = ctx.state.currentPlayerId === id;
  let hasLegal = false;
  if (isTurn && ctx.state.variantId === "chameleon") hasLegal = hand.some((c) => isChameleonLegal(c, ctx.state.variant.activeSuit, ctx.state.variant.activeRank));
  return { hand, canPass: isTurn && ctx.state.variantId !== "chameleon" && Boolean(ctx.state.lastPlay && ctx.state.lastPlay.playerId !== id), canDraw: isTurn && ctx.state.variantId === "chameleon" && !hasLegal, needsChoice: isTurn && ctx.state.variantId === "chameleon" };
}
function sendPrivate(ctx, id) {
  const s = findSeat(ctx.state, id);
  if (s && !s.bot && s.connected) ctx.send(id, "poker:private-state", privateFor(ctx, id));
}
function sendAllPrivate(ctx) {
  for (const s of occupied(ctx.state)) sendPrivate(ctx, s.id);
}
function scheduleBot(ctx) {
  ctx.clearTimer("poker:bot");
  const id = ctx.state.currentPlayerId, seat = id ? findSeat(ctx.state, id) : null;
  if (!seat || !seat.bot && seat.connected || !["bidding", "playing"].includes(ctx.state.phase)) return;
  ctx.setTimer("poker:bot", 650 + Math.floor(ctx.random() * 550), () => runBot(ctx, seat.id));
}
function runBot(ctx, id) {
  const seat = findSeat(ctx.state, id);
  if (!seat || ctx.state.currentPlayerId !== id) return;
  RUNTIMES[ctx.state.variantId].ai(ctx, seat);
}
var RUNTIMES = {
  doudizhu: { start: startDoudizhu, play: (ctx, seat, cards) => playDoudizhu(ctx, seat, cards), pass, project: (state) => state.variant, ai(ctx, seat) {
    if (ctx.state.phase === "bidding") {
      const bid = ctx.state.variant.bid, hand = hands[seat.id] ?? [], strength = hand.filter((c) => c.rank >= 15).length + hand.filter((c) => hand.filter((x) => x.rank === c.rank).length === 4).length / 4;
      let score2 = strength >= 4 ? 3 : strength >= 2 ? 2 : strength >= 1 ? 1 : 0;
      if (score2 <= bid.highestScore) score2 = 0;
      bidDoudizhu(ctx, seat, score2);
      return;
    }
    const legal = enumerateDoudizhu(hands[seat.id] ?? [], ctx.state.lastPlay?.analysis ?? null);
    if (legal[0]) playDoudizhu(ctx, seat, legal[0]);
    else pass(ctx, seat);
  } },
  gandengyan: { start: startGandengyan, play: (ctx, seat, cards) => playGandengyan(ctx, seat, cards), pass, project: (state) => state.variant, ai(ctx, seat) {
    const legal = enumerateGandengyan(hands[seat.id] ?? [], ctx.state.lastPlay?.analysis ?? null);
    if (legal[0]) playGandengyan(ctx, seat, legal[0]);
    else pass(ctx, seat);
  } },
  chameleon: { start: startChameleon, play: playChameleon, draw: drawChameleon, project: (state) => state.variant, ai(ctx, seat) {
    const move = chooseChameleon(hands[seat.id] ?? [], ctx.state.variant.activeSuit, ctx.state.variant.activeRank);
    if (move) playChameleon(ctx, seat, [move.card], move.choice);
    else drawChameleon(ctx, seat);
  } }
};
export default index_default;

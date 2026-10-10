// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";
var DISTRICTS = {
  harbor: { name: "\u6D77\u6E2F\u533A", icon: "\u2693" },
  oldtown: { name: "\u65E7\u57CE\u533A", icon: "\u{1F3EE}" },
  tech: { name: "\u79D1\u6280\u533A", icon: "\u{1F916}" },
  garden: { name: "\u82B1\u56ED\u533A", icon: "\u{1F33F}" },
  finance: { name: "\u91D1\u878D\u533A", icon: "\u{1F4B9}" },
  skyline: { name: "\u5929\u9645\u533A", icon: "\u{1F306}" }
};
var DISTRICT_IDS = Object.keys(DISTRICTS);
var TILES = [
  { id: 0, name: "\u4E2D\u592E\u94F6\u884C", kind: "start", next: [1] },
  { id: 1, name: "\u6668\u66E6\u7801\u5934", kind: "property", district: "harbor", price: 1800, baseRent: 240, upgradeCost: 900, next: [2] },
  { id: 2, name: "\u6D77\u98CE\u9C7C\u5E02", kind: "property", district: "harbor", price: 2e3, baseRent: 280, upgradeCost: 1e3, next: [3] },
  { id: 3, name: "\u673A\u4F1A\u7AD9", kind: "chance", next: [4] },
  { id: 4, name: "\u706F\u5854\u8857", kind: "property", district: "harbor", price: 2300, baseRent: 320, upgradeCost: 1100, next: [5] },
  { id: 5, name: "\u7A0E\u52A1\u5C40", kind: "tax", tax: 800, next: [6] },
  { id: 6, name: "\u8001\u57CE\u8336\u9986", kind: "property", district: "oldtown", price: 2400, baseRent: 340, upgradeCost: 1200, next: [7] },
  { id: 7, name: "\u8001\u57CE\u5C94\u53E3", kind: "transit", next: [8, 10] },
  { id: 8, name: "\u620F\u9662\u8857", kind: "property", district: "oldtown", price: 2600, baseRent: 380, upgradeCost: 1300, next: [9] },
  { id: 9, name: "\u724C\u574A\u5DF7", kind: "property", district: "oldtown", price: 2900, baseRent: 430, upgradeCost: 1400, next: [12] },
  { id: 10, name: "\u8001\u57CE\u94F6\u884C", kind: "bank", next: [11] },
  { id: 11, name: "\u53E4\u73A9\u8857", kind: "property", district: "oldtown", price: 2800, baseRent: 410, upgradeCost: 1400, next: [12] },
  { id: 12, name: "\u79D1\u6280\u5E7F\u573A", kind: "property", district: "tech", price: 3200, baseRent: 480, upgradeCost: 1600, next: [13] },
  { id: 13, name: "\u6570\u636E\u4E2D\u5FC3", kind: "property", district: "tech", price: 3500, baseRent: 540, upgradeCost: 1700, next: [14] },
  { id: 14, name: "\u673A\u5668\u4EBA\u5382", kind: "property", district: "tech", price: 3800, baseRent: 620, upgradeCost: 1900, next: [15] },
  { id: 15, name: "\u673A\u4F1A\u7AD9", kind: "chance", next: [16] },
  { id: 16, name: "\u57CE\u5E02\u516C\u56ED", kind: "rest", next: [17] },
  { id: 17, name: "\u73AB\u7470\u5927\u9053", kind: "property", district: "garden", price: 3e3, baseRent: 450, upgradeCost: 1500, next: [18] },
  { id: 18, name: "\u6E29\u5BA4\u82B1\u623F", kind: "property", district: "garden", price: 3300, baseRent: 510, upgradeCost: 1600, next: [19] },
  { id: 19, name: "\u6E56\u7554\u522B\u5885", kind: "property", district: "garden", price: 3600, baseRent: 580, upgradeCost: 1800, next: [20] },
  { id: 20, name: "\u4E2D\u592E\u5C94\u53E3", kind: "transit", next: [21, 23] },
  { id: 21, name: "\u8BC1\u5238\u8857", kind: "property", district: "finance", price: 4e3, baseRent: 680, upgradeCost: 2e3, next: [22] },
  { id: 22, name: "\u91D1\u5E93\u5E7F\u573A", kind: "property", district: "finance", price: 4400, baseRent: 760, upgradeCost: 2200, next: [25] },
  { id: 23, name: "\u4EA4\u6613\u94F6\u884C", kind: "bank", next: [24] },
  { id: 24, name: "\u57FA\u91D1\u5927\u9053", kind: "property", district: "finance", price: 4200, baseRent: 720, upgradeCost: 2100, next: [25] },
  { id: 25, name: "\u4E91\u7AEF\u516C\u5BD3", kind: "property", district: "skyline", price: 4600, baseRent: 820, upgradeCost: 2300, next: [26] },
  { id: 26, name: "\u6469\u5929\u4E2D\u5FC3", kind: "property", district: "skyline", price: 5e3, baseRent: 900, upgradeCost: 2500, next: [27] },
  { id: 27, name: "\u5929\u7A7A\u9152\u5E97", kind: "property", district: "skyline", price: 5400, baseRent: 980, upgradeCost: 2700, next: [28] },
  { id: 28, name: "\u57CE\u5E02\u7A0E", kind: "tax", tax: 1200, next: [29] },
  { id: 29, name: "\u673A\u4F1A\u7AD9", kind: "chance", next: [30] },
  { id: 30, name: "\u6362\u4E58\u67A2\u7EBD", kind: "transit", next: [31] },
  { id: 31, name: "\u591C\u5E02", kind: "chance", next: [0] }
];
var PROPERTY_IDS = TILES.filter((t) => t.kind === "property").map((t) => t.id);
var DISTRICT_PROPERTY_IDS = Object.fromEntries(
  DISTRICT_IDS.map((district) => [district, TILES.filter((t) => t.district === district).map((t) => t.id)])
);
var CARD_LABELS = {
  boost: "\u75BE\u884C +3",
  exact: "\u9065\u63A7\u9AB0\u5B50",
  rentShield: "\u514D\u79DF\u5238",
  rentDouble: "\u52A0\u500D\u79DF\u91D1",
  swap: "\u5F3A\u5236\u4EA4\u6362",
  insider: "\u5E02\u573A\u5185\u5E55",
  upgrade: "\u65BD\u5DE5\u961F",
  blackout: "\u505C\u7535",
  rebate: "\u73B0\u91D1\u8FD4\u8FD8",
  teleport: "\u94F6\u884C\u5FEB\u7EBF",
  marketBoom: "\u5E02\u573A\u7E41\u8363",
  taxAudit: "\u7A0E\u52A1\u5BA1\u8BA1"
};
var CARD_POOL = [
  "boost",
  "boost",
  "exact",
  "rentShield",
  "rentShield",
  "rentDouble",
  "swap",
  "insider",
  "insider",
  "upgrade",
  "blackout",
  "rebate",
  "rebate",
  "teleport",
  "marketBoom",
  "taxAudit"
];
function emptyStocks() {
  return { harbor: 0, oldtown: 0, tech: 0, garden: 0, finance: 0, skyline: 0 };
}
function drawCard() {
  return CARD_POOL[Math.floor(Math.random() * CARD_POOL.length)];
}
function addLog(state, message) {
  state.log.push(message);
  if (state.log.length > 24) state.log.splice(0, state.log.length - 24);
}
function currentPlayerId(state) {
  return state.order[state.turnIndex] ?? null;
}
function districtOwnedCount(state, playerId, district) {
  return DISTRICT_PROPERTY_IDS[district].filter((id) => state.properties[String(id)].ownerId === playerId).length;
}
function districtRentMultiplier(state, playerId, district) {
  const owned = districtOwnedCount(state, playerId, district);
  const total = DISTRICT_PROPERTY_IDS[district].length;
  if (owned >= total) return 2;
  if (owned >= 2) return 1.5;
  return 1;
}
function propertyCurrentValue(tile, prop) {
  return (tile.price ?? 0) + Math.max(0, prop.level - 1) * (tile.upgradeCost ?? 0);
}
function netWorth(state, playerId) {
  const p = state.players[playerId];
  if (!p) return 0;
  const propertyValue = p.properties.reduce((sum, id) => {
    const tile = TILES[id];
    return sum + propertyCurrentValue(tile, state.properties[String(id)]);
  }, 0);
  const stockValue = DISTRICT_IDS.reduce((sum, district) => sum + p.stocks[district] * state.stockPrices[district], 0);
  return p.cash + propertyValue + stockValue - p.bankruptcies * 3e3;
}
function leaderboard(state) {
  return state.order.filter((id) => state.players[id]).map((id) => ({ id, value: netWorth(state, id) })).sort((a, b) => b.value - a.value);
}
function finishGame(state, winnerId, reason) {
  state.phase = "finished";
  state.winnerId = winnerId;
  state.finishReason = reason;
  state.pendingMove = null;
  state.pendingPropertyId = null;
  state.auction = null;
  state.trade = null;
  addLog(state, `\u{1F3C6} ${state.players[winnerId]?.name ?? "\u73A9\u5BB6"} \u83B7\u80DC\uFF1A${reason}`);
}
function checkEarlyVictory(state) {
  if (state.phase !== "turn") return false;
  const board = leaderboard(state);
  if (board.length < 2) return false;
  if (board[0].value >= 5e4 && board[0].value - board[1].value >= 15e3) {
    finishGame(state, board[0].id, "\u51C0\u8D44\u4EA7\u7A81\u7834 50,000 \u4E14\u9886\u5148\u7B2C\u4E8C\u540D\u81F3\u5C11 15,000");
    return true;
  }
  return false;
}
function bankrupt(state, playerId, creditorId) {
  const p = state.players[playerId];
  if (!p) return;
  if (creditorId && state.players[creditorId] && p.cash > 0) state.players[creditorId].cash += p.cash;
  p.cash = 0;
  for (const id of [...p.properties]) {
    state.properties[String(id)] = { ownerId: null, level: 1, blackoutUntilRound: 0 };
  }
  p.properties = [];
  p.stocks = emptyStocks();
  p.cards = [];
  p.bankruptcies += 1;
  p.restTurns = 1;
  p.rescuePending = true;
  p.rentShield = 0;
  p.doubleRentArmed = false;
  addLog(state, `\u{1F4A5} ${p.name} \u7834\u4EA7\u6E05\u7B97\uFF0C\u4F11\u6574 1 \u56DE\u5408\u540E\u83B7\u5F97 5,000 \u6551\u52A9\u91D1`);
}
function charge(state, payerId, amount, receiverId) {
  const payer = state.players[payerId];
  if (!payer || amount <= 0) return true;
  if (payer.cash >= amount) {
    payer.cash -= amount;
    if (receiverId && state.players[receiverId]) state.players[receiverId].cash += amount;
    return true;
  }
  bankrupt(state, payerId, receiverId);
  return false;
}
function maybePassStart(state, from, to, playerId) {
  if (from === 31 && to === 0) {
    const p = state.players[playerId];
    p.cash += 1500;
    state.bankAccess = true;
    addLog(state, `\u{1F3E6} ${p.name} \u7ECF\u8FC7\u4E2D\u592E\u94F6\u884C\uFF0C\u83B7\u5F97 1,500 \u5E76\u89E3\u9501\u672C\u56DE\u5408\u80A1\u7968\u4EA4\u6613`);
  }
}
function finishMovement(state, playerId) {
  state.pendingMove = null;
  const player = state.players[playerId];
  const tile = TILES[player.position];
  if (tile.kind === "property") {
    const prop = state.properties[String(tile.id)];
    if (!prop.ownerId) {
      state.pendingPropertyId = tile.id;
      state.stage = "landingDecision";
      addLog(state, `\u{1F3E0} ${player.name} \u5230\u8FBE\u65E0\u4EBA\u5730\u4EA7\u300C${tile.name}\u300D`);
      return;
    }
    if (prop.ownerId === playerId) {
      state.stage = "manage";
      addLog(state, `\u{1F511} ${player.name} \u56DE\u5230\u81EA\u5DF1\u7684\u300C${tile.name}\u300D`);
      return;
    }
    if (prop.blackoutUntilRound >= state.round) {
      state.stage = "manage";
      addLog(state, `\u{1F311} \u300C${tile.name}\u300D\u505C\u7535\u4E2D\uFF0C\u672C\u6B21\u514D\u79DF`);
      return;
    }
    const owner = state.players[prop.ownerId];
    const multiplier = districtRentMultiplier(state, owner.id, tile.district);
    let rent = Math.round((tile.baseRent ?? 0) * prop.level * multiplier);
    if (owner.doubleRentArmed) {
      rent *= 2;
      owner.doubleRentArmed = false;
    }
    if (player.rentShield > 0) {
      player.rentShield -= 1;
      addLog(state, `\u{1F6E1}\uFE0F ${player.name} \u4F7F\u7528\u514D\u79DF\u5238\uFF0C\u62B5\u6D88\u300C${tile.name}\u300D\u79DF\u91D1 ${rent}`);
      state.stage = "manage";
      return;
    }
    const paid = charge(state, playerId, rent, owner.id);
    addLog(state, paid ? `\u{1F4B8} ${player.name} \u5411 ${owner.name} \u652F\u4ED8\u79DF\u91D1 ${rent}` : `\u{1F4B8} ${player.name} \u65E0\u6CD5\u652F\u4ED8\u79DF\u91D1 ${rent}`);
    state.stage = "manage";
    return;
  }
  if (tile.kind === "tax") {
    const amount = tile.tax ?? 0;
    const paid = charge(state, playerId, amount);
    addLog(state, paid ? `\u{1F9FE} ${player.name} \u7F34\u7A0E ${amount}` : `\u{1F9FE} ${player.name} \u56E0\u7A0E\u6B3E\u89E6\u53D1\u7834\u4EA7`);
  } else if (tile.kind === "chance") {
    resolveChance(state, playerId);
  } else if (tile.kind === "bank" || tile.kind === "start") {
    state.bankAccess = true;
    addLog(state, `\u{1F4B9} ${player.name} \u5230\u8FBE\u94F6\u884C\uFF0C\u672C\u56DE\u5408\u53EF\u4EE5\u4EA4\u6613\u80A1\u7968`);
  } else if (tile.kind === "rest") {
    player.cash += 500;
    addLog(state, `\u{1F33F} ${player.name} \u5728\u57CE\u5E02\u516C\u56ED\u4F11\u606F\uFF0C\u83B7\u5F97 500 \u57CE\u5E02\u798F\u5229`);
  }
  state.stage = "manage";
}
function continueMove(state, playerId, forcedNext) {
  const move = state.pendingMove;
  if (!move) return;
  while (move.remaining > 0) {
    const player = state.players[playerId];
    const tile = TILES[player.position];
    const choices = tile.next;
    let next;
    if (forcedNext !== void 0) {
      if (!choices.includes(forcedNext)) return;
      next = forcedNext;
      forcedNext = void 0;
    } else if (choices.length > 1) {
      move.choices = [...choices];
      state.stage = "routeChoice";
      return;
    } else {
      next = choices[0];
    }
    maybePassStart(state, player.position, next, playerId);
    player.position = next;
    move.remaining -= 1;
  }
  finishMovement(state, playerId);
}
function resolveChance(state, playerId) {
  const p = state.players[playerId];
  const roll = Math.floor(Math.random() * 6);
  if (roll === 0) {
    p.cash += 1200;
    addLog(state, `\u{1F381} ${p.name} \u83B7\u5F97\u57CE\u5E02\u5206\u7EA2 1,200`);
  } else if (roll === 1) {
    charge(state, playerId, 700);
    addLog(state, `\u{1F6A7} ${p.name} \u9047\u5230\u9053\u8DEF\u7EF4\u4FEE\uFF0C\u652F\u4ED8 700`);
  } else if (roll === 2) {
    const card = drawCard();
    p.cards.push(card);
    addLog(state, `\u{1F0CF} ${p.name} \u62BD\u5230\u7B56\u7565\u5361\u300C${CARD_LABELS[card]}\u300D`);
  } else if (roll === 3) {
    const district = DISTRICT_IDS[Math.floor(Math.random() * DISTRICT_IDS.length)];
    p.stocks[district] += 3;
    addLog(state, `\u{1F4C8} ${p.name} \u83B7\u5F97 ${DISTRICTS[district].name} \u80A1\u7968 3 \u80A1`);
  } else if (roll === 4) {
    p.cash += 600;
    const card = drawCard();
    p.cards.push(card);
    addLog(state, `\u2728 ${p.name} \u83B7\u5F97 600 \u4E0E\u7B56\u7565\u5361\u300C${CARD_LABELS[card]}\u300D`);
  } else {
    const richest = leaderboard(state)[0];
    if (richest && richest.id === playerId) {
      charge(state, playerId, 1e3);
      addLog(state, `\u{1F451} ${p.name} \u4F5C\u4E3A\u5F53\u524D\u9996\u5BCC\u652F\u4ED8 1,000 \u57CE\u5E02\u516C\u76CA\u91D1`);
    } else {
      p.cash += 800;
      addLog(state, `\u{1F91D} ${p.name} \u83B7\u5F97\u8FFD\u8D76\u8865\u52A9 800`);
    }
  }
}
function startAuction(state, tileId) {
  state.auction = { tileId, currentBid: 0, highestBidderId: null, passed: [] };
  state.stage = "auction";
  addLog(state, `\u{1F528} \u300C${TILES[tileId].name}\u300D\u8FDB\u5165\u516C\u5F00\u62CD\u5356`);
}
function settleAuction(state) {
  const auction = state.auction;
  if (!auction) return;
  const tile = TILES[auction.tileId];
  if (auction.highestBidderId) {
    const winner = state.players[auction.highestBidderId];
    if (winner && winner.cash >= auction.currentBid) {
      winner.cash -= auction.currentBid;
      winner.properties.push(tile.id);
      state.properties[String(tile.id)].ownerId = winner.id;
      addLog(state, `\u{1F528} ${winner.name} \u4EE5 ${auction.currentBid} \u62CD\u5F97\u300C${tile.name}\u300D`);
    }
  } else {
    addLog(state, `\u{1F528} \u300C${tile.name}\u300D\u6D41\u62CD`);
  }
  state.auction = null;
  state.pendingPropertyId = null;
  state.stage = "manage";
}
function maybeSettleAuction(state) {
  const auction = state.auction;
  if (!auction) return;
  const eligible = state.order.filter((id) => state.players[id] && state.players[id].restTurns === 0);
  if (!auction.highestBidderId) {
    if (auction.passed.length >= eligible.length) settleAuction(state);
    return;
  }
  const others = eligible.filter((id) => id !== auction.highestBidderId);
  if (others.every((id) => auction.passed.includes(id))) settleAuction(state);
}
function advanceTurn(state) {
  if (state.phase !== "turn") return;
  state.trade = null;
  state.auction = null;
  state.pendingMove = null;
  state.pendingPropertyId = null;
  state.dice = null;
  state.bankAccess = false;
  let checked = 0;
  while (checked < Math.max(1, state.order.length * 2)) {
    state.turnIndex += 1;
    if (state.turnIndex >= state.order.length) {
      state.turnIndex = 0;
      state.round += 1;
      if (state.round > 20) {
        const board = leaderboard(state);
        if (board[0]) finishGame(state, board[0].id, "20 \u8F6E\u7ED3\u675F\uFF0C\u51C0\u8D44\u4EA7\u6700\u9AD8");
        return;
      }
    }
    const id = currentPlayerId(state);
    const p = id ? state.players[id] : null;
    checked += 1;
    if (!p) continue;
    if (p.restTurns > 0) {
      p.restTurns -= 1;
      addLog(state, `\u23F8\uFE0F ${p.name} \u672C\u8F6E\u4F11\u6574\uFF0C\u8DF3\u8FC7\u56DE\u5408`);
      if (p.restTurns === 0 && p.rescuePending) {
        p.cash += 5e3;
        p.rescuePending = false;
        addLog(state, `\u{1F6DF} ${p.name} \u83B7\u5F97 5,000 \u6551\u52A9\u91D1\uFF0C\u4E0B\u4E00\u8F6E\u91CD\u8FD4\u5E02\u573A`);
      }
      continue;
    }
    state.stage = "preRoll";
    addLog(state, `\u{1F3AF} \u7B2C ${state.round} \u8F6E \xB7 \u8F6E\u5230 ${p.name}`);
    return;
  }
}
function consumeCard(p, kind) {
  const index = p.cards.indexOf(kind);
  if (index < 0) return false;
  p.cards.splice(index, 1);
  return true;
}
function makeInitialState() {
  const properties = {};
  PROPERTY_IDS.forEach((id) => {
    properties[String(id)] = { ownerId: null, level: 1, blackoutUntilRound: 0 };
  });
  return {
    phase: "lobby",
    stage: "preRoll",
    players: {},
    order: [],
    turnIndex: 0,
    round: 1,
    dice: null,
    pendingMove: null,
    pendingPropertyId: null,
    auction: null,
    trade: null,
    properties,
    stockPrices: { harbor: 100, oldtown: 100, tech: 100, garden: 100, finance: 100, skyline: 100 },
    bankAccess: false,
    winnerId: null,
    finishReason: null,
    log: ["\u6B22\u8FCE\u6765\u5230 Parti \u5927\u5BCC\u7FC1\u30022\u20136 \u4EBA\u5373\u53EF\u5F00\u59CB\u3002"]
  };
}
function publicConfig() {
  return { tiles: TILES, districts: DISTRICTS, districtPropertyIds: DISTRICT_PROPERTY_IDS, cardLabels: CARD_LABELS };
}
var index_default = defineRoom({
  meta: { name: "Parti \u5927\u5BCC\u7FC1", minPlayers: 2, maxPlayers: 6 },
  initialState() {
    return { ...makeInitialState(), config: publicConfig() };
  },
  onJoin(ctx, player) {
    const state = ctx.state;
    if (state.players[player.id]) return;
    state.players[player.id] = {
      id: player.id,
      name: player.name || `\u73A9\u5BB6${state.order.length + 1}`,
      cash: 15e3,
      position: 0,
      properties: [],
      stocks: emptyStocks(),
      cards: [drawCard(), drawCard()],
      bankruptcies: 0,
      restTurns: 0,
      rescuePending: false,
      rentShield: 0,
      doubleRentArmed: false
    };
    state.order.push(player.id);
    addLog(state, `\u{1F44B} ${state.players[player.id].name} \u52A0\u5165\u623F\u95F4`);
  },
  onLeave(ctx, player) {
    const state = ctx.state;
    if (!state.players[player.id]) return;
    const name = state.players[player.id].name;
    const leavingIndex = state.order.indexOf(player.id);
    delete state.players[player.id];
    state.order = state.order.filter((id) => id !== player.id);
    PROPERTY_IDS.forEach((id) => {
      if (state.properties[String(id)].ownerId === player.id) state.properties[String(id)] = { ownerId: null, level: 1, blackoutUntilRound: 0 };
    });
    if (state.trade && (state.trade.proposerId === player.id || state.trade.targetId === player.id)) state.trade = null;
    if (state.auction) {
      if (state.auction.highestBidderId === player.id) {
        state.auction.highestBidderId = null;
        state.auction.currentBid = 0;
      }
      state.auction.passed = state.auction.passed.filter((id) => id !== player.id);
      maybeSettleAuction(state);
    }
    if (leavingIndex >= 0 && leavingIndex < state.turnIndex) state.turnIndex -= 1;
    if (state.turnIndex >= state.order.length) state.turnIndex = 0;
    addLog(state, `\u{1F44B} ${name} \u79BB\u5F00\u623F\u95F4`);
    if (state.phase === "turn" && state.order.length < 2) {
      state.phase = "lobby";
      state.stage = "preRoll";
      addLog(state, "\u7B49\u5F85\u81F3\u5C11 2 \u540D\u73A9\u5BB6\u7EE7\u7EED\u6E38\u620F");
    }
  },
  actions: {
    start(ctx, { player }) {
      const state = ctx.state;
      if (state.phase !== "lobby" || !state.players[player.id] || state.order.length < 2) return;
      state.phase = "turn";
      state.round = 1;
      state.turnIndex = 0;
      state.stage = "preRoll";
      addLog(state, `\u{1F680} ${state.players[player.id].name} \u5F00\u59CB\u6E38\u620F`);
      addLog(state, `\u{1F3AF} \u7B2C 1 \u8F6E \xB7 \u8F6E\u5230 ${state.players[currentPlayerId(state)].name}`);
      ctx.broadcast?.("game:start", {});
    },
    roll(ctx, { player }) {
      const state = ctx.state;
      if (state.phase !== "turn" || state.stage !== "preRoll" || currentPlayerId(state) !== player.id) return;
      const die = 1 + Math.floor(Math.random() * 6);
      state.dice = die;
      state.pendingMove = { remaining: die, choices: [] };
      addLog(state, `\u{1F3B2} ${state.players[player.id].name} \u63B7\u51FA ${die}`);
      continueMove(state, player.id);
    },
    chooseRoute(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== "turn" || state.stage !== "routeChoice" || currentPlayerId(state) !== player.id || !state.pendingMove) return;
      const target = Number(payload?.target);
      if (!state.pendingMove.choices.includes(target)) return;
      state.pendingMove.choices = [];
      continueMove(state, player.id, target);
    },
    buyProperty(ctx, { player }) {
      const state = ctx.state;
      if (state.stage !== "landingDecision" || currentPlayerId(state) !== player.id || state.pendingPropertyId == null) return;
      const tile = TILES[state.pendingPropertyId];
      const prop = state.properties[String(tile.id)];
      if (prop.ownerId || state.players[player.id].cash < (tile.price ?? 0)) return;
      state.players[player.id].cash -= tile.price ?? 0;
      state.players[player.id].properties.push(tile.id);
      prop.ownerId = player.id;
      addLog(state, `\u{1F3E0} ${state.players[player.id].name} \u4EE5 ${tile.price} \u4E70\u4E0B\u300C${tile.name}\u300D`);
      state.pendingPropertyId = null;
      state.stage = "manage";
      checkEarlyVictory(state);
    },
    declineProperty(ctx, { player }) {
      const state = ctx.state;
      if (state.stage !== "landingDecision" || currentPlayerId(state) !== player.id || state.pendingPropertyId == null) return;
      startAuction(state, state.pendingPropertyId);
    },
    auctionBid(ctx, { player, payload }) {
      const state = ctx.state;
      const auction = state.auction;
      if (state.stage !== "auction" || !auction || !state.players[player.id] || auction.passed.includes(player.id)) return;
      const amount = Number(payload?.amount);
      const minBid = auction.currentBid === 0 ? 100 : auction.currentBid + 100;
      if (!Number.isInteger(amount) || amount < minBid || amount > state.players[player.id].cash) return;
      auction.currentBid = amount;
      auction.highestBidderId = player.id;
      addLog(state, `\u{1F528} ${state.players[player.id].name} \u51FA\u4EF7 ${amount}`);
      maybeSettleAuction(state);
    },
    auctionPass(ctx, { player }) {
      const state = ctx.state;
      const auction = state.auction;
      if (state.stage !== "auction" || !auction || !state.players[player.id] || auction.highestBidderId === player.id) return;
      if (!auction.passed.includes(player.id)) auction.passed.push(player.id);
      addLog(state, `\u{1F528} ${state.players[player.id].name} \u653E\u5F03\u672C\u8F6E\u62CD\u5356`);
      maybeSettleAuction(state);
    },
    upgrade(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== "turn" || state.stage !== "manage" || currentPlayerId(state) !== player.id) return;
      const tileId = Number(payload?.tileId);
      const tile = TILES[tileId];
      const prop = state.properties[String(tileId)];
      if (!tile || tile.kind !== "property" || !prop || prop.ownerId !== player.id || prop.level >= 4) return;
      const cost = tile.upgradeCost ?? 0;
      if (state.players[player.id].cash < cost) return;
      state.players[player.id].cash -= cost;
      prop.level += 1;
      state.stockPrices[tile.district] += 15;
      addLog(state, `\u{1F3D7}\uFE0F ${state.players[player.id].name} \u5C06\u300C${tile.name}\u300D\u5347\u7EA7\u5230 Lv${prop.level}\uFF0C${DISTRICTS[tile.district].name} \u80A1\u4EF7 +15`);
      checkEarlyVictory(state);
    },
    stockBuy(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== "turn" || state.stage !== "manage" || currentPlayerId(state) !== player.id || !state.bankAccess) return;
      const district = payload?.district;
      const qty = Number(payload?.qty);
      if (!DISTRICT_IDS.includes(district) || !Number.isInteger(qty) || qty <= 0 || qty > 50) return;
      const cost = qty * state.stockPrices[district];
      if (state.players[player.id].cash < cost) return;
      state.players[player.id].cash -= cost;
      state.players[player.id].stocks[district] += qty;
      addLog(state, `\u{1F4C8} ${state.players[player.id].name} \u4E70\u5165 ${DISTRICTS[district].name} ${qty} \u80A1\uFF0C\u82B1\u8D39 ${cost}`);
    },
    stockSell(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== "turn" || state.stage !== "manage" || currentPlayerId(state) !== player.id || !state.bankAccess) return;
      const district = payload?.district;
      const qty = Number(payload?.qty);
      if (!DISTRICT_IDS.includes(district) || !Number.isInteger(qty) || qty <= 0 || state.players[player.id].stocks[district] < qty) return;
      const proceeds = qty * state.stockPrices[district];
      state.players[player.id].stocks[district] -= qty;
      state.players[player.id].cash += proceeds;
      const pressure = Math.floor(qty / 10) * 2;
      state.stockPrices[district] = Math.max(40, state.stockPrices[district] - pressure);
      addLog(state, `\u{1F4C9} ${state.players[player.id].name} \u5356\u51FA ${DISTRICTS[district].name} ${qty} \u80A1\uFF0C\u83B7\u5F97 ${proceeds}${pressure ? `\uFF0C\u80A1\u4EF7 -${pressure}` : ""}`);
      checkEarlyVictory(state);
    },
    useCard(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== "turn" || currentPlayerId(state) !== player.id) return;
      const p = state.players[player.id];
      const kind = payload?.kind;
      if (!p.cards.includes(kind)) return;
      if (kind === "boost") {
        if (state.stage !== "preRoll") return;
        consumeCard(p, kind);
        const die = 1 + Math.floor(Math.random() * 6) + 3;
        state.dice = die;
        state.pendingMove = { remaining: die, choices: [] };
        addLog(state, `\u26A1 ${p.name} \u4F7F\u7528\u75BE\u884C\uFF0C\u79FB\u52A8 ${die} \u6B65`);
        continueMove(state, player.id);
      } else if (kind === "exact") {
        if (state.stage !== "preRoll") return;
        const value = Number(payload?.value);
        if (!Number.isInteger(value) || value < 1 || value > 6) return;
        consumeCard(p, kind);
        state.dice = value;
        state.pendingMove = { remaining: value, choices: [] };
        addLog(state, `\u{1F39B}\uFE0F ${p.name} \u4F7F\u7528\u9065\u63A7\u9AB0\u5B50\uFF0C\u9009\u62E9 ${value}`);
        continueMove(state, player.id);
      } else if (kind === "rentShield") {
        if (state.stage !== "preRoll" && state.stage !== "manage") return;
        consumeCard(p, kind);
        p.rentShield += 1;
        addLog(state, `\u{1F6E1}\uFE0F ${p.name} \u51C6\u5907\u4E86\u4E00\u5F20\u514D\u79DF\u5238`);
      } else if (kind === "rentDouble") {
        if (state.stage !== "preRoll" && state.stage !== "manage") return;
        consumeCard(p, kind);
        p.doubleRentArmed = true;
        addLog(state, `\u{1F4B0} ${p.name} \u7684\u4E0B\u4E00\u7B14\u79DF\u91D1\u5C06\u7FFB\u500D`);
      } else if (kind === "rebate") {
        if (state.stage !== "preRoll" && state.stage !== "manage") return;
        consumeCard(p, kind);
        p.cash += 1200;
        addLog(state, `\u{1F4B5} ${p.name} \u4F7F\u7528\u73B0\u91D1\u8FD4\u8FD8\uFF0C\u83B7\u5F97 1,200`);
      } else if (kind === "teleport") {
        if (state.stage !== "preRoll") return;
        consumeCard(p, kind);
        const bankIds = [0, 10, 23];
        const target = bankIds.find((id) => id > p.position) ?? 0;
        if (target === 0 && p.position !== 0) {
          p.cash += 1500;
          addLog(state, `\u{1F3E6} ${p.name} \u4E58\u94F6\u884C\u5FEB\u7EBF\u7ECF\u8FC7\u8D77\u70B9\uFF0C\u83B7\u5F97 1,500`);
        }
        p.position = target;
        state.bankAccess = true;
        state.stage = "manage";
        addLog(state, `\u{1F687} ${p.name} \u4F7F\u7528\u94F6\u884C\u5FEB\u7EBF\u5230\u8FBE\u300C${TILES[target].name}\u300D`);
      } else if (kind === "insider") {
        if (state.stage !== "manage") return;
        const district = payload?.district;
        if (!DISTRICT_IDS.includes(district)) return;
        consumeCard(p, kind);
        p.stocks[district] += 5;
        addLog(state, `\u{1F4F0} ${p.name} \u901A\u8FC7\u5E02\u573A\u5185\u5E55\u83B7\u5F97 ${DISTRICTS[district].name} 5 \u80A1`);
      } else if (kind === "marketBoom") {
        if (state.stage !== "manage") return;
        const district = payload?.district;
        if (!DISTRICT_IDS.includes(district)) return;
        consumeCard(p, kind);
        state.stockPrices[district] = Math.round(state.stockPrices[district] * 1.1);
        addLog(state, `\u{1F680} ${p.name} \u5F15\u7206 ${DISTRICTS[district].name} \u5E02\u573A\u7E41\u8363\uFF0C\u80A1\u4EF7\u4E0A\u6DA8 10%`);
      } else if (kind === "upgrade") {
        if (state.stage !== "manage") return;
        const tileId = Number(payload?.tileId);
        const tile = TILES[tileId];
        const prop = state.properties[String(tileId)];
        if (!tile || tile.kind !== "property" || !prop || prop.ownerId !== player.id || prop.level >= 4) return;
        consumeCard(p, kind);
        prop.level += 1;
        state.stockPrices[tile.district] += 15;
        addLog(state, `\u{1F477} ${p.name} \u4F7F\u7528\u65BD\u5DE5\u961F\u514D\u8D39\u5347\u7EA7\u300C${tile.name}\u300D\u5230 Lv${prop.level}`);
      } else if (kind === "blackout") {
        if (state.stage !== "manage") return;
        const tileId = Number(payload?.tileId);
        const prop = state.properties[String(tileId)];
        if (!prop || !prop.ownerId || prop.ownerId === player.id) return;
        consumeCard(p, kind);
        prop.blackoutUntilRound = state.round + 1;
        addLog(state, `\u{1F311} ${p.name} \u8BA9\u300C${TILES[tileId].name}\u300D\u505C\u7535\u81F3\u7B2C ${state.round + 1} \u8F6E\u7ED3\u675F`);
      } else if (kind === "taxAudit") {
        if (state.stage !== "manage") return;
        const targetId = String(payload?.targetId ?? "");
        if (!state.players[targetId] || targetId === player.id) return;
        consumeCard(p, kind);
        charge(state, targetId, 800);
        addLog(state, `\u{1F9FE} ${p.name} \u5BF9 ${state.players[targetId].name} \u53D1\u8D77\u7A0E\u52A1\u5BA1\u8BA1\uFF0C\u6536\u8D70 800`);
      } else if (kind === "swap") {
        if (state.stage !== "manage") return;
        const targetId = String(payload?.targetId ?? "");
        const giveId = Number(payload?.giveTileId);
        const receiveId = Number(payload?.receiveTileId);
        const give = state.properties[String(giveId)];
        const receive = state.properties[String(receiveId)];
        if (!state.players[targetId] || targetId === player.id || !give || !receive || give.ownerId !== player.id || receive.ownerId !== targetId) return;
        if (give.level !== receive.level) return;
        consumeCard(p, kind);
        give.ownerId = targetId;
        receive.ownerId = player.id;
        p.properties = p.properties.filter((id) => id !== giveId).concat(receiveId);
        const target = state.players[targetId];
        target.properties = target.properties.filter((id) => id !== receiveId).concat(giveId);
        addLog(state, `\u{1F504} ${p.name} \u4F7F\u7528\u5F3A\u5236\u4EA4\u6362\uFF0C\u4E0E ${target.name} \u4EA4\u6362\u540C\u7B49\u7EA7\u5730\u4EA7`);
      }
      checkEarlyVictory(state);
    },
    proposeTrade(ctx, { player, payload }) {
      const state = ctx.state;
      if (state.phase !== "turn" || state.stage !== "manage" || currentPlayerId(state) !== player.id || state.trade) return;
      const targetId = String(payload?.targetId ?? "");
      if (!state.players[targetId] || targetId === player.id) return;
      const cashGive = Math.max(0, Math.floor(Number(payload?.cashGive) || 0));
      const cashReceive = Math.max(0, Math.floor(Number(payload?.cashReceive) || 0));
      const propertyGive = payload?.propertyGive == null ? null : Number(payload.propertyGive);
      const propertyReceive = payload?.propertyReceive == null ? null : Number(payload.propertyReceive);
      if (cashGive > state.players[player.id].cash || cashReceive > state.players[targetId].cash) return;
      if (propertyGive != null && state.properties[String(propertyGive)]?.ownerId !== player.id) return;
      if (propertyReceive != null && state.properties[String(propertyReceive)]?.ownerId !== targetId) return;
      if (cashGive === 0 && cashReceive === 0 && propertyGive == null && propertyReceive == null) return;
      state.trade = { proposerId: player.id, targetId, cashGive, cashReceive, propertyGive, propertyReceive };
      addLog(state, `\u{1F91D} ${state.players[player.id].name} \u5411 ${state.players[targetId].name} \u53D1\u8D77\u4EA4\u6613`);
    },
    respondTrade(ctx, { player, payload }) {
      const state = ctx.state;
      const trade = state.trade;
      if (!trade || trade.targetId !== player.id) return;
      const accept = Boolean(payload?.accept);
      if (!accept) {
        addLog(state, `\u274C ${state.players[player.id].name} \u62D2\u7EDD\u4EA4\u6613`);
        state.trade = null;
        return;
      }
      const proposer = state.players[trade.proposerId];
      const target = state.players[trade.targetId];
      if (!proposer || !target || proposer.cash < trade.cashGive || target.cash < trade.cashReceive) {
        state.trade = null;
        return;
      }
      if (trade.propertyGive != null && state.properties[String(trade.propertyGive)]?.ownerId !== proposer.id) {
        state.trade = null;
        return;
      }
      if (trade.propertyReceive != null && state.properties[String(trade.propertyReceive)]?.ownerId !== target.id) {
        state.trade = null;
        return;
      }
      proposer.cash += trade.cashReceive - trade.cashGive;
      target.cash += trade.cashGive - trade.cashReceive;
      if (trade.propertyGive != null) {
        state.properties[String(trade.propertyGive)].ownerId = target.id;
        proposer.properties = proposer.properties.filter((id) => id !== trade.propertyGive);
        target.properties.push(trade.propertyGive);
      }
      if (trade.propertyReceive != null) {
        state.properties[String(trade.propertyReceive)].ownerId = proposer.id;
        target.properties = target.properties.filter((id) => id !== trade.propertyReceive);
        proposer.properties.push(trade.propertyReceive);
      }
      addLog(state, `\u2705 ${proposer.name} \u4E0E ${target.name} \u5B8C\u6210\u4EA4\u6613`);
      state.trade = null;
      checkEarlyVictory(state);
    },
    endTurn(ctx, { player }) {
      const state = ctx.state;
      if (state.phase !== "turn" || state.stage !== "manage" || currentPlayerId(state) !== player.id || state.trade) return;
      if (checkEarlyVictory(state)) return;
      advanceTurn(state);
    },
    restart(ctx, { player }) {
      const old = ctx.state;
      if (old.phase !== "finished" || !old.players[player.id]) return;
      const names = old.order.map((id) => ({ id, name: old.players[id]?.name })).filter((x) => x.name);
      const fresh = makeInitialState();
      fresh.config = publicConfig();
      for (const { id, name } of names) {
        fresh.players[id] = {
          id,
          name,
          cash: 15e3,
          position: 0,
          properties: [],
          stocks: emptyStocks(),
          cards: [drawCard(), drawCard()],
          bankruptcies: 0,
          restTurns: 0,
          rescuePending: false,
          rentShield: 0,
          doubleRentArmed: false
        };
        fresh.order.push(id);
      }
      Object.keys(ctx.state).forEach((key) => delete ctx.state[key]);
      Object.assign(ctx.state, fresh);
      addLog(ctx.state, `\u{1F501} ${fresh.players[player.id].name} \u53D1\u8D77\u65B0\u4E00\u5C40`);
      ctx.broadcast?.("game:reset", {});
    }
  }
});
export default index_default;
//# sourceMappingURL=room.worker.js.map

// src/worker.ts
import { defineRoom } from "@parti/worker-sdk";

// src/game-logic.ts
var ROLES = ["werewolf", "villager", "seer", "witch", "hunter", "guard", "cupid"];
var DEFAULT_RULES = {
  loverRule: "all-third-party",
  selfSave: "first-night",
  allowDoublePotion: false,
  allowConsecutiveGuard: false,
  guardSaveSurvives: false,
  poisonedHunterShoots: false
};
var RECOMMENDED_DECKS = {
  6: ["werewolf", "werewolf", "villager", "villager", "seer", "witch"],
  7: ["werewolf", "werewolf", "villager", "villager", "seer", "witch", "hunter"],
  8: ["werewolf", "werewolf", "werewolf", "villager", "villager", "seer", "witch", "hunter"],
  9: ["werewolf", "werewolf", "werewolf", "villager", "villager", "villager", "seer", "witch", "hunter"],
  10: ["werewolf", "werewolf", "werewolf", "villager", "villager", "seer", "witch", "hunter", "guard", "cupid"],
  11: ["werewolf", "werewolf", "werewolf", "werewolf", "villager", "villager", "seer", "witch", "hunter", "guard", "cupid"],
  12: ["werewolf", "werewolf", "werewolf", "werewolf", "villager", "villager", "villager", "seer", "witch", "hunter", "guard", "cupid"]
};
var UNIQUE_ROLES = /* @__PURE__ */ new Set(["seer", "witch", "hunter", "guard", "cupid"]);
var GOD_ROLES = /* @__PURE__ */ new Set(["seer", "witch", "hunter", "guard", "cupid"]);
function validateDeck(roles, playerCount) {
  if (playerCount < 6 || playerCount > 12) return "\u4EC5\u652F\u6301 6\u201312 \u540D\u73A9\u5BB6";
  if (roles.length !== playerCount) return `\u5F53\u524D\u6709 ${roles.length} \u5F20\u8EAB\u4EFD\u724C\uFF0C\u9700\u8981 ${playerCount} \u5F20`;
  if (!roles.every((role) => ROLES.includes(role))) return "\u5305\u542B\u672A\u77E5\u8EAB\u4EFD\u724C";
  if (!roles.includes("werewolf")) return "\u81F3\u5C11\u9700\u8981\u4E00\u540D\u72FC\u4EBA";
  if (!roles.includes("villager")) return "\u81F3\u5C11\u9700\u8981\u4E00\u540D\u6751\u6C11";
  if (!roles.some((role) => GOD_ROLES.has(role))) return "\u81F3\u5C11\u9700\u8981\u4E00\u540D\u795E\u804C";
  for (const role of UNIQUE_ROLES) if (roles.filter((item) => item === role).length > 1) return `${role} \u53EA\u80FD\u914D\u7F6E\u4E00\u5F20`;
  return null;
}
function shuffle(items, random) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}
function dealRoles(playerIds, roles, random) {
  if (validateDeck(roles, playerIds.length)) throw new Error("Invalid deck");
  const shuffled = shuffle(roles, random);
  return Object.fromEntries(playerIds.map((id, index) => [id, { role: shuffled[index] }]));
}
function privateRolePayload(card, round) {
  return { round, role: card.role };
}
function tallyVotes(votes, weights = {}) {
  const totals = {};
  for (const [voterId, targetId] of Object.entries(votes)) totals[targetId] = (totals[targetId] ?? 0) + (weights[voterId] ?? 1);
  return totals;
}
function voteLeaders(totals) {
  const entries = Object.entries(totals);
  if (!entries.length) return [];
  const highest = Math.max(...entries.map(([, total]) => total));
  return entries.filter(([, total]) => total === highest).map(([id]) => id);
}
function isThirdPartyCouple(cards2, lovers2, rule) {
  if (lovers2.length !== 2 || rule === "bond-only") return false;
  if (rule === "all-third-party") return true;
  return cards2[lovers2[0]]?.role === "werewolf" !== (cards2[lovers2[1]]?.role === "werewolf");
}
function resolveWinner(cards2, deadIds, lovers2, rules) {
  const dead = new Set(deadIds);
  const alive = Object.keys(cards2).filter((id) => !dead.has(id));
  const thirdParty = isThirdPartyCouple(cards2, lovers2, rules.loverRule);
  if (thirdParty && lovers2.every((id) => alive.includes(id)) && alive.every((id) => lovers2.includes(id))) {
    return { winner: "lovers", reason: "\u60C5\u4FA3\u5171\u540C\u5B58\u6D3B\u5E76\u6D88\u706D\u4E86\u5176\u4ED6\u6240\u6709\u73A9\u5BB6" };
  }
  if (thirdParty && lovers2.some((id) => alive.includes(id))) return null;
  const aliveWolves = alive.filter((id) => cards2[id].role === "werewolf");
  if (!aliveWolves.length) return { winner: "village", reason: "\u6240\u6709\u72FC\u4EBA\u5747\u5DF2\u51FA\u5C40" };
  const aliveVillagers = alive.filter((id) => cards2[id].role === "villager");
  const aliveGods = alive.filter((id) => GOD_ROLES.has(cards2[id].role));
  if (!aliveVillagers.length || !aliveGods.length) return { winner: "werewolves", reason: !aliveVillagers.length ? "\u6240\u6709\u6751\u6C11\u5747\u5DF2\u51FA\u5C40" : "\u6240\u6709\u795E\u804C\u5747\u5DF2\u51FA\u5C40" };
  return null;
}
function resolveNightDeaths(input) {
  const deaths = [];
  if (input.killedId) {
    const guarded = input.guardedId === input.killedId;
    const protectedBySave = input.saved;
    const survives = guarded && protectedBySave ? input.guardSaveSurvives : guarded || protectedBySave;
    if (!survives) deaths.push({ playerId: input.killedId, cause: "night-kill" });
  }
  if (input.poisonedId && !deaths.some(({ playerId }) => playerId === input.poisonedId)) deaths.push({ playerId: input.poisonedId, cause: "poison" });
  return deaths;
}
function addDeathsWithHeartbreak(existing, additions, lovers2, day) {
  const next = [...existing];
  const dead = new Set(next.map(({ playerId }) => playerId));
  const queue = [...additions];
  while (queue.length) {
    const death = queue.shift();
    if (dead.has(death.playerId)) continue;
    dead.add(death.playerId);
    next.push({ ...death, day });
    if (lovers2.includes(death.playerId)) {
      const partner = lovers2.find((id) => id !== death.playerId);
      if (partner && !dead.has(partner)) queue.push({ playerId: partner, cause: "heartbreak" });
    }
  }
  return next;
}
function canWitchSelfSave(rule, night) {
  return rule === "always" || rule === "first-night" && night === 1;
}
function daySpeechOrder(dealtOrder, deadIds, startId) {
  const dead = new Set(deadIds);
  const living = dealtOrder.filter((id) => !dead.has(id));
  if (living.length === 0) return [];
  const startIndex = startId ? living.indexOf(startId) : -1;
  const offset = startIndex >= 0 ? startIndex : 0;
  return [...living.slice(offset), ...living.slice(0, offset)];
}

// src/worker.ts
var cards = {};
var lovers = [];
var submissions = {};
var guardedLastNight = null;
var guardedTonight = null;
var wolfTarget = null;
var witchSaved = false;
var witchPoisoned = null;
var antidoteAvailable = true;
var poisonAvailable = true;
var pendingDeaths = [];
var voteRoundCandidates = [];
var hunterShotUsed = false;
var wolfChat = [];
var msgSeq = 0;
var NIGHT_STAGES = /* @__PURE__ */ new Set(["cupid", "guard", "werewolf", "witch", "seer"]);
var CHAT_LIMIT = 100;
var TEXT_MAX = 200;
function isNightStage(stage) {
  return NIGHT_STAGES.has(stage);
}
function normalizeText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text ? text.slice(0, TEXT_MAX) : null;
}
function nameOf(ctx, playerId) {
  return ctx.state.players.find((player) => player.id === playerId)?.name ?? "\u73A9\u5BB6";
}
function pushPublicChat(ctx, playerId, text, kind = "chat") {
  ctx.state.chat.push({ id: `m${msgSeq += 1}`, playerId, name: kind === "system" ? "\u7CFB\u7EDF" : nameOf(ctx, playerId), text, at: Date.now(), kind });
  if (ctx.state.chat.length > CHAT_LIMIT) ctx.state.chat.splice(0, ctx.state.chat.length - CHAT_LIMIT);
}
function pushSystem(ctx, text) {
  pushPublicChat(ctx, "", text, "system");
}
function pushWolfChat(ctx, playerId, text) {
  wolfChat.push({ id: `w${msgSeq += 1}`, playerId, name: nameOf(ctx, playerId), text, at: Date.now(), kind: "chat" });
  if (wolfChat.length > CHAT_LIMIT) wolfChat.splice(0, wolfChat.length - CHAT_LIMIT);
  for (const id of Object.keys(cards)) if (cards[id].role === "werewolf") ctx.send(id, "werewolf:wolf-chat", { messages: wolfChat });
}
function beginDay(ctx) {
  const order = daySpeechOrder(ctx.state.dealtPlayerIds, ctx.state.deadPlayerIds, ctx.state.sheriffId);
  ctx.state.speakingOrder = order;
  ctx.state.speakingIndex = 0;
  ctx.state.currentSpeakerId = order[0] ?? null;
  ctx.state.spokenPlayerIds = [];
  if (!order.length) {
    startDayVote(ctx);
    return;
  }
  setStage(ctx, "day-speech");
  pushSystem(ctx, `\u5929\u4EAE\u4E86\uFF0C\u767D\u5929\u53D1\u8A00\u5F00\u59CB\uFF0C\u7531 ${nameOf(ctx, order[0])} \u8D77\u59CB\u3002`);
}
function advanceDaySpeaker(ctx) {
  const dead = new Set(ctx.state.deadPlayerIds);
  let index = ctx.state.speakingIndex + 1;
  while (index < ctx.state.speakingOrder.length && dead.has(ctx.state.speakingOrder[index])) index += 1;
  ctx.state.speakingIndex = index;
  if (index < ctx.state.speakingOrder.length) ctx.state.currentSpeakerId = ctx.state.speakingOrder[index];
  else startDayVote(ctx);
}
function startDayVote(ctx) {
  ctx.state.currentSpeakerId = null;
  setStage(ctx, "day-vote");
  ctx.state.voteCandidates = aliveIds(ctx);
  voteRoundCandidates = [...ctx.state.voteCandidates];
  pushSystem(ctx, "\u53D1\u8A00\u7ED3\u675F\uFF0C\u8FDB\u5165\u653E\u9010\u6295\u7968\u3002");
}
function syncPlayers(ctx) {
  ctx.state.hostId = ctx.host?.id ?? null;
  ctx.state.players = ctx.players.filter((p) => p.role !== "spectator").map(({ id, name, role }) => ({ id, name, role: role === "host" ? "host" : "player" }));
}
function aliveIds(ctx) {
  const dead = new Set(ctx.state.deadPlayerIds);
  return ctx.state.dealtPlayerIds.filter((id) => !dead.has(id));
}
function requiredIds(ctx) {
  if (ctx.state.stage === "role-check" || ctx.state.stage === "hunter") return [...ctx.state.dealtPlayerIds];
  if (ctx.state.stage === "sheriff-vote") return aliveIds(ctx).filter((id) => !ctx.state.sheriffCandidates.includes(id));
  return aliveIds(ctx);
}
function resetSubmissions(ctx) {
  submissions = {};
  ctx.state.submittedCount = 0;
  ctx.state.requiredCount = requiredIds(ctx).length;
}
function setStage(ctx, stage) {
  ctx.state.stage = stage;
  resetSubmissions(ctx);
}
function roleId(role) {
  return Object.keys(cards).find((id) => cards[id].role === role) ?? null;
}
function sendSecrets(ctx, id) {
  const card = cards[id];
  if (!card) return;
  ctx.send(id, "werewolf:role", privateRolePayload(card, ctx.state.round));
  if (card.role === "werewolf") {
    ctx.send(id, "werewolf:pack", { round: ctx.state.round, playerIds: Object.keys(cards).filter((pid) => cards[pid].role === "werewolf") });
    ctx.send(id, "werewolf:wolf-chat", { messages: wolfChat });
  }
  if (lovers.includes(id)) ctx.send(id, "werewolf:lover", { round: ctx.state.round, playerId: lovers.find((pid) => pid !== id) });
}
function finishIfWon(ctx) {
  const result = resolveWinner(cards, ctx.state.deadPlayerIds, lovers, ctx.state.rules);
  if (!result) return false;
  ctx.state.result = result;
  ctx.state.revealedRoles = Object.fromEntries(Object.entries(cards).map(([id, card]) => [id, card.role]));
  setStage(ctx, "finished");
  return true;
}
function applyDeaths(ctx, deaths) {
  const before = new Set(ctx.state.deaths.map(({ playerId }) => playerId));
  ctx.state.deaths = addDeathsWithHeartbreak(ctx.state.deaths, deaths, lovers, ctx.state.day);
  ctx.state.deadPlayerIds = ctx.state.deaths.map(({ playerId }) => playerId);
  ctx.state.lastDeaths = ctx.state.deadPlayerIds.filter((id) => !before.has(id));
}
function beginNight(ctx) {
  ctx.state.day += 1;
  ctx.state.lastVotes = [];
  ctx.state.lastDeaths = [];
  ctx.state.voteCandidates = [];
  voteRoundCandidates = [];
  guardedTonight = null;
  wolfTarget = null;
  witchSaved = false;
  witchPoisoned = null;
  pendingDeaths = [];
  setStage(ctx, ctx.state.day === 1 && roleId("cupid") ? "cupid" : roleId("guard") ? "guard" : "werewolf");
}
function afterDawn(ctx) {
  applyDeaths(ctx, pendingDeaths);
  if (finishIfWon(ctx)) return;
  const hunter = roleId("hunter");
  const hunterDeath = hunter ? ctx.state.deaths.find(({ playerId }) => playerId === hunter) : null;
  const canShoot = hunterDeath && (hunterDeath.cause !== "poison" || ctx.state.rules.poisonedHunterShoots);
  if (canShoot && !hunterShotUsed) {
    setStage(ctx, "hunter");
    return;
  }
  if (ctx.state.sheriffId && ctx.state.deadPlayerIds.includes(ctx.state.sheriffId)) {
    setStage(ctx, "badge-transfer");
    return;
  }
  beginDay(ctx);
}
function advance(ctx) {
  const stage = ctx.state.stage;
  const values = Object.entries(submissions);
  if (stage === "role-check") {
    beginNight(ctx);
    return;
  }
  if (stage === "cupid") {
    const cupid = roleId("cupid");
    const choice = cupid ? submissions[cupid] : null;
    if (Array.isArray(choice?.targets) && choice.targets.length === 2 && choice.targets[0] !== choice.targets[1] && choice.targets.every((id) => aliveIds(ctx).includes(id))) lovers = [...choice.targets];
    for (const id of lovers) sendSecrets(ctx, id);
    setStage(ctx, roleId("guard") ? "guard" : "werewolf");
    return;
  }
  if (stage === "guard") {
    const guard = roleId("guard");
    const target = guard ? submissions[guard]?.targetId : null;
    if (typeof target === "string" && aliveIds(ctx).includes(target) && (ctx.state.rules.allowConsecutiveGuard || target !== guardedLastNight)) guardedTonight = target;
    setStage(ctx, "werewolf");
    return;
  }
  if (stage === "werewolf") {
    const wolfVotes = Object.fromEntries(values.filter(([id, value]) => cards[id]?.role === "werewolf").map(([id, value]) => [id, value.targetId]).filter(([, target]) => typeof target === "string" && aliveIds(ctx).includes(target) && cards[target].role !== "werewolf"));
    const leaders = voteLeaders(tallyVotes(wolfVotes));
    if (leaders.length > 1) {
      ctx.state.voteCandidates = leaders;
      voteRoundCandidates = leaders;
      resetSubmissions(ctx);
      return;
    }
    wolfTarget = leaders[0] ?? null;
    const witch = roleId("witch");
    if (witch && !ctx.state.deadPlayerIds.includes(witch)) ctx.send(witch, "werewolf:witch-night", { round: ctx.state.round, night: ctx.state.day, killedPlayerId: wolfTarget, antidoteAvailable, poisonAvailable });
    setStage(ctx, roleId("witch") ? "witch" : roleId("seer") ? "seer" : ctx.state.day === 1 ? "sheriff-signup" : "dawn");
    if (ctx.state.stage === "dawn") {
      pendingDeaths = resolveNightDeaths({ killedId: wolfTarget, guardedId: guardedTonight, saved: false, poisonedId: null, guardSaveSurvives: ctx.state.rules.guardSaveSurvives });
      guardedLastNight = guardedTonight;
      afterDawn(ctx);
    }
    return;
  }
  if (stage === "witch") {
    const witch = roleId("witch");
    const choice = witch ? submissions[witch] : null;
    const maySelfSave = wolfTarget !== witch || canWitchSelfSave(ctx.state.rules.selfSave, ctx.state.day);
    witchSaved = Boolean(choice?.save && antidoteAvailable && wolfTarget && maySelfSave);
    const poisonTarget = typeof choice?.poisonTargetId === "string" && aliveIds(ctx).includes(choice.poisonTargetId) ? choice.poisonTargetId : null;
    witchPoisoned = poisonAvailable && (!witchSaved || ctx.state.rules.allowDoublePotion) ? poisonTarget : null;
    if (witchSaved) antidoteAvailable = false;
    if (witchPoisoned) poisonAvailable = false;
    setStage(ctx, roleId("seer") ? "seer" : ctx.state.day === 1 ? "sheriff-signup" : "dawn");
    if (ctx.state.stage === "dawn") {
      pendingDeaths = resolveNightDeaths({ killedId: wolfTarget, guardedId: guardedTonight, saved: witchSaved, poisonedId: witchPoisoned, guardSaveSurvives: ctx.state.rules.guardSaveSurvives });
      guardedLastNight = guardedTonight;
      afterDawn(ctx);
    }
    return;
  }
  if (stage === "seer") {
    const seer = roleId("seer");
    const target = seer ? submissions[seer]?.targetId : null;
    if (seer && typeof target === "string" && cards[target]) ctx.send(seer, "werewolf:seer-result", { round: ctx.state.round, night: ctx.state.day, playerId: target, alignment: cards[target].role === "werewolf" ? "werewolf" : "good" });
    pendingDeaths = resolveNightDeaths({ killedId: wolfTarget, guardedId: guardedTonight, saved: witchSaved, poisonedId: witchPoisoned, guardSaveSurvives: ctx.state.rules.guardSaveSurvives });
    guardedLastNight = guardedTonight;
    if (ctx.state.day === 1) setStage(ctx, "sheriff-signup");
    else afterDawn(ctx);
    return;
  }
  if (stage === "sheriff-signup") {
    ctx.state.sheriffCandidates = values.filter(([, v]) => Boolean(v.join)).map(([id]) => id);
    if (!ctx.state.sheriffCandidates.length) {
      setStage(ctx, "dawn");
      afterDawn(ctx);
      return;
    }
    setStage(ctx, "sheriff-withdraw");
    return;
  }
  if (stage === "sheriff-withdraw") {
    ctx.state.sheriffCandidates = ctx.state.sheriffCandidates.filter((id) => !Boolean(submissions[id]?.withdraw));
    if (ctx.state.sheriffCandidates.length === 1) {
      ctx.state.sheriffId = ctx.state.sheriffCandidates[0];
      setStage(ctx, "dawn");
      afterDawn(ctx);
      return;
    }
    if (!ctx.state.sheriffCandidates.length) {
      setStage(ctx, "dawn");
      afterDawn(ctx);
      return;
    }
    setStage(ctx, "sheriff-vote");
    ctx.state.voteCandidates = [...ctx.state.sheriffCandidates];
    voteRoundCandidates = [...ctx.state.sheriffCandidates];
    if (!ctx.state.requiredCount) {
      ctx.state.sheriffId = null;
      setStage(ctx, "dawn");
      afterDawn(ctx);
    }
    return;
  }
  if (stage === "sheriff-vote" || stage === "day-vote") {
    const candidates = voteRoundCandidates.length ? voteRoundCandidates : ctx.state.voteCandidates;
    const votes = Object.fromEntries(values.map(([id, value]) => [id, value.targetId]).filter(([, target]) => typeof target === "string" && candidates.includes(target)));
    const weights = stage === "day-vote" && ctx.state.sheriffId ? { [ctx.state.sheriffId]: 1.5 } : {};
    const leaders = voteLeaders(tallyVotes(votes, weights));
    ctx.state.lastVotes = Object.entries(votes).map(([voterId, targetId]) => ({ voterId, targetId, weight: weights[voterId] ?? 1 }));
    if (leaders.length > 1) {
      voteRoundCandidates = leaders;
      ctx.state.voteCandidates = leaders;
      resetSubmissions(ctx);
      return;
    }
    if (stage === "sheriff-vote") {
      ctx.state.sheriffId = leaders[0] ?? null;
      setStage(ctx, "dawn");
      afterDawn(ctx);
      return;
    }
    if (leaders[0]) applyDeaths(ctx, [{ playerId: leaders[0], cause: "exile" }]);
    if (finishIfWon(ctx)) return;
    const hunter = roleId("hunter");
    const death = hunter ? ctx.state.deaths.find(({ playerId }) => playerId === hunter) : null;
    if (death && !hunterShotUsed && (death.cause !== "poison" || ctx.state.rules.poisonedHunterShoots)) {
      setStage(ctx, "hunter");
      return;
    }
    if (ctx.state.sheriffId && ctx.state.deadPlayerIds.includes(ctx.state.sheriffId)) {
      setStage(ctx, "badge-transfer");
      return;
    }
    beginNight(ctx);
    return;
  }
  if (stage === "hunter") {
    const hunter = roleId("hunter");
    const choice = hunter ? submissions[hunter] : null;
    if (hunter) hunterShotUsed = true;
    if (typeof choice?.targetId === "string" && aliveIds(ctx).includes(choice.targetId)) applyDeaths(ctx, [{ playerId: choice.targetId, cause: "hunter-shot" }]);
    if (finishIfWon(ctx)) return;
    if (ctx.state.sheriffId && ctx.state.deadPlayerIds.includes(ctx.state.sheriffId)) setStage(ctx, "badge-transfer");
    else if (ctx.state.lastVotes.length) beginNight(ctx);
    else beginDay(ctx);
    return;
  }
  if (stage === "badge-transfer") return;
}
var worker_default = defineRoom({
  meta: { name: "\u72FC\u4EBA\u6740 \xB7 \u6708\u591C\u5BA1\u5224", minPlayers: 6, maxPlayers: 12 },
  initialState() {
    return { stage: "waiting", hostId: null, players: [], round: 0, day: 0, configuredRoles: [...RECOMMENDED_DECKS[6]], rules: { ...DEFAULT_RULES }, dealtPlayerIds: [], deadPlayerIds: [], deaths: [], sheriffId: null, sheriffCandidates: [], voteCandidates: [], submittedCount: 0, requiredCount: 0, lastVotes: [], lastDeaths: [], speakingOrder: [], speakingIndex: 0, currentSpeakerId: null, spokenPlayerIds: [], chat: [], result: null, revealedRoles: null, notice: null };
  },
  onJoin(ctx) {
    syncPlayers(ctx);
    if (ctx.state.stage === "waiting") ctx.state.configuredRoles = [...RECOMMENDED_DECKS[ctx.state.players.length] ?? ctx.state.configuredRoles];
  },
  onLeave(ctx, player) {
    ctx.state.players = ctx.state.players.filter(({ id }) => id !== player.id);
    ctx.state.notice = ctx.state.stage === "waiting" ? null : "\u6709\u73A9\u5BB6\u79BB\u7EBF\uFF0C\u724C\u5C40\u5C06\u7B49\u5F85\u5176\u91CD\u8FDE";
  },
  onReconnect(ctx, player) {
    syncPlayers(ctx);
    sendSecrets(ctx, player.id);
    ctx.state.notice = null;
  },
  onRestore(ctx) {
    cards = {};
    lovers = [];
    submissions = {};
    wolfChat = [];
    ctx.state.stage = "waiting";
    ctx.state.dealtPlayerIds = [];
    ctx.state.deadPlayerIds = [];
    ctx.state.deaths = [];
    ctx.state.speakingOrder = [];
    ctx.state.speakingIndex = 0;
    ctx.state.currentSpeakerId = null;
    ctx.state.spokenPlayerIds = [];
    ctx.state.chat = [];
    ctx.state.result = null;
    ctx.state.revealedRoles = null;
    ctx.state.notice = "\u623F\u95F4\u5DF2\u6062\u590D\uFF0C\u79D8\u5BC6\u72B6\u6001\u65E0\u6CD5\u6062\u590D\uFF0C\u8BF7\u91CD\u65B0\u53D1\u724C";
    syncPlayers(ctx);
  },
  actions: {
    "settings:setDeck"(ctx, event) {
      if (event.player.id !== ctx.host.id || ctx.state.stage !== "waiting") return;
      const roles = event.payload?.roles;
      if (!Array.isArray(roles)) return;
      const error = validateDeck(roles, ctx.state.players.length);
      if (error) {
        ctx.state.notice = error;
        return;
      }
      ctx.state.configuredRoles = [...roles];
      ctx.state.notice = null;
    },
    "settings:setRules"(ctx, event) {
      if (event.player.id !== ctx.host.id || ctx.state.stage !== "waiting") return;
      ctx.state.rules = { ...ctx.state.rules, ...event.payload };
    },
    "game:start"(ctx, event) {
      if (event.player.id !== ctx.host.id) return;
      syncPlayers(ctx);
      const ids = ctx.state.players.map(({ id }) => id);
      const error = validateDeck(ctx.state.configuredRoles, ids.length);
      if (error) {
        ctx.state.notice = error;
        return;
      }
      cards = dealRoles(ids, ctx.state.configuredRoles, () => ctx.random());
      lovers = [];
      guardedLastNight = null;
      antidoteAvailable = true;
      poisonAvailable = true;
      pendingDeaths = [];
      hunterShotUsed = false;
      wolfChat = [];
      ctx.state.round += 1;
      ctx.state.day = 0;
      ctx.state.dealtPlayerIds = ids;
      ctx.state.deadPlayerIds = [];
      ctx.state.deaths = [];
      ctx.state.sheriffId = null;
      ctx.state.sheriffCandidates = [];
      ctx.state.lastVotes = [];
      ctx.state.lastDeaths = [];
      ctx.state.speakingOrder = [];
      ctx.state.speakingIndex = 0;
      ctx.state.currentSpeakerId = null;
      ctx.state.spokenPlayerIds = [];
      ctx.state.chat = [];
      ctx.state.result = null;
      ctx.state.revealedRoles = null;
      ctx.state.notice = null;
      setStage(ctx, "role-check");
      for (const id of ids) sendSecrets(ctx, id);
      ctx.log("werewolf game started", ctx.state.round, ids.length);
    },
    "game:restart"(ctx, event) {
      if (event.player.id !== ctx.host.id) return;
      cards = {};
      lovers = [];
      submissions = {};
      wolfChat = [];
      ctx.state.stage = "waiting";
      ctx.state.dealtPlayerIds = [];
      ctx.state.deadPlayerIds = [];
      ctx.state.deaths = [];
      ctx.state.speakingOrder = [];
      ctx.state.speakingIndex = 0;
      ctx.state.currentSpeakerId = null;
      ctx.state.spokenPlayerIds = [];
      ctx.state.chat = [];
      ctx.state.result = null;
      ctx.state.revealedRoles = null;
      ctx.state.sheriffId = null;
      ctx.state.notice = "\u672C\u5C40\u5DF2\u7ED3\u675F\uFF0C\u53EF\u91CD\u65B0\u914D\u7F6E\u5E76\u53D1\u724C";
    },
    "stage:submit"(ctx, event) {
      if (ctx.state.stage === "waiting" || ctx.state.stage === "finished" || ctx.state.stage === "badge-transfer" || ctx.state.stage === "day-speech") return;
      const required = requiredIds(ctx);
      if (!required.includes(event.player.id) || event.player.id in submissions) return;
      submissions[event.player.id] = event.payload ?? {};
      ctx.state.submittedCount = Object.keys(submissions).filter((id) => required.includes(id)).length;
      ctx.state.requiredCount = required.length;
      if (ctx.state.stage === "werewolf" && cards[event.player.id]?.role === "werewolf") {
        const packIds = Object.keys(cards).filter((id) => cards[id].role === "werewolf");
        const votes = packIds.flatMap((id) => {
          const targetId = submissions[id]?.targetId;
          return typeof targetId === "string" ? [{ voterId: id, targetId }] : [];
        });
        for (const id of packIds) ctx.send(id, "werewolf:pack-votes", { round: ctx.state.round, night: ctx.state.day, votes });
      }
      if (ctx.state.submittedCount === ctx.state.requiredCount) advance(ctx);
    },
    "sheriff:badge"(ctx, event) {
      if (ctx.state.stage !== "badge-transfer" || event.player.id !== ctx.state.sheriffId) return;
      const targetId = event.payload?.targetId;
      ctx.state.sheriffId = typeof targetId === "string" && aliveIds(ctx).includes(targetId) ? targetId : null;
      if (ctx.state.lastVotes.length) beginNight(ctx);
      else beginDay(ctx);
    },
    speak(ctx, event) {
      if (ctx.state.stage !== "day-speech" || ctx.state.currentSpeakerId !== event.player.id) return;
      const text = normalizeText(event.payload?.text);
      if (!text) return;
      pushPublicChat(ctx, event.player.id, text, "speech");
      ctx.state.spokenPlayerIds.push(event.player.id);
      advanceDaySpeaker(ctx);
    },
    chat(ctx, event) {
      if (!aliveIds(ctx).includes(event.player.id)) return;
      const text = normalizeText(event.payload?.text);
      if (!text) return;
      const channel = event.payload?.channel === "wolf" ? "wolf" : "public";
      if (channel === "wolf") {
        if (cards[event.player.id]?.role !== "werewolf" || !isNightStage(ctx.state.stage)) return;
        pushWolfChat(ctx, event.player.id, text);
        return;
      }
      if (isNightStage(ctx.state.stage) || ctx.state.stage === "waiting" || ctx.state.stage === "finished") return;
      pushPublicChat(ctx, event.player.id, text, "chat");
    }
  }
});
export default worker_default;

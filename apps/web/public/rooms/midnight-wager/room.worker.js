// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";

// src/game/rules.ts
function action(session2, kind, payload = {}) {
  const sequence = ++session2.state.actionSequence;
  return { event: "game:action", payload: { actionId: `wager:${session2.state.round}:${sequence}`, occurredAt: sequence, kind, ...payload } };
}
var MAX_PLAYERS = 4;
function randomIndex(length, random) {
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}
function shuffle(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, random);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}
function classicDeck() {
  const ranks = ["A", "K", "Q"];
  return [
    ...ranks.flatMap(
      (kind) => Array.from({ length: 6 }, (_, index) => ({
        id: `${kind}-${index + 1}`,
        kind,
        devilMarked: index === 0
      }))
    ),
    { id: "joker-1", kind: "joker" },
    { id: "joker-2", kind: "joker" }
  ];
}
function chaosDeck() {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `K-${index + 1}`, kind: "K" })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `Q-${index + 1}`, kind: "Q" })),
    { id: "master-1", kind: "master" },
    { id: "chaos-1", kind: "chaos" }
  ];
}
function handSize(ruleset) {
  return ruleset === "chaos" ? 3 : 5;
}
function createPlayer(player, seat) {
  return {
    ...player,
    seat,
    ready: false,
    connected: true,
    alive: true,
    handCount: 0,
    safePulls: 0,
    wins: player.wins ?? 0
  };
}
function dealRound(session2, random, starterId) {
  const alive = livingPlayers(session2);
  const deck = shuffle(session2.state.ruleset === "chaos" ? chaosDeck() : classicDeck(), random);
  const size = handSize(session2.state.ruleset);
  for (const player of Object.values(session2.state.players)) {
    const hand = player.alive ? deck.splice(0, size) : [];
    session2.secret.hands[player.id] = hand;
    player.handCount = hand.length;
  }
  session2.secret.deck = deck;
  const tableRanks = session2.state.ruleset === "chaos" ? ["K", "Q"] : ["A", "K", "Q"];
  const requestedStarter = starterId ? session2.state.players[starterId] : null;
  let resolvedStarter = requestedStarter?.alive ? requestedStarter : null;
  if (!resolvedStarter && requestedStarter) {
    for (let offset = 1; offset <= MAX_PLAYERS; offset += 1) {
      const id = session2.state.seats[(requestedStarter.seat + offset) % MAX_PLAYERS];
      if (id && session2.state.players[id]?.alive) {
        resolvedStarter = session2.state.players[id];
        break;
      }
    }
  }
  session2.secret.pile = [];
  session2.secret.shotTargets = {};
  session2.state.phase = "playing";
  session2.state.round += 1;
  session2.state.tableRank = tableRanks[randomIndex(tableRanks.length, random)];
  session2.state.currentPlayerId = resolvedStarter?.id ?? alive[randomIndex(alive.length, random)]?.id ?? null;
  session2.state.lastPlay = null;
  session2.state.pileCount = 0;
  session2.state.reveal = null;
  session2.state.roulette = null;
  session2.state.resolution = null;
  session2.state.message = `\u7B2C ${session2.state.round} \u8F6E\uFF1A${session2.state.tableRank} \u684C`;
}
function createMatch(config, random) {
  const inputs = config.players.slice(0, MAX_PLAYERS);
  const players = Object.fromEntries(inputs.map((player, seat) => [player.id, createPlayer(player, seat)]));
  const seats = Array(MAX_PLAYERS).fill(null);
  inputs.forEach((player, seat) => {
    seats[seat] = player.id;
  });
  const session2 = {
    state: {
      version: 1,
      actionSequence: 0,
      phase: "lobby",
      ruleset: config.ruleset,
      hostId: config.hostId,
      players,
      seats,
      round: 0,
      tableRank: null,
      currentPlayerId: null,
      lastPlay: null,
      pileCount: 0,
      reveal: null,
      roulette: null,
      resolution: null,
      winnerId: null,
      draw: false,
      message: "\u7B49\u5F85\u73A9\u5BB6\u51C6\u5907"
    },
    secret: {
      hands: {},
      deck: [],
      pile: [],
      fatalPulls: {},
      shotTargets: {}
    }
  };
  if (config.start !== false && inputs.length >= 2) {
    for (const player of inputs) {
      session2.secret.fatalPulls[player.id] = randomIndex(6, random) + 1;
    }
    dealRound(session2, random);
  }
  return session2;
}
function cloneSession(session2) {
  return JSON.parse(JSON.stringify(session2));
}
function transition(session2) {
  return { session: session2, sends: [], broadcasts: [], schedules: [] };
}
function invalid(session2, actorId, message) {
  return {
    ...transition(session2),
    error: message,
    sends: [{ playerId: actorId, event: "game:invalid", payload: { message } }]
  };
}
function livingPlayers(session2) {
  return session2.state.seats.map((id) => id ? session2.state.players[id] : null).filter((player) => Boolean(player?.alive));
}
function nextPlayerWithCards(session2, actorId) {
  const actor = session2.state.players[actorId];
  if (!actor) return null;
  for (let offset = 1; offset <= MAX_PLAYERS; offset += 1) {
    const seat = (actor.seat + offset) % MAX_PLAYERS;
    const id = session2.state.seats[seat];
    if (id && session2.state.players[id]?.alive && session2.state.players[id].handCount > 0) return id;
  }
  return null;
}
function playCards(session2, command) {
  if (session2.state.phase !== "playing") return invalid(session2, command.actorId, "\u73B0\u5728\u4E0D\u80FD\u51FA\u724C");
  if (session2.state.currentPlayerId !== command.actorId) return invalid(session2, command.actorId, "\u8FD8\u6CA1\u8F6E\u5230\u4F60");
  const holders = livingPlayers(session2).filter((player) => player.handCount > 0);
  if (session2.secret.pile.length > 0 && holders.length === 1 && holders[0].id === command.actorId) {
    return invalid(session2, command.actorId, "\u53EA\u5269\u4F60\u6301\u724C\uFF0C\u5FC5\u987B\u8D28\u7591\u4E0A\u4E00\u624B");
  }
  const uniqueIds = [...new Set(command.cardIds)];
  const limit = session2.state.ruleset === "chaos" ? 1 : 3;
  const minimum = session2.state.ruleset === "chaos" ? 1 : 1;
  if (uniqueIds.length < minimum || uniqueIds.length > limit || uniqueIds.length !== command.cardIds.length) {
    return invalid(session2, command.actorId, session2.state.ruleset === "chaos" ? "\u6DF7\u6C8C\u5C40\u6BCF\u6B21\u53EA\u80FD\u51FA\u4E00\u5F20\u724C" : "\u8BF7\u9009\u62E9\u4E00\u81F3\u4E09\u5F20\u724C");
  }
  const hand = session2.secret.hands[command.actorId] ?? [];
  if (uniqueIds.some((id) => !hand.some((card) => card.id === id))) {
    return invalid(session2, command.actorId, "\u4F60\u6CA1\u6709\u8FD9\u4E9B\u724C");
  }
  const selectedFromCurrent = hand.filter((card) => uniqueIds.includes(card.id));
  if (selectedFromCurrent.some((card) => isActiveDevil(session2, card)) && selectedFromCurrent.length !== 1) {
    return invalid(session2, command.actorId, "\u6076\u9B54\u724C\u5FC5\u987B\u5355\u72EC\u6253\u51FA");
  }
  const next = cloneSession(session2);
  const selected = next.secret.hands[command.actorId].filter((card) => uniqueIds.includes(card.id));
  next.secret.hands[command.actorId] = next.secret.hands[command.actorId].filter((card) => !uniqueIds.includes(card.id));
  next.secret.pile.push({ playerId: command.actorId, cards: selected });
  next.state.players[command.actorId].handCount = next.secret.hands[command.actorId].length;
  next.state.lastPlay = { playerId: command.actorId, count: selected.length };
  next.state.pileCount += selected.length;
  next.state.currentPlayerId = nextPlayerWithCards(next, command.actorId);
  next.state.message = `${next.state.players[command.actorId].name} \u6263\u4E0B\u4E86 ${selected.length} \u5F20\u724C`;
  if (next.state.ruleset === "chaos" && selected[0]?.kind === "chaos") {
    const shooters = livingPlayers(next).map((player) => player.id);
    next.state.reveal = {
      reason: "chaos",
      accusedId: command.actorId,
      callerId: null,
      cards: selected
    };
    next.state.message = "\u6DF7\u6C8C\u724C\u7FFB\u5F00\u2014\u2014\u6240\u6709\u4EBA\u9009\u62E9\u4E00\u4E2A\u76EE\u6807";
    beginRoulette(next, {
      kind: "simultaneous",
      shooters,
      fixedTargets: {},
      resume: "continue",
      starterId: nextPlayerWithCards(next, command.actorId) ?? command.actorId
    });
    return {
      ...transition(next),
      sends: [
        {
          playerId: command.actorId,
          event: "private:hand",
          payload: { hand: next.secret.hands[command.actorId] }
        }
      ],
      broadcasts: [{ event: "game:reveal", payload: next.state.reveal }, action(next, "cardsCommitted", { actorId: command.actorId, count: selected.length, label: "\u6DF7\u6C8C\u724C" }), action(next, "reveal", { actorId: command.actorId, cards: selected, label: "\u6DF7\u6C8C\u724C\u63ED\u793A" }), action(next, "specialResolved", { actorId: command.actorId, cards: selected, label: "\u6DF7\u6C8C" })]
    };
  }
  return {
    ...transition(next),
    sends: [
      {
        playerId: command.actorId,
        event: "private:hand",
        payload: { hand: next.secret.hands[command.actorId] }
      }
    ],
    broadcasts: [
      {
        event: "game:notice",
        payload: { message: next.state.message }
      },
      action(next, "cardsCommitted", { actorId: command.actorId, count: selected.length, label: `\u6697\u51FA ${selected.length} \u5F20` })
    ]
  };
}
function isActiveDevil(session2, card) {
  return session2.state.ruleset === "devil" && livingPlayers(session2).length >= 3 && card.devilMarked === true && card.kind === session2.state.tableRank;
}
function isInnocent(session2, card) {
  if (card.kind === "joker" || card.kind === "master" || card.kind === "chaos") return true;
  return card.kind === session2.state.tableRank && !isActiveDevil(session2, card);
}
function beginRoulette(session2, options) {
  session2.state.phase = "roulette";
  session2.state.roulette = {
    kind: options.kind,
    shooterIds: options.shooters,
    fixedTargets: options.fixedTargets,
    committed: [],
    resume: options.resume,
    starterId: options.starterId
  };
}
function callLiar(session2, command) {
  if (session2.state.phase !== "playing") return invalid(session2, command.actorId, "\u73B0\u5728\u4E0D\u80FD\u8D28\u7591");
  if (session2.state.currentPlayerId !== command.actorId) return invalid(session2, command.actorId, "\u8FD8\u6CA1\u8F6E\u5230\u4F60");
  const lastPlay = session2.secret.pile.at(-1);
  if (!lastPlay) return invalid(session2, command.actorId, "\u8FD8\u6CA1\u6709\u53EF\u4EE5\u8D28\u7591\u7684\u724C");
  const next = cloneSession(session2);
  const revealed = next.secret.pile.at(-1);
  const activeDevil = revealed.cards.some((card) => isActiveDevil(next, card));
  if (activeDevil) {
    const shooters = livingPlayers(next).filter((player) => player.id !== revealed.playerId && player.handCount > 0).map((player) => player.id);
    next.state.reveal = {
      reason: "devil",
      accusedId: revealed.playerId,
      callerId: command.actorId,
      cards: revealed.cards
    };
    next.state.message = "\u6076\u9B54\u7FFB\u5F00\u4E86\u6240\u6709\u4EBA\u7684\u67AA\u5957";
    beginRoulette(next, {
      kind: "simultaneous",
      shooters,
      fixedTargets: Object.fromEntries(shooters.map((id) => [id, id])),
      resume: "redeal",
      starterId: command.actorId
    });
    return {
      ...transition(next),
      broadcasts: [{ event: "game:reveal", payload: next.state.reveal }, action(next, "reveal", { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: "\u6076\u9B54\u724C\u63ED\u793A" }), action(next, "specialResolved", { actorId: revealed.playerId, cards: revealed.cards, label: "\u6076\u9B54" })]
    };
  }
  if (next.state.ruleset === "chaos") {
    const card = revealed.cards[0];
    const starterId = nextPlayerWithCards(next, revealed.playerId) ?? command.actorId;
    if (card.kind === "master") {
      next.state.reveal = {
        reason: "master",
        accusedId: revealed.playerId,
        callerId: command.actorId,
        cards: revealed.cards
      };
      next.state.message = `${next.state.players[revealed.playerId].name} \u7FFB\u5F00\u4E86\u4E3B\u5BB0\u724C`;
      beginRoulette(next, {
        kind: "targeted",
        shooters: [revealed.playerId],
        fixedTargets: {},
        resume: "continue",
        starterId
      });
      return {
        ...transition(next),
        broadcasts: [{ event: "game:reveal", payload: next.state.reveal }, action(next, "reveal", { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: "\u4E3B\u5BB0\u724C\u63ED\u793A" }), action(next, "specialResolved", { actorId: revealed.playerId, cards: revealed.cards, label: "\u4E3B\u5BB0" })]
      };
    }
    const hasChaosLie = !isInnocent(next, card);
    const fixedTargets = hasChaosLie ? { [command.actorId]: revealed.playerId } : { [command.actorId]: command.actorId };
    next.state.reveal = {
      reason: "liar",
      accusedId: revealed.playerId,
      callerId: command.actorId,
      cards: revealed.cards
    };
    next.state.message = hasChaosLie ? `${next.state.players[command.actorId].name} \u6293\u4F4F\u4E86\u8C0E\u8A00` : `${next.state.players[command.actorId].name} \u8D28\u7591\u5931\u8D25`;
    beginRoulette(next, {
      kind: hasChaosLie ? "targeted" : "self",
      shooters: [command.actorId],
      fixedTargets,
      resume: hasChaosLie ? "continue" : "redeal",
      starterId: hasChaosLie ? starterId : command.actorId
    });
    return {
      ...transition(next),
      broadcasts: [{ event: "game:reveal", payload: next.state.reveal }, action(next, "reveal", { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: hasChaosLie ? "\u8C0E\u8A00\u88AB\u8BC6\u7834" : "\u8D28\u7591\u5931\u8D25" })]
    };
  }
  const hasLie = revealed.cards.some((card) => !isInnocent(next, card));
  const loserId = hasLie ? revealed.playerId : command.actorId;
  next.state.reveal = {
    reason: "liar",
    accusedId: revealed.playerId,
    callerId: command.actorId,
    cards: revealed.cards
  };
  next.state.message = hasLie ? `${next.state.players[revealed.playerId].name} \u88AB\u8BC6\u7834\u4E86` : `${next.state.players[command.actorId].name} \u8BEF\u5224\u4E86`;
  beginRoulette(next, {
    kind: "self",
    shooters: [loserId],
    fixedTargets: { [loserId]: loserId },
    resume: "redeal",
    starterId: loserId
  });
  return {
    ...transition(next),
    broadcasts: [{ event: "game:reveal", payload: next.state.reveal }, action(next, "reveal", { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: hasLie ? "\u8C0E\u8A00\u88AB\u8BC6\u7834" : "\u8D28\u7591\u5931\u8D25" })]
  };
}
function callDevilsDeal(session2, command) {
  if (session2.state.ruleset !== "devil") return invalid(session2, command.actorId, "\u53EA\u6709\u6076\u9B54\u5C40\u53EF\u4EE5\u53D1\u52A8\u6076\u9B54\u4EA4\u6613");
  if (session2.state.phase !== "playing") return invalid(session2, command.actorId, "\u73B0\u5728\u4E0D\u80FD\u53D1\u52A8\u6076\u9B54\u4EA4\u6613");
  if (session2.state.currentPlayerId !== command.actorId) return invalid(session2, command.actorId, "\u8FD8\u6CA1\u8F6E\u5230\u4F60");
  const cards = session2.secret.pile.flatMap((play) => play.cards).slice(-4);
  if (cards.length < 4) return invalid(session2, command.actorId, "\u684C\u4E0A\u8FD8\u6CA1\u6709\u56DB\u5F20\u724C");
  const next = cloneSession(session2);
  const revealed = next.secret.pile.flatMap((play) => play.cards).slice(-4);
  const allLies = revealed.every((card) => !isInnocent(next, card) && !isActiveDevil(next, card));
  const shooters = allLies ? livingPlayers(next).filter((player) => player.id !== command.actorId).map((player) => player.id) : [command.actorId];
  next.state.reveal = {
    reason: "devils-deal",
    accusedId: null,
    callerId: command.actorId,
    cards: revealed
  };
  next.state.message = allLies ? "\u56DB\u5F20\u8C0E\u8A00\u2014\u2014\u6076\u9B54\u6536\u53D6\u5168\u684C\u8D4C\u503A" : "\u4EA4\u6613\u5931\u8D25\uFF0C\u6076\u9B54\u53EA\u76EF\u4E0A\u4E86\u53D1\u52A8\u8005";
  beginRoulette(next, {
    kind: shooters.length === 1 ? "self" : "simultaneous",
    shooters,
    fixedTargets: Object.fromEntries(shooters.map((id) => [id, id])),
    resume: "redeal",
    starterId: command.actorId
  });
  return {
    ...transition(next),
    broadcasts: [{ event: "game:reveal", payload: next.state.reveal }, action(next, "reveal", { actorId: command.actorId, cards: revealed, label: allLies ? "\u56DB\u5F20\u8C0E\u8A00" : "\u6076\u9B54\u4EA4\u6613\u5931\u8D25" }), action(next, "specialResolved", { actorId: command.actorId, cards: revealed, label: "\u6076\u9B54\u4EA4\u6613" })]
  };
}
function finishShots(session2, random) {
  const roulette = session2.state.roulette;
  const results = roulette.shooterIds.map((shooterId) => {
    const shooter = session2.state.players[shooterId];
    const targetId = session2.secret.shotTargets[shooterId];
    const lethal = shooter.safePulls + 1 >= session2.secret.fatalPulls[shooterId];
    return { shooterId, targetId, lethal };
  });
  for (const result of results) {
    const shooter = session2.state.players[result.shooterId];
    if (result.lethal) {
      session2.state.players[result.targetId].alive = false;
      session2.state.players[result.targetId].handCount = 0;
      session2.secret.hands[result.targetId] = [];
    } else shooter.safePulls += 1;
  }
  for (const result of results) {
    if (result.lethal && result.shooterId !== result.targetId && session2.state.players[result.shooterId].alive) {
      session2.state.players[result.shooterId].safePulls = 0;
      session2.secret.fatalPulls[result.shooterId] = randomIndex(6, random) + 1;
    }
  }
  const alive = livingPlayers(session2);
  session2.state.roulette = null;
  if (alive.length <= 1) {
    session2.state.phase = "finished";
    session2.state.draw = alive.length === 0;
    session2.state.winnerId = alive[0]?.id ?? null;
    session2.state.currentPlayerId = null;
    session2.state.resolution = { shots: results, resume: roulette.resume, starterId: roulette.starterId };
    session2.state.message = alive[0] ? `${alive[0].name} \u6D3B\u5230\u4E86\u6700\u540E` : "\u65E0\u4EBA\u8D70\u51FA\u5348\u591C\u8D4C\u5C40";
    if (alive[0]) alive[0].wins += 1;
    return {
      ...transition(session2),
      broadcasts: [{ event: "game:shots", payload: { shots: results, finished: true } }, action(session2, "shots", { actorId: results[0]?.shooterId, targetIds: results.map((shot) => shot.targetId), shots: results, label: results.some((shot) => shot.lethal) ? "\u67AA\u54CD" : "\u7A7A\u67AA" }), action(session2, "roundSettled", { actorId: alive[0]?.id, label: alive[0] ? `${alive[0].name} \u6D3B\u5230\u4E86\u6700\u540E` : "\u65E0\u4EBA\u5E78\u5B58" })]
    };
  }
  session2.state.phase = "resolution";
  session2.state.resolution = { shots: results, resume: roulette.resume, starterId: roulette.starterId };
  session2.state.message = results.some((shot) => shot.lethal) ? "\u67AA\u58F0\u6495\u5F00\u4E86\u9152\u9986" : "\u53EA\u6709\u4E00\u58F0\u7A7A\u54CD";
  return {
    ...transition(session2),
    broadcasts: [{ event: "game:shots", payload: { shots: results, finished: false } }, action(session2, "shots", { actorId: results[0]?.shooterId, targetIds: results.map((shot) => shot.targetId), shots: results, label: results.some((shot) => shot.lethal) ? "\u67AA\u54CD" : "\u7A7A\u67AA" })],
    schedules: [
      {
        name: "resolution",
        ms: 1800,
        command: { type: "advanceResolution", actorId: session2.state.hostId }
      }
    ]
  };
}
function pullTrigger(session2, command, random) {
  const roulette = session2.state.roulette;
  if (session2.state.phase !== "roulette" || !roulette) return invalid(session2, command.actorId, "\u73B0\u5728\u4E0D\u80FD\u6263\u52A8\u6273\u673A");
  if (!roulette.shooterIds.includes(command.actorId)) return invalid(session2, command.actorId, "\u8FD9\u4E00\u6B21\u4E0D\u7531\u4F60\u5F00\u67AA");
  if (roulette.committed.includes(command.actorId)) return invalid(session2, command.actorId, "\u4F60\u5DF2\u7ECF\u6263\u52A8\u8FC7\u6273\u673A");
  const next = cloneSession(session2);
  const nextRoulette = next.state.roulette;
  const fixedTarget = nextRoulette.fixedTargets[command.actorId];
  const targetId = fixedTarget ?? command.targetId;
  const target = targetId ? next.state.players[targetId] : null;
  if (!target || !target.alive || !fixedTarget && targetId === command.actorId) {
    return invalid(session2, command.actorId, "\u8BF7\u9009\u62E9\u4E00\u540D\u4ECD\u7136\u6D3B\u7740\u7684\u5BF9\u624B");
  }
  next.secret.shotTargets[command.actorId] = targetId;
  nextRoulette.committed.push(command.actorId);
  if (nextRoulette.committed.length < nextRoulette.shooterIds.length) return transition(next);
  return finishShots(next, random);
}
function advanceResolution(session2, random) {
  if (session2.state.phase !== "resolution" || !session2.state.resolution) {
    return invalid(session2, session2.state.hostId, "\u6CA1\u6709\u5F85\u7ED3\u7B97\u7684\u724C\u5C40");
  }
  const next = cloneSession(session2);
  const resolution = next.state.resolution;
  if (resolution.resume === "continue") {
    next.secret.pile = [];
    next.secret.shotTargets = {};
    next.state.lastPlay = null;
    next.state.pileCount = 0;
    next.state.reveal = null;
    next.state.roulette = null;
    next.state.resolution = null;
    const holders = livingPlayers(next).filter((player) => player.handCount > 0);
    if (holders.length >= 2) {
      const requested = next.state.players[resolution.starterId];
      next.state.phase = "playing";
      next.state.currentPlayerId = requested?.alive && requested.handCount > 0 ? requested.id : nextPlayerWithCards(next, resolution.starterId);
      next.state.message = "\u6DF7\u6C8C\u4ECD\u5728\u7EE7\u7EED";
      return transition(next);
    }
  }
  dealRound(next, random, resolution.starterId);
  return {
    ...transition(next),
    sends: livingPlayers(next).map((player) => ({
      playerId: player.id,
      event: "private:hand",
      payload: { hand: next.secret.hands[player.id] }
    })),
    broadcasts: [{ event: "game:round", payload: { round: next.state.round, tableRank: next.state.tableRank } }]
  };
}
function playerJoined(session2, command) {
  if (session2.state.phase !== "lobby") return invalid(session2, command.actorId, "\u724C\u5C40\u8FDB\u884C\u4E2D\uFF0C\u6682\u65F6\u4E0D\u80FD\u5165\u5EA7");
  if (session2.state.players[command.player.id]) {
    return playerReconnected(session2, {
      type: "playerReconnected",
      actorId: command.player.id,
      name: command.player.name
    });
  }
  const seat = session2.state.seats.findIndex((id) => id === null);
  if (seat < 0) return invalid(session2, command.actorId, "\u724C\u684C\u5DF2\u6EE1");
  const next = cloneSession(session2);
  if (!next.state.hostId) next.state.hostId = command.player.id;
  next.state.seats[seat] = command.player.id;
  next.state.players[command.player.id] = createPlayer(command.player, seat);
  next.state.message = Object.keys(next.state.players).length < 2 ? "\u7B49\u5F85\u81F3\u5C11\u4E24\u540D\u73A9\u5BB6\u5165\u5EA7" : "\u9009\u62E9\u89C4\u5219\u5E76\u51C6\u5907";
  return transition(next);
}
function playerLeft(session2, command) {
  const player = session2.state.players[command.actorId];
  if (!player) return transition(session2);
  const next = cloneSession(session2);
  if (next.state.phase === "lobby") {
    next.state.seats[player.seat] = null;
    delete next.state.players[command.actorId];
    delete next.secret.hands[command.actorId];
    next.state.message = "\u7B49\u5F85\u73A9\u5BB6\u5165\u5EA7";
  } else {
    next.state.players[command.actorId].connected = false;
    next.state.message = `${player.name} \u5DF2\u65AD\u7EBF\uFF0C\u724C\u5C40\u7B49\u5F85\u5176\u91CD\u8FDE`;
  }
  return transition(next);
}
function playerReconnected(session2, command) {
  const player = session2.state.players[command.actorId];
  if (!player) return invalid(session2, command.actorId, "\u627E\u4E0D\u5230\u4FDD\u7559\u5E2D\u4F4D");
  const next = cloneSession(session2);
  next.state.players[command.actorId].connected = true;
  next.state.players[command.actorId].name = command.name;
  return {
    ...transition(next),
    sends: [
      {
        playerId: command.actorId,
        event: "private:hand",
        payload: { hand: next.secret.hands[command.actorId] ?? [] }
      }
    ]
  };
}
function setRuleset(session2, command) {
  if (session2.state.phase !== "lobby") return invalid(session2, command.actorId, "\u724C\u5C40\u5F00\u59CB\u540E\u4E0D\u80FD\u5207\u6362\u89C4\u5219");
  if (command.actorId !== session2.state.hostId) return invalid(session2, command.actorId, "\u53EA\u6709\u623F\u4E3B\u53EF\u4EE5\u5207\u6362\u89C4\u5219");
  const next = cloneSession(session2);
  next.state.ruleset = command.ruleset;
  for (const player of Object.values(next.state.players)) player.ready = false;
  next.state.message = "\u89C4\u5219\u5DF2\u5207\u6362\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907";
  return transition(next);
}
function setReady(session2, command, random) {
  if (session2.state.phase !== "lobby") return invalid(session2, command.actorId, "\u724C\u5C40\u5DF2\u7ECF\u5F00\u59CB");
  if (!session2.state.players[command.actorId]) return invalid(session2, command.actorId, "\u4F60\u8FD8\u6CA1\u6709\u5165\u5EA7");
  const next = cloneSession(session2);
  next.state.players[command.actorId].ready = command.ready;
  const seated = next.state.seats.map((id) => id ? next.state.players[id] : null).filter((player) => Boolean(player));
  if (seated.length < 2 || seated.some((player) => !player.ready)) {
    next.state.message = seated.length < 2 ? "\u7B49\u5F85\u81F3\u5C11\u4E24\u540D\u73A9\u5BB6\u5165\u5EA7" : "\u7B49\u5F85\u6240\u6709\u73A9\u5BB6\u51C6\u5907";
    return transition(next);
  }
  for (const player of seated) {
    player.alive = true;
    player.safePulls = 0;
    player.ready = false;
    next.secret.fatalPulls[player.id] = randomIndex(6, random) + 1;
  }
  next.state.winnerId = null;
  next.state.draw = false;
  next.state.round = 0;
  dealRound(next, random);
  return {
    ...transition(next),
    sends: seated.map((player) => ({
      playerId: player.id,
      event: "private:hand",
      payload: { hand: next.secret.hands[player.id] }
    })),
    broadcasts: [{ event: "game:start", payload: { ruleset: next.state.ruleset } }]
  };
}
function syncPrivate(session2, command) {
  if (!session2.state.players[command.actorId]) return invalid(session2, command.actorId, "\u4F60\u8FD8\u6CA1\u6709\u5165\u5EA7");
  return {
    ...transition(session2),
    sends: [
      {
        playerId: command.actorId,
        event: "private:hand",
        payload: { hand: session2.secret.hands[command.actorId] ?? [] }
      }
    ]
  };
}
function abortMatch(session2, command) {
  if (command.actorId !== session2.state.hostId) return invalid(session2, command.actorId, "\u53EA\u6709\u623F\u4E3B\u53EF\u4EE5\u4E2D\u6B62\u724C\u5C40");
  const next = cloneSession(session2);
  for (const player of Object.values(next.state.players)) {
    player.ready = false;
    player.alive = true;
    player.handCount = 0;
    player.safePulls = 0;
  }
  next.state.phase = "lobby";
  next.state.round = 0;
  next.state.tableRank = null;
  next.state.currentPlayerId = null;
  next.state.lastPlay = null;
  next.state.pileCount = 0;
  next.state.reveal = null;
  next.state.roulette = null;
  next.state.resolution = null;
  next.state.winnerId = null;
  next.state.draw = false;
  next.state.message = "\u724C\u5C40\u5DF2\u4E2D\u6B62\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907";
  next.secret = { hands: {}, deck: [], pile: [], fatalPulls: {}, shotTargets: {} };
  return {
    ...transition(next),
    broadcasts: [{ event: "game:aborted", payload: {} }]
  };
}
function applyCommand(session2, command, random) {
  if (command.type === "playerJoined") return playerJoined(session2, command);
  if (command.type === "playerLeft") return playerLeft(session2, command);
  if (command.type === "playerReconnected") return playerReconnected(session2, command);
  if (command.type === "setRuleset") return setRuleset(session2, command);
  if (command.type === "setReady") return setReady(session2, command, random);
  if (command.type === "playCards") return playCards(session2, command);
  if (command.type === "callLiar") return callLiar(session2, command);
  if (command.type === "callDevilsDeal") return callDevilsDeal(session2, command);
  if (command.type === "pullTrigger") return pullTrigger(session2, command, random);
  if (command.type === "advanceResolution") return advanceResolution(session2, random);
  if (command.type === "syncPrivate") return syncPrivate(session2, command);
  if (command.type === "abortMatch") return abortMatch(session2, command);
  return transition(session2);
}

// src/worker/index.ts
var secret = emptySecret();
function emptySecret() {
  return { hands: {}, deck: [], pile: [], fatalPulls: {}, shotTargets: {} };
}
function isRestorableState(state) {
  if (!state || typeof state !== "object") return false;
  const candidate = state;
  return typeof candidate.hostId === "string" && typeof candidate.players === "object" && candidate.players !== null && Array.isArray(candidate.seats);
}
function replaceState(target, source) {
  if (target === source) return;
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}
function session(ctx) {
  return { state: ctx.state, secret };
}
function emitTransition(ctx, result) {
  replaceState(ctx.state, result.session.state);
  secret = result.session.secret;
  for (const effect of result.sends) ctx.send(effect.playerId, effect.event, effect.payload);
  for (const effect of result.broadcasts) ctx.broadcast(effect.event, effect.payload);
  for (const scheduled of result.schedules) {
    ctx.setTimer(scheduled.name, scheduled.ms, () => dispatch(ctx, scheduled.command));
  }
}
function dispatch(ctx, command) {
  emitTransition(ctx, applyCommand(session(ctx), command, () => ctx.random()));
}
function asPlayer(player) {
  return {
    id: player.id,
    name: player.name,
    role: player.role === "host" ? "host" : "player"
  };
}
function resetAfterRestore(ctx) {
  secret = emptySecret();
  if (!isRestorableState(ctx.state)) {
    const players = ctx.players.filter((player) => player.role !== "spectator").map(asPlayer);
    const hostId = ctx.host?.id ?? players.find((player) => player.role === "host")?.id ?? players[0]?.id ?? "";
    const recovered = createMatch(
      { hostId, players, ruleset: "classic", start: false },
      () => ctx.random()
    );
    recovered.state.message = "\u623F\u95F4\u72B6\u6001\u5DF2\u4FEE\u590D\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907";
    replaceState(ctx.state, recovered.state);
    return;
  }
  const restored = createMatch(
    {
      hostId: ctx.state.hostId,
      players: ctx.state.seats.map((id) => id ? ctx.state.players[id] : null).filter((player) => Boolean(player)).map((player) => ({
        id: player.id,
        name: player.name,
        role: player.role,
        wins: player.wins
      })),
      ruleset: ctx.state.ruleset,
      start: false
    },
    () => ctx.random()
  );
  restored.state.message = "\u623F\u95F4\u5DF2\u6062\u590D\uFF0C\u4E0A\u4E00\u5C40\u56E0\u9690\u85CF\u4FE1\u606F\u5931\u6548\u800C\u4E2D\u6B62";
  replaceState(ctx.state, restored.state);
}
var index_default = defineRoom({
  meta: { name: "\u5348\u591C\u8D4C\u5C40", minPlayers: 2, maxPlayers: 4 },
  initialState() {
    secret = emptySecret();
    return createMatch({ hostId: "", players: [], ruleset: "classic", start: false }, Math.random).state;
  },
  onRestore(ctx) {
    resetAfterRestore(ctx);
  },
  onJoin(ctx, player) {
    if (ctx.state.phase !== "lobby" && !ctx.state.players[player.id]) {
      ctx.kick(player.id, "\u724C\u5C40\u8FDB\u884C\u4E2D\uFF0C\u6682\u4E0D\u5F00\u653E\u65B0\u5E2D\u4F4D");
      return;
    }
    dispatch(ctx, { type: "playerJoined", actorId: player.id, player: asPlayer(player) });
  },
  onReconnect(ctx, player) {
    dispatch(ctx, { type: "playerReconnected", actorId: player.id, name: player.name });
  },
  onLeave(ctx, player) {
    dispatch(ctx, { type: "playerLeft", actorId: player.id });
  },
  onReady(ctx, player) {
    dispatch(ctx, { type: "syncPrivate", actorId: player.id });
  },
  actions: {
    setReady(ctx, { player, payload }) {
      dispatch(ctx, { type: "setReady", actorId: player.id, ready: Boolean(payload?.ready) });
    },
    setRuleset(ctx, { player, payload }) {
      const ruleset = payload?.ruleset;
      if (ruleset !== "classic" && ruleset !== "devil" && ruleset !== "chaos") {
        ctx.send(player.id, "game:invalid", { message: "\u672A\u77E5\u89C4\u5219" });
        return;
      }
      dispatch(ctx, { type: "setRuleset", actorId: player.id, ruleset });
    },
    playCards(ctx, { player, payload }) {
      const cardIds = Array.isArray(payload?.cardIds) ? payload.cardIds.filter((id) => typeof id === "string") : [];
      dispatch(ctx, { type: "playCards", actorId: player.id, cardIds });
    },
    callLiar(ctx, { player }) {
      dispatch(ctx, { type: "callLiar", actorId: player.id });
    },
    callDevilsDeal(ctx, { player }) {
      dispatch(ctx, { type: "callDevilsDeal", actorId: player.id });
    },
    pullTrigger(ctx, { player, payload }) {
      dispatch(ctx, {
        type: "pullTrigger",
        actorId: player.id,
        targetId: typeof payload?.targetId === "string" ? payload.targetId : void 0
      });
    },
    syncPrivate(ctx, { player }) {
      dispatch(ctx, { type: "syncPrivate", actorId: player.id });
    },
    abortMatch(ctx, { player }) {
      if (player.id === ctx.state.hostId) ctx.clearTimer("resolution");
      dispatch(ctx, { type: "abortMatch", actorId: player.id });
    }
  }
});
export default index_default;

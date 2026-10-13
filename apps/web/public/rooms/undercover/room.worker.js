// src/worker.ts
import { defineRoom } from "@parti/worker-sdk";

// src/categories.ts
var CATEGORIES = ["entertainment", "food", "daily", "nature", "campus", "sports", "travel", "nsfw"];

// src/game-logic.ts
function undercoverCount(playerCount) {
  if (playerCount < 3) return 0;
  if (playerCount <= 5) return 1;
  if (playerCount <= 9) return 2;
  return 3;
}
function blankAppearanceChance(playerCount) {
  if (playerCount < 3) return 0;
  if (playerCount === 3) return 0.25;
  if (playerCount === 4) return 0.5;
  if (playerCount === 5) return 0.75;
  return 1;
}
function isCategory(value) {
  return typeof value === "string" && CATEGORIES.includes(value);
}
function normalizeCategories(value) {
  if (!Array.isArray(value)) return null;
  const categories = [...new Set(value)];
  if (categories.length === 0 || !categories.every(isCategory)) return null;
  return categories;
}
function eligiblePairs(wordPairs, categories) {
  const selected = new Set(categories);
  return wordPairs.filter((pair) => selected.has(pair.category));
}
function choosePair(candidates, usedIds, random) {
  if (candidates.length === 0) throw new Error("No eligible word pairs");
  let available = candidates.filter((pair) => !usedIds.has(pair.id));
  const reset = available.length === 0;
  if (reset) available = candidates;
  const index = Math.min(available.length - 1, Math.floor(random() * available.length));
  return { pair: available[index], reset };
}
function dealCards(playerIds, pair, random, includeBlank = false) {
  const swapWords = random() < 0.5;
  return dealCardsWithWords(
    playerIds,
    swapWords ? { civilian: pair.undercover, undercover: pair.civilian } : { civilian: pair.civilian, undercover: pair.undercover },
    random,
    includeBlank
  );
}
function dealCardsWithWords(playerIds, words, random, includeBlank = false) {
  const hasBlank = includeBlank && random() < blankAppearanceChance(playerIds.length);
  const shuffled = [...playerIds];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  const blankId = hasBlank ? shuffled[0] : null;
  const undercovers = hasBlank ? playerIds.length === 3 ? 0 : Math.max(1, undercoverCount(playerIds.length) - (playerIds.length >= 6 ? 1 : 0)) : undercoverCount(playerIds.length);
  const undercoverIds = new Set(shuffled.slice(hasBlank ? 1 : 0, (hasBlank ? 1 : 0) + undercovers));
  const cards = Object.fromEntries(playerIds.map((id) => {
    const role = id === blankId ? "blank" : undercoverIds.has(id) ? "undercover" : "civilian";
    const word = role === "blank" ? "" : role === "undercover" ? words.undercover : words.civilian;
    return [id, { role, word }];
  }));
  return { cards, words, hadBlank: hasBlank, hadUndercover: undercovers > 0 };
}
function participantIds(players, mode) {
  return players.filter((player) => player.role !== "spectator" && (mode === "classic" || player.role !== "host")).map((player) => player.id);
}
function normalizeCustomWords(value) {
  if (!value || typeof value !== "object") return null;
  const payload = value;
  if (typeof payload.civilianWord !== "string" || typeof payload.undercoverWord !== "string") return null;
  const civilian = payload.civilianWord.trim();
  const undercover = payload.undercoverWord.trim();
  if (!civilian || !undercover || civilian === undercover) return null;
  if (civilian.length > 20 || undercover.length > 20) return null;
  return { civilian, undercover };
}
function privateCardPayload(card, round) {
  return { round, word: card.word };
}
function resolveElimination(deal, eliminatedPlayerIds) {
  const eliminated = new Set(eliminatedPlayerIds);
  const alive = Object.entries(deal.cards).filter(([playerId]) => !eliminated.has(playerId)).map(([, card]) => card);
  const aliveUndercover = alive.filter(({ role }) => role === "undercover").length;
  const aliveCivilian = alive.filter(({ role }) => role === "civilian").length;
  const aliveBlank = alive.some(({ role }) => role === "blank");
  let winner = null;
  if (aliveUndercover === 0) winner = aliveBlank ? "blank" : "civilian";
  else if (aliveCivilian <= aliveUndercover) winner = "undercover";
  return {
    finished: winner !== null,
    winner,
    revealedWords: winner ? deal.words : null,
    hadBlank: deal.hadBlank,
    hadUndercover: deal.hadUndercover
  };
}

// src/round-flow.ts
function livingSpeakingOrder(dealtOrder, eliminated, startAt = 0) {
  const eliminatedSet = new Set(eliminated);
  const living = dealtOrder.filter((id) => !eliminatedSet.has(id));
  if (living.length === 0) return [];
  const start = (startAt % living.length + living.length) % living.length;
  return [...living.slice(start), ...living.slice(0, start)];
}
function tallyVotes(votes) {
  const tally = {};
  for (const target of Object.values(votes)) {
    if (!target) continue;
    tally[target] = (tally[target] ?? 0) + 1;
  }
  return tally;
}
function voteLeaders(tally) {
  let max = 0;
  for (const count of Object.values(tally)) if (count > max) max = count;
  if (max === 0) return [];
  return Object.keys(tally).filter((id) => tally[id] === max);
}
function resolveVote(votes, candidateIds) {
  const candidateSet = new Set(candidateIds);
  const valid = {};
  for (const [voterId, targetId] of Object.entries(votes)) {
    if (candidateSet.has(targetId)) valid[voterId] = targetId;
  }
  const leaders = voteLeaders(tallyVotes(valid));
  if (leaders.length === 1) return { leaders, eliminatedId: leaders[0], tie: false };
  return { leaders, eliminatedId: null, tie: leaders.length > 1 };
}

// src/word-bank-extra.ts
var source = {
  entertainment: "\u9662\u7EBF\u7535\u5F71/\u7F51\u7EDC\u7535\u5F71;\u559C\u5267\u7247/\u7231\u60C5\u7247;\u60AC\u7591\u7247/\u6050\u6016\u7247;\u79D1\u5E7B\u7247/\u5947\u5E7B\u7247;\u52A8\u753B\u7535\u5F71/\u771F\u4EBA\u7535\u5F71;\u7537\u4E3B\u89D2/\u7537\u914D\u89D2;\u5973\u4E3B\u89D2/\u5973\u914D\u89D2;\u5BFC\u6F14\u6905/\u89C2\u4F17\u5E2D;\u5F00\u673A\u4EEA\u5F0F/\u6740\u9752\u5BB4;\u8DEF\u6F14/\u9996\u6620;\u8FFD\u5267/\u8FFD\u756A;\u500D\u901F\u64AD\u653E/\u8DF3\u8FC7\u7247\u5934;\u70ED\u641C/\u70ED\u699C;\u8BDD\u9898\u699C/\u6392\u884C\u699C;\u70B9\u8D5E/\u6536\u85CF;\u8F6C\u53D1/\u5206\u4EAB;\u5173\u6CE8/\u8BA2\u9605;\u8FDE\u9EA6/\u5408\u62CD;\u76F4\u64AD\u95F4/\u6F14\u64AD\u5BA4;\u4E3B\u64AD/\u535A\u4E3B;\u77ED\u5267/\u77ED\u89C6\u9891;\u7AD6\u5C4F\u89C6\u9891/\u6A2A\u5C4F\u89C6\u9891;\u5F39\u5E55\u793C\u4EEA/\u89C2\u5F71\u793C\u4EEA;\u6E38\u620F\u76F4\u64AD/\u8D5B\u4E8B\u76F4\u64AD;\u5355\u673A\u6E38\u620F/\u7F51\u7EDC\u6E38\u620F;\u624B\u673A\u6E38\u620F/\u7535\u8111\u6E38\u620F;\u4E3B\u673A\u6E38\u620F/\u8857\u673A\u6E38\u620F;\u5F00\u653E\u4E16\u754C/\u6C99\u76D2\u6E38\u620F;\u6392\u4F4D\u8D5B/\u5339\u914D\u8D5B;\u961F\u53CB/\u5BF9\u624B;\u65B0\u624B\u6559\u7A0B/\u6E38\u620F\u653B\u7565;\u76AE\u80A4/\u65F6\u88C5;\u6E38\u620F\u89D2\u8272/\u865A\u62DF\u5076\u50CF;\u76F2\u76D2/\u626D\u86CB;\u8C37\u5B50/\u5468\u8FB9;\u5FBD\u7AE0/\u94A5\u5319\u6263;\u6D77\u62A5/\u7ACB\u724C;\u5C0F\u8BF4\u6539\u7F16/\u6F2B\u753B\u6539\u7F16;\u539F\u8457/\u540C\u4EBA;\u5E7F\u64AD\u5267/\u6709\u58F0\u4E66;\u64AD\u5BA2/\u7535\u53F0;\u6B4C\u5355/\u4E13\u8F91;\u5355\u66F2\u5FAA\u73AF/\u968F\u673A\u64AD\u653E;\u73B0\u573A\u6F14\u51FA/\u7EBF\u4E0A\u6F14\u51FA;\u97F3\u4E50\u8282/\u827A\u672F\u8282;\u8131\u53E3\u79C0/\u5373\u5174\u559C\u5267;\u8857\u821E/\u73B0\u4EE3\u821E;\u56FD\u98CE\u97F3\u4E50/\u53E4\u5178\u97F3\u4E50;\u865A\u62DF\u73B0\u5B9E/\u589E\u5F3A\u73B0\u5B9E;\u4EBA\u5DE5\u667A\u80FD\u914D\u97F3/\u771F\u4EBA\u914D\u97F3",
  food: "\u62FF\u94C1/\u5361\u5E03\u5947\u8BFA;\u7F8E\u5F0F\u5496\u5561/\u51B7\u8403\u5496\u5561;\u7EA2\u8336/\u7EFF\u8336;\u4E4C\u9F99\u8336/\u666E\u6D31\u8336;\u6C14\u6CE1\u6C34/\u82CF\u6253\u6C34;\u9178\u5976/\u4E73\u9178\u83CC\u996E\u6599;\u6930\u6C41/\u674F\u4EC1\u9732;\u6A59\u6C41/\u82F9\u679C\u6C41;\u51B0\u6C99/\u5976\u6614;\u73CD\u73E0\u5976\u8336/\u6930\u679C\u5976\u8336;\u87BA\u86F3\u7C89/\u9178\u8FA3\u7C89;\u91CD\u5E86\u5C0F\u9762/\u62C5\u62C5\u9762;\u70B8\u9171\u9762/\u70ED\u5E72\u9762;\u5200\u524A\u9762/\u62C9\u9762;\u8FC7\u6865\u7C73\u7EBF/\u6842\u6797\u7C73\u7C89;\u8089\u5939\u998D/\u6C49\u5821;\u714E\u997C\u679C\u5B50/\u624B\u6293\u997C;\u9505\u8D34/\u714E\u997A;\u70E7\u5356/\u5C0F\u7B3C\u5305;\u9992\u5934/\u82B1\u5377;\u7EA2\u70E7\u8089/\u4E1C\u5761\u8089;\u7CD6\u918B\u6392\u9AA8/\u7EA2\u70E7\u6392\u9AA8;\u5BAB\u4FDD\u9E21\u4E01/\u8FA3\u5B50\u9E21;\u9EBB\u5A46\u8C46\u8150/\u5BB6\u5E38\u8C46\u8150;\u9178\u83DC\u9C7C/\u6C34\u716E\u9C7C;\u5C0F\u9F99\u867E/\u5927\u95F8\u87F9;\u70E4\u9C7C/\u70E4\u8089;\u4E32\u4E32\u9999/\u5173\u4E1C\u716E;\u9E33\u9E2F\u9505/\u4E5D\u5BAB\u683C\u706B\u9505;\u756A\u8304\u9505/\u83CC\u6C64\u9505;\u86CB\u7092\u996D/\u626C\u5DDE\u7092\u996D;\u76D6\u6D47\u996D/\u7172\u4ED4\u996D;\u5BFF\u53F8/\u996D\u56E2;\u7D2B\u83DC\u5305\u996D/\u624B\u5377;\u86CB\u631E/\u7EB8\u676F\u86CB\u7CD5;\u6CE1\u8299/\u9A6C\u5361\u9F99;\u63D0\u62C9\u7C73\u82CF/\u6155\u65AF\u86CB\u7CD5;\u53CC\u76AE\u5976/\u59DC\u649E\u5976;\u6768\u679D\u7518\u9732/\u8292\u679C\u897F\u7C73\u9732;\u70E7\u4ED9\u8349/\u9F9F\u82D3\u818F;\u69B4\u83B2/\u83E0\u841D\u871C;\u7315\u7334\u6843/\u706B\u9F99\u679C;\u84DD\u8393/\u9ED1\u8393;\u67DA\u5B50/\u8461\u8404\u67DA;\u897F\u5170\u82B1/\u83DC\u82B1;\u5357\u74DC/\u51AC\u74DC;\u83B2\u85D5/\u5C71\u836F;\u751F\u714E\u5305/\u6C34\u714E\u5305;\u81EA\u52A9\u9910/\u6D41\u6C34\u5E2D;\u5916\u5356/\u5802\u98DF",
  daily: "\u626B\u5730\u673A\u5668\u4EBA/\u5438\u5C18\u5668;\u7A7A\u6C14\u51C0\u5316\u5668/\u52A0\u6E7F\u5668;\u53D6\u6696\u5668/\u7535\u98CE\u6247;\u5496\u5561\u673A/\u8C46\u6D46\u673A;\u70E4\u9762\u5305\u673A/\u5FAE\u6CE2\u7089;\u4FDD\u9C9C\u76D2/\u996D\u76D2;\u70ED\u6C34\u74F6/\u4FDD\u6E29\u58F6;\u5F00\u74F6\u5668/\u524A\u76AE\u5200;\u6F0F\u52FA/\u9505\u94F2;\u64C0\u9762\u6756/\u7827\u677F;\u56F4\u88D9/\u8896\u5957;\u6A61\u80F6\u624B\u5957/\u4E00\u6B21\u6027\u624B\u5957;\u6D17\u8863\u7BEE/\u6536\u7EB3\u7BEE;\u9488\u7EBF\u76D2/\u5DE5\u5177\u7BB1;\u87BA\u4E1D\u5200/\u8001\u864E\u94B3;\u5377\u5C3A/\u76F4\u5C3A;\u900F\u660E\u80F6\u5E26/\u53CC\u9762\u80F6;\u4FBF\u5229\u8D34/\u4FBF\u7B7E\u672C;\u8BA2\u4E66\u5668/\u6253\u5B54\u5668;\u6587\u4EF6\u5939/\u6587\u4EF6\u888B;\u8BA1\u7B97\u5668/\u9065\u63A7\u5668;\u9F20\u6807\u57AB/\u684C\u57AB;\u5E73\u677F\u7535\u8111/\u7B14\u8BB0\u672C\u7535\u8111;\u5145\u7535\u5B9D/\u5145\u7535\u5934;\u667A\u80FD\u624B\u8868/\u8FD0\u52A8\u624B\u73AF;\u81EA\u62CD\u6746/\u4E09\u811A\u67B6;\u8DEF\u7531\u5668/\u4EA4\u6362\u673A;\u6295\u5F71\u4EEA/\u7535\u89C6\u673A;\u95E8\u57AB/\u5730\u6BEF;\u8863\u5E3D\u67B6/\u6302\u8863\u94A9;\u6447\u6905/\u8EBA\u6905;\u868A\u5E10/\u5E8A\u5E18;\u5E8A\u5934\u67DC/\u68B3\u5986\u53F0;\u7A97\u7EB1/\u7A97\u5E18;\u6302\u949F/\u5EA7\u949F;\u96E8\u9774/\u96E8\u978B\u5957;\u592A\u9633\u955C/\u8FD1\u89C6\u773C\u955C;\u906E\u9633\u5E3D/\u68D2\u7403\u5E3D;\u56F4\u5DFE/\u62AB\u80A9;\u9886\u5E26/\u9886\u7ED3;\u8170\u5E26/\u80CC\u5E26;\u96F6\u94B1\u5305/\u94A5\u5319\u5305;\u516C\u4EA4\u5361/\u94F6\u884C\u5361;\u5FEB\u9012\u67DC/\u50A8\u7269\u67DC;\u6591\u9A6C\u7EBF/\u4EBA\u884C\u9053;\u5171\u4EAB\u5355\u8F66/\u5171\u4EAB\u7535\u52A8\u8F66;\u81EA\u52A8\u552E\u8D27\u673A/\u81EA\u52A9\u53D6\u6B3E\u673A;\u5237\u8138\u652F\u4ED8/\u626B\u7801\u652F\u4ED8;\u89C6\u9891\u901A\u8BDD/\u8BED\u97F3\u901A\u8BDD;\u62C6\u5FEB\u9012/\u62C6\u793C\u7269",
  nature: "\u6674\u5929/\u9634\u5929;\u66B4\u96E8/\u96F7\u9635\u96E8;\u53F0\u98CE\u773C/\u9F99\u5377\u98CE;\u96EA\u4EBA/\u51B0\u96D5;\u5F69\u971E/\u5F69\u8679;\u5317\u6781\u5149/\u94F6\u6CB3;\u5F57\u661F/\u6D41\u661F;\u65B0\u6708/\u5F2F\u6708;\u6708\u98DF/\u65E5\u98DF;\u6668\u66E6/\u66AE\u8272;\u6D77\u98CE/\u5C71\u98CE;\u6625\u96E8/\u79CB\u96E8;\u6885\u96E8/\u9635\u96E8;\u8584\u96FE/\u6D53\u96FE;\u9732\u73E0/\u6C34\u73E0;\u51B0\u67F1/\u949F\u4E73\u77F3;\u96EA\u539F/\u51B0\u539F;\u96EA\u5CF0/\u51B0\u5C71;\u4E18\u9675/\u9AD8\u539F;\u76C6\u5730/\u8C37\u5730;\u5CE1\u6E7E/\u6D77\u6E7E;\u6CB3\u53E3/\u5165\u6D77\u53E3;\u6EAA\u6D41/\u6CC9\u6C34;\u6C34\u5E93/\u6E56\u6CCA;\u6D45\u6EE9/\u6C99\u6D32;\u6D77\u6C9F/\u5CE1\u8C37;\u706B\u5C71\u7070/\u6C99\u5C18;\u7194\u5CA9/\u5CA9\u6D46;\u7901\u77F3/\u73CA\u745A\u7901;\u9E45\u5375\u77F3/\u788E\u77F3;\u7EA2\u6811\u6797/\u7AF9\u6797;\u9488\u53F6\u6797/\u9614\u53F6\u6797;\u70ED\u5E26\u96E8\u6797/\u539F\u59CB\u68EE\u6797;\u8349\u7538/\u8349\u539F;\u7EFF\u6D32/\u6E7F\u5730;\u68AF\u7530/\u7A3B\u7530;\u8336\u56ED/\u679C\u56ED;\u67AB\u6811/\u94F6\u674F\u6811;\u677E\u67CF/\u6749\u6811;\u8377\u53F6/\u7761\u83B2\u53F6;\u6885\u82B1/\u6A31\u82B1;\u7261\u4E39/\u828D\u836F;\u5411\u65E5\u8475/\u6CB9\u83DC\u82B1;\u4ED9\u4EBA\u7403/\u4ED9\u4EBA\u638C;\u82D4\u85D3/\u5730\u8863;\u85E4\u8513/\u722C\u5C71\u864E;\u677E\u679C/\u83B2\u84EC;\u9E1F\u5DE2/\u8681\u7A74;\u8702\u5DE2/\u86DB\u7F51;\u6D6A\u82B1/\u6CE1\u6CAB",
  campus: "\u5E7C\u513F\u56ED/\u5C0F\u5B66;\u521D\u4E2D/\u9AD8\u4E2D;\u5927\u5B66/\u7814\u7A76\u751F\u9662;\u65B0\u751F/\u6BD5\u4E1A\u751F;\u8F85\u5BFC\u5458/\u73ED\u4E3B\u4EFB;\u4EFB\u8BFE\u8001\u5E08/\u4EE3\u8BFE\u8001\u5E08;\u73ED\u957F/\u5B66\u4E60\u59D4\u5458;\u5BA4\u53CB/\u540C\u684C;\u5B66\u957F/\u5B66\u5F1F;\u793E\u56E2/\u5B66\u751F\u4F1A;\u5FC5\u4FEE\u8BFE/\u9009\u4FEE\u8BFE;\u516C\u5F00\u8BFE/\u7F51\u8BFE;\u65E9\u81EA\u4E60/\u665A\u81EA\u4E60;\u5B9E\u9A8C\u8BFE/\u4F53\u80B2\u8BFE;\u8BFE\u5802\u6D4B\u9A8C/\u968F\u5802\u7EC3\u4E60;\u6708\u8003/\u6A21\u62DF\u8003;\u5F00\u5377\u8003\u8BD5/\u95ED\u5377\u8003\u8BD5;\u8865\u8003/\u91CD\u4FEE;\u8BBA\u6587\u7B54\u8FA9/\u8BFE\u5802\u5C55\u793A;\u5C0F\u7EC4\u4F5C\u4E1A/\u4E2A\u4EBA\u4F5C\u4E1A;\u8BFB\u4E66\u62A5\u544A/\u5B9E\u9A8C\u62A5\u544A;\u8BFE\u5802\u7B14\u8BB0/\u590D\u4E60\u63D0\u7EB2;\u9519\u9898\u672C/\u8349\u7A3F\u672C;\u8BFE\u7A0B\u8868/\u8003\u8BD5\u5B89\u6392;\u5F55\u53D6\u901A\u77E5\u4E66/\u6BD5\u4E1A\u8BC1\u4E66;\u5B66\u751F\u8BC1/\u6821\u56ED\u5361;\u5956\u5B66\u91D1/\u52A9\u5B66\u91D1;\u5B66\u5206/\u7EE9\u70B9;\u9009\u8BFE/\u62A2\u8BFE;\u7B7E\u5230/\u70B9\u540D;\u8BF7\u5047\u6761/\u68C0\u8BA8\u4E66;\u8BB2\u5EA7/\u7814\u8BA8\u4F1A;\u8FA9\u8BBA\u961F/\u6F14\u8BB2\u961F;\u6587\u5B66\u793E/\u5E7F\u64AD\u7AD9;\u8FCE\u65B0\u665A\u4F1A/\u6BD5\u4E1A\u665A\u4F1A;\u6821\u8FD0\u4F1A/\u7BEE\u7403\u8D5B;\u519B\u8BAD/\u62D3\u5C55\u8BAD\u7EC3;\u6625\u6E38/\u79CB\u6E38;\u56FE\u4E66\u89D2/\u9605\u89C8\u5BA4;\u9636\u68AF\u6559\u5BA4/\u62A5\u544A\u5385;\u5BBF\u820D\u697C/\u6559\u5B66\u697C;\u5B9E\u9A8C\u697C/\u884C\u653F\u697C;\u6821\u95E8\u53E3/\u64CD\u573A\u8FB9;\u4E0A\u94FA/\u5355\u4EBA\u5E8A;\u5E8A\u5E18/\u906E\u5149\u5E18;\u996D\u5361/\u6C34\u5361;\u81EA\u52A8\u94C5\u7B14/\u6309\u52A8\u7B14;\u8367\u5149\u7B14/\u8BB0\u53F7\u7B14;\u6D3B\u9875\u672C/\u7EBF\u5708\u672C;\u4E66\u7ACB/\u6587\u4EF6\u67B6",
  sports: "\u4E16\u754C\u676F/\u6B27\u6D32\u676F;\u5965\u8FD0\u4F1A/\u4E9A\u8FD0\u4F1A;\u5168\u8FD0\u4F1A/\u7701\u8FD0\u4F1A;\u8054\u8D5B/\u676F\u8D5B;\u5C0F\u7EC4\u8D5B/\u6DD8\u6C70\u8D5B;\u63ED\u5E55\u6218/\u51B3\u8D5B;\u4E3B\u6559\u7EC3/\u52A9\u7406\u6559\u7EC3;\u8FB9\u88C1/\u4E3B\u88C1;\u524D\u950B/\u4E2D\u950B;\u540E\u536B/\u95E8\u5C06;\u66FF\u8865\u5E2D/\u6559\u7EC3\u5E2D;\u89C2\u4F17\u5E2D/\u5A92\u4F53\u5E2D;\u4E3B\u961F/\u5BA2\u961F;\u961F\u5FBD/\u5409\u7965\u7269;\u7403\u8FF7/\u5566\u5566\u961F;\u4F20\u4E2D/\u957F\u4F20;\u5934\u7403/\u6263\u7BEE;\u7F5A\u7403/\u70B9\u7403;\u4EFB\u610F\u7403/\u89D2\u7403;\u7EA2\u724C/\u9EC4\u724C;\u754C\u5916\u7403/\u53D1\u7403;\u6682\u505C/\u6362\u4EBA;\u7EDD\u6740/\u9006\u8F6C;\u5E73\u5C40/\u96F6\u5C01;\u77ED\u8DD1/\u51B2\u523A\u8DD1;\u957F\u8DD1/\u8D8A\u91CE\u8DD1;\u8DE8\u680F/\u969C\u788D\u8DD1;\u8DF3\u8FDC/\u4E09\u7EA7\u8DF3;\u94C5\u7403/\u6807\u67AA;\u94C1\u997C/\u94FE\u7403;\u81EA\u7531\u6CF3/\u72D7\u5228;\u4EF0\u6CF3/\u6F5C\u6CF3;\u6E38\u6CF3\u6C60/\u8DF3\u6C34\u6C60;\u76AE\u5212\u8247/\u9F99\u821F;\u5E06\u8239/\u5E06\u677F;\u6ED1\u677F/\u51B2\u6D6A\u677F;\u53CC\u677F\u6ED1\u96EA/\u5355\u677F\u6ED1\u96EA;\u82B1\u6837\u6ED1\u51B0/\u901F\u5EA6\u6ED1\u51B0;\u51B0\u7403/\u51B0\u58F6;\u62F3\u51FB\u53F0/\u6454\u8DE4\u57AB;\u8DC6\u62F3\u9053/\u62F3\u51FB;\u67D4\u9053/\u5DF4\u897F\u67D4\u672F;\u592A\u6781\u62F3/\u516B\u6BB5\u9526;\u666E\u62C9\u63D0/\u745C\u4F3D;\u4FEF\u5367\u6491/\u5E73\u677F\u652F\u6491;\u5F15\u4F53\u5411\u4E0A/\u53CC\u6760\u81C2\u5C48\u4F38;\u54D1\u94C3\u5367\u63A8/\u6760\u94C3\u6DF1\u8E72;\u98DE\u76D8/\u6A44\u6984\u7403;\u9A6C\u672F/\u8D5B\u9A6C;\u5C04\u51FB/\u5C04\u7BAD",
  travel: "\u76F4\u98DE/\u4E2D\u8F6C;\u65E9\u73ED\u673A/\u7EA2\u773C\u822A\u73ED;\u822A\u7AD9\u697C/\u5019\u673A\u697C;\u767B\u673A\u53E3/\u5ECA\u6865;\u6258\u8FD0\u884C\u674E/\u968F\u8EAB\u884C\u674E;\u884C\u674E\u724C/\u767B\u673A\u724C;\u62A4\u7167/\u901A\u884C\u8BC1;\u7B7E\u8BC1/\u7B7E\u6CE8;\u6D77\u5173/\u8FB9\u68C0;\u5B89\u68C0\u95E8/\u68C0\u7968\u95F8\u673A;\u9AD8\u94C1/\u52A8\u8F66;\u786C\u5EA7/\u8F6F\u5EA7;\u5367\u94FA/\u5EA7\u7968;\u7AD9\u53F0/\u5019\u8F66\u5BA4;\u5730\u94C1\u7968/\u516C\u4EA4\u5361;\u51FA\u79DF\u8F66/\u987A\u98CE\u8F66;\u5171\u4EAB\u5355\u8F66/\u79DF\u8D41\u6C7D\u8F66;\u5BFC\u822A\u8F6F\u4EF6/\u7EB8\u8D28\u5730\u56FE;\u670D\u52A1\u533A/\u52A0\u6CB9\u7AD9;\u56FD\u9053/\u7701\u9053;\u73AF\u5C9B/\u4E01\u5B57\u8DEF\u53E3;\u5355\u884C\u9053/\u6B65\u884C\u8857;\u6D77\u6E2F/\u6E14\u6E2F;\u6E38\u8F6E/\u6E21\u8F6E;\u5FEB\u8247/\u5E06\u8239;\u9152\u5E97\u524D\u53F0/\u6C11\u5BBF\u623F\u4E1C;\u6807\u51C6\u95F4/\u5927\u5E8A\u623F;\u9752\u65C5/\u5BA2\u6808;\u5165\u4F4F/\u9000\u623F;\u623F\u5361/\u95E8\u7968;\u9884\u7EA6/\u6392\u961F;\u5BFC\u89C8\u56FE/\u8BB2\u89E3\u5668;\u65C5\u884C\u653B\u7565/\u6E38\u8BB0;\u884C\u7A0B\u5355/\u6E05\u5355;\u8DDF\u56E2\u6E38/\u534A\u81EA\u52A9\u6E38;\u81EA\u9A7E\u6E38/\u623F\u8F66\u6E38;\u57CE\u5E02\u6F2B\u6B65/\u4E61\u6751\u5F92\u6B65;\u767B\u5C71/\u9AD8\u5C71\u5F92\u6B65;\u9732\u8425/\u91CE\u9910;\u5E10\u7BF7/\u5929\u5E55;\u7761\u888B/\u5145\u6C14\u5E8A;\u8425\u706F/\u624B\u7535\u7B52;\u7BDD\u706B/\u70E7\u70E4\u7089;\u9632\u6652\u971C/\u906E\u9633\u4F1E;\u9A71\u868A\u6C34/\u82B1\u9732\u6C34;\u7EAA\u5FF5\u7AE0/\u51B0\u7BB1\u8D34;\u7279\u4EA7\u5E97/\u514D\u7A0E\u5E97;\u89C2\u666F\u53F0/\u77AD\u671B\u5854;\u53E4\u57CE/\u53E4\u6751;\u6D77\u6EE9/\u6E56\u7554",
  nsfw: "\u521D\u6B21\u7EA6\u4F1A/\u5468\u5E74\u7EA6\u4F1A;\u5FC3\u52A8/\u60B8\u52A8;\u597D\u611F/\u559C\u6B22;\u6697\u793A/\u660E\u793A;\u6697\u604B/\u5355\u604B;\u53CC\u5411\u5954\u8D74/\u4E00\u53A2\u60C5\u613F;\u66A7\u6627\u671F/\u70ED\u604B\u671F;\u604B\u7231\u8111/\u4E8B\u4E1A\u8111;\u989C\u63A7/\u58F0\u63A7;\u5B89\u5168\u611F/\u65B0\u9C9C\u611F;\u5360\u6709\u6B32/\u4FDD\u62A4\u6B32;\u5403\u918B/\u751F\u6C14;\u6492\u5A07/\u793A\u5F31;\u5BB3\u7F9E/\u7D27\u5F20;\u8138\u7EA2/\u8033\u7EA2;\u7275\u624B/\u5341\u6307\u76F8\u6263;\u62E5\u62B1/\u4F9D\u504E;\u4EB2\u543B/\u8D34\u9762\u793C;\u58C1\u549A/\u6478\u5934\u6740;\u516C\u4E3B\u62B1/\u80CC\u4EBA;\u60C5\u8BDD/\u627F\u8BFA;\u60C5\u4E66/\u8D3A\u5361;\u79C1\u4FE1/\u77ED\u4FE1;\u8BED\u97F3\u901A\u8BDD/\u7EBF\u4E0A\u4F1A\u8BAE;\u65E9\u5B89\u6D88\u606F/\u665A\u5B89\u6D88\u606F;\u804A\u5929\u7F6E\u9876/\u7279\u522B\u5173\u6CE8;\u60C5\u4FA3\u5934\u50CF/\u60C5\u4FA3\u6635\u79F0;\u5408\u7167/\u81EA\u62CD;\u7EAA\u5FF5\u65E5/\u751F\u65E5;\u60CA\u559C/\u6D6A\u6F2B;\u73AB\u7470/\u90C1\u91D1\u9999;\u5DE7\u514B\u529B/\u9A6C\u5361\u9F99;\u9999\u6C34/\u9999\u85B0;\u53E3\u7EA2/\u5507\u818F;\u7761\u8863/\u5BB6\u5C45\u670D;\u6D74\u888D/\u7761\u888D;\u4E1D\u7EF8/\u5929\u9E45\u7ED2;\u857E\u4E1D/\u8584\u7EB1;\u9886\u7ED3/\u4E1D\u5DFE;\u9879\u94FE/\u9501\u9AA8\u94FE;\u6212\u6307/\u624B\u956F;\u6E05\u5427/\u9152\u5427;\u9999\u69DF/\u8D77\u6CE1\u9152;\u70DB\u5149/\u6C1B\u56F4\u706F;\u53CC\u4EBA\u7535\u5F71/\u79C1\u4EBA\u5F71\u9662;\u60C5\u4FA3\u9910\u5385/\u5C4B\u9876\u9910\u5385;\u871C\u6708\u65C5\u884C/\u5468\u5E74\u65C5\u884C;\u6C42\u5A5A/\u8BA2\u5A5A;\u95EA\u5A5A/\u590D\u5A5A;\u4E8C\u4EBA\u4E16\u754C/\u72EC\u5904\u65F6\u5149"
};
var EXTRA_WORD_PAIRS = Object.entries(source).flatMap(
  ([category, csv]) => csv.split(";").map((value, index) => {
    const [civilian, undercover] = value.split("/");
    return { id: `${category}-${index + 61}`, category, civilian, undercover };
  })
);

// src/word-bank.ts
var pairs = (category, values) => values.map(([civilian, undercover], index) => ({ id: `${category}-${index + 1}`, category, civilian, undercover }));
var WORD_PAIRS = [
  ...pairs("entertainment", [
    ["\u7535\u5F71", "\u7535\u89C6\u5267"],
    ["\u5BFC\u6F14", "\u5236\u7247\u4EBA"],
    ["\u6F14\u5458", "\u914D\u97F3\u5458"],
    ["\u6F14\u5531\u4F1A", "\u97F3\u4E50\u8282"],
    ["\u8BDD\u5267", "\u6B4C\u5267"],
    ["\u76F8\u58F0", "\u5C0F\u54C1"],
    ["\u6F2B\u753B", "\u52A8\u753B"],
    ["\u5C0F\u8BF4", "\u6563\u6587"],
    ["\u5409\u4ED6", "\u8D1D\u65AF"],
    ["\u94A2\u7434", "\u7535\u5B50\u7434"],
    ["\u821E\u8E48", "\u4F53\u64CD"],
    ["\u9B54\u672F", "\u6742\u6280"],
    ["\u4E3B\u6301\u4EBA", "\u4E3B\u64AD"],
    ["\u5267\u672C", "\u53F0\u8BCD"],
    ["\u5956\u676F", "\u5956\u724C"],
    ["\u6D77\u62A5", "\u5C01\u9762"],
    ["\u7C89\u4E1D", "\u89C2\u4F17"],
    ["\u559C\u5267", "\u95F9\u5267"],
    ["\u7EAA\u5F55\u7247", "\u65B0\u95FB\u7247"],
    ["\u6444\u5F71", "\u6444\u50CF"],
    ["\u8033\u673A", "\u97F3\u7BB1"],
    ["\u6E38\u620F\u673A", "\u7535\u8111"],
    ["\u6251\u514B\u724C", "\u684C\u6E38"],
    ["\u6E38\u4E50\u56ED", "\u7535\u5F71\u9662"],
    ["\u5361\u62C9OK", "\u5F55\u97F3\u68DA"],
    ["\u9884\u544A\u7247", "\u82B1\u7D6E"],
    ["\u4E3B\u89D2", "\u914D\u89D2"],
    ["\u7F16\u5267", "\u4F5C\u5BB6"],
    ["\u4E50\u961F", "\u5408\u5531\u56E2"],
    ["\u5355\u66F2", "\u4E13\u8F91"],
    ["\u6C11\u8C23", "\u6447\u6EDA"],
    ["\u8BF4\u5531", "\u8131\u53E3\u79C0"],
    ["\u7535\u5F71\u9662", "\u5267\u9662"],
    ["\u5F39\u5E55", "\u8BC4\u8BBA"],
    ["\u76F4\u64AD", "\u5F55\u64AD"],
    ["\u624B\u529E", "\u6A21\u578B"],
    ["\u95EF\u5173\u6E38\u620F", "\u89E3\u8C1C\u6E38\u620F"],
    ["\u7247\u5934\u66F2", "\u7247\u5C3E\u66F2"],
    ["\u9009\u79C0", "\u6BD4\u8D5B"],
    ["\u9881\u5956\u793C", "\u9996\u6620\u793C"],
    ["\u77ED\u89C6\u9891", "\u5FAE\u7535\u5F71"],
    ["\u7EFC\u827A", "\u771F\u4EBA\u79C0"],
    ["\u5F71\u8BC4", "\u4E66\u8BC4"],
    ["\u5B57\u5E55", "\u65C1\u767D"],
    ["\u7968\u623F", "\u6536\u89C6\u7387"],
    ["\u9996\u64AD", "\u91CD\u6620"],
    ["\u5F69\u6392", "\u8BD5\u955C"],
    ["\u821E\u53F0\u5267", "\u97F3\u4E50\u5267"],
    ["\u4EA4\u54CD\u4E50", "\u5BA4\u5185\u4E50"],
    ["\u5C0F\u63D0\u7434", "\u5927\u63D0\u7434"],
    ["\u67B6\u5B50\u9F13", "\u624B\u9F13"],
    ["\u7D20\u63CF", "\u6C34\u5F69"],
    ["\u6CB9\u753B", "\u58C1\u753B"],
    ["\u68CB\u7C7B", "\u724C\u7C7B"],
    ["\u5BC6\u5BA4\u9003\u8131", "\u5267\u672C\u6740"],
    ["\u89D2\u8272\u626E\u6F14", "\u821E\u53F0\u8868\u6F14"],
    ["\u526A\u8F91", "\u7279\u6548"],
    ["\u9EA6\u514B\u98CE", "\u6269\u97F3\u5668"],
    ["\u7B7E\u540D\u7167", "\u7EAA\u5FF5\u518C"],
    ["\u7247\u573A", "\u6F14\u64AD\u5385"]
  ]),
  ...pairs("food", [
    ["\u725B\u5976", "\u8C46\u6D46"],
    ["\u5496\u5561", "\u5976\u8336"],
    ["\u5305\u5B50", "\u997A\u5B50"],
    ["\u9984\u9968", "\u6C64\u5706"],
    ["\u7C73\u996D", "\u7CA5"],
    ["\u9762\u5305", "\u86CB\u7CD5"],
    ["\u997C\u5E72", "\u85AF\u7247"],
    ["\u706B\u9505", "\u9EBB\u8FA3\u70EB"],
    ["\u70E7\u70E4", "\u94C1\u677F\u70E7"],
    ["\u6C49\u5821", "\u4E09\u660E\u6CBB"],
    ["\u62AB\u8428", "\u9985\u997C"],
    ["\u62C9\u9762", "\u7C73\u7EBF"],
    ["\u51C9\u76AE", "\u51C9\u9762"],
    ["\u8C46\u8150\u8111", "\u8C46\u82B1"],
    ["\u6CB9\u6761", "\u9EBB\u82B1"],
    ["\u51B0\u6DC7\u6DCB", "\u96EA\u7CD5"],
    ["\u679C\u51BB", "\u5E03\u4E01"],
    ["\u5DE7\u514B\u529B", "\u592A\u5983\u7CD6"],
    ["\u82F9\u679C", "\u68A8"],
    ["\u6A59\u5B50", "\u6A58\u5B50"],
    ["\u8461\u8404", "\u63D0\u5B50"],
    ["\u897F\u74DC", "\u54C8\u5BC6\u74DC"],
    ["\u8349\u8393", "\u6A31\u6843"],
    ["\u83E0\u841D", "\u8292\u679C"],
    ["\u8354\u679D", "\u9F99\u773C"],
    ["\u767D\u83DC", "\u751F\u83DC"],
    ["\u571F\u8C46", "\u7EA2\u85AF"],
    ["\u9999\u83DC", "\u82B9\u83DC"],
    ["\u9E21\u817F", "\u9E21\u7FC5"],
    ["\u725B\u8089\u5E72", "\u732A\u8089\u812F"],
    ["\u9C7C\u4E38", "\u8089\u4E38"],
    ["\u756A\u8304\u9171", "\u8FA3\u6912\u9171"],
    ["\u9171\u6CB9", "\u918B"],
    ["\u767D\u7CD6", "\u51B0\u7CD6"],
    ["\u8702\u871C", "\u7CD6\u6D46"],
    ["\u5564\u9152", "\u6C7D\u6C34"],
    ["\u7EA2\u9152", "\u8461\u8404\u6C41"],
    ["\u6A59\u6C41", "\u67E0\u6AAC\u6C34"],
    ["\u65E9\u9910", "\u591C\u5BB5"],
    ["\u98DF\u5802", "\u9910\u5385"],
    ["\u5C0F\u7B3C\u5305", "\u704C\u6C64\u5305"],
    ["\u714E\u997C", "\u624B\u6293\u997C"],
    ["\u7092\u996D", "\u76D6\u996D"],
    ["\u7092\u9762", "\u7116\u9762"],
    ["\u5E74\u7CD5", "\u7CCD\u7C91"],
    ["\u7CBD\u5B50", "\u996D\u56E2"],
    ["\u70E4\u9E2D", "\u70E7\u9E45"],
    ["\u70B8\u9E21", "\u9E21\u6392"],
    ["\u725B\u6392", "\u732A\u6392"],
    ["\u706B\u817F", "\u9999\u80A0"],
    ["\u86CB\u631E", "\u6CE1\u8299"],
    ["\u751C\u751C\u5708", "\u8D1D\u679C"],
    ["\u66F2\u5947", "\u82CF\u6253\u997C\u5E72"],
    ["\u74DC\u5B50", "\u82B1\u751F"],
    ["\u6838\u6843", "\u677F\u6817"],
    ["\u9EC4\u74DC", "\u4E1D\u74DC"],
    ["\u8611\u83C7", "\u6728\u8033"],
    ["\u6843\u5B50", "\u674F\u5B50"],
    ["\u6930\u5B50", "\u69B4\u83B2"],
    ["\u8336\u53F6\u86CB", "\u5364\u86CB"]
  ]),
  ...pairs("daily", [
    ["\u7259\u5237", "\u68B3\u5B50"],
    ["\u6BDB\u5DFE", "\u6D74\u5DFE"],
    ["\u6C34\u676F", "\u4FDD\u6E29\u676F"],
    ["\u96E8\u4F1E", "\u96E8\u8863"],
    ["\u62D6\u978B", "\u51C9\u978B"],
    ["\u6C99\u53D1", "\u5E8A"],
    ["\u51B0\u7BB1", "\u51B0\u67DC"],
    ["\u6D17\u8863\u673A", "\u70D8\u5E72\u673A"],
    ["\u5FAE\u6CE2\u7089", "\u70E4\u7BB1"],
    ["\u83DC\u5200", "\u526A\u5200"],
    ["\u7B77\u5B50", "\u5438\u7BA1"],
    ["\u76D8\u5B50", "\u6258\u76D8"],
    ["\u80A5\u7682", "\u6D17\u624B\u6DB2"],
    ["\u7259\u818F", "\u6D17\u9762\u5976"],
    ["\u6795\u5934", "\u9760\u57AB"],
    ["\u94A5\u5319", "\u95E8\u5361"],
    ["\u94B1\u5305", "\u5361\u5305"],
    ["\u516C\u4EA4\u8F66", "\u5730\u94C1"],
    ["\u8D85\u5E02", "\u4FBF\u5229\u5E97"],
    ["\u5916\u5356", "\u5FEB\u9012"],
    ["\u886C\u886B", "\u5916\u5957"],
    ["\u4E66\u5305", "\u884C\u674E\u7BB1"],
    ["\u53F0\u706F", "\u624B\u7535\u7B52"],
    ["\u7A97\u5E18", "\u767E\u53F6\u7A97"],
    ["\u626B\u628A", "\u62D6\u628A"],
    ["\u5783\u573E\u6876", "\u6536\u7EB3\u7BB1"],
    ["\u8863\u67B6", "\u667E\u8863\u6746"],
    ["\u63D2\u5EA7", "\u5145\u7535\u5668"],
    ["\u9065\u63A7\u5668", "\u6E38\u620F\u624B\u67C4"],
    ["\u95E8\u94C3", "\u95F9\u949F"],
    ["\u7535\u98CE\u6247", "\u7A7A\u8C03"],
    ["\u5439\u98CE\u673A", "\u5377\u53D1\u68D2"],
    ["\u6D17\u53D1\u6C34", "\u6C90\u6D74\u9732"],
    ["\u955C\u5B50", "\u73BB\u7483"],
    ["\u51B0\u888B", "\u70ED\u6C34\u888B"],
    ["\u53E3\u7F69", "\u773C\u7F69"],
    ["\u7EB8\u5DFE", "\u6E7F\u5DFE"],
    ["\u7535\u68AF", "\u6276\u68AF"],
    ["\u9633\u53F0", "\u9732\u53F0"],
    ["\u83DC\u5E02\u573A", "\u5546\u573A"],
    ["\u6D17\u7897\u673A", "\u6D88\u6BD2\u67DC"],
    ["\u7535\u996D\u7172", "\u538B\u529B\u9505"],
    ["\u69A8\u6C41\u673A", "\u8C46\u6D46\u673A"],
    ["\u7827\u677F", "\u6258\u76D8"],
    ["\u9505\u94F2", "\u6C64\u52FA"],
    ["\u88AB\u5B50", "\u6BEF\u5B50"],
    ["\u5E8A\u5355", "\u684C\u5E03"],
    ["\u8863\u67DC", "\u978B\u67DC"],
    ["\u62BD\u5C49", "\u67DC\u95E8"],
    ["\u95E8\u628A\u624B", "\u6C34\u9F99\u5934"],
    ["\u6D17\u8863\u7C89", "\u67D4\u987A\u5242"],
    ["\u521B\u53EF\u8D34", "\u80F6\u5E03"],
    ["\u4F53\u6E29\u8BA1", "\u7535\u5B50\u79E4"],
    ["\u6307\u7532\u5200", "\u5243\u987B\u5200"],
    ["\u53D1\u5939", "\u522B\u9488"],
    ["\u624B\u673A\u58F3", "\u4FDD\u62A4\u819C"],
    ["\u6570\u636E\u7EBF", "\u8033\u673A\u7EBF"],
    ["\u8D2D\u7269\u888B", "\u5783\u573E\u888B"],
    ["\u697C\u68AF", "\u8D70\u5ECA"],
    ["\u5BA2\u5385", "\u9910\u5385"]
  ]),
  ...pairs("nature", [
    ["\u592A\u9633", "\u6708\u4EAE"],
    ["\u661F\u661F", "\u8424\u706B\u866B"],
    ["\u4E91\u6735", "\u96FE"],
    ["\u95EA\u7535", "\u6D41\u661F"],
    ["\u53F0\u98CE", "\u9F99\u5377\u98CE"],
    ["\u5C0F\u96E8", "\u9635\u96E8"],
    ["\u96EA\u82B1", "\u51B0\u96F9"],
    ["\u5F69\u8679", "\u6781\u5149"],
    ["\u5C71\u5CF0", "\u5C71\u4E18"],
    ["\u5CE1\u8C37", "\u5C71\u6D1E"],
    ["\u6CB3\u6D41", "\u5C0F\u6EAA"],
    ["\u6E56\u6CCA", "\u6C60\u5858"],
    ["\u6D77\u6D0B", "\u6C99\u6EE9"],
    ["\u7011\u5E03", "\u55B7\u6CC9"],
    ["\u68EE\u6797", "\u8349\u539F"],
    ["\u6C99\u6F20", "\u8352\u539F"],
    ["\u706B\u5C71", "\u6E29\u6CC9"],
    ["\u5CA9\u77F3", "\u9E45\u5375\u77F3"],
    ["\u6CE5\u571F", "\u6C99\u5B50"],
    ["\u7AF9\u6797", "\u6811\u6797"],
    ["\u8377\u82B1", "\u7761\u83B2"],
    ["\u73AB\u7470", "\u6708\u5B63"],
    ["\u6885\u82B1", "\u6843\u82B1"],
    ["\u84B2\u516C\u82F1", "\u5411\u65E5\u8475"],
    ["\u4ED9\u4EBA\u638C", "\u82A6\u835F"],
    ["\u677E\u6811", "\u67CF\u6811"],
    ["\u67AB\u53F6", "\u94F6\u674F\u53F6"],
    ["\u9732\u73E0", "\u96E8\u6EF4"],
    ["\u6811\u679D", "\u85E4\u8513"],
    ["\u8D1D\u58F3", "\u73CA\u745A"],
    ["\u6D77\u6D6A", "\u6F6E\u6C50"],
    ["\u65E5\u51FA", "\u65E5\u843D"],
    ["\u6625\u5929", "\u79CB\u5929"],
    ["\u6E05\u6668", "\u9EC4\u660F"],
    ["\u5FAE\u98CE", "\u5BD2\u98CE"],
    ["\u5C9B\u5C7F", "\u534A\u5C9B"],
    ["\u7A3B\u7530", "\u9EA6\u7530"],
    ["\u679C\u56ED", "\u83DC\u56ED"],
    ["\u6CBC\u6CFD", "\u6E7F\u5730"],
    ["\u51B0\u5DDD", "\u96EA\u5C71"],
    ["\u96F7\u58F0", "\u98CE\u58F0"],
    ["\u971C", "\u9732\u6C34"],
    ["\u6668\u96FE", "\u708A\u70DF"],
    ["\u6708\u7259", "\u6EE1\u6708"],
    ["\u94F6\u6CB3", "\u661F\u5EA7"],
    ["\u60AC\u5D16", "\u5CED\u58C1"],
    ["\u76C6\u5730", "\u5E73\u539F"],
    ["\u5C71\u8C37", "\u6CB3\u8C37"],
    ["\u6CC9\u6C34", "\u4E95\u6C34"],
    ["\u6E56\u5FC3\u5C9B", "\u7901\u77F3"],
    ["\u82A6\u82C7", "\u7AF9\u5B50"],
    ["\u82D4\u85D3", "\u8349\u576A"],
    ["\u83CA\u82B1", "\u7261\u4E39"],
    ["\u6A31\u82B1", "\u674F\u82B1"],
    ["\u67F3\u6811", "\u6768\u6811"],
    ["\u677E\u679C", "\u6A61\u679C"],
    ["\u82B1\u74E3", "\u53F6\u7247"],
    ["\u6811\u6839", "\u6811\u6869"],
    ["\u9E1F\u5DE2", "\u8702\u5DE2"],
    ["\u671D\u971E", "\u665A\u971E"]
  ]),
  ...pairs("campus", [
    ["\u8001\u5E08", "\u73ED\u4E3B\u4EFB"],
    ["\u540C\u5B66", "\u540C\u684C"],
    ["\u6821\u957F", "\u6559\u5BFC\u4E3B\u4EFB"],
    ["\u5B66\u751F\u4F1A", "\u73ED\u59D4"],
    ["\u6559\u5BA4", "\u81EA\u4E60\u5BA4"],
    ["\u56FE\u4E66\u9986", "\u4E66\u5E97"],
    ["\u98DF\u5802", "\u5C0F\u5356\u90E8"],
    ["\u64CD\u573A", "\u4F53\u80B2\u9986"],
    ["\u5BBF\u820D", "\u516C\u5BD3"],
    ["\u9ED1\u677F", "\u767D\u677F"],
    ["\u7C89\u7B14", "\u767D\u677F\u7B14"],
    ["\u94C5\u7B14", "\u81EA\u52A8\u94C5\u7B14"],
    ["\u94A2\u7B14", "\u5706\u73E0\u7B14"],
    ["\u6A61\u76AE", "\u4FEE\u6B63\u5E26"],
    ["\u5C3A\u5B50", "\u91CF\u89D2\u5668"],
    ["\u4E66\u5305", "\u6587\u5177\u76D2"],
    ["\u8BFE\u672C", "\u7EC3\u4E60\u518C"],
    ["\u4F5C\u6587", "\u8BBA\u6587"],
    ["\u8003\u8BD5", "\u6D4B\u9A8C"],
    ["\u4F5C\u4E1A", "\u8BD5\u5377"],
    ["\u4E0A\u8BFE", "\u8865\u8BFE"],
    ["\u9884\u4E60", "\u590D\u4E60"],
    ["\u8FDF\u5230", "\u65E9\u9000"],
    ["\u8BF7\u5047", "\u65F7\u8BFE"],
    ["\u6BD5\u4E1A", "\u7ED3\u4E1A"],
    ["\u6821\u670D", "\u73ED\u670D"],
    ["\u5956\u72B6", "\u8BC1\u4E66"],
    ["\u5B66\u8D39", "\u751F\u6D3B\u8D39"],
    ["\u8BB2\u53F0", "\u8BFE\u684C"],
    ["\u8BFE\u7A0B\u8868", "\u503C\u65E5\u8868"],
    ["\u5E7F\u64AD\u7AD9", "\u793E\u56E2"],
    ["\u8FD0\u52A8\u4F1A", "\u6821\u5E86"],
    ["\u5347\u65D7", "\u65E9\u64CD"],
    ["\u6625\u6E38", "\u7814\u5B66"],
    ["\u5B9E\u9A8C\u5BA4", "\u673A\u623F"],
    ["\u9009\u62E9\u9898", "\u5224\u65AD\u9898"],
    ["\u8349\u7A3F\u7EB8", "\u7B54\u9898\u5361"],
    ["\u5BB6\u957F\u4F1A", "\u73ED\u4F1A"],
    ["\u5B66\u9738", "\u8BFE\u4EE3\u8868"],
    ["\u6BD5\u4E1A\u7167", "\u5B66\u751F\u8BC1"],
    ["\u8BED\u6587\u8BFE", "\u82F1\u8BED\u8BFE"],
    ["\u6570\u5B66\u9898", "\u7269\u7406\u9898"],
    ["\u5386\u53F2\u4E66", "\u5730\u7406\u4E66"],
    ["\u542C\u5199", "\u9ED8\u5199"],
    ["\u6717\u8BFB", "\u80CC\u8BF5"],
    ["\u5C0F\u7EC4\u8BA8\u8BBA", "\u8BFE\u5802\u63D0\u95EE"],
    ["\u8BFE\u5802\u7B14\u8BB0", "\u9519\u9898\u672C"],
    ["\u671F\u4E2D\u8003\u8BD5", "\u671F\u672B\u8003\u8BD5"],
    ["\u5F00\u5B66\u5178\u793C", "\u6BD5\u4E1A\u5178\u793C"],
    ["\u5165\u5B66\u901A\u77E5\u4E66", "\u5F55\u53D6\u901A\u77E5\u4E66"],
    ["\u6821\u95E8", "\u5BBF\u820D\u95E8"],
    ["\u95E8\u536B", "\u5BBF\u7BA1"],
    ["\u4E0A\u94FA", "\u4E0B\u94FA"],
    ["\u996D\u5361", "\u501F\u4E66\u5361"],
    ["\u6821\u5FBD", "\u961F\u5FBD"],
    ["\u5706\u89C4", "\u4E09\u89D2\u5C3A"],
    ["\u8BA2\u4E66\u673A", "\u6253\u5B54\u5668"],
    ["\u58A8\u6C34", "\u5370\u6CE5"],
    ["\u5B9E\u9A8C\u62A5\u544A", "\u8BFB\u4E66\u7B14\u8BB0"],
    ["\u8FA9\u8BBA\u8D5B", "\u6F14\u8BB2\u6BD4\u8D5B"]
  ]),
  ...pairs("sports", [
    ["\u8DB3\u7403", "\u7BEE\u7403"],
    ["\u6392\u7403", "\u7FBD\u6BDB\u7403"],
    ["\u4E52\u4E53\u7403", "\u7F51\u7403"],
    ["\u68D2\u7403", "\u5792\u7403"],
    ["\u6A44\u6984\u7403", "\u624B\u7403"],
    ["\u6ED1\u96EA", "\u6ED1\u51B0"],
    ["\u6E38\u6CF3", "\u6F5C\u6C34"],
    ["\u8DD1\u6B65", "\u7ADE\u8D70"],
    ["\u8DF3\u9AD8", "\u8DF3\u8FDC"],
    ["\u4F53\u64CD", "\u745C\u4F3D"],
    ["\u62F3\u51FB", "\u6563\u6253"],
    ["\u51FB\u5251", "\u5C04\u7BAD"],
    ["\u6500\u5CA9", "\u767B\u5C71"],
    ["\u51B2\u6D6A", "\u5E06\u8239"],
    ["\u8D5B\u8F66", "\u5361\u4E01\u8F66"],
    ["\u5355\u6760", "\u53CC\u6760"],
    ["\u54D1\u94C3", "\u6760\u94C3"],
    ["\u8DD1\u6B65\u673A", "\u52A8\u611F\u5355\u8F66"],
    ["\u7403\u62CD", "\u7403\u6746"],
    ["\u7403\u95E8", "\u7BEE\u7B50"],
    ["\u88C1\u5224", "\u6559\u7EC3"],
    ["\u961F\u957F", "\u5B88\u95E8\u5458"],
    ["\u51A0\u519B", "\u7B2C\u4E00\u540D"],
    ["\u5956\u676F", "\u91D1\u724C"],
    ["\u51B3\u8D5B", "\u52A0\u65F6\u8D5B"],
    ["\u72AF\u89C4", "\u8D8A\u4F4D"],
    ["\u4F20\u7403", "\u6295\u7BEE"],
    ["\u53D1\u7403", "\u6263\u7403"],
    ["\u70ED\u8EAB", "\u62C9\u4F38"],
    ["\u8BAD\u7EC3", "\u6BD4\u8D5B"],
    ["\u9A6C\u62C9\u677E", "\u63A5\u529B\u8D5B"],
    ["\u8FD0\u52A8\u978B", "\u9489\u978B"],
    ["\u6CF3\u955C", "\u62A4\u76EE\u955C"],
    ["\u5934\u76D4", "\u62A4\u819D"],
    ["\u770B\u53F0", "\u9886\u5956\u53F0"],
    ["\u4E3B\u573A", "\u5BA2\u573A"],
    ["\u5566\u5566\u961F", "\u89C2\u4F17\u5E2D"],
    ["\u5065\u8EAB\u623F", "\u4F53\u80B2\u9986"],
    ["\u5E73\u5C40", "\u9006\u8F6C"],
    ["\u54E8\u5B50", "\u53D1\u4EE4\u67AA"],
    ["\u81EA\u7531\u6CF3", "\u86D9\u6CF3"],
    ["\u4EF0\u6CF3", "\u8776\u6CF3"],
    ["\u957F\u8DD1", "\u77ED\u8DD1"],
    ["\u8DE8\u680F", "\u969C\u788D\u8D5B"],
    ["\u94C5\u7403", "\u94C1\u997C"],
    ["\u8DF3\u6C34", "\u82B1\u6837\u6E38\u6CF3"],
    ["\u6ED1\u677F", "\u8F6E\u6ED1"],
    ["\u76AE\u5212\u8247", "\u8D5B\u8247"],
    ["\u8DC6\u62F3\u9053", "\u7A7A\u624B\u9053"],
    ["\u67D4\u9053", "\u6454\u8DE4"],
    ["\u9AD8\u5C14\u592B", "\u53F0\u7403"],
    ["\u767B\u5C71\u6756", "\u6ED1\u96EA\u6756"],
    ["\u6CF3\u5E3D", "\u6CF3\u88E4"],
    ["\u7403\u8863", "\u961F\u670D"],
    ["\u8BA1\u5206\u724C", "\u8BB0\u5206\u518C"],
    ["\u534A\u51B3\u8D5B", "\u6DD8\u6C70\u8D5B"],
    ["\u5F00\u5E55\u5F0F", "\u95ED\u5E55\u5F0F"],
    ["\u9881\u5956", "\u9886\u5956"],
    ["\u52A9\u653B", "\u62A2\u65AD"],
    ["\u6682\u505C", "\u4E2D\u573A\u4F11\u606F"]
  ]),
  ...pairs("travel", [
    ["\u98DE\u673A", "\u9AD8\u94C1"],
    ["\u5730\u94C1", "\u8F7B\u8F68"],
    ["\u516C\u4EA4\u8F66", "\u5927\u5DF4"],
    ["\u51FA\u79DF\u8F66", "\u7F51\u7EA6\u8F66"],
    ["\u8F6E\u8239", "\u6E38\u8247"],
    ["\u81EA\u884C\u8F66", "\u7535\u52A8\u8F66"],
    ["\u8F66\u7AD9", "\u673A\u573A"],
    ["\u7801\u5934", "\u6E2F\u53E3"],
    ["\u62A4\u7167", "\u8EAB\u4EFD\u8BC1"],
    ["\u8F66\u7968", "\u767B\u673A\u724C"],
    ["\u5730\u56FE", "\u5BFC\u822A"],
    ["\u6307\u5357\u9488", "\u8DEF\u6807"],
    ["\u80CC\u5305", "\u884C\u674E\u7BB1"],
    ["\u5E10\u7BF7", "\u7761\u888B"],
    ["\u9152\u5E97", "\u6C11\u5BBF"],
    ["\u65C5\u9986", "\u9752\u65C5"],
    ["\u666F\u533A", "\u516C\u56ED"],
    ["\u535A\u7269\u9986", "\u5C55\u89C8\u9986"],
    ["\u53E4\u9547", "\u8001\u8857"],
    ["\u5BFA\u5E99", "\u6559\u5802"],
    ["\u5BFC\u6E38", "\u9886\u961F"],
    ["\u6E38\u5BA2", "\u80CC\u5305\u5BA2"],
    ["\u8DDF\u56E2\u6E38", "\u81EA\u7531\u884C"],
    ["\u51FA\u5DEE", "\u65C5\u884C"],
    ["\u8FDC\u8DB3", "\u9732\u8425"],
    ["\u91CE\u9910", "\u70E7\u70E4"],
    ["\u7EAA\u5FF5\u54C1", "\u7279\u4EA7"],
    ["\u660E\u4FE1\u7247", "\u8D3A\u5361"],
    ["\u76F8\u673A", "\u671B\u8FDC\u955C"],
    ["\u7167\u7247", "\u89C6\u9891"],
    ["\u5C71\u9876", "\u89C2\u666F\u53F0"],
    ["\u7F06\u8F66", "\u6469\u5929\u8F6E"],
    ["\u65E5\u51FA", "\u665A\u971E"],
    ["\u8FF7\u8DEF", "\u7ED5\u8DEF"],
    ["\u51FA\u53D1", "\u8FD4\u7A0B"],
    ["\u5019\u673A", "\u5019\u8F66"],
    ["\u5B89\u68C0", "\u68C0\u7968"],
    ["\u4E2D\u8F6C", "\u6362\u4E58"],
    ["\u5355\u7A0B\u7968", "\u5F80\u8FD4\u7968"],
    ["\u56FD\u5185\u6E38", "\u51FA\u5883\u6E38"],
    ["\u822A\u73ED", "\u5217\u8F66"],
    ["\u7ECF\u6D4E\u8231", "\u5546\u52A1\u8231"],
    ["\u9760\u7A97\u5EA7", "\u8FC7\u9053\u5EA7"],
    ["\u884C\u674E\u67B6", "\u540E\u5907\u7BB1"],
    ["\u767B\u673A\u53E3", "\u68C0\u7968\u53E3"],
    ["\u51FA\u53D1\u5385", "\u5230\u8FBE\u5385"],
    ["\u9AD8\u901F\u516C\u8DEF", "\u56FD\u9053"],
    ["\u5341\u5B57\u8DEF\u53E3", "\u73AF\u5C9B"],
    ["\u670D\u52A1\u533A", "\u4F11\u606F\u7AD9"],
    ["\u52A0\u6CB9\u7AD9", "\u5145\u7535\u7AD9"],
    ["\u65C5\u6E38\u653B\u7565", "\u884C\u7A0B\u5355"],
    ["\u65C5\u884C\u56E2", "\u81EA\u9A7E\u6E38"],
    ["\u57CE\u5E02\u6E38", "\u4E61\u6751\u6E38"],
    ["\u6C11\u4FD7\u6751", "\u5EA6\u5047\u6751"],
    ["\u52A8\u7269\u56ED", "\u690D\u7269\u56ED"],
    ["\u6D77\u5C9B", "\u6E56\u5FC3\u5C9B"],
    ["\u5C71\u8DEF", "\u6808\u9053"],
    ["\u5E10\u7BF7", "\u623F\u8F66"],
    ["\u7BDD\u706B", "\u8425\u706F"],
    ["\u9632\u6652\u971C", "\u9A71\u868A\u6C34"]
  ]),
  ...pairs("nsfw", [
    ["\u7EA6\u4F1A", "\u76F8\u4EB2"],
    ["\u66A7\u6627", "\u6697\u604B"],
    ["\u62E5\u62B1", "\u63A5\u543B"],
    ["\u60C5\u4E66", "\u79C1\u4FE1"],
    ["\u9999\u6C34", "\u4F53\u9999"],
    ["\u7761\u8863", "\u6D74\u888D"],
    ["\u53CC\u4EBA\u5E8A", "\u6C99\u53D1\u5E8A"],
    ["\u7EA2\u9152", "\u9999\u69DF"],
    ["\u70DB\u5149\u665A\u9910", "\u5348\u591C\u5BB5\u591C"],
    ["\u60C5\u4FA3\u88C5", "\u7761\u8863\u6D3E\u5BF9"],
    ["\u6309\u6469\u6CB9", "\u8EAB\u4F53\u4E73"],
    ["\u857E\u4E1D", "\u4E1D\u7EF8"],
    ["\u773C\u7F69", "\u9762\u5177"],
    ["\u624B\u94D0", "\u624B\u94FE"],
    ["\u9886\u5E26", "\u9879\u5708"],
    ["\u6210\u4EBA\u73A9\u5177", "\u6309\u6469\u5668"],
    ["\u60C5\u4FA3\u5F71\u9662", "\u79C1\u4EBA\u5F71\u5385"],
    ["\u871C\u6708", "\u5EA6\u5047"],
    ["\u524D\u4EFB", "\u521D\u604B"],
    ["\u60C5\u4EBA\u8282", "\u7EAA\u5FF5\u65E5"],
    ["\u5FC3\u8DF3", "\u8138\u7EA2"],
    ["\u8C03\u60C5", "\u6492\u5A07"],
    ["\u79D8\u5BC6\u5173\u7CFB", "\u516C\u5F00\u604B\u60C5"],
    ["\u5E8A\u5934\u706F", "\u6C1B\u56F4\u706F"],
    ["\u6DF1\u591C\u7535\u8BDD", "\u8BED\u97F3\u7559\u8A00"],
    ["\u5355\u8EAB", "\u5931\u604B"],
    ["\u6C42\u5A5A", "\u544A\u767D"],
    ["\u604B\u4EBA", "\u4F34\u4FA3"],
    ["\u7275\u624B", "\u633D\u624B"],
    ["\u58C1\u549A", "\u516C\u4E3B\u62B1"],
    ["\u5403\u918B", "\u5BB3\u7F9E"],
    ["\u5FC3\u52A8", "\u4E0A\u5934"],
    ["\u51B7\u6218", "\u5206\u624B"],
    ["\u590D\u5408", "\u548C\u597D"],
    ["\u5A5A\u793C", "\u8BA2\u5A5A\u5BB4"],
    ["\u6212\u6307", "\u9879\u94FE"],
    ["\u73AB\u7470\u82B1", "\u5DE7\u514B\u529B"],
    ["\u7EA6\u4F1A\u8F6F\u4EF6", "\u901A\u8BAF\u5F55"],
    ["\u665A\u5B89\u543B", "\u65E9\u5B89\u6D88\u606F"],
    ["\u604B\u7231\u8111", "\u989C\u63A7"],
    ["\u60C5\u4FA3\u5934\u50CF", "\u5408\u7167"],
    ["\u604B\u7231\u65E5\u8BB0", "\u804A\u5929\u8BB0\u5F55"],
    ["\u60CA\u559C\u793C\u7269", "\u7EAA\u5FF5\u793C\u7269"],
    ["\u7EA6\u4F1A\u9910\u5385", "\u6E05\u5427"],
    ["\u7535\u5F71\u7968", "\u6F14\u5531\u4F1A\u7968"],
    ["\u5A5A\u7EB1", "\u793C\u670D"],
    ["\u4F34\u90CE", "\u4F34\u5A18"],
    ["\u6367\u82B1", "\u80F8\u82B1"],
    ["\u8A93\u8A00", "\u60C5\u8BDD"],
    ["\u5A92\u4EBA", "\u7EA2\u5A18"],
    ["\u7F51\u604B", "\u5F02\u5730\u604B"],
    ["\u95EA\u5A5A", "\u9690\u5A5A"],
    ["\u5BF9\u8C61", "\u6697\u604B\u5BF9\u8C61"],
    ["\u5B89\u5168\u611F", "\u5360\u6709\u6B32"],
    ["\u5FC3\u6709\u7075\u7280", "\u4E00\u89C1\u949F\u60C5"],
    ["\u6B32\u64D2\u6545\u7EB5", "\u82E5\u5373\u82E5\u79BB"],
    ["\u751C\u8A00\u871C\u8BED", "\u571F\u5473\u60C5\u8BDD"],
    ["\u6D6A\u6F2B", "\u6FC0\u60C5"],
    ["\u72EC\u5904", "\u4E8C\u4EBA\u4E16\u754C"],
    ["\u6795\u8FB9\u8BDD", "\u6084\u6084\u8BDD"]
  ]),
  ...EXTRA_WORD_PAIRS
];

// src/worker.ts
var CHAT_LIMIT = 80;
var TEXT_MAX = 200;
var TRANSITION_MS = 1500;
var currentDeal = null;
var usedPairIds = /* @__PURE__ */ new Set();
var msgSeq = 0;
function syncPlayers(ctx) {
  ctx.state.hostId = ctx.host?.id ?? null;
  ctx.state.players = ctx.players.filter((player) => player.role !== "spectator").map(({ id, name, role }) => ({ id, name, role: role === "host" ? "host" : "player" }));
}
function isHost(ctx, player) {
  return player.id === ctx.host?.id;
}
function sendCard(ctx, playerId) {
  const card = currentDeal?.cards[playerId];
  if (!card) return;
  ctx.send(playerId, "undercover:card", privateCardPayload(card, ctx.state.round));
}
function livingIds(state) {
  const eliminated = new Set(state.eliminatedPlayerIds);
  return state.dealtPlayerIds.filter((id) => !eliminated.has(id));
}
function nameOf(ctx, playerId) {
  return ctx.state.players.find((player) => player.id === playerId)?.name ?? "\u73A9\u5BB6";
}
function normalizeText(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, TEXT_MAX);
}
function pushMessage(ctx, playerId, kind, text) {
  ctx.state.chat.push({ id: `m${msgSeq += 1}`, playerId, name: kind === "system" ? "\u7CFB\u7EDF" : nameOf(ctx, playerId), text, at: Date.now(), kind });
  if (ctx.state.chat.length > CHAT_LIMIT) ctx.state.chat.splice(0, ctx.state.chat.length - CHAT_LIMIT);
}
function pushSystem(ctx, text) {
  ctx.state.chat.push({ id: `m${msgSeq += 1}`, playerId: "", name: "\u7CFB\u7EDF", text, at: Date.now(), kind: "system" });
  if (ctx.state.chat.length > CHAT_LIMIT) ctx.state.chat.splice(0, ctx.state.chat.length - CHAT_LIMIT);
}
function beginSpeaking(ctx) {
  const order = livingSpeakingOrder(ctx.state.dealtPlayerIds, ctx.state.eliminatedPlayerIds, ctx.state.voteRound - 1);
  ctx.state.speakingOrder = order;
  ctx.state.speakingIndex = 0;
  ctx.state.currentSpeakerId = order[0] ?? null;
  ctx.state.spokenPlayerIds = [];
  ctx.state.votes = {};
  ctx.state.voteCandidates = [];
  ctx.state.revoteTied = false;
  ctx.state.notice = null;
  ctx.state.phase = order.length ? "speaking" : "voting";
  if (!order.length) beginVoting(ctx, livingIds(ctx.state), false);
  else pushSystem(ctx, `\u7B2C ${ctx.state.voteRound} \u8F6E\u53D1\u8A00\u5F00\u59CB\uFF0C\u7531 ${nameOf(ctx, order[0])} \u8D77\u59CB\u3002`);
}
function toTransition(ctx) {
  ctx.state.phase = "transition";
  ctx.state.currentSpeakerId = null;
  ctx.state.notice = "\u53D1\u8A00\u7ED3\u675F\uFF0C\u5373\u5C06\u8FDB\u5165\u6295\u7968";
  pushSystem(ctx, "\u5168\u5458\u53D1\u8A00\u5B8C\u6BD5\uFF0C\u5373\u5C06\u6295\u7968\u3002");
  ctx.setTimer("undercover:transition", TRANSITION_MS, () => {
    if (ctx.state.phase !== "transition") return;
    beginVoting(ctx, livingIds(ctx.state), false);
  });
}
function beginVoting(ctx, candidates, isRevote) {
  ctx.state.phase = "voting";
  ctx.state.currentSpeakerId = null;
  ctx.state.votes = {};
  ctx.state.voteCandidates = candidates;
  ctx.state.revoteTied = isRevote;
  ctx.state.notice = isRevote ? "\u5E73\u7968\u91CD\u6295\uFF0C\u4EC5\u53EF\u5728\u5E76\u5217\u8005\u4E2D\u9009\u62E9" : "\u5F00\u59CB\u6295\u7968";
}
function advanceSpeaker(ctx) {
  const order = ctx.state.speakingOrder;
  const eliminated = new Set(ctx.state.eliminatedPlayerIds);
  let index = ctx.state.speakingIndex + 1;
  while (index < order.length && eliminated.has(order[index])) index += 1;
  ctx.state.speakingIndex = index;
  if (index < order.length) ctx.state.currentSpeakerId = order[index];
  else toTransition(ctx);
}
function applyElimination(ctx, targetId) {
  ctx.state.eliminatedPlayerIds.push(targetId);
  ctx.state.lastEliminatedId = targetId;
  pushSystem(ctx, `${nameOf(ctx, targetId)} \u88AB\u6295\u7968\u51FA\u5C40\u3002`);
  const result = resolveElimination(currentDeal, ctx.state.eliminatedPlayerIds);
  if (result.finished) {
    ctx.state.phase = "finished";
    ctx.state.currentSpeakerId = null;
    ctx.state.revealedWords = result.revealedWords;
    ctx.state.winner = result.winner;
    ctx.state.resultHadBlank = result.hadBlank;
    ctx.state.resultHadUndercover = result.hadUndercover;
    pushSystem(ctx, "\u672C\u5C40\u7ED3\u675F\uFF0C\u8EAB\u4EFD\u63ED\u6653\u3002");
    return;
  }
  ctx.state.voteRound += 1;
  beginSpeaking(ctx);
}
function resolveVotingRound(ctx) {
  const living = livingIds(ctx.state);
  const votedCount = living.filter((id) => id in ctx.state.votes).length;
  if (votedCount < living.length) return;
  const outcome = resolveVote(ctx.state.votes, ctx.state.voteCandidates);
  if (outcome.eliminatedId) {
    applyElimination(ctx, outcome.eliminatedId);
    return;
  }
  if (outcome.tie && !ctx.state.revoteTied) {
    pushSystem(ctx, `\u5E73\u7968\uFF08${outcome.leaders.map((id) => nameOf(ctx, id)).join("\u3001")}\uFF09\uFF0C\u5728\u5E76\u5217\u8005\u4E2D\u91CD\u6295\u4E00\u6B21\u3002`);
    beginVoting(ctx, outcome.leaders, true);
    return;
  }
  pushSystem(ctx, "\u672C\u8F6E\u65E0\u4EBA\u51FA\u5C40\uFF0C\u8FDB\u5165\u4E0B\u4E00\u8F6E\u53D1\u8A00\u3002");
  ctx.state.voteRound += 1;
  beginSpeaking(ctx);
}
function handleLeaveDuringGame(ctx, leaverId) {
  if (ctx.state.eliminatedPlayerIds.includes(leaverId)) return;
  ctx.state.eliminatedPlayerIds.push(leaverId);
  delete ctx.state.votes[leaverId];
  pushSystem(ctx, `${nameOf(ctx, leaverId)} \u79BB\u5F00\u4E86\u724C\u5C40\u3002`);
  const result = resolveElimination(currentDeal, ctx.state.eliminatedPlayerIds);
  if (result.finished) {
    ctx.state.phase = "finished";
    ctx.state.currentSpeakerId = null;
    ctx.state.revealedWords = result.revealedWords;
    ctx.state.winner = result.winner;
    ctx.state.resultHadBlank = result.hadBlank;
    ctx.state.resultHadUndercover = result.hadUndercover;
    return;
  }
  if (ctx.state.phase === "speaking" && ctx.state.currentSpeakerId === leaverId) {
    advanceSpeaker(ctx);
  } else if (ctx.state.phase === "voting") {
    ctx.state.voteCandidates = ctx.state.voteCandidates.filter((id) => id !== leaverId);
    resolveVotingRound(ctx);
  }
}
var worker_default = defineRoom({
  meta: { name: "\u8C01\u662F\u5367\u5E95", minPlayers: 3, maxPlayers: 12 },
  initialState() {
    return {
      phase: "waiting",
      hostId: null,
      players: [],
      selectedMode: "classic",
      selectedIncludeBlank: false,
      roundMode: null,
      selectedCategories: ["entertainment", "daily"],
      round: 0,
      voteRound: 0,
      dealtPlayerIds: [],
      eliminatedPlayerIds: [],
      speakingOrder: [],
      speakingIndex: 0,
      currentSpeakerId: null,
      spokenPlayerIds: [],
      votes: {},
      voteCandidates: [],
      revoteTied: false,
      lastEliminatedId: null,
      chat: [],
      revealedWords: null,
      winner: null,
      resultHadBlank: false,
      resultHadUndercover: false,
      notice: null
    };
  },
  onJoin(ctx) {
    syncPlayers(ctx);
  },
  onLeave(ctx, player) {
    const wasDealtLiving = ctx.state.dealtPlayerIds.includes(player.id) && !ctx.state.eliminatedPlayerIds.includes(player.id);
    const active = ctx.state.phase === "speaking" || ctx.state.phase === "transition" || ctx.state.phase === "voting";
    ctx.state.players = ctx.state.players.filter(({ id }) => id !== player.id);
    if (active && wasDealtLiving && currentDeal) {
      handleLeaveDuringGame(ctx, player.id);
    } else if (!active) {
      ctx.state.dealtPlayerIds = ctx.state.dealtPlayerIds.filter((id) => id !== player.id);
    }
  },
  onReconnect(ctx, player) {
    syncPlayers(ctx);
    sendCard(ctx, player.id);
  },
  onRestore(ctx) {
    currentDeal = null;
    usedPairIds.clear();
    ctx.state.phase = "waiting";
    ctx.state.round = 0;
    ctx.state.voteRound = 0;
    ctx.state.dealtPlayerIds = [];
    ctx.state.eliminatedPlayerIds = [];
    ctx.state.speakingOrder = [];
    ctx.state.speakingIndex = 0;
    ctx.state.currentSpeakerId = null;
    ctx.state.spokenPlayerIds = [];
    ctx.state.votes = {};
    ctx.state.voteCandidates = [];
    ctx.state.revoteTied = false;
    ctx.state.lastEliminatedId = null;
    ctx.state.chat = [];
    ctx.state.revealedWords = null;
    ctx.state.winner = null;
    ctx.state.resultHadBlank = false;
    ctx.state.resultHadUndercover = false;
    ctx.state.roundMode = null;
    ctx.state.notice = "\u623F\u95F4\u5DF2\u6062\u590D\uFF0C\u8BF7\u623F\u4E3B\u91CD\u65B0\u53D1\u724C";
    syncPlayers(ctx);
  },
  actions: {
    "settings:setMode"(ctx, event) {
      if (!isHost(ctx, event.player)) return;
      const mode = event.payload?.mode;
      if (mode !== "classic" && mode !== "custom") return;
      ctx.state.selectedMode = mode;
      ctx.state.notice = null;
    },
    "settings:setIncludeBlank"(ctx, event) {
      if (!isHost(ctx, event.player)) return;
      const enabled = event.payload?.enabled;
      if (typeof enabled !== "boolean") return;
      ctx.state.selectedIncludeBlank = enabled;
      ctx.state.notice = null;
    },
    "settings:setCategories"(ctx, event) {
      if (!isHost(ctx, event.player)) return;
      const payload = event.payload;
      const categories = normalizeCategories(payload?.categories);
      if (!categories) return;
      ctx.state.selectedCategories = categories;
      ctx.state.notice = null;
    },
    "round:deal"(ctx, event) {
      if (!isHost(ctx, event.player)) return;
      const mode = ctx.state.selectedMode;
      const playerIds = participantIds(ctx.players, mode);
      if (playerIds.length < 3) {
        ctx.state.notice = mode === "classic" ? "\u81F3\u5C11\u9700\u8981 3 \u540D\u73A9\u5BB6\u624D\u80FD\u53D1\u724C" : "\u4E3B\u6301\u6A21\u5F0F\u81F3\u5C11\u9700\u8981 3 \u540D\u975E\u623F\u4E3B\u73A9\u5BB6";
        return;
      }
      if (mode === "custom") {
        const words = normalizeCustomWords(event.payload);
        if (!words) {
          ctx.state.notice = "\u8BF7\u586B\u5199\u4E24\u4E2A\u4E0D\u540C\u4E14\u4E0D\u8D85\u8FC7 20 \u4E2A\u5B57\u7684\u81EA\u5B9A\u4E49\u8BCD\u8BED";
          return;
        }
        currentDeal = dealCardsWithWords(playerIds, words, () => ctx.random(), ctx.state.selectedIncludeBlank);
      } else {
        const candidates = eligiblePairs(WORD_PAIRS, ctx.state.selectedCategories);
        const { pair, reset } = choosePair(candidates, usedPairIds, () => ctx.random());
        if (reset) {
          for (const candidate of candidates) usedPairIds.delete(candidate.id);
        }
        usedPairIds.add(pair.id);
        currentDeal = dealCards(playerIds, pair, () => ctx.random(), ctx.state.selectedIncludeBlank);
      }
      ctx.clearTimer("undercover:transition");
      ctx.state.round += 1;
      ctx.state.voteRound = 1;
      ctx.state.roundMode = mode;
      ctx.state.dealtPlayerIds = playerIds;
      ctx.state.eliminatedPlayerIds = [];
      ctx.state.lastEliminatedId = null;
      ctx.state.revealedWords = null;
      ctx.state.winner = null;
      ctx.state.resultHadBlank = false;
      ctx.state.resultHadUndercover = false;
      ctx.state.chat = [];
      ctx.state.notice = null;
      syncPlayers(ctx);
      for (const playerId of playerIds) sendCard(ctx, playerId);
      pushSystem(ctx, `\u7B2C ${ctx.state.round} \u8F6E\u53D1\u724C\u5B8C\u6210\uFF0C${playerIds.length} \u4EBA\u53C2\u4E0E\u3002`);
      beginSpeaking(ctx);
      ctx.log("undercover round dealt", ctx.state.round, playerIds.length);
    },
    speak(ctx, event) {
      if (ctx.state.phase !== "speaking" || ctx.state.currentSpeakerId !== event.player.id) return;
      const text = normalizeText(event.payload?.text);
      if (!text) return;
      pushMessage(ctx, event.player.id, "speech", text);
      ctx.state.spokenPlayerIds.push(event.player.id);
      advanceSpeaker(ctx);
    },
    vote(ctx, event) {
      if (ctx.state.phase !== "voting") return;
      if (!livingIds(ctx.state).includes(event.player.id)) return;
      if (event.player.id in ctx.state.votes) return;
      const raw = event.payload?.targetId;
      const targetId = typeof raw === "string" ? raw : "";
      if (targetId && (!ctx.state.voteCandidates.includes(targetId) || targetId === event.player.id)) return;
      ctx.state.votes[event.player.id] = targetId;
      pushSystem(ctx, targetId ? `${nameOf(ctx, event.player.id)} \u6295\u7ED9\u4E86 ${nameOf(ctx, targetId)}\u3002` : `${nameOf(ctx, event.player.id)} \u5F03\u7968\u3002`);
      resolveVotingRound(ctx);
    },
    chat(ctx, event) {
      if (!livingIds(ctx.state).includes(event.player.id)) return;
      const text = normalizeText(event.payload?.text);
      if (!text) return;
      pushMessage(ctx, event.player.id, "chat", text);
    }
  }
});
export default worker_default;

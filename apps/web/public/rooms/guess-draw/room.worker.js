// src/worker.ts
import { defineRoom } from "@parti/worker-sdk";

// src/canvas-budget.ts
var MAX_STROKES_PER_CANVAS = 300;
var MAX_POINTS_PER_STROKE = 420;
var MAX_POINTS_PER_CANVAS = 24e3;
function canvasPointCount(strokes) {
  return strokes.reduce((total, stroke) => total + stroke.points.length, 0);
}
function canApplyStroke(strokes, candidate) {
  return strokes.length < MAX_STROKES_PER_CANVAS && candidate.points.length <= MAX_POINTS_PER_STROKE && canvasPointCount(strokes) + candidate.points.length <= MAX_POINTS_PER_CANVAS;
}

// src/game-logic.ts
function relayTaskKind(participantCount, step) {
  if (participantCount < 2 || step < 1 || step >= participantCount) throw new RangeError("invalid relay step");
  return step === participantCount - 1 ? "final-guess" : "guess";
}

// src/stroke-update.ts
function createStrokeUpdateLedger() {
  return { currentId: null, lastSeq: -1, completedIds: /* @__PURE__ */ new Set() };
}
function acceptStrokeUpdate(ledger, update) {
  const { id } = update.stroke;
  if (!id || !Number.isInteger(update.updateSeq) || update.updateSeq < 0 || ledger.completedIds.has(id)) return false;
  if (ledger.currentId !== null && ledger.currentId !== id) return false;
  if (ledger.currentId === null) {
    ledger.currentId = id;
    ledger.lastSeq = -1;
  }
  if (update.updateSeq <= ledger.lastSeq) return false;
  ledger.lastSeq = update.updateSeq;
  if (update.complete) {
    ledger.completedIds.add(id);
    ledger.currentId = null;
    ledger.lastSeq = -1;
  }
  return true;
}
function resetStrokeUpdateLedger(ledger) {
  ledger.currentId = null;
  ledger.lastSeq = -1;
  ledger.completedIds.clear();
}

// src/word-bank-extra.ts
var source = {
  daily: "\u6298\u53E0\u684C,\u667E\u8863\u67B6,\u4FDD\u9C9C\u76D2,\u70ED\u6C34\u74F6,\u6D17\u8138\u76C6,\u978B\u62D4\u5B50,\u5F00\u74F6\u5668,\u524A\u76AE\u5200,\u64C0\u9762\u6756,\u6F0F\u52FA,\u56F4\u88D9,\u6A61\u80F6\u624B\u5957,\u6D17\u8863\u7BEE,\u9488\u7EBF\u76D2,\u5DE5\u5177\u7BB1,\u5377\u5C3A,\u87BA\u4E1D\u5200,\u8001\u864E\u94B3,\u900F\u660E\u80F6\u5E26,\u4FBF\u5229\u8D34,\u8BA2\u4E66\u5668,\u6587\u4EF6\u5939,\u8BA1\u7B97\u5668,\u9F20\u6807\u57AB,\u5E73\u677F\u7535\u8111,\u5145\u7535\u5B9D,\u667A\u80FD\u624B\u8868,\u81EA\u62CD\u6746,\u8DEF\u7531\u5668,\u6295\u5F71\u4EEA,\u7A7A\u6C14\u51C0\u5316\u5668,\u52A0\u6E7F\u5668,\u53D6\u6696\u5668,\u69A8\u6C41\u676F,\u5496\u5561\u673A,\u70E4\u9762\u5305\u673A,\u6D17\u7897\u5237,\u4FDD\u6E29\u996D\u76D2,\u8C03\u5473\u7F50,\u6C34\u679C\u76D8,\u95E8\u57AB,\u8863\u5E3D\u67B6,\u61D2\u4EBA\u6C99\u53D1,\u6447\u6905,\u868A\u5E10,\u5E8A\u5934\u67DC,\u6536\u7EB3\u888B,\u7A97\u7EB1,\u767E\u53F6\u5E18,\u6302\u949F,\u96E8\u9774,\u592A\u9633\u955C,\u906E\u9633\u5E3D,\u56F4\u5DFE,\u9886\u5E26,\u8170\u5E26,\u94B1\u5305,\u96F6\u94B1\u5305,\u516C\u4EA4\u5361,\u5FEB\u9012\u67DC,\u6591\u9A6C\u7EBF,\u5171\u4EAB\u5355\u8F66,\u81EA\u52A8\u552E\u8D27\u673A,\u5783\u573E\u5206\u7C7B,\u6392\u961F\u53D6\u53F7,\u5237\u8138\u652F\u4ED8,\u626B\u7801\u70B9\u9910,\u89C6\u9891\u901A\u8BDD,\u7F51\u8D2D\u9000\u8D27,\u905B\u72D7,\u6D47\u82B1,\u64E6\u73BB\u7483,\u53E0\u88AB\u5B50,\u71A8\u8863\u670D,\u6362\u706F\u6CE1,\u4FEE\u6C34\u7BA1,\u642C\u5BB6,\u62C6\u5FEB\u9012,\u5012\u5783\u573E,\u6324\u7259\u818F",
  animals: "\u8001\u864E,\u8C79\u5B50,\u730E\u8C79,\u7280\u725B,\u6CB3\u9A6C,\u7F9A\u7F8A,\u7266\u725B,\u91CE\u732A,\u72D0\u72F8,\u72FC,\u6D63\u718A,\u6C34\u736D,\u6811\u61D2,\u8003\u62C9,\u7329\u7329,\u72D2\u72D2,\u72D0\u7334,\u7A7F\u5C71\u7532,\u98DF\u8681\u517D,\u9E2D\u5634\u517D,\u9E35\u9E1F,\u9E66\u9E49,\u5929\u9E45,\u4E39\u9876\u9E64,\u6D77\u9E25,\u4FE1\u5929\u7FC1,\u8702\u9E1F,\u7FE0\u9E1F,\u559C\u9E4A,\u4E4C\u9E26,\u9EBB\u96C0,\u71D5\u5B50,\u8001\u9E70,\u79C3\u9E6B,\u706B\u9E21,\u9E2D\u5B50,\u9E45,\u516C\u9E21,\u9E4C\u9E51,\u9E48\u9E55,\u9CA8\u9C7C,\u9CB8\u9C7C,\u6D77\u8C79,\u6D77\u72EE,\u6D77\u8C61,\u9CD0\u9C7C,\u5251\u9C7C,\u6CB3\u8C5A,\u91D1\u9C7C,\u5C0F\u4E11\u9C7C,\u9F99\u867E,\u5BC4\u5C45\u87F9,\u6D77\u661F,\u6D77\u80C6,\u73CA\u745A\u866B,\u4E4C\u8D3C,\u6D77\u8475,\u9CD7\u9C7C,\u874C\u86AA,\u5A03\u5A03\u9C7C,\u87D2\u86C7,\u773C\u955C\u86C7,\u58C1\u864E,\u8725\u8734,\u9B23\u8725,\u6050\u9F99,\u9738\u738B\u9F99,\u4E09\u89D2\u9F99,\u86AF\u8693,\u6BDB\u6BDB\u866B,\u871C\u8702,\u873B\u8713,\u8424\u706B\u866B,\u74E2\u866B,\u87B3\u8782,\u86B1\u8722,\u7532\u866B,\u8718\u86DB,\u874E\u5B50,\u72EC\u89D2\u4ED9",
  imagination: "\u592A\u7A7A\u7535\u68AF,\u6708\u7403\u9732\u8425,\u673A\u5668\u4EBA\u505A\u996D,\u6050\u9F99\u4E0A\u73ED,\u4F01\u9E45\u9001\u5916\u5356,\u718A\u732B\u6253\u592A\u6781,\u7AE0\u9C7C\u5F39\u94A2\u7434,\u8717\u725B\u8D5B\u8F66,\u5154\u5B50\u767B\u6708,\u9CB8\u9C7C\u98DE\u5929,\u4F1A\u8D70\u8DEF\u7684\u623F\u5B50,\u4F1A\u5531\u6B4C\u7684\u77F3\u5934,\u5012\u7740\u957F\u7684\u6811,\u88C5\u8FDB\u53E3\u888B\u7684\u6D77\u6D0B,\u6F02\u6D6E\u7684\u57CE\u5E02,\u900F\u660E\u6C7D\u8F66,\u5F69\u8679\u7011\u5E03,\u661F\u661F\u79CB\u5343,\u6708\u4EAE\u6C14\u7403,\u4E91\u7AEF\u5496\u5561\u9986,\u65F6\u95F4\u5012\u6D41,\u8EAB\u4F53\u7F29\u5C0F,\u4E00\u79D2\u957F\u5927,\u590D\u5236\u81EA\u5DF1,\u9694\u7A7A\u53D6\u7269,\u8BFB\u5FC3\u672F,\u77AC\u95F4\u79FB\u52A8,\u7A7F\u5899\u672F,\u70B9\u77F3\u6210\u91D1,\u547C\u98CE\u5524\u96E8,\u5934\u9876\u5F00\u82B1,\u811A\u4E0B\u751F\u98CE,\u7B11\u51FA\u773C\u6CEA,\u6C14\u6210\u6CB3\u8C5A,\u56F0\u5F97\u5192\u6CE1,\u5FD9\u6210\u9640\u87BA,\u997F\u5F97\u53D1\u5149,\u5413\u6389\u4E0B\u5DF4,\u5F00\u5FC3\u8D77\u98DE,\u539F\u5730\u77F3\u5316,\u6253\u5DE5\u4EBA\u5145\u7535,\u6478\u9C7C\u8FBE\u4EBA,\u7075\u9B42\u51FA\u7A8D,\u60C5\u7EEA\u8FC7\u5C71\u8F66,\u8111\u888B\u5B95\u673A,\u4FE1\u606F\u7206\u70B8,\u597D\u8FD0\u9526\u9CA4,\u53CD\u5411\u64CD\u4F5C,\u4E00\u952E\u4E09\u8FDE,\u4E91\u517B\u5BA0\u7269,\u8D5B\u535A\u821E\u72EE,\u7535\u5B50\u6728\u9C7C,\u4EBA\u5DE5\u667A\u80FD\u753B\u753B,\u673A\u5668\u4EBA\u905B\u72D7,\u65E0\u4EBA\u673A\u9001\u82B1,\u865A\u62DF\u65C5\u884C,\u6570\u5B57\u5206\u8EAB,\u667A\u80FD\u51B0\u7BB1\u8BF4\u8BDD,\u6253\u5370\u4E00\u987F\u996D,\u6C7D\u8F66\u81EA\u52A8\u9A7E\u9A76,\u4E66\u672C\u957F\u7FC5\u8180,\u94C5\u7B14\u53D8\u9B54\u6756,\u6A61\u76AE\u64E6\u6389\u70E6\u607C,\u95F9\u949F\u9003\u8DD1,\u955C\u5B50\u91CC\u7684\u4E16\u754C,\u5F71\u5B50\u8DF3\u821E,\u7167\u7247\u6D3B\u8FC7\u6765,\u753B\u4E2D\u4EBA\u8D70\u51FA\u6765,\u68A6\u5883\u7535\u5F71\u9662,\u8BB0\u5FC6\u62BD\u5C49,\u592A\u9633\u6253\u55B7\u568F,\u6708\u4EAE\u7761\u61D2\u89C9,\u661F\u661F\u6392\u961F,\u4E4C\u4E91\u5403\u5F69\u8679,\u98CE\u628A\u623F\u5B50\u5439\u8DD1,\u96EA\u4EBA\u5403\u706B\u9505,\u706B\u5C71\u505A\u86CB\u7CD5,\u6C99\u6F20\u4E0B\u5927\u96EA,\u6D77\u5E95\u653E\u70DF\u82B1,\u68EE\u6797\u5F00\u6D3E\u5BF9",
  food: "\u5317\u4EAC\u70E4\u9E2D,\u7EA2\u70E7\u8089,\u7CD6\u918B\u6392\u9AA8,\u5BAB\u4FDD\u9E21\u4E01,\u9EBB\u5A46\u8C46\u8150,\u9C7C\u9999\u8089\u4E1D,\u9178\u83DC\u9C7C,\u6C34\u716E\u9C7C,\u5C0F\u9F99\u867E,\u70E4\u4E73\u732A,\u70B8\u9171\u9762,\u5200\u524A\u9762,\u70ED\u5E72\u9762,\u87BA\u86F3\u7C89,\u8FC7\u6865\u7C73\u7EBF,\u91CD\u5E86\u5C0F\u9762,\u51C9\u76AE,\u8089\u5939\u998D,\u714E\u997C\u679C\u5B50,\u624B\u6293\u997C,\u5C0F\u7B3C\u5305,\u70E7\u5356,\u9984\u9968,\u6C64\u5706,\u7CBD\u5B50,\u5E74\u7CD5,\u6625\u5377,\u9505\u8D34,\u6CB9\u6761,\u9EBB\u82B1,\u86CB\u631E,\u6CE1\u8299,\u751C\u751C\u5708,\u9A6C\u5361\u9F99,\u63D0\u62C9\u7C73\u82CF,\u5E03\u4E01,\u679C\u51BB,\u68C9\u82B1\u7CD6,\u5DE7\u514B\u529B,\u94DC\u9523\u70E7,\u8292\u679C,\u69B4\u83B2,\u6930\u5B50,\u7315\u7334\u6843,\u706B\u9F99\u679C,\u67E0\u6AAC,\u6A59\u5B50,\u6843\u5B50,\u8461\u8404,\u84DD\u8393,\u80E1\u841D\u535C,\u897F\u7EA2\u67FF,\u9EC4\u74DC,\u5357\u74DC,\u8304\u5B50,\u8FA3\u6912,\u571F\u8C46,\u7EA2\u85AF,\u83B2\u85D5,\u897F\u5170\u82B1,\u8C46\u6D46,\u67E0\u6AAC\u6C34,\u6A59\u6C41,\u6930\u6C41,\u9178\u6885\u6C64,\u51B0\u7EA2\u8336,\u6C14\u6CE1\u6C34,\u70ED\u5DE7\u514B\u529B,\u62B9\u8336\u62FF\u94C1,\u9C9C\u69A8\u679C\u6C41,\u81EA\u52A9\u9910,\u65CB\u8F6C\u5BFF\u53F8,\u70DB\u5149\u665A\u9910,\u91CE\u9910\u7BEE,\u5916\u5356\u9910\u76D2,\u9E33\u9E2F\u9505,\u4E5D\u5BAB\u683C\u706B\u9505,\u6D41\u6C34\u5E2D,\u6EE1\u6C49\u5168\u5E2D,\u6DF1\u591C\u98DF\u5802",
  sports: "\u8E22\u6BFD\u5B50,\u6253\u68D2\u7403,\u6253\u5792\u7403,\u6253\u6A44\u6984\u7403,\u6253\u66F2\u68CD\u7403,\u6253\u53F0\u7403,\u6253\u58C1\u7403,\u6253\u624B\u7403,\u6C34\u7403,\u85E4\u7403,\u77ED\u8DD1,\u957F\u8DD1,\u8DE8\u680F,\u7ADE\u8D70,\u8DF3\u8FDC,\u4E09\u7EA7\u8DF3\u8FDC,\u6491\u6746\u8DF3\u9AD8,\u63B7\u94C5\u7403,\u63B7\u94C1\u997C,\u63B7\u6807\u67AA,\u81EA\u7531\u6CF3,\u86D9\u6CF3,\u4EF0\u6CF3,\u8776\u6CF3,\u82B1\u6837\u6E38\u6CF3,\u6C34\u4E0A\u82AD\u857E,\u76AE\u5212\u8247,\u8D5B\u8247,\u5E06\u8239,\u6C34\u4E0A\u6469\u6258,\u8DC6\u62F3\u9053,\u67D4\u9053,\u7A7A\u624B\u9053,\u6563\u6253,\u6454\u8DE4,\u592A\u6781\u62F3,\u6B66\u672F\u5957\u8DEF,\u76F8\u6251,\u81EA\u7531\u640F\u51FB,\u5251\u9053,\u745C\u4F3D,\u666E\u62C9\u63D0,\u5E73\u677F\u652F\u6491,\u4FEF\u5367\u6491,\u4EF0\u5367\u8D77\u5750,\u5F15\u4F53\u5411\u4E0A,\u6DF1\u8E72,\u5012\u7ACB,\u5288\u53C9,\u7FFB\u8DDF\u5934,\u8F6E\u6ED1,\u51B0\u58F6,\u51B0\u7403,\u96EA\u6A47,\u5355\u677F\u6ED1\u96EA,\u8D8A\u91CE\u6ED1\u96EA,\u767B\u5C71,\u5F92\u6B65,\u5B9A\u5411\u8D8A\u91CE,\u8E66\u6781,\u8D5B\u8F66,\u5361\u4E01\u8F66,\u6469\u6258\u8F66\u8D5B,\u9A6C\u672F,\u8D5B\u9A6C,\u98DE\u76D8,\u8EB2\u907F\u7403,\u6C99\u6EE9\u6392\u7403,\u7535\u5B50\u7ADE\u6280,\u5C04\u51FB,\u9881\u5956\u5178\u793C,\u51A0\u519B\u9886\u5956,\u6559\u7EC3\u6682\u505C,\u88C1\u5224\u5439\u54E8,\u5B88\u95E8\u5458\u6251\u7403,\u5566\u5566\u961F\u52A9\u5A01,\u8FD0\u52A8\u5458\u70ED\u8EAB,\u7EC8\u70B9\u51B2\u523A,\u70B9\u7403\u5927\u6218,\u706B\u70AC\u4F20\u9012",
  places: "\u5496\u5561\u9986,\u9762\u5305\u5E97,\u7406\u53D1\u5E97,\u6D17\u8863\u5E97,\u836F\u5E97,\u82B1\u5E97,\u4E66\u5E97,\u4FBF\u5229\u5E97,\u83DC\u5E02\u573A,\u591C\u5E02,\u8B66\u5BDF\u5C40,\u6D88\u9632\u7AD9,\u5FEB\u9910\u5E97,\u8BC1\u5238\u4EA4\u6613\u6240,\u6CD5\u9662,\u5E02\u653F\u5385,\u793E\u533A\u4E2D\u5FC3,\u517B\u8001\u9662,\u5E7C\u513F\u56ED,\u5927\u5B66\u6821\u56ED,\u4F53\u80B2\u9986,\u6E38\u6CF3\u9986,\u5065\u8EAB\u623F,\u8DB3\u7403\u573A,\u7BEE\u7403\u573A,\u6ED1\u96EA\u573A,\u8D5B\u8F66\u573A,\u9AD8\u5C14\u592B\u7403\u573A,\u9732\u5929\u5267\u573A,\u97F3\u4E50\u5385,\u9053\u89C2,\u6559\u5802,\u53E4\u5854,\u957F\u57CE,\u724C\u697C,\u56DB\u5408\u9662,\u6C34\u4E61\u53E4\u9547,\u6469\u5929\u5927\u697C,\u949F\u697C,\u89C2\u666F\u53F0,\u6C99\u6F20,\u8349\u539F,\u68EE\u6797,\u96E8\u6797,\u5CE1\u8C37,\u60AC\u5D16,\u706B\u5C71\u53E3,\u77F3\u6797,\u6E29\u6CC9,\u51B0\u5DDD,\u6D77\u5C9B,\u6C99\u6EE9,\u7801\u5934,\u6E2F\u53E3,\u6E14\u6751,\u6E56\u5FC3\u5C9B,\u6CB3\u5CB8,\u7AF9\u6797,\u679C\u56ED,\u68AF\u7530,\u6709\u8F68\u7535\u8F66\u7AD9,\u9AD8\u901F\u516C\u8DEF,\u670D\u52A1\u533A,\u505C\u8F66\u573A,\u5145\u7535\u7AD9,\u6536\u8D39\u7AD9,\u5341\u5B57\u8DEF\u53E3,\u6B65\u884C\u8857,\u5929\u6865,\u73AF\u5C9B,\u592A\u7A7A\u7AD9,\u6708\u7403\u57FA\u5730,\u6D77\u5E95\u4E16\u754C,\u4E91\u7AEF\u57CE\u5821,\u79D8\u5BC6\u82B1\u56ED,\u9B54\u6CD5\u5B66\u6821,\u6050\u9F99\u516C\u56ED,\u673A\u5668\u4EBA\u5DE5\u5382,\u672A\u6765\u57CE\u5E02,\u6570\u5B57\u535A\u7269\u9986",
  jobs: "\u6025\u6551\u5458,\u6D88\u9632\u6307\u6325\u5458,\u7279\u8B66,\u6559\u5E08,\u6CD5\u5B98,\u5F8B\u5E08,\u7FFB\u8BD1,\u5BFC\u6E38,\u6F14\u5458,\u5BFC\u6F14,\u7F16\u5267,\u914D\u97F3\u6F14\u5458,\u821E\u8E48\u5BB6,\u97F3\u4E50\u5BB6,\u94A2\u7434\u5BB6,\u96D5\u5851\u5BB6,\u8BBE\u8BA1\u5E08,\u670D\u88C5\u8BBE\u8BA1\u5E08,\u52A8\u753B\u5E08,\u526A\u8F91\u5E08,\u7535\u5DE5,\u6C34\u7BA1\u5DE5,\u6728\u5320,\u710A\u5DE5,\u4FEE\u7406\u5DE5,\u6E05\u6D01\u5DE5,\u4FDD\u5B89,\u53F8\u673A,\u516C\u4EA4\u8F66\u53F8\u673A,\u51FA\u79DF\u8F66\u53F8\u673A,\u673A\u957F,\u7A7A\u4E58\u4EBA\u5458,\u5217\u8F66\u5458,\u5730\u94C1\u53F8\u673A,\u822A\u6D77\u5BB6,\u6551\u751F\u5458,\u836F\u5242\u5E08,\u6C14\u8C61\u5458,\u5730\u8D28\u5B66\u5BB6,\u8003\u53E4\u5B66\u5BB6,\u5316\u5B66\u5BB6,\u7269\u7406\u5B66\u5BB6,\u751F\u7269\u5B66\u5BB6,\u5DE5\u7A0B\u5E08,\u673A\u68B0\u5DE5\u7A0B\u5E08,\u5EFA\u7B51\u5E08,\u6D4B\u91CF\u5458,\u5B9E\u9A8C\u5458,\u7814\u7A76\u5458,\u53D1\u660E\u5BB6,\u4E3B\u6301\u4EBA,\u64AD\u97F3\u5458,\u7F16\u8F91,\u4F5C\u5BB6,\u6F2B\u753B\u5BB6,\u7F51\u7EDC\u4E3B\u64AD,\u7535\u7ADE\u9009\u624B,\u4EA7\u54C1\u7ECF\u7406,\u6570\u636E\u5206\u6790\u5E08,\u4EBA\u5DE5\u667A\u80FD\u5DE5\u7A0B\u5E08,\u6536\u94F6\u5458,\u552E\u8D27\u5458,\u82B1\u827A\u5E08,\u5496\u5561\u5E08,\u8C03\u9152\u5E08,\u7CD5\u70B9\u5E08,\u88C1\u7F1D,\u73E0\u5B9D\u5320,\u949F\u8868\u5320,\u9676\u827A\u5BB6,\u9972\u517B\u5458,\u9A6F\u517D\u5E08,\u62A4\u6797\u5458,\u6E14\u6C11,\u7267\u6C11,\u517B\u8702\u4EBA,\u8FD0\u52A8\u5458,\u6559\u7EC3,\u88C1\u5224\u5458,\u5FD7\u613F\u8005",
  culture: "\u6302\u706F\u7B3C,\u5199\u798F\u5B57,\u62DC\u5E74,\u5B88\u5C81,\u770B\u6625\u665A,\u901B\u5E99\u4F1A,\u8E29\u9AD8\u8DF7,\u626D\u79E7\u6B4C,\u8D4F\u82B1\u706F,\u5403\u5E74\u591C\u996D,\u8D4F\u6708,\u8D4F\u83CA,\u767B\u9AD8,\u8E0F\u9752,\u63D2\u827E\u8349,\u6234\u9999\u56CA,\u796D\u6708,\u559D\u814A\u516B\u7CA5,\u505A\u82B1\u706F,\u6572\u9523\u6253\u9F13,\u76AE\u5F71\u620F,\u6728\u5076\u620F,\u53D8\u8138,\u6253\u5FEB\u677F,\u8BF4\u76F8\u58F0,\u6F14\u5C0F\u54C1,\u4EAC\u5267\u4EAE\u76F8,\u5439\u5522\u5450,\u6572\u8170\u9F13,\u5F39\u53E4\u7B5D,\u62C9\u4E8C\u80E1,\u5439\u7B1B\u5B50,\u821E\u9F99,\u6296\u7A7A\u7AF9,\u8E22\u6BFD\u5B50\u6BD4\u8D5B,\u634F\u9762\u4EBA,\u505A\u7CD6\u753B,\u624E\u98CE\u7B5D,\u7F16\u4E2D\u56FD\u7ED3,\u70E7\u9676\u74F7,\u5BF9\u725B\u5F39\u7434,\u4EA1\u7F8A\u8865\u7262,\u53F6\u516C\u597D\u9F99,\u6EE5\u7AFD\u5145\u6570,\u81EA\u76F8\u77DB\u76FE,\u676F\u5F13\u86C7\u5F71,\u4E70\u691F\u8FD8\u73E0,\u611A\u516C\u79FB\u5C71,\u5938\u7236\u8FFD\u65E5,\u611A\u4EBA\u6478\u8C61,\u9E6C\u868C\u76F8\u4E89,\u9ED4\u9A74\u6280\u7A77,\u4E09\u987E\u8305\u5E90,\u8349\u8239\u501F\u7BAD,\u8D1F\u8346\u8BF7\u7F6A,\u7834\u91DC\u6C89\u821F,\u5367\u85AA\u5C1D\u80C6,\u51FF\u58C1\u5077\u5149,\u60AC\u6881\u523A\u80A1,\u5B54\u878D\u8BA9\u68A8,\u6728\u5170\u4ECE\u519B,\u5927\u79B9\u6CBB\u6C34,\u5973\u5A32\u8865\u5929,\u76D8\u53E4\u5F00\u5929,\u725B\u90CE\u7EC7\u5973,\u516B\u4ED9\u8FC7\u6D77,\u54EA\u5412\u95F9\u6D77,\u5B59\u609F\u7A7A\u7FFB\u7B4B\u6597,\u6B66\u677E\u6253\u864E,\u53F8\u9A6C\u5149\u7838\u7F38,\u56FD\u6F6E\u670D\u88C5,\u6C49\u670D\u51FA\u6E38,\u975E\u9057\u5E02\u96C6,\u535A\u7269\u9986\u6253\u5361,\u6587\u521B\u96EA\u7CD5,\u53E4\u98CE\u97F3\u4E50,\u7F51\u7EDC\u62DC\u5E74,\u4E91\u7AEF\u770B\u5C55,\u6570\u5B57\u4EBA\u76F4\u64AD,\u673A\u5668\u4EBA\u821E\u72EE"
};
var firstHint = {
  daily: "\u65E5\u5E38\u751F\u6D3B\u4E2D\u5E38\u89C1\u7684\u7269\u54C1\u6216\u52A8\u4F5C",
  animals: "\u6709\u9C9C\u660E\u5916\u5F62\u6216\u4E60\u6027\u7684\u52A8\u7269",
  imagination: "\u73B0\u5B9E\u4E2D\u5F88\u96BE\u53D1\u751F\u7684\u5947\u5999\u753B\u9762",
  food: "\u4E0E\u4E3B\u98DF\u3001\u83DC\u80B4\u3001\u751C\u70B9\u6216\u996E\u54C1\u6709\u5173",
  sports: "\u4E0E\u8FD0\u52A8\u9879\u76EE\u6216\u6BD4\u8D5B\u73B0\u573A\u6709\u5173",
  places: "\u4EBA\u4EEC\u53EF\u80FD\u5230\u8BBF\u6216\u60F3\u8C61\u7684\u573A\u6240",
  jobs: "\u53EF\u4EE5\u901A\u8FC7\u670D\u88C5\u3001\u5DE5\u5177\u6216\u52A8\u4F5C\u8868\u73B0\u7684\u804C\u4E1A",
  culture: "\u4E0E\u4F20\u7EDF\u6545\u4E8B\u3001\u8282\u5E86\u6216\u5F53\u4EE3\u6587\u5316\u6709\u5173"
};
var EXTRA_WORD_BANK = Object.fromEntries(Object.entries(source).map(([category, csv]) => [
  category,
  csv.split(",").map((word, index) => ({
    id: `${category}-extra-${index + 31}`,
    word,
    hints: [firstHint[category], "\u753B\u51FA\u6700\u6709\u4EE3\u8868\u6027\u7684\u5916\u5F62\u3001\u5DE5\u5177\u6216\u52A8\u4F5C"]
  }))
]));

// src/word-bank.ts
var CATEGORY_DEFS = [
  { id: "daily", name: "\u65E5\u5E38\u751F\u6D3B", icon: "\u2600\uFE0F", description: "\u719F\u6089\u7684\u7269\u54C1\u4E0E\u573A\u666F" },
  { id: "animals", name: "\u52A8\u7269\u4E16\u754C", icon: "\u{1F43E}", description: "\u5929\u4E0A\u3001\u5730\u4E0A\u548C\u6C34\u91CC" },
  { id: "imagination", name: "\u8111\u6D1E\u8DA3\u5473", icon: "\u2728", description: "\u52A8\u4F5C\u3001\u72B6\u6001\u4E0E\u5947\u5999\u7EC4\u5408" },
  { id: "food", name: "\u7F8E\u98DF\u5929\u5730", icon: "\u{1F35C}", description: "\u4E3B\u98DF\u3001\u751C\u70B9\u4E0E\u996E\u54C1" },
  { id: "sports", name: "\u8FD0\u52A8\u65F6\u523B", icon: "\u26BD", description: "\u7403\u7C7B\u3001\u6237\u5916\u4E0E\u7ADE\u6280" },
  { id: "places", name: "\u5730\u70B9\u573A\u666F", icon: "\u{1F3D9}\uFE0F", description: "\u5EFA\u7B51\u3001\u4EA4\u901A\u4E0E\u65C5\u884C" },
  { id: "jobs", name: "\u804C\u4E1A\u4EBA\u7269", icon: "\u{1F9D1}\u200D\u{1F680}", description: "\u719F\u6089\u7684\u804C\u4E1A\u4E0E\u89D2\u8272" },
  { id: "culture", name: "\u6587\u5316\u8282\u5E86", icon: "\u{1F3EE}", description: "\u6210\u8BED\u3001\u8282\u65E5\u4E0E\u4F20\u7EDF" }
];
var WORD_BANK = {
  daily: [
    { id: "daily-umbrella", word: "\u96E8\u4F1E", hints: ["\u4E0B\u96E8\u5929\u5E38\u5E38\u7528\u5230", "\u5B83\u4F1A\u5728\u5934\u9876\u6491\u5F00"] },
    { id: "daily-toothbrush", word: "\u7259\u5237", hints: ["\u6BCF\u5929\u65E9\u665A\u90FD\u53EF\u80FD\u7528\u5230", "\u5B83\u548C\u7259\u818F\u662F\u642D\u6863"] },
    { id: "daily-fridge", word: "\u51B0\u7BB1", hints: ["\u53A8\u623F\u91CC\u7684\u5927\u578B\u7535\u5668", "\u80FD\u8BA9\u98DF\u7269\u4FDD\u6301\u4F4E\u6E29"] },
    { id: "daily-slippers", word: "\u62D6\u978B", hints: ["\u56DE\u5230\u5BB6\u5E38\u5E38\u6362\u4E0A\u5B83", "\u7A7F\u8131\u5F88\u65B9\u4FBF\u7684\u978B"] },
    { id: "daily-alarm", word: "\u95F9\u949F", hints: ["\u5B83\u548C\u65F6\u95F4\u6709\u5173", "\u65E9\u6668\u4F1A\u628A\u4EBA\u53EB\u9192"] },
    { id: "daily-key", word: "\u94A5\u5319", hints: ["\u51FA\u95E8\u65F6\u522B\u5FD8\u4E86\u5E26", "\u80FD\u6253\u5F00\u4E00\u628A\u9501"] },
    { id: "daily-backpack", word: "\u4E66\u5305", hints: ["\u5B66\u751F\u7ECF\u5E38\u643A\u5E26", "\u91CC\u9762\u53EF\u4EE5\u88C5\u8BFE\u672C"] },
    { id: "daily-mirror", word: "\u955C\u5B50", hints: ["\u623F\u95F4\u91CC\u5E38\u89C1\u7684\u7269\u54C1", "\u80FD\u770B\u5230\u81EA\u5DF1\u7684\u6837\u5B50"] },
    { id: "daily-kettle", word: "\u70E7\u6C34\u58F6", hints: ["\u559D\u6C34\u524D\u53EF\u80FD\u7528\u5230", "\u53EF\u4EE5\u628A\u51B7\u6C34\u52A0\u70ED"] },
    { id: "daily-headphones", word: "\u8033\u673A", hints: ["\u5E38\u548C\u7535\u5B50\u8BBE\u5907\u4E00\u8D77\u4F7F\u7528", "\u6234\u5728\u8033\u6735\u4E0A\u542C\u58F0\u97F3"] },
    { id: "daily-traffic-light", word: "\u7EA2\u7EFF\u706F", hints: ["\u9A6C\u8DEF\u4E0A\u5F88\u5E38\u89C1", "\u7528\u989C\u8272\u6307\u6325\u901A\u884C"] },
    { id: "daily-elevator", word: "\u7535\u68AF", hints: ["\u9AD8\u697C\u91CC\u7ECF\u5E38\u89C1\u5230", "\u8F7D\u7740\u4EBA\u4E0A\u4E0B\u697C"] },
    { id: "daily-tissue", word: "\u7EB8\u5DFE", hints: ["\u8F7B\u8584\u7684\u4E00\u6B21\u6027\u7528\u54C1", "\u53EF\u4EE5\u7528\u6765\u64E6\u62ED"] },
    { id: "daily-sofa", word: "\u6C99\u53D1", hints: ["\u5BA2\u5385\u91CC\u7684\u5BB6\u5177", "\u53EF\u4EE5\u5750\u4E0B\u6216\u8EBA\u4E0B"] },
    { id: "daily-lamp", word: "\u53F0\u706F", hints: ["\u5E38\u6446\u5728\u684C\u9762\u4E0A", "\u591C\u91CC\u63D0\u4F9B\u4E00\u5C0F\u7247\u5149"] },
    { id: "daily-suitcase", word: "\u884C\u674E\u7BB1", hints: ["\u65C5\u884C\u65F6\u5E38\u5E38\u51FA\u73B0", "\u6709\u8F6E\u5B50\u5E76\u80FD\u88C5\u8863\u7269"] },
    { id: "daily-washing-machine", word: "\u6D17\u8863\u673A", hints: ["\u5BB6\u4E2D\u7684\u7535\u5668", "\u8863\u670D\u5728\u91CC\u9762\u65CB\u8F6C\u6E05\u6D17"] },
    { id: "daily-microwave", word: "\u5FAE\u6CE2\u7089", hints: ["\u53A8\u623F\u91CC\u7684\u7535\u5668", "\u80FD\u5F88\u5FEB\u52A0\u70ED\u98DF\u7269"] },
    { id: "daily-bicycle", word: "\u81EA\u884C\u8F66", hints: ["\u5E38\u89C1\u7684\u4EA4\u901A\u5DE5\u5177", "\u6709\u4E24\u4E2A\u8F6E\u5B50\u5E76\u9760\u811A\u8E29"] },
    { id: "daily-fire-extinguisher", word: "\u706D\u706B\u5668", hints: ["\u516C\u5171\u573A\u6240\u7684\u5B89\u5168\u8BBE\u5907", "\u7740\u706B\u65F6\u7528\u5B83\u55B7\u5C04\u706D\u706B"] },
    { id: "daily-vacuum", word: "\u5438\u5C18\u5668", hints: ["\u6253\u626B\u623F\u95F4\u65F6\u4F7F\u7528", "\u957F\u7BA1\u5438\u8D70\u5730\u9762\u7684\u7070\u5C18"] },
    { id: "daily-hairdryer", word: "\u5439\u98CE\u673A", hints: ["\u6D17\u5934\u540E\u5E38\u7528", "\u4ECE\u524D\u7AEF\u5439\u51FA\u70ED\u98CE"] },
    { id: "daily-rice-cooker", word: "\u7535\u996D\u7172", hints: ["\u53A8\u623F\u91CC\u7684\u5C0F\u5BB6\u7535", "\u76D6\u4E0A\u76D6\u5B50\u628A\u7C73\u716E\u6210\u719F\u996D"] },
    { id: "daily-fan", word: "\u7535\u98CE\u6247", hints: ["\u5929\u6C14\u70ED\u65F6\u4F7F\u7528", "\u51E0\u7247\u6247\u53F6\u65CB\u8F6C\u9001\u98CE"] },
    { id: "daily-sweeping", word: "\u626B\u5730", hints: ["\u4E00\u79CD\u5BB6\u52A1\u52B3\u52A8", "\u62FF\u7740\u626B\u628A\u6E05\u7406\u5730\u9762"] },
    { id: "daily-laundry", word: "\u667E\u8863\u670D", hints: ["\u6D17\u8863\u4E4B\u540E\u8FDB\u884C", "\u628A\u6E7F\u8863\u670D\u6302\u5230\u957F\u6746\u4E0A"] },
    { id: "daily-charging", word: "\u624B\u673A\u5145\u7535", hints: ["\u7535\u5B50\u8BBE\u5907\u6CA1\u7535\u65F6\u9700\u8981", "\u7528\u4E00\u6839\u7EBF\u8FDE\u63A5\u624B\u673A\u548C\u63D2\u5EA7"] },
    { id: "daily-shopping-cart", word: "\u8D2D\u7269\u8F66", hints: ["\u5546\u5E97\u91CC\u5E38\u89C1", "\u6709\u7BEE\u7B50\u548C\u8F6E\u5B50\u4F9B\u987E\u5BA2\u63A8\u52A8"] },
    { id: "daily-doorbell", word: "\u6309\u95E8\u94C3", hints: ["\u5230\u522B\u4EBA\u5BB6\u95E8\u53E3\u65F6\u53EF\u80FD\u505A", "\u7528\u624B\u6307\u6309\u4E0B\u95E8\u8FB9\u6309\u94AE"] },
    { id: "daily-taking-photo", word: "\u62CD\u7167", hints: ["\u8BB0\u5F55\u773C\u524D\u753B\u9762", "\u4E3E\u8D77\u76F8\u673A\u6216\u624B\u673A\u6309\u4E0B\u5FEB\u95E8"] },
    ...EXTRA_WORD_BANK.daily
  ],
  animals: [
    { id: "animal-elephant", word: "\u5927\u8C61", hints: ["\u751F\u6D3B\u5728\u9646\u5730\u4E0A\u7684\u5927\u578B\u52A8\u7269", "\u6709\u5F88\u957F\u7684\u9F3B\u5B50"] },
    { id: "animal-giraffe", word: "\u957F\u9888\u9E7F", hints: ["\u6765\u81EA\u8349\u539F\u7684\u52A8\u7269", "\u8116\u5B50\u7279\u522B\u957F"] },
    { id: "animal-penguin", word: "\u4F01\u9E45", hints: ["\u751F\u6D3B\u5728\u5BD2\u51B7\u5730\u533A", "\u7A7F\u7740\u9ED1\u767D\u8272\u5916\u8863\u8D70\u8DEF\u6447\u6446"] },
    { id: "animal-octopus", word: "\u7AE0\u9C7C", hints: ["\u751F\u6D3B\u5728\u6D77\u91CC", "\u6709\u516B\u6761\u8155\u8DB3"] },
    { id: "animal-kangaroo", word: "\u888B\u9F20", hints: ["\u6765\u81EA\u6FB3\u5927\u5229\u4E9A", "\u809A\u5B50\u524D\u9762\u6709\u80B2\u513F\u888B"] },
    { id: "animal-hedgehog", word: "\u523A\u732C", hints: ["\u4F53\u578B\u4E0D\u5927\u7684\u9646\u5730\u52A8\u7269", "\u9047\u5230\u5371\u9669\u4F1A\u8737\u6210\u523A\u7403"] },
    { id: "animal-flamingo", word: "\u706B\u70C8\u9E1F", hints: ["\u751F\u6D3B\u5728\u6E7F\u5730\u7684\u9E1F\u7C7B", "\u7FBD\u6BDB\u7C89\u7EA2\u4E14\u5E38\u5355\u811A\u7AD9\u7ACB"] },
    { id: "animal-camel", word: "\u9A86\u9A7C", hints: ["\u9002\u5E94\u5E72\u65F1\u73AF\u5883", "\u80CC\u4E0A\u6709\u9A7C\u5CF0"] },
    { id: "animal-peacock", word: "\u5B54\u96C0", hints: ["\u8272\u5F69\u9C9C\u8273\u7684\u9E1F", "\u96C4\u9E1F\u4F1A\u5C55\u5F00\u6247\u5F62\u5C3E\u7FBD"] },
    { id: "animal-snail", word: "\u8717\u725B", hints: ["\u79FB\u52A8\u5F97\u5F88\u6162", "\u80CC\u7740\u87BA\u65CB\u5F62\u7684\u58F3"] },
    { id: "animal-bat", word: "\u8759\u8760", hints: ["\u5E38\u5728\u591C\u95F4\u6D3B\u52A8", "\u4F1A\u98DE\u4F46\u4E0D\u662F\u9E1F"] },
    { id: "animal-dolphin", word: "\u6D77\u8C5A", hints: ["\u806A\u660E\u7684\u6D77\u6D0B\u52A8\u7269", "\u4F1A\u8DC3\u51FA\u6C34\u9762\u5E76\u53D1\u51FA\u54E8\u58F0"] },
    { id: "animal-crocodile", word: "\u9CC4\u9C7C", hints: ["\u5E38\u6F5C\u4F0F\u5728\u6C34\u8FB9", "\u6709\u957F\u5634\u548C\u950B\u5229\u7259\u9F7F"] },
    { id: "animal-panda", word: "\u718A\u732B", hints: ["\u7231\u5403\u690D\u7269\u7684\u5927\u578B\u52A8\u7269", "\u9ED1\u767D\u76F8\u95F4\u5E76\u7231\u5403\u7AF9\u5B50"] },
    { id: "animal-squirrel", word: "\u677E\u9F20", hints: ["\u5E38\u5728\u6811\u4E0A\u6D3B\u52A8", "\u6709\u84EC\u677E\u5927\u5C3E\u5DF4\u5E76\u7231\u5B58\u575A\u679C"] },
    { id: "animal-owl", word: "\u732B\u5934\u9E70", hints: ["\u591C\u95F4\u6D3B\u52A8\u7684\u9E1F", "\u773C\u775B\u5F88\u5927\u4E14\u5934\u80FD\u8F6C\u5F88\u8FDC"] },
    { id: "animal-turtle", word: "\u4E4C\u9F9F", hints: ["\u884C\u52A8\u901A\u5E38\u6BD4\u8F83\u7F13\u6162", "\u8EAB\u4F53\u85CF\u5728\u575A\u786C\u7684\u58F3\u91CC"] },
    { id: "animal-zebra", word: "\u6591\u9A6C", hints: ["\u751F\u6D3B\u5728\u975E\u6D32\u8349\u539F", "\u5168\u8EAB\u6709\u9ED1\u767D\u6761\u7EB9"] },
    { id: "animal-crab", word: "\u8783\u87F9", hints: ["\u5E38\u751F\u6D3B\u5728\u6C34\u8FB9", "\u6A2A\u7740\u8D70\u5E76\u6709\u4E00\u5BF9\u94B3\u5B50"] },
    { id: "animal-chameleon", word: "\u53D8\u8272\u9F99", hints: ["\u5E38\u5F85\u5728\u6811\u679D\u4E0A", "\u8EAB\u4F53\u989C\u8272\u4F1A\u968F\u73AF\u5883\u53D8\u5316"] },
    { id: "animal-lion", word: "\u72EE\u5B50", hints: ["\u751F\u6D3B\u5728\u8349\u539F\u7684\u5927\u578B\u52A8\u7269", "\u96C4\u6027\u8116\u5B50\u5468\u56F4\u6709\u6D53\u5BC6\u9B03\u6BDB"] },
    { id: "animal-rabbit", word: "\u5154\u5B50", hints: ["\u5E38\u89C1\u7684\u5C0F\u52A8\u7269", "\u6709\u957F\u8033\u6735\u5E76\u7231\u5403\u80E1\u841D\u535C"] },
    { id: "animal-frog", word: "\u9752\u86D9", hints: ["\u5E38\u51FA\u73B0\u5728\u6C60\u5858\u8FB9", "\u540E\u817F\u6709\u529B\u4F1A\u8DF3\u4E5F\u4F1A\u5471\u5471\u53EB"] },
    { id: "animal-seahorse", word: "\u6D77\u9A6C", hints: ["\u751F\u6D3B\u5728\u6D77\u91CC", "\u5934\u50CF\u5C0F\u9A6C\u5E76\u7AD6\u7740\u6E38\u6CF3"] },
    { id: "animal-jellyfish", word: "\u6C34\u6BCD", hints: ["\u900F\u660E\u7684\u6D77\u6D0B\u751F\u7269", "\u4F1E\u72B6\u8EAB\u4F53\u4E0B\u5782\u7740\u8BB8\u591A\u89E6\u624B"] },
    { id: "animal-polar-bear", word: "\u5317\u6781\u718A", hints: ["\u751F\u6D3B\u5728\u51B0\u96EA\u5730\u533A", "\u5168\u8EAB\u767D\u8272\u7684\u5927\u578B\u718A\u7C7B"] },
    { id: "animal-woodpecker", word: "\u5544\u6728\u9E1F", hints: ["\u4E00\u79CD\u4F1A\u98DE\u7684\u52A8\u7269", "\u7528\u5C16\u5634\u53CD\u590D\u6572\u51FB\u6811\u5E72"] },
    { id: "animal-butterfly", word: "\u8774\u8776", hints: ["\u5E38\u5728\u82B1\u4E1B\u51FA\u73B0", "\u6709\u4E24\u5BF9\u8272\u5F69\u6F02\u4EAE\u7684\u7FC5\u8180"] },
    { id: "animal-ant", word: "\u8682\u8681\u642C\u5BB6", hints: ["\u8BB8\u591A\u5C0F\u52A8\u7269\u5171\u540C\u884C\u52A8", "\u6392\u6210\u957F\u961F\u642C\u8FD0\u98DF\u7269"] },
    { id: "animal-cat-fishing", word: "\u5C0F\u732B\u9493\u9C7C", hints: ["\u52A8\u7269\u8FDB\u884C\u4EBA\u7C7B\u6D3B\u52A8", "\u732B\u62FF\u7740\u9C7C\u7AFF\u5750\u5728\u6C34\u8FB9"] },
    ...EXTRA_WORD_BANK.animals
  ],
  imagination: [
    { id: "idea-daydream", word: "\u767D\u65E5\u68A6", hints: ["\u4E00\u79CD\u8D70\u795E\u7684\u72B6\u6001", "\u9192\u7740\u7684\u65F6\u5019\u5C55\u5F00\u5E7B\u60F3"] },
    { id: "idea-time-travel", word: "\u7A7F\u8D8A\u65F6\u7A7A", hints: ["\u79D1\u5E7B\u6545\u4E8B\u4E2D\u5E38\u89C1", "\u4ECE\u73B0\u5728\u53BB\u5F80\u8FC7\u53BB\u6216\u672A\u6765"] },
    { id: "idea-invisible", word: "\u9690\u8EAB", hints: ["\u4E00\u79CD\u8D85\u80FD\u529B", "\u8BA9\u522B\u4EBA\u65E0\u6CD5\u770B\u89C1\u81EA\u5DF1"] },
    { id: "idea-moon-fishing", word: "\u6D77\u5E95\u635E\u6708", hints: ["\u548C\u6C34\u4E2D\u7684\u5F71\u50CF\u6709\u5173", "\u60F3\u4ECE\u6C34\u5E95\u635E\u8D77\u6708\u4EAE"] },
    { id: "idea-head-clouds", word: "\u817E\u4E91\u9A7E\u96FE", hints: ["\u795E\u8BDD\u91CC\u7684\u79FB\u52A8\u65B9\u5F0F", "\u4E58\u7740\u4E91\u96FE\u5728\u7A7A\u4E2D\u98DE\u884C"] },
    { id: "idea-cold-sweat", word: "\u5192\u51B7\u6C57", hints: ["\u7D27\u5F20\u65F6\u53EF\u80FD\u53D1\u751F", "\u989D\u5934\u51FA\u73B0\u6C57\u73E0"] },
    { id: "idea-star-eyes", word: "\u773C\u5192\u91D1\u661F", hints: ["\u53D7\u5230\u649E\u51FB\u540E\u53EF\u80FD\u51FA\u73B0", "\u773C\u524D\u4EFF\u4F5B\u6709\u661F\u661F\u65CB\u8F6C"] },
    { id: "idea-cat-computer", word: "\u732B\u54AA\u6572\u952E\u76D8", hints: ["\u52A8\u7269\u548C\u7535\u5B50\u8BBE\u5907\u7684\u7EC4\u5408", "\u722A\u5B50\u5728\u6309\u4E00\u6392\u6309\u952E"] },
    { id: "idea-flying-pig", word: "\u4F1A\u98DE\u7684\u732A", hints: ["\u4E00\u79CD\u4E0D\u5BFB\u5E38\u7684\u52A8\u7269", "\u5B83\u957F\u51FA\u4E86\u7FC5\u8180"] },
    { id: "idea-rain-candy", word: "\u7CD6\u679C\u96E8", hints: ["\u5929\u6C14\u548C\u96F6\u98DF\u7684\u7EC4\u5408", "\u4ECE\u5929\u7A7A\u843D\u4E0B\u751C\u98DF"] },
    { id: "idea-sleepwalking", word: "\u68A6\u6E38", hints: ["\u53D1\u751F\u5728\u7761\u7720\u671F\u95F4", "\u95ED\u7740\u773C\u775B\u4E0B\u5E8A\u6D3B\u52A8"] },
    { id: "idea-rocket-schoolbag", word: "\u706B\u7BAD\u4E66\u5305", hints: ["\u5B66\u4E60\u7528\u54C1\u548C\u822A\u5929\u5668\u7684\u7EC4\u5408", "\u80CC\u5728\u8EAB\u540E\u55B7\u706B\u5347\u7A7A"] },
    { id: "idea-frozen", word: "\u51BB\u6210\u51B0\u5757", hints: ["\u6E29\u5EA6\u975E\u5E38\u4F4E\u7684\u7ED3\u679C", "\u6574\u4E2A\u4EBA\u88AB\u900F\u660E\u65B9\u5757\u5305\u4F4F"] },
    { id: "idea-face-change", word: "\u77AC\u95F4\u53D8\u8138", hints: ["\u60C5\u7EEA\u6216\u8868\u6F14\u53D1\u751F\u53D8\u5316", "\u4E00\u7728\u773C\u6362\u4E86\u53E6\u4E00\u5F20\u8138"] },
    { id: "idea-mountain-food", word: "\u5806\u79EF\u5982\u5C71", hints: ["\u5F62\u5BB9\u6570\u91CF\u7279\u522B\u591A", "\u7269\u54C1\u5806\u5F97\u50CF\u4E00\u5EA7\u5C71"] },
    { id: "idea-lightbulb", word: "\u7075\u5149\u4E00\u95EA", hints: ["\u60F3\u5230\u529E\u6CD5\u65F6\u7684\u611F\u89C9", "\u8111\u888B\u65C1\u7A81\u7136\u4EAE\u8D77\u706F\u6CE1"] },
    { id: "idea-chicken-dance", word: "\u95FB\u9E21\u8D77\u821E", hints: ["\u548C\u6E05\u6668\u53CA\u7EC3\u4E60\u6709\u5173", "\u542C\u89C1\u9E21\u53EB\u5C31\u8D77\u5E8A\u821E\u5251"] },
    { id: "idea-fire-eyes", word: "\u706B\u773C\u91D1\u775B", hints: ["\u795E\u8BDD\u89D2\u8272\u7684\u7279\u6B8A\u672C\u9886", "\u773C\u775B\u53D1\u5149\u5E76\u80FD\u8BC6\u7834\u4F2A\u88C5"] },
    { id: "idea-laugh-floor", word: "\u7B11\u5230\u6253\u6EDA", hints: ["\u975E\u5E38\u5F00\u5FC3\u7684\u8868\u73B0", "\u8EBA\u5728\u5730\u4E0A\u4E00\u8FB9\u7B11\u4E00\u8FB9\u7FFB\u6EDA"] },
    { id: "idea-brainstorm", word: "\u8111\u6D1E\u5927\u5F00", hints: ["\u5F62\u5BB9\u60F3\u6CD5\u5F88\u6709\u521B\u610F", "\u8111\u888B\u6253\u5F00\u5E76\u5192\u51FA\u5947\u5999\u4E8B\u7269"] },
    { id: "idea-walking-on-air", word: "\u98D8\u98D8\u7136", hints: ["\u4E00\u79CD\u8F7B\u76C8\u5F97\u610F\u7684\u72B6\u6001", "\u6574\u4E2A\u4EBA\u50CF\u6C14\u7403\u4E00\u6837\u79BB\u5F00\u5730\u9762"] },
    { id: "idea-head-fire", word: "\u6012\u706B\u51B2\u5929", hints: ["\u5F62\u5BB9\u975E\u5E38\u751F\u6C14", "\u5934\u9876\u5192\u51FA\u76F4\u51B2\u5929\u7A7A\u7684\u706B\u7130"] },
    { id: "idea-rainbow-bridge", word: "\u5F69\u8679\u6865", hints: ["\u81EA\u7136\u666F\u8C61\u548C\u5EFA\u7B51\u7684\u7EC4\u5408", "\u4E03\u5F69\u5F27\u7EBF\u8FDE\u63A5\u5929\u7A7A\u4E24\u7AEF"] },
    { id: "idea-fish-bicycle", word: "\u9A91\u8F66\u7684\u9C7C", hints: ["\u5947\u5999\u7684\u52A8\u7269\u7EC4\u5408", "\u9C7C\u5750\u5728\u81EA\u884C\u8F66\u4E0A\u8E29\u8E0F\u677F"] },
    { id: "idea-cloud-bed", word: "\u4E91\u6735\u5E8A", hints: ["\u67D4\u8F6F\u7684\u5E7B\u60F3\u7269\u54C1", "\u4EBA\u5728\u5929\u7A7A\u7684\u767D\u4E91\u4E0A\u7761\u89C9"] },
    { id: "idea-pocket-moon", word: "\u53E3\u888B\u6708\u4EAE", hints: ["\u4E0D\u53EF\u80FD\u7684\u6536\u85CF", "\u4ECE\u8863\u670D\u53E3\u888B\u638F\u51FA\u53D1\u5149\u6708\u7259"] },
    { id: "idea-tree-house", word: "\u6811\u4E0A\u57CE\u5821", hints: ["\u5EFA\u7B51\u4E0E\u690D\u7269\u7684\u7EC4\u5408", "\u9AD8\u5927\u6811\u51A0\u4E0A\u5EFA\u7740\u5854\u697C"] },
    { id: "idea-frozen-time", word: "\u65F6\u95F4\u9759\u6B62", hints: ["\u79D1\u5E7B\u80FD\u529B", "\u949F\u8868\u548C\u5468\u56F4\u52A8\u4F5C\u5168\u90E8\u505C\u4F4F"] },
    { id: "idea-shadow-run", word: "\u5F71\u5B50\u9003\u8DD1", hints: ["\u4E0D\u5BFB\u5E38\u7684\u73B0\u8C61", "\u5730\u4E0A\u7684\u9ED1\u5F71\u79BB\u5F00\u4E3B\u4EBA\u5954\u8DD1"] },
    { id: "idea-mouse-giant", word: "\u5DE8\u578B\u8001\u9F20", hints: ["\u5C3A\u5BF8\u98A0\u5012\u7684\u573A\u666F", "\u8001\u9F20\u6BD4\u65C1\u8FB9\u7684\u623F\u5B50\u8FD8\u5927"] },
    ...EXTRA_WORD_BANK.imagination
  ],
  food: [
    { id: "food-hotpot", word: "\u706B\u9505", hints: ["\u5927\u5BB6\u5E38\u56F4\u5750\u7740\u5403", "\u98DF\u6750\u653E\u8FDB\u6EDA\u70EB\u6C64\u5E95"] },
    { id: "food-dumpling", word: "\u997A\u5B50", hints: ["\u5E38\u89C1\u7684\u9762\u98DF", "\u9762\u76AE\u5305\u7740\u9985\u5E76\u634F\u51FA\u8936\u8FB9"] },
    { id: "food-baozi", word: "\u5305\u5B50", hints: ["\u84B8\u7B3C\u91CC\u5E38\u89C1", "\u5706\u9F13\u9F13\u7684\u9762\u76AE\u91CC\u9762\u6709\u9985"] },
    { id: "food-noodles", word: "\u62C9\u9762", hints: ["\u4E00\u79CD\u6761\u72B6\u4E3B\u98DF", "\u5E08\u5085\u4F1A\u628A\u9762\u56E2\u53CD\u590D\u62C9\u957F"] },
    { id: "food-rice-roll", word: "\u5BFF\u53F8", hints: ["\u5E38\u89C1\u7684\u51B7\u98DF", "\u7C73\u996D\u548C\u914D\u6599\u5377\u5728\u4E00\u8D77"] },
    { id: "food-pizza", word: "\u62AB\u8428", hints: ["\u901A\u5E38\u5207\u6210\u4E09\u89D2\u5F62\u5206\u4EAB", "\u5706\u997C\u4E0A\u94FA\u7740\u829D\u58EB\u548C\u914D\u6599"] },
    { id: "food-hamburger", word: "\u6C49\u5821", hints: ["\u5E38\u7528\u53CC\u624B\u62FF\u7740\u5403", "\u4E24\u7247\u5706\u9762\u5305\u5939\u7740\u8089\u548C\u852C\u83DC"] },
    { id: "food-cake", word: "\u751F\u65E5\u86CB\u7CD5", hints: ["\u5E86\u795D\u65F6\u5E38\u51FA\u73B0", "\u4E0A\u9762\u901A\u5E38\u63D2\u7740\u8721\u70DB"] },
    { id: "food-icecream", word: "\u51B0\u6DC7\u6DCB", hints: ["\u5929\u6C14\u70ED\u65F6\u5F88\u53D7\u6B22\u8FCE", "\u51B0\u51C9\u751C\u54C1\u5E38\u88C5\u5728\u8106\u7B52\u4E0A"] },
    { id: "food-popcorn", word: "\u7206\u7C73\u82B1", hints: ["\u770B\u7535\u5F71\u65F6\u5E38\u5403", "\u7389\u7C73\u7C92\u52A0\u70ED\u540E\u81A8\u80C0\u5F00\u82B1"] },
    { id: "food-milk-tea", word: "\u73CD\u73E0\u5976\u8336", hints: ["\u4E00\u79CD\u751C\u996E\u6599", "\u676F\u5E95\u6709\u8BB8\u591A\u9ED1\u8272\u5C0F\u5706\u7403"] },
    { id: "food-coffee", word: "\u5496\u5561", hints: ["\u5E38\u7528\u676F\u5B50\u76DB\u88C5", "\u6DF1\u8272\u996E\u54C1\u5E26\u6709\u70D8\u7119\u9999\u6C14"] },
    { id: "food-watermelon", word: "\u897F\u74DC", hints: ["\u590F\u5929\u5E38\u89C1\u7684\u6C34\u679C", "\u7EFF\u8272\u5916\u76AE\u91CC\u6709\u7EA2\u8272\u679C\u8089"] },
    { id: "food-pineapple", word: "\u83E0\u841D", hints: ["\u4E00\u79CD\u70ED\u5E26\u6C34\u679C", "\u5916\u76AE\u7C97\u7CD9\u4E14\u9876\u90E8\u6709\u53F6\u51A0"] },
    { id: "food-strawberry", word: "\u8349\u8393", hints: ["\u4F53\u578B\u4E0D\u5927\u7684\u6C34\u679C", "\u7EA2\u8272\u8868\u9762\u5E03\u6EE1\u5C0F\u7C7D"] },
    { id: "food-corn", word: "\u7389\u7C73", hints: ["\u957F\u5728\u9AD8\u9AD8\u7684\u79C6\u4E0A", "\u5265\u5F00\u53F6\u5B50\u662F\u4E00\u6392\u6392\u9EC4\u8272\u9897\u7C92"] },
    { id: "food-fried-egg", word: "\u714E\u9E21\u86CB", hints: ["\u65E9\u9910\u91CC\u5E38\u89C1", "\u767D\u8272\u5706\u9762\u4E2D\u95F4\u6709\u9EC4\u8272\u86CB\u9EC4"] },
    { id: "food-kebab", word: "\u70E4\u4E32", hints: ["\u591C\u5E02\u91CC\u5E38\u89C1", "\u98DF\u6750\u7A7F\u5728\u7EC6\u7B7E\u4E0A\u52A0\u70ED"] },
    { id: "food-lollipop", word: "\u68D2\u68D2\u7CD6", hints: ["\u5C0F\u670B\u53CB\u719F\u6089\u7684\u751C\u98DF", "\u7CD6\u5757\u4E0B\u9762\u8FDE\u7740\u4E00\u6839\u5C0F\u68CD"] },
    { id: "food-french-fries", word: "\u85AF\u6761", hints: ["\u5E38\u88C5\u5728\u7EB8\u76D2\u91CC", "\u4E00\u6839\u6839\u91D1\u9EC4\u8272\u7684\u571F\u8C46\u6761"] },
    { id: "food-hot-dog", word: "\u70ED\u72D7", hints: ["\u5E38\u89C1\u7684\u8857\u5934\u98DF\u54C1", "\u957F\u9762\u5305\u4E2D\u5939\u7740\u4E00\u6839\u9999\u80A0"] },
    { id: "food-cupcake", word: "\u7EB8\u676F\u86CB\u7CD5", hints: ["\u5C0F\u5DE7\u7684\u751C\u70B9", "\u86CB\u7CD5\u88C5\u5728\u7EB8\u6258\u91CC\u5E76\u9876\u7740\u5976\u6CB9"] },
    { id: "food-cookie", word: "\u66F2\u5947\u997C\u5E72", hints: ["\u9165\u8106\u7684\u5C0F\u96F6\u98DF", "\u5706\u5F62\u997C\u4E0A\u5E38\u6709\u5DE7\u514B\u529B\u8C46"] },
    { id: "food-bubble-tea", word: "\u6C34\u679C\u8336", hints: ["\u88C5\u5728\u900F\u660E\u676F\u4E2D\u7684\u996E\u6599", "\u6C34\u91CC\u80FD\u770B\u5230\u6C34\u679C\u5207\u7247"] },
    { id: "food-banana", word: "\u9999\u8549", hints: ["\u5E38\u89C1\u6C34\u679C", "\u9EC4\u8272\u5F2F\u5F2F\u7684\u5916\u5F62\u50CF\u6708\u7259"] },
    { id: "food-cherry", word: "\u6A31\u6843", hints: ["\u5C0F\u5DE7\u7684\u7EA2\u8272\u6C34\u679C", "\u4E24\u4E2A\u5706\u679C\u5E38\u7531\u7EC6\u6897\u8FDE\u5728\u4E00\u8D77"] },
    { id: "food-mushroom", word: "\u8611\u83C7", hints: ["\u53EF\u98DF\u7528\u4E5F\u6709\u91CE\u751F\u79CD\u7C7B", "\u9876\u90E8\u50CF\u4E00\u628A\u5706\u5706\u7684\u5C0F\u4F1E"] },
    { id: "food-bento", word: "\u76D2\u996D", hints: ["\u65B9\u4FBF\u643A\u5E26\u7684\u4E00\u9910", "\u683C\u5B50\u9910\u76D2\u91CC\u88C5\u7740\u996D\u548C\u83DC"] },
    { id: "food-steamed-fish", word: "\u6E05\u84B8\u9C7C", hints: ["\u4E00\u9053\u5B8C\u6574\u9C7C\u5F62\u7684\u83DC", "\u76D8\u5B50\u91CC\u6709\u9C7C\u3001\u8471\u4E1D\u548C\u70ED\u6C14"] },
    { id: "food-toast", word: "\u70E4\u9762\u5305", hints: ["\u65E9\u9910\u5E38\u89C1\u52A8\u4F5C", "\u9762\u5305\u7247\u4ECE\u673A\u5668\u91CC\u5F39\u51FA\u6765"] },
    ...EXTRA_WORD_BANK.food
  ],
  sports: [
    { id: "sport-football", word: "\u8E22\u8DB3\u7403", hints: ["\u5728\u8349\u5730\u7403\u573A\u8FDB\u884C", "\u7528\u811A\u628A\u7403\u9001\u8FDB\u7403\u95E8"] },
    { id: "sport-basketball", word: "\u6253\u7BEE\u7403", hints: ["\u4E00\u79CD\u56E2\u961F\u7403\u7C7B\u8FD0\u52A8", "\u628A\u7403\u6295\u8FDB\u9AD8\u5904\u7684\u7BEE\u7B50"] },
    { id: "sport-badminton", word: "\u6253\u7FBD\u6BDB\u7403", hints: ["\u9694\u7740\u7403\u7F51\u8FDB\u884C", "\u7403\u62CD\u51FB\u6253\u4E00\u53EA\u5E26\u7FBD\u6BDB\u7684\u7403"] },
    { id: "sport-table-tennis", word: "\u6253\u4E52\u4E53\u7403", hints: ["\u5728\u684C\u5B50\u4E24\u8FB9\u8FDB\u884C", "\u7528\u5C0F\u7403\u62CD\u51FB\u6253\u767D\u8272\u5C0F\u7403"] },
    { id: "sport-swimming", word: "\u6E38\u6CF3", hints: ["\u5728\u6C34\u4E2D\u8FDB\u884C", "\u6325\u52A8\u56DB\u80A2\u5411\u524D\u79FB\u52A8"] },
    { id: "sport-skiing", word: "\u6ED1\u96EA", hints: ["\u51AC\u5B63\u6237\u5916\u8FD0\u52A8", "\u8E29\u7740\u4E24\u5757\u957F\u677F\u4ECE\u96EA\u5761\u6ED1\u4E0B"] },
    { id: "sport-skating", word: "\u6ED1\u51B0", hints: ["\u5728\u5149\u6ED1\u51B0\u9762\u4E0A\u8FDB\u884C", "\u978B\u5E95\u88C5\u6709\u7EC6\u957F\u51B0\u5200"] },
    { id: "sport-boxing", word: "\u62F3\u51FB", hints: ["\u53CC\u65B9\u5728\u64C2\u53F0\u8F83\u91CF", "\u6234\u7740\u539A\u624B\u5957\u6325\u62F3\u8FDB\u653B"] },
    { id: "sport-archery", word: "\u5C04\u7BAD", hints: ["\u9700\u8981\u7784\u51C6\u8FDC\u5904\u76EE\u6807", "\u62C9\u5F00\u5F13\u5F26\u8BA9\u7BAD\u98DE\u5411\u9776\u5FC3"] },
    { id: "sport-weightlifting", word: "\u4E3E\u91CD", hints: ["\u529B\u91CF\u578B\u6BD4\u8D5B\u9879\u76EE", "\u628A\u5E26\u5706\u76D8\u7684\u6760\u94C3\u4E3E\u8FC7\u5934\u9876"] },
    { id: "sport-high-jump", word: "\u8DF3\u9AD8", hints: ["\u7530\u5F84\u6BD4\u8D5B\u9879\u76EE", "\u52A9\u8DD1\u540E\u8D8A\u8FC7\u4E00\u6839\u6A2A\u6746"] },
    { id: "sport-marathon", word: "\u9A6C\u62C9\u677E", hints: ["\u957F\u8DDD\u79BB\u8010\u529B\u9879\u76EE", "\u8BB8\u591A\u4EBA\u6CBF\u516C\u8DEF\u957F\u65F6\u95F4\u5954\u8DD1"] },
    { id: "sport-relay", word: "\u63A5\u529B\u8D5B", hints: ["\u591A\u4EBA\u7EC4\u961F\u5B8C\u6210", "\u8DD1\u52A8\u65F6\u628A\u4E00\u6839\u77ED\u68D2\u4EA4\u7ED9\u961F\u53CB"] },
    { id: "sport-surfing", word: "\u51B2\u6D6A", hints: ["\u5728\u6D77\u9762\u8FDB\u884C", "\u7AD9\u5728\u677F\u4E0A\u8FFD\u9010\u6D77\u6D6A"] },
    { id: "sport-climbing", word: "\u6500\u5CA9", hints: ["\u9700\u8981\u624B\u811A\u5E76\u7528", "\u6CBF\u7740\u9661\u5CED\u5CA9\u58C1\u5411\u4E0A\u722C"] },
    { id: "sport-cycling", word: "\u9A91\u81EA\u884C\u8F66", hints: ["\u5E38\u89C1\u7684\u6237\u5916\u6D3B\u52A8", "\u63E1\u4F4F\u8F66\u628A\u5E76\u7528\u53CC\u811A\u8E29\u8E0F\u677F"] },
    { id: "sport-tug-war", word: "\u62D4\u6CB3", hints: ["\u4E24\u961F\u5171\u540C\u53C2\u4E0E", "\u5927\u5BB6\u6293\u4F4F\u957F\u7EF3\u5411\u76F8\u53CD\u65B9\u5411\u62C9"] },
    { id: "sport-gymnastics", word: "\u4F53\u64CD", hints: ["\u5F3A\u8C03\u67D4\u97E7\u4E0E\u5E73\u8861", "\u8FD0\u52A8\u5458\u4F1A\u7FFB\u817E\u548C\u65CB\u8F6C"] },
    { id: "sport-fencing", word: "\u51FB\u5251", hints: ["\u4E24\u4EBA\u7A7F\u7740\u62A4\u5177\u6BD4\u8D5B", "\u624B\u6301\u7EC6\u5251\u4E92\u76F8\u523A\u51FB\u5F97\u5206"] },
    { id: "sport-bowling", word: "\u4FDD\u9F84\u7403", hints: ["\u5728\u5BA4\u5185\u957F\u7403\u9053\u8FDB\u884C", "\u6EDA\u51FA\u91CD\u7403\u649E\u5012\u4E00\u6392\u74F6\u72B6\u7269"] },
    { id: "sport-tennis", word: "\u6253\u7F51\u7403", hints: ["\u9694\u7F51\u8FDB\u884C\u7684\u7403\u7C7B\u8FD0\u52A8", "\u7528\u7403\u62CD\u51FB\u6253\u7EFF\u8272\u5C0F\u7403"] },
    { id: "sport-volleyball", word: "\u6253\u6392\u7403", hints: ["\u591A\u4EBA\u56E2\u961F\u8FD0\u52A8", "\u53CC\u624B\u628A\u7403\u57AB\u8FC7\u9AD8\u7F51"] },
    { id: "sport-diving", word: "\u8DF3\u6C34", hints: ["\u4ECE\u9AD8\u5904\u8FDB\u5165\u6C34\u4E2D", "\u8FD0\u52A8\u5458\u7FFB\u8F6C\u540E\u7B14\u76F4\u843D\u5165\u6CF3\u6C60"] },
    { id: "sport-skateboard", word: "\u6ED1\u6ED1\u677F", hints: ["\u8857\u5934\u8FD0\u52A8", "\u7AD9\u5728\u5E26\u56DB\u4E2A\u8F6E\u5B50\u7684\u77ED\u677F\u4E0A"] },
    { id: "sport-hula-hoop", word: "\u8F6C\u547C\u5566\u5708", hints: ["\u4F11\u95F2\u5065\u8EAB\u6D3B\u52A8", "\u8BA9\u5706\u73AF\u7ED5\u7740\u8170\u90E8\u65CB\u8F6C"] },
    { id: "sport-jump-rope", word: "\u8DF3\u7EF3", hints: ["\u4E00\u4EBA\u5C31\u80FD\u8FDB\u884C", "\u53CC\u624B\u6447\u7EF3\u5E76\u8FDE\u7EED\u8DF3\u8FC7"] },
    { id: "sport-golf", word: "\u6253\u9AD8\u5C14\u592B", hints: ["\u5728\u5927\u7247\u8349\u5730\u8FDB\u884C", "\u6325\u6746\u628A\u5C0F\u7403\u6253\u8FDB\u8FDC\u5904\u6D1E\u4E2D"] },
    { id: "sport-rowing", word: "\u5212\u8239", hints: ["\u5728\u6C34\u9762\u8FDB\u884C", "\u5750\u5728\u8239\u4E0A\u7528\u6868\u63A8\u52A8\u524D\u8FDB"] },
    { id: "sport-parachute", word: "\u8DF3\u4F1E", hints: ["\u4ECE\u5F88\u9AD8\u5904\u5F00\u59CB", "\u80CC\u540E\u5F20\u5F00\u5DE8\u5927\u4F1E\u9762\u7F13\u6162\u4E0B\u964D"] },
    { id: "sport-medal", word: "\u9886\u5956\u724C", hints: ["\u6BD4\u8D5B\u7ED3\u675F\u540E\u7684\u573A\u666F", "\u7AD9\u5728\u9886\u5956\u53F0\u8BA9\u4EBA\u6302\u4E0A\u5956\u724C"] },
    ...EXTRA_WORD_BANK.sports
  ],
  places: [
    { id: "place-airport", word: "\u673A\u573A", hints: ["\u65C5\u884C\u65F6\u53EF\u80FD\u7ECF\u8FC7", "\u98DE\u673A\u5728\u957F\u8DD1\u9053\u4E0A\u8D77\u964D"] },
    { id: "place-station", word: "\u706B\u8F66\u7AD9", hints: ["\u4EA4\u901A\u67A2\u7EBD", "\u4E58\u5BA2\u5728\u7AD9\u53F0\u7B49\u5F85\u5217\u8F66"] },
    { id: "place-subway", word: "\u5730\u94C1\u7AD9", hints: ["\u57CE\u5E02\u4EA4\u901A\u573A\u6240", "\u5217\u8F66\u591A\u5728\u5730\u4E0B\u96A7\u9053\u4E2D\u505C\u9760"] },
    { id: "place-school", word: "\u5B66\u6821", hints: ["\u8BB8\u591A\u4EBA\u5728\u8FD9\u91CC\u6210\u957F", "\u6709\u6559\u5BA4\u3001\u64CD\u573A\u548C\u8001\u5E08"] },
    { id: "place-hospital", word: "\u533B\u9662", hints: ["\u8EAB\u4F53\u4E0D\u8212\u670D\u65F6\u4F1A\u53BB", "\u533B\u751F\u548C\u62A4\u58EB\u5728\u8FD9\u91CC\u5DE5\u4F5C"] },
    { id: "place-library", word: "\u56FE\u4E66\u9986", hints: ["\u9700\u8981\u4FDD\u6301\u5B89\u9759", "\u4E00\u6392\u6392\u4E66\u67B6\u4F9B\u4EBA\u9605\u8BFB\u501F\u9605"] },
    { id: "place-supermarket", word: "\u8D85\u5E02", hints: ["\u65E5\u5E38\u8D2D\u7269\u573A\u6240", "\u63A8\u7740\u8D2D\u7269\u8F66\u4ECE\u8D27\u67B6\u6311\u9009\u5546\u54C1"] },
    { id: "place-cinema", word: "\u7535\u5F71\u9662", hints: ["\u4F11\u95F2\u5A31\u4E50\u573A\u6240", "\u4EBA\u4EEC\u9762\u5BF9\u5927\u94F6\u5E55\u5750\u6210\u5F88\u591A\u6392"] },
    { id: "place-amusement-park", word: "\u6E38\u4E50\u56ED", hints: ["\u5145\u6EE1\u6B22\u7B11\u7684\u573A\u6240", "\u6709\u8FC7\u5C71\u8F66\u548C\u65CB\u8F6C\u6728\u9A6C"] },
    { id: "place-zoo", word: "\u52A8\u7269\u56ED", hints: ["\u9002\u5408\u89C2\u5BDF\u52A8\u7269", "\u4E0D\u540C\u52A8\u7269\u4F4F\u5728\u5404\u81EA\u56ED\u533A"] },
    { id: "place-aquarium", word: "\u6D77\u6D0B\u9986", hints: ["\u5BA4\u5185\u53C2\u89C2\u573A\u6240", "\u9694\u7740\u5DE8\u5927\u73BB\u7483\u770B\u9C7C\u7FA4\u6E38\u8FC7"] },
    { id: "place-museum", word: "\u535A\u7269\u9986", hints: ["\u6536\u85CF\u548C\u5C55\u793A\u7269\u54C1", "\u5C55\u67DC\u91CC\u9648\u5217\u5386\u53F2\u6216\u827A\u672F\u5C55\u54C1"] },
    { id: "place-lighthouse", word: "\u706F\u5854", hints: ["\u5E38\u5EFA\u5728\u6D77\u5CB8\u9644\u8FD1", "\u9AD8\u5854\u9876\u7AEF\u53D1\u5149\u4E3A\u8239\u53EA\u6307\u8DEF"] },
    { id: "place-castle", word: "\u57CE\u5821", hints: ["\u6545\u4E8B\u91CC\u5E38\u51FA\u73B0", "\u9AD8\u5899\u3001\u5854\u697C\u548C\u5927\u95E8\u7EC4\u6210\u5EFA\u7B51"] },
    { id: "place-bridge", word: "\u5927\u6865", hints: ["\u8DE8\u8D8A\u969C\u788D\u7684\u5EFA\u7B51", "\u628A\u6CB3\u6D41\u4E24\u5CB8\u8FDE\u63A5\u8D77\u6765"] },
    { id: "place-tunnel", word: "\u96A7\u9053", hints: ["\u4EA4\u901A\u7EBF\u8DEF\u7684\u4E00\u90E8\u5206", "\u8F66\u8F86\u4ECE\u5C71\u4F53\u6216\u5730\u4E0B\u7A7F\u8FC7"] },
    { id: "place-campsite", word: "\u9732\u8425\u5730", hints: ["\u6237\u5916\u8FC7\u591C\u7684\u5730\u65B9", "\u8349\u5730\u4E0A\u642D\u7740\u5E10\u7BF7\u548C\u7BDD\u706B"] },
    { id: "place-beach", word: "\u6D77\u6EE9", hints: ["\u5EA6\u5047\u573A\u666F", "\u6D77\u6D6A\u62CD\u6253\u5927\u7247\u6C99\u5B50"] },
    { id: "place-farm", word: "\u519C\u573A", hints: ["\u8FDC\u79BB\u57CE\u5E02\u7684\u751F\u4EA7\u573A\u6240", "\u6709\u7530\u5730\u3001\u8C37\u4ED3\u548C\u7272\u755C"] },
    { id: "place-restaurant", word: "\u9910\u5385", hints: ["\u4EBA\u4EEC\u5728\u8FD9\u91CC\u7528\u9910", "\u684C\u6905\u4E4B\u95F4\u6709\u670D\u52A1\u5458\u7AEF\u83DC"] },
    { id: "place-post-office", word: "\u90AE\u5C40", hints: ["\u529E\u7406\u5BC4\u9001\u4E1A\u52A1", "\u67DC\u53F0\u65C1\u6709\u4FE1\u5C01\u3001\u90AE\u7968\u548C\u5305\u88F9"] },
    { id: "place-bank", word: "\u94F6\u884C", hints: ["\u529E\u7406\u94B1\u6B3E\u4E1A\u52A1", "\u67DC\u53F0\u548C\u53D6\u6B3E\u673A\u90FD\u80FD\u5728\u8FD9\u91CC\u89C1\u5230"] },
    { id: "place-gas-station", word: "\u52A0\u6CB9\u7AD9", hints: ["\u8F66\u8F86\u9014\u4E2D\u4F1A\u505C\u9760", "\u6CB9\u67AA\u4ECE\u673A\u5668\u8FDE\u63A5\u5230\u6C7D\u8F66"] },
    { id: "place-playground", word: "\u64CD\u573A", hints: ["\u5B66\u6821\u91CC\u5E38\u89C1", "\u6709\u8DD1\u9053\u3001\u7403\u573A\u548C\u65D7\u6746"] },
    { id: "place-bus-stop", word: "\u516C\u4EA4\u7AD9", hints: ["\u8DEF\u8FB9\u7B49\u8F66\u7684\u5730\u65B9", "\u7AD9\u724C\u65C1\u6709\u4EBA\u6392\u961F\u7B49\u5019"] },
    { id: "place-temple", word: "\u5BFA\u5E99", hints: ["\u4F20\u7EDF\u5EFA\u7B51\u573A\u6240", "\u5C4B\u6A90\u7FD8\u8D77\u5E76\u6709\u9999\u7089"] },
    { id: "place-waterfall", word: "\u7011\u5E03", hints: ["\u81EA\u7136\u666F\u89C2", "\u5927\u7247\u6C34\u6D41\u4ECE\u9AD8\u5904\u843D\u4E0B"] },
    { id: "place-volcano", word: "\u706B\u5C71", hints: ["\u4E00\u79CD\u7279\u6B8A\u5C71\u4F53", "\u5C71\u9876\u55B7\u51FA\u5CA9\u6D46\u548C\u70DF\u96FE"] },
    { id: "place-space-station", word: "\u7A7A\u95F4\u7AD9", hints: ["\u4F4D\u4E8E\u5730\u7403\u4E4B\u5916", "\u5927\u578B\u8231\u4F53\u5E26\u7740\u592A\u9633\u80FD\u677F\u7ED5\u884C"] },
    { id: "place-treehouse", word: "\u6811\u5C4B", hints: ["\u5EFA\u5728\u7279\u6B8A\u4F4D\u7F6E\u7684\u5C0F\u5C4B", "\u623F\u5B50\u67B6\u5728\u7C97\u5927\u6811\u679D\u4E4B\u95F4"] },
    ...EXTRA_WORD_BANK.places
  ],
  jobs: [
    { id: "job-doctor", word: "\u533B\u751F", hints: ["\u5E2E\u52A9\u751F\u75C5\u7684\u4EBA", "\u5E38\u7A7F\u767D\u5927\u8902\u5E76\u4F7F\u7528\u542C\u8BCA\u5668"] },
    { id: "job-firefighter", word: "\u6D88\u9632\u5458", hints: ["\u5904\u7406\u5371\u9669\u73B0\u573A", "\u7A7F\u9632\u62A4\u670D\u62FF\u6C34\u67AA\u6251\u706D\u706B\u7130"] },
    { id: "job-police", word: "\u8B66\u5BDF", hints: ["\u7EF4\u62A4\u516C\u5171\u5B89\u5168", "\u7A7F\u5236\u670D\u5E76\u4F69\u6234\u8B66\u5FBD"] },
    { id: "job-teacher", word: "\u8001\u5E08", hints: ["\u5728\u5B66\u6821\u5DE5\u4F5C", "\u7AD9\u5728\u8BB2\u53F0\u524D\u7ED9\u5B66\u751F\u4E0A\u8BFE"] },
    { id: "job-chef", word: "\u53A8\u5E08", hints: ["\u5728\u53A8\u623F\u5DE5\u4F5C", "\u6234\u9AD8\u5E3D\u62FF\u9505\u94F2\u70F9\u996A\u98DF\u7269"] },
    { id: "job-pilot", word: "\u98DE\u884C\u5458", hints: ["\u5728\u9AD8\u7A7A\u5DE5\u4F5C", "\u5750\u5728\u9A7E\u9A76\u8231\u64CD\u7EB5\u98DE\u673A"] },
    { id: "job-astronaut", word: "\u5B87\u822A\u5458", hints: ["\u63A2\u7D22\u5730\u7403\u4E4B\u5916", "\u7A7F\u539A\u91CD\u822A\u5929\u670D\u6F02\u6D6E\u5728\u592A\u7A7A"] },
    { id: "job-farmer", word: "\u519C\u6C11", hints: ["\u5728\u7530\u5730\u91CC\u52B3\u4F5C", "\u4F7F\u7528\u519C\u5177\u64AD\u79CD\u548C\u6536\u83B7\u5E84\u7A3C"] },
    { id: "job-photographer", word: "\u6444\u5F71\u5E08", hints: ["\u8BB0\u5F55\u753B\u9762\u7684\u4EBA", "\u4E3E\u7740\u76F8\u673A\u5BFB\u627E\u5408\u9002\u89D2\u5EA6"] },
    { id: "job-painter", word: "\u753B\u5BB6", hints: ["\u4ECE\u4E8B\u827A\u672F\u521B\u4F5C", "\u62FF\u753B\u7B14\u5728\u753B\u5E03\u4E0A\u6D82\u8272"] },
    { id: "job-singer", word: "\u6B4C\u624B", hints: ["\u7528\u58F0\u97F3\u8868\u6F14", "\u7AD9\u5728\u821E\u53F0\u4E0A\u62FF\u7740\u9EA6\u514B\u98CE"] },
    { id: "job-magician", word: "\u9B54\u672F\u5E08", hints: ["\u5E26\u6765\u795E\u5947\u8868\u6F14", "\u4ECE\u5E3D\u5B50\u91CC\u53D8\u51FA\u610F\u5916\u7684\u4E1C\u897F"] },
    { id: "job-barber", word: "\u7406\u53D1\u5E08", hints: ["\u6539\u53D8\u5BA2\u4EBA\u7684\u53D1\u578B", "\u624B\u62FF\u526A\u5200\u5728\u955C\u5B50\u524D\u5DE5\u4F5C"] },
    { id: "job-postman", word: "\u5FEB\u9012\u5458", hints: ["\u7A7F\u68AD\u5728\u8857\u9053\u793E\u533A", "\u9A91\u8F66\u628A\u5305\u88F9\u9001\u5230\u6536\u4EF6\u4EBA\u624B\u4E2D"] },
    { id: "job-builder", word: "\u5EFA\u7B51\u5DE5\u4EBA", hints: ["\u5728\u5DE5\u5730\u5DE5\u4F5C", "\u6234\u5B89\u5168\u5E3D\u4F7F\u7528\u5DE5\u5177\u5EFA\u9020\u623F\u5C4B"] },
    { id: "job-scientist", word: "\u79D1\u5B66\u5BB6", hints: ["\u7814\u7A76\u672A\u77E5\u95EE\u9898", "\u5E38\u5728\u5B9E\u9A8C\u5BA4\u89C2\u5BDF\u548C\u8BB0\u5F55"] },
    { id: "job-dentist", word: "\u7259\u533B", hints: ["\u4E00\u79CD\u533B\u7597\u804C\u4E1A", "\u4F7F\u7528\u5C0F\u5DE5\u5177\u68C0\u67E5\u4EBA\u7684\u7259\u9F7F"] },
    { id: "job-diver", word: "\u6F5C\u6C34\u5458", hints: ["\u5728\u6C34\u4E0B\u6D3B\u52A8", "\u80CC\u6C27\u6C14\u74F6\u6234\u9762\u955C\u63A2\u7D22\u6D77\u5E95"] },
    { id: "job-sailor", word: "\u8239\u5458", hints: ["\u957F\u671F\u5728\u6C34\u4E0A\u5DE5\u4F5C", "\u7AD9\u5728\u7532\u677F\u64CD\u63A7\u8239\u53EA"] },
    { id: "job-conductor", word: "\u4EA4\u8B66", hints: ["\u5728\u9053\u8DEF\u4E0A\u5DE5\u4F5C", "\u7AD9\u5728\u8DEF\u53E3\u7528\u624B\u52BF\u6307\u6325\u8F66\u8F86"] },
    { id: "job-nurse", word: "\u62A4\u58EB", hints: ["\u5728\u533B\u7597\u573A\u6240\u5DE5\u4F5C", "\u7167\u987E\u75C5\u4EBA\u5E76\u534F\u52A9\u533B\u751F"] },
    { id: "job-vet", word: "\u517D\u533B", hints: ["\u7279\u6B8A\u7684\u533B\u7597\u804C\u4E1A", "\u62FF\u542C\u8BCA\u5668\u4E3A\u5C0F\u52A8\u7269\u68C0\u67E5\u8EAB\u4F53"] },
    { id: "job-baker", word: "\u9762\u5305\u5E08", hints: ["\u5728\u70D8\u7119\u623F\u5DE5\u4F5C", "\u628A\u9762\u56E2\u9001\u8FDB\u70E4\u7089\u53D8\u6210\u9762\u5305"] },
    { id: "job-waiter", word: "\u670D\u52A1\u5458", hints: ["\u5728\u9910\u5385\u5E38\u89C1", "\u7AEF\u7740\u6258\u76D8\u628A\u83DC\u9001\u5230\u684C\u8FB9"] },
    { id: "job-programmer", word: "\u7A0B\u5E8F\u5458", hints: ["\u5E38\u4F7F\u7528\u7535\u5B50\u8BBE\u5907\u5DE5\u4F5C", "\u9762\u5BF9\u591A\u5757\u5C4F\u5E55\u6572\u952E\u76D8\u5199\u4EE3\u7801"] },
    { id: "job-reporter", word: "\u8BB0\u8005", hints: ["\u8BB0\u5F55\u548C\u4F20\u64AD\u65B0\u95FB", "\u62FF\u7740\u8BDD\u7B52\u5728\u73B0\u573A\u91C7\u8BBF"] },
    { id: "job-librarian", word: "\u56FE\u4E66\u7BA1\u7406\u5458", hints: ["\u5728\u5B89\u9759\u573A\u6240\u5DE5\u4F5C", "\u6574\u7406\u4E66\u67B6\u5E76\u529E\u7406\u501F\u4E66"] },
    { id: "job-train-driver", word: "\u706B\u8F66\u53F8\u673A", hints: ["\u9A7E\u9A76\u5927\u578B\u4EA4\u901A\u5DE5\u5177", "\u5750\u5728\u8F66\u5934\u63A7\u5236\u5217\u8F66\u524D\u8FDB"] },
    { id: "job-gardener", word: "\u56ED\u4E01", hints: ["\u7167\u6599\u690D\u7269\u7684\u4EBA", "\u62FF\u6C34\u58F6\u548C\u526A\u5200\u4FEE\u6574\u82B1\u56ED"] },
    { id: "job-courier", word: "\u5916\u5356\u5458", hints: ["\u5728\u57CE\u5E02\u8857\u9053\u7A7F\u884C", "\u9A91\u8F66\u5E26\u7740\u9910\u7BB1\u9001\u98DF\u7269"] },
    ...EXTRA_WORD_BANK.jobs
  ],
  culture: [
    { id: "culture-new-year", word: "\u8D34\u6625\u8054", hints: ["\u65B0\u5E74\u4E60\u4FD7", "\u628A\u7EA2\u8272\u5BF9\u8054\u8D34\u5728\u5927\u95E8\u4E24\u8FB9"] },
    { id: "culture-lantern", word: "\u731C\u706F\u8C1C", hints: ["\u8282\u65E5\u6D3B\u52A8", "\u770B\u7740\u706F\u7B3C\u4E0B\u7684\u8C1C\u9762\u601D\u8003\u7B54\u6848"] },
    { id: "culture-dragon-boat", word: "\u8D5B\u9F99\u821F", hints: ["\u4F20\u7EDF\u8282\u65E5\u6D3B\u52A8", "\u591A\u4EBA\u5212\u7740\u957F\u8239\u7ADE\u901F\u524D\u8FDB"] },
    { id: "culture-mooncake", word: "\u5403\u6708\u997C", hints: ["\u79CB\u5929\u7684\u8282\u65E5\u4E60\u4FD7", "\u4E00\u5BB6\u4EBA\u5206\u4EAB\u5706\u5F62\u70B9\u5FC3"] },
    { id: "culture-dumpling", word: "\u5305\u997A\u5B50", hints: ["\u5BB6\u5EAD\u805A\u9910\u6D3B\u52A8", "\u628A\u9985\u653E\u8FDB\u5706\u9762\u76AE\u5E76\u634F\u7D27"] },
    { id: "culture-lion-dance", word: "\u821E\u72EE", hints: ["\u70ED\u95F9\u7684\u4F20\u7EDF\u8868\u6F14", "\u4E24\u4EBA\u94BB\u8FDB\u5F69\u8272\u72EE\u5B50\u670D\u8DF3\u8DC3"] },
    { id: "culture-kite", word: "\u653E\u98CE\u7B5D", hints: ["\u6709\u98CE\u65F6\u9002\u5408\u8FDB\u884C", "\u7275\u7740\u957F\u7EBF\u8BA9\u5F69\u8272\u7269\u4F53\u98DE\u4E0A\u5929"] },
    { id: "culture-paper-cut", word: "\u526A\u7EB8", hints: ["\u4F20\u7EDF\u624B\u5DE5\u827A", "\u7EA2\u7EB8\u6298\u53E0\u540E\u526A\u51FA\u82B1\u7EB9"] },
    { id: "culture-calligraphy", word: "\u5199\u6BDB\u7B14\u5B57", hints: ["\u4F20\u7EDF\u4E66\u5199\u65B9\u5F0F", "\u624B\u63E1\u6BDB\u7B14\u8638\u58A8\u5728\u5BA3\u7EB8\u843D\u7B14"] },
    { id: "culture-opera", word: "\u5531\u620F", hints: ["\u4F20\u7EDF\u821E\u53F0\u8868\u6F14", "\u6F14\u5458\u7A7F\u620F\u670D\u5316\u6D53\u5986\u4EAE\u76F8"] },
    { id: "culture-chess", word: "\u4E0B\u8C61\u68CB", hints: ["\u4E24\u4EBA\u5BF9\u5F08\u6D3B\u52A8", "\u68CB\u76D8\u4E0A\u6709\u5C06\u5E05\u8F66\u9A6C\u70AE"] },
    { id: "culture-tea", word: "\u6CE1\u8336", hints: ["\u548C\u996E\u54C1\u6709\u5173", "\u628A\u70ED\u6C34\u5012\u5165\u88C5\u6709\u8336\u53F6\u7684\u58F6"] },
    { id: "culture-cover-ears", word: "\u63A9\u8033\u76D7\u94C3", hints: ["\u4E00\u4E2A\u6210\u8BED\u6545\u4E8B", "\u6342\u4F4F\u8033\u6735\u53BB\u5077\u4F1A\u54CD\u7684\u94C3\u94DB"] },
    { id: "culture-seedling", word: "\u62D4\u82D7\u52A9\u957F", hints: ["\u4E00\u4E2A\u6210\u8BED\u6545\u4E8B", "\u628A\u7530\u91CC\u7684\u5E7C\u82D7\u5411\u4E0A\u62D4\u9AD8"] },
    { id: "culture-boat-sword", word: "\u523B\u821F\u6C42\u5251", hints: ["\u4E00\u4E2A\u6210\u8BED\u6545\u4E8B", "\u5728\u8239\u8FB9\u505A\u8BB0\u53F7\u5BFB\u627E\u843D\u6C34\u7684\u5251"] },
    { id: "culture-rabbit-stump", word: "\u5B88\u682A\u5F85\u5154", hints: ["\u4E00\u4E2A\u6210\u8BED\u6545\u4E8B", "\u519C\u592B\u5B88\u7740\u6811\u6869\u7B49\u5F85\u5154\u5B50"] },
    { id: "culture-paint-snake", word: "\u753B\u86C7\u6DFB\u8DB3", hints: ["\u6BD4\u55BB\u505A\u4E86\u591A\u4F59\u7684\u4E8B", "\u753B\u5B8C\u86C7\u53C8\u7ED9\u5B83\u6DFB\u4E0A\u811A"] },
    { id: "culture-blind-elephant", word: "\u76F2\u4EBA\u6478\u8C61", hints: ["\u548C\u7247\u9762\u8BA4\u8BC6\u6709\u5173", "\u51E0\u4E2A\u4EBA\u6478\u7740\u5927\u8C61\u4E0D\u540C\u90E8\u4F4D"] },
    { id: "culture-frog-well", word: "\u4E95\u5E95\u4E4B\u86D9", hints: ["\u5F62\u5BB9\u773C\u754C\u6709\u9650", "\u9752\u86D9\u5750\u5728\u4E95\u5E95\u4EF0\u671B\u5C0F\u7247\u5929\u7A7A"] },
    { id: "culture-fox-tiger", word: "\u72D0\u5047\u864E\u5A01", hints: ["\u548C\u501F\u52BF\u5413\u4EBA\u6709\u5173", "\u72D0\u72F8\u8D70\u5728\u8001\u864E\u524D\u9762\u5413\u8DD1\u52A8\u7269"] },
    { id: "culture-firecracker", word: "\u653E\u97AD\u70AE", hints: ["\u8282\u5E86\u65F6\u7684\u70ED\u95F9\u6D3B\u52A8", "\u7EA2\u8272\u957F\u4E32\u5728\u5730\u9762\u70B8\u51FA\u706B\u82B1"] },
    { id: "culture-red-envelope", word: "\u53D1\u7EA2\u5305", hints: ["\u8282\u5E86\u6216\u795D\u798F\u65F6\u8FDB\u884C", "\u628A\u7EA2\u8272\u4FE1\u5C01\u9012\u7ED9\u522B\u4EBA"] },
    { id: "culture-tangyuan", word: "\u716E\u6C64\u5706", hints: ["\u4F20\u7EDF\u8282\u65E5\u98DF\u4FD7", "\u5706\u5706\u7684\u767D\u8272\u98DF\u7269\u6F02\u5728\u9505\u91CC"] },
    { id: "culture-tomb-sweep", word: "\u626B\u5893", hints: ["\u7EAA\u5FF5\u5148\u4EBA\u7684\u4F20\u7EDF\u6D3B\u52A8", "\u5728\u5893\u7891\u524D\u732E\u82B1\u5E76\u6E05\u7406\u5468\u56F4"] },
    { id: "culture-chang-e", word: "\u5AE6\u5A25\u5954\u6708", hints: ["\u795E\u8BDD\u6545\u4E8B", "\u5973\u5B50\u98DE\u5411\u5929\u7A7A\u4E2D\u7684\u5706\u6708"] },
    { id: "culture-houyi", word: "\u540E\u7FBF\u5C04\u65E5", hints: ["\u795E\u8BDD\u6545\u4E8B", "\u5F13\u7BAD\u624B\u7784\u51C6\u5929\u7A7A\u591A\u4E2A\u592A\u9633"] },
    { id: "culture-jingwei", word: "\u7CBE\u536B\u586B\u6D77", hints: ["\u795E\u8BDD\u4F20\u8BF4", "\u5C0F\u9E1F\u8854\u77F3\u5934\u6295\u5165\u5927\u6D77"] },
    { id: "culture-crow-water", word: "\u4E4C\u9E26\u559D\u6C34", hints: ["\u719F\u6089\u7684\u5BD3\u8A00\u6545\u4E8B", "\u9E1F\u5411\u74F6\u91CC\u653E\u77F3\u5B50\u8BA9\u6C34\u5347\u9AD8"] },
    { id: "culture-snow-coal", word: "\u96EA\u4E2D\u9001\u70AD", hints: ["\u6BD4\u55BB\u53CA\u65F6\u7ED9\u4E88\u5E2E\u52A9", "\u5927\u96EA\u5929\u628A\u4E00\u7B50\u6728\u70AD\u9001\u7ED9\u522B\u4EBA"] },
    { id: "culture-book-sleep", word: "\u5E9F\u5BDD\u5FD8\u98DF", hints: ["\u5F62\u5BB9\u975E\u5E38\u4E13\u6CE8", "\u8DB4\u5728\u4E66\u684C\u8BFB\u4E66\u5FD8\u8BB0\u5403\u996D\u7761\u89C9"] },
    ...EXTRA_WORD_BANK.culture
  ]
};

// src/worker.ts
var ROUND_MS = 9e4;
var PICK_MS = 2e4;
var RESULT_MS = 5e3;
var MAX_MESSAGES = 60;
var RELAY_GUESS_MS = 25e3;
var secretWord = null;
var secretWordId = null;
var classicStrokeLedger = createStrokeUpdateLedger();
var lastChatAt = /* @__PURE__ */ new Map();
var strokeRate = /* @__PURE__ */ new Map();
var relayChains = [];
var relayAssignments = /* @__PURE__ */ new Map();
var relayGuesses = /* @__PURE__ */ new Map();
var relayCanvases = /* @__PURE__ */ new Map();
var relayStrokeDrafts = /* @__PURE__ */ new Map();
var relayStrokeLedgers = /* @__PURE__ */ new Map();
var relayReservedWordIds = /* @__PURE__ */ new Set();
function categoriesForState() {
  return CATEGORY_DEFS.map(({ id, name, icon, description }) => ({ id, name, icon, description }));
}
function createUsedWords() {
  return Object.fromEntries(CATEGORY_DEFS.map(({ id }) => [id, []]));
}
function cleanText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
}
function comparable(value) {
  return cleanText(value).toLocaleLowerCase("zh-CN").replace(/[\s，。！？、；：“”‘’（）()《》〈〉【】\[\],.!?;:'"\-_]/g, "");
}
function isPoint(value) {
  return value && Number.isFinite(value.x) && Number.isFinite(value.y) && value.x >= 0 && value.x <= 1 && value.y >= 0 && value.y <= 1;
}
function addMessage(ctx, message) {
  ctx.state.messages.push({
    id: `${ctx.now().toString(36)}-${Math.floor(ctx.random() * 1e8).toString(36)}`,
    at: ctx.now(),
    ...message
  });
  if (ctx.state.messages.length > MAX_MESSAGES) {
    ctx.state.messages.splice(0, ctx.state.messages.length - MAX_MESSAGES);
  }
}
function connectedPlayers(state) {
  return Object.values(state.players).filter((player) => player.connected);
}
function clearGameTimers(ctx) {
  ["pick", "hint-1", "hint-2", "hint-3", "round", "result"].forEach((name) => ctx.clearTimer(name));
}
function resetRoundRuntime() {
  secretWord = null;
  secretWordId = null;
  resetStrokeUpdateLedger(classicStrokeLedger);
}
function resetRelayRuntime() {
  relayChains = [];
  relayAssignments = /* @__PURE__ */ new Map();
  relayGuesses = /* @__PURE__ */ new Map();
  relayCanvases = /* @__PURE__ */ new Map();
  relayStrokeDrafts = /* @__PURE__ */ new Map();
  relayStrokeLedgers = /* @__PURE__ */ new Map();
  relayReservedWordIds = /* @__PURE__ */ new Set();
}
function shuffled(ctx, values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(ctx.random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}
function startGame(ctx) {
  clearGameTimers(ctx);
  resetRoundRuntime();
  const players = connectedPlayers(ctx.state);
  ctx.state.phase = "choosing";
  ctx.state.scores = Object.fromEntries(players.map((player) => [player.id, 0]));
  ctx.state.roundPoints = {};
  ctx.state.turnOrder = shuffled(ctx, players.map((player) => player.id));
  ctx.state.turnIndex = -1;
  ctx.state.roundNumber = 0;
  ctx.state.roundResult = null;
  ctx.state.messages = [];
  Object.values(ctx.state.players).forEach((player) => {
    player.ready = false;
  });
  addMessage(ctx, { type: "system", text: "\u6240\u6709\u4EBA\u51C6\u5907\u5B8C\u6BD5\uFF0C\u6E38\u620F\u5F00\u59CB\uFF01" });
  advanceTurn(ctx);
}
function maybeStartGame(ctx) {
  if (ctx.state.phase !== "lobby" && ctx.state.phase !== "game-over" && ctx.state.phase !== "relay-gallery") return;
  const players = connectedPlayers(ctx.state);
  if (players.length >= 2 && players.every((player) => player.ready)) {
    if (ctx.state.mode === "relay") startRelayGame(ctx);
    else startGame(ctx);
  }
}
function finishGame(ctx) {
  clearGameTimers(ctx);
  resetRoundRuntime();
  ctx.state.phase = "game-over";
  ctx.state.drawerId = null;
  ctx.state.categoryId = null;
  ctx.state.pickEndsAt = null;
  ctx.state.roundEndsAt = null;
  ctx.state.roundGuessers = [];
  ctx.state.guessedIds = [];
  ctx.state.strokes = [];
  ctx.state.activeStroke = null;
  ctx.state.canvasRevision += 1;
  Object.values(ctx.state.players).forEach((player) => {
    player.ready = false;
  });
  addMessage(ctx, { type: "system", text: "\u672C\u5C40\u7ED3\u675F\uFF0C\u6700\u7EC8\u6392\u540D\u51FA\u7089\uFF01" });
}
function beginChoosing(ctx, drawerId) {
  resetRoundRuntime();
  ctx.state.phase = "choosing";
  ctx.state.drawerId = drawerId;
  ctx.state.categoryId = null;
  ctx.state.revealedHints = [];
  ctx.state.roundEndsAt = null;
  ctx.state.pickEndsAt = ctx.now() + PICK_MS;
  ctx.state.roundGuessers = connectedPlayers(ctx.state).map((player) => player.id).filter((id) => id !== drawerId);
  ctx.state.guessedIds = [];
  ctx.state.roundPoints = {};
  ctx.state.roundResult = null;
  ctx.state.strokes = [];
  ctx.state.activeStroke = null;
  ctx.state.canvasRevision += 1;
  const drawer = ctx.state.players[drawerId];
  addMessage(ctx, { type: "system", text: `\u8F6E\u5230 ${drawer?.name || "\u4E0B\u4E00\u4F4D\u73A9\u5BB6"} \u4F5C\u753B\uFF0C\u8BF7\u9009\u62E9\u5206\u7C7B\u3002` });
  ctx.setTimer("pick", PICK_MS, () => {
    if (ctx.state.phase !== "choosing" || ctx.state.drawerId !== drawerId) return;
    const category = CATEGORY_DEFS[Math.floor(ctx.random() * CATEGORY_DEFS.length)];
    beginDrawing(ctx, category.id);
  });
}
function advanceTurn(ctx) {
  clearGameTimers(ctx);
  let nextIndex = ctx.state.turnIndex + 1;
  while (nextIndex < ctx.state.turnOrder.length) {
    const candidate = ctx.state.players[ctx.state.turnOrder[nextIndex]];
    if (candidate?.connected) break;
    nextIndex += 1;
  }
  if (nextIndex >= ctx.state.turnOrder.length) {
    finishGame(ctx);
    return;
  }
  ctx.state.turnIndex = nextIndex;
  ctx.state.roundNumber = nextIndex + 1;
  beginChoosing(ctx, ctx.state.turnOrder[nextIndex]);
}
function pickUnusedWord(ctx, categoryId) {
  const words = WORD_BANK[categoryId];
  if (!words) return null;
  const used = new Set(ctx.state.usedWordIds[categoryId] || []);
  let available = words.filter((entry) => !used.has(entry.id));
  if (available.length === 0) {
    ctx.state.usedWordIds[categoryId] = [];
    const lastId = ctx.state.lastWordIds[categoryId];
    available = words.filter((entry) => entry.id !== lastId);
    if (available.length === 0) available = [...words];
  }
  return available[Math.floor(ctx.random() * available.length)];
}
function revealHint(ctx, index, text) {
  if (ctx.state.phase !== "drawing") return;
  ctx.state.revealedHints.push(text);
  addMessage(ctx, { type: "hint", text: `\u63D0\u793A ${index}\uFF1A${text}` });
}
function beginDrawing(ctx, categoryId) {
  if (ctx.state.phase !== "choosing" || !WORD_BANK[categoryId]) return;
  ctx.clearTimer("pick");
  const chosen = pickUnusedWord(ctx, categoryId);
  if (!chosen) return;
  secretWord = chosen;
  secretWordId = chosen.id;
  resetStrokeUpdateLedger(classicStrokeLedger);
  ctx.state.phase = "drawing";
  ctx.state.categoryId = categoryId;
  ctx.state.pickEndsAt = null;
  ctx.state.roundEndsAt = ctx.now() + ROUND_MS;
  ctx.state.revealedHints = [];
  ctx.state.guessedIds = [];
  ctx.state.roundPoints = {};
  ctx.state.strokes = [];
  ctx.state.activeStroke = null;
  ctx.state.canvasRevision += 1;
  ctx.send(ctx.state.drawerId, "guess:word", { word: chosen.word, roundNumber: ctx.state.roundNumber });
  const category = CATEGORY_DEFS.find((entry) => entry.id === categoryId);
  addMessage(ctx, { type: "system", text: `${ctx.state.players[ctx.state.drawerId]?.name || "\u753B\u624B"} \u9009\u62E9\u4E86\u300C${category?.name}\u300D\u3002` });
  ctx.setTimer("hint-1", 3e4, () => revealHint(ctx, 1, `${[...chosen.word.replace(/\s/g, "")].length} \u4E2A\u5B57`));
  ctx.setTimer("hint-2", 55e3, () => revealHint(ctx, 2, chosen.hints[0]));
  ctx.setTimer("hint-3", 75e3, () => revealHint(ctx, 3, chosen.hints[1]));
  ctx.setTimer("round", ROUND_MS, () => endRound(ctx, "timeout"));
}
function scoreForRemaining(remainingMs) {
  if (remainingMs > 6e4) return 20;
  if (remainingMs > 35e3) return 15;
  if (remainingMs > 15e3) return 10;
  return 5;
}
function allConnectedGuessersDone(state) {
  const eligible = state.roundGuessers.filter((id) => state.players[id]?.connected);
  return eligible.length > 0 && eligible.every((id) => state.guessedIds.includes(id));
}
function endRound(ctx, reason) {
  if (ctx.state.phase !== "drawing" || !secretWord) return;
  clearGameTimers(ctx);
  const answer = secretWord.word;
  const categoryId = ctx.state.categoryId;
  const used = ctx.state.usedWordIds[categoryId] || [];
  if (!used.includes(secretWordId)) used.push(secretWordId);
  ctx.state.usedWordIds[categoryId] = used;
  ctx.state.lastWordIds[categoryId] = secretWordId;
  ctx.state.phase = "round-result";
  ctx.state.roundEndsAt = null;
  ctx.state.roundResult = {
    answer,
    reason,
    drawerId: ctx.state.drawerId,
    points: { ...ctx.state.roundPoints }
  };
  resetStrokeUpdateLedger(classicStrokeLedger);
  ctx.state.activeStroke = null;
  addMessage(ctx, { type: "answer", text: `\u7B54\u6848\u662F\u300C${answer}\u300D` });
  secretWord = null;
  secretWordId = null;
  ctx.setTimer("result", RESULT_MS, () => advanceTurn(ctx));
}
function allowedStrokeAction(playerId, now) {
  const bucket = strokeRate.get(playerId) || { since: now, count: 0 };
  if (now - bucket.since >= 1e3) {
    bucket.since = now;
    bucket.count = 0;
  }
  bucket.count += 1;
  strokeRate.set(playerId, bucket);
  return bucket.count <= 35;
}
function clearRelayTimers(ctx) {
  ["relay-pick", "relay-stage"].forEach((name) => ctx.clearTimer(name));
}
function relayParticipants(ctx) {
  return ctx.state.relayParticipants || [];
}
function relayAllSubmitted(ctx) {
  return relayParticipants(ctx).every((id) => ctx.state.relaySubmittedIds.includes(id));
}
function relayWordForCategory(ctx, categoryId) {
  const words = WORD_BANK[categoryId] || [];
  const used = new Set(ctx.state.usedWordIds[categoryId] || []);
  let available = words.filter((entry) => !used.has(entry.id) && !relayReservedWordIds.has(entry.id));
  if (!available.length) {
    const lastId = ctx.state.lastWordIds[categoryId];
    available = words.filter((entry) => !relayReservedWordIds.has(entry.id) && entry.id !== lastId);
    if (!available.length) available = words.filter((entry) => !relayReservedWordIds.has(entry.id));
  }
  if (!available.length) return null;
  const word = available[Math.floor(ctx.random() * available.length)];
  relayReservedWordIds.add(word.id);
  return word;
}
function assignRelayWord(ctx, playerId, categoryId) {
  if (ctx.state.phase !== "relay-choosing" || relayChains.some((chain) => chain.originId === playerId)) return;
  const validCategory = WORD_BANK[categoryId] ? categoryId : CATEGORY_DEFS[Math.floor(ctx.random() * CATEGORY_DEFS.length)].id;
  const word = relayWordForCategory(ctx, validCategory);
  if (!word) return;
  relayChains.push({
    id: `chain-${playerId}`,
    originId: playerId,
    categoryId: validCategory,
    wordId: word.id,
    word: word.word,
    entries: []
  });
  ctx.state.relaySubmittedIds.push(playerId);
  ctx.send(playerId, "relay:task", { kind: "choose-complete", word: word.word, taskId: `choose:${ctx.state.relayStep}` });
}
function startRelayGame(ctx) {
  clearGameTimers(ctx);
  clearRelayTimers(ctx);
  resetRoundRuntime();
  resetRelayRuntime();
  const players = connectedPlayers(ctx.state);
  const participants = shuffled(ctx, players.map((player) => player.id));
  ctx.state.phase = "relay-choosing";
  ctx.state.relayParticipants = participants;
  ctx.state.relayStep = 0;
  ctx.state.relaySubmittedIds = [];
  ctx.state.relayDeadline = ctx.now() + PICK_MS;
  ctx.state.relayReveal = null;
  ctx.state.messages = [];
  ctx.state.scores = Object.fromEntries(players.map((player) => [player.id, 0]));
  Object.values(ctx.state.players).forEach((player) => {
    player.ready = false;
  });
  addMessage(ctx, { type: "system", text: "\u63A5\u529B\u753B\u518C\u5F00\u59CB\uFF01\u6BCF\u4E2A\u4EBA\u5148\u9009\u62E9\u4E00\u4E2A\u8BCD\u8BED\u5206\u7C7B\u3002" });
  ctx.setTimer("relay-pick", PICK_MS, () => {
    if (ctx.state.phase !== "relay-choosing") return;
    participants.forEach((id) => {
      if (!relayChains.some((chain) => chain.originId === id)) assignRelayWord(ctx, id, null);
    });
    beginRelayInitialDrawing(ctx);
  });
}
function setRelayStageTimer(ctx, duration, callback) {
  ctx.state.relayDeadline = ctx.now() + duration;
  ctx.setTimer("relay-stage", duration, callback);
}
function resetRelaySubmissionState(ctx) {
  ctx.state.relaySubmittedIds = [];
  relayCanvases = new Map(relayParticipants(ctx).map((id) => [id, []]));
  relayStrokeDrafts = /* @__PURE__ */ new Map();
  relayStrokeLedgers = new Map(relayParticipants(ctx).map((id) => [id, createStrokeUpdateLedger()]));
  ctx.state.canvasRevision += 1;
}
function beginRelayInitialDrawing(ctx) {
  ctx.clearTimer("relay-pick");
  ctx.state.phase = "relay-initial-drawing";
  ctx.state.relayStep = 0;
  resetRelaySubmissionState(ctx);
  relayParticipants(ctx).forEach((id) => {
    const chain = relayChains.find((entry) => entry.originId === id);
    ctx.send(id, "relay:task", { kind: "draw", prompt: chain?.word || "\u672A\u83B7\u5F97\u8BCD\u8BED", strokes: [], taskId: "draw:0" });
  });
  setRelayStageTimer(ctx, 6e4, () => completeRelayDrawingStage(ctx));
}
function assignmentForStep(ctx, playerId, step) {
  const participants = relayParticipants(ctx);
  const playerIndex = participants.indexOf(playerId);
  if (playerIndex < 0) return null;
  const originIndex = (playerIndex - step + participants.length) % participants.length;
  const originId = participants[originIndex];
  return relayChains.find((chain) => chain.originId === originId) || null;
}
function beginRelayGuessing(ctx, step) {
  const taskKind = relayTaskKind(relayParticipants(ctx).length, step);
  ctx.state.phase = taskKind === "final-guess" ? "relay-final-guess" : "relay-guessing";
  ctx.state.relayStep = step;
  ctx.state.relaySubmittedIds = [];
  relayAssignments = /* @__PURE__ */ new Map();
  relayGuesses = /* @__PURE__ */ new Map();
  ctx.state.canvasRevision += 1;
  relayParticipants(ctx).forEach((playerId) => {
    const chain = assignmentForStep(ctx, playerId, step);
    relayAssignments.set(playerId, chain?.id);
    const drawing = [...chain?.entries || []].reverse().find((entry) => entry.kind === "drawing");
    ctx.send(playerId, "relay:task", {
      kind: taskKind,
      strokes: drawing?.strokes || [],
      step,
      total: relayParticipants(ctx).length - 1,
      taskId: `${taskKind}:${step}`
    });
  });
  setRelayStageTimer(ctx, RELAY_GUESS_MS, () => completeRelayGuessStage(ctx));
}
function completeRelayGuessStage(ctx) {
  if (ctx.state.phase !== "relay-guessing" && ctx.state.phase !== "relay-final-guess") return;
  ctx.clearTimer("relay-stage");
  relayParticipants(ctx).forEach((playerId) => {
    const chainId = relayAssignments.get(playerId);
    const chain = relayChains.find((entry) => entry.id === chainId);
    if (!chain) return;
    const text = relayGuesses.get(playerId) || "\u672A\u731C\u51FA";
    chain.entries.push({ kind: "guess", playerId, text });
    relayGuesses.set(playerId, text);
  });
  if (ctx.state.phase === "relay-final-guess") {
    beginRelayReveal(ctx);
  } else {
    beginRelayRedrawing(ctx);
  }
}
function beginRelayRedrawing(ctx) {
  ctx.state.phase = "relay-redrawing";
  resetRelaySubmissionState(ctx);
  relayParticipants(ctx).forEach((playerId) => {
    ctx.send(playerId, "relay:task", { kind: "draw", prompt: relayGuesses.get(playerId) || "\u672A\u731C\u51FA", strokes: [], taskId: `draw:${ctx.state.relayStep}` });
  });
  setRelayStageTimer(ctx, 6e4, () => completeRelayDrawingStage(ctx));
}
function completeRelayDrawingStage(ctx) {
  if (ctx.state.phase !== "relay-initial-drawing" && ctx.state.phase !== "relay-redrawing") return;
  ctx.clearTimer("relay-stage");
  const initial = ctx.state.phase === "relay-initial-drawing";
  relayParticipants(ctx).forEach((playerId) => {
    const chain = initial ? relayChains.find((entry) => entry.originId === playerId) : relayChains.find((entry) => entry.id === relayAssignments.get(playerId));
    if (!chain) return;
    chain.entries.push({ kind: "drawing", playerId, strokes: relayCanvases.get(playerId) || [] });
  });
  beginRelayGuessing(ctx, initial ? 1 : ctx.state.relayStep + 1);
}
function submitRelayDrawing(ctx, playerId) {
  if (ctx.state.relaySubmittedIds.includes(playerId)) return;
  ctx.state.relaySubmittedIds.push(playerId);
  ctx.send(playerId, "relay:submitted", { kind: "drawing" });
  if (relayAllSubmitted(ctx)) completeRelayDrawingStage(ctx);
}
function publicRelayItem(item) {
  if (item.kind === "drawing") return { kind: "drawing", playerId: item.playerId, strokes: item.strokes };
  return { kind: "guess", playerId: item.playerId, text: item.text };
}
function revealChainPayload(chain) {
  return {
    id: chain.id,
    originId: chain.originId,
    word: chain.word,
    items: chain.entries.map(publicRelayItem)
  };
}
function beginRelayReveal(ctx) {
  clearRelayTimers(ctx);
  relayChains.forEach((chain) => {
    const used = ctx.state.usedWordIds[chain.categoryId] || [];
    if (!used.includes(chain.wordId)) used.push(chain.wordId);
    ctx.state.usedWordIds[chain.categoryId] = used;
    ctx.state.lastWordIds[chain.categoryId] = chain.wordId;
  });
  ctx.state.phase = "relay-reveal";
  ctx.state.relayDeadline = null;
  ctx.state.relaySubmittedIds = [];
  ctx.state.relayReveal = {
    chainIndex: 0,
    itemIndex: -1,
    status: "steps",
    current: { ...revealChainPayload(relayChains[0]), items: [] },
    gallery: null
  };
  addMessage(ctx, { type: "system", text: "\u6240\u6709\u753B\u518C\u5B8C\u6210\uFF0C\u7B49\u5F85\u623F\u4E3B\u63ED\u6653\uFF01" });
}
function advanceRelayReveal(ctx) {
  const reveal = ctx.state.relayReveal;
  if (ctx.state.phase !== "relay-reveal" || !reveal) return;
  const chain = relayChains[reveal.chainIndex];
  if (!chain) return;
  if (reveal.status === "steps") {
    if (reveal.itemIndex + 1 < chain.entries.length) {
      reveal.itemIndex += 1;
      reveal.current.items.push(publicRelayItem(chain.entries[reveal.itemIndex]));
      return;
    }
    reveal.status = "summary";
    return;
  }
  if (reveal.chainIndex + 1 < relayChains.length) {
    reveal.chainIndex += 1;
    reveal.itemIndex = -1;
    reveal.status = "steps";
    const next = relayChains[reveal.chainIndex];
    reveal.current = { ...revealChainPayload(next), items: [] };
    return;
  }
  ctx.state.phase = "relay-gallery";
  reveal.status = "gallery";
  reveal.gallery = relayChains.map(revealChainPayload);
  Object.values(ctx.state.players).forEach((player) => {
    player.ready = false;
  });
}
function sendCurrentRelayTask(ctx, playerId) {
  if (!relayParticipants(ctx).includes(playerId)) return;
  if (ctx.state.phase === "relay-choosing") {
    const chain = relayChains.find((entry) => entry.originId === playerId);
    if (chain) ctx.send(playerId, "relay:task", { kind: "choose-complete", word: chain.word, taskId: `choose:${ctx.state.relayStep}` });
    return;
  }
  if (ctx.state.phase === "relay-initial-drawing") {
    const chain = relayChains.find((entry) => entry.originId === playerId);
    ctx.send(playerId, "relay:task", { kind: "draw", prompt: chain?.word || "\u672A\u83B7\u5F97\u8BCD\u8BED", strokes: relayCanvases.get(playerId) || [], taskId: "draw:0" });
    return;
  }
  if (ctx.state.phase === "relay-guessing" || ctx.state.phase === "relay-final-guess") {
    const chain = relayChains.find((entry) => entry.id === relayAssignments.get(playerId));
    const drawing = [...chain?.entries || []].reverse().find((entry) => entry.kind === "drawing");
    const kind = ctx.state.phase === "relay-final-guess" ? "final-guess" : "guess";
    ctx.send(playerId, "relay:task", { kind, strokes: drawing?.strokes || [], taskId: `${kind}:${ctx.state.relayStep}` });
    return;
  }
  if (ctx.state.phase === "relay-redrawing") {
    ctx.send(playerId, "relay:task", { kind: "draw", prompt: relayGuesses.get(playerId) || "\u672A\u731C\u51FA", strokes: relayCanvases.get(playerId) || [], taskId: `draw:${ctx.state.relayStep}` });
  }
}
function sanitizeStroke(value) {
  if (!value || typeof value.id !== "string" || value.id.length < 1 || value.id.length > 48) return null;
  if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > MAX_POINTS_PER_STROKE || !value.points.every(isPoint)) return null;
  const tool = value.tool === "eraser" ? "eraser" : value.tool === "pen" ? "pen" : null;
  const colors = ["#172033", "#ef4444", "#f97316", "#22a06b", "#2563eb", "#7c3aed"];
  if (!tool || !colors.includes(value.color) || ![4, 8, 16].includes(value.size)) return null;
  return { id: value.id, tool, color: value.color, size: value.size, points: value.points.map(({ x, y, t }) => ({ x, y, ...Number.isFinite(t) ? { t: Math.max(0, Math.min(6e4, t)) } : {} })) };
}
function currentRelayDrawingTaskId(ctx) {
  if (ctx.state.phase === "relay-initial-drawing") return "draw:0";
  if (ctx.state.phase === "relay-redrawing") return `draw:${ctx.state.relayStep}`;
  return null;
}
var worker_default = defineRoom({
  meta: { name: "\u4F60\u753B\u6211\u731C", minPlayers: 2, maxPlayers: 8 },
  initialState() {
    return {
      schema: "guess-draw.v4",
      mode: "classic",
      hostId: null,
      phase: "lobby",
      players: {},
      scores: {},
      turnOrder: [],
      turnIndex: -1,
      roundNumber: 0,
      drawerId: null,
      categoryId: null,
      categories: categoriesForState(),
      pickEndsAt: null,
      roundEndsAt: null,
      revealedHints: [],
      roundGuessers: [],
      guessedIds: [],
      roundPoints: {},
      roundResult: null,
      messages: [],
      strokes: [],
      activeStroke: null,
      canvasRevision: 0,
      usedWordIds: createUsedWords(),
      lastWordIds: {},
      relayParticipants: [],
      relayStep: 0,
      relaySubmittedIds: [],
      relayDeadline: null,
      relayReveal: null
    };
  },
  onJoin(ctx, player) {
    if (!ctx.state.hostId) ctx.state.hostId = ctx.host.id;
    ctx.state.players[player.id] = { id: player.id, name: player.name, connected: true, ready: false };
    if (!(player.id in ctx.state.scores)) ctx.state.scores[player.id] = 0;
    if (ctx.state.mode === "relay" && ctx.state.phase !== "lobby" && ctx.state.phase !== "game-over") {
      addMessage(ctx, { type: "system", text: `${player.name} \u5C06\u5728\u4E0B\u4E00\u5C40\u52A0\u5165\u3002` });
    } else if (ctx.state.phase === "drawing" || ctx.state.phase === "choosing") {
      if (player.id !== ctx.state.drawerId && !ctx.state.roundGuessers.includes(player.id)) {
        ctx.state.roundGuessers.push(player.id);
      }
      addMessage(ctx, { type: "system", text: `${player.name} \u52A0\u5165\u4E86\u672C\u56DE\u5408\u3002` });
    }
  },
  onLeave(ctx, player) {
    const record = ctx.state.players[player.id];
    if (!record) return;
    if (ctx.state.phase === "lobby" || ctx.state.phase === "game-over") {
      delete ctx.state.players[player.id];
      delete ctx.state.scores[player.id];
      maybeStartGame(ctx);
    } else {
      record.connected = false;
      record.ready = false;
      addMessage(ctx, { type: "system", text: `${record.name} \u6682\u65F6\u79BB\u5F00\u4E86\u623F\u95F4\u3002` });
    }
  },
  onReconnect(ctx, player) {
    const record = ctx.state.players[player.id];
    if (record) {
      record.connected = true;
      record.name = player.name;
    } else {
      ctx.state.players[player.id] = { id: player.id, name: player.name, connected: true, ready: false };
      ctx.state.scores[player.id] = 0;
    }
    if (ctx.state.mode === "relay" && ctx.state.phase.startsWith("relay-")) {
      if (ctx.state.phase === "relay-initial-drawing" || ctx.state.phase === "relay-redrawing") {
        relayStrokeDrafts.delete(player.id);
        const ledger = relayStrokeLedgers.get(player.id) || createStrokeUpdateLedger();
        resetStrokeUpdateLedger(ledger);
        relayStrokeLedgers.set(player.id, ledger);
      }
      sendCurrentRelayTask(ctx, player.id);
    } else if (ctx.state.phase === "drawing" && player.id === ctx.state.drawerId && secretWord) {
      ctx.state.activeStroke = null;
      resetStrokeUpdateLedger(classicStrokeLedger);
      ctx.send(player.id, "guess:word", { word: secretWord.word, roundNumber: ctx.state.roundNumber });
    }
  },
  onRestore(ctx) {
    clearGameTimers(ctx);
    resetRoundRuntime();
    if (ctx.state.mode === "relay" && ctx.state.phase.startsWith("relay-")) {
      clearRelayTimers(ctx);
      resetRelayRuntime();
      ctx.state.phase = "lobby";
      ctx.state.relayParticipants = [];
      ctx.state.relaySubmittedIds = [];
      ctx.state.relayDeadline = null;
      ctx.state.relayReveal = null;
      ctx.state.activeStroke = null;
      Object.values(ctx.state.players).forEach((record) => {
        record.ready = false;
      });
      addMessage(ctx, { type: "system", text: "\u623F\u95F4\u6062\u590D\u540E\u79C1\u5BC6\u753B\u518C\u5DF2\u4F5C\u5E9F\uFF0C\u8BF7\u91CD\u65B0\u51C6\u5907\u3002" });
    } else if (ctx.state.phase === "drawing" || ctx.state.phase === "choosing" || ctx.state.phase === "round-result") {
      const drawer = ctx.state.players[ctx.state.drawerId];
      if (drawer?.connected) {
        addMessage(ctx, { type: "system", text: "\u623F\u95F4\u5DF2\u6062\u590D\uFF0C\u672C\u9898\u4F5C\u5E9F\u5E76\u91CD\u65B0\u9009\u8BCD\u3002" });
        beginChoosing(ctx, drawer.id);
      } else {
        advanceTurn(ctx);
      }
    }
  },
  actions: {
    selectMode(ctx, { player, payload }) {
      if (ctx.state.phase !== "lobby" && ctx.state.phase !== "game-over" && ctx.state.phase !== "relay-gallery") return;
      if (player.id !== ctx.host.id) return;
      const mode = payload?.mode;
      if (mode !== "classic" && mode !== "relay") return;
      ctx.state.mode = mode;
      if (ctx.state.phase === "relay-gallery") ctx.state.phase = "game-over";
      maybeStartGame(ctx);
    },
    toggleReady(ctx, { player }) {
      if (ctx.state.phase !== "lobby" && ctx.state.phase !== "game-over" && ctx.state.phase !== "relay-gallery") return;
      const record = ctx.state.players[player.id];
      if (!record?.connected) return;
      record.ready = !record.ready;
      maybeStartGame(ctx);
    },
    chooseCategory(ctx, { player, payload }) {
      if (ctx.state.phase === "relay-choosing") {
        if (!relayParticipants(ctx).includes(player.id) || ctx.state.relaySubmittedIds.includes(player.id)) return;
        assignRelayWord(ctx, player.id, payload?.categoryId);
        if (relayAllSubmitted(ctx)) beginRelayInitialDrawing(ctx);
        return;
      }
      if (ctx.state.phase !== "choosing" || player.id !== ctx.state.drawerId) return;
      if (!payload || typeof payload.categoryId !== "string") return;
      beginDrawing(ctx, payload.categoryId);
    },
    submitGuess(ctx, { player, payload }) {
      if (ctx.state.phase === "relay-guessing" || ctx.state.phase === "relay-final-guess") {
        if (!relayParticipants(ctx).includes(player.id) || ctx.state.relaySubmittedIds.includes(player.id)) return;
        const text2 = cleanText(payload?.text) || "\u672A\u731C\u51FA";
        relayGuesses.set(player.id, text2);
        ctx.state.relaySubmittedIds.push(player.id);
        ctx.send(player.id, "relay:submitted", { kind: "guess", text: text2 });
        if (relayAllSubmitted(ctx)) completeRelayGuessStage(ctx);
        return;
      }
      if (ctx.state.phase !== "drawing" || player.id === ctx.state.drawerId || !secretWord) return;
      if (!ctx.state.roundGuessers.includes(player.id)) return;
      const now = ctx.now();
      const last = lastChatAt.get(player.id) || 0;
      if (now - last < 650) {
        ctx.send(player.id, "guess:notice", { text: "\u6162\u4E00\u70B9\u518D\u53D1\u9001\u3002" });
        return;
      }
      lastChatAt.set(player.id, now);
      const text = cleanText(payload?.text);
      if (!text) return;
      const guess = comparable(text);
      const answer = comparable(secretWord.word);
      const alreadyCorrect = ctx.state.guessedIds.includes(player.id);
      if (!alreadyCorrect && guess === answer) {
        const points = scoreForRemaining(Math.max(0, ctx.state.roundEndsAt - now));
        ctx.state.guessedIds.push(player.id);
        ctx.state.scores[player.id] = (ctx.state.scores[player.id] || 0) + points;
        ctx.state.scores[ctx.state.drawerId] = (ctx.state.scores[ctx.state.drawerId] || 0) + 2;
        ctx.state.roundPoints[player.id] = points;
        ctx.state.roundPoints[ctx.state.drawerId] = (ctx.state.roundPoints[ctx.state.drawerId] || 0) + 2;
        addMessage(ctx, { type: "correct", playerId: player.id, text: `${ctx.state.players[player.id]?.name || player.name} \u731C\u5BF9\u4E86\uFF01` });
        ctx.send(player.id, "guess:notice", { text: `\u731C\u5BF9\u4E86\uFF0C+${points} \u5206\uFF01`, tone: "success" });
        if (allConnectedGuessersDone(ctx.state)) endRound(ctx, "all-guessed");
        return;
      }
      if (answer && guess.includes(answer)) {
        ctx.send(player.id, "guess:notice", { text: "\u8FD9\u6761\u6D88\u606F\u53EF\u80FD\u6CC4\u9732\u7B54\u6848\uFF0C\u672A\u53D1\u9001\u3002" });
        return;
      }
      addMessage(ctx, {
        type: "chat",
        playerId: player.id,
        name: ctx.state.players[player.id]?.name || player.name,
        text
      });
    },
    submitStroke(ctx, { player, payload }) {
      const rawSummary = { playerId: player.id, strokeId: typeof payload?.stroke?.id === "string" ? payload.stroke.id : null, updateSeq: payload?.updateSeq, pointCount: Array.isArray(payload?.stroke?.points) ? payload.stroke.points.length : null, canvasRevision: payload?.canvasRevision, expectedCanvasRevision: ctx.state.canvasRevision, taskId: payload?.taskId ?? null, complete: payload?.complete };
      if (!allowedStrokeAction(player.id, ctx.now())) {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "rate-limit" });
        return;
      }
      if (payload?.canvasRevision !== ctx.state.canvasRevision) {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "canvas-revision" });
        return;
      }
      const stroke = sanitizeStroke(payload?.stroke);
      if (!stroke) {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "invalid-stroke" });
        return;
      }
      if (typeof payload.complete !== "boolean") {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "invalid-complete" });
        return;
      }
      if (ctx.state.phase === "relay-initial-drawing" || ctx.state.phase === "relay-redrawing") {
        if (!relayParticipants(ctx).includes(player.id)) {
          ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "relay-not-participant" });
          return;
        }
        if (ctx.state.relaySubmittedIds.includes(player.id)) {
          ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "relay-already-submitted" });
          return;
        }
        if (payload.taskId !== currentRelayDrawingTaskId(ctx)) {
          ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "relay-task-id", expectedTaskId: currentRelayDrawingTaskId(ctx) });
          return;
        }
        const strokes = relayCanvases.get(player.id) || [];
        const ledger = relayStrokeLedgers.get(player.id) || createStrokeUpdateLedger();
        relayStrokeLedgers.set(player.id, ledger);
        if (!canApplyStroke(strokes, stroke)) {
          ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "canvas-budget" });
          return;
        }
        if (!acceptStrokeUpdate(ledger, { stroke, updateSeq: payload.updateSeq, complete: payload.complete })) {
          ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "stroke-ledger" });
          return;
        }
        if (payload.complete) {
          strokes.push(stroke);
          relayCanvases.set(player.id, strokes);
          relayStrokeDrafts.delete(player.id);
        } else relayStrokeDrafts.set(player.id, stroke);
        ctx.log("[DRAW-SYNC]", "worker-accept", { ...rawSummary, target: payload.complete ? "relay-completed" : "relay-draft" });
        return;
      }
      if (ctx.state.phase !== "drawing") {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "classic-phase", phase: ctx.state.phase });
        return;
      }
      if (player.id !== ctx.state.drawerId) {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "classic-not-drawer", drawerId: ctx.state.drawerId });
        return;
      }
      if (payload.taskId != null) {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "classic-task-id" });
        return;
      }
      if (!canApplyStroke(ctx.state.strokes, stroke)) {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "canvas-budget" });
        return;
      }
      if (!acceptStrokeUpdate(classicStrokeLedger, { stroke, updateSeq: payload.updateSeq, complete: payload.complete })) {
        ctx.log("[DRAW-SYNC]", "worker-reject", { ...rawSummary, reason: "stroke-ledger" });
        return;
      }
      if (payload.complete) {
        ctx.state.strokes.push(stroke);
        ctx.state.activeStroke = null;
      } else ctx.state.activeStroke = stroke;
      ctx.log("[DRAW-SYNC]", "worker-accept", { ...rawSummary, target: payload.complete ? "classic-completed" : "classic-active", completedStrokes: ctx.state.strokes.length, activePoints: ctx.state.activeStroke?.points.length ?? 0 });
    },
    clearCanvas(ctx, { player, payload }) {
      if (ctx.state.phase === "relay-initial-drawing" || ctx.state.phase === "relay-redrawing") {
        if (!relayParticipants(ctx).includes(player.id) || ctx.state.relaySubmittedIds.includes(player.id) || payload?.taskId !== currentRelayDrawingTaskId(ctx)) return;
        relayStrokeDrafts.delete(player.id);
        const ledger = relayStrokeLedgers.get(player.id) || createStrokeUpdateLedger();
        resetStrokeUpdateLedger(ledger);
        relayStrokeLedgers.set(player.id, ledger);
        relayCanvases.set(player.id, []);
        return;
      }
      if (ctx.state.phase !== "drawing" || player.id !== ctx.state.drawerId || payload?.taskId != null) return;
      resetStrokeUpdateLedger(classicStrokeLedger);
      ctx.state.strokes = [];
      ctx.state.activeStroke = null;
      ctx.state.canvasRevision += 1;
    },
    relaySubmitDrawing(ctx, { player }) {
      if (ctx.state.phase !== "relay-initial-drawing" && ctx.state.phase !== "relay-redrawing") return;
      if (!relayParticipants(ctx).includes(player.id)) return;
      const draft = relayStrokeDrafts.get(player.id);
      if (draft) {
        const strokes = relayCanvases.get(player.id) || [];
        if (canApplyStroke(strokes, draft)) strokes.push(draft);
        relayCanvases.set(player.id, strokes);
        relayStrokeDrafts.delete(player.id);
      }
      submitRelayDrawing(ctx, player.id);
    },
    advanceReveal(ctx, { player }) {
      if (player.id !== ctx.host.id) return;
      advanceRelayReveal(ctx);
    },
    replayRevealDrawing(ctx, { player }) {
      if (player.id !== ctx.host.id || ctx.state.phase !== "relay-reveal") return;
      ctx.broadcast("relay:replay", {});
    },
    sendReaction(ctx, { player, payload }) {
      if (ctx.state.phase !== "relay-reveal" && ctx.state.phase !== "relay-gallery") return;
      const emoji = ["\u{1F602}", "\u{1F92F}", "\u{1F3A8}", "\u{1F44F}", "\u2753"].includes(payload?.emoji) ? payload.emoji : null;
      if (!emoji) return;
      ctx.broadcast("relay:reaction", { playerId: player.id, emoji });
    }
  }
});
export default worker_default;

// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";

// src/worker/board.ts
var COLS = 9;
var ROWS = 10;
function inBoard(c, r) {
  return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}
function cloneBoard(b) {
  return b.map((col) => col.slice());
}
function emptyBoard() {
  const b = [];
  for (let c = 0; c < COLS; c++) {
    const col = [];
    for (let r = 0; r < ROWS; r++) col.push(".");
    b.push(col);
  }
  return b;
}
function initialBoard() {
  const b = emptyBoard();
  b[0][0] = "r";
  b[1][0] = "n";
  b[2][0] = "b";
  b[3][0] = "a";
  b[4][0] = "k";
  b[5][0] = "a";
  b[6][0] = "b";
  b[7][0] = "n";
  b[8][0] = "r";
  b[1][2] = "c";
  b[7][2] = "c";
  b[0][3] = "p";
  b[2][3] = "p";
  b[4][3] = "p";
  b[6][3] = "p";
  b[8][3] = "p";
  b[0][9] = "R";
  b[1][9] = "N";
  b[2][9] = "B";
  b[3][9] = "A";
  b[4][9] = "K";
  b[5][9] = "A";
  b[6][9] = "B";
  b[7][9] = "N";
  b[8][9] = "R";
  b[1][7] = "C";
  b[7][7] = "C";
  b[0][6] = "P";
  b[2][6] = "P";
  b[4][6] = "P";
  b[6][6] = "P";
  b[8][6] = "P";
  return b;
}
function pieceSide2(p) {
  if (p === "." || p === "x") return null;
  if (p >= "A" && p <= "Z") return "r";
  if (p >= "a" && p <= "z") return "b";
  return null;
}
function toLower(p) {
  if (p === "." || p === "x") return p;
  return p.toLowerCase();
}
function toUpper(p) {
  if (p === "." || p === "x") return p;
  return p.toUpperCase();
}
function inPalace(side, c, r) {
  if (c < 3 || c > 5) return false;
  if (side === "r") return r >= 7 && r <= 9;
  return r >= 0 && r <= 2;
}
function inOwnSide(side, r) {
  return side === "r" ? r >= 5 : r <= 4;
}
function countBetween(b, c1, r1, c2, r2) {
  let n = 0;
  if (c1 === c2) {
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    for (let r = lo + 1; r < hi; r++) if (b[c1][r] !== ".") n++;
  } else if (r1 === r2) {
    const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
    for (let c = lo + 1; c < hi; c++) if (b[c][r1] !== ".") n++;
  } else {
    return -1;
  }
  return n;
}
function tryMove(b, from, to) {
  const [fc, fr] = from;
  const [tc, tr] = to;
  if (!inBoard(fc, fr) || !inBoard(tc, tr)) return false;
  const piece = b[fc][fr];
  if (piece === "." || piece === "x") return false;
  const side = pieceSide2(piece);
  if (side === null) return false;
  const target = b[tc][tr];
  if (target !== "." && pieceSide2(target) === side) return false;
  if (fc === tc && fr === tr) return false;
  const dc = tc - fc, dr = tr - fr;
  const adx = Math.abs(dc), ady = Math.abs(dr);
  const lower = toLower(piece);
  switch (lower) {
    case "k": {
      if (!inPalace(side, tc, tr)) return false;
      if (adx + ady !== 1) return false;
      return true;
    }
    case "a": {
      if (!inPalace(side, tc, tr)) return false;
      if (adx !== 1 || ady !== 1) return false;
      return true;
    }
    case "b": {
      if (adx !== 2 || ady !== 2) return false;
      const cc = fc + tc >> 1, cr = fr + tr >> 1;
      if (b[cc][cr] !== ".") return false;
      if (side === "r" && tr < 5) return false;
      if (side === "b" && tr > 4) return false;
      return true;
    }
    case "n": {
      if (!(adx === 1 && ady === 2 || adx === 2 && ady === 1)) return false;
      let lx = 0, ly = 0;
      if (adx === 2) {
        lx = fc + Math.sign(dc);
        ly = fr;
      } else {
        lx = fc;
        ly = fr + Math.sign(dr);
      }
      if (b[lx][ly] !== ".") return false;
      return true;
    }
    case "r": {
      if (fc !== tc && fr !== tr) return false;
      if (countBetween(b, fc, fr, tc, tr) !== 0) return false;
      return true;
    }
    case "c": {
      if (fc !== tc && fr !== tr) return false;
      const n = countBetween(b, fc, fr, tc, tr);
      if (target === ".") {
        if (n !== 0) return false;
        return true;
      } else {
        if (n !== 1) return false;
        return true;
      }
    }
    case "p": {
      const forward = side === "r" ? -1 : 1;
      if (inOwnSide(side, fr)) {
        if (dc === 0 && dr === forward) return true;
        return false;
      } else {
        if (dc === 0 && dr === forward) return true;
        if (dr === 0 && adx === 1) return true;
        return false;
      }
    }
  }
  return false;
}
function findKing(b, side) {
  const target = side === "r" ? "K" : "k";
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (b[c][r] === target) return [c, r];
    }
  }
  return null;
}
function isInCheck(b, side) {
  const kp = findKing(b, side);
  if (!kp) return true;
  const enemy = side === "r" ? "b" : "r";
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === "." || p === "x") continue;
      if (pieceSide2(p) !== enemy) continue;
      if (tryMove(b, [c, r], kp)) return true;
    }
  }
  const other = findKing(b, enemy);
  if (other) {
    const [kc, kr] = kp;
    const [oc, or] = other;
    if (kc === oc) {
      const lo = Math.min(kr, or), hi = Math.max(kr, or);
      let blocked = false;
      for (let r = lo + 1; r < hi; r++) if (b[kc][r] !== ".") {
        blocked = true;
        break;
      }
      if (!blocked) return true;
    }
  }
  return false;
}
function simulateMove(b, from, to) {
  const nb = cloneBoard(b);
  const [fc, fr] = from, [tc, tr] = to;
  nb[tc][tr] = nb[fc][fr];
  nb[fc][fr] = ".";
  return nb;
}
function legalMoves(b, side) {
  const out = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === "." || p === "x") continue;
      if (pieceSide2(p) !== side) continue;
      for (let tc = 0; tc < COLS; tc++) {
        for (let tr = 0; tr < ROWS; tr++) {
          if (tc === c && tr === r) continue;
          if (tryMove(b, [c, r], [tc, tr])) {
            const nb = simulateMove(b, [c, r], [tc, tr]);
            if (!isInCheck(nb, side)) {
              out.push({ from: [c, r], to: [tc, tr] });
            }
          }
        }
      }
    }
  }
  return out;
}
function isCheckmate(b, side) {
  if (!isInCheck(b, side)) return false;
  return legalMoves(b, side).length === 0;
}
function isStalemate(b, side) {
  if (isInCheck(b, side)) return false;
  return legalMoves(b, side).length === 0;
}
var NO_CAPTURE_LIMIT = 60;

// src/worker/banzhu.ts
var ROLE_DIST = [
  "R",
  "R",
  "N",
  "N",
  "B",
  "B",
  "A",
  "A",
  "C",
  "C",
  "P",
  "P",
  "P",
  "P",
  "P"
];
function darkRoleByCol(c, r, side) {
  if (side === "r") {
    if (r === 9) {
      if (c === 0 || c === 8) return "r";
      if (c === 1 || c === 7) return "n";
      if (c === 2 || c === 6) return "b";
      if (c === 3 || c === 5) return "a";
      if (c === 4) return null;
    } else if (r === 7) {
      if (c === 1 || c === 7) return "c";
    } else if (r === 6) {
      if (c === 0 || c === 2 || c === 4 || c === 6 || c === 8) return "p";
    }
  } else {
    if (r === 0) {
      if (c === 0 || c === 8) return "r";
      if (c === 1 || c === 7) return "n";
      if (c === 2 || c === 6) return "b";
      if (c === 3 || c === 5) return "a";
      if (c === 4) return null;
    } else if (r === 2) {
      if (c === 1 || c === 7) return "c";
    } else if (r === 3) {
      if (c === 0 || c === 2 || c === 4 || c === 6 || c === 8) return "p";
    }
  }
  return null;
}
function banzhuMoveForPosition(b, _realBoard, from, to, side) {
  const [fc, fr] = from;
  const piece = b[fc][fr];
  if (piece === ".") return false;
  if (piece === "x") {
    return tryDarkMove(b, from, to, side);
  }
  return tryMoveWithFlyingGuards(b, from, to);
}
function tryMoveWithFlyingGuards(b, from, to) {
  const [fc, fr] = from;
  const [tc, tr] = to;
  if (!inBoard(fc, fr) || !inBoard(tc, tr)) return false;
  const piece = b[fc][fr];
  if (piece === "." || piece === "x") return false;
  const side = pieceSide2(piece);
  if (side === null) return false;
  const target = b[tc][tr];
  if (target !== "." && pieceSide2(target) === side) return false;
  if (fc === tc && fr === tr) return false;
  const lower = toLower(piece);
  if (lower === "a" || lower === "b") {
    return tryMoveExceptRiver(b, from, to);
  }
  return tryMove(b, from, to);
}
function tryMoveExceptRiver(b, from, to) {
  const [fc, fr] = from;
  const [tc, tr] = to;
  if (!inBoard(fc, fr) || !inBoard(tc, tr)) return false;
  const piece = b[fc][fr];
  if (piece === "." || piece === "x") return false;
  const side = pieceSide2(piece);
  if (side === null) return false;
  const target = b[tc][tr];
  if (target !== "." && pieceSide2(target) === side) return false;
  if (fc === tc && fr === tr) return false;
  const dc = tc - fc, dr = tr - fr;
  const adx = Math.abs(dc), ady = Math.abs(dr);
  const lower = toLower(piece);
  if (lower === "a") {
    if (adx !== 1 || ady !== 1) return false;
    if (tc < 3 || tc > 5) return false;
    if (side === "r" && (tr < 7 || tr > 9)) return false;
    if (side === "b" && (tr < 0 || tr > 2)) return false;
    return true;
  }
  if (lower === "b") {
    if (adx !== 2 || ady !== 2) return false;
    const cc = fc + tc >> 1, cr = fr + tr >> 1;
    if (b[cc][cr] !== ".") return false;
    return true;
  }
  return false;
}
function tryDarkMove(b, from, to, side) {
  const [fc, fr] = from;
  const lower = darkRoleByCol(fc, fr, side);
  if (lower === null) return false;
  const tmp = b.map((col) => col.slice());
  const fake = side === "r" ? toUpper(lower) : toLower(lower);
  tmp[fc][fr] = fake;
  return tryMove(tmp, from, to);
}
function flipAt(b, realBoard, from, side, rng) {
  const [fc, fr] = from;
  if (b[fc][fr] !== "x") return null;
  const remaining = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (b[c][r] !== "x") continue;
      const owner = realBoard[c][r];
      if (owner === null) continue;
      if (side === "r" && owner >= "A" && owner <= "Z") remaining.push(owner);
      if (side === "b" && owner >= "a" && owner <= "z") remaining.push(owner);
    }
  }
  if (remaining.length === 0) return null;
  const pick = remaining[Math.floor(rng() * remaining.length)];
  const nb = b.map((col) => col.slice());
  const nrb = realBoard.map((col) => col.slice());
  nb[fc][fr] = pick;
  nrb[fc][fr] = null;
  return { board: nb, realBoard: nrb, piece: pick };
}
function banzhuInitialBoard(rng = Math.random) {
  const b = [];
  const real = [];
  for (let c = 0; c < COLS; c++) {
    const col = [];
    const rcol = [];
    for (let r = 0; r < ROWS; r++) {
      col.push(".");
      rcol.push(null);
    }
    b.push(col);
    real.push(rcol);
  }
  const blackSlots = [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
    [5, 0],
    [6, 0],
    [7, 0],
    [8, 0],
    [1, 2],
    [7, 2],
    [0, 3],
    [2, 3],
    [4, 3],
    [6, 3],
    [8, 3]
  ];
  const redSlots = [
    [0, 9],
    [1, 9],
    [2, 9],
    [3, 9],
    [5, 9],
    [6, 9],
    [7, 9],
    [8, 9],
    [1, 7],
    [7, 7],
    [0, 6],
    [2, 6],
    [4, 6],
    [6, 6],
    [8, 6]
  ];
  const shuffledRed = [...ROLE_DIST].sort(() => rng() - 0.5);
  const shuffledBlack = [...ROLE_DIST.map((r) => r.toLowerCase())].sort(() => rng() - 0.5);
  for (let i = 0; i < redSlots.length; i++) {
    const [c, r] = redSlots[i];
    b[c][r] = "x";
    real[c][r] = shuffledRed[i];
  }
  for (let i = 0; i < blackSlots.length; i++) {
    const [c, r] = blackSlots[i];
    b[c][r] = "x";
    real[c][r] = shuffledBlack[i];
  }
  b[4][9] = "K";
  b[4][0] = "k";
  real[4][9] = null;
  real[4][0] = null;
  return { board: b, realBoard: real };
}

// src/worker/puzzles.ts
function rowsToBoard(rows) {
  const b = [];
  for (let c = 0; c < 9; c++) {
    const col = [];
    for (let r = 0; r < 10; r++) {
      const ch = rows[r][c];
      col.push(ch === " " ? "." : ch);
    }
    b.push(col);
  }
  return b;
}
var p1Rows = [
  "         ",
  // 0
  "         ",
  // 1
  "    k    ",
  // 2
  "         ",
  // 3
  "         ",
  // 4
  "         ",
  // 5
  "         ",
  // 6
  "         ",
  // 7
  "         ",
  // 8
  "    R    "
  // 9
];
var p2Rows = [
  "         ",
  "         ",
  "    k    ",
  " r       ",
  "         ",
  "         ",
  "         ",
  "         ",
  "         ",
  "R    R   "
];
var p3Rows = [
  "  a k a  ",
  // 0
  "         ",
  "    b    ",
  "         ",
  "    c    ",
  "         ",
  "       n ",
  "         ",
  "    C    ",
  "  K      "
];
var PUZZLES = [
  {
    id: "p1",
    title: "\u8F66\u5BF9\u5C06 \xB7 7 \u6B65",
    description: "\u7EA2\u65B9\u8F66\u5728\u5E95\u7EBF\uFF0C\u9ED1\u5C06\u5728\u4E2D\u7EBF\u3002\u7EA2\u65B9\u5728 7 \u6B65\u5185\u628A\u6B7B\u9ED1\u5C06\u3002",
    rows: p1Rows,
    limit: 7,
    hint: "\u8F66\u8D70\u56DB\u4E5D \u2192 \u56DB\u516B \u5360\u4E2D\u7EBF\uFF08\u5BF9\u9762\u7B11\uFF09\u3002"
  },
  {
    id: "p2",
    title: "\u53CC\u8F66\u5BF9\u5355\u8F66 \xB7 10 \u6B65",
    description: "\u7EA2\u65B9\u53CC\u8F66\u5BF9\u9ED1\u65B9\u5355\u8F66\uFF0C\u7EA2\u5148\u5728 10 \u6B65\u5185\u7EDD\u6740\u3002",
    rows: p2Rows,
    limit: 10,
    hint: "\u5148\u7528\u8F66\u5403\u5BF9\u65B9\u8F66\uFF0C\u518D\u5F62\u6210\u5BF9\u9762\u7B11\u7EDD\u6740\u3002"
  },
  {
    id: "p3",
    title: "\u70AE\u9A6C\u5BF9\u58EB\u8C61 \xB7 12 \u6B65",
    description: "\u7EA2\u65B9\u70AE\u9547\u5F53\u5934 + \u9A6C\u5367\u69FD\uFF0C12 \u6B65\u7EDD\u6740\u9ED1\u65B9\u3002",
    rows: p3Rows,
    limit: 12,
    hint: "\u9A6C\u8D70\u5367\u69FD\u4F4D\uFF0C\u5C06\u6B7B\u9ED1\u65B9\u3002"
  }
];

// src/worker/ai.ts
var VALUE = {
  k: 1e4,
  r: 900,
  n: 450,
  b: 200,
  a: 200,
  c: 450,
  p: 100
};
function pieceValue(p) {
  if (p === "." || p === "x") return 0;
  return VALUE[toLower(p)] ?? 0;
}
function positionalBonus(p, _c, r) {
  const lower = toLower(p);
  if (lower === "p") {
    const side = pieceSide2(p);
    if (side === "r" && r <= 4) return 30;
    if (side === "b" && r >= 5) return 30;
  }
  if (lower === "c") {
    if (r === 5 || r === 4) return 10;
  }
  return 0;
}
function evaluate(b, side) {
  let score = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === "." || p === "x") continue;
      const s = pieceSide2(p);
      if (s === null) continue;
      const v = pieceValue(p) + positionalBonus(p, c, r);
      score += s === side ? v : -v;
    }
  }
  const enemy = side === "r" ? "b" : "r";
  if (isInCheck(b, enemy)) score += 50;
  if (isInCheck(b, side)) score -= 50;
  return score;
}
function banzhuLegalMoves(b, real, side) {
  const out = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === ".") continue;
      if (p === "x") {
        const owner = real[c][r];
        if (!owner) continue;
        const ownerSide = owner >= "A" && owner <= "Z" ? "r" : "b";
        if (ownerSide !== side) continue;
      } else {
        if (pieceSide2(p) !== side) continue;
      }
      for (let tc = 0; tc < COLS; tc++) {
        for (let tr = 0; tr < ROWS; tr++) {
          if (tc === c && tr === r) continue;
          if (!banzhuMoveForPosition(b, real, [c, r], [tc, tr], side)) continue;
          const nb = simulateMove(b, [c, r], [tc, tr]);
          if (!isInCheck(nb, side)) {
            out.push({ from: [c, r], to: [tc, tr] });
          }
        }
      }
    }
  }
  return out;
}
function pickRandom(b, side, real) {
  const moves = real ? banzhuLegalMoves(b, real, side) : legalMoves(b, side);
  if (moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}
function pickGreedy(b, side, real) {
  const moves = real ? banzhuLegalMoves(b, real, side) : legalMoves(b, side);
  if (moves.length === 0) return null;
  let best = moves[0];
  let bestScore = -Infinity;
  for (const m of moves) {
    const nb = simulateMove(b, m.from, m.to);
    const target = b[m.to[0]][m.to[1]];
    const captureVal = pieceValue(target);
    const score = captureVal * 10 + evaluate(nb, side) - evaluate(b, side);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
function minimax(b, side, depth, maximizing, alpha, beta, useAlphaBeta, real) {
  if (depth === 0) return evaluate(b, maximizing ? side : side === "r" ? "b" : "r");
  const curSide = maximizing ? side : side === "r" ? "b" : "r";
  const moves = real ? banzhuLegalMoves(b, real, curSide) : legalMoves(b, curSide);
  if (moves.length === 0) {
    if (isInCheck(b, curSide)) {
      return maximizing ? -1e5 : 1e5;
    }
    return 0;
  }
  if (maximizing) {
    let v = -Infinity;
    for (const m of moves) {
      const nb = simulateMove(b, m.from, m.to);
      const x = minimax(nb, side, depth - 1, false, alpha, beta, useAlphaBeta, real);
      if (x > v) v = x;
      if (useAlphaBeta) {
        if (v > alpha) alpha = v;
        if (beta <= alpha) break;
      }
    }
    return v;
  } else {
    let v = Infinity;
    for (const m of moves) {
      const nb = simulateMove(b, m.from, m.to);
      const x = minimax(nb, side, depth - 1, true, alpha, beta, useAlphaBeta, real);
      if (x < v) v = x;
      if (useAlphaBeta) {
        if (v < beta) beta = v;
        if (beta <= alpha) break;
      }
    }
    return v;
  }
}
function pickMinimax(b, side, depth, useAlphaBeta, real) {
  const moves = real ? banzhuLegalMoves(b, real, side) : legalMoves(b, side);
  if (moves.length === 0) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const m of moves) {
    const nb = simulateMove(b, m.from, m.to);
    const score = minimax(nb, side, depth - 1, false, -Infinity, Infinity, useAlphaBeta, real);
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  return best;
}
function pickAiMove(b, side, level, real) {
  switch (level) {
    case 0:
      return pickRandom(b, side, real);
    case 1:
      return pickGreedy(b, side, real);
    case 2:
      return pickMinimax(b, side, 2, false, real);
    case 3:
      return pickMinimax(b, side, 3, true, real);
  }
}

// src/worker/index.ts
function emptyReal() {
  const r = [];
  for (let c = 0; c < COLS; c++) {
    const col = [];
    for (let i = 0; i < ROWS; i++) col.push(null);
    r.push(col);
  }
  return r;
}
function makeInitialState() {
  return {
    gameMode: "classic",
    matchMode: "online",
    aiLevel: 1,
    hostSide: "r",
    board: initialBoard(),
    banzhuReal: emptyReal(),
    banzhuFlipped: { r: 0, b: 0 },
    enableFlip: false,
    turn: "r",
    history: [],
    movesSinceCapture: 0,
    phase: "lobby",
    finished: false,
    winner: null,
    reason: "",
    players: {},
    redPlayer: null,
    blackPlayer: null,
    redReady: false,
    blackReady: false,
    hostId: null,
    puzzleId: null,
    puzzleLimit: 0,
    puzzleSteps: 0,
    stats: {
      redWins: 0,
      redLosses: 0,
      redDraws: 0,
      blackWins: 0,
      blackLosses: 0,
      blackDraws: 0
    },
    undoCount: { r: 2, b: 2 },
    pendingRequest: null,
    lastRequestResult: null,
    lastCheck: false
  };
}
function banzhuTryMove(b, real, from, to, side) {
  return banzhuMoveForPosition(b, real, from, to, side);
}
function classicTryMove(b, from, to, side) {
  const [fc, fr] = from;
  const piece = b[fc][fr];
  if (piece === "." || piece === "x") return false;
  if (pieceSide2(piece) !== side) return false;
  if (!tryMove(b, from, to)) return false;
  const nb = simulateMove(b, from, to);
  if (isInCheck(nb, side)) return false;
  return true;
}
function evaluateAfterMove(st) {
  const enemy = st.turn === "r" ? "b" : "r";
  st.lastCheck = isInCheck(st.board, enemy);
  if (isCheckmate(st.board, enemy)) {
    st.finished = true;
    st.winner = st.turn;
    st.reason = "checkmate";
    st.phase = "finished";
    recordStats(st, st.winner, "win");
    return;
  }
  if (isStalemate(st.board, enemy)) {
    st.finished = true;
    st.winner = null;
    st.reason = "stalemate";
    st.phase = "finished";
    recordStats(st, null, "draw");
    return;
  }
  if (st.movesSinceCapture >= NO_CAPTURE_LIMIT) {
    st.finished = true;
    st.winner = null;
    st.reason = "fifty";
    st.phase = "finished";
    recordStats(st, null, "draw");
    return;
  }
  st.turn = enemy;
}
function recordStats(st, winner, _kind) {
  if (winner === "r") {
    st.stats.redWins++;
    st.stats.blackLosses++;
  } else if (winner === "b") {
    st.stats.blackWins++;
    st.stats.redLosses++;
  } else {
    st.stats.redDraws++;
    st.stats.blackDraws++;
  }
}
function startMatch(ctx) {
  const st = ctx.state;
  st.phase = "playing";
  st.finished = false;
  st.winner = null;
  st.reason = "";
  st.history = [];
  st.movesSinceCapture = 0;
  st.banzhuFlipped = { r: 0, b: 0 };
  st.lastCheck = false;
  st.puzzleSteps = 0;
  st.undoCount = st.gameMode === "puzzle" ? { r: 0, b: 0 } : { r: 2, b: 2 };
  st.pendingRequest = null;
  st.lastRequestResult = null;
  if (st.gameMode === "banzhu") {
    const init = banzhuInitialBoard(ctx.random);
    st.board = init.board;
    st.banzhuReal = init.realBoard;
    st.turn = "r";
  } else if (st.gameMode === "puzzle") {
    const p = PUZZLES.find((x) => x.id === st.puzzleId) || PUZZLES[0];
    st.board = rowsToBoard(p.rows);
    st.banzhuReal = emptyReal();
    st.puzzleId = p.id;
    st.puzzleLimit = p.limit;
    st.puzzleSteps = 0;
    st.turn = "r";
  } else {
    st.board = initialBoard();
    st.banzhuReal = emptyReal();
    st.turn = "r";
  }
  if (st.gameMode === "puzzle") {
    st.matchMode = "ai";
    st.hostSide = "r";
  }
  if (st.matchMode === "ai" && st.gameMode !== "puzzle") {
    const aiSide = st.hostSide === "r" ? "b" : "r";
    ctx.setTimer("ai-turn", 600, () => aiTurn(ctx, aiSide));
  }
}
function aiTurn(ctx, side) {
  const st = ctx.state;
  if (st.finished || st.phase !== "playing") return;
  if (st.turn !== side) return;
  if (st.gameMode === "banzhu" && st.enableFlip) {
    const flipped = aiFlipIfUseful(ctx, side);
    if (flipped) return;
  }
  const mv = pickAiMove(
    st.board,
    side,
    st.aiLevel,
    st.gameMode === "banzhu" ? st.banzhuReal : void 0
  );
  if (!mv) {
    st.finished = true;
    st.winner = side === "r" ? "b" : "r";
    st.reason = "checkmate";
    st.phase = "finished";
    recordStats(st, st.winner, "win");
    return;
  }
  applyMove(ctx, mv.from, mv.to, "ai-bot", { aiAuto: true });
}
function aiFlipIfUseful(ctx, side) {
  const st = ctx.state;
  let best = null;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (st.board[c][r] !== "x") continue;
      const owner = st.banzhuReal[c][r];
      if (!owner) continue;
      if (side === "r" && !(owner >= "A" && owner <= "Z")) continue;
      if (side === "b" && !(owner >= "a" && owner <= "z")) continue;
      const v = pieceValueOf(owner);
      if (!best || v > best.gain) {
        best = { pos: [c, r], gain: v, piece: owner };
      }
    }
  }
  if (!best) return false;
  applyFlip(ctx, best.pos, "ai-bot", { aiAuto: true });
  return true;
}
function pieceValueOf(p) {
  const lower = p.toLowerCase();
  const v = { k: 1e4, r: 900, n: 450, b: 200, a: 200, c: 450, p: 100 };
  return v[lower] ?? 0;
}
function applyMove(ctx, from, to, playerId, opts = {}) {
  const st = ctx.state;
  if (st.finished || st.phase !== "playing") return;
  const side = st.turn;
  if (!opts.aiAuto) {
    if (st.matchMode === "ai") {
      if (playerId !== st.hostId) return;
      if (side !== st.hostSide) return;
    } else {
      if (side === "r" && st.redPlayer !== playerId) return;
      if (side === "b" && st.blackPlayer !== playerId) return;
    }
  }
  let ok = false;
  if (st.gameMode === "banzhu") {
    ok = banzhuTryMove(st.board, st.banzhuReal, from, to, side);
  } else {
    ok = classicTryMove(st.board, from, to, side);
  }
  if (!ok) return;
  const piece = st.board[from[0]][from[1]];
  const captured = st.board[to[0]][to[1]];
  const nb = simulateMove(st.board, from, to);
  if (st.gameMode === "banzhu" && piece === "x") {
    const realPiece = st.banzhuReal[from[0]][from[1]];
    if (realPiece) {
      nb[to[0]][to[1]] = realPiece;
    }
  }
  st.board = nb;
  let revealed = null;
  if (st.gameMode === "banzhu" && captured === "x") {
    revealed = st.banzhuReal[to[0]][to[1]];
    if (revealed) st.banzhuReal[to[0]][to[1]] = null;
  }
  const move = {
    from,
    to,
    piece,
    captured,
    revealedCapture: revealed,
    turnBefore: side
  };
  st.history.push(move);
  st.movesSinceCapture = captured !== "." && captured !== "x" ? 0 : st.movesSinceCapture + 1;
  st.banzhuFlipped[side] += piece === "x" ? 1 : 0;
  if (st.gameMode === "puzzle") {
    st.puzzleSteps += 1;
    move.puzzleStepsAfter = st.puzzleSteps;
    if (st.puzzleSteps > st.puzzleLimit) {
      st.finished = true;
      st.winner = "b";
      st.reason = "puzzleFail";
      st.phase = "finished";
      recordStats(st, "b", "win");
      return;
    }
  }
  evaluateAfterMove(st);
  if (!st.finished) {
    if (st.matchMode === "ai") {
      const aiSide = st.hostSide === "r" ? "b" : "r";
      ctx.setTimer("ai-turn", 600, () => aiTurn(ctx, aiSide));
    }
  }
}
function applyFlip(ctx, pos, playerId, opts = {}) {
  const st = ctx.state;
  if (st.finished || st.phase !== "playing") return;
  if (st.gameMode !== "banzhu") return;
  const side = st.turn;
  if (!opts.aiAuto) {
    if (st.matchMode === "ai") {
      if (playerId !== st.hostId) return;
      if (side !== st.hostSide) return;
    } else {
      if (side === "r" && st.redPlayer !== playerId) return;
      if (side === "b" && st.blackPlayer !== playerId) return;
    }
  }
  const r = flipAt(st.board, st.banzhuReal, pos, side, ctx.random);
  if (!r) return;
  st.board = r.board;
  st.banzhuReal = r.realBoard;
  st.banzhuFlipped[side] += 1;
  st.history.push({
    from: pos,
    to: pos,
    piece: "x",
    captured: ".",
    flip: true,
    turnBefore: side
  });
  st.turn = side === "r" ? "b" : "r";
  st.lastCheck = isInCheck(st.board, st.turn);
  if (!st.finished && st.matchMode === "ai") {
    const aiSide = st.hostSide === "r" ? "b" : "r";
    ctx.setTimer("ai-turn", 600, () => aiTurn(ctx, aiSide));
  }
}
function performUndo(st, playerSide) {
  if (st.finished || st.phase !== "playing") return false;
  if (st.gameMode === "puzzle") return false;
  if (st.history.length === 0) return false;
  let steps;
  if (st.matchMode === "ai") {
    steps = 2;
  } else {
    steps = playerSide === st.turn ? 2 : 1;
  }
  if ((st.undoCount[playerSide] || 0) < 1) return false;
  if (st.history.length < steps) return false;
  if (st.matchMode === "online" && steps === 1) {
    const last = st.history[st.history.length - 1];
    if (!last || last.turnBefore !== playerSide) return false;
  }
  const targetPly = Math.max(0, st.history.length - steps);
  undoTo(st, targetPly);
  st.undoCount[playerSide] = Math.max(0, (st.undoCount[playerSide] || 0) - 1);
  return true;
}
function undoTo(st, ply) {
  while (st.history.length > ply) {
    const move = st.history.pop();
    if (!move) break;
    const nb = st.board.map((col) => col.slice());
    if (st.gameMode === "banzhu" && move.flip) {
      nb[move.from[0]][move.from[1]] = "x";
      st.banzhuReal[move.from[0]][move.from[1]] = null;
    } else {
      nb[move.to[0]][move.to[1]] = move.captured;
      if (st.gameMode === "banzhu" && move.piece === "x") {
        nb[move.from[0]][move.from[1]] = "x";
        st.banzhuReal[move.from[0]][move.from[1]] = null;
      } else {
        nb[move.from[0]][move.from[1]] = move.piece;
      }
      if (st.gameMode === "banzhu" && move.revealedCapture) {
        st.banzhuReal[move.to[0]][move.to[1]] = move.revealedCapture;
      }
    }
    st.board = nb;
    st.movesSinceCapture = Math.max(0, st.movesSinceCapture - 1);
    st.turn = move.turnBefore;
    if (st.gameMode === "banzhu" && (move.flip || move.piece === "x")) {
      st.banzhuFlipped[move.turnBefore] = Math.max(0, st.banzhuFlipped[move.turnBefore] - 1);
    }
  }
  st.lastCheck = isInCheck(st.board, st.turn);
  if (st.finished) {
    st.finished = false;
    st.winner = null;
    st.reason = "";
    st.phase = "playing";
  }
}
var REQUEST_TIMEOUT_MS = 15e3;
function setPendingRequest(ctx, type, from, noResponse) {
  const st = ctx.state;
  st.pendingRequest = { type, from, createdAt: ctx.now(), noResponse };
  ctx.broadcast("requestPending", { type, from, noResponse });
  ctx.setTimer("request-timeout", REQUEST_TIMEOUT_MS, () => {
    autoRejectRequest(ctx, type);
  });
}
function autoRejectRequest(ctx, expectType) {
  const st = ctx.state;
  if (!st.pendingRequest) return;
  if (st.pendingRequest.type !== expectType) return;
  const from = st.pendingRequest.from;
  st.pendingRequest = null;
  st.lastRequestResult = {
    type: expectType,
    accept: false,
    from,
    by: from,
    ts: ctx.now(),
    expired: true
  };
  ctx.broadcast("requestCleared", { type: expectType });
}
function clearPending(ctx) {
  const st = ctx.state;
  st.pendingRequest = null;
  ctx.clearTimer("request-timeout");
}
var index_default = defineRoom({
  meta: {
    name: "\u4E2D\u56FD\u8C61\u68CB",
    minPlayers: 1,
    maxPlayers: 2
  },
  initialState() {
    return makeInitialState();
  },
  onCreate(_ctx) {
  },
  onJoin(ctx, player) {
    const st = ctx.state;
    st.players[player.id] = { side: null, ready: false, name: player.name || "\u73A9\u5BB6" };
    if (!st.hostId) st.hostId = player.id;
  },
  onLeave(ctx, player) {
    const st = ctx.state;
    if (st.redPlayer === player.id) {
      st.redPlayer = null;
      st.redReady = false;
    }
    if (st.blackPlayer === player.id) {
      st.blackPlayer = null;
      st.blackReady = false;
    }
    delete st.players[player.id];
    if (st.matchMode === "online" && !st.finished) {
      if (st.phase === "playing") {
        const winner = st.redPlayer || st.blackPlayer;
        if (winner) {
          st.finished = true;
          st.winner = winner === st.redPlayer ? "r" : "b";
          st.reason = "resign";
          st.phase = "finished";
        }
      }
    }
  },
  actions: {
    joinOnline(_ctx, _args) {
    },
    chooseSide(ctx, { player, payload }) {
      const st = ctx.state;
      const side = payload && payload.side;
      if (side !== "r" && side !== "b") return;
      if (st.redPlayer === player.id) st.redPlayer = null;
      if (st.blackPlayer === player.id) st.blackPlayer = null;
      if (side === "r" && !st.redPlayer) st.redPlayer = player.id;
      if (side === "b" && !st.blackPlayer) st.blackPlayer = player.id;
    },
    leaveSide(ctx, { player }) {
      const st = ctx.state;
      if (st.redPlayer === player.id) {
        st.redPlayer = null;
        st.redReady = false;
      }
      if (st.blackPlayer === player.id) {
        st.blackPlayer = null;
        st.blackReady = false;
      }
    },
    setGameMode(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === "playing" || st.phase === "finished") return;
      const m = payload?.gameMode;
      if (m !== "classic" && m !== "banzhu" && m !== "puzzle") return;
      st.gameMode = m;
      if (m === "puzzle") {
        st.matchMode = "ai";
        st.hostSide = "r";
      }
    },
    setAiLevel(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      const lv = payload?.level;
      if (typeof lv !== "number") return;
      if (lv < 0 || lv > 3) return;
      st.aiLevel = lv;
    },
    setHostSide(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === "playing" || st.phase === "finished") return;
      const side = payload?.side;
      if (side !== "r" && side !== "b") return;
      st.hostSide = side;
    },
    setMatchMode(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === "playing" || st.phase === "finished") return;
      const m = payload?.matchMode;
      if (m !== "ai" && m !== "online") return;
      st.matchMode = m;
    },
    setPuzzleId(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      const id = payload?.puzzleId;
      if (typeof id !== "string") return;
      const exists = PUZZLES.some((p) => p.id === id);
      if (!exists) return;
      st.puzzleId = id;
    },
    toggleReady(ctx, { player }) {
      const st = ctx.state;
      if (st.phase === "playing") return;
      if (player.id === st.redPlayer) st.redReady = !st.redReady;
      else if (player.id === st.blackPlayer) st.blackReady = !st.blackReady;
    },
    startGameOnline(ctx, { player }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (!st.redPlayer || !st.blackPlayer) return;
      if (!st.redReady || !st.blackReady) return;
      startMatch(ctx);
    },
    startAI(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      const p = payload;
      if (p?.gameMode === "classic" || p?.gameMode === "banzhu" || p?.gameMode === "puzzle") {
        st.gameMode = p.gameMode;
      }
      if (p?.hostSide === "r" || p?.hostSide === "b") {
        st.hostSide = p.hostSide;
      }
      if (p?.puzzleId) {
        st.puzzleId = p.puzzleId;
      }
      startMatch(ctx);
    },
    move(ctx, { player, payload }) {
      const p = payload;
      if (!p || !p.from || !p.to) return;
      const from = p.from;
      const to = p.to;
      if (!inBoard(from[0], from[1]) || !inBoard(to[0], to[1])) return;
      applyMove(ctx, from, to, player.id);
    },
    flip(ctx, { player, payload }) {
      const p = payload;
      if (!p || !p.pos) return;
      const pos = p.pos;
      if (!inBoard(pos[0], pos[1])) return;
      applyFlip(ctx, pos, player.id);
    },
    /**
     * 悔棋：
     * - 人机模式：直接本地撤销两步（房主执子方消耗 1 次）；不走弹窗
     * - 在线模式：发起 undo 请求，对方同意后才撤销
     */
    undo(ctx, { player }) {
      const st = ctx.state;
      if (st.finished || st.phase !== "playing") return;
      if (st.gameMode === "puzzle") return;
      if (st.pendingRequest) return;
      if (st.matchMode === "ai") {
        if (player.id !== st.hostId) return;
        if (!performUndo(st, st.hostSide)) return;
        ctx.clearTimer("ai-turn");
        return;
      }
      const isRed = st.redPlayer === player.id;
      const isBlack = st.blackPlayer === player.id;
      if (!isRed && !isBlack) return;
      const mySide = isRed ? "r" : "b";
      if ((st.undoCount[mySide] || 0) < 1) return;
      setPendingRequest(ctx, "undo", player.id, false);
    },
    /**
     * 认输：
     * - 人机模式：直接走 onResign 流程（发起方立即确认，弹窗纯通知）
     * - 在线模式：弹窗通知对方，由发起方点确认后认输
     */
    resign(ctx, { player }) {
      const st = ctx.state;
      if (st.finished || st.phase !== "playing") return;
      if (st.pendingRequest) return;
      if (st.matchMode === "ai") {
        if (player.id !== st.hostId) return;
        setPendingRequest(ctx, "resign", player.id, true);
        return;
      }
      if (st.redPlayer !== player.id && st.blackPlayer !== player.id) return;
      setPendingRequest(ctx, "resign", player.id, true);
    },
    /**
     * 重开：
     * - 人机模式：房主任何阶段可点，直接重开（不走弹窗）
     * - 在线模式：发起 restart 请求，finished 阶段对方同意后重开
     */
    restart(ctx, { player }) {
      const st = ctx.state;
      if (st.pendingRequest) return;
      if (st.matchMode === "ai") {
        if (player.id !== st.hostId) return;
        startMatch(ctx);
        return;
      }
      if (st.phase !== "finished") return;
      if (st.redPlayer !== player.id && st.blackPlayer !== player.id) return;
      setPendingRequest(ctx, "restart", player.id, false);
    },
    /**
     * 重开（对局进行中任一方可发起；用于在线模式任一方想重新开局）
     */
    rematch(ctx, { player }) {
      const st = ctx.state;
      if (st.phase !== "playing" || st.finished) return;
      if (st.pendingRequest) return;
      if (st.matchMode === "ai") {
        if (player.id !== st.hostId) return;
        startMatch(ctx);
        return;
      }
      if (st.redPlayer !== player.id && st.blackPlayer !== player.id) return;
      setPendingRequest(ctx, "rematch", player.id, false);
    },
    /**
     * 返回选择（房主）：统一走弹窗协议（AI / 在线都一样）
     */
    backToMenu(ctx, { player }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.pendingRequest) return;
      setPendingRequest(ctx, "backToMenu", player.id, true);
    },
    /**
     * 回应弹窗请求（同意/拒绝）
     */
    respondRequest(ctx, { player, payload }) {
      const st = ctx.state;
      if (!st.pendingRequest) return;
      const req = st.pendingRequest;
      const accept = !!(payload && payload.accept);
      if (req.noResponse) {
        if (player.id !== req.from) return;
      } else {
        if (player.id === req.from) return;
        if (st.redPlayer !== player.id && st.blackPlayer !== player.id) {
          if (st.matchMode === "online" && player.id !== st.hostId) return;
        }
      }
      clearPending(ctx);
      const now = ctx.now();
      st.lastRequestResult = {
        type: req.type,
        accept,
        from: req.from,
        by: player.id,
        ts: now
      };
      if (!accept) {
        ctx.broadcast("requestRejected", { type: req.type });
        return;
      }
      if (req.type === "restart" || req.type === "rematch") {
        startMatch(ctx);
        ctx.broadcast("restarted", {});
      } else if (req.type === "resign") {
        const loserSide = st.redPlayer === req.from ? "r" : st.blackPlayer === req.from ? "b" : st.turn;
        const winner = loserSide === "r" ? "b" : "r";
        st.finished = true;
        st.winner = winner;
        st.reason = "resign";
        st.phase = "finished";
        recordStats(st, winner, "win");
      } else if (req.type === "backToMenu") {
        st.phase = "lobby";
        st.finished = false;
        st.winner = null;
        st.reason = "";
        st.history = [];
        st.movesSinceCapture = 0;
        st.banzhuFlipped = { r: 0, b: 0 };
        st.puzzleSteps = 0;
        st.board = initialBoard();
        st.banzhuReal = emptyReal();
        st.turn = "r";
        st.lastCheck = false;
        st.undoCount = { r: 2, b: 2 };
        st.redReady = false;
        st.blackReady = false;
        ctx.setTimer("clear-backToMenu-result", 2e3, () => {
          if (st.phase === "lobby" && st.lastRequestResult && st.lastRequestResult.type === "backToMenu") {
            st.lastRequestResult = null;
          }
        });
      } else if (req.type === "undo") {
        if (st.matchMode === "online") {
          const mySide = st.redPlayer === req.from ? "r" : st.blackPlayer === req.from ? "b" : st.turn;
          performUndo(st, mySide);
        }
      }
    },
    exitRoom(_ctx, _args) {
    }
  }
});
export default index_default;

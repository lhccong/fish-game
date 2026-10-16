// 揭棋：暗子按所在位置对应的标准棋子走法走；
// 翻开后的明子按经典规则走（士象可过河）。
// 翻子：把某格暗子翻开成对应真实身份（按位置分配）。
// 吃暗子时：吃方揭示身份，被吃方不揭示。

import { tryMove, pieceSide2, toLower, toUpper, COLS, ROWS, inBoard } from './board';
import type { Board, Piece, Pos, Side } from './types';

const ROLE_DIST: Piece[] = [
  'R', 'R', 'N', 'N', 'B', 'B', 'A', 'A', 'C', 'C', 'P', 'P', 'P', 'P', 'P',
];

// 按 (col, row, side) 推断揭棋暗子的"位置身份"
// 暗位 = 经典棋盘的初始位（除将/帅）
//   红方 (row=9): 0/8 列车；1/7 列马；2/6 列象；3/5 列士；4 列将
//   红方 (row=7): 1/7 列炮
//   红方 (row=6): 0/2/4/6/8 列兵
//   黑方类比 row=0 / row=2 / row=3
function darkRoleByCol(c: number, r: number, side: Side): Piece | null {
  if (side === 'r') {
    if (r === 9) {
      if (c === 0 || c === 8) return 'r';
      if (c === 1 || c === 7) return 'n';
      if (c === 2 || c === 6) return 'b';
      if (c === 3 || c === 5) return 'a';
      if (c === 4) return null;
    } else if (r === 7) {
      if (c === 1 || c === 7) return 'c';
    } else if (r === 6) {
      if (c === 0 || c === 2 || c === 4 || c === 6 || c === 8) return 'p';
    }
  } else {
    if (r === 0) {
      if (c === 0 || c === 8) return 'r';
      if (c === 1 || c === 7) return 'n';
      if (c === 2 || c === 6) return 'b';
      if (c === 3 || c === 5) return 'a';
      if (c === 4) return null;
    } else if (r === 2) {
      if (c === 1 || c === 7) return 'c';
    } else if (r === 3) {
      if (c === 0 || c === 2 || c === 4 || c === 6 || c === 8) return 'p';
    }
  }
  return null;
}

// 揭棋走子统一入口
export function banzhuMoveForPosition(
  b: Board,
  _realBoard: (Piece | null)[][],
  from: Pos,
  to: Pos,
  side: Side,
): boolean {
  const [fc, fr] = from;
  const piece = b[fc][fr];
  if (piece === '.') return false;
  // 暗子 (piece === 'x')：按列号判定身份走子
  if (piece === 'x') {
    return tryDarkMove(b, from, to, side);
  }
  // 明子：按真实身份走，士象可过河
  return tryMoveWithFlyingGuards(b, from, to);
}

function tryMoveWithFlyingGuards(b: Board, from: Pos, to: Pos): boolean {
  const [fc, fr] = from;
  const [tc, tr] = to;
  if (!inBoard(fc, fr) || !inBoard(tc, tr)) return false;
  const piece = b[fc][fr];
  if (piece === '.' || piece === 'x') return false;
  const side = pieceSide2(piece);
  if (side === null) return false;
  const target = b[tc][tr];
  if (target !== '.' && pieceSide2(target) === side) return false;
  if (fc === tc && fr === tr) return false;
  const lower = toLower(piece);
  if (lower === 'a' || lower === 'b') {
    return tryMoveExceptRiver(b, from, to);
  }
  return tryMove(b, from, to);
}

function tryMoveExceptRiver(b: Board, from: Pos, to: Pos): boolean {
  const [fc, fr] = from;
  const [tc, tr] = to;
  if (!inBoard(fc, fr) || !inBoard(tc, tr)) return false;
  const piece = b[fc][fr];
  if (piece === '.' || piece === 'x') return false;
  const side = pieceSide2(piece);
  if (side === null) return false;
  const target = b[tc][tr];
  if (target !== '.' && pieceSide2(target) === side) return false;
  if (fc === tc && fr === tr) return false;
  const dc = tc - fc, dr = tr - fr;
  const adx = Math.abs(dc), ady = Math.abs(dr);
  const lower = toLower(piece);
  if (lower === 'a') {
    // 士：揭棋下可过河，但仍限斜走一格 + 仍在九宫列内
    if (adx !== 1 || ady !== 1) return false;
    if (tc < 3 || tc > 5) return false;
    if (side === 'r' && (tr < 7 || tr > 9)) return false;
    if (side === 'b' && (tr < 0 || tr > 2)) return false;
    return true;
  }
  if (lower === 'b') {
    // 象：揭棋下可过河，田字 + 象眼
    if (adx !== 2 || ady !== 2) return false;
    const cc = (fc + tc) >> 1, cr = (fr + tr) >> 1;
    if (b[cc][cr] !== '.') return false;
    return true;
  }
  return false;
}

function tryDarkMove(b: Board, from: Pos, to: Pos, side: Side): boolean {
  const [fc, fr] = from;
  const lower = darkRoleByCol(fc, fr, side);
  if (lower === null) return false;
  // 模拟一个临时身份走子
  const tmp = b.map(col => col.slice());
  const fake: Piece = (side === 'r' ? toUpper(lower) : toLower(lower));
  tmp[fc][fr] = fake;
  return tryMove(tmp, from, to);
}

// 翻子：把 from 位置的暗子翻开成真实身份（从剩余未翻开暗子中随机）。
export function flipAt(
  b: Board,
  realBoard: (Piece | null)[][],
  from: Pos,
  side: Side,
  rng: () => number,
): { board: Board; realBoard: (Piece | null)[][]; piece: Piece } | null {
  const [fc, fr] = from;
  if (b[fc][fr] !== 'x') return null;
  const remaining: Piece[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (b[c][r] !== 'x') continue;
      const owner = realBoard[c][r];
      if (owner === null) continue;
      if (side === 'r' && owner >= 'A' && owner <= 'Z') remaining.push(owner);
      if (side === 'b' && owner >= 'a' && owner <= 'z') remaining.push(owner);
    }
  }
  if (remaining.length === 0) return null;
  const pick = remaining[Math.floor(rng() * remaining.length)];
  const nb = b.map(col => col.slice());
  const nrb = realBoard.map(col => col.slice());
  nb[fc][fr] = pick;
  nrb[fc][fr] = null;
  return { board: nb, realBoard: nrb, piece: pick };
}

// 创建揭棋初始局面：暗子随机分布
// realBoard[col][row] = 该格暗子的真实身份（明子为 null）
export function banzhuInitialBoard(
  rng: () => number = Math.random,
): { board: Board; realBoard: (Piece | null)[][] } {
  const b: Board = [];
  const real: (Piece | null)[][] = [];
  for (let c = 0; c < COLS; c++) {
    const col: Piece[] = [];
    const rcol: (Piece | null)[] = [];
    for (let r = 0; r < ROWS; r++) { col.push('.'); rcol.push(null); }
    b.push(col);
    real.push(rcol);
  }
  const blackSlots: Pos[] = [
    [0, 0], [1, 0], [2, 0], [3, 0], [5, 0], [6, 0], [7, 0], [8, 0],
    [1, 2], [7, 2],
    [0, 3], [2, 3], [4, 3], [6, 3], [8, 3],
  ];
  const redSlots: Pos[] = [
    [0, 9], [1, 9], [2, 9], [3, 9], [5, 9], [6, 9], [7, 9], [8, 9],
    [1, 7], [7, 7],
    [0, 6], [2, 6], [4, 6], [6, 6], [8, 6],
  ];
  const shuffledRed = [...ROLE_DIST].sort(() => rng() - 0.5);
  const shuffledBlack = [...ROLE_DIST.map(r => r.toLowerCase() as Piece)].sort(() => rng() - 0.5);
  for (let i = 0; i < redSlots.length; i++) {
    const [c, r] = redSlots[i];
    b[c][r] = 'x';
    real[c][r] = shuffledRed[i];
  }
  for (let i = 0; i < blackSlots.length; i++) {
    const [c, r] = blackSlots[i];
    b[c][r] = 'x';
    real[c][r] = shuffledBlack[i];
  }
  b[4][9] = 'K';
  b[4][0] = 'k';
  real[4][9] = null;
  real[4][0] = null;
  return { board: b, realBoard: real };
}

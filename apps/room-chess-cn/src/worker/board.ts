// 中国象棋走子合法性 + 将军/应将/困毙/和棋判定
// 棋盘坐标：col 0..8（从红方视角左到右），row 0..9（红方在 row 0..4，黑方在 row 5..9）
// "九宫"：col 3..5, row 0..2（红），row 7..9（黑）
// "河"：row 4 与 row 5 之间

import type { Board, Piece, Pos, Side } from './types';

export const COLS = 9;
export const ROWS = 10;

export function inBoard(c: number, r: number): boolean {
  return c >= 0 && c < COLS && r >= 0 && r < ROWS;
}

export function cloneBoard(b: Board): Board {
  return b.map(col => col.slice());
}

export function emptyBoard(): Board {
  const b: Board = [];
  for (let c = 0; c < COLS; c++) {
    const col: Piece[] = [];
    for (let r = 0; r < ROWS; r++) col.push('.');
    b.push(col);
  }
  return b;
}

// 0=空格, 1=红, 2=黑
export function pieceSide(p: Piece): Side | null {
  if (p === '.') return null;
  if (p === 'x') return null; // 暗子身份未知
  return 'kabsnrcp'.indexOf(p) >= 0 ? 'r' : 'b';
}

// 标准初始局面
// 约定：小写为黑方（'kabsnrcp'），大写为红方（'KABSNRCP'）
// 红方在 row 6..9（屏幕下方），黑方在 row 0..3（屏幕上方）
export function initialBoard(): Board {
  const b = emptyBoard();
  // 黑方
  b[0][0] = 'r'; b[1][0] = 'n'; b[2][0] = 'b'; b[3][0] = 'a'; b[4][0] = 'k';
  b[5][0] = 'a'; b[6][0] = 'b'; b[7][0] = 'n'; b[8][0] = 'r';
  b[1][2] = 'c'; b[7][2] = 'c';
  b[0][3] = 'p'; b[2][3] = 'p'; b[4][3] = 'p'; b[6][3] = 'p'; b[8][3] = 'p';
  // 红方
  b[0][9] = 'R'; b[1][9] = 'N'; b[2][9] = 'B'; b[3][9] = 'A'; b[4][9] = 'K';
  b[5][9] = 'A'; b[6][9] = 'B'; b[7][9] = 'N'; b[8][9] = 'R';
  b[1][7] = 'C'; b[7][7] = 'C';
  b[0][6] = 'P'; b[2][6] = 'P'; b[4][6] = 'P'; b[6][6] = 'P'; b[8][6] = 'P';
  return b;
}

export function pieceSide2(p: Piece): Side | null {
  if (p === '.' || p === 'x') return null;
  if (p >= 'A' && p <= 'Z') return 'r';
  if (p >= 'a' && p <= 'z') return 'b';
  return null;
}

export function toLower(p: Piece): Piece {
  if (p === '.' || p === 'x') return p;
  return p.toLowerCase() as Piece;
}

export function toUpper(p: Piece): Piece {
  if (p === '.' || p === 'x') return p;
  return p.toUpperCase() as Piece;
}

// 是否在己方九宫
export function inPalace(side: Side, c: number, r: number): boolean {
  if (c < 3 || c > 5) return false;
  if (side === 'r') return r >= 7 && r <= 9;
  return r >= 0 && r <= 2;
}

export function inOwnSide(side: Side, r: number): boolean {
  // 红方 row >= 5（不过河前进方向 row 减小）；黑方 row <= 4
  return side === 'r' ? r >= 5 : r <= 4;
}

export function acrossRiver(side: Side, r: number): boolean {
  return side === 'r' ? r <= 4 : r >= 5;
}

// 移动：给定 from/to，先做基本几何检查（不去重将军）
// 返回 true 表示几何上合法（已含马腿/象眼/炮翻山）
// 注意：揭棋的"按位置走"由 banzhu.ts 处理，这里只对已知身份走法做判定。
function countBetween(b: Board, c1: number, r1: number, c2: number, r2: number): number {
  let n = 0;
  if (c1 === c2) {
    const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
    for (let r = lo + 1; r < hi; r++) if (b[c1][r] !== '.') n++;
  } else if (r1 === r2) {
    const lo = Math.min(c1, c2), hi = Math.max(c1, c2);
    for (let c = lo + 1; c < hi; c++) if (b[c][r1] !== '.') n++;
  } else {
    return -1; // 不共线
  }
  return n;
}

export function tryMove(b: Board, from: Pos, to: Pos): boolean {
  const [fc, fr] = from;
  const [tc, tr] = to;
  if (!inBoard(fc, fr) || !inBoard(tc, tr)) return false;
  const piece = b[fc][fr];
  if (piece === '.' || piece === 'x') return false;
  const side = pieceSide2(piece);
  if (side === null) return false;
  const target = b[tc][tr];
  if (target !== '.' && pieceSide2(target) === side) return false; // 不能吃己方
  if (fc === tc && fr === tr) return false;

  const dc = tc - fc, dr = tr - fr;
  const adx = Math.abs(dc), ady = Math.abs(dr);
  const lower = toLower(piece);
  switch (lower) {
    case 'k': {
      if (!inPalace(side, tc, tr)) return false;
      if (adx + ady !== 1) return false;
      return true;
    }
    case 'a': {
      if (!inPalace(side, tc, tr)) return false;
      if (adx !== 1 || ady !== 1) return false;
      return true;
    }
    case 'b': {
      if (adx !== 2 || ady !== 2) return false;
      // 象眼：田字中心
      const cc = (fc + tc) >> 1, cr = (fr + tr) >> 1;
      if (b[cc][cr] !== '.') return false;
      // 不能过河
      if (side === 'r' && tr < 5) return false;
      if (side === 'b' && tr > 4) return false;
      return true;
    }
    case 'n': {
      if (!((adx === 1 && ady === 2) || (adx === 2 && ady === 1))) return false;
      // 蹩马腿
      let lx = 0, ly = 0;
      if (adx === 2) {
        lx = fc + Math.sign(dc);
        ly = fr;
      } else {
        lx = fc;
        ly = fr + Math.sign(dr);
      }
      if (b[lx][ly] !== '.') return false;
      return true;
    }
    case 'r': {
      if (fc !== tc && fr !== tr) return false;
      if (countBetween(b, fc, fr, tc, tr) !== 0) return false;
      return true;
    }
    case 'c': {
      if (fc !== tc && fr !== tr) return false;
      const n = countBetween(b, fc, fr, tc, tr);
      if (target === '.') {
        // 不吃子：中间无子
        if (n !== 0) return false;
        return true;
      } else {
        // 吃子：中间恰好 1 子
        if (n !== 1) return false;
        return true;
      }
    }
    case 'p': {
      const forward = side === 'r' ? -1 : 1;
      // 未过河：只能直走
      if (inOwnSide(side, fr)) {
        if (dc === 0 && dr === forward) return true;
        return false;
      } else {
        // 过河：可直走或横走
        if (dc === 0 && dr === forward) return true;
        if (dr === 0 && adx === 1) return true;
        return false;
      }
    }
  }
  return false;
}

// 找将/帅位置
export function findKing(b: Board, side: Side): Pos | null {
  const target = side === 'r' ? 'K' : 'k';
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (b[c][r] === target) return [c, r];
    }
  }
  return null;
}

// 是否被将军：side 方的将/帅位置在对方某子攻击范围内
export function isInCheck(b: Board, side: Side): boolean {
  const kp = findKing(b, side);
  if (!kp) return true; // 没将 = 已被吃（理论上不该发生）
  const enemy: Side = side === 'r' ? 'b' : 'r';
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === '.' || p === 'x') continue;
      if (pieceSide2(p) !== enemy) continue;
      if (tryMove(b, [c, r], kp)) return true;
    }
  }
  // 此外：双将照面
  const other = findKing(b, enemy);
  if (other) {
    const [kc, kr] = kp;
    const [oc, or] = other;
    if (kc === oc) {
      // 中间无子
      const lo = Math.min(kr, or), hi = Math.max(kr, or);
      let blocked = false;
      for (let r = lo + 1; r < hi; r++) if (b[kc][r] !== '.') { blocked = true; break; }
      if (!blocked) return true;
    }
  }
  return false;
}

// 模拟走子并返回新棋盘（不修改原）
export function simulateMove(b: Board, from: Pos, to: Pos): Board {
  const nb = cloneBoard(b);
  const [fc, fr] = from, [tc, tr] = to;
  nb[tc][tr] = nb[fc][fr];
  nb[fc][fr] = '.';
  return nb;
}

// 列出 side 方的所有合法走子（不含导致己方被将军的走子）
export function legalMoves(b: Board, side: Side): { from: Pos; to: Pos }[] {
  const out: { from: Pos; to: Pos }[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === '.' || p === 'x') continue;
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

export function isCheckmate(b: Board, side: Side): boolean {
  if (!isInCheck(b, side)) return false;
  return legalMoves(b, side).length === 0;
}

export function isStalemate(b: Board, side: Side): boolean {
  if (isInCheck(b, side)) return false;
  return legalMoves(b, side).length === 0;
}

// 60 回合无吃子自然和棋：返回 true 即触发
export const NO_CAPTURE_LIMIT = 60;

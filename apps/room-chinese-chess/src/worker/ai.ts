// 规则 AI：4 档难度
// 入门 0：随机合法走子
// 普通 1：贪心（吃子最大 + 子力价值）
// 困难 2：minimax depth=2
// 大师 3：alpha-beta depth=3

import {
  pieceSide2,
  toLower,
  isInCheck,
  simulateMove,
  legalMoves,
  COLS,
  ROWS,
} from './board';
import { banzhuMoveForPosition } from './banzhu';
import type { Board, Piece, Pos, Side } from './types';

export type AiLevel = 0 | 1 | 2 | 3;

// 子力价值
const VALUE: Record<string, number> = {
  k: 10000,
  r: 900,
  n: 450,
  b: 200,
  a: 200,
  c: 450,
  p: 100,
};

function pieceValue(p: Piece): number {
  if (p === '.' || p === 'x') return 0;
  return VALUE[toLower(p)] ?? 0;
}

// 简易位置加成（红方 row 越大越靠己方底 = 减分？反过来过河加分）
// 我们约定：红方 row 越小越靠黑方底（过河），加 5；黑方 row 越大越靠红方底，加 5
function positionalBonus(p: Piece, _c: number, r: number): number {
  const lower = toLower(p);
  if (lower === 'p') {
    // 兵：过河后价值提升
    const side = pieceSide2(p);
    if (side === 'r' && r <= 4) return 30;
    if (side === 'b' && r >= 5) return 30;
  }
  if (lower === 'c') {
    // 炮在河沿（红 row 5/黑 row 4）控中线加分
    if (r === 5 || r === 4) return 10;
  }
  return 0;
}

export function evaluate(b: Board, side: Side): number {
  // side 视角的得分
  let score = 0;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === '.' || p === 'x') continue;
      const s = pieceSide2(p);
      if (s === null) continue;
      const v = pieceValue(p) + positionalBonus(p, c, r);
      score += s === side ? v : -v;
    }
  }
  // 将军加分
  const enemy: Side = side === 'r' ? 'b' : 'r';
  if (isInCheck(b, enemy)) score += 50;
  if (isInCheck(b, side)) score -= 50;
  return score;
}

// 揭棋下：枚举所有合法走子（暗子按位置 + 明子士象可过河）
function banzhuLegalMoves(
  b: Board,
  real: (Piece | null)[][],
  side: Side,
): { from: Pos; to: Pos }[] {
  const out: { from: Pos; to: Pos }[] = [];
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      const p = b[c][r];
      if (p === '.') continue;
      // 暗子：必须是己方暗子
      if (p === 'x') {
        const owner = real[c][r];
        if (!owner) continue;
        const ownerSide = (owner >= 'A' && owner <= 'Z') ? 'r' : 'b';
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

export function pickRandom(
  b: Board,
  side: Side,
  real?: (Piece | null)[][],
): { from: Pos; to: Pos } | null {
  const moves = real ? banzhuLegalMoves(b, real, side) : legalMoves(b, side);
  if (moves.length === 0) return null;
  return moves[Math.floor(Math.random() * moves.length)];
}

export function pickGreedy(
  b: Board,
  side: Side,
  real?: (Piece | null)[][],
): { from: Pos; to: Pos } | null {
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

function minimax(
  b: Board,
  side: Side,
  depth: number,
  maximizing: boolean,
  alpha: number,
  beta: number,
  useAlphaBeta: boolean,
  real?: (Piece | null)[][],
): number {
  if (depth === 0) return evaluate(b, maximizing ? side : (side === 'r' ? 'b' : 'r'));
  const curSide = maximizing ? side : (side === 'r' ? 'b' : 'r');
  const moves = real ? banzhuLegalMoves(b, real, curSide) : legalMoves(b, curSide);
  if (moves.length === 0) {
    // 终局：被将 = 大负；无子可走但未被将 = 平
    if (isInCheck(b, curSide)) {
      return maximizing ? -100000 : 100000;
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

export function pickMinimax(
  b: Board,
  side: Side,
  depth: number,
  useAlphaBeta: boolean,
  real?: (Piece | null)[][],
): { from: Pos; to: Pos } | null {
  const moves = real ? banzhuLegalMoves(b, real, side) : legalMoves(b, side);
  if (moves.length === 0) return null;
  let best: { from: Pos; to: Pos } | null = null;
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

export function pickAiMove(
  b: Board,
  side: Side,
  level: AiLevel,
  real?: (Piece | null)[][],
): { from: Pos; to: Pos } | null {
  switch (level) {
    case 0: return pickRandom(b, side, real);
    case 1: return pickGreedy(b, side, real);
    case 2: return pickMinimax(b, side, 2, false, real);
    case 3: return pickMinimax(b, side, 3, true, real);
  }
}

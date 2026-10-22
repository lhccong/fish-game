/* ==================================================================
   围棋：棋组/气、落子提子、数目 + AI（纯函数）
   ================================================================== */

import { EMPTY, BLACK, WHITE, cloneBoard, listEmpty, randomOf, type AiPos } from './types';

type Stone = [number, number];
interface Group {
  stones: Stone[];
  liberties: number;
}

const DIRS: Stone[] = [[0, 1], [0, -1], [1, 0], [-1, 0]];

function getGroup(board: number[][], r: number, c: number): Group | null {
  const color = board[r][c];
  if (color === EMPTY) return null;
  const visited = new Set<string>();
  const group: Stone[] = [];
  let liberties = 0;
  const queue: Stone[] = [[r, c]];
  visited.add(r + ',' + c);
  while (queue.length) {
    const [pr, pc] = queue.shift()!;
    group.push([pr, pc]);
    for (const [dr, dc] of DIRS) {
      const nr = pr + dr, nc = pc + dc;
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length) continue;
      if (board[nr][nc] === EMPTY) { liberties++; continue; }
      if (board[nr][nc] === color && !visited.has(nr + ',' + nc)) {
        visited.add(nr + ',' + nc);
        queue.push([nr, nc]);
      }
    }
  }
  return { stones: group, liberties };
}

/**
 * 围棋落子并处理提子（会修改传入棋盘）。
 * @returns null 表示非法（已有子或自杀）
 */
export function goPlaceStone(board: number[][], r: number, c: number, color: number): { captured: { r: number; c: number }[] } | null {
  if (r < 0 || r >= board.length || c < 0 || c >= board.length) return null;
  if (board[r][c] !== EMPTY) return null;

  board[r][c] = color;
  const opponent = color === BLACK ? WHITE : BLACK;
  const captured: { r: number; c: number }[] = [];

  // 检查相邻对方棋组，无气则提
  for (const [dr, dc] of DIRS) {
    const nr = r + dr, nc = c + dc;
    if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length) continue;
    if (board[nr][nc] === opponent) {
      const g = getGroup(board, nr, nc);
      if (g && g.liberties === 0) {
        for (const [sr, sc] of g.stones) {
          board[sr][sc] = EMPTY;
          captured.push({ r: sr, c: sc });
        }
      }
    }
  }

  // 检查自身气（防止自杀）
  const self = getGroup(board, r, c);
  if (self && self.liberties === 0) {
    board[r][c] = EMPTY;
    return null;
  }

  return { captured };
}

/** 围棋数目（简易中国规则） */
export function goScore(board: number[][]): { black: number; white: number } {
  const n = board.length;
  let black = 0, white = 0;
  const visited = new Set<string>();

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === BLACK) black++;
      else if (board[r][c] === WHITE) white++;
      else if (!visited.has(r + ',' + c)) {
        const region: Stone[] = [];
        const queue: Stone[] = [[r, c]];
        visited.add(r + ',' + c);
        const borders = new Set<number>();
        while (queue.length) {
          const [pr, pc] = queue.shift()!;
          region.push([pr, pc]);
          for (const [dr, dc] of DIRS) {
            const nr = pr + dr, nc = pc + dc;
            if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
            if (board[nr][nc] === EMPTY && !visited.has(nr + ',' + nc)) {
              visited.add(nr + ',' + nc);
              queue.push([nr, nc]);
            } else if (board[nr][nc] !== EMPTY) {
              borders.add(board[nr][nc]);
            }
          }
        }
        if (borders.size === 1) {
          if (borders.has(BLACK)) black += region.length;
          else if (borders.has(WHITE)) white += region.length;
        }
      }
    }
  }
  return { black, white };
}

export function pickGoMove(board: number[][], color: number, level: number): AiPos | null {
  const n = board.length;
  const empty = listEmpty(board);
  if (!empty.length) return null;
  if (level === 0) {
    // 随机但避开自杀点
    const legal = empty.filter(p => goPlaceStone(cloneBoard(board), p.r, p.c, color) !== null);
    return legal.length ? randomOf(legal) : null;
  }

  let best: AiPos | null = null;
  let bestScore = -Infinity;
  for (const p of empty) {
    const res = goPlaceStone(cloneBoard(board), p.r, p.c, color);
    if (!res) continue; // 自杀 / 非法
    const captured = res.captured.length;

    let score = 0;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const nr = p.r + dr, nc = p.c + dc;
        if (nr >= 0 && nr < n && nc >= 0 && nc < n && board[nr][nc] !== EMPTY) score += 10;
      }
    }
    if (captured > 0) score += captured * 50;
    score -= (Math.abs(p.r - 3) + Math.abs(p.c - 3) + Math.abs(p.r - (n - 4)) + Math.abs(p.c - (n - 4))) * 2;
    if (level === 1) score += Math.random() * 20;
    if (level === 2) score += Math.random() * 5;
    if (level === 3) score += (p.r >= 3 && p.r <= n - 4 && p.c >= 3 && p.c <= n - 4) ? 15 : -10;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

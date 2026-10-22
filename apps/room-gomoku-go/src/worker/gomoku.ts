/* ==================================================================
   五子棋：胜负判定 + AI（纯函数，不修改传入棋盘）
   ================================================================== */

import { EMPTY, BLACK, WHITE, listEmpty, randomOf, type AiPos } from './types';

/** 落子后检测五连，返回连线坐标（排序后）；无则 null */
export function checkGomokuWin(board: number[][], r: number, c: number, color: number) {
  const dirs: [number, number][] = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let d = 0; d < 4; d++) {
    const line: { r: number; c: number }[] = [{ r, c }];
    for (let s = 1; s <= 4; s++) {
      const nr = r + dirs[d][0] * s, nc = c + dirs[d][1] * s;
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length || board[nr][nc] !== color) break;
      line.push({ r: nr, c: nc });
    }
    for (let s = -1; s >= -4; s--) {
      const nr = r + dirs[d][0] * s, nc = c + dirs[d][1] * s;
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length || board[nr][nc] !== color) break;
      line.push({ r: nr, c: nc });
    }
    if (line.length >= 5) {
      line.sort((a, b) => a.r - b.r || a.c - b.c);
      return line;
    }
  }
  return null;
}

export function pickGomokuMove(board: number[][], color: number, level: number): AiPos | null {
  const n = board.length;
  const empty = listEmpty(board);
  if (!empty.length) return null;
  if (level === 0) return randomOf(empty);

  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

  function scorePos(r: number, c: number, col: number): number {
    let sc = 0;
    for (let d = 0; d < 4; d++) {
      let cnt = 1, openA = false, openB = false;
      for (let s = 1; s <= 4; s++) {
        const nr = r + dirs[d][0] * s, nc = c + dirs[d][1] * s;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) break;
        if (board[nr][nc] === col) cnt++;
        else if (board[nr][nc] === EMPTY) { openA = true; break; }
        else break;
      }
      for (let s = -1; s >= -4; s--) {
        const nr = r + dirs[d][0] * s, nc = c + dirs[d][1] * s;
        if (nr < 0 || nr >= n || nc < 0 || nc >= n) break;
        if (board[nr][nc] === col) cnt++;
        else if (board[nr][nc] === EMPTY) { openB = true; break; }
        else break;
      }
      if (cnt >= 5) sc += 1000000;
      else if (cnt === 4) sc += (openA && openB) ? 100000 : (openA || openB) ? 10000 : 0;
      else if (cnt === 3) sc += (openA && openB) ? 5000 : (openA || openB) ? 500 : 0;
      else if (cnt === 2) sc += (openA && openB) ? 200 : (openA || openB) ? 20 : 0;
      else sc += (openA && openB) ? 10 : 1;
    }
    return sc;
  }

  const opp = color === BLACK ? WHITE : BLACK;
  let best: AiPos | null = null;
  let bestScore = -Infinity;
  for (const p of empty) {
    const atk = scorePos(p.r, p.c, color);
    const def = scorePos(p.r, p.c, opp);
    let s = atk * 1.1 + def;
    if (level === 1) s = atk + def * 0.8;
    if (level === 2) s = atk * 1.2 + def * 1.5;
    if (level === 3) {
      s = atk * 1.3 + def * 1.8
        - (Math.abs(p.r - (n - 1) / 2) + Math.abs(p.c - (n - 1) / 2)) * 2;
    }
    if (s > bestScore) { bestScore = s; best = p; }
  }
  return best;
}

/* ==================================================================
   AI 入口：按 gameType 分发到五子棋 / 围棋引擎（纯函数，不修改传入棋盘）
   ================================================================== */

import { pickGomokuMove } from './gomoku';
import { pickGoMove } from './go';
import type { AiPos } from './types';

export type { AiLevel, AiPos } from './types';

export function pickAiMove(
  gameType: 'gomoku' | 'go',
  board: number[][],
  color: number,
  level: number,
): AiPos | null {
  return gameType === 'go'
    ? pickGoMove(board, color, level)
    : pickGomokuMove(board, color, level);
}

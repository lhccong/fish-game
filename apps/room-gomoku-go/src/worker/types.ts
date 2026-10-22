/* ==================================================================
   五子棋 / 围棋 共享类型与棋盘工具
   ================================================================== */

export const SIZE_GOMOKU = 15;
export const SIZE_GO = 19;
export const EMPTY = 0, BLACK = 1, WHITE = 2;

export type AiLevel = 0 | 1 | 2 | 3;
export interface AiPos { r: number; c: number }

export function createBoard(size: number): number[][] {
  const b: number[][] = [];
  for (let r = 0; r < size; r++) {
    b.push([]);
    for (let c = 0; c < size; c++) b[r].push(EMPTY);
  }
  return b;
}

export function cloneBoard(b: number[][]): number[][] {
  return b.map(row => row.slice());
}

export function listEmpty(board: number[][]): AiPos[] {
  const n = board.length;
  const empty: AiPos[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === EMPTY) empty.push({ r, c });
    }
  }
  return empty;
}

export function randomOf(list: AiPos[]): AiPos {
  return list[Math.floor(Math.random() * list.length)];
}

/* ==================================================================
   State 类型
   ================================================================== */
export interface Move {
  r: number;
  c: number;
  color?: number;
  // 落子之前的 turn（用于悔棋重置 turn）
  turnBefore?: number;
  // 围棋：被提子的位置（回退时放回原位）
  captured?: { r: number; c: number }[];
  // pass（围棋专用）
  pass?: boolean;
}

export interface PendingRequest {
  type: string;
  from: string;
  noResponse?: boolean;
  createdAt: number;
}

export interface LastRequestResult {
  type: string;
  accept: boolean;
  from: string;
  by: string;
  ts: number;
  expired?: boolean;
}

export interface ChessState {
  // 游戏配置
  gameType: 'gomoku' | 'go';
  boardSize: number;

  // 棋盘
  board: number[][];
  turn: number;
  finished: boolean;
  winner: number;

  // 围棋专用
  passes: number;
  capturedB: number;
  capturedW: number;

  // 阶段（顶层状态机）
  phase: 'lobby' | 'playing' | 'end_confirm' | 'finished';
  confirmDeadBy: { black: boolean; white: boolean };

  // 辅助
  lastMove: { r: number; c: number } | null;
  winLine: { r: number; c: number }[] | null;
  winReason: string;

  // 在线联机角色
  blackPlayer: string | null;
  whitePlayer: string | null;
  blackReady: boolean;
  whiteReady: boolean;
  hostId: string | null;

  // AI 模式标识
  mode: 'online' | 'ai';
  aiLevel: number;
  hostSide: 'black' | 'white';

  // 玩家花名册
  players: Record<string, { name: string }>;

  // 会话内统计
  stats: {
    blackWins: number; blackLosses: number; blackDraws: number;
    whiteWins: number; whiteLosses: number; whiteDraws: number;
  };

  // 待确认请求
  pendingRequest: PendingRequest | null;

  // 最近一次被回应的请求结果
  lastRequestResult: LastRequestResult | null;

  // 主动退出标记
  activeExit: Record<string, boolean | 'backToMenu'>;

  // 落子历史
  moves: Move[];

  // 在线模式悔棋：每方独立计数
  undoCount: { black: number; white: number };

  // 超时配置
  requestTimeoutMs: number;
  gameTimeoutMs: number;
  lastActivityAt: number;
  gameStartedAt: number;
}

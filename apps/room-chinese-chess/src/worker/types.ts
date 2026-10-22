// 中国象棋房间的内部类型定义
// 红方: 'r', 黑方: 'b'（与 pieceSide2 的判断一致：大写红方，小写黑方）
// 棋子类型：
//   k/K 帅/将  a/A 仕/士  b/B 相/象  n/N 马  r/R 车  c/C 炮  p/P 兵/卒
// 揭棋暗子用 'x' 表示（身份未翻）
// 空格用 '.'

export type Side = 'r' | 'b';
export type Piece =
  | 'k' | 'a' | 'b' | 'n' | 'r' | 'c' | 'p'
  | 'K' | 'A' | 'B' | 'N' | 'R' | 'C' | 'P'
  | 'x' | '.';
export type Board = Piece[][]; // 9 列 x 10 行，board[col][row]
export type Pos = readonly [number, number]; // [col, row]，col 0..8, row 0..9

export type GameMode = 'classic' | 'banzhu' | 'puzzle';

export interface MoveRecord {
  from: Pos;
  to: Pos;
  piece: Piece;          // 移动方原始身份（揭棋下可能为 'x'）
  captured: Piece;       // 被吃子（揭棋可能是 'x'）
  revealedCapture?: Piece | null; // 揭棋吃暗子时揭示的身份（仅吃方可见）
  flip?: boolean;        // 是否为翻子操作（揭棋）
  isCheck?: boolean;     // 落子后是否将军
  turnBefore: Side;      // 落子方
  // 残局面专用
  puzzleStepsAfter?: number; // 落子后已走步数
}

export interface Stats {
  redWins: number;
  redLosses: number;
  redDraws: number;
  blackWins: number;
  blackLosses: number;
  blackDraws: number;
}

export interface GameState {
  gameMode: GameMode;
  matchMode: 'ai' | 'online';
  aiLevel: 0 | 1 | 2 | 3;
  hostSide: Side;
  // 棋盘（揭棋下还有暗子）
  board: Board;
  // 揭棋专用：每个位置的真实身份；'x' 表示当前位置是暗子（null 表示该格已知为空/已翻开/不属于暗子）
  banzhuReal: (Piece | null)[][];
  // 揭棋专用：每方已翻开的暗子数（用于限制翻子策略）
  banzhuFlipped: { r: number; b: number };
  // 揭棋专用：是否启用翻子（玩家入口 + AI 翻子共用开关；默认 false）
  enableFlip: boolean;
  turn: Side;
  history: MoveRecord[];
  // 60 回合无吃子自然和棋
  movesSinceCapture: number;
  // 连续未将军/应将步数（用于循环检测的辅助标志）
  phase: 'idle' | 'lobby' | 'playing' | 'finished';
  finished: boolean;
  winner: Side | null; // null = 平局/未结束
  reason: '' | 'checkmate' | 'stalemate' | 'resign' | 'timeout' | 'fifty' | 'repetition' | 'puzzleFail' | 'puzzleSolved';
  // 在线联机状态
  players: Record<string, { side: Side | null; ready: boolean; name?: string }>;
  redPlayer: string | null;
  blackPlayer: string | null;
  redReady: boolean;
  blackReady: boolean;
  // 房间通用
  hostId: string | null;
  // 残局面
  puzzleId: string | null;
  puzzleLimit: number;       // 限步
  puzzleSteps: number;       // 已走步数
  // 统计
  stats: Stats;
  // 弹窗协议：与 room-gomoku-go 一致
  pendingRequest: PendingRequest | null;
  lastRequestResult: LastRequestResult | null;
  // 悔棋次数：每方独立计数
  undoCount: { r: number; b: number };
  // 提示
  message?: string;
  // 玩家最近一次合法走子是否将军（用于高亮将军标志）
  lastCheck: boolean;
}

export interface PendingRequest {
  type: 'undo' | 'restart' | 'rematch' | 'resign' | 'backToMenu';
  from: string;
  createdAt: number;
  noResponse?: boolean;
}

export interface LastRequestResult {
  type: 'undo' | 'restart' | 'rematch' | 'resign' | 'backToMenu';
  accept: boolean;
  from: string;
  by: string;
  ts: number;
  expired?: boolean;
}

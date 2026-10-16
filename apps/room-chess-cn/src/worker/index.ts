/* ==================================================================
   Room Worker — 中国象棋
   - 经典模式、揭棋、残局挑战 三模式合一
   - 人机（4 档规则 AI）/ 在线联机
   - 走子合法性、将军/应将/困毙、60 回合无吃子自然和棋
   - 弹窗协议与 room-chess 对齐：pendingRequest / lastRequestResult
   ================================================================== */

import { defineRoom } from '@parti/worker-sdk';
import type { RoomContext, RoomPlayer } from '@parti/worker-sdk';
import {
  initialBoard,
  pieceSide2,
  tryMove,
  simulateMove,
  isInCheck,
  isCheckmate,
  isStalemate,
  NO_CAPTURE_LIMIT,
  COLS,
  ROWS,
  inBoard,
} from './board';
import { banzhuMoveForPosition, banzhuInitialBoard, flipAt } from './banzhu';
import { PUZZLES, rowsToBoard } from './puzzles';
import { pickAiMove, type AiLevel } from './ai';
import type { Board, GameState, Piece, Pos, Side, PendingRequest, LastRequestResult } from './types';

type Ctx = RoomContext<GameState>;

export type { PendingRequest, LastRequestResult };

/* ==================================================================
   工具函数
   ================================================================== */

function emptyReal(): (Piece | null)[][] {
  const r: (Piece | null)[][] = [];
  for (let c = 0; c < COLS; c++) {
    const col: (Piece | null)[] = [];
    for (let i = 0; i < ROWS; i++) col.push(null);
    r.push(col);
  }
  return r;
}

function makeInitialState(): GameState {
  return {
    gameMode: 'classic',
    matchMode: 'online',
    aiLevel: 1,
    hostSide: 'r',
    board: initialBoard(),
    banzhuReal: emptyReal(),
    banzhuFlipped: { r: 0, b: 0 },
    enableFlip: false,
    turn: 'r',
    history: [],
    movesSinceCapture: 0,
    phase: 'lobby',
    finished: false,
    winner: null,
    reason: '',
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
      redWins: 0, redLosses: 0, redDraws: 0,
      blackWins: 0, blackLosses: 0, blackDraws: 0,
    },
    undoCount: { r: 2, b: 2 },
    pendingRequest: null,
    lastRequestResult: null,
    lastCheck: false,
  };
}

// 揭棋下走子：把"暗子按位置" + "明子按身份"统一处理
function banzhuTryMove(
  b: Board,
  real: (Piece | null)[][],
  from: Pos,
  to: Pos,
  side: Side,
): boolean {
  return banzhuMoveForPosition(b, real, from, to, side);
}

// 经典走子合法性（处理暗子：揭棋下不可调用）
function classicTryMove(b: Board, from: Pos, to: Pos, side: Side): boolean {
  const [fc, fr] = from;
  const piece = b[fc][fr];
  if (piece === '.' || piece === 'x') return false;
  if (pieceSide2(piece) !== side) return false;
  if (!tryMove(b, from, to)) return false;
  const nb = simulateMove(b, from, to);
  if (isInCheck(nb, side)) return false;
  return true;
}

// 走子后：判断胜负/和棋
function evaluateAfterMove(st: GameState): void {
  const enemy: Side = st.turn === 'r' ? 'b' : 'r';
  st.lastCheck = isInCheck(st.board, enemy);
  if (isCheckmate(st.board, enemy)) {
    st.finished = true;
    st.winner = st.turn;
    st.reason = 'checkmate';
    st.phase = 'finished';
    recordStats(st, st.winner, 'win');
    return;
  }
  if (isStalemate(st.board, enemy)) {
    st.finished = true;
    st.winner = null;
    st.reason = 'stalemate';
    st.phase = 'finished';
    recordStats(st, null, 'draw');
    return;
  }
  if (st.movesSinceCapture >= NO_CAPTURE_LIMIT) {
    st.finished = true;
    st.winner = null;
    st.reason = 'fifty';
    st.phase = 'finished';
    recordStats(st, null, 'draw');
    return;
  }
  // 切换走子方
  st.turn = enemy;
}

function recordStats(st: GameState, winner: Side | null, _kind: 'win' | 'loss' | 'draw'): void {
  if (winner === 'r') {
    st.stats.redWins++;
    st.stats.blackLosses++;
  } else if (winner === 'b') {
    st.stats.blackWins++;
    st.stats.redLosses++;
  } else {
    st.stats.redDraws++;
    st.stats.blackDraws++;
  }
}

/* ==================================================================
   开局逻辑
   ================================================================== */

function startMatch(ctx: Ctx): void {
  const st = ctx.state;
  st.phase = 'playing';
  st.finished = false;
  st.winner = null;
  st.reason = '';
  st.history = [];
  st.movesSinceCapture = 0;
  st.banzhuFlipped = { r: 0, b: 0 };
  st.lastCheck = false;
  st.puzzleSteps = 0;
  // 悔棋次数：每方各 2 次（残局模式不提供悔棋）
  st.undoCount = st.gameMode === 'puzzle' ? { r: 0, b: 0 } : { r: 2, b: 2 };
  st.pendingRequest = null;
  st.lastRequestResult = null;

  if (st.gameMode === 'banzhu') {
    const init = banzhuInitialBoard(ctx.random);
    st.board = init.board;
    st.banzhuReal = init.realBoard;
    st.turn = 'r';
  } else if (st.gameMode === 'puzzle') {
    const p = PUZZLES.find(x => x.id === st.puzzleId) || PUZZLES[0];
    st.board = rowsToBoard(p.rows);
    st.banzhuReal = emptyReal();
    st.puzzleId = p.id;
    st.puzzleLimit = p.limit;
    st.puzzleSteps = 0;
    st.turn = 'r';
  } else {
    st.board = initialBoard();
    st.banzhuReal = emptyReal();
    st.turn = 'r';
  }

  // 残局面：玩家必须执红，且为 AI 模式
  if (st.gameMode === 'puzzle') {
    st.matchMode = 'ai';
    st.hostSide = 'r';
  }

  // 人机模式：AI 执方 = 对方
  if (st.matchMode === 'ai' && st.gameMode !== 'puzzle') {
    const aiSide: Side = st.hostSide === 'r' ? 'b' : 'r';
    ctx.setTimer('ai-turn', 600, () => aiTurn(ctx, aiSide));
  }
}

// 触发 AI 走子
function aiTurn(ctx: Ctx, side: Side): void {
  const st = ctx.state;
  if (st.finished || st.phase !== 'playing') return;
  if (st.turn !== side) return;
  // 揭棋下：若允许翻子，先尝试翻子
  if (st.gameMode === 'banzhu' && st.enableFlip) {
    const flipped = aiFlipIfUseful(ctx, side);
    if (flipped) return;
  }
  const mv = pickAiMove(
    st.board,
    side,
    st.aiLevel as AiLevel,
    st.gameMode === 'banzhu' ? st.banzhuReal : undefined,
  );
  if (!mv) {
    st.finished = true;
    st.winner = side === 'r' ? 'b' : 'r';
    st.reason = 'checkmate';
    st.phase = 'finished';
    recordStats(st, st.winner, 'win');
    return;
  }
  applyMove(ctx, mv.from, mv.to, 'ai-bot', { aiAuto: true });
}

function aiFlipIfUseful(ctx: Ctx, side: Side): boolean {
  const st = ctx.state;
  let best: { pos: Pos; gain: number; piece: Piece } | null = null;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < ROWS; r++) {
      if (st.board[c][r] !== 'x') continue;
      const owner = st.banzhuReal[c][r];
      if (!owner) continue;
      if (side === 'r' && !(owner >= 'A' && owner <= 'Z')) continue;
      if (side === 'b' && !(owner >= 'a' && owner <= 'z')) continue;
      const v = pieceValueOf(owner);
      if (!best || v > best.gain) {
        best = { pos: [c, r], gain: v, piece: owner };
      }
    }
  }
  if (!best) return false;
  applyFlip(ctx, best.pos, 'ai-bot', { aiAuto: true });
  return true;
}

function pieceValueOf(p: Piece): number {
  const lower = p.toLowerCase();
  const v: Record<string, number> = { k: 10000, r: 900, n: 450, b: 200, a: 200, c: 450, p: 100 };
  return v[lower] ?? 0;
}

/* ==================================================================
   走子统一入口（玩家/AI 都用）
   ================================================================== */

function applyMove(
  ctx: Ctx,
  from: Pos,
  to: Pos,
  playerId: string,
  opts: { aiAuto?: boolean } = {},
): void {
  const st = ctx.state;
  if (st.finished || st.phase !== 'playing') return;

  const side = st.turn;
  // 校验：是否是该走子方
  if (!opts.aiAuto) {
    if (st.matchMode === 'ai') {
      if (playerId !== st.hostId) return;
      if (side !== st.hostSide) return;
    } else {
      if (side === 'r' && st.redPlayer !== playerId) return;
      if (side === 'b' && st.blackPlayer !== playerId) return;
    }
  }

  // 校验走子合法性
  let ok = false;
  if (st.gameMode === 'banzhu') {
    ok = banzhuTryMove(st.board, st.banzhuReal, from, to, side);
  } else {
    ok = classicTryMove(st.board, from, to, side);
  }
  if (!ok) return;

  const piece = st.board[from[0]][from[1]];
  const captured = st.board[to[0]][to[1]];
  const nb = simulateMove(st.board, from, to);
  // 揭棋下：翻开暗子（棋子移动到 to，真实身份写入 to）
  if (st.gameMode === 'banzhu' && piece === 'x') {
    const realPiece = st.banzhuReal[from[0]][from[1]];
    if (realPiece) {
      nb[to[0]][to[1]] = realPiece;
    }
  }
  st.board = nb;

  // 揭棋：吃暗子时揭示（仅吃方知道；这里 state 全量同步对揭棋是设计取舍——我们选择揭示）
  let revealed: Piece | null = null;
  if (st.gameMode === 'banzhu' && captured === 'x') {
    revealed = st.banzhuReal[to[0]][to[1]];
    if (revealed) st.banzhuReal[to[0]][to[1]] = null;
  }

  // 记录
  const move: GameState['history'][number] = {
    from, to, piece, captured,
    revealedCapture: revealed,
    turnBefore: side,
  };
  st.history.push(move);
  st.movesSinceCapture = captured !== '.' && captured !== 'x' ? 0 : st.movesSinceCapture + 1;
  st.banzhuFlipped[side] += piece === 'x' ? 1 : 0;

  // 残局步数
  if (st.gameMode === 'puzzle') {
    st.puzzleSteps += 1;
    move.puzzleStepsAfter = st.puzzleSteps;
    if (st.puzzleSteps > st.puzzleLimit) {
      st.finished = true;
      st.winner = 'b';
      st.reason = 'puzzleFail';
      st.phase = 'finished';
      recordStats(st, 'b', 'win');
      return;
    }
  }

  // 胜负判定
  evaluateAfterMove(st);

  // 在线/Ai 后继
  if (!st.finished) {
    if (st.matchMode === 'ai') {
      const aiSide: Side = st.hostSide === 'r' ? 'b' : 'r';
      ctx.setTimer('ai-turn', 600, () => aiTurn(ctx, aiSide));
    }
  }
}

function applyFlip(
  ctx: Ctx,
  pos: Pos,
  playerId: string,
  opts: { aiAuto?: boolean } = {},
): void {
  const st = ctx.state;
  if (st.finished || st.phase !== 'playing') return;
  if (st.gameMode !== 'banzhu') return;
  const side = st.turn;
  if (!opts.aiAuto) {
    if (st.matchMode === 'ai') {
      if (playerId !== st.hostId) return;
      if (side !== st.hostSide) return;
    } else {
      if (side === 'r' && st.redPlayer !== playerId) return;
      if (side === 'b' && st.blackPlayer !== playerId) return;
    }
  }
  const r = flipAt(st.board, st.banzhuReal, pos, side, ctx.random);
  if (!r) return;
  st.board = r.board;
  st.banzhuReal = r.realBoard;
  st.banzhuFlipped[side] += 1;
  st.history.push({
    from: pos, to: pos, piece: 'x', captured: '.',
    flip: true, turnBefore: side,
  });
  // 翻子后换边
  st.turn = side === 'r' ? 'b' : 'r';
  // 判定对方是否被将
  st.lastCheck = isInCheck(st.board, st.turn);
  // 后继
  if (!st.finished && st.matchMode === 'ai') {
    const aiSide: Side = st.hostSide === 'r' ? 'b' : 'r';
    ctx.setTimer('ai-turn', 600, () => aiTurn(ctx, aiSide));
  }
}

/* ==================================================================
   悔棋 / 撤销（本地撤销，state 直接回滚）
   ================================================================== */

function performUndo(st: GameState, playerSide: Side): boolean {
  if (st.finished || st.phase !== 'playing') return false;
  if (st.gameMode === 'puzzle') return false;
  if (st.history.length === 0) return false;
  // 人机模式：撤销两步（AI + 玩家），消耗请求方 1 次悔棋机会
  // 在线模式："离手后立即可悔"
  //   - 轮到我（对手刚下完，playerSide === st.turn）：撤销两步（对手 + 我），回合不变仍是我
  //   - 轮到对手（我刚下完，playerSide !== st.turn）：撤销一步，回合变为对手
  let steps: number;
  if (st.matchMode === 'ai') {
    steps = 2;
  } else {
    // 在线模式：执子方是 playerSide；轮到方是 st.turn
    steps = playerSide === st.turn ? 2 : 1;
  }
  if ((st.undoCount[playerSide] || 0) < 1) return false;
  if (st.history.length < steps) return false;
  // 在线悔 1 步时（我刚下完）必须确认最后一手是本方执方
  if (st.matchMode === 'online' && steps === 1) {
    const last = st.history[st.history.length - 1];
    if (!last || last.turnBefore !== playerSide) return false;
  }
  const targetPly = Math.max(0, st.history.length - steps);
  undoTo(st, targetPly);
  st.undoCount[playerSide] = Math.max(0, (st.undoCount[playerSide] || 0) - 1);
  return true;
}

/**
 * 悔棋：把 history 回退到目标长度 ply。
 * - 象棋 / 翻子棋：恢复 from/to 的棋子和被吃子；翻子棋还原 banzhuReal/banzhuFlipped
 * - 重算 lastCheck；清掉 finished/winner/reason（如果原本是已结束态）
 */
function undoTo(st: GameState, ply: number): void {
  while (st.history.length > ply) {
    const move = st.history.pop();
    if (!move) break;
    const nb = st.board.map(col => col.slice());
    if (st.gameMode === 'banzhu' && move.flip) {
      // 翻子撤销：把 from 翻回 'x'，并清掉 banzhuReal[from]（重置为未知）
      nb[move.from[0]][move.from[1]] = 'x';
      st.banzhuReal[move.from[0]][move.from[1]] = null;
    } else {
      nb[move.to[0]][move.to[1]] = move.captured;
      if (st.gameMode === 'banzhu' && move.piece === 'x') {
        // 翻子后走子：from 位置恢复为 'x'（底牌未知）
        nb[move.from[0]][move.from[1]] = 'x';
        st.banzhuReal[move.from[0]][move.from[1]] = null;
      } else {
        nb[move.from[0]][move.from[1]] = move.piece;
      }
      if (st.gameMode === 'banzhu' && move.revealedCapture) {
        st.banzhuReal[move.to[0]][move.to[1]] = move.revealedCapture;
      }
    }
    st.board = nb;
    st.movesSinceCapture = Math.max(0, st.movesSinceCapture - 1);
    st.turn = move.turnBefore;
    if (st.gameMode === 'banzhu' && (move.flip || move.piece === 'x')) {
      st.banzhuFlipped[move.turnBefore] = Math.max(0, st.banzhuFlipped[move.turnBefore] - 1);
    }
  }
  // 重算 lastCheck
  st.lastCheck = isInCheck(st.board, st.turn);
  // 清掉已结束态（悔棋到中局）
  if (st.finished) {
    st.finished = false;
    st.winner = null;
    st.reason = '';
    st.phase = 'playing';
  }
}

/* ==================================================================
   弹窗协议（与 room-chess 一致）
   ================================================================== */

const REQUEST_TIMEOUT_MS = 15_000;

function setPendingRequest(
  ctx: Ctx,
  type: PendingRequest['type'],
  from: string,
  noResponse: boolean,
): void {
  const st = ctx.state;
  st.pendingRequest = { type, from, createdAt: ctx.now(), noResponse };
  ctx.broadcast('requestPending', { type, from, noResponse });
  ctx.setTimer('request-timeout', REQUEST_TIMEOUT_MS, () => {
    autoRejectRequest(ctx, type);
  });
}

function autoRejectRequest(ctx: Ctx, expectType: PendingRequest['type']): void {
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
    expired: true,
  };
  ctx.broadcast('requestCleared', { type: expectType });
}

function clearPending(ctx: Ctx): void {
  const st = ctx.state;
  st.pendingRequest = null;
  ctx.clearTimer('request-timeout');
}

/* ==================================================================
   defineRoom
   ================================================================== */

export default defineRoom<GameState>({
  meta: {
    name: '中国象棋',
    minPlayers: 1,
    maxPlayers: 2,
  },

  initialState(): GameState {
    return makeInitialState();
  },

  onCreate(_ctx: Ctx) {
    // 不需要定时器；AI 走子用 setTimer 即时
  },

  onJoin(ctx: Ctx, player: RoomPlayer) {
    const st = ctx.state;
    st.players[player.id] = { side: null, ready: false, name: player.name || '玩家' };
    if (!st.hostId) st.hostId = player.id;
  },

  onLeave(ctx: Ctx, player: RoomPlayer) {
    const st = ctx.state;
    if (st.redPlayer === player.id) { st.redPlayer = null; st.redReady = false; }
    if (st.blackPlayer === player.id) { st.blackPlayer = null; st.blackReady = false; }
    delete st.players[player.id];
    if (st.matchMode === 'online' && !st.finished) {
      if (st.phase === 'playing') {
        const winner = st.redPlayer || st.blackPlayer;
        if (winner) {
          st.finished = true;
          st.winner = winner === st.redPlayer ? 'r' : 'b';
          st.reason = 'resign';
          st.phase = 'finished';
        }
      }
    }
  },

  actions: {
    joinOnline(_ctx, _args) { /* noop */ },

    chooseSide(ctx, { player, payload }) {
      const st = ctx.state;
      const side = payload && (payload as { side?: Side }).side;
      if (side !== 'r' && side !== 'b') return;
      if (st.redPlayer === player.id) st.redPlayer = null;
      if (st.blackPlayer === player.id) st.blackPlayer = null;
      if (side === 'r' && !st.redPlayer) st.redPlayer = player.id;
      if (side === 'b' && !st.blackPlayer) st.blackPlayer = player.id;
    },

    leaveSide(ctx, { player }) {
      const st = ctx.state;
      if (st.redPlayer === player.id) { st.redPlayer = null; st.redReady = false; }
      if (st.blackPlayer === player.id) { st.blackPlayer = null; st.blackReady = false; }
    },

    setGameMode(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === 'playing' || st.phase === 'finished') return;
      const m = (payload as { gameMode?: string } | undefined)?.gameMode;
      if (m !== 'classic' && m !== 'banzhu' && m !== 'puzzle') return;
      st.gameMode = m;
      if (m === 'puzzle') {
        st.matchMode = 'ai';
        st.hostSide = 'r';
      }
    },

    setAiLevel(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      const lv = (payload as { level?: number } | undefined)?.level;
      if (typeof lv !== 'number') return;
      if (lv < 0 || lv > 3) return;
      st.aiLevel = lv as AiLevel;
    },

    setHostSide(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === 'playing' || st.phase === 'finished') return;
      const side = (payload as { side?: Side } | undefined)?.side;
      if (side !== 'r' && side !== 'b') return;
      st.hostSide = side;
    },

    setMatchMode(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === 'playing' || st.phase === 'finished') return;
      const m = (payload as { matchMode?: 'ai' | 'online' } | undefined)?.matchMode;
      if (m !== 'ai' && m !== 'online') return;
      st.matchMode = m;
    },

    setPuzzleId(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      const id = (payload as { puzzleId?: string } | undefined)?.puzzleId;
      if (typeof id !== 'string') return;
      const exists = PUZZLES.some(p => p.id === id);
      if (!exists) return;
      st.puzzleId = id;
    },

    toggleReady(ctx, { player }) {
      const st = ctx.state;
      if (st.phase === 'playing') return;
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
      const p = payload as { gameMode?: string; hostSide?: Side; puzzleId?: string } | undefined;
      if (p?.gameMode === 'classic' || p?.gameMode === 'banzhu' || p?.gameMode === 'puzzle') {
        st.gameMode = p.gameMode;
      }
      if (p?.hostSide === 'r' || p?.hostSide === 'b') {
        st.hostSide = p.hostSide;
      }
      if (p?.puzzleId) {
        st.puzzleId = p.puzzleId;
      }
      startMatch(ctx);
    },

    move(ctx, { player, payload }) {
      const p = payload as { from?: Pos; to?: Pos } | undefined;
      if (!p || !p.from || !p.to) return;
      const from: Pos = p.from;
      const to: Pos = p.to;
      if (!inBoard(from[0], from[1]) || !inBoard(to[0], to[1])) return;
      applyMove(ctx, from, to, player.id);
    },

    flip(ctx, { player, payload }) {
      const p = payload as { pos?: Pos } | undefined;
      if (!p || !p.pos) return;
      const pos: Pos = p.pos;
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
      if (st.finished || st.phase !== 'playing') return;
      if (st.gameMode === 'puzzle') return;
      if (st.pendingRequest) return;

      if (st.matchMode === 'ai') {
        if (player.id !== st.hostId) return;
        if (!performUndo(st, st.hostSide)) return;
        // 人机模式悔棋后清掉 AI 计时器（如果还有的话）
        ctx.clearTimer('ai-turn');
        return;
      }

      // 在线模式：本方执子（"离手后立即可悔"，不要求本方回合）
      const isRed = st.redPlayer === player.id;
      const isBlack = st.blackPlayer === player.id;
      if (!isRed && !isBlack) return;
      const mySide: Side = isRed ? 'r' : 'b';
      if ((st.undoCount[mySide] || 0) < 1) return;

      setPendingRequest(ctx, 'undo', player.id, false);
    },

    /**
     * 认输：
     * - 人机模式：直接走 onResign 流程（发起方立即确认，弹窗纯通知）
     * - 在线模式：弹窗通知对方，由发起方点确认后认输
     */
    resign(ctx, { player }) {
      const st = ctx.state;
      if (st.finished || st.phase !== 'playing') return;
      if (st.pendingRequest) return;

      if (st.matchMode === 'ai') {
        if (player.id !== st.hostId) return;
        // AI 模式：弹窗确认（与在线模式一致）
        setPendingRequest(ctx, 'resign', player.id, true);
        return;
      }

      // 在线模式：必须是本方执子
      if (st.redPlayer !== player.id && st.blackPlayer !== player.id) return;
      setPendingRequest(ctx, 'resign', player.id, true);
    },

    /**
     * 重开：
     * - 人机模式：房主任何阶段可点，直接重开（不走弹窗）
     * - 在线模式：发起 restart 请求，finished 阶段对方同意后重开
     */
    restart(ctx, { player }) {
      const st = ctx.state;
      if (st.pendingRequest) return;

      if (st.matchMode === 'ai') {
        if (player.id !== st.hostId) return;
        // AI 模式：任何阶段房主点重开都直接重开
        startMatch(ctx);
        return;
      }

      // 在线模式：finished 阶段任一方都可发起（不需要房主）
      if (st.phase !== 'finished') return;
      if (st.redPlayer !== player.id && st.blackPlayer !== player.id) return;
      setPendingRequest(ctx, 'restart', player.id, false);
    },

    /**
     * 重开（对局进行中任一方可发起；用于在线模式任一方想重新开局）
     */
    rematch(ctx, { player }) {
      const st = ctx.state;
      if (st.phase !== 'playing' || st.finished) return;
      if (st.pendingRequest) return;

      if (st.matchMode === 'ai') {
        if (player.id !== st.hostId) return;
        startMatch(ctx);
        return;
      }

      // 在线模式：必须本方执子
      if (st.redPlayer !== player.id && st.blackPlayer !== player.id) return;
      setPendingRequest(ctx, 'rematch', player.id, false);
    },

    /**
     * 返回选择（房主）：统一走弹窗协议（AI / 在线都一样）
     */
    backToMenu(ctx, { player }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.pendingRequest) return;
      // 走弹窗（noResponse = 纯通知，由发起方自己确认）
      setPendingRequest(ctx, 'backToMenu', player.id, true);
    },

    /**
     * 回应弹窗请求（同意/拒绝）
     */
    respondRequest(ctx, { player, payload }) {
      const st = ctx.state;
      if (!st.pendingRequest) return;
      const req = st.pendingRequest;
      const accept = !!(payload && (payload as { accept?: boolean }).accept);

      // 纯通知类（resign / backToMenu）：只有发起方本人能确认
      if (req.noResponse) {
        if (player.id !== req.from) return;
      } else {
        // 请求-回应类（undo / restart / rematch）：只能非发起方回应
        if (player.id === req.from) return;
        // 且必须本方执子
        if (st.redPlayer !== player.id && st.blackPlayer !== player.id) {
          // 房主不在场上时跳过
          if (st.matchMode === 'online' && player.id !== st.hostId) return;
        }
      }

      clearPending(ctx);
      const now = ctx.now();
      st.lastRequestResult = {
        type: req.type,
        accept,
        from: req.from,
        by: player.id,
        ts: now,
      };

      if (!accept) {
        ctx.broadcast('requestRejected', { type: req.type });
        return;
      }

      // 同意：根据类型执行
      if (req.type === 'restart' || req.type === 'rematch') {
        startMatch(ctx);
        ctx.broadcast('restarted', {});
      } else if (req.type === 'resign') {
        const loserSide: Side = st.redPlayer === req.from
          ? 'r'
          : st.blackPlayer === req.from
            ? 'b'
            : st.turn;
        const winner: Side = loserSide === 'r' ? 'b' : 'r';
        st.finished = true;
        st.winner = winner;
        st.reason = 'resign';
        st.phase = 'finished';
        recordStats(st, winner, 'win');
      } else if (req.type === 'backToMenu') {
        st.phase = 'lobby';
        st.finished = false;
        st.winner = null;
        st.reason = '';
        st.history = [];
        st.movesSinceCapture = 0;
        st.banzhuFlipped = { r: 0, b: 0 };
        st.puzzleSteps = 0;
        st.board = initialBoard();
        st.banzhuReal = emptyReal();
        st.turn = 'r';
        st.lastCheck = false;
        st.undoCount = { r: 2, b: 2 };
        st.redReady = false;
        st.blackReady = false;
        ctx.setTimer('clear-backToMenu-result', 2000, () => {
          if (st.phase === 'lobby' && st.lastRequestResult && st.lastRequestResult.type === 'backToMenu') {
            st.lastRequestResult = null;
          }
        });
      } else if (req.type === 'undo') {
        // 在线模式：按 "离手后立即可悔" 规则
        //   - 当时轮到我方（对手刚下完）：撤 2 步（对手 + 我），回合仍为我方
        //   - 当时轮到对手（我刚下完）：撤 1 步，回合变为对手
        if (st.matchMode === 'online') {
          const mySide: Side = st.redPlayer === req.from
            ? 'r'
            : st.blackPlayer === req.from
              ? 'b'
              : st.turn;
          performUndo(st, mySide);
        }
      }
    },

    exitRoom(_ctx, _args) { /* host-runtime manages navigation */ },
  },
});

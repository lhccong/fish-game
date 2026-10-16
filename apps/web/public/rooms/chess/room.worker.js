// src/worker/index.ts
import { defineRoom } from "@parti/worker-sdk";
var SIZE_GOMOKU = 15;
var SIZE_GO = 19;
var EMPTY = 0;
var BLACK = 1;
var WHITE = 2;
function createBoard(size) {
  const b = [];
  for (let r = 0; r < size; r++) {
    b.push([]);
    for (let c = 0; c < size; c++) b[r].push(EMPTY);
  }
  return b;
}
function cloneBoard(b) {
  return b.map((row) => row.slice());
}
function checkGomokuWin(board, r, c, color) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let d = 0; d < 4; d++) {
    const line = [{ r, c }];
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
function getGroup(board, r, c) {
  const color = board[r][c];
  if (color === EMPTY) return null;
  const visited = /* @__PURE__ */ new Set();
  const group = [];
  let liberties = 0;
  const queue = [[r, c]];
  visited.add(r + "," + c);
  while (queue.length) {
    const [pr, pc] = queue.shift();
    group.push([pr, pc]);
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
    for (const [dr, dc] of dirs) {
      const nr = pr + dr, nc = pc + dc;
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length) continue;
      if (board[nr][nc] === EMPTY) {
        liberties++;
        continue;
      }
      if (board[nr][nc] === color && !visited.has(nr + "," + nc)) {
        visited.add(nr + "," + nc);
        queue.push([nr, nc]);
      }
    }
  }
  return { stones: group, liberties };
}
function goPlaceStone(board, r, c, color) {
  if (r < 0 || r >= board.length || c < 0 || c >= board.length) return null;
  if (board[r][c] !== EMPTY) return null;
  board[r][c] = color;
  const opponent = color === BLACK ? WHITE : BLACK;
  const captured = [];
  const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (const [dr, dc] of dirs) {
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
  const self = getGroup(board, r, c);
  if (self && self.liberties === 0) {
    board[r][c] = EMPTY;
    return null;
  }
  return { captured };
}
function goScore(board) {
  const n = board.length;
  let black = 0, white = 0;
  const visited = /* @__PURE__ */ new Set();
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (board[r][c] === BLACK) black++;
      else if (board[r][c] === WHITE) white++;
      else if (!visited.has(r + "," + c)) {
        const region = [];
        const queue = [[r, c]];
        visited.add(r + "," + c);
        const borders = /* @__PURE__ */ new Set();
        while (queue.length) {
          const [pr, pc] = queue.shift();
          region.push([pr, pc]);
          for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
            const nr = pr + dr, nc = pc + dc;
            if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
            if (board[nr][nc] === EMPTY && !visited.has(nr + "," + nc)) {
              visited.add(nr + "," + nc);
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
var index_default = defineRoom({
  meta: {
    name: "\u4E94\u5B50\u68CB\u4E0E\u56F4\u68CB",
    minPlayers: 2,
    maxPlayers: 2
  },
  initialState() {
    return {
      // 游戏配置
      gameType: "gomoku",
      boardSize: SIZE_GOMOKU,
      // 棋盘
      board: createBoard(SIZE_GOMOKU),
      turn: BLACK,
      finished: false,
      winner: 0,
      // 围棋专用
      passes: 0,
      capturedB: 0,
      capturedW: 0,
      // 阶段（顶层状态机）
      phase: "lobby",
      confirmDeadBy: { black: false, white: false },
      // 辅助
      lastMove: null,
      winLine: null,
      winReason: "",
      // 在线联机角色
      blackPlayer: null,
      whitePlayer: null,
      blackReady: false,
      whiteReady: false,
      hostId: null,
      // AI 模式标识
      mode: "online",
      aiLevel: 1,
      hostSide: "black",
      // 玩家花名册
      players: {},
      // 会话内统计
      stats: {
        blackWins: 0,
        blackLosses: 0,
        blackDraws: 0,
        whiteWins: 0,
        whiteLosses: 0,
        whiteDraws: 0
      },
      // 待确认请求
      pendingRequest: null,
      // 最近一次被回应的请求结果
      lastRequestResult: null,
      // 主动退出标记
      activeExit: {},
      // 落子历史
      moves: [],
      // 在线模式悔棋：每方独立计数
      undoCount: { black: 2, white: 2 },
      // 超时配置
      requestTimeoutMs: 15e3,
      gameTimeoutMs: 15 * 6e4,
      lastActivityAt: 0,
      gameStartedAt: 0
    };
  },
  /* ---------- 定时器：请求超时 + 对局超时 + 重连宽限期 ---------- */
  onCreate(ctx) {
    ctx.setTimer("chess-timeouts", 1e3, () => tickTimeouts(ctx));
  },
  /* ---------- 玩家加入 ---------- */
  onJoin(ctx, player) {
    const st = ctx.state;
    st.players[player.id] = { name: player.name || "\u73A9\u5BB6" };
    if (!st.hostId) st.hostId = player.id;
    ctx.broadcast("roles", {
      blackPlayer: st.blackPlayer,
      whitePlayer: st.whitePlayer,
      hostId: st.hostId
    });
  },
  /* ---------- 玩家离开 ---------- */
  onLeave(ctx, player) {
    const st = ctx.state;
    const activeFlag = st.activeExit[player.id];
    const isBackToMenu = activeFlag === "backToMenu";
    const isActiveExit = !!activeFlag && !isBackToMenu;
    delete st.activeExit[player.id];
    if (st.blackPlayer === player.id) {
      st.blackPlayer = null;
      st.blackReady = false;
    }
    if (st.whitePlayer === player.id) {
      st.whitePlayer = null;
      st.whiteReady = false;
    }
    delete st.players[player.id];
    if (!st.finished && !isBackToMenu && (st.phase === "playing" || st.phase === "end_confirm")) {
      const loser = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
      if (loser) {
        const winner = loser === BLACK ? WHITE : BLACK;
        finishGame(ctx, winner, isActiveExit ? "\u5BF9\u65B9\u4E3B\u52A8\u9000\u51FA" : "\u5BF9\u65B9\u79BB\u5F00");
      }
    }
    if ((!st.blackPlayer || !st.whitePlayer) && st.phase !== "finished") {
      st.phase = "lobby";
    }
  },
  /* ---------- 动作处理 ---------- */
  actions: {
    /**
     * 玩家加入在线对局：幂等兜底。
     */
    joinOnline(_ctx, { player: _player }) {
    },
    /**
     * 玩家选择执子方。
     */
    chooseSide(ctx, { player, payload }) {
      const st = ctx.state;
      const side = payload && payload.side;
      if (side !== "black" && side !== "white") return;
      if (st.blackPlayer === player.id) st.blackPlayer = null;
      if (st.whitePlayer === player.id) st.whitePlayer = null;
      if (side === "black") {
        if (!st.blackPlayer) st.blackPlayer = player.id;
      } else {
        if (!st.whitePlayer) st.whitePlayer = player.id;
      }
      ctx.broadcast("roles", {
        blackPlayer: st.blackPlayer,
        whitePlayer: st.whitePlayer,
        hostId: st.hostId
      });
    },
    /**
     * 玩家离开自己执子方。
     */
    leaveSide(ctx, { player }) {
      const st = ctx.state;
      const wasBlack = st.blackPlayer === player.id;
      const wasWhite = st.whitePlayer === player.id;
      if (wasBlack) st.blackPlayer = null;
      if (wasWhite) st.whitePlayer = null;
      if (wasBlack) st.blackReady = false;
      if (wasWhite) st.whiteReady = false;
      if (wasBlack || wasWhite) {
        ctx.broadcast("roles", {
          blackPlayer: st.blackPlayer,
          whitePlayer: st.whitePlayer,
          hostId: st.hostId
        });
      }
    },
    /**
     * 房主切换棋种。
     */
    setGameType(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === "playing" || st.phase === "end_confirm" || st.phase === "finished") return;
      const gt = payload && payload.gameType === "go" ? "go" : "gomoku";
      st.gameType = gt;
      st.boardSize = gt === "go" ? SIZE_GO : SIZE_GOMOKU;
      ctx.broadcast("gameTypeChanged", { gameType: gt });
    },
    /**
     * 房主设置 AI 难度等级。
     */
    setAiLevel(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      const level = parseInt(payload && payload.level);
      if (isNaN(level) || level < 0 || level > 3) return;
      st.aiLevel = level;
      ctx.broadcast("aiLevelChanged", { level });
    },
    /**
     * 房主切换执子方（仅 AI 模式 lobby 阶段有效）。
     */
    setHostSide(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase !== "lobby") return;
      const side = payload && payload.side;
      if (side !== "black" && side !== "white") return;
      st.hostSide = side;
      ctx.broadcast("hostSideChanged", { hostSide: side });
    },
    /**
     * 房主切换对战模式（人机/在线）。
     */
    setMode(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (st.phase === "playing" || st.phase === "end_confirm" || st.phase === "finished") return;
      const m = payload && payload.mode === "ai" ? "ai" : "online";
      st.mode = m;
      if (payload && payload.gameType) {
        const gt = payload.gameType === "go" ? "go" : "gomoku";
        st.gameType = gt;
        st.boardSize = gt === "go" ? SIZE_GO : SIZE_GOMOKU;
      }
      if (payload && payload.aiLevel !== void 0) {
        st.aiLevel = parseInt(payload.aiLevel);
      }
      ctx.broadcast("modeChanged", { mode: m, gameType: st.gameType, aiLevel: st.aiLevel });
    },
    /**
     * 玩家切换准备状态。
     */
    toggleReady(ctx, { player }) {
      const st = ctx.state;
      if (st.phase === "playing" || st.phase === "end_confirm") return;
      if (player.id === st.blackPlayer) st.blackReady = !st.blackReady;
      else if (player.id === st.whitePlayer) st.whiteReady = !st.whiteReady;
      if (!st.blackReady || !st.whiteReady) st.phase = "lobby";
    },
    /**
     * 房主（黑方）开始对局。
     */
    startGameOnline(ctx, { player }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      if (!st.blackReady || !st.whiteReady) return;
      if (!st.blackPlayer || !st.whitePlayer) return;
      startMatch(ctx);
    },
    /**
     * 房主开始AI对局。
     */
    startAI(ctx, { player, payload }) {
      const st = ctx.state;
      if (player.id !== st.hostId) return;
      const gt = payload && payload.gameType === "go" ? "go" : "gomoku";
      st.gameType = gt;
      st.boardSize = gt === "go" ? SIZE_GO : SIZE_GOMOKU;
      startMatch(ctx, BLACK);
      ctx.broadcast("gameStarted", { gameType: gt, boardSize: st.boardSize, mode: "ai", hostSide: st.hostSide });
    },
    /**
     * 落子（五子棋和围棋共用）。
     */
    place(ctx, { player, payload }) {
      const st = ctx.state;
      if (st.finished) return;
      if (st.phase !== "playing") return;
      if (!payload || typeof payload.r !== "number" || typeof payload.c !== "number") return;
      const r = Math.floor(payload.r), c = Math.floor(payload.c);
      if (r < 0 || r >= st.boardSize || c < 0 || c >= st.boardSize) return;
      if (st.mode === "ai") {
        if (player.id !== st.hostId) return;
        if (st.board[r][c] !== EMPTY) return;
        const moveColor = payload.color === WHITE ? WHITE : BLACK;
        if (moveColor !== st.turn) return;
        if (st.gameType === "gomoku") {
          st.board[r][c] = moveColor;
          st.moves.push({ r, c, color: moveColor });
          st.lastMove = { r, c };
          st.turn = moveColor === BLACK ? WHITE : BLACK;
        } else {
          const testBoard = cloneBoard(st.board);
          const res = goPlaceStone(testBoard, r, c, moveColor);
          if (!res) return;
          st.board = testBoard;
          st.moves.push({ r, c, color: moveColor, captured: res.captured });
          st.lastMove = { r, c };
          if (moveColor === BLACK) st.capturedB += res.captured.length;
          else st.capturedW += res.captured.length;
          st.passes = 0;
          st.turn = moveColor === BLACK ? WHITE : BLACK;
        }
        bumpActivity(ctx);
        return;
      }
      if (st.board[r][c] !== EMPTY) return;
      const myColor = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
      if (!myColor || myColor !== st.turn) return;
      st.moves.push({ r, c, color: st.turn });
      if (st.gameType === "gomoku") {
        st.board[r][c] = st.turn;
        st.lastMove = { r, c };
        const winLine = checkGomokuWin(st.board, r, c, st.turn);
        if (winLine) {
          st.winLine = winLine;
          st.winReason = "\u4E94\u5B50\u8FDE\u73E0";
          finishGame(ctx, st.turn, "\u4E94\u5B50\u8FDE\u73E0");
          return;
        }
        let full = true;
        for (let rr = 0; rr < st.boardSize; rr++) {
          for (let cc = 0; cc < st.boardSize; cc++) {
            if (st.board[rr][cc] === EMPTY) {
              full = false;
              break;
            }
          }
          if (!full) break;
        }
        if (full) {
          finishGame(ctx, 0, "\u68CB\u76D8\u5DF2\u6EE1");
          return;
        }
        st.turn = st.turn === BLACK ? WHITE : BLACK;
      } else {
        const testBoard = cloneBoard(st.board);
        const res = goPlaceStone(testBoard, r, c, st.turn);
        if (!res) return;
        st.board = testBoard;
        st.lastMove = { r, c };
        if (st.turn === BLACK) st.capturedB += res.captured.length;
        else st.capturedW += res.captured.length;
        st.passes = 0;
        st.turn = st.turn === BLACK ? WHITE : BLACK;
      }
      bumpActivity(ctx);
    },
    /**
     * Pass（仅围棋）。
     */
    pass(ctx, { player }) {
      const st = ctx.state;
      if (st.gameType !== "go" || st.finished) return;
      if (st.phase !== "playing") return;
      const myColor = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
      if (!myColor || myColor !== st.turn) return;
      st.passes++;
      st.turn = st.turn === BLACK ? WHITE : BLACK;
      st.lastMove = null;
      if (st.passes >= 2) {
        enterEndConfirm(ctx);
      } else {
        ctx.broadcast("pass", { player: player.id });
      }
      bumpActivity(ctx);
    },
    /**
     * 继续对局。
     */
    continueGame(ctx, { player }) {
      const st = ctx.state;
      if (st.gameType !== "go") return;
      if (st.phase !== "end_confirm") return;
      const myColor = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
      if (!myColor) return;
      st.phase = "playing";
      st.confirmDeadBy = { black: false, white: false };
      ctx.broadcast("gameResumed", { by: player.id });
      bumpActivity(ctx);
    },
    /**
     * 确认死棋。
     */
    confirmDead(ctx, { player }) {
      const st = ctx.state;
      if (st.gameType !== "go") return;
      if (st.phase !== "end_confirm") return;
      const myColor = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
      if (!myColor) return;
      if (myColor === BLACK) st.confirmDeadBy.black = true;
      else st.confirmDeadBy.white = true;
      ctx.broadcast("deadConfirmProgress", {
        black: st.confirmDeadBy.black,
        white: st.confirmDeadBy.white
      });
      if (st.confirmDeadBy.black && st.confirmDeadBy.white) {
        const score = goScore(st.board);
        const blackTotal = score.black + st.capturedB;
        const whiteTotal = score.white + st.capturedW;
        const winner = blackTotal > whiteTotal ? BLACK : whiteTotal > blackTotal ? WHITE : 0;
        finishGame(ctx, winner, `\u9ED1 ${blackTotal} \u76EE \xB7 \u767D ${whiteTotal} \u76EE`);
      }
      bumpActivity(ctx);
    },
    /**
     * 悔棋。
     */
    undo(ctx, { player }) {
      const st = ctx.state;
      if (st.finished) return;
      if (st.phase !== "playing") return;
      if (st.mode === "ai") {
        const steps = st.moves.length;
        if (steps === 0) return;
        const last = st.moves.pop();
        st.board[last.r][last.c] = EMPTY;
        if (steps >= 2) {
          const prev = st.moves.pop();
          st.board[prev.r][prev.c] = EMPTY;
        }
        st.lastMove = st.moves.length ? st.moves[st.moves.length - 1] : null;
        st.turn = BLACK;
        st.undoCount = st.undoCount || { black: 2, white: 2 };
        st.undoCount.black = Math.max(0, (st.undoCount.black || 0) - 1);
        if (st.gameType === "go") {
          st.capturedB = 0;
          st.capturedW = 0;
        }
        bumpActivity(ctx);
        return;
      }
      const myColor = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
      if (!myColor) return;
      if (myColor === st.turn) return;
      if (st.moves.length === 0) return;
      const remain = st.undoCount && st.undoCount[myColor === BLACK ? "black" : "white"] || 0;
      if (remain <= 0) return;
      if (st.pendingRequest) return;
      st.pendingRequest = { type: "undo", from: player.id, createdAt: ctx.now() };
      ctx.broadcast("requestPending", { type: "undo", from: player.id });
      ctx.setTimer("request-timeout", st.requestTimeoutMs, () => autoRejectRequest(ctx, "undo"));
    },
    /**
     * AI 模式下玩家落子后，客户端通知游戏结束。
     */
    aiGameOver(ctx, { player, payload }) {
      const st = ctx.state;
      if (st.mode !== "ai") return;
      if (player.id !== st.hostId) return;
      const winner = payload && payload.winner;
      const reason = payload && payload.reason;
      if (winner !== void 0 && winner !== null) {
        finishGame(ctx, winner, reason);
      } else {
        ctx.broadcast("gameResumed", { by: player.id });
      }
    },
    /**
     * 投降：纯通知协议。
     */
    resign(ctx, { player }) {
      const st = ctx.state;
      if (st.finished) return;
      if (st.phase !== "playing" && st.phase !== "end_confirm") return;
      if (st.pendingRequest) return;
      const myColor = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
      if (!myColor) return;
      st.pendingRequest = { type: "resign", from: player.id, noResponse: true, createdAt: ctx.now() };
      ctx.broadcast("requestPending", { type: "resign", from: player.id, noResponse: true });
      ctx.setTimer("request-timeout", st.requestTimeoutMs, () => autoRejectRequest(ctx, "resign"));
    },
    /**
     * 重开：AI 模式直接执行；在线模式发起请求。
     */
    restart(ctx, { player }) {
      const st = ctx.state;
      if (st.mode === "ai") {
        startMatch(ctx);
        ctx.broadcast("gameStarted", { gameType: st.gameType, boardSize: st.boardSize, mode: "ai", hostSide: st.hostSide });
        return;
      }
      if (st.phase !== "finished") return;
      if (st.pendingRequest) return;
      st.pendingRequest = { type: "restart", from: player.id, createdAt: ctx.now() };
      ctx.broadcast("requestPending", { type: "restart", from: player.id });
      ctx.setTimer("request-timeout", st.requestTimeoutMs, () => autoRejectRequest(ctx, "restart"));
    },
    /**
     * 重开：对局进行中任一方可发起。
     */
    rematch(ctx, { player }) {
      const st = ctx.state;
      if (st.phase !== "playing" || st.finished) return;
      if (st.pendingRequest) return;
      if (st.mode === "ai") {
        startMatch(ctx);
        ctx.broadcast("gameStarted", { gameType: st.gameType, boardSize: st.boardSize, mode: "ai", hostSide: st.hostSide });
        return;
      }
      if (player.id !== st.hostId && player.id !== st.whitePlayer) return;
      st.pendingRequest = { type: "rematch", from: player.id, createdAt: ctx.now() };
      ctx.broadcast("requestPending", { type: "rematch", from: player.id });
      ctx.setTimer("request-timeout", st.requestTimeoutMs, () => autoRejectRequest(ctx, "rematch"));
    },
    /**
     * 返回选择（房主）。
     */
    backToMenu(ctx, { player }) {
      const st = ctx.state;
      if (st.mode !== "online" && st.mode !== "ai") return;
      if (player.id !== st.hostId) return;
      if (st.pendingRequest) return;
      st.pendingRequest = { type: "backToMenu", from: player.id, noResponse: true, createdAt: ctx.now() };
      ctx.broadcast("requestPending", { type: "backToMenu", from: player.id, noResponse: true });
      ctx.setTimer("request-timeout", st.requestTimeoutMs, () => autoRejectRequest(ctx, "backToMenu"));
    },
    /**
     * 玩家主动退出房间。
     */
    exitRoom(ctx, { player }) {
      const st = ctx.state;
      if (!st.activeExit) st.activeExit = {};
      st.activeExit[player.id] = true;
      if (st.blackPlayer === player.id) {
        st.blackPlayer = null;
        st.blackReady = false;
      }
      if (st.whitePlayer === player.id) {
        st.whitePlayer = null;
        st.whiteReady = false;
      }
      ctx.broadcast("peerExited", { id: player.id });
    },
    /**
     * 对方同意或拒绝请求。
     */
    respondRequest(ctx, { player, payload }) {
      const st = ctx.state;
      if (!st.pendingRequest) return;
      const req = st.pendingRequest;
      if (req.noResponse) {
        if (player.id !== req.from) return;
      } else {
        const myColor = player.id === st.blackPlayer ? BLACK : player.id === st.whitePlayer ? WHITE : 0;
        if (!myColor) return;
        if (player.id === req.from) return;
      }
      ctx.clearTimer("request-timeout");
      st.pendingRequest = null;
      st.lastRequestResult = {
        type: req.type,
        accept: !!(payload && payload.accept),
        from: req.from,
        by: player.id,
        ts: ctx.now()
      };
      if (!payload || !payload.accept) {
        if (!req.noResponse) ctx.broadcast("requestRejected", { type: req.type, by: player.id });
        return;
      }
      if (req.type === "restart") {
        startMatch(ctx);
        ctx.broadcast("restarted", {});
      } else if (req.type === "rematch") {
        startMatch(ctx);
        ctx.broadcast("restarted", {});
      } else if (req.type === "resign") {
        const loserColor = req.from === st.blackPlayer ? BLACK : req.from === st.whitePlayer ? WHITE : 0;
        const winner = loserColor === BLACK ? WHITE : BLACK;
        finishGame(ctx, winner, "\u5BF9\u65B9\u6295\u964D");
      } else if (req.type === "backToMenu") {
        if (!st.activeExit) st.activeExit = {};
        st.activeExit[req.from] = "backToMenu";
        st.phase = "lobby";
        st.finished = false;
        st.winner = 0;
        st.board = createBoard(st.boardSize || (st.gameType === "go" ? SIZE_GO : SIZE_GOMOKU));
        st.boardSize = st.boardSize || (st.gameType === "go" ? SIZE_GO : SIZE_GOMOKU);
        st.turn = BLACK;
        st.moves = [];
        st.lastMove = null;
        st.winLine = null;
        st.winReason = "";
        st.passes = 0;
        st.capturedB = 0;
        st.capturedW = 0;
        st.undoCount = { black: 2, white: 2 };
        st.confirmDeadBy = { black: false, white: false };
        st.pendingRequest = null;
        ctx.setTimer("clear-lobby-result", 2e3, () => {
          if (st.phase === "lobby" && st.lastRequestResult && st.lastRequestResult.type === "backToMenu") {
            st.lastRequestResult = null;
          }
        });
      } else if (req.type === "undo") {
        st.undoCount = st.undoCount || { black: 2, white: 2 };
        const requesterColor = req.from === st.blackPlayer ? BLACK : req.from === st.whitePlayer ? WHITE : 0;
        if (requesterColor === BLACK) st.undoCount.black = Math.max(0, (st.undoCount.black || 0) - 1);
        else if (requesterColor === WHITE) st.undoCount.white = Math.max(0, (st.undoCount.white || 0) - 1);
        if (st.moves.length > 0) {
          const last = st.moves.pop();
          st.board[last.r][last.c] = EMPTY;
        }
        if (st.moves.length > 0) {
          const prev = st.moves.pop();
          st.board[prev.r][prev.c] = EMPTY;
        }
        st.lastMove = null;
        st.turn = requesterColor;
        if (st.gameType === "go") {
          st.capturedB = 0;
          st.capturedW = 0;
        }
        bumpActivity(ctx);
      }
    }
  }
});
function enterEndConfirm(ctx) {
  const st = ctx.state;
  st.phase = "end_confirm";
  st.finished = false;
  st.confirmDeadBy = { black: false, white: false };
  ctx.broadcast("deadNegotiation", {});
}
function startMatch(ctx, _firstTurn) {
  const st = ctx.state;
  const size = st.boardSize || (st.gameType === "go" ? SIZE_GO : SIZE_GOMOKU);
  st.boardSize = size;
  st.board = createBoard(size);
  st.turn = BLACK;
  st.finished = false;
  st.winner = 0;
  st.passes = 0;
  st.capturedB = 0;
  st.capturedW = 0;
  st.lastMove = null;
  st.winLine = null;
  st.winReason = "";
  st.phase = "playing";
  st.confirmDeadBy = { black: false, white: false };
  st.moves = [];
  st.undoCount = { black: 2, white: 2 };
  st.pendingRequest = null;
  st.lastRequestResult = null;
  const now = ctx.now();
  st.gameStartedAt = now;
  st.lastActivityAt = now;
}
function bumpActivity(ctx) {
  ctx.state.lastActivityAt = ctx.now();
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
    expired: true,
    ts: ctx.now()
  };
  ctx.broadcast("requestExpired", { type: expectType });
}
function tickTimeouts(ctx) {
  const st = ctx.state;
  const now = ctx.now();
  if ((st.phase === "playing" || st.phase === "end_confirm") && st.gameStartedAt > 0) {
    if (now - st.lastActivityAt > st.gameTimeoutMs) {
      const loser = st.turn;
      const winner = loser === BLACK ? WHITE : BLACK;
      finishGame(ctx, winner, "\u5BF9\u5C40\u8D85\u65F6");
    }
  }
}
function finishGame(ctx, winner, reason) {
  const st = ctx.state;
  if (st.finished) return;
  st.finished = true;
  st.winner = winner;
  st.winReason = reason || "";
  st.phase = "finished";
  if (winner === BLACK) {
    st.stats.blackWins++;
    st.stats.whiteLosses++;
  } else if (winner === WHITE) {
    st.stats.whiteWins++;
    st.stats.blackLosses++;
  } else {
    st.stats.blackDraws++;
    st.stats.whiteDraws++;
  }
  ctx.broadcast("game:over", { winner, reason });
}
export default index_default;

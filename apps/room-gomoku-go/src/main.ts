// 五子棋与围棋 UI（parti 客户端）
// 原实现见 apps/web/public/rooms/gomoku-go/index.html；
// 这里把 inline 脚本抽出为 ES module，便于通过 Vite 打包。
/* eslint-disable */
// @ts-nocheck — 原实现是 ES5 风格的脚本，包含 var 重复声明、隐式全局与可选链混用，
// 这里仅做位置迁移，行为不做修改。

import './styles.css';

(function () {
  "use strict";

  var SIZE_GOMOKU = 15, SIZE_GO = 19;
  var EMPTY = 0, BLACK = 1, WHITE = 2;

  var gameType = 'gomoku';
  var mode = 'online';
  var aiLevel = 1;
  var myRole = 0;        // 1=Black, 2=White, 0=未知
  var myReady = false;
  var isHost = false;     // 是否是房主
  var onlineJoined = false;
  var hostId = null;      // 房主 playerId（来自 worker state）
  var hostSide = 'black'; // AI 模式：房主选择的执子方 'black'|'white'
  var myAiSide = 'black'; // AI 模式：本地房主执子方（'black' 或 'white'），与 hostSide 同义但便于本地访问

  var state: any = {
    boardSize: 15,
    board: null,
    turn: BLACK,
    finished: false,
    winner: 0,
    moves: [],
    undoCount: { black: 2, white: 2 },
    capturedB: 0, capturedW: 0,
    passes: 0,
    lastMove: null,
    winLine: null,
    phase: 'idle',       // 'idle' | 'lobby' | 'playing' | 'end_confirm' | 'finished'
    confirmDeadBy: { black: false, white: false },
    // 在线联机状态（onState 同步）
    players: {},
    blackPlayer: null,
    whitePlayer: null,
    blackReady: false,
    whiteReady: false,
    stats: {
      blackWins: 0, blackLosses: 0, blackDraws: 0,
      whiteWins: 0, whiteLosses: 0, whiteDraws: 0
    }
  };

  var canvas: any, ctx: any, cellSize: any, padding: any, cssSize: any;
  var subscription: any = null;
  var shownRequestResults: any = {}; // ts -> true，已显示过的请求结果去重用
  var noRespShownKey: any = null; // 纯通知（noResponse）弹窗 1 秒自动关去重用
  var noRespHideTimer: any = null; // 纯通知 1 秒关弹窗计时句柄
  var countdownKey: any = null; // 倒计时启动的去重 key（用 pendingRequest.createdAt）
  // 每次实时检查 parti 是否已注入（脚本加载时 parti 尚未注入，所以不能写 var）
  function hasParti() { return !!(parti && typeof parti.onState === 'function'); }

  function partiAction(name: string, payload?: any) {
    if (hasParti()) return parti.action(name, payload);
    return Promise.resolve({ ok: true });
  }
  function partiLog() {
    if (hasParti() && parti.log) parti.log.apply(parti, arguments as any);
  }

  /* ==================================================================
         元素引用
      ================================================================== */
  var $ = function (id: string) { return document.getElementById(id); };
  var modePanel: any = $('modePanel');
  var boardWrap: any = $('boardWrap');
  var turnIndicator: any = $('turnIndicator');
  var winBanner: any = $('winBanner');
  var winText: any = $('winText');
  var winSub: any = $('winSub');
  var requestBanner: any = $('requestBanner');
  var requestText: any = $('requestText');
  var requestTimer: any = $('requestTimer');
  var requestTimerNum: any = $('requestTimerNum');
  var reqAcceptBtn: any = $('reqAccept');
  var reqRejectBtn: any = $('reqReject');

  // 请求超时倒计时（worker 端 15 秒后自动拒绝）
  var REQUEST_TIMEOUT_SEC = 15;
  var countdownInterval: any = null;
  function startCountdown(secs: number) {
    stopCountdown();
    requestTimerNum.textContent = secs;
    requestTimer.style.display = '';
    countdownInterval = setInterval(function () {
      secs--;
      if (secs <= 0) {
        stopCountdown();
        return;
      }
      requestTimerNum.textContent = secs;
    }, 1000);
  }
  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    requestTimer.style.display = 'none';
  }

  var toastEl: any = $('toast');
  var toastTimer: any = null;
  function showToast(msg: string) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () {
      toastEl.classList.remove('show');
    }, 2000);
  }
  var sideTitle: any = $('sideTitle');
  var ruleTip: any = $('ruleTip');
  var undoMax = 2;

  var slotBlack: any = $('slotBlack');
  var slotWhite: any = $('slotWhite');
  var undoBlackEl: any = $('undoBlack');
  var undoWhiteEl: any = $('undoWhite');
  var playerBlackEl: any = $('playerBlack');
  var playerWhiteEl: any = $('playerWhite');
  var statusBlackEl: any = $('statusBlack');
  var statusWhiteEl: any = $('statusWhite');

  var statBlackEl: any = $('statBlack');
  var statWhiteEl: any = $('statWhite');

  var btnUndo: any = $('btnUndo');
  var btnContinue: any = $('btnContinue');
  var btnConfirmDead: any = $('btnConfirmDead');
  var btnRematch: any = $('btnRematch');
  var btnReplay: any = $('btnReplay');
  var btnResign: any = $('btnResign');
  var btnBack: any = $('btnBack');

  var gameGroup: any = $('gameGroup');
  var modeGroup: any = $('modeGroup');
  var aiLevelGroup: any = $('aiLevelGroup');
  var sideGroup: any = $('sideGroup');
  var onlineLobby: any = $('onlineLobby');
  var onlineSlotBlack: any = $('onlineSlotBlack');
  var onlineSlotWhite: any = $('onlineSlotWhite');
  var onlineNameBlack: any = $('onlineNameBlack');
  var onlineNameWhite: any = $('onlineNameWhite');
  var onlineFlagBlack: any = $('onlineFlagBlack');
  var onlineFlagWhite: any = $('onlineFlagWhite');
  var onlineReadyBtn: any = $('onlineReadyBtn');
  var startBtn: any = $('startBtn');

  // 默认隐藏开始按钮（在线模式不需要显示）
  startBtn.style.display = 'none';

  /* ==================================================================
         音效
      ================================================================== */
  var audioCtx: any = null;
  function ensureAudio() {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)(); } catch (e) { } }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function playClick() {
    ensureAudio(); if (!audioCtx) return;
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(900, audioCtx.currentTime);
    o.frequency.exponentialRampToValueAtTime(400, audioCtx.currentTime + 0.06);
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + 0.08);
  }
  function playWin() {
    ensureAudio(); if (!audioCtx) return;
    [523, 659, 784, 1047].forEach(function (f, i) {
      var o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime + i * 0.1);
      g.gain.linearRampToValueAtTime(0.1, audioCtx.currentTime + i * 0.1 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + i * 0.1 + 0.3);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(audioCtx.currentTime + i * 0.1);
      o.stop(audioCtx.currentTime + i * 0.1 + 0.3);
    });
  }

  /* ==================================================================
         棋盘逻辑
      ================================================================== */
  function createBoard(size: number) {
    var b: number[][] = []; for (var r = 0; r < size; r++) { b.push([]); for (var c = 0; c < size; c++) b[r].push(EMPTY); }
    return b;
  }
  function cloneBoard(b: number[][]) { return b.map(function (r) { return r.slice(); }); }

  function checkGomokuWin(board: number[][], r: number, c: number, color: number) {
    var dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
    for (var d = 0; d < 4; d++) {
      var line: any[] = [{ r: r, c: c }];
      for (var s = 1; s <= 4; s++) { var nr = r + dirs[d][0] * s, nc = c + dirs[d][1] * s; if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length || board[nr][nc] !== color) break; line.push({ r: nr, c: nc }); }
      for (var s = -1; s >= -4; s--) { var nr = r + dirs[d][0] * s, nc = c + dirs[d][1] * s; if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length || board[nr][nc] !== color) break; line.push({ r: nr, c: nc }); }
      if (line.length >= 5) { line.sort(function (a, b) { return a.r - b.r || a.c - b.c; }); return line; }
    }
    return null;
  }

  function getGroup(board: number[][], r: number, c: number) {
    var color = board[r][c]; if (color === EMPTY) return null;
    var visited: any = {}, libs: any = {}, group: any[] = [], queue: any[] = [[r, c]];
    visited[r + ',' + c] = true;
    while (queue.length) {
      var p = queue.shift(); group.push(p);
      for (var d = 0; d < 4; d++) {
        var nr = p[0] + [0, 1, 0, -1][d], nc = p[1] + [1, 0, -1, 0][d];
        if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length) continue;
        if (board[nr][nc] === EMPTY) libs[nr + ',' + nc] = true;
        else if (board[nr][nc] === color && !visited[nr + ',' + nc]) { visited[nr + ',' + nc] = true; queue.push([nr, nc]); }
      }
    }
    return { stones: group, liberties: Object.keys(libs).length };
  }

  function goPlaceStone(board: number[][], r: number, c: number, color: number) {
    if (r < 0 || r >= board.length || c < 0 || c >= board.length || board[r][c] !== EMPTY) return null;
    board[r][c] = color;
    var opponent = color === BLACK ? WHITE : BLACK;
    var captured: any[] = [];
    for (var d = 0; d < 4; d++) {
      var nr = r + [0, 1, 0, -1][d], nc = c + [1, 0, -1, 0][d];
      if (nr < 0 || nr >= board.length || nc < 0 || nc >= board.length) continue;
      if (board[nr][nc] === opponent) {
        var g = getGroup(board, nr, nc);
        if (g && g.liberties === 0) {
          g.stones.forEach(function (s: any) { board[s[0]][s[1]] = EMPTY; captured.push({ r: s[0], c: s[1] }); });
        }
      }
    }
    var self = getGroup(board, r, c);
    if (self && self.liberties === 0) { board[r][c] = EMPTY; return null; }
    return { captured: captured };
  }

  function goScore(board: number[][]) {
    var n = board.length, black = 0, white = 0, visited: any = {};
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) {
      if (board[r][c] === BLACK) black++;
      else if (board[r][c] === WHITE) white++;
      else if (!visited[r + ',' + c]) {
        var region: any[] = [], queue: any[] = [[r, c]], borders: any = {};
        visited[r + ',' + c] = true;
        while (queue.length) {
          var p = queue.shift(); region.push(p);
          for (var d = 0; d < 4; d++) {
            var nr = p[0] + [0, 1, 0, -1][d], nc = p[1] + [1, 0, -1, 0][d];
            if (nr < 0 || nr >= n || nc < 0 || nc >= n) continue;
            if (board[nr][nc] === EMPTY && !visited[nr + ',' + nc]) { visited[nr + ',' + nc] = true; queue.push([nr, nc]); }
            else if (board[nr][nc] !== EMPTY) borders[board[nr][nc]] = true;
          }
        }
        if (borders[BLACK] && !borders[WHITE]) black += region.length;
        else if (borders[WHITE] && !borders[BLACK]) white += region.length;
      }
    }
    return { black: black, white: white };
  }

  /* ==================================================================
         渲染
      ================================================================== */
  function computeLayout() {
    var wrapW = boardWrap.clientWidth - 32;
    var wrapH = boardWrap.clientHeight - 32;
    var n = state.boardSize;
    var maxBoard = Math.min(wrapW, wrapH, 600);
    cssSize = Math.floor(maxBoard / n) * n + (Math.floor(maxBoard / n));
    cellSize = Math.max(Math.floor((maxBoard - 2) / (n + 1)), 12);
    padding = cellSize;
    cssSize = cellSize * (n - 1) + padding * 2;
    var dpr = window.devicePixelRatio || 1;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    canvas.style.width = cssSize + 'px';
    canvas.style.height = cssSize + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function render() {
    if (!ctx) return;
    var n = state.boardSize, pad = padding, cs = cellSize;
    var w = cssSize;

    var grad = ctx.createLinearGradient(0, 0, w, w);
    grad.addColorStop(0, '#e8c88a'); grad.addColorStop(0.5, '#deb87a'); grad.addColorStop(1, '#d4a86a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, w);

    ctx.strokeStyle = '#5a4a30';
    ctx.lineWidth = n > 15 ? 0.8 : 1;
    for (var i = 0; i < n; i++) {
      var pos = pad + i * cs;
      ctx.beginPath(); ctx.moveTo(pad, pos); ctx.lineTo(w - pad, pos); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pos, pad); ctx.lineTo(pos, w - pad); ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.strokeRect(pad, pad, w - 2 * pad, w - 2 * pad);

    var starPoints;
    if (n === 15) starPoints = [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]];
    else starPoints = [[3, 3], [3, 9], [3, 15], [9, 3], [9, 9], [9, 15], [15, 3], [15, 9], [15, 15]];
    ctx.fillStyle = '#4a3f30';
    starPoints.forEach(function (sp: any) {
      if (sp[0] < n && sp[1] < n) {
        ctx.beginPath();
        ctx.arc(pad + sp[0] * cs, pad + sp[1] * cs, Math.max(2.5, cs * 0.12), 0, Math.PI * 2);
        ctx.fill();
      }
    });

    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!state.board || state.board[r][c] === EMPTY) continue;
        var x = pad + c * cs, y = pad + r * cs, rad = cs * 0.44;
        var isBlack = state.board[r][c] === BLACK;
        var g = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad);
        if (isBlack) { g.addColorStop(0, '#666'); g.addColorStop(0.5, '#222'); g.addColorStop(1, '#000'); }
        else { g.addColorStop(0, '#fff'); g.addColorStop(0.6, '#eee'); g.addColorStop(1, '#ccc'); }
        ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
        ctx.strokeStyle = isBlack ? '#000' : '#bbb'; ctx.lineWidth = 0.6; ctx.stroke();
      }
    }

    if (state.lastMove) {
      var lx = pad + state.lastMove.c * cs, ly = pad + state.lastMove.r * cs;
      ctx.beginPath(); ctx.arc(lx, ly, cs * 0.12, 0, Math.PI * 2);
      ctx.fillStyle = '#e74c3c'; ctx.fill();
    }

    if (state.winLine) {
      ctx.strokeStyle = 'rgba(231,76,60,0.7)';
      ctx.lineWidth = Math.max(3, cs * 0.15);
      ctx.lineCap = 'round';
      var first = state.winLine[0], last = state.winLine[state.winLine.length - 1];
      ctx.beginPath();
      ctx.moveTo(pad + first.c * cs, pad + first.r * cs);
      ctx.lineTo(pad + last.c * cs, pad + last.r * cs);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,0,0.4)';
      ctx.lineWidth = Math.max(6, cs * 0.3);
      ctx.stroke();
    }

    updateUI();
  }

  /* ==================================================================
         UI 更新
      ================================================================== */
  function updateUI() {
    var turnNames: any = { 1: '黑方', 2: '白方' };

    if (state.finished) {
      turnIndicator.textContent = '已结束';
      turnIndicator.classList.remove('hide');
    } else if (state.phase === 'playing') {
      turnIndicator.classList.remove('hide');
      if (mode === 'ai' && state.turn === WHITE) turnIndicator.textContent = 'AI 思考中…';
      else if (mode === 'online' && state.turn !== myRole && myRole) turnIndicator.textContent = '等待对方…';
      else turnIndicator.textContent = turnNames[state.turn] + '落子';
    } else {
      turnIndicator.classList.add('hide');
    }

    if (state.finished) {
      winBanner.classList.add('show');
      winText.textContent = state.winner === BLACK ? '黑方胜' : state.winner === WHITE ? '白方胜' : '平局';
      winSub.textContent = state.winReason || '';
    } else {
      winBanner.classList.remove('show');
      winText.textContent = '';
      winSub.textContent = '';
    }

    var s = state.stats;
    statBlackEl.textContent = s.blackWins + ' 胜 ' + s.blackLosses + ' 负 ' + s.blackDraws + ' 平';
    statWhiteEl.textContent = s.whiteWins + ' 胜 ' + s.whiteLosses + ' 负 ' + s.whiteDraws + ' 平';

    // ---- 按钮启停（按对局阶段） ----
    var isGomoku = gameType === 'gomoku';
    var isGo = gameType === 'go';
    var playingNow = state.phase === 'playing';
    var endConfirmNow = state.phase === 'end_confirm';
    var finishedNow = state.finished || state.phase === 'finished';
    var localRole = myRole;

    // 悔棋次数：每方独立（用于 canUndo 判断）
    var undoKey = mode === 'ai' ? myAiSide : (localRole === BLACK ? 'black' : (localRole === WHITE ? 'white' : 'black'));
    var myUndoRemain = (state.undoCount && state.undoCount[undoKey]) || 0;

    // 悔棋：playing 阶段
    //   在线模式：轮到我方前可申请，需对方同意
    //   AI 模式：仅房主（黑方）可点，撤销两步（AI + 玩家）
    //   观战者：不可见
    var canUndo = playingNow && state.moves && state.moves.length > 0 && myUndoRemain > 0 &&
      (mode === 'ai' ? isHost : (mode === 'online' ? localRole : true));
    var showUndo = playingNow && ((mode === 'ai' && isHost) || (mode === 'online' && localRole) || (mode === 'local'));
    btnUndo.style.display = showUndo ? '' : 'none';
    btnUndo.disabled = !canUndo;

    // 悔棋次数：显示在玩家槽上方（双方都可见）
    //   AI 模式：黑/白都显示（黑=玩家, 白=AI）
    //   在线模式：双方都显示各自的剩余
    //   本地模式：双方都显示
    var showUndoCount = playingNow && (mode === 'local' || mode === 'ai' || (mode === 'online' && localRole));
    var blackUndoRemain = (state.undoCount && state.undoCount.black) || 0;
    var whiteUndoRemain = (state.undoCount && state.undoCount.white) || 0;
    if (undoBlackEl) {
      undoBlackEl.style.display = showUndoCount ? '' : 'none';
      if (showUndoCount) {
        undoBlackEl.innerHTML = '悔棋剩余：<span class="undo-num">' + blackUndoRemain + '</span>/' + undoMax;
        undoBlackEl.classList.toggle('exhausted', blackUndoRemain === 0);
      }
    }
    if (undoWhiteEl) {
      undoWhiteEl.style.display = showUndoCount ? '' : 'none';
      if (showUndoCount) {
        undoWhiteEl.innerHTML = '悔棋剩余：<span class="undo-num">' + whiteUndoRemain + '</span>/' + undoMax;
        undoWhiteEl.classList.toggle('exhausted', whiteUndoRemain === 0);
      }
    }

    // 认输：AI 模式房主可见；在线模式执子方可见
    var hasResignRight = mode === 'ai' ? isHost : !!localRole;
    var canResign = hasResignRight && (playingNow || endConfirmNow) && !finishedNow;
    btnResign.style.display = canResign ? '' : 'none';
    btnResign.disabled = !canResign;

    // 继续对局 / 确认死棋：仅围棋 end_confirm 阶段可见
    btnContinue.style.display = endConfirmNow ? '' : 'none';
    btnConfirmDead.style.display = endConfirmNow ? '' : 'none';
    if (endConfirmNow) {
      var cd = state.confirmDeadBy || {};
      btnConfirmDead.textContent =
        (cd.black && cd.white) ? '双方已确认' :
          (localRole === BLACK ? (cd.black ? '已确认，等待对方' : '确认死棋') :
            localRole === WHITE ? (cd.white ? '已确认，等待对方' : '确认死棋') :
              '确认死棋');
      btnConfirmDead.disabled = !localRole || !!cd[localRole === BLACK ? 'black' : 'white'];
    }

    // 再来一局按钮已合并到 btnRematch

    // 重开（btnRematch）：仅对局进行中（playing）可见
    // - AI 模式：房主在 playing 阶段可见
    // - 在线模式：双方在 playing 阶段可见
    var rematchShow;
    if (mode === 'ai') {
      rematchShow = isHost && state.phase === 'playing' && !state.finished;
    } else {
      rematchShow = mode === 'online' && state.phase === 'playing' && !state.finished && (myRole === BLACK || myRole === WHITE);
    }
    btnRematch.style.display = rematchShow ? '' : 'none';
    btnRematch.disabled = !rematchShow;

    // 再来一局（btnReplay）：仅对局结束后（finished）可见
    // - AI 模式：房主在 finished 阶段可见
    // - 在线模式：双方在 finished 阶段可见
    var replayShow;
    if (mode === 'ai') {
      replayShow = isHost && state.phase === 'finished';
    } else {
      replayShow = mode === 'online' && state.phase === 'finished' && (myRole === BLACK || myRole === WHITE);
    }
    btnReplay.style.display = replayShow ? '' : 'none';
    btnReplay.disabled = !replayShow;

    // 返回选择（btnBack）：房主任何阶段都可见
    // - AI 模式：房主
    // - 在线模式：房主
    var backShow = isHost;
    btnBack.style.display = backShow ? '' : 'none';
    btnBack.disabled = !backShow;
  }

  /* ==================================================================
         玩家槽填充（在线面板与侧边栏共用）
      ================================================================== */
  function fillSlot(slotEl: any, nameEl: any, statusEl: any, playerId: any, isMe: any, side: string) {
    var readyKey = side === 'black' ? 'blackReady' : 'whiteReady';
    var ready = state[readyKey];
    var roleSymbol = side === 'black' ? '●' : '○';
    if (playerId) {
      var name = (state.players && state.players[playerId] && state.players[playerId].name) || '玩家';
      nameEl.innerHTML = roleSymbol + ' ' + (side === 'black' ? '黑方' : '白方') + ' <span class="name-text">' + name + '</span>';
      nameEl.className = 'slot-name';
      if (isMe) {
        slotEl.classList.add('me');
      } else {
        slotEl.classList.remove('me');
      }
      slotEl.classList.remove('empty');
      if (ready) {
        statusEl.textContent = '已准备 ✓';
        statusEl.className = 'slot-status ok';
        slotEl.classList.add('ready');
      } else {
        statusEl.textContent = '等待准备…';
        statusEl.className = 'slot-status waiting';
        slotEl.classList.remove('ready');
      }
    } else {
      nameEl.innerHTML = roleSymbol + ' ' + (side === 'black' ? '黑方' : '白方') + ' <span class="name-text">等待加入…</span>';
      nameEl.className = 'slot-name empty';
      statusEl.textContent = '';
      statusEl.className = 'slot-status waiting';
      slotEl.classList.add('empty');
      slotEl.classList.remove('me', 'ready');
    }
  }

  /* ==================================================================
         在线模式：更新面板内玩家槽（与侧边栏共用样式）
      ================================================================== */
  function updateOnlineLobby(s: any) {
    if (!s) return;

    // 同步本地 state（fillSlot 依赖 state 字段）
    state.players = s.players || state.players;
    state.blackReady = !!s.blackReady;
    state.whiteReady = !!s.whiteReady;
    if ('hostId' in s) hostId = s.hostId;
    if (s.hostSide === 'black' || s.hostSide === 'white') {
      hostSide = s.hostSide;
      myAiSide = s.hostSide;
    }

    // 房主判定：以 hostId 为准（与执子方解耦）
    var localIsHost = !!(hostId && parti.playerId && hostId === parti.playerId);

    // 面板上的两个角色卡：直接复用侧边栏的 fillSlot，结构/样式完全一致
    var blackIsMe = parti.playerId && parti.playerId === s.blackPlayer;
    var whiteIsMe = parti.playerId && parti.playerId === s.whitePlayer;
    fillSlot(onlineSlotBlack, onlineNameBlack, onlineFlagBlack, s.blackPlayer, blackIsMe, 'black');
    fillSlot(onlineSlotWhite, onlineNameWhite, onlineFlagWhite, s.whitePlayer, whiteIsMe, 'white');

    var bothJoined = !!s.blackPlayer && !!s.whitePlayer;
    var bothReady = s.blackReady && s.whiteReady;

    // 准备按钮：只要自己已分配角色（房主或玩家）就可以点准备
    var myReadyKey = myRole === BLACK ? 'blackReady' : (myRole === WHITE ? 'whiteReady' : null);
    var iAmReady = myReadyKey && state[myReadyKey];
    onlineReadyBtn.classList.remove('cancel');
    onlineReadyBtn.textContent = iAmReady ? '取消准备' : '准备';
    if (iAmReady) onlineReadyBtn.classList.add('cancel');
    onlineReadyBtn.disabled = !myReadyKey;

    // 开始按钮：在线非房主隐藏，人机模式/房主显示
    if (mode === 'online' && !localIsHost) {
      startBtn.style.display = 'none';
    } else {
      startBtn.style.display = '';
      if (mode === 'online' && localIsHost && bothReady) {
        startBtn.classList.add('green');
        startBtn.disabled = false;
      } else {
        startBtn.classList.remove('green');
        startBtn.disabled = false;
      }
    }

    // 非房主：禁用棋种选择、对战模式、AI 难度（只能看不能改）
    var gameTypeBtns = document.querySelectorAll('#gameGroup .opt-btn');
    var aiLevelBtns = document.querySelectorAll('#aiLevelGroup .opt-btn');
    var modeBtns = document.querySelectorAll('#modeGroup .opt-btn');
    if (!localIsHost && s.blackPlayer) {
      gameTypeBtns.forEach(function (btn: any) { btn.disabled = true; });
      aiLevelBtns.forEach(function (btn: any) { btn.disabled = true; });
      modeBtns.forEach(function (btn: any) { btn.disabled = true; });
    } else {
      gameTypeBtns.forEach(function (btn: any) { btn.disabled = false; });
      aiLevelBtns.forEach(function (btn: any) { btn.disabled = false; });
      modeBtns.forEach(function (btn: any) { btn.disabled = false; });
    }
    // sideGroup 高亮同步（AI 模式/在线模式都更新）
    updateSideActive();
  }

  /* ==================================================================
         侧边栏玩家槽同步更新
      ================================================================== */
  function updateSidebarSlots(s: any) {
    if (!s) return;

    // 同步本地 state（fillSlot 依赖 state 字段）
    state.players = s.players || state.players;
    state.blackReady = !!s.blackReady;
    state.whiteReady = !!s.whiteReady;

    var blackIsMe = parti.playerId && parti.playerId === s.blackPlayer;
    var whiteIsMe = parti.playerId && parti.playerId === s.whitePlayer;
    myRole = blackIsMe ? BLACK : (whiteIsMe ? WHITE : 0);

    if (s.mode === 'ai') {
      // AI 模式：房主执某方（由 hostSide 决定，AI 执另一边）
      // 兼容旧状态（无 hostSide / 无 hostId）：用 blackPlayer 判定
      var hostIsBlack;
      if (s.hostSide === 'black' || s.hostSide === 'white') {
        hostIsBlack = s.hostSide === 'black';
      } else if (s.hostId) {
        hostIsBlack = s.hostId === s.blackPlayer;
      } else {
        hostIsBlack = blackIsMe;
      }
      myAiSide = hostIsBlack ? 'black' : 'white'; // 本地缓存执子方
      if (hostIsBlack) {
        // 房主执黑：黑槽=房主，白槽=AI
        fillSlot(slotBlack, playerBlackEl, statusBlackEl, s.hostId || s.blackPlayer, true, 'black');
        // 白方显示 AI
        playerWhiteEl.innerHTML = '○ 白方 <span class="name-text">AI</span>';
        slotWhite.className = 'player-slot ai';
        slotWhite.classList.remove('empty', 'me', 'ready');
        statusWhiteEl.textContent = '执白';
        statusWhiteEl.className = 'slot-status ai';
      } else {
        // 房主执白：黑槽=AI，白槽=房主
        playerBlackEl.innerHTML = '● 黑方 <span class="name-text">AI</span>';
        slotBlack.className = 'player-slot ai';
        slotBlack.classList.remove('empty', 'me', 'ready');
        statusBlackEl.textContent = '执黑';
        statusBlackEl.className = 'slot-status ai';
        fillSlot(slotWhite, playerWhiteEl, statusWhiteEl, s.hostId || s.whitePlayer, true, 'white');
      }
    } else {
      fillSlot(slotBlack, playerBlackEl, statusBlackEl, s.blackPlayer, blackIsMe, 'black');
      fillSlot(slotWhite, playerWhiteEl, statusWhiteEl, s.whitePlayer, whiteIsMe, 'white');
    }
  }

  /* ==================================================================
         人机模式
      ================================================================== */
  function startAI() {
    // 房主执方决定谁是黑/白，AI 执另一边
    // 五子棋/围棋均为黑先白后：与执子方无关
    var hostIsBlack = myAiSide === 'black';
    myRole = hostIsBlack ? BLACK : WHITE;
    isHost = true; // AI 模式：点击"开始"的人就是房主
    onlineJoined = false;
    state.boardSize = gameType === 'go' ? SIZE_GO : SIZE_GOMOKU;
    state.board = createBoard(state.boardSize);
    // 五子棋/围棋均为黑先白后；若玩家执白则 AI(黑) 先走
    state.turn = (myAiSide === 'white') ? 2 /*WHITE*/ : 1 /*BLACK*/;
    state.finished = false;
    state.winner = 0;
    state.moves = [];
    state.undoCount = { black: 2, white: 2 };
    state.capturedB = 0; state.capturedW = 0;
    state.passes = 0;
    state.lastMove = null;
    state.winLine = null;
    state.phase = 'playing';
    state.winReason = '';

    // 侧边栏
    if (hostIsBlack) {
      playerBlackEl.innerHTML = '● 黑方 <span class="name-text">你</span>';
      playerBlackEl.className = 'slot-name';
      slotBlack.classList.remove('empty');
      slotBlack.classList.add('me');
      statusBlackEl.textContent = '执黑';
      statusBlackEl.className = 'slot-status ok';
      slotBlack.classList.remove('ready');

      playerWhiteEl.innerHTML = '○ 白方 <span class="name-text">AI</span>';
      playerWhiteEl.className = 'slot-name';
      slotWhite.classList.remove('empty');
      slotWhite.classList.remove('me', 'ready');
      statusWhiteEl.textContent = '执白';
      statusWhiteEl.className = 'slot-status ai';
    } else {
      // 房主执白：房主显示在白方槽，AI 执黑
      playerBlackEl.innerHTML = '● 黑方 <span class="name-text">AI</span>';
      playerBlackEl.className = 'slot-name';
      slotBlack.classList.remove('empty');
      slotBlack.classList.remove('me', 'ready');
      statusBlackEl.textContent = '执黑';
      statusBlackEl.className = 'slot-status ai';

      playerWhiteEl.innerHTML = '○ 白方 <span class="name-text">你</span>';
      playerWhiteEl.className = 'slot-name';
      slotWhite.classList.remove('empty');
      slotWhite.classList.add('me');
      statusWhiteEl.textContent = '执白';
      statusWhiteEl.className = 'slot-status ok';
      slotWhite.classList.remove('ready');
    }

    // 面板隐藏
    modePanel.classList.add('hide');

    computeLayout();
    render();

    // AI 走子（含执白时 AI 先手）全部由 worker 的 ai-turn 定时器驱动，客户端不计算
  }

  // 本地重开（无 parti 时使用）：仅重置棋盘/对局状态，保留 mode / gameType / aiLevel
  function localRematch() {
    state.boardSize = gameType === 'go' ? SIZE_GO : SIZE_GOMOKU;
    state.board = createBoard(state.boardSize);
    // 执白时 AI(黑) 先走
    state.turn = (myAiSide === 'white') ? WHITE : BLACK;
    state.finished = false;
    state.winner = 0;
    state.moves = [];
    state.undoCount = { black: 2, white: 2 };
    state.capturedB = 0; state.capturedW = 0;
    state.passes = 0;
    state.lastMove = null;
    state.winLine = null;
    state.phase = 'playing';
    state.winReason = '';
    myReady = false;
    isHost = true; // AI 模式房主即玩家
    winText.textContent = '';
    winSub.textContent = '';
    if (winBanner) winBanner.classList.remove('show');
    render();
  }

  /* ==================================================================
         在线模式：加入并监听状态
      ================================================================== */
  function joinOnline() {
    if (subscription) { subscription(); subscription = null; }

    onlineJoined = true;
    myRole = 0;
    myReady = false;

    state.phase = 'lobby';
    state.boardSize = gameType === 'gomoku' ? SIZE_GOMOKU : SIZE_GO;
    state.board = createBoard(state.boardSize);

    // 重置侧边栏槽
    playerBlackEl.innerHTML = '● 黑方 <span class="name-text">等待加入…</span>';
    playerBlackEl.className = 'slot-name empty';
    slotBlack.classList.add('empty');
    slotBlack.classList.remove('me', 'ready');
    statusBlackEl.textContent = '';
    statusBlackEl.className = 'slot-status waiting';

    playerWhiteEl.innerHTML = '○ 白方 <span class="name-text">等待加入…</span>';
    playerWhiteEl.className = 'slot-name empty';
    slotWhite.classList.add('empty');
    slotWhite.classList.remove('me', 'ready');
    statusWhiteEl.textContent = '';
    statusWhiteEl.className = 'slot-status waiting';

    if (hasParti()) {
      initOnlineSession();
    } else {
      // 本地预览模拟
      myRole = BLACK;
      playerBlackEl.innerHTML = '● 黑方 <span class="name-text">你</span>';
      playerBlackEl.className = 'slot-name';
      slotBlack.classList.remove('empty');
      slotBlack.classList.add('me');
      statusBlackEl.textContent = '等待对手';
      statusBlackEl.className = 'slot-status waiting';
      render();
    }
  }

  function initOnlineSession() {
    if (subscription) { subscription(); subscription = null; }
    if (!hasParti()) return;
    if (parti.ready) parti.ready();

    var tempState: any = {
      players: {},
      blackPlayer: null,
      whitePlayer: null,
      blackReady: false,
      whiteReady: false
    };
    updateSidebarSlots(tempState);

    subscription = parti.onState(function (s: any) {
      if (!s) return;
      state.stats = s.stats || state.stats;
      state.players = s.players || state.players;
      state.blackReady = !!s.blackReady;
      state.whiteReady = !!s.whiteReady;
      // 同步玩家槽位（用于按钮/UI 判断双方是否就位）
      if ('blackPlayer' in s) state.blackPlayer = s.blackPlayer;
      if ('whitePlayer' in s) state.whitePlayer = s.whitePlayer;
      if ('hostId' in s) hostId = s.hostId;
      var blackIsMe = parti.playerId && parti.playerId === s.blackPlayer;
      var whiteIsMe = parti.playerId && parti.playerId === s.whitePlayer;
      myRole = blackIsMe ? BLACK : (whiteIsMe ? WHITE : 0);
      // AI 模式：玩家本身就是房主，不需要依赖 hostId 判定
      // 在线模式：用 hostId 判定是否是房主
      isHost = (s.mode === 'ai') || !!(hostId && parti.playerId === hostId);
      // 返回选择按钮：仅在 updateUI 中根据 phase/isHost 控制
      if (s.mode !== undefined && s.mode !== mode) {
        mode = s.mode;
        modeGroup.querySelectorAll('.opt-btn').forEach(function (b: any) {
          b.classList.toggle('active', b.dataset.mode === mode);
        });
        aiLevelGroup.classList.toggle('show', mode === 'ai');
        onlineLobby.classList.toggle('hide', mode === 'ai');
        sideGroup.classList.toggle('show', mode === 'ai');
        if (mode === 'ai') {
          startBtn.style.display = '';
          startBtn.disabled = false;
        } else {
          startBtn.style.display = 'none';
        }
      }
      // 同步棋种（所有客户端）
      if (s.gameType !== undefined && s.gameType !== gameType) {
        gameType = s.gameType;
        gameGroup.querySelectorAll('.opt-btn').forEach(function (b: any) {
          b.classList.toggle('active', b.dataset.game === gameType);
        });
      }
      // 同步 AI 难度（所有客户端）
      if (s.aiLevel !== undefined && s.aiLevel !== aiLevel) {
        aiLevel = s.aiLevel;
        aiLevelGroup.querySelectorAll('.opt-btn').forEach(function (b: any) {
          b.classList.toggle('active', parseInt(b.dataset.level) === aiLevel);
        });
      }
      // AI 模式：worker 端也维护棋盘（用于给观战者同步），客户端用 onState 同步
      // 棋盘以 worker 的 onState 为准（房主、观战者数据一致）
      if (mode === 'ai') {
        if ((s.phase === 'playing' || s.phase === 'end_confirm') && state.phase !== 'playing' && state.phase !== 'end_confirm') {
          state.phase = s.phase;
          state.boardSize = s.boardSize || state.boardSize;
          state.board = (s.board || []).map(function (r: any) {
            return Array.isArray(r) ? r.slice() : (r && typeof r.length === 'number' ? Array.from(r) : []);
          });
          if (!state.board || !state.board.length) state.board = createBoard(state.boardSize);
          state.turn = s.turn;
          state.moves = s.moves ? s.moves.slice() : [];
          state.lastMove = s.lastMove || null;
          state.capturedB = s.capturedB || 0;
          state.capturedW = s.capturedW || 0;
          state.passes = s.passes || 0;
          state.undoCount = s.undoCount || { black: 2, white: 2 };
          state.confirmDeadBy = s.confirmDeadBy || { black: false, white: false };
          // 新对局（首次进入 / 再来一局 / 重开）：必须清掉上一局的结算状态，
          // 否则 state.finished 仍为 true，AI 不会落子且结算横幅不会隐藏
          state.finished = !!s.finished;
          state.winner = s.winner || 0;
          state.winLine = s.winLine || null;
          state.winReason = s.winReason || '';
          if (!state.finished) {
            winText.textContent = '';
            winSub.textContent = '';
            winBanner.classList.remove('show');
          }
          computeLayout();
          modePanel.classList.add('hide');
        } else if (s.phase === 'playing' || s.phase === 'end_confirm') {
          state.phase = s.phase;
          // 严格深拷贝 board（来自 worker）
          state.board = (s.board || []).map(function (r: any) {
            return Array.isArray(r) ? r.slice() : (r && typeof r.length === 'number' ? Array.from(r) : []);
          });
          state.turn = s.turn;
          state.moves = s.moves ? s.moves.slice() : [];
          state.lastMove = s.lastMove || null;
          state.capturedB = s.capturedB || 0;
          state.capturedW = s.capturedW || 0;
          state.passes = s.passes || 0;
          state.undoCount = s.undoCount || { black: 2, white: 2 };
          state.confirmDeadBy = s.confirmDeadBy || { black: false, white: false };
          // 与 PVP 分支保持一致：始终同步结算状态，避免上一局的 finished/winner 残留
          state.finished = !!s.finished;
          state.winner = s.winner || 0;
          state.winLine = s.winLine || null;
          state.winReason = s.winReason || '';
          if (!state.finished) {
            winText.textContent = '';
            winSub.textContent = '';
            winBanner.classList.remove('show');
          }
        } else if (s.phase === 'finished') {
          state.phase = 'finished';
          state.finished = true;
          state.winner = s.winner;
          state.winReason = s.winReason || '';
          state.winLine = s.winLine || null;
          state.board = (s.board || []).map(function (r: any) {
            return Array.isArray(r) ? r.slice() : (r && typeof r.length === 'number' ? Array.from(r) : []);
          });
        } else if (state.phase === 'playing' || state.phase === 'end_confirm' || state.phase === 'finished') {
          // 退出对局（lobby 等阶段）→ 显示模式选择面板
          state.finished = false;
          state.winner = 0;
          state.moves = [];
          state.lastMove = null;
          state.winLine = null;
          state.winReason = '';
          state.board = createBoard(gameType === 'go' ? SIZE_GO : SIZE_GOMOKU);
          state.boardSize = gameType === 'go' ? SIZE_GO : SIZE_GOMOKU;
          modePanel.classList.remove('hide');
        }
        state.phase = s.phase || state.phase;
      } else if (s.phase === 'playing' || s.phase === 'end_confirm') {
        if (state.phase !== 'playing' && state.phase !== 'end_confirm') {
          state.phase = s.phase;
          state.boardSize = s.boardSize || state.boardSize;
          state.board = createBoard(state.boardSize);
          computeLayout();
          modePanel.classList.add('hide');
        }
        // 严格深拷贝 board，避免行不是数组时直接修改污染服务端状态
        state.board = (s.board || []).map(function (r: any) {
          return Array.isArray(r) ? r.slice() : (r && typeof r.length === 'number' ? Array.from(r) : []);
        });
        state.turn = s.turn;
        state.finished = !!s.finished;
        state.winner = s.winner;
        state.passes = s.passes || 0;
        state.capturedB = s.capturedB || 0;
        state.capturedW = s.capturedW || 0;
        state.lastMove = s.lastMove || null;
        state.winLine = s.winLine || null;
        state.winReason = s.winReason || '';
        state.moves = s.moves ? s.moves.slice() : [];
        state.undoCount = s.undoCount || { black: 2, white: 2 };
        state.confirmDeadBy = s.confirmDeadBy || { black: false, white: false };
        state.phase = s.phase;
      } else if (s.phase === 'finished') {
        state.phase = 'finished';
        state.finished = true;
        state.winner = s.winner;
        state.winReason = s.winReason || '';
        state.winLine = s.winLine || null;
        state.board = (s.board || []).map(function (r: any) {
          return Array.isArray(r) ? r.slice() : (r && typeof r.length === 'number' ? Array.from(r) : []);
        });
      } else {
        // 退出对局（lobby 等阶段）→ 显示模式选择面板
        if (state.phase === 'playing' || state.phase === 'end_confirm' || state.phase === 'finished') {
          state.finished = false;
          state.winner = 0;
          state.moves = [];
          state.lastMove = null;
          state.winLine = null;
          state.winReason = '';
          state.board = createBoard(gameType === 'go' ? SIZE_GO : SIZE_GOMOKU);
          state.boardSize = gameType === 'go' ? SIZE_GO : SIZE_GOMOKU;
          // backToMenu 引起的 lobby：房主立即显示 modePanel；玩家延迟 1 秒（让 banner 文案先展示完）
          var isBackToMenuLobby = s.lastRequestResult && s.lastRequestResult.type === 'backToMenu' && s.lastRequestResult.accept;
          var isHostLobby = isBackToMenuLobby && parti && parti.playerId && s.lastRequestResult.from === parti.playerId;
          if (isHostLobby) {
            modePanel.classList.remove('hide');
          } else {
            var delay = isBackToMenuLobby ? 1000 : 0;
            setTimeout(function () { modePanel.classList.remove('hide'); }, delay);
          }
        }
        state.phase = s.phase || 'lobby';
      }
      updateOnlineLobby(s);
      updateSidebarSlots(s);

      // AI 走子（含先手）由 worker 的 ai-turn 定时器驱动，客户端不调度。

      // 同步对方请求弹窗
      if (s.pendingRequest) {
        var typeMap2: any = { undo: '悔棋', restart: '再来一局', rematch: '重开', resign: '认输', backToMenu: '返回选择' };
        var reqAckEl: any = document.querySelector('.req-ack');
        var action = typeMap2[s.pendingRequest.type] || '操作';
        if (s.pendingRequest.noResponse) {
          // 纯通知协议（resign / backToMenu）：
          // - 发起方：弹"已发送【X】请求，等待你确认" + 同意/拒绝按钮 + 倒计时
          // - 对方：弹"对方想要X"，1 秒自动关（无按钮，无倒计时）
          if (s.pendingRequest.from === parti.playerId) {
            requestText.textContent = '已发送【' + action + '】请求，等待你确认';
            var reqBtnsNR: any = document.querySelector('.req-btns');
            if (reqBtnsNR) reqBtnsNR.style.display = '';
            if (reqAckEl) reqAckEl.style.display = 'none';
            requestBanner.classList.add('show');
            // 启动倒计时（pendingRequest 推送时 createdAt 是新值，避免重复启动）
            if (s.pendingRequest.createdAt !== countdownKey) {
              countdownKey = s.pendingRequest.createdAt;
              startCountdown(REQUEST_TIMEOUT_SEC);
            }
          } else {
            // 对方视角：显示等待倒计时（与发起方同步，不自动消失，直到超时或发起方取消）
            requestText.textContent = '对方想要' + action;
            var reqBtnsNR2: any = document.querySelector('.req-btns');
            if (reqBtnsNR2) reqBtnsNR2.style.display = 'none';
            if (reqAckEl) reqAckEl.style.display = 'none';
            requestBanner.classList.add('show');
            // 对方也需要看到倒计时（createdAt 与发起方相同，用同一 countdownKey 避免重复启动）
            if (s.pendingRequest.createdAt !== countdownKey) {
              countdownKey = s.pendingRequest.createdAt;
              startCountdown(REQUEST_TIMEOUT_SEC);
            }
          }
        } else {
          // 请求-回应协议（undo / restart / rematch）
          if (s.pendingRequest.from === parti.playerId) {
            // 申请方：等待对方确认（隐藏同意/拒绝）+ 倒计时
            requestText.textContent = '已发送【' + action + '】请求，等待对方确认…';
            var reqBtns2: any = document.querySelector('.req-btns');
            if (reqBtns2) reqBtns2.style.display = 'none';
            if (reqAckEl) reqAckEl.style.display = 'none';
            requestBanner.classList.add('show');
            if (s.pendingRequest.createdAt !== countdownKey) {
              countdownKey = s.pendingRequest.createdAt;
              startCountdown(REQUEST_TIMEOUT_SEC);
            }
          } else {
            // 对方：可以同意/拒绝 + 倒计时
            requestText.textContent = '对方请求【' + action + '】，是否同意？';
            var reqBtns3: any = document.querySelector('.req-btns');
            if (reqBtns3) reqBtns3.style.display = '';
            if (reqAckEl) reqAckEl.style.display = 'none';
            requestBanner.classList.add('show');
            if (s.pendingRequest.createdAt !== countdownKey) {
              countdownKey = s.pendingRequest.createdAt;
              startCountdown(REQUEST_TIMEOUT_SEC);
            }
          }
        }
      } else if (s.lastRequestResult) {
        // 请求结果弹窗（用 ts 去重）
        stopCountdown();
        if (!shownRequestResults) shownRequestResults = {};
        var rKey = s.lastRequestResult.ts;
        // 注：这里不要 return——下面的状态同步（board / phase）必须走完 render()，否则新对局棋盘无法显示
        shownRequestResults[rKey] = true;

        var resType = s.lastRequestResult.type;
        var isMe = (parti && parti.playerId) ? (s.lastRequestResult.by === parti.playerId) : false;
        var isFromMe = (parti && parti.playerId) ? (s.lastRequestResult.from === parti.playerId) : false;
        var isExpired = !!s.lastRequestResult.expired;
        var acceptText = s.lastRequestResult.accept ? '同意' : '拒绝';
        var bannerText: any;

        if (isExpired) {
          // 超时场景：双方都看到"超时已自动取消"
          var expText;
          if (resType === 'resign') expText = '认输';
          else if (resType === 'backToMenu') expText = '返回选择';
          else if (resType === 'undo') expText = '悔棋';
          else if (resType === 'restart') expText = '再来一局';
          else if (resType === 'rematch') expText = '重开';
          else expText = '操作';
          bannerText = '【' + expText + '】超时已自动取消';
        } else if (isFromMe) {
          // 发起方视角：undo/restart/rematch（在线）由对方响应；resign/backToMenu/AI 模式由自己确认
          if (resType === 'resign') {
            bannerText = s.lastRequestResult.accept ? '你已认输' : '已取消认输';
          } else if (resType === 'backToMenu') {
            bannerText = s.lastRequestResult.accept ? '你已返回选择' : '已取消返回选择';
          } else if (mode === 'ai' && (resType === 'restart' || resType === 'rematch')) {
            // AI 模式：自己确认即可
            var aiName = typeMap2[resType] || '操作';
            bannerText = s.lastRequestResult.accept ? '你已' + aiName : '已取消' + aiName;
          } else {
            var fromMeName = typeMap2[resType] || '操作';
            bannerText = '对方已' + acceptText + '【' + fromMeName + '】';
          }
        } else {
          // 对方视角：看到发起方点了什么
          if (resType === 'resign') {
            bannerText = '对方点击了【' + acceptText + '】（认输）';
          } else if (resType === 'backToMenu') {
            bannerText = '对方点击了【' + acceptText + '】（返回选择）';
          } else if (isMe) {
            // undo/restart/rematch 的响应方（自己点过同意/拒绝）：跳过弹窗文案，直接关闭
            // （之前这里 return，导致 render() 不被调用，新对局棋盘无法同步，bug 已修复）
            requestBanner.classList.remove('show');
            stopCountdown();
            bannerText = ''; // 标记不显示
          } else {
            bannerText = '对方点击了【' + acceptText + '】';
          }
        }

        if (bannerText) {
          requestText.textContent = bannerText;
          var reqBtnsRes: any = document.querySelector('.req-btns');
          if (reqBtnsRes) reqBtnsRes.style.display = 'none';
          var reqAckRes: any = document.querySelector('.req-ack');
          if (reqAckRes) reqAckRes.style.display = 'none';
          requestBanner.classList.add('show');
          setTimeout(function () {
            requestBanner.classList.remove('show');
          }, 1000);
        } else {
          stopCountdown();
        }
      } else {
        // pendingRequest 已清且无结果：若弹窗仍在显示，1 秒后再关
        stopCountdown();
        if (requestBanner.classList.contains('show')) {
          setTimeout(function () {
            requestBanner.classList.remove('show');
          }, 1000);
        }
      }
      render();
    });
    if (parti.onMessage) {
      parti.onMessage(function (msg: any) {
        if (!msg) return;
        if (msg.type === 'requestPending') {
          // requestPending 事件兜底：对方在 onState 之前先看到弹窗（避免对局中弹窗被后续 state 推回覆盖）
          if (msg.noResponse && msg.from !== parti.playerId) {
            var typeMap3: any = { undo: '悔棋', restart: '再来一局', rematch: '重开', resign: '认输', backToMenu: '返回选择' };
            var act3 = typeMap3[msg.type] || '操作';
            requestText.textContent = '对方想要' + act3;
            var reqBtnsIM: any = document.querySelector('.req-btns');
            if (reqBtnsIM) reqBtnsIM.style.display = 'none';
            var reqAckIM: any = document.querySelector('.req-ack');
            if (reqAckIM) reqAckIM.style.display = 'none';
            requestBanner.classList.add('show');
            // 不在这里启动倒计时：onState 推回时由 pendingRequest.createdAt 统一驱动，避免本地时间与 worker 端 createdAt 错位
          }
        } else if (msg.type === 'requestCleared' || msg.type === 'requestRejected') {
          // 文字切换已由 onState 的 lastRequestResult 处理
        } else if (msg.type === 'peerExited') {
          // 对方离开（主动退出或掉线均触发），提示由 onState 的 finished 状态驱动
          // 这里只给一个轻提示，不干扰主流程
        } else if (msg.type === 'hostSideChanged') {
          // 房主切换了执子方，观战者跟随更新
          myAiSide = msg.hostSide;
          hostSide = msg.hostSide;
          updateSideActive();
          // 侧边栏的 AI/房主分配由 updateSidebarSlots 在 onState 时更新，无需额外操作
        } else if (msg.type === 'gameStarted') {
          // 游戏开始/重开（来自 worker 的 restart/rematch/startAI）
          // 与在线模式的 restarted 保持一致：本地立即重建棋盘并重置全部对局状态，
          // 不再依赖随后到达的 onState 来清棋盘/清结算（否则旧棋盘与 finished 会残留）
          state.phase = 'playing';
          state.boardSize = msg.boardSize || state.boardSize || (gameType === 'go' ? SIZE_GO : SIZE_GOMOKU);
          state.board = createBoard(state.boardSize);
          // 五子棋/围棋固定黑先白后（与 hostSide 无关）
          state.turn = 1 /*BLACK*/;
          state.finished = false;
          state.winner = 0;
          state.moves = [];
          state.undoCount = { black: 2, white: 2 };
          state.capturedB = 0;
          state.capturedW = 0;
          state.passes = 0;
          state.lastMove = null;
          state.winLine = null;
          state.winReason = '';
          state.confirmDeadBy = { black: false, white: false };
          // 若广播中带了 hostSide，观战者同步执子方
          if (msg.hostSide) {
            myAiSide = msg.hostSide;
            hostSide = msg.hostSide;
          }
          // 隐藏胜利横幅（必须在 render() 之前）
          winText.textContent = '';
          winSub.textContent = '';
          if (winBanner) winBanner.classList.remove('show');
          modePanel.classList.add('hide');
          computeLayout();
          render();
        } else if (msg.type === 'game:over') {
          // 游戏结束（来自 worker 的 finishGame）
          if (!state.finished) {
            state.finished = true;
            state.winner = msg.winner;
            state.winReason = msg.reason || '';
            state.phase = 'finished';
            winText.textContent = msg.winner === 1 ? '黑方胜' : msg.winner === 2 ? '白方胜' : '平局';
            winSub.textContent = msg.reason || '';
            winBanner.classList.add('show');
            render();
          }
        } else if (msg.type === 'restarted') {
          // 在线模式重开成功（来自 worker 的 respondRequest -> restart）
          // 重置本地所有状态，隐藏胜利提示
          state.phase = 'playing';
          state.boardSize = state.boardSize || (gameType === 'go' ? 19 : 15);
          state.board = createBoard(state.boardSize);
          state.turn = 1 /*BLACK*/;
          state.finished = false;
          state.winner = 0;
          state.moves = [];
          state.undoCount = { black: 2, white: 2 };
          state.capturedB = 0;
          state.capturedW = 0;
          state.passes = 0;
          state.lastMove = null;
          state.winLine = null;
          state.winReason = '';
          state.confirmDeadBy = { black: false, white: false };
          // 隐藏胜利横幅（必须在 render() 之前）
          winText.textContent = '';
          winSub.textContent = '';
          if (winBanner) winBanner.classList.remove('show');
          modePanel.classList.add('hide');
          computeLayout();
          render();
        } else if (msg.type === 'deadNegotiation') {
          showToast('双方连续 Pass，进入死活协商阶段');
        } else if (msg.type === 'deadConfirmProgress') {
          if (msg.black && msg.white) showToast('双方已确认，开始结算…');
        } else if (msg.type === 'gameResumed') {
          showToast('已回到对局中');
        } else if (msg.type === 'requestExpired') {
          // 文字切换已由 onState 的 lastRequestResult 处理（"X 超时已自动取消"）
        }
      });
    }
    partiAction('joinOnline', {});
  }

  function finishGame(winner: number, reason: string) {
    if (state.finished) return;
    state.finished = true;
    state.winner = winner;
    state.winReason = reason;
    state.phase = 'finished';

    var s = state.stats;
    if (winner === BLACK) { s.blackWins++; s.whiteLosses++; }
    else if (winner === WHITE) { s.whiteWins++; s.blackLosses++; }
    else { s.blackDraws++; s.whiteDraws++; }

    winText.textContent = winner === BLACK ? '黑方胜' : winner === WHITE ? '白方胜' : '平局';
    winSub.textContent = reason || '';
    winBanner.classList.add('show');
    playWin();
    render();
  }

  function localUndo() {
    if (state.finished || state.moves.length === 0) return;
    // AI 模式：房主执方悔棋计数；在线模式：本方计数
    var color = mode === 'ai' ? myAiSide : (myRole === BLACK ? 'black' : 'white');
    if ((state.undoCount[color] || 0) <= 0) return;
    var steps = mode === 'ai' ? 2 : 1;
    for (var i = 0; i < steps && state.moves.length > 0; i++) {
      var last = state.moves.pop();
      state.board[last.r][last.c] = EMPTY;
      if (last.captured && last.captured.length) {
        last.captured.forEach(function (s: any) { state.board[s.r][s.c] = last.color === BLACK ? WHITE : BLACK; });
        if (last.color === BLACK) state.capturedB -= last.captured.length;
        else state.capturedW -= last.captured.length;
      }
    }
    state.undoCount[color] = Math.max(0, (state.undoCount[color] || 0) - 1);
    state.turn = BLACK;
    state.finished = false;
    state.winner = 0;
    state.winLine = null;
    state.passes = 0;
    state.lastMove = state.moves.length ? state.moves[state.moves.length - 1] : null;
    winText.textContent = '';
    winSub.textContent = '';
    winBanner.classList.remove('show');
    render();
  }

  /* ==================================================================
         事件绑定
      ================================================================== */
  // 棋种切换：人机模式下进入对局后锁定，在线模式仅房主可切并同步
  gameGroup.addEventListener('click', function (e: any) {
    var btn: any = e.target.closest('.opt-btn'); if (!btn) return;
    // 人机模式：进入对局后禁止切换
    if (mode === 'ai' && (state.phase === 'playing' || state.phase === 'end_confirm')) return;
    // 在线模式：仅房主能切换
    if (mode === 'online' && !isHost) return;
    gameGroup.querySelectorAll('.opt-btn').forEach(function (b: any) { b.classList.remove('active'); });
    btn.classList.add('active');
    gameType = btn.dataset.game;
    if (mode === 'online' && hasParti()) {
      partiAction('setGameType', { gameType: gameType });
    }
  });

  modeGroup.addEventListener('click', function (e: any) {
    var btn: any = e.target.closest('.opt-btn'); if (!btn) return;
    // 在线模式：仅房主能切换
    if (mode === 'online' && hasParti() && !isHost) return;
    modeGroup.querySelectorAll('.opt-btn').forEach(function (b: any) { b.classList.remove('active'); });
    btn.classList.add('active');
    mode = btn.dataset.mode;
    aiLevelGroup.classList.toggle('show', mode === 'ai');
    onlineLobby.classList.toggle('hide', mode === 'ai');
    // 执子方选择：仅 AI 模式显示（在线模式由双方分别点选加入）
    sideGroup.classList.toggle('show', mode === 'ai');
    updateSideActive();
    // 切换模式时更新开始按钮状态
    if (mode === 'ai') {
      startBtn.classList.remove('green');
      startBtn.style.display = '';
      startBtn.disabled = false;
      // 清空侧边栏在线槽
      playerBlackEl.innerHTML = '● 黑方 <span class="name-text">等待加入…</span>';
      playerBlackEl.className = 'slot-name empty';
      slotBlack.classList.add('empty');
      slotBlack.classList.remove('me', 'ready');
      statusBlackEl.textContent = '';
      statusBlackEl.className = 'slot-status waiting';
      playerWhiteEl.innerHTML = '○ 白方 <span class="name-text">等待加入…</span>';
      playerWhiteEl.className = 'slot-name empty';
      slotWhite.classList.add('empty');
      slotWhite.classList.remove('me', 'ready');
      statusWhiteEl.textContent = '';
      statusWhiteEl.className = 'slot-status waiting';
    } else {
      startBtn.style.display = 'none';
      // 在线模式：自动加入房间（让 initOnlineSession 启动）
      if (!onlineJoined && hasParti()) {
        joinOnline();
      }
    }
    // 在线模式下同步模式给其他玩家
    if (hasParti() && isHost) {
      partiAction('setMode', { mode: mode, gameType: gameType, aiLevel: aiLevel });
    }
  });

  // 棋种切换（仅在线模式的房主有效，同步给其他玩家）— 已合并到上面单一 handler

  aiLevelGroup.addEventListener('click', function (e: any) {
    var btn: any = e.target.closest('.opt-btn'); if (!btn) return;
    // 仅房主能切换难度
    if (!isHost) return;
    aiLevelGroup.querySelectorAll('.opt-btn').forEach(function (b: any) { b.classList.remove('active'); });
    btn.classList.add('active');
    aiLevel = parseInt(btn.dataset.level);
    if (hasParti()) {
      partiAction('setAiLevel', { level: aiLevel });
    }
  });

  // 执子方选择：
  //   AI 模式：仅房主可改；影响 startAI 时的先手方与本方执子
  //   在线模式：本人可点；选择后通过 chooseSide 协议上送 worker
  sideGroup.addEventListener('click', function (e: any) {
    var btn: any = e.target.closest('.opt-btn'); if (!btn) return;
    var side = btn.dataset.side;
    if (mode === 'ai') {
      if (!isHost) return;
      hostSide = side;
      myAiSide = side;
      updateSideActive();
      // 同步给所有观战者
      if (hasParti()) {
        partiAction('setHostSide', { side: side });
      }
    } else if (mode === 'online') {
      if (hasParti()) {
        // 若点击的是已选的自己所在方，做"换边"：先 leaveSide 再 chooseSide
        var myCurrentSide = (parti.playerId === state.blackPlayer) ? 'black' :
          (parti.playerId === state.whitePlayer) ? 'white' : null;
        if (myCurrentSide === side) {
          // 同一边：切换为"离开"（无操作，纯视觉提示即可，不发协议）
          showToast('已是当前执子方');
          return;
        }
        // 换边：先 leaveSide 再 chooseSide
        if (myCurrentSide) {
          partiAction('leaveSide', {});
        }
        partiAction('chooseSide', { side: side });
      }
    }
  });

  // 同步执子方高亮
  // - AI 模式：高亮当前房主所选执子方（房主选择/观战者跟随）
  // - 在线模式：高亮本人所选执子方
  function updateSideActive() {
    var activeSide: any = null;
    if (mode === 'ai') {
      activeSide = hostSide; // 房主和观战者都跟随房主选择
    } else if (mode === 'online') {
      if (parti.playerId === state.blackPlayer) activeSide = 'black';
      else if (parti.playerId === state.whitePlayer) activeSide = 'white';
    }
    sideGroup.querySelectorAll('.opt-btn').forEach(function (b: any) {
      b.classList.toggle('active', b.dataset.side === activeSide);
    });
  }

  // 在线模式：点击 lobby 里的空位 = 选择执子方；点击自己已占的位 = 退出执子方
  onlineSlotBlack.addEventListener('click', function () {
    if (mode !== 'online' || !hasParti()) return;
    var meBlack = parti.playerId && parti.playerId === state.blackPlayer;
    // 自己已选黑：未准备时再点一下退出执子方；已准备时只提示
    if (meBlack) {
      if (state.blackReady) {
        showToast('已是当前执子方');
      } else {
        partiAction('leaveSide', {});
      }
      return;
    }
    if (state.blackPlayer && !meBlack) {
      showToast('黑方已被对方选择');
      return;
    }
    // 自己当前是白方（换边）：先 leaveSide
    var meWhite = parti.playerId && parti.playerId === state.whitePlayer;
    if (meWhite) partiAction('leaveSide', {});
    partiAction('chooseSide', { side: 'black' });
  });
  onlineSlotWhite.addEventListener('click', function () {
    if (mode !== 'online' || !hasParti()) return;
    var meWhite = parti.playerId && parti.playerId === state.whitePlayer;
    if (meWhite) {
      if (state.whiteReady) {
        showToast('已是当前执子方');
      } else {
        partiAction('leaveSide', {});
      }
      return;
    }
    if (state.whitePlayer && !meWhite) {
      showToast('白方已被对方选择');
      return;
    }
    var meBlack = parti.playerId && parti.playerId === state.blackPlayer;
    if (meBlack) partiAction('leaveSide', {});
    partiAction('chooseSide', { side: 'white' });
  });

  onlineReadyBtn.addEventListener('click', function () {
    if (!hasParti()) return;
    myReady = !myReady;
    partiAction('toggleReady', {});
  });

  startBtn.addEventListener('click', function () {
    if (!hasParti()) return;
    if (mode === 'online') {
      // 仅房主可点开始
      if (!isHost) return;
      // 必须双方都已选执子方且双方都已准备
      if (!state.blackPlayer || !state.whitePlayer) {
        showToast('等待对方加入…');
        return;
      }
      if (!state.blackReady || !state.whiteReady) {
        showToast('等待所有玩家准备就绪…');
        return;
      }
      partiAction('startGameOnline', {});
    } else if (mode === 'ai') {
      if (isHost) {
        // 房主开始AI对局：广播给所有玩家进入观战
        // 先手固定黑先，hostSide 仅影响房主与 AI 的执子分配
        partiAction('startAI', { gameType: gameType, hostSide: hostSide });
      }
    }
  });

  reqAcceptBtn.addEventListener('click', function () {
    requestBanner.classList.remove('show');
    stopCountdown();
    partiAction('respondRequest', { accept: true });
  });
  reqRejectBtn.addEventListener('click', function () {
    requestBanner.classList.remove('show');
    stopCountdown();
    partiAction('respondRequest', { accept: false });
  });

  btnUndo.addEventListener('click', function () {
    // AI 模式：worker 权威撤销（撤销 AI + 玩家两步）；在线模式：走请求流程，等对方同意
    if (mode === 'ai' && !isHost) return;
    if (hasParti()) {
      partiAction('undo', {});
    } else {
      localUndo();
    }
  });

  btnRematch.addEventListener('click', function () {
    // 重开：对局进行中重新开局
    // - AI 模式：房主可点，走弹窗协议（自己确认即可）
    // - 在线模式：任一执子方可点，需要对方同意
    if (mode === 'ai') {
      if (!isHost) return;
      if (state.phase !== 'playing' || state.finished) return;
      if (hasParti()) {
        partiAction('rematch', {});
      } else {
        localRematch();
      }
      return;
    }
    // 在线模式
    if (state.phase !== 'playing' || state.finished) return;
    if (hasParti()) {
      partiAction('rematch', {});
    } else {
      // 本地预览（无 parti）：直接本地重置
      localRematch();
    }
  });

  btnResign.addEventListener('click', function () {
    if (state.finished) return;
    if (state.phase !== 'playing' && state.phase !== 'end_confirm') return;
    // 认输：纯通知协议——对方只看到"对方想要认输"提示，认输方自己确认
    if (hasParti()) {
      partiAction('resign', {});
    } else {
      // 本地预览（无 parti）：直接走 finishGame
      var loser = mode === 'ai' ? (myAiSide === 'black' ? BLACK : WHITE) : state.turn;
      var winner = loser === BLACK ? WHITE : BLACK;
      finishGame(winner, '认输');
    }
  });

  btnContinue.addEventListener('click', function () {
    if (!hasParti()) return;
    if (state.phase !== 'end_confirm') return;
    partiAction('continueGame', {});
  });

  btnConfirmDead.addEventListener('click', function () {
    if (!hasParti()) return;
    if (state.phase !== 'end_confirm') return;
    partiAction('confirmDead', {});
  });

  btnReplay.addEventListener('click', function () {
    // 再来一局：对局结束后重新开一局
    // - AI 模式：房主可点，走弹窗协议（自己确认即可）
    // - 在线模式：任一执子方可点，需要对方同意
    if (mode === 'ai') {
      if (!isHost) return;
      if (state.phase !== 'finished') return;
      if (hasParti()) {
        partiAction('restart', {});
      } else {
        localRematch();
      }
    } else {
      if (!hasParti()) return;
      if (myRole !== BLACK && myRole !== WHITE) return;
      if (state.phase !== 'finished') return;
      partiAction('restart', {});
    }
  });

  btnBack.addEventListener('click', function () {
    if (hasParti()) {
      // AI/在线模式统一走 noResponse 协议：弹窗显示「已发送【结束游戏】请求，等待你确认」
      // 房主点同意/拒绝确认；超时自动取消
      partiAction('backToMenu', {});
    } else {
      // 本地预览：直接重置回面板
      winText.textContent = '';
      winSub.textContent = '';
      winBanner.classList.remove('show');
      state.phase = 'idle';
      state.finished = false;
      state.winner = 0;
      state.moves = [];
      state.lastMove = null;
      state.winLine = null;
      state.winReason = '';
      state.board = createBoard(gameType === 'go' ? SIZE_GO : SIZE_GOMOKU);
      state.boardSize = gameType === 'go' ? SIZE_GO : SIZE_GOMOKU;
      modePanel.classList.remove('hide');
      render();
    }
  });

  /* ==================================================================
         棋盘点击
         ================================================================== */
  canvas = document.getElementById('board');
  ctx = canvas.getContext('2d');

  function getBoardPos(clientX: number, clientY: number) {
    var rect = canvas.getBoundingClientRect();
    var x = clientX - rect.left, y = clientY - rect.top;
    var c = Math.round((x - padding) / cellSize);
    var r = Math.round((y - padding) / cellSize);
    if (r < 0 || r >= state.boardSize || c < 0 || c >= state.boardSize) return null;
    return { r: r, c: c };
  }

  canvas.addEventListener('click', function (e: any) {
    if (state.finished || state.phase !== 'playing') return;
    ensureAudio();
    var pos = getBoardPos(e.clientX, e.clientY);
    if (!pos) return;
    if (mode === 'online') {
      if (hasParti() && state.turn === myRole) partiAction('place', { r: pos.r, c: pos.c });
    } else if (mode === 'ai') {
      // AI 模式：轮到房主执子方时发给 worker，AI 回应由 worker 定时器完成
      var myColor = myAiSide === 'black' ? 1 : 2;
      if (hasParti() && isHost && state.turn === myColor) partiAction('place', { r: pos.r, c: pos.c });
    }
  });

  canvas.addEventListener('touchstart', function (e: any) {
    e.preventDefault();
    var t = e.touches[0];
    var pos = getBoardPos(t.clientX, t.clientY);
    if (!pos) return;
    ensureAudio();
    if (state.phase !== 'playing' || state.finished) return;
    if (mode === 'online') {
      if (hasParti() && state.turn === myRole) partiAction('place', { r: pos.r, c: pos.c });
    } else if (mode === 'ai') {
      var myColor = myAiSide === 'black' ? 1 : 2;
      if (hasParti() && isHost && state.turn === myColor) partiAction('place', { r: pos.r, c: pos.c });
    }
  }, { passive: false });

  window.addEventListener('resize', function () {
    clearTimeout((window as any)._resizeTimer);
    (window as any)._resizeTimer = setTimeout(function () {
      if (state.boardSize) { computeLayout(); render(); }
    }, 200);
  });

  /* ==================================================================
         初始化
      ================================================================== */
  state.board = createBoard(SIZE_GOMOKU);
  state.boardSize = SIZE_GOMOKU;
  computeLayout();
  render();

  var tips: any = {
    gomoku: '五子棋：黑先白后，横竖斜连成 5 子即胜（无禁手）。',
    go: '围棋：黑先白后，无气棋子自动提走，禁止自杀。双方连续 Pass 后数目。'
  };
  ruleTip.textContent = tips[gameType];

  // 在线模式默认进入
  if (mode === 'online') {
    joinOnline();
  }

  partiLog('ready');
})();
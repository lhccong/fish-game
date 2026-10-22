// 中国象棋 UI（parti 客户端）
// 风格与 room-gomoku-go 对齐：侧栏 + 棋盘 Canvas + 模式面板。
/* eslint-disable */
// @ts-nocheck

import './styles.css';

(function () {
  'use strict';

  // ----- DOM 引用 -----
  var $ = function (id) { return document.getElementById(id); };
  var modePanel = $('modePanel');
  var sideTitle = $('sideTitle');
  var slotRed = $('slotRed');
  var slotBlack = $('slotBlack');
  var playerRed = $('playerRed');
  var playerBlack = $('playerBlack');
  var statusRed = $('statusRed');
  var statusBlack = $('statusBlack');
  var statRed = $('statRed');
  var statBlack = $('statBlack');
  var ruleTip = $('ruleTip');
  var puzzleStepBar = $('puzzleStepBar');
  var puzzleStepCount = $('puzzleStepCount');
  var puzzleStepLimit = $('puzzleStepLimit');
  var btnUndo = $('btnUndo');
  var btnResign = $('btnResign');
  var btnRematch = $('btnRematch');
  var btnReplay = $('btnReplay');
  var btnBack = $('btnBack');

  var turnIndicator = $('turnIndicator');
  var winBanner = $('winBanner');
  var winText = $('winText');
  var winSub = $('winSub');
  var requestBanner = $('requestBanner');
  var requestText = $('requestText');
  var reqAcceptBtn = $('reqAccept');
  var reqRejectBtn = $('reqReject');
  var reqAckWrap = requestBanner ? requestBanner.querySelector('.req-ack') : null;
  var reqAckBtn = $('reqAck');
  var toastEl = $('toast');

  var gameGroup = $('gameGroup');
  var modeGroup = $('modeGroup');
  var modeSectionLabel = $('modeSectionLabel');
  var aiLevelGroup = $('aiLevelGroup');
  var sideGroup = $('sideGroup');
  var puzzleGroup = $('puzzleGroup');
  var puzzleListEl = $('puzzleList');
  var onlineLobby = $('onlineLobby');
  var onlineSlotRed = $('onlineSlotRed');
  var onlineSlotBlack = $('onlineSlotBlack');
  var onlineNameRed = $('onlineNameRed');
  var onlineNameBlack = $('onlineNameBlack');
  var onlineFlagRed = $('onlineFlagRed');
  var onlineFlagBlack = $('onlineFlagBlack');
  var onlineReadyBtn = $('onlineReadyBtn');
  var startBtn = $('startBtn');

  var canvas = $('board');
  var ctx = canvas ? canvas.getContext('2d') : null;

  // ----- 内部状态 -----
  var state = {
    gameMode: 'classic', matchMode: 'ai', aiLevel: 1, hostSide: 'r',
    board: [], banzhuReal: [], banzhuFlipped: { r: 0, b: 0 },
    enableFlip: false,
    turn: 'r', history: [], movesSinceCapture: 0,
    phase: 'lobby', finished: false, winner: null, reason: '',
    players: {}, redPlayer: null, blackPlayer: null,
    redReady: false, blackReady: false, hostId: null,
    puzzleId: 'p1', puzzleLimit: 0, puzzleSteps: 0,
    stats: { redWins: 0, redLosses: 0, redDraws: 0, blackWins: 0, blackLosses: 0, blackDraws: 0 },
    lastCheck: false,
  };
  var myPlayerId = null;
  var mySide = null;           // 'r' | 'b' | null
  var flipped = false;         // 我执黑方时把棋盘 180° 翻转，让己方棋子靠近自己（屏幕底部）
  var isHost = false;
  var gameMode = 'classic';    // 'classic' | 'banzhu' | 'puzzle'
  var matchMode = 'online';    // 'ai' | 'online'
  var aiLevel = 1;
  var hostSide = 'r';
  var puzzleId = 'p1';
  var redReady = false;
  var blackReady = false;

  var selected = null;         // { from: [c, r] } 当前选中的己方棋子
  var legalTargets = [];       // 选中后该棋子的合法走子目标 [c,r][]
  var cell = 56;               // 屏幕 cell px
  var padX = 36, padY = 36;    // 棋盘外边距
  var subscription = null;
  var toastTimer = null;

  // 揭棋暗子：本地追踪已揭示过的暗子（state 同步时已经揭示过的 + 走子时揭示的）
  // 用来给玩家显示"对方吃我的暗子时揭示了 X"
  var revealedCaptures = {}; // key=pos -> piece

  var PUZZLES = [
    { id: 'p1', title: '车对将 · 7 步', desc: '红方车在底线，黑将在中线。' },
    { id: 'p2', title: '双车对单车 · 10 步', desc: '红方双车对黑方单车。' },
    { id: 'p3', title: '炮马对士象 · 12 步', desc: '红方炮镇当头 + 马卧槽。' },
  ];

  // ----- 工具 -----
  function hasParti() { return !!(parti && typeof parti.onState === 'function'); }
  function partiAction(name, payload) {
    if (hasParti()) return parti.action(name, payload);
    return Promise.resolve({ ok: true });
  }
  function partiLog() {
    if (hasParti() && parti.log) parti.log.apply(parti, arguments);
  }
  // ----- 弹窗协议（与 room-gomoku-go 一致）-----
  var requestTimer = $('requestTimer');
  var requestTimerNum = $('requestTimerNum');
  var reqBtnsWrap = requestBanner ? requestBanner.querySelector('.req-btns') : null;
  var reqAckWrap = requestBanner ? requestBanner.querySelector('.req-ack') : null;
  var REQUEST_TIMEOUT_SEC = 15;
  var countdownInterval = null;
  var countdownKey = null; // 启动倒计时的去重 key
  var shownRequestResults = {}; // ts -> true，已显示过的请求结果去重用

  function startCountdown(secs) {
    stopCountdown();
    if (requestTimerNum) requestTimerNum.textContent = secs;
    if (requestTimer) requestTimer.style.display = '';
    countdownInterval = setInterval(function () {
      secs--;
      if (secs <= 0) {
        stopCountdown();
        return;
      }
      if (requestTimerNum) requestTimerNum.textContent = secs;
    }, 1000);
  }
  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (requestTimer) requestTimer.style.display = 'none';
  }

  var typeMap = { undo: '悔棋', restart: '再来一局', rematch: '重开', resign: '投降', backToMenu: '结束游戏' };

  function renderRequestBanner() {
    if (!requestBanner) return;
    if (state.pendingRequest) {
      var req = state.pendingRequest;
      var action = typeMap[req.type] || '操作';
      if (req.noResponse) {
        if (req.from === myPlayerId) {
          // 发起方：弹"已发送【X】请求，等待你确认" + 同意/拒绝按钮 + 倒计时
          requestText.textContent = '已发送【' + action + '】请求，等待你确认';
          if (reqBtnsWrap) reqBtnsWrap.style.display = '';
          if (reqAckWrap) reqAckWrap.style.display = 'none';
          requestBanner.classList.add('show');
          if (req.createdAt !== countdownKey) {
            countdownKey = req.createdAt;
            startCountdown(REQUEST_TIMEOUT_SEC);
          }
        } else {
          // 对方：显示等待倒计时（与发起方同步，不自动消失）
          requestText.textContent = '对方想要' + action;
          if (reqBtnsWrap) reqBtnsWrap.style.display = 'none';
          if (reqAckWrap) reqAckWrap.style.display = 'none';
          requestBanner.classList.add('show');
          if (req.createdAt !== countdownKey) {
            countdownKey = req.createdAt;
            startCountdown(REQUEST_TIMEOUT_SEC);
          }
        }
      } else {
        if (req.from === myPlayerId) {
          // 申请方：等待对方确认（隐藏同意/拒绝）+ 倒计时
          requestText.textContent = '已发送【' + action + '】请求，等待对方确认…';
          if (reqBtnsWrap) reqBtnsWrap.style.display = 'none';
          if (reqAckWrap) reqAckWrap.style.display = 'none';
          requestBanner.classList.add('show');
          if (req.createdAt !== countdownKey) {
            countdownKey = req.createdAt;
            startCountdown(REQUEST_TIMEOUT_SEC);
          }
        } else {
          // 对方：可以同意/拒绝 + 倒计时
          requestText.textContent = '对方请求【' + action + '】，是否同意？';
          if (reqBtnsWrap) reqBtnsWrap.style.display = '';
          if (reqAckWrap) reqAckWrap.style.display = 'none';
          requestBanner.classList.add('show');
          if (req.createdAt !== countdownKey) {
            countdownKey = req.createdAt;
            startCountdown(REQUEST_TIMEOUT_SEC);
          }
        }
      }
    } else if (state.lastRequestResult) {
      stopCountdown();
      var r = state.lastRequestResult;
      var rKey = r.ts;
      shownRequestResults[rKey] = true;
      var acceptText = r.accept ? '同意' : '拒绝';
      var isFromMe = (myPlayerId && r.from === myPlayerId);
      var isMe = (myPlayerId && r.by === myPlayerId);
      var isExpired = !!r.expired;
      var bannerText;
      if (isExpired) {
        var expText;
        if (r.type === 'resign') expText = '投降';
        else if (r.type === 'backToMenu') expText = '返回选择';
        else if (r.type === 'undo') expText = '悔棋';
        else if (r.type === 'restart') expText = '再来一局';
        else if (r.type === 'rematch') expText = '重开';
        else expText = '操作';
        bannerText = '【' + expText + '】超时已自动取消';
      } else if (isFromMe) {
        if (r.type === 'resign') {
          bannerText = r.accept ? '你已投降' : '已取消投降';
        } else if (r.type === 'backToMenu') {
          bannerText = r.accept ? '你已返回选择' : '已取消返回选择';
        } else {
          // 发起方视角：undo/restart/rematch 由对方响应
          var fromMeName = typeMap[r.type] || '操作';
          bannerText = '对方已' + acceptText + '【' + fromMeName + '】';
        }
      } else {
        if (r.type === 'resign') {
          bannerText = '对方点击了【' + acceptText + '】（投降）';
        } else if (r.type === 'backToMenu') {
          bannerText = '对方点击了【' + acceptText + '】（返回选择）';
        } else if (isMe) {
          // 我是响应方：跳过弹窗文案，直接关闭
          requestBanner.classList.remove('show');
          stopCountdown();
          bannerText = '';
        } else {
          bannerText = '对方点击了【' + acceptText + '】';
        }
      }
      if (bannerText) {
        requestText.textContent = bannerText;
        if (reqBtnsWrap) reqBtnsWrap.style.display = 'none';
        if (reqAckWrap) reqAckWrap.style.display = 'none';
        requestBanner.classList.add('show');
        setTimeout(function () {
          requestBanner.classList.remove('show');
        }, 1000);
      } else {
        stopCountdown();
      }
    } else {
      // 没有 pending 也没有 result
      stopCountdown();
      if (requestBanner.classList.contains('show')) {
        setTimeout(function () {
          requestBanner.classList.remove('show');
        }, 1000);
      }
    }
  }

  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
  }

  // ----- 棋盘绘制 -----
  function fitCanvas() {
    if (!canvas) return;
    var wrap = canvas.parentElement;
    var wrapW = wrap.clientWidth - 32;
    var wrapH = wrap.clientHeight - 32;
    // 9 列 8 间隔，10 行 9 间隔，加 padding
    var availCellW = (wrapW - padX * 2) / 8;
    var availCellH = (wrapH - padY * 2) / 9;
    cell = Math.max(28, Math.min(64, Math.floor(Math.min(availCellW, availCellH))));
    var w = cell * 8 + padX * 2;
    var h = cell * 9 + padY * 2;
    var dpr = window.devicePixelRatio || 1;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function xy(c, r) {
    return [padX + c * cell, sy(r)];
  }
  // 逻辑行 r → 屏幕 y。flipped 时整个棋盘以画布水平中线翻转，
  // 让执黑/执红始终让自己的阵营贴在屏幕底部。
  function sy(r) {
    if (flipped) return padY + (9 - r) * cell;
    return padY + r * cell;
  }
  // 列 c → 屏幕 x（始终不翻转）。
  function sx(c) {
    return padX + c * cell;
  }
  function hitTest(mx, my) {
    // xy(c, r) 已经内部处理了翻转（翻转时 sy(r) = padY + (9-r)*cell），
    // 所以对每个原始逻辑格 (c, r) 直接算屏幕位置比较即可，
    // 命中后返回原始逻辑坐标，用于 state.board[c][r] 索引。
    for (var c = 0; c < 9; c++) {
      for (var r = 0; r < 10; r++) {
        var p = xy(c, r);
        if (Math.abs(mx - p[0]) < cell / 2 && Math.abs(my - p[1]) < cell / 2) {
          return [c, r];
        }
      }
    }
    return null;
  }

  var PIECE_NAME = {
    k: '将', a: '士', b: '象', n: '马', r: '车', c: '炮', p: '卒',
    K: '帥', A: '仕', B: '相', N: '馬', R: '俥', C: '炮', P: '兵',
  };
  var PIECE_COLOR = { k: 'b', a: 'b', b: 'b', n: 'b', r: 'b', c: 'b', p: 'b' };
  Object.keys(PIECE_NAME).forEach(function (k) {
    PIECE_COLOR[k] = (k >= 'A' && k <= 'Z') ? 'r' : 'b';
  });

  function draw() {
    if (!ctx || !state) return;
    var w = canvas.width / (window.devicePixelRatio || 1);
    var h = canvas.height / (window.devicePixelRatio || 1);
    ctx.fillStyle = '#f0d9a8';
    ctx.fillRect(0, 0, w, h);
    // 网格
    ctx.strokeStyle = '#5a4f3e';
    ctx.lineWidth = 1;
    for (var c = 0; c < 9; c++) {
      var x1 = sx(c);
      ctx.beginPath();
      ctx.moveTo(x1, sy(0));
      ctx.lineTo(x1, sy(4));
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x1, sy(5));
      ctx.lineTo(x1, sy(9));
      ctx.stroke();
    }
    for (var r = 0; r < 10; r++) {
      var y1 = sy(r);
      ctx.beginPath();
      ctx.moveTo(sx(0), y1);
      ctx.lineTo(sx(8), y1);
      ctx.stroke();
    }
    // 左右边界加粗
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx(0), sy(0));
    ctx.lineTo(sx(0), sy(9));
    ctx.lineTo(sx(8), sy(9));
    ctx.lineTo(sx(8), sy(0));
    ctx.stroke();
    ctx.lineWidth = 1;
    // 楚河汉界
    ctx.fillStyle = '#7a6e5c';
    ctx.font = (cell * 0.4) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 翻转后楚河漢界两字以中心对称镜像
    ctx.fillText('楚 河', sx(flipped ? 6 : 2), sy(4.5));
    ctx.fillText('漢 界', sx(flipped ? 2 : 6), sy(4.5));
    // 九宫斜线
    ctx.strokeStyle = '#5a4f3e';
    ctx.beginPath();
    ctx.moveTo(sx(3), sy(0));
    ctx.lineTo(sx(5), sy(2));
    ctx.moveTo(sx(5), sy(0));
    ctx.lineTo(sx(3), sy(2));
    ctx.moveTo(sx(3), sy(7));
    ctx.lineTo(sx(5), sy(9));
    ctx.moveTo(sx(5), sy(7));
    ctx.lineTo(sx(3), sy(9));
    ctx.stroke();

    // 棋子
    var b = state.board || [];
    for (var cc = 0; cc < 9; cc++) {
      for (var rr = 0; rr < 10; rr++) {
        var p = b[cc] && b[cc][rr];
        if (!p || p === '.') continue;
        drawPiece(cc, rr, p);
      }
    }
    // 最后落子高亮
    var last = state.history && state.history.length ? state.history[state.history.length - 1] : null;
    if (last && !last.flip) {
      highlight(last.from[0], last.from[1], '#d5a04a');
      highlight(last.to[0], last.to[1], '#d5a04a');
    }
    // 选中 + 合法走子提示
    if (selected) {
      highlight(selected.from[0], selected.from[1], '#5a8a4a');
      legalTargets.forEach(function (t) {
        drawMoveMarker(t[0], t[1]);
      });
    }
  }

  function highlight(c, r, color) {
    var p = xy(c, r);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.strokeRect(p[0] - cell / 2 + 2, p[1] - cell / 2 + 2, cell - 4, cell - 4);
    ctx.lineWidth = 1;
  }
  function drawMoveMarker(c, r) {
    var p = xy(c, r);
    ctx.fillStyle = 'rgba(90,138,74,0.7)';
    ctx.beginPath();
    ctx.arc(p[0], p[1], cell * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPiece(c, r, p) {
    var pxy = xy(c, r);
    var radius = cell * 0.42;
    // 棋子底色
    var grad = ctx.createRadialGradient(pxy[0] - radius / 3, pxy[1] - radius / 3, radius / 4, pxy[0], pxy[1], radius);
    grad.addColorStop(0, '#fbf3df');
    grad.addColorStop(1, '#d9b97a');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(pxy[0], pxy[1], radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#5a4f3e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 文字
    if (p === 'x') {
      ctx.fillStyle = '#9b8e7b';
      ctx.font = 'bold ' + Math.floor(radius) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', pxy[0], pxy[1]);
      return;
    }
    ctx.fillStyle = (p >= 'A' && p <= 'Z') ? '#b04848' : '#1a1a1a';
    ctx.font = 'bold ' + Math.floor(radius * 1.1) + 'px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(PIECE_NAME[p] || p, pxy[0], pxy[1]);
  }

  // ----- 状态同步 -----
  function applyState(s) {
    if (!s) return;
    state = s;
    myPlayerId = hasParti() ? parti.playerId : null;
    isHost = (myPlayerId && s.hostId === myPlayerId);

    // 同步内部"我执方"
    if (s.matchMode === 'ai') {
      mySide = isHost ? s.hostSide : (s.hostSide === 'r' ? 'b' : 'r');
    } else {
      if (myPlayerId && s.redPlayer === myPlayerId) mySide = 'r';
      else if (myPlayerId && s.blackPlayer === myPlayerId) mySide = 'b';
      else mySide = null;
    }
    // 棋盘朝向：我执黑方时翻转，让黑方靠近我（屏幕底部）
    flipped = (mySide === 'b' && s.phase === 'playing');

    // 同步内部"配置"
    gameMode = s.gameMode;
    matchMode = s.matchMode;
    aiLevel = s.aiLevel;
    // 强制从 state 同步 hostSide（观战者的本地 hostSide 可能是陈旧的）
    if (s.hostSide) hostSide = s.hostSide;
    puzzleId = s.puzzleId || 'p1';
    redReady = s.redReady;
    blackReady = s.blackReady;

    renderAll();
  }

  // ----- 渲染分发 -----
  function renderAll() {
    renderModePanel();
    renderSidebar();
    renderRuleTip();
    renderPuzzleBar();
    renderBottom();
    renderRequestBanner();
    renderTurnIndicator();
    renderWinBanner();
    draw();
  }

  function renderModePanel() {
    if (!modePanel) return;
    if (state.phase === 'lobby' || state.phase === 'idle') {
      modePanel.classList.remove('hide');
    } else {
      modePanel.classList.add('hide');
    }
    // 高亮按钮
    var btns = gameGroup.querySelectorAll('.opt-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.game === gameMode);
    });
    btns = modeGroup.querySelectorAll('.opt-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.mode === matchMode);
    });
    // 残局模式强制 AI（matchMode 在这里只是为了保证高亮落到"人机对战"上），
    // 视觉禁用放到下方统一处理（isLobbyPhase + isHost 判断之后）
    if (gameMode === 'puzzle') {
      matchMode = 'ai';
    }
    // AI 难度（仅 AI 模式显示）
    if (matchMode === 'ai') {
      aiLevelGroup.classList.add('show');
    } else {
      aiLevelGroup.classList.remove('show');
    }
    // 执方（AI 模式显示；残局模式隐藏）
    if (matchMode === 'ai' && gameMode !== 'puzzle') {
      sideGroup.classList.add('show');
    } else {
      sideGroup.classList.remove('show');
    }
    btns = sideGroup.querySelectorAll('.opt-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', b.dataset.side === hostSide);
    });
    // AI 模式执子方：lobby 阶段始终可改（playing 阶段不展示 sideGroup，见下）
    if (matchMode === 'ai' && gameMode !== 'puzzle') {
      sideGroup.classList.add('show');
    } else {
      sideGroup.classList.remove('show');
    }
    btns = aiLevelGroup.querySelectorAll('.opt-btn');
    btns.forEach(function (b) {
      b.classList.toggle('active', Number(b.dataset.level) === aiLevel);
    });

    // Lobby 阶段：非房主只能选择执子方（sideGroup）和准备（onlineReadyBtn），
    // 其他配置（棋种 / 对战模式 / AI 难度）一律禁用
    // 残局模式：对战模式锁定为"人机对战"（任何人都不能切）
    var isLobbyPhase = state.phase === 'lobby' || state.phase === 'idle';
    var localIsHost = isHost;
    var gameTypeBtns = gameGroup.querySelectorAll('.opt-btn');
    var modeBtns = modeGroup.querySelectorAll('.opt-btn');
    var aiBtns = aiLevelGroup.querySelectorAll('.opt-btn');
    // 在线 lobby
    if (matchMode === 'online' && gameMode !== 'puzzle') {
      onlineLobby.classList.remove('hide');
    } else {
      onlineLobby.classList.add('hide');
    }
    // 残局面选择
    if (gameMode === 'puzzle') {
      puzzleGroup.classList.add('show');
    } else {
      puzzleGroup.classList.remove('show');
    }
    // 渲染残局面列表
    if (puzzleListEl && puzzleListEl.children.length === 0) {
      PUZZLES.forEach(function (p) {
        var el = document.createElement('div');
        el.className = 'puzzle-item';
        el.textContent = p.title;
        el.dataset.puzzleId = p.id;
        el.onclick = function () {
          if (!isHost) return;
          puzzleId = p.id;
          partiAction('setPuzzleId', { puzzleId: p.id });
          renderAll();
        };
        puzzleListEl.appendChild(el);
      });
    }
    if (puzzleListEl) {
      var items = puzzleListEl.querySelectorAll('.puzzle-item');
      items.forEach(function (b) {
        b.classList.toggle('active', b.dataset.puzzleId === puzzleId);
        b.disabled = isLobbyPhase && !isHost;
      });
    }
    // 在线 lobby 内容
    if (matchMode === 'online' && gameMode !== 'puzzle') {
      var meRed = myPlayerId && state.redPlayer === myPlayerId;
      var meBlack = myPlayerId && state.blackPlayer === myPlayerId;
      var redName = (state.redPlayer && state.players[state.redPlayer] && state.players[state.redPlayer].name) || '玩家';
      var blackName = (state.blackPlayer && state.players[state.blackPlayer] && state.players[state.blackPlayer].name) || '玩家';
      onlineNameRed.innerHTML = '帥 红方 <span class="name-text">' +
        (state.redPlayer ? redName : '等待加入…') + '</span>';
      onlineNameBlack.innerHTML = '將 黑方 <span class="name-text">' +
        (state.blackPlayer ? blackName : '等待加入…') + '</span>';
      onlineSlotRed.classList.toggle('me', !!meRed);
      onlineSlotBlack.classList.toggle('me', !!meBlack);
      onlineSlotRed.classList.toggle('empty', !state.redPlayer);
      onlineSlotBlack.classList.toggle('empty', !state.blackPlayer);
      if (state.redPlayer) {
        onlineFlagRed.textContent = state.redReady ? '已准备 ✓' : '等待准备…';
        onlineFlagRed.className = 'slot-status ' + (state.redReady ? 'ok' : 'waiting');
        onlineNameRed.className = 'slot-name';
      } else {
        onlineFlagRed.textContent = '';
        onlineFlagRed.className = 'slot-status waiting';
        onlineNameRed.className = 'slot-name empty';
      }
      if (state.blackPlayer) {
        onlineFlagBlack.textContent = state.blackReady ? '已准备 ✓' : '等待准备…';
        onlineFlagBlack.className = 'slot-status ' + (state.blackReady ? 'ok' : 'waiting');
        onlineNameBlack.className = 'slot-name';
      } else {
        onlineFlagBlack.textContent = '';
        onlineFlagBlack.className = 'slot-status waiting';
        onlineNameBlack.className = 'slot-name empty';
      }
      // 准备按钮
      var canReady = (meRed || meBlack) && state.phase === 'lobby';
      var myReady = (meRed && state.redReady) || (meBlack && state.blackReady);
      onlineReadyBtn.disabled = !canReady;
      onlineReadyBtn.textContent = myReady ? '取消准备' : '准备';
      onlineReadyBtn.classList.toggle('cancel', !!myReady);
    }

    // 开始按钮
    if (gameMode === 'puzzle') {
      startBtn.textContent = '开始残局';
      startBtn.style.display = isHost ? '' : 'none';
      startBtn.disabled = false;
    } else if (matchMode === 'ai') {
      // AI 模式：只有房主能看到"开始对局"按钮
      startBtn.textContent = '开始对局';
      startBtn.style.display = isHost ? '' : 'none';
      startBtn.disabled = false;
    } else {
      // online：只有房主能看到开始按钮
      startBtn.style.display = isHost ? '' : 'none';
    }
  }

  function renderSidebar() {
    var myName = '你';
    if (myPlayerId && state.players && state.players[myPlayerId] && state.players[myPlayerId].name) {
      myName = state.players[myPlayerId].name;
    }
    var aiLevelName = ['入门', '普通', '困难', '大师'][aiLevel] || '普通';
    var undoCount = state.undoCount || { r: 2, b: 2 };
    var showUndo = state.phase === 'playing' && state.gameMode !== 'puzzle';

    // 玩家槽：与 online 模式复用同一份 slot 样式
    // AI 模式下：房主执方 = "me"，AI 执方 = "ai"
    if (matchMode === 'ai') {
      var isHostR = hostSide === 'r';
      // 房主方（me）
      var mySlot = isHostR ? slotRed : slotBlack;
      var myNameEl = isHostR ? playerRed : playerBlack;
      var myStatusEl = isHostR ? statusRed : statusBlack;
      mySlot.className = 'player-slot me';
      myNameEl.className = 'slot-name';
      myNameEl.innerHTML = (isHostR ? '帥 红方' : '將 黑方') +
        ' <span class="name-text">' + myName + '</span>';
      myStatusEl.textContent = isHostR ? '执红' : '执黑';
      myStatusEl.className = 'slot-status ok';
      // AI 方（ai）
      var aiSlot = isHostR ? slotBlack : slotRed;
      var aiNameEl = isHostR ? playerBlack : playerRed;
      var aiStatusEl = isHostR ? statusBlack : statusRed;
      aiSlot.className = 'player-slot ai';
      aiNameEl.className = 'slot-name';
      aiNameEl.innerHTML = (isHostR ? '將 黑方' : '帥 红方') +
        ' <span class="name-text">AI · ' + aiLevelName + '</span>';
      aiStatusEl.textContent = isHostR ? '执黑' : '执红';
      aiStatusEl.className = 'slot-status ai';
    } else {
      // online
      var meRed = myPlayerId && state.redPlayer === myPlayerId;
      var meBlack = myPlayerId && state.blackPlayer === myPlayerId;
      slotRed.classList.toggle('me', !!meRed);
      slotBlack.classList.toggle('me', !!meBlack);
      slotRed.classList.toggle('empty', !state.redPlayer);
      slotBlack.classList.toggle('empty', !state.blackPlayer);
      slotRed.classList.toggle('ready', !!state.redPlayer && !!state.redReady);
      slotBlack.classList.toggle('ready', !!state.blackPlayer && !!state.blackReady);
      var redName = state.redPlayer ? (state.players[state.redPlayer] && state.players[state.redPlayer].name || '玩家') : '等待加入…';
      var blackName = state.blackPlayer ? (state.players[state.blackPlayer] && state.players[state.blackPlayer].name || '玩家') : '等待加入…';
      playerRed.innerHTML = '帥 红方 <span class="name-text">' + redName + '</span>';
      playerBlack.innerHTML = '將 黑方 <span class="name-text">' + blackName + '</span>';
      playerRed.className = 'slot-name' + (state.redPlayer ? '' : ' empty');
      playerBlack.className = 'slot-name' + (state.blackPlayer ? '' : ' empty');
      statusRed.textContent = state.redReady ? '已准备' : (state.redPlayer ? '未准备' : '');
      statusBlack.textContent = state.blackReady ? '已准备' : (state.blackPlayer ? '未准备' : '');
      statusRed.className = 'slot-status ' + (state.redReady ? 'ok' : (state.redPlayer ? 'waiting' : ''));
      statusBlack.className = 'slot-status ' + (state.blackReady ? 'ok' : (state.blackPlayer ? 'waiting' : ''));
    }
    // 悔棋次数显示（仅 playing 阶段且非残局；双方都可见）
    var undoRedEl = $('undoRed');
    var undoBlackEl = $('undoBlack');
    var mySideForUndo = matchMode === 'ai' ? hostSide : mySide;
    if (undoRedEl) {
      var showRed = showUndo && state.phase === 'playing';
      undoRedEl.style.display = showRed ? '' : 'none';
      if (showRed) {
        var numR = undoCount.r;
        undoRedEl.innerHTML = '悔棋剩余：<span class="undo-num">' + numR + '</span>/2';
        undoRedEl.classList.toggle('exhausted', numR === 0);
      }
    }
    if (undoBlackEl) {
      var showBlack = showUndo && state.phase === 'playing';
      undoBlackEl.style.display = showBlack ? '' : 'none';
      if (showBlack) {
        var numB = undoCount.b;
        undoBlackEl.innerHTML = '悔棋剩余：<span class="undo-num">' + numB + '</span>/2';
        undoBlackEl.classList.toggle('exhausted', numB === 0);
      }
    }
    // 统计
    var s = state.stats || {};
    statRed.textContent = (s.redWins || 0) + ' 胜 ' + (s.redLosses || 0) + ' 负 ' + (s.redDraws || 0) + ' 平';
    statBlack.textContent = (s.blackWins || 0) + ' 胜 ' + (s.blackLosses || 0) + ' 负 ' + (s.blackDraws || 0) + ' 平';
  }

  function renderRuleTip() {
    var tip = '';
    if (gameMode === 'classic') {
      tip = '经典中国象棋：将死对方将/帅获胜。60 回合无吃子判和。';
    } else if (gameMode === 'banzhu') {
      tip = '揭棋：暗子按位置走（车直、炮隔山、马日、象田、士斜、兵前进），走到目的地后翻成真实身份。士象过河不限。';
    } else {
      tip = '残局挑战：红方先手，在限步内绝杀黑方。';
    }
    ruleTip.textContent = tip;
  }

  function renderPuzzleBar() {
    if (gameMode === 'puzzle' && state.phase === 'playing') {
      puzzleStepBar.style.display = '';
      puzzleStepCount.textContent = String(state.puzzleSteps || 0);
      puzzleStepLimit.textContent = String(state.puzzleLimit || 0);
      puzzleStepBar.classList.toggle('exceeded', (state.puzzleSteps || 0) > (state.puzzleLimit || 0));
    } else {
      puzzleStepBar.style.display = 'none';
    }
  }

  function renderBottom() {
    var isPlaying = state.phase === 'playing';
    var isFinished = state.phase === 'finished';
    var isLobby = state.phase === 'lobby' || state.phase === 'idle';
    var undoCount = state.undoCount || { r: 2, b: 2 };
    var mySideForUndo = matchMode === 'ai' ? hostSide : mySide;
    var myUndoRemain = (mySideForUndo && undoCount[mySideForUndo]) || 0;

    // 认输：playing 时可见
    var canResign = false;
    if (isPlaying) {
      if (matchMode === 'ai') canResign = isHost;
      else canResign = mySide !== null;
    }
    btnResign.style.display = (isPlaying && canResign) ? '' : 'none';
    btnResign.disabled = !canResign;

    // 悔棋：playing 时可见，需本方有剩余次数
    //   AI 模式：房主可点（撤销两步）
    //   在线模式：本方执子（任何回合都允许，"离手后立即可悔"）
    var canUndo = false;
    if (isPlaying && state.history && state.history.length > 0 && myUndoRemain > 0 && state.gameMode !== 'puzzle') {
      if (matchMode === 'ai') {
        canUndo = isHost;
      } else {
        canUndo = mySide !== null;
      }
    }
    var showUndo = false;
    if (isPlaying && state.gameMode !== 'puzzle') {
      if (matchMode === 'ai') showUndo = isHost;
      else showUndo = mySide !== null;
    }
    if (btnUndo) {
      btnUndo.style.display = showUndo ? '' : 'none';
      btnUndo.disabled = !canUndo;
    }

    // 再来一局（btnRematch）：finished 阶段可见
    //   - AI 模式：仅房主可见
    //   - 在线模式：双方都可见
    var showRematch = false;
    if (isFinished) {
      if (matchMode === 'ai') {
        showRematch = isHost;
      } else {
        showRematch = mySide !== null;
      }
    }
    if (btnRematch) {
      btnRematch.style.display = showRematch ? '' : 'none';
      btnRematch.disabled = false;
    }

    // 重开（btnReplay）：playing 阶段可发起（任一方，仅在线模式；AI 模式走 restart 走重开）
    var showReplay = false;
    if (isPlaying && !state.finished) {
      if (matchMode === 'ai') {
        showReplay = isHost;
      } else {
        showReplay = mySide !== null;
      }
    }
    if (btnReplay) {
      btnReplay.style.display = showReplay ? '' : 'none';
      btnReplay.disabled = false;
    }

    // 返回选择：任何阶段（人机：房主；在线：房主）
    if (btnBack) {
      btnBack.style.display = isHost ? '' : 'none';
      btnBack.disabled = !isHost;
    }
  }

  function renderTurnIndicator() {
    if (state.phase !== 'playing') {
      turnIndicator.classList.add('hide');
      return;
    }
    turnIndicator.classList.remove('hide');
    var baseText = (state.turn === 'r' ? '红方' : '黑方') + ' 走子';
    if (state.lastCheck) baseText += ' · 将军';
    if (gameMode === 'puzzle') {
      // 残局模式：玩家执红，只在轮到红方时高亮
      turnIndicator.textContent = (state.turn === 'r') ? '红方 走子' : baseText;
    } else if (matchMode === 'ai') {
      // AI 模式：轮到 AI 时提示"AI 思考中…"，轮到玩家时显示常规红/黑走子
      if (state.turn !== hostSide) {
        turnIndicator.textContent = 'AI 思考中…';
      } else {
        turnIndicator.textContent = baseText;
      }
    } else if (matchMode === 'online') {
      // 在线模式：非本方回合显示"等待对方…"
      if (mySide === null || state.turn !== mySide) {
        turnIndicator.textContent = '等待对方…';
      } else {
        turnIndicator.textContent = baseText;
      }
    } else {
      turnIndicator.textContent = baseText;
    }
  }

  function renderWinBanner() {
    if (state.phase === 'finished') {
      var winnerText = state.winner === 'r' ? '红方胜' : (state.winner === 'b' ? '黑方胜' : '和棋');
      winText.textContent = winnerText;
      var reasonMap = {
        checkmate: '将死',
        stalemate: '困毙',
        resign: '认输',
        fifty: '60 回合无吃子',
        puzzleSolved: '残局完成',
        puzzleFail: '超过限步',
        repetition: '重复局面',
      };
      winSub.textContent = reasonMap[state.reason] || '';
      winBanner.classList.add('show');
    } else {
      winBanner.classList.remove('show');
    }
  }

  // ----- 模式面板交互 -----
  gameGroup.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.game) return;
    if (!isHost) return;
    gameMode = t.dataset.game;
    if (gameMode === 'puzzle') {
      matchMode = 'ai';
      hostSide = 'r';
      partiAction('setGameMode', { gameMode: 'puzzle' });
    } else {
      // 切出残局时，恢复对战模式默认为人机，执方也恢复
      matchMode = 'ai';
      hostSide = 'r';
      aiLevel = 1;
      partiAction('setGameMode', { gameMode: gameMode });
      partiAction('setMatchMode', { matchMode: 'ai' });
      partiAction('setAiLevel', { level: 1 });
      partiAction('setHostSide', { side: 'r' });
    }
    renderAll();
  });
  modeGroup.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.mode) return;
    if (!isHost) return;
    if (gameMode === 'puzzle') return; // 残局模式锁定"人机对战"
    matchMode = t.dataset.mode;
    partiAction('setMatchMode', { matchMode: matchMode });
    renderAll();
  });
  aiLevelGroup.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.dataset || t.dataset.level === undefined) return;
    if (!isHost) return;
    aiLevel = Number(t.dataset.level);
    partiAction('setAiLevel', { level: aiLevel });
    renderAll();
  });
  sideGroup.addEventListener('click', function (e) {
    var t = e.target;
    if (!t.dataset || !t.dataset.side) return;
    if (!isHost) return; // 只有房主能选执方
    hostSide = t.dataset.side;
    partiAction('setHostSide', { side: hostSide });
    renderAll();
  });
  startBtn.addEventListener('click', function () {
    if (!isHost) return;
    if (gameMode === 'puzzle') {
      partiAction('startAI', { gameMode: 'puzzle', hostSide: 'r', puzzleId: puzzleId });
    } else if (matchMode === 'ai') {
      partiAction('startAI', { gameMode: gameMode, hostSide: hostSide });
    } else {
      if (!state.redPlayer || !state.blackPlayer) { showToast('等待对方加入…'); return; }
      if (!state.redReady || !state.blackReady) { showToast('等待所有玩家准备就绪…'); return; }
      partiAction('startGameOnline', {});
    }
  });
  onlineReadyBtn.addEventListener('click', function () {
    if (!myPlayerId) return;
    partiAction('toggleReady', {});
  });
  onlineSlotRed.addEventListener('click', function () {
    if (matchMode !== 'online') return;
    if (state.pendingRequest) return;
    var meRed = myPlayerId && state.redPlayer === myPlayerId;
    if (meRed) {
      // 自己已选红：未准备时再点一下退出执子方；已准备时只提示
      if (state.redReady) {
        showToast('已是当前执子方');
      } else {
        partiAction('leaveSide', {});
      }
      return;
    }
    if (state.redPlayer && !meRed) {
      showToast('红方已被对方选择');
      return;
    }
    // 自己当前是黑方（换边）：先 leaveSide
    var meBlack = myPlayerId && state.blackPlayer === myPlayerId;
    if (meBlack) partiAction('leaveSide', {});
    partiAction('chooseSide', { side: 'r' });
  });
  onlineSlotBlack.addEventListener('click', function () {
    if (matchMode !== 'online') return;
    if (state.pendingRequest) return;
    var meBlack = myPlayerId && state.blackPlayer === myPlayerId;
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
    var meRed = myPlayerId && state.redPlayer === myPlayerId;
    if (meRed) partiAction('leaveSide', {});
    partiAction('chooseSide', { side: 'b' });
  });

  // 认输：调用 worker，由弹窗或直接认输
  btnResign.addEventListener('click', function () {
    if (state.finished) return;
    if (state.phase !== 'playing') return;
    if (state.gameMode === 'puzzle') return; // 残局模式不支持认输
    if (state.pendingRequest) return;
    if (matchMode === 'ai' && !isHost) return;
    if (matchMode === 'online' && mySide === null) return;
    partiAction('resign', {});
  });

  // 悔棋：人机直接撤销两步；在线走弹窗
  if (btnUndo) btnUndo.addEventListener('click', function () {
    if (state.finished) return;
    if (state.phase !== 'playing') return;
    if (state.gameMode === 'puzzle') return;
    if (state.pendingRequest) return;
    if (matchMode === 'ai' && !isHost) return;
    // 在线模式：任何回合都能悔（"离手后立即可悔"），只要本方执子 + 剩余次数 > 0
    if (matchMode === 'online' && mySide === null) return;
    var mySideForUndo = matchMode === 'ai' ? hostSide : mySide;
    var remain = (state.undoCount && state.undoCount[mySideForUndo]) || 0;
    if (remain < 1) return;
    partiAction('undo', {});
  });

  // 再来一局（finished 阶段）：人机模式房主直接重开；在线模式双方都走 restart 弹窗
  btnRematch.addEventListener('click', function () {
    if (state.phase !== 'finished') return;
    if (state.pendingRequest) return;
    if (matchMode === 'ai') {
      if (!isHost) return;
      partiAction('restart', {});
    } else {
      if (mySide === null) return;
      partiAction('restart', {});
    }
  });

  // 重开（playing 阶段）：人机模式房主直接重开；在线模式走 rematch 弹窗
  btnReplay.addEventListener('click', function () {
    if (state.phase !== 'playing' || state.finished) return;
    if (state.pendingRequest) return;
    if (matchMode === 'ai') {
      if (!isHost) return;
      partiAction('restart', {});
    } else {
      if (mySide === null) return;
      partiAction('rematch', {});
    }
  });

  // 返回选择：人机直接返回 lobby；在线走弹窗
  btnBack.addEventListener('click', function () {
    if (!isHost) return;
    if (state.pendingRequest) return;
    partiAction('backToMenu', {});
  });

  // 弹窗按钮
  if (reqAcceptBtn) reqAcceptBtn.addEventListener('click', function () {
    requestBanner.classList.remove('show');
    stopCountdown();
    partiAction('respondRequest', { accept: true });
  });
  if (reqRejectBtn) reqRejectBtn.addEventListener('click', function () {
    requestBanner.classList.remove('show');
    stopCountdown();
    partiAction('respondRequest', { accept: false });
  });
  if (reqAckBtn) reqAckBtn.addEventListener('click', function () {
    requestBanner.classList.remove('show');
    stopCountdown();
  });

  // ----- 棋盘点击 -----
  function onBoardClick(e) {
    if (!state) return;
    if (state.phase !== 'playing') return;
    if (state.finished) return;
    // 是否轮到我
    var myTurn = false;
    if (matchMode === 'ai') {
      myTurn = isHost && state.turn === hostSide;
    } else {
      myTurn = mySide !== null && state.turn === mySide;
    }
    if (!myTurn) return;

    var rect = canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var pos = hitTest(mx, my);
    if (!pos) {
      selected = null;
      legalTargets = [];
      draw();
      return;
    }
    var c = pos[0], r = pos[1];
    var p = state.board[c] && state.board[c][r];
    var side = pieceSideOf(p);

    // 选中阶段
    if (!selected) {
      if (p && p !== '.' && side === state.turn) {
        selected = { from: [c, r] };
        legalTargets = computeLegalTargets([c, r], p, side);
        draw();
      } else if (gameMode === 'banzhu' && p === 'x' && canMoveDark([c, r], state.turn)) {
        // 揭棋：暗子按位置可走 → 选中
        selected = { from: [c, r] };
        legalTargets = computeLegalTargets([c, r], 'x', state.turn);
        draw();
      } else if (gameMode === 'banzhu' && p === 'x' && state.enableFlip && canFlip([c, r], state.turn)) {
        // 走法按位置不成立但可以翻——给一个翻子提示
        if (confirm('该暗子按位置无法走，是否翻子？')) {
          partiAction('flip', { pos: [c, r] });
        }
      }
      return;
    }

    // 已选中：点击同格取消；点击己方明/暗子切换选择；点击己方暗子可翻则翻子；点击目标格走子
    if (c === selected.from[0] && r === selected.from[1]) {
      selected = null;
      legalTargets = [];
      draw();
      return;
    }
    if (p && p !== '.' && side === state.turn) {
      // 己方明子：直接切换选择
      selected = { from: [c, r] };
      legalTargets = computeLegalTargets([c, r], p, side);
      draw();
      return;
    }
    if (gameMode === 'banzhu' && p === 'x' && canFlip([c, r], state.turn)) {
      // 以下仅处理己方暗子；对方暗子直接走到"落子"分支（可被吃）
      if (canMoveDark([c, r], state.turn)) {
        // 己方暗子按位置可走：切换选择
        selected = { from: [c, r] };
        legalTargets = computeLegalTargets([c, r], 'x', state.turn);
        draw();
        return;
      }
      if (state.enableFlip) {
        // 己方暗子按位置不可走但可翻：弹 confirm
        if (confirm('该暗子按位置无法走，是否翻子？')) {
          partiAction('flip', { pos: [c, r] });
        }
      }
      return;
    }
    // 落子
    var ok = legalTargets.some(function (t) { return t[0] === c && t[1] === r; });
    if (!ok) return;
    partiAction('move', { from: [selected.from[0], selected.from[1]], to: [c, r] });
    selected = null;
    legalTargets = [];
  }

  function pieceSideOf(p) {
    if (!p || p === '.' || p === 'x') return null;
    return (p >= 'A' && p <= 'Z') ? 'r' : 'b';
  }
  function canMoveDark(pos, side) {
    if (gameMode !== 'banzhu') return false;
    var p = state.board[pos[0]][pos[1]];
    if (p !== 'x') return false;
    var owner = state.banzhuReal[pos[0]][pos[1]];
    if (!owner) return false;
    var myOwner = (side === 'r' && owner >= 'A' && owner <= 'Z') ||
                  (side === 'b' && owner >= 'a' && owner <= 'z');
    if (!myOwner) return false;
    return true;
  }
  function canFlip(pos, side) {
    if (gameMode !== 'banzhu') return false;
    var p = state.board[pos[0]][pos[1]];
    if (p !== 'x') return false;
    var owner = state.banzhuReal[pos[0]][pos[1]];
    if (!owner) return false;
    return (side === 'r' && owner >= 'A' && owner <= 'Z') ||
           (side === 'b' && owner >= 'a' && owner <= 'z');
  }

  // 计算选中棋子的合法走子目标（本地预览用，最终合法性以 worker 为准）
  function computeLegalTargets(from, p, side) {
    var raw = computeLegalTargetsRaw(from, p, side);
    if (gameMode !== 'banzhu') return raw;
    // 揭棋：己方暗子不可作为吃子目标，对方暗子可直接吃
    return raw.filter(function (t) {
      return !(state.board[t[0]][t[1]] === 'x' && canFlip([t[0], t[1]], side));
    });
  }
  function computeLegalTargetsRaw(from, p, side) {
    var targets = [];
    var b = state.board;
    var c = from[0], r = from[1];
    // 揭棋暗子：从 banzhu.ts 的暗子按位置走法
    if (gameMode === 'banzhu' && p === 'x') {
      // 我们复用 board.ts 的 tryMove 思路：暗子按位置确定身份后调用 tryMove
      // 简化：直接试走所有 9x10 格 + 不送将
      var lower = darkRoleByCol(c, r, side);
      if (lower) {
        var fake = (side === 'r' ? lower.toUpperCase() : lower.toLowerCase());
        var nb = b.map(function (col) { return col.slice(); });
        nb[c][r] = fake;
        for (var tc = 0; tc < 9; tc++) {
          for (var tr = 0; tr < 10; tr++) {
            if (tc === c && tr === r) continue;
            if (tryMoveLocal(nb, [c, r], [tc, tr])) {
              // 不送将
              var nb2 = simulateLocal(nb, [c, r], [tc, tr]);
              if (!isInCheckLocal(nb2, side)) targets.push([tc, tr]);
            }
          }
        }
      }
      return targets;
    }
    // 经典 + 揭棋明子
    var isFlying = (gameMode === 'banzhu') && (p === 'A' || p === 'a' || p === 'B' || p === 'b');
    for (var tc2 = 0; tc2 < 9; tc2++) {
      for (var tr2 = 0; tr2 < 10; tr2++) {
        if (tc2 === c && tr2 === r) continue;
        if (isFlying) {
          if (tryFlyingMoveLocal(b, [c, r], [tc2, tr2], p)) {
            var nb3 = simulateLocal(b, [c, r], [tc2, tr2]);
            if (!isInCheckLocal(nb3, side)) targets.push([tc2, tr2]);
          }
        } else if (tryMoveLocal(b, [c, r], [tc2, tr2])) {
          var nb4 = simulateLocal(b, [c, r], [tc2, tr2]);
          if (!isInCheckLocal(nb4, side)) targets.push([tc2, tr2]);
        }
      }
    }
    return targets;
  }

  // ---- 本地判定（与 worker board.ts 等价） ----
  function inBoardLocal(c, r) { return c >= 0 && c < 9 && r >= 0 && r < 10; }
  function pieceSideLocal(p) {
    if (!p || p === '.' || p === 'x') return null;
    return (p >= 'A' && p <= 'Z') ? 'r' : 'b';
  }
  function inPalaceLocal(side, c, r) {
    if (c < 3 || c > 5) return false;
    if (side === 'r') return r >= 7 && r <= 9;
    return r >= 0 && r <= 2;
  }
  function inOwnSideLocal(side, r) {
    return side === 'r' ? r >= 5 : r <= 4;
  }
  function countBetweenLocal(b, c1, r1, c2, r2) {
    if (c1 === c2) {
      var lo = Math.min(r1, r2), hi = Math.max(r1, r2);
      var n = 0;
      for (var r = lo + 1; r < hi; r++) if (b[c1][r] !== '.') n++;
      return n;
    } else if (r1 === r2) {
      var lo2 = Math.min(c1, c2), hi2 = Math.max(c1, c2);
      var n2 = 0;
      for (var c = lo2 + 1; c < hi2; c++) if (b[c][r1] !== '.') n2++;
      return n2;
    }
    return -1;
  }
  function tryMoveLocal(b, from, to) {
    var fc = from[0], fr = from[1], tc = to[0], tr = to[1];
    if (!inBoardLocal(fc, fr) || !inBoardLocal(tc, tr)) return false;
    var p = b[fc][fr];
    if (p === '.' || p === 'x') return false;
    var side = pieceSideLocal(p);
    if (!side) return false;
    var target = b[tc][tr];
    if (target !== '.' && pieceSideLocal(target) === side) return false;
    if (fc === tc && fr === tr) return false;
    var dc = tc - fc, dr = tr - fr;
    var adx = Math.abs(dc), ady = Math.abs(dr);
    var lower = p.toLowerCase();
    if (lower === 'k') {
      if (!inPalaceLocal(side, tc, tr)) return false;
      if (adx + ady !== 1) return false;
      return true;
    }
    if (lower === 'a') {
      if (!inPalaceLocal(side, tc, tr)) return false;
      if (adx !== 1 || ady !== 1) return false;
      return true;
    }
    if (lower === 'b') {
      if (adx !== 2 || ady !== 2) return false;
      var cc = (fc + tc) >> 1, cr = (fr + tr) >> 1;
      if (b[cc][cr] !== '.') return false;
      if (side === 'r' && tr < 5) return false;
      if (side === 'b' && tr > 4) return false;
      return true;
    }
    if (lower === 'n') {
      if (!((adx === 1 && ady === 2) || (adx === 2 && ady === 1))) return false;
      var lx, ly;
      if (adx === 2) { lx = fc + (dc > 0 ? 1 : -1); ly = fr; }
      else { lx = fc; ly = fr + (dr > 0 ? 1 : -1); }
      if (b[lx][ly] !== '.') return false;
      return true;
    }
    if (lower === 'r') {
      if (fc !== tc && fr !== tr) return false;
      if (countBetweenLocal(b, fc, fr, tc, tr) !== 0) return false;
      return true;
    }
    if (lower === 'c') {
      if (fc !== tc && fr !== tr) return false;
      var n = countBetweenLocal(b, fc, fr, tc, tr);
      if (target === '.') return n === 0;
      return n === 1;
    }
    if (lower === 'p') {
      var forward = side === 'r' ? -1 : 1;
      if (inOwnSideLocal(side, fr)) {
        return dc === 0 && dr === forward;
      } else {
        if (dc === 0 && dr === forward) return true;
        if (dr === 0 && adx === 1) return true;
        return false;
      }
    }
    return false;
  }
  function tryFlyingMoveLocal(b, from, to, piece) {
    // 揭棋下士象可过河
    var fc = from[0], fr = from[1], tc = to[0], tr = to[1];
    if (!inBoardLocal(fc, fr) || !inBoardLocal(tc, tr)) return false;
    var p = piece;
    var side = pieceSideLocal(p);
    if (!side) return false;
    var target = b[tc][tr];
    if (target !== '.' && pieceSideLocal(target) === side) return false;
    if (fc === tc && fr === tr) return false;
    var adx = Math.abs(tc - fc), ady = Math.abs(tr - fr);
    var lower = p.toLowerCase();
    if (lower === 'a') {
      if (adx !== 1 || ady !== 1) return false;
      if (tc < 3 || tc > 5) return false;
      if (side === 'r' && (tr < 7 || tr > 9)) return false;
      if (side === 'b' && (tr < 0 || tr > 2)) return false;
      return true;
    }
    if (lower === 'b') {
      if (adx !== 2 || ady !== 2) return false;
      var cc = (fc + tc) >> 1, cr = (fr + tr) >> 1;
      if (b[cc][cr] !== '.') return false;
      return true;
    }
    return tryMoveLocal(b, from, to);
  }
  function simulateLocal(b, from, to) {
    var nb = b.map(function (col) { return col.slice(); });
    nb[to[0]][to[1]] = nb[from[0]][from[1]];
    nb[from[0]][from[1]] = '.';
    return nb;
  }
  function findKingLocal(b, side) {
    var t = side === 'r' ? 'K' : 'k';
    for (var c = 0; c < 9; c++) for (var r = 0; r < 10; r++) if (b[c][r] === t) return [c, r];
    return null;
  }
  function isInCheckLocal(b, side) {
    var kp = findKingLocal(b, side);
    if (!kp) return true;
    var enemy = side === 'r' ? 'b' : 'r';
    for (var c = 0; c < 9; c++) for (var r = 0; r < 10; r++) {
      var p = b[c][r];
      if (p === '.' || p === 'x') continue;
      if (pieceSideLocal(p) !== enemy) continue;
      if (tryMoveLocal(b, [c, r], kp)) return true;
    }
    var other = findKingLocal(b, enemy);
    if (other && other[0] === kp[0]) {
      var lo = Math.min(kp[1], other[1]), hi = Math.max(kp[1], other[1]);
      var blocked = false;
      for (var rr = lo + 1; rr < hi; rr++) if (b[kp[0]][rr] !== '.') { blocked = true; break; }
      if (!blocked) return true;
    }
    return false;
  }
  function darkRoleByCol(c, r, side) {
    if (side === 'r') {
      if (r === 9) {
        if (c === 0 || c === 8) return 'r';
        if (c === 1 || c === 7) return 'n';
        if (c === 2 || c === 6) return 'b';
        if (c === 3 || c === 5) return 'a';
        if (c === 4) return null;
      } else if (r === 7) {
        if (c === 1 || c === 7) return 'c';
      } else if (r === 6) {
        if (c === 0 || c === 2 || c === 4 || c === 6 || c === 8) return 'p';
      }
    } else {
      if (r === 0) {
        if (c === 0 || c === 8) return 'r';
        if (c === 1 || c === 7) return 'n';
        if (c === 2 || c === 6) return 'b';
        if (c === 3 || c === 5) return 'a';
        if (c === 4) return null;
      } else if (r === 2) {
        if (c === 1 || c === 7) return 'c';
      } else if (r === 3) {
        if (c === 0 || c === 2 || c === 4 || c === 6 || c === 8) return 'p';
      }
    }
    return null;
  }

  if (canvas) {
    canvas.addEventListener('click', onBoardClick);
    window.addEventListener('resize', fitCanvas);
  }

  // 启动
  function start() {
    renderAll();
    if (hasParti()) {
      myPlayerId = parti.playerId;
      subscription = parti.onState(applyState);
      const existing = parti.getState && parti.getState();
      if (existing) applyState(existing);
      partiAction('joinOnline', {});
      // 监听 hostSide 切换（观战者跟随）
      if (parti.onMessage) {
        parti.onMessage(function (msg) {
          if (!msg) return;
          if (msg.type === 'hostSideChanged') {
            hostSide = msg.hostSide;
            mySide = isHost ? hostSide : (hostSide === 'r' ? 'b' : 'r');
            flipped = (mySide === 'b' && state.phase === 'playing');
            // 侧边栏 AI/房主分配由 applyState 的 renderAll 统一更新
          }
        });
      }
    }
    fitCanvas();
    setTimeout(fitCanvas, 100);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
  partiLog && partiLog('ready');
})();

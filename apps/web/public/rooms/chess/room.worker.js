/* ==================================================================
   弈合 · Room Worker
   Parti Host-Authoritative 逻辑层
   所有游戏规则、棋盘状态、胜负判定均在 Worker 内完成。
   客户端仅通过 parti.action() 提交意图，通过 parti.onState() 读取权威状态。
   ================================================================== */

import { defineRoom } from '@parti/worker-sdk';

const SIZE_GOMOKU = 15;
const SIZE_GO = 19;
const EMPTY = 0, BLACK = 1, WHITE = 2;

/* ---------- 棋盘工具 ---------- */
function createBoard(size) {
    const b = [];
    for (let r = 0; r < size; r++) {
        b.push([]);
        for (let c = 0; c < size; c++) b[r].push(EMPTY);
    }
    return b;
}

function cloneBoard(b) {
    return b.map(row => row.slice());
}

/* ---------- 五子棋胜负检测（Worker 权威） ---------- */
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

/* ---------- 围棋工具（Worker 权威） ---------- */
function getGroup(board, r, c) {
    const color = board[r][c];
    if (color === EMPTY) return null;
    const visited = new Set();
    const group = [];
    let liberties = 0;
    const queue = [[r, c]];
    visited.add(r + ',' + c);
    while (queue.length) {
        const [pr, pc] = queue.shift();
        group.push([pr, pc]);
        const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];
        for (const [dr, dc] of dirs) {
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
 * 围棋落子并处理提子。
 * @returns {null|{captured: Array}} null 表示非法（已有子或自杀）
 */
function goPlaceStone(board, r, c, color) {
    if (r < 0 || r >= board.length || c < 0 || c >= board.length) return null;
    if (board[r][c] !== EMPTY) return null;

    board[r][c] = color;
    const opponent = color === BLACK ? WHITE : BLACK;
    const captured = [];
    const dirs = [[0, 1], [0, -1], [1, 0], [-1, 0]];

    // 检查相邻对方棋组，无气则提
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

    // 检查自身气（防止自杀）
    const self = getGroup(board, r, c);
    if (self && self.liberties === 0) {
        board[r][c] = EMPTY;
        return null;
    }

    return { captured };
}

/** 围棋数目（简易中国规则） */
function goScore(board) {
    const n = board.length;
    let black = 0, white = 0;
    const visited = new Set();

    for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
            if (board[r][c] === BLACK) black++;
            else if (board[r][c] === WHITE) white++;
            else if (!visited.has(r + ',' + c)) {
                const region = [];
                const queue = [[r, c]];
                visited.add(r + ',' + c);
                const borders = new Set();
                while (queue.length) {
                    const [pr, pc] = queue.shift();
                    region.push([pr, pc]);
                    for (const [dr, dc] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
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

/* ==================================================================
   defineRoom 定义
   ================================================================== */
export default defineRoom({

    meta: {
        name: '弈合 · 五子棋与围棋',
        minPlayers: 2,
        maxPlayers: 2
    },

    initialState() {
        return {
            // 游戏配置
            gameType: 'gomoku',        // 'gomoku' | 'go'
            boardSize: SIZE_GOMOKU,

            // 棋盘
            board: createBoard(SIZE_GOMOKU),
            turn: BLACK,
            finished: false,
            winner: 0,                  // 0=未结束/平局, 1=黑胜, 2=白胜

            // 围棋专用
            passes: 0,                  // 连续 pass 计数
            capturedB: 0,               // 黑方提子数
            capturedW: 0,               // 白方提子数

            // 阶段（顶层状态机）
            // 'lobby' | 'playing' | 'end_confirm' | 'finished'
            phase: 'lobby',
            // 围棋 end_confirm 阶段：双方确认死棋状态
            confirmDeadBy: { black: false, white: false },

            // 辅助
            lastMove: null,             // {r,c}
            winLine: null,              // 五子棋胜利连线
            winReason: '',

            // 在线联机角色
            blackPlayer: null,          // playerId
            whitePlayer: null,          // playerId
            blackReady: false,
            whiteReady: false,
            hostId: null,               // 房主 playerId（第一个加入者）

            // AI 模式标识
            mode: 'online',             // 'online' | 'ai'
            aiLevel: 1,
            hostSide: 'black',         // AI 模式：房主执子方（'black'|'white'）

            // 玩家花名册：{ [playerId]: { name } }
            players: {},

            // 会话内统计（不持久化，刷新归零）
            stats: {
                blackWins: 0, blackLosses: 0, blackDraws: 0,
                whiteWins: 0, whiteLosses: 0, whiteDraws: 0
            },

            // 待确认请求 { type, from, createdAt }
            // 合法 type: 'undo' | 'restart' | 'resign'(已废弃，走直接结算)
            pendingRequest: null,

            // 最近一次被回应的请求结果（仅给申请方看的临时结果）
            lastRequestResult: null,

            // 主动退出标记（区分主动退出与被动掉线）
            // { [playerId]: true }
            activeExit: {},

            // 落子历史 { r, c }[]（用于悔棋）

            // 在线模式悔棋：每方独立计数（黑/白各 2 次）
            // AI 模式仅黑方（房主）使用
            undoCount: { black: 2, white: 2 },

            // 超时配置
            requestTimeoutMs: 15_000,      // 15 秒请求超时自动视为拒绝
            gameTimeoutMs: 15 * 60_000,    // 15 分钟对局超时
            lastActivityAt: 0,             // 任意动作成功执行时更新
            gameStartedAt: 0,              // 本局对局开始时更新
        };
    },

    /* ---------- 定时器：请求超时 + 对局超时 + 重连宽限期 ---------- */
    onCreate(ctx) {
        // 每秒轮询一次，超时处理
        ctx.setTimer('chess-timeouts', 1000, () => tickTimeouts(ctx));
    },

    /* ---------- 玩家加入 ---------- */
    onJoin(ctx, player) {
        const st = ctx.state;

        // 记录玩家信息
        st.players[player.id] = { name: player.name || '玩家' };

        // 第一个加入者成为房主
        if (!st.hostId) st.hostId = player.id;

        // 不再自动分配执子方。玩家通过 chooseSide 主动选择。
        // 同步当前已选位置（让新进玩家看到对局状态）
        ctx.broadcast('roles', {
            blackPlayer: st.blackPlayer,
            whitePlayer: st.whitePlayer,
            hostId: st.hostId
        });
    },

    /* ---------- 玩家离开 ---------- *
     * 不区分主动退出与被动掉线：两者都判离开方负。
     *   - 主动退出：客户端先发 exitRoom，标记 activeExit=true，本回调用"对方主动退出"文案
     *   - 被动掉线：Parti HostRuntime 等 30s grace 后触发本回调（默认 graceMs=30000）
     *     已彻底离线则用"对方离开"文案
     *   - lobby / finished：只清理角色和花名册，不影响对局
     */
    onLeave(ctx, player) {
        const st = ctx.state;

        // 主动退出标记清理（backToMenu 是返回选择，不算判负）
        const activeFlag = st.activeExit[player.id];
        const isBackToMenu = activeFlag === 'backToMenu';
        const isActiveExit = !!activeFlag && !isBackToMenu;
        delete st.activeExit[player.id];

        // 释放角色与花名册
        if (st.blackPlayer === player.id) {
            st.blackPlayer = null;
            st.blackReady = false;
        }
        if (st.whitePlayer === player.id) {
            st.whitePlayer = null;
            st.whiteReady = false;
        }
        delete st.players[player.id];

        // 对局进行中：离开方判负，对手胜（backToMenu 是返回选择，不判负）
        if (!st.finished && !isBackToMenu && (st.phase === 'playing' || st.phase === 'end_confirm')) {
            const loser = (player.id === st.blackPlayer) ? BLACK
                : (player.id === st.whitePlayer) ? WHITE : 0;
            if (loser) {
                const winner = loser === BLACK ? WHITE : BLACK;
                finishGame(ctx, winner, isActiveExit ? '对方主动退出' : '对方离开');
            }
        }

        // lobby / finished / 未分配角色：仅切回 lobby
        if ((!st.blackPlayer || !st.whitePlayer) && st.phase !== 'finished') {
            st.phase = 'lobby';
        }
    },

    /* ---------- 动作处理 ---------- */
    actions: {

        /**
         * 玩家加入在线对局：只记录玩家/分配角色，不再写 gameType（由 setGameType 统一）。
         */
        joinOnline(ctx, { player }) {
            // 兼容旧协议：仅做幂等兜底。新的执子方分配由 chooseSide 完成。
            // 这里什么都不做（onJoin 已经把玩家加入花名册）。
        },

        /**
         * 玩家选择执子方。
         * payload: { side: 'black' | 'white' }
         * - 若玩家已占另一方，先释放原位
         * - 若目标方已被他人占，占位失败（广播 state 让客户端知晓）
         */
        chooseSide(ctx, { player, payload }) {
            const st = ctx.state;
            const side = payload && payload.side;
            if (side !== 'black' && side !== 'white') return;
            // 释放原位
            if (st.blackPlayer === player.id) st.blackPlayer = null;
            if (st.whitePlayer === player.id) st.whitePlayer = null;
            // 占用目标
            if (side === 'black') {
                if (!st.blackPlayer) st.blackPlayer = player.id;
            } else {
                if (!st.whitePlayer) st.whitePlayer = player.id;
            }
            // 同步给所有玩家
            ctx.broadcast('roles', {
                blackPlayer: st.blackPlayer,
                whitePlayer: st.whitePlayer,
                hostId: st.hostId
            });
        },

        /**
         * 玩家离开自己执子方（用于在线 lobby 阶段"换边"）。
         * payload: 无
         */
        leaveSide(ctx, { player }) {
            const st = ctx.state;
            let wasBlack = st.blackPlayer === player.id;
            let wasWhite = st.whitePlayer === player.id;
            if (wasBlack) st.blackPlayer = null;
            if (wasWhite) st.whitePlayer = null;
            if (wasBlack) st.blackReady = false;
            if (wasWhite) st.whiteReady = false;
            if (wasBlack || wasWhite) {
                ctx.broadcast('roles', {
                    blackPlayer: st.blackPlayer,
                    whitePlayer: st.whitePlayer,
                    hostId: st.hostId
                });
            }
        },

        /**
         * 房主切换棋种（同步给所有玩家）。
         * payload: { gameType: 'gomoku' | 'go' }
         */
        setGameType(ctx, { player, payload }) {
            const st = ctx.state;
            if (player.id !== st.hostId) return; // 仅房主
            if (st.phase === 'playing' || st.phase === 'end_confirm' || st.phase === 'finished') return;

            const gt = payload && payload.gameType === 'go' ? 'go' : 'gomoku';
            st.gameType = gt;
            st.boardSize = gt === 'go' ? SIZE_GO : SIZE_GOMOKU;

            ctx.broadcast('gameTypeChanged', { gameType: gt });
        },

        /**
         * 房主设置 AI 难度等级。
         * payload: { level: 0|1|2|3 }
         */
        setAiLevel(ctx, { player, payload }) {
            const st = ctx.state;
            if (player.id !== st.hostId) return;
            const level = parseInt(payload && payload.level);
            if (isNaN(level) || level < 0 || level > 3) return;
            st.aiLevel = level;
            ctx.broadcast('aiLevelChanged', { level: level });
        },

        /**
         * 房主切换执子方（仅 AI 模式 lobby 阶段有效）。
         * payload: { hostSide: 'black' | 'white' }
         */
        setHostSide(ctx, { player, payload }) {
            const st = ctx.state;
            if (player.id !== st.hostId) return;
            if (st.phase !== 'lobby') return; // 对局开始后禁止改
            const side = payload && payload.side;
            if (side !== 'black' && side !== 'white') return;
            st.hostSide = side;
            ctx.broadcast('hostSideChanged', { hostSide: side });
        },

        /**
         * 房主切换对战模式（人机/在线）。
         * payload: { mode: 'ai' | 'online' }
         */
        setMode(ctx, { player, payload }) {
            const st = ctx.state;
            if (player.id !== st.hostId) return;
            if (st.phase === 'playing' || st.phase === 'end_confirm' || st.phase === 'finished') return;
            const m = payload && payload.mode === 'ai' ? 'ai' : 'online';
            st.mode = m;
            if (payload && payload.gameType) {
                const gt = payload.gameType === 'go' ? 'go' : 'gomoku';
                st.gameType = gt;
                st.boardSize = gt === 'go' ? SIZE_GO : SIZE_GOMOKU;
            }
            if (payload && payload.aiLevel !== undefined) {
                st.aiLevel = parseInt(payload.aiLevel);
            }
            ctx.broadcast('modeChanged', { mode: m, gameType: st.gameType, aiLevel: st.aiLevel });
        },

        /**
         * 玩家切换准备状态。
         */
        toggleReady(ctx, { player }) {
            const st = ctx.state;
            if (st.phase === 'playing' || st.phase === 'end_confirm') return;
            if (player.id === st.blackPlayer) st.blackReady = !st.blackReady;
            else if (player.id === st.whitePlayer) st.whiteReady = !st.whiteReady;
            // 同步顶层 phase（双方都准备好进入 'ready'，否则回到 'lobby'）
            // 注意：'ready' 仅用于内部表达阶段切换前的待开状态，对外仍暴露为 lobby/startGameOnline 直接跳 playing
            if (!st.blackReady || !st.whiteReady) st.phase = 'lobby';
        },

        /**
         * 房主（黑方）开始对局。需要双方都已准备。
         */
        startGameOnline(ctx, { player }) {
            const st = ctx.state;
            if (player.id !== st.hostId) return; // 仅房主
            if (!st.blackReady || !st.whiteReady) return; // 双方需都准备
            if (!st.blackPlayer || !st.whitePlayer) return;

            startMatch(ctx);
        },

        /**
         * 房主开始AI对局：仅房主(黑方)对AI，玩家端进入观战。
         * payload: { gameType }
         */
        /**
         * 房主开始AI对局：仅房主对AI，其他玩家作为观战者。
         * payload: { gameType, hostSide: 'black'|'white' }
         *   hostSide 表示房主执哪方，未传则默认黑方（兼容旧调用）。
         */
        startAI(ctx, { player, payload }) {
            const st = ctx.state;
            if (player.id !== st.hostId) return; // 仅房主

            const gt = payload && payload.gameType === 'go' ? 'go' : 'gomoku';
            st.gameType = gt;
            st.boardSize = gt === 'go' ? SIZE_GO : SIZE_GOMOKU;
            // 五子棋/围棋均为黑先白后（与执子方无关）
            startMatch(ctx, BLACK);
            ctx.broadcast('gameStarted', { gameType: gt, boardSize: st.boardSize, mode: 'ai', hostSide: st.hostSide });
        },

        /**
         * 落子（五子棋和围棋共用）。
         * payload: { r, c }
         */
        place(ctx, { player, payload }) {
            const st = ctx.state;

            // 安全校验
            if (st.finished) return;
            if (st.phase !== 'playing') return;  // end_confirm 阶段禁止落子
            if (!payload || typeof payload.r !== 'number' || typeof payload.c !== 'number') return;

            // AI 模式下：worker 仅更新 activity，棋盘改动由本地房主完成并通过 place 上报
            // 这里仍然校验坐标合法性以避免非法上报，但不再据此改棋盘
            const r = Math.floor(payload.r), c = Math.floor(payload.c);
            if (r < 0 || r >= st.boardSize || c < 0 || c >= st.boardSize) return;

            if (st.mode === 'ai') {
                // AI 模式：客户端是棋盘的权威（玩家落子 + AI 落子都由本地 localPlace 推进）
                // 客户端把每一步（黑/白）通过 place 上报给 worker，worker 仅同步状态用于观战者
                if (player.id !== st.hostId) return; // 仅房主上报
                if (st.board[r][c] !== EMPTY) return;
                const moveColor = (payload.color === WHITE) ? WHITE : BLACK;
                if (moveColor !== st.turn) return; // 必须轮到该颜色

                if (st.gameType === 'gomoku') {
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

            // 在线模式严格走 worker 权威
            if (st.board[r][c] !== EMPTY) return;
            const myColor = player.id === st.blackPlayer ? BLACK :
                player.id === st.whitePlayer ? WHITE : 0;
            if (!myColor || myColor !== st.turn) return;

            // 执行落子
            st.moves.push({ r, c, color: st.turn });
            if (st.gameType === 'gomoku') {
                st.board[r][c] = st.turn;
                st.lastMove = { r, c };

                const winLine = checkGomokuWin(st.board, r, c, st.turn);
                if (winLine) {
                    st.winLine = winLine;
                    st.winReason = '五子连珠';
                    finishGame(ctx, st.turn, '五子连珠');
                    return;
                }

                // 平局检查
                let full = true;
                for (let rr = 0; rr < st.boardSize; rr++) {
                    for (let cc = 0; cc < st.boardSize; cc++) {
                        if (st.board[rr][cc] === EMPTY) { full = false; break; }
                    }
                    if (!full) break;
                }
                if (full) { finishGame(ctx, 0, '棋盘已满'); return; }

                st.turn = st.turn === BLACK ? WHITE : BLACK;

            } else {
                // 围棋
                const testBoard = cloneBoard(st.board);
                const res = goPlaceStone(testBoard, r, c, st.turn);
                if (!res) return; // 非法落子

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
         * 两次连续 Pass → 进入 end_confirm（死活协商阶段），不再直接 FINISHED。
         */
        pass(ctx, { player }) {
            const st = ctx.state;
            if (st.gameType !== 'go' || st.finished) return;
            if (st.phase !== 'playing') return;

            const myColor = player.id === st.blackPlayer ? BLACK :
                player.id === st.whitePlayer ? WHITE : 0;
            if (!myColor || myColor !== st.turn) return;

            st.passes++;
            st.turn = st.turn === BLACK ? WHITE : BLACK;
            st.lastMove = null;

            // 双方连续 pass → 进入死活协商阶段（不立即结算）
            if (st.passes >= 2) {
                enterEndConfirm(ctx);
            } else {
                ctx.broadcast('pass', { player: player.id });
            }
            bumpActivity(ctx);
        },

        /**
         * 继续对局：围棋 end_confirm 阶段任意一方可点，任意一方即可生效。
         * 直接退回 playing，恢复落子/悔棋原有规则。
         */
        continueGame(ctx, { player }) {
            const st = ctx.state;
            if (st.gameType !== 'go') return;
            if (st.phase !== 'end_confirm') return;
            const myColor = player.id === st.blackPlayer ? BLACK :
                player.id === st.whitePlayer ? WHITE : 0;
            if (!myColor) return;

            st.phase = 'playing';
            st.confirmDeadBy = { black: false, white: false };
            ctx.broadcast('gameResumed', { by: player.id });
            bumpActivity(ctx);
        },

        /**
         * 确认死棋：围棋 end_confirm 阶段双方都确认后才能进入 FINISHED。
         */
        confirmDead(ctx, { player }) {
            const st = ctx.state;
            if (st.gameType !== 'go') return;
            if (st.phase !== 'end_confirm') return;
            const myColor = player.id === st.blackPlayer ? BLACK :
                player.id === st.whitePlayer ? WHITE : 0;
            if (!myColor) return;

            if (myColor === BLACK) st.confirmDeadBy.black = true;
            else st.confirmDeadBy.white = true;

            ctx.broadcast('deadConfirmProgress', {
                black: st.confirmDeadBy.black,
                white: st.confirmDeadBy.white
            });

            if (st.confirmDeadBy.black && st.confirmDeadBy.white) {
                const score = goScore(st.board);
                const blackTotal = score.black + st.capturedB;
                const whiteTotal = score.white + st.capturedW;
                const winner = blackTotal > whiteTotal ? BLACK :
                    whiteTotal > blackTotal ? WHITE : 0;
                finishGame(ctx, winner, `黑 ${blackTotal} 目 · 白 ${whiteTotal} 目`);
            }
            bumpActivity(ctx);
        },

        /**
         * 悔棋：AI 模式撤销两步（AI + 玩家）；在线模式发起请求，需对方同意。
         */
        undo(ctx, { player }) {
            const st = ctx.state;
            if (st.finished) return;
            if (st.phase !== 'playing') return;

            if (st.mode === 'ai') {
                // 撤销 AI 的最后一步 + 玩家的最后一步
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
                // AI 模式：黑方（房主）悔棋计数 -1
                st.undoCount = st.undoCount || { black: 2, white: 2 };
                st.undoCount.black = Math.max(0, (st.undoCount.black || 0) - 1);
                if (st.gameType === 'go') { st.capturedB = 0; st.capturedW = 0; }
                if (st.gameType === 'go') { st.capturedB = 0; st.capturedW = 0; }
                bumpActivity(ctx);
                return;
            }

            // 在线模式：申请悔棋，需对方同意
            const myColor = player.id === st.blackPlayer ? BLACK :
                player.id === st.whitePlayer ? WHITE : 0;
            if (!myColor) return;
            if (myColor === st.turn) return; // 还没下，不能悔
            if (st.moves.length === 0) return;
            // 每方独立 2 次
            const remain = (st.undoCount && st.undoCount[myColor === BLACK ? 'black' : 'white']) || 0;
            if (remain <= 0) return;
            if (st.pendingRequest) return;
            st.pendingRequest = { type: 'undo', from: player.id, createdAt: ctx.now() };
            ctx.broadcast('requestPending', { type: 'undo', from: player.id });
            // 请求超时自动视为拒绝
            ctx.setTimer('request-timeout', st.requestTimeoutMs, () => autoRejectRequest(ctx, 'undo'));
        },

        /**
         * AI 模式下玩家落子后，客户端通知游戏结束（胜负判定由客户端本地完成）
         * 同步 Worker 状态到 finished，避免状态不一致导致鬼畜/重开失效
         */
        aiGameOver(ctx, { player, payload }) {
            const st = ctx.state;
            if (st.mode !== 'ai') return;
            if (player.id !== st.hostId) return;

            const winner = payload && payload.winner;
            const reason = payload && payload.reason;
            if (winner !== undefined && winner !== null) {
                finishGame(ctx, winner, reason);
            } else {
                // 通知客户端游戏继续进行
                ctx.broadcast('gameResumed', { by: player.id });
            }
        },

        /**
         * 投降：纯通知协议（不需要对方回应）
         * - 步骤1：设 pendingRequest 推给双方
         *   · 发起方：弹"已发送【投降】请求，等待你确认"（有同意/拒绝按钮）
         *   · 对方：弹"对方想要投降"（无按钮，1秒自动关）
         * - 步骤2：发起方本地回应（同意/拒绝）
         *   · 同意：finishGame(对方胜) + lastRequestResult
         *   · 拒绝：清除 pendingRequest + lastRequestResult
         * 不挂超时（发起方自己点才会走完）。
         */
        resign(ctx, { player }) {
            const st = ctx.state;
            if (st.finished) return;
            if (st.phase !== 'playing' && st.phase !== 'end_confirm') return;
            if (st.pendingRequest) return;

            const myColor = player.id === st.blackPlayer ? BLACK :
                player.id === st.whitePlayer ? WHITE : 0;
            if (!myColor) return;

            st.pendingRequest = { type: 'resign', from: player.id, noResponse: true, createdAt: ctx.now() };
            ctx.broadcast('requestPending', { type: 'resign', from: player.id, noResponse: true });
            ctx.setTimer('request-timeout', st.requestTimeoutMs, () => autoRejectRequest(ctx, 'resign'));
        },

        /**
         * 重开：AI 模式直接执行；在线模式发起请求，需对方同意。
         * AI 模式任何 phase 都可以重开；在线模式仅在 FINISHED 后才能发起（避免对局中途被重开）。
         */
        restart(ctx, { player }) {
            const st = ctx.state;

            if (st.mode === 'ai') {
                // AI 模式：任何时候都可以重开（lobby/playing/finished 均可）
                startMatch(ctx);
                ctx.broadcast('gameStarted', { gameType: st.gameType, boardSize: st.boardSize, mode: 'ai', hostSide: st.hostSide });
                return;
            }

            if (st.phase !== 'finished') return;
            if (st.pendingRequest) return;
            st.pendingRequest = { type: 'restart', from: player.id, createdAt: ctx.now() };
            ctx.broadcast('requestPending', { type: 'restart', from: player.id });
            ctx.setTimer('request-timeout', st.requestTimeoutMs, () => autoRejectRequest(ctx, 'restart'));
        },

        /**
         * 重开：对局进行中任一方可发起。
         * - AI 模式：房主直接重开（无对方可同意）
         * - 在线模式：发起请求，需对方同意（跟"再来一局"一样走 requestPending 流程）
         */
        rematch(ctx, { player }) {
            const st = ctx.state;
            if (st.phase !== 'playing' || st.finished) return;
            if (st.pendingRequest) return;

            if (st.mode === 'ai') {
                // AI 模式没有对方需要同意，房主可直接重开（其它玩家只能是观战者）
                startMatch(ctx);
                ctx.broadcast('gameStarted', { gameType: st.gameType, boardSize: st.boardSize, mode: 'ai', hostSide: st.hostSide });
                return;
            }

            if (player.id !== st.hostId && player.id !== st.whitePlayer) return;
            st.pendingRequest = { type: 'rematch', from: player.id, createdAt: ctx.now() };
            ctx.broadcast('requestPending', { type: 'rematch', from: player.id });
            ctx.setTimer('request-timeout', st.requestTimeoutMs, () => autoRejectRequest(ctx, 'rematch'));
        },

        /**
         * 返回选择（房主）：纯通知协议（跟 resign 一样）
         * 同意后调用 exitRoom 标记 activeExit='backToMenu'，客户端随后 parti.leave() 触发 onLeave。
         * onLeave 看到 'backToMenu' 不判负。
         */
        backToMenu(ctx, { player }) {
            const st = ctx.state;
            if (st.mode !== 'online' && st.mode !== 'ai') return;
            if (player.id !== st.hostId) return; // 仅黑方（房主）
            if (st.pendingRequest) return;

            st.pendingRequest = { type: 'backToMenu', from: player.id, noResponse: true, createdAt: ctx.now() };
            ctx.broadcast('requestPending', { type: 'backToMenu', from: player.id, noResponse: true });
            ctx.setTimer('request-timeout', st.requestTimeoutMs, () => autoRejectRequest(ctx, 'backToMenu'));
        },

        /**
         * 玩家主动退出房间：标记 activeExit，客户端随后调用 parti.leave() 触发 onLeave。
         * onLeave 看到 activeExit 后用 "对方主动退出" 文案作为判负理由。
         * payload: 没有
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
            ctx.broadcast('peerExited', { id: player.id });
        },

        /**
         * 对方同意或拒绝请求。
         * payload: { accept: true|false }
         */
        respondRequest(ctx, { player, payload }) {
            const st = ctx.state;
            if (!st.pendingRequest) return;
            const req = st.pendingRequest;
            // resign/backToMenu 是纯通知协议（noResponse），发起方自己确认/拒绝
            // AI 模式下房主未被分配 blackPlayer/whitePlayer，所以这类协议不要求"我必须执子"
            // undo/restart/rematch 是请求-回应，必须由对局中的另一方回应（因此要求 myColor 非 0）
            if (req.noResponse) {
                if (player.id !== req.from) return; // 只有发起方自己能回应
            } else {
                const myColor = player.id === st.blackPlayer ? BLACK :
                    player.id === st.whitePlayer ? WHITE : 0;
                if (!myColor) return;
                if (player.id === req.from) return; // 不能回应自己的请求
            }

            // 任何类型的请求在回应时都清除超时（避免超时和回应并发处理）
            ctx.clearTimer('request-timeout');
            st.pendingRequest = null;
            st.lastRequestResult = {
                type: req.type,
                accept: !!(payload && payload.accept),
                from: req.from,
                by: player.id,
                ts: ctx.now()
            };

            if (!payload || !payload.accept) {
                // 拒绝：resign/backToMenu 不需要广播 requestRejected（双方都从 lastRequestResult 看到）
                if (!req.noResponse) ctx.broadcast('requestRejected', { type: req.type, by: player.id });
                return;
            }

            if (req.type === 'restart') {
                // 同意重开：直接重置棋盘并开始新对局，不需重新准备
                startMatch(ctx);
                ctx.broadcast('restarted', {});
            } else if (req.type === 'rematch') {
                // 同意"对局中重开"：跟 restart 一样直接开新对局
                startMatch(ctx);
                ctx.broadcast('restarted', {});
            } else if (req.type === 'resign') {
                // 同意投降：发起方判负
                const loserColor = req.from === st.blackPlayer ? BLACK :
                    req.from === st.whitePlayer ? WHITE : 0;
                const winner = loserColor === BLACK ? WHITE : BLACK;
                finishGame(ctx, winner, '对方投降');
            } else if (req.type === 'backToMenu') {
                // 同意"返回选择"：重置整局为 lobby 状态（可重新开始）
                if (!st.activeExit) st.activeExit = {};
                st.activeExit[req.from] = 'backToMenu';
                // 重置对局状态 → lobby：双方都看到准备面板，可重新选棋种
                st.phase = 'lobby';
                st.finished = false;
                st.winner = 0;
                st.board = createBoard(st.boardSize || (st.gameType === 'go' ? SIZE_GO : SIZE_GOMOKU));
                st.boardSize = st.boardSize || (st.gameType === 'go' ? SIZE_GO : SIZE_GOMOKU);
                st.turn = BLACK;
                st.moves = [];
                st.lastMove = null;
                st.winLine = null;
                st.winReason = '';
                st.passes = 0;
                st.capturedB = 0;
                st.capturedW = 0;
                st.undoCount = { black: 2, white: 2 };
                st.confirmDeadBy = { black: false, white: false };
                st.pendingRequest = null;
                // 注意：lastRequestResult 保留，让 onState 在 lobby 分支能识别是 backToMenu 引起的
                // 它的清理交给 startMatch / 新对局开始时统一清（这里设个 2 秒后清，避免 lobby 期间后续 state 推送重复触发 banner）
                ctx.setTimer('clear-lobby-result', 2000, () => {
                    if (st.phase === 'lobby' && st.lastRequestResult && st.lastRequestResult.type === 'backToMenu') {
                        st.lastRequestResult = null;
                    }
                });
            } else if (req.type === 'undo') {
                // 悔棋：撤销发起者的最后一步 + 对方最后一步，让发起者重新走
                // 每方独立计数：发起方 -1
                st.undoCount = st.undoCount || { black: 2, white: 2 };
                const requesterColor = req.from === st.blackPlayer ? BLACK :
                    req.from === st.whitePlayer ? WHITE : 0;
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
                if (st.gameType === 'go') { st.capturedB = 0; st.capturedW = 0; }
                bumpActivity(ctx);
            }
        },
    }
});

/* ==================================================================
   辅助函数
   ================================================================== */

/** 进入围棋 end_confirm 死活协商阶段 */
function enterEndConfirm(ctx) {
    const st = ctx.state;
    st.phase = 'end_confirm';
    st.finished = false;
    st.confirmDeadBy = { black: false, white: false };
    ctx.broadcast('deadNegotiation', {});
}

/** 开始一局（重置所有对局状态）。
 *  参数 firstTurn 仅用于兼容历史调用，五子棋/围棋均为黑先白后，无视传入值。 */
function startMatch(ctx, firstTurn) {
    const st = ctx.state;
    const size = st.boardSize || (st.gameType === 'go' ? SIZE_GO : SIZE_GOMOKU);
    st.boardSize = size;
    st.board = createBoard(size);
    st.turn = BLACK; // 固定黑先
    st.finished = false;
    st.winner = 0;
    st.passes = 0;
    st.capturedB = 0;
    st.capturedW = 0;
    st.lastMove = null;
    st.winLine = null;
    st.winReason = '';
    st.phase = 'playing';
    st.confirmDeadBy = { black: false, white: false };
    st.moves = [];
    st.undoCount = { black: 2, white: 2 };
    st.pendingRequest = null;
    st.lastRequestResult = null; // 清掉对局结果文案，避免新一局开始时还显示旧结果
    const now = ctx.now();
    st.gameStartedAt = now;
    st.lastActivityAt = now;
}

/** 更新对局最近活动时间 */
function bumpActivity(ctx) {
    const st = ctx.state;
    st.lastActivityAt = ctx.now();
}

/** 超时自动拒绝某个请求（仅清空 pendingRequest） */
/**
 * 请求超时：自动拒绝（用于 undo / restart / rematch / resign / backToMenu）
 * 清理 pendingRequest + 设 lastRequestResult(accept=false) + 广播 requestExpired
 */
function autoRejectRequest(ctx, expectType) {
    const st = ctx.state;
    if (!st.pendingRequest) return;
    if (st.pendingRequest.type !== expectType) return;
    const from = st.pendingRequest.from;
    st.pendingRequest = null;
    st.lastRequestResult = {
        type: expectType,
        accept: false,
        from: from,
        by: from, // 超时无人响应，记为发起方自己"未操作"
        expired: true,
        ts: ctx.now()
    };
    ctx.broadcast('requestExpired', { type: expectType });
}

/** 周期定时器：处理请求超时与对局超时 */
function tickTimeouts(ctx) {
    const st = ctx.state;
    const now = ctx.now();

    // 1. 对局超时：playing/end_confirm 阶段超 gameTimeoutMs 无活动 → 判当前回合方负
    if ((st.phase === 'playing' || st.phase === 'end_confirm') && st.gameStartedAt > 0) {
        if (now - st.lastActivityAt > st.gameTimeoutMs) {
            // 当前轮到的玩家判负
            const loser = st.turn;
            const winner = loser === BLACK ? WHITE : BLACK;
            finishGame(ctx, winner, '对局超时');
        }
    }
}

/** 结束对局并更新统计，进入 finished 阶段 */
function finishGame(ctx, winner, reason) {
    const st = ctx.state;
    if (st.finished) return;
    st.finished = true;
    st.winner = winner;
    st.winReason = reason || '';
    st.phase = 'finished';

    // 更新会话统计
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

    ctx.broadcast('game:over', { winner, reason });
}

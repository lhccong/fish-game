# 多阶段：先在 builder 装依赖、构建 Web；再裁到只跑 start.mjs 的 runtime。
# 镜像内只有一个 node 进程做 3 件事：服务 apps/web/dist + 反代 /v1/* 到 lobby-mock 子进程 + 持久化。

# ── 1. 构建阶段 ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app

ARG VITE_LOBBY_SERVICE_URL
ENV VITE_LOBBY_SERVICE_URL=${VITE_LOBBY_SERVICE_URL}

# 先复制 lockfile + package.json，最大化缓存命中
COPY package-lock.json package.json tsconfig.base.json tsconfig.json ./
COPY apps/web/package.json ./apps/web/package.json
# 其余 workspace package.json
COPY apps ./apps
COPY packages ./packages
COPY scripts ./scripts

# 安装 + 构建 Web 端（不需要构建 Room app）
RUN npm ci
RUN npm run build:web

# ── 2. 运行阶段 ───────────────────────────────────────────────
FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=5157 \
    HOST=0.0.0.0 \
    LOBBY_INTERNAL=5158 \
    LOBBY_STORAGE_FILE=/data/lobby.json \
    STATIC_DIR=/app/apps/web/dist

WORKDIR /app

# 单独安装生产依赖（这里 start.mjs 用了 tsx，因此保留 devDependencies）
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/apps ./apps
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/node_modules ./node_modules

# 数据卷：房间列表持久化挂到这里
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 5157

# 健康检查走对外端口的健康端点（由 start.mjs 暴露）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "const req = require('node:http').get({ hostname: '127.0.0.1', port: process.env.PORT || 5157, path: '/v1/health' }, res => { res.resume(); process.exit(res.statusCode === 200 ? 0 : 1); }); req.on('error', () => process.exit(1)); setTimeout(() => { req.destroy(); process.exit(1); }, 4000);"]

# 不直接用 start 脚本（tsx 启动有命令前缀），用 node 显式调用
CMD ["node", "--import", "tsx", "scripts/start.mjs"]

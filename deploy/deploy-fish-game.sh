#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/thome/1panel/cong/fish-game"
REPO_URL="https://github.com/lhccong/fish-game.git"
BRANCH="moyu"
CONTAINER="fish-game"
IMAGE="fish-game:custom"
PUBLIC_PORT="3215"
CONTAINER_PORT="5157"
PUBLIC_URL="https://your-domain.example.com"

echo "[1/5] 拉取代码"
if [ ! -d "$PROJECT_DIR/.git" ]; then
  mkdir -p "$(dirname "$PROJECT_DIR")"
  git clone --branch "$BRANCH" --single-branch "$REPO_URL" "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"
git rev-parse --is-inside-work-tree >/dev/null

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "存在未提交的代码修改，请先处理后再部署。"
  exit 1
fi

git fetch origin "$BRANCH"
git switch "$BRANCH" 2>/dev/null || git switch -c "$BRANCH" --track "origin/$BRANCH"
git merge --ff-only "origin/$BRANCH"

echo "[2/5] 检查生产配置"
if [ "$PUBLIC_URL" = "https://your-domain.example.com" ]; then
  echo "请先修改脚本中的 PUBLIC_URL，再部署。"
  exit 1
fi

mkdir -p "$PROJECT_DIR/data"
ENV_ARGS=()
if [ -f "$PROJECT_DIR/.env.production" ]; then
  ENV_ARGS=(--env-file "$PROJECT_DIR/.env.production")
fi

echo "[3/5] 构建 Docker 镜像"
docker build \
  --build-arg "VITE_LOBBY_SERVICE_URL=$PUBLIC_URL" \
  -t "$IMAGE" \
  .

echo "[4/5] 移除旧容器"
if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
  docker rm -f "$CONTAINER"
fi

echo "[5/5] 启动新容器"
docker run -d \
  --name "$CONTAINER" \
  --restart unless-stopped \
  -p "$PUBLIC_PORT:$CONTAINER_PORT" \
  "${ENV_ARGS[@]}" \
  -e PORT="$CONTAINER_PORT" \
  -e HOST=0.0.0.0 \
  -e LOBBY_STORAGE_FILE=/data/lobby.json \
  -v "$PROJECT_DIR/data:/data" \
  "$IMAGE"

echo "部署完成：$PUBLIC_URL"
echo "本机检查：curl http://127.0.0.1:$PUBLIC_PORT/v1/health"
echo "查看日志：docker logs --tail 100 $CONTAINER"

#!/usr/bin/env bash
# 一键启动：音频鉴伪服务（FastAPI）+ web 网关（Node）
#
#   ./deploy/start-all.sh            # 用 deploy/.env（没有就用仓库根 .env）
#   ./deploy/start-all.sh --web-only # 只起 web，后端另有部署时用
#   ./deploy/start-all.sh --no-wait  # 不等待健康检查
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

WEB_ONLY=0
WAIT=1
for arg in "$@"; do
  case "$arg" in
    --web-only) WEB_ONLY=1 ;;
    --no-wait) WAIT=0 ;;
    *) echo "未知参数：$arg" >&2; exit 2 ;;
  esac
done

ENV_FILE="${ENV_FILE:-$ROOT/.env}"
if [[ -f "$ROOT/deploy/.env" ]]; then ENV_FILE="$ROOT/deploy/.env"; fi
if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  echo "env: $ENV_FILE"
else
  echo "env: 未找到 .env，使用脚本默认值（参考 deploy/.env.example）"
fi

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8080}"
AUDIO_PORT="${AUDIO_PORT:-8000}"
RUN_DIR="${RUN_DIR:-$ROOT/run}"
mkdir -p "$RUN_DIR"

wait_health() {
  local name="$1" url="$2" tries="${3:-120}"
  for ((i = 1; i <= tries; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      echo "  ✓ $name 就绪（${i}s）"
      return 0
    fi
    sleep 1
  done
  echo "  ✗ $name 超过 ${tries}s 未就绪，见 $RUN_DIR/$name.log" >&2
  return 1
}

start_audio() {
  if [[ -f "$RUN_DIR/audio.pid" ]] && kill -0 "$(cat "$RUN_DIR/audio.pid")" 2>/dev/null; then
    echo "audio: 已在运行（pid $(cat "$RUN_DIR/audio.pid")）"
    return 0
  fi
  echo "audio: 启动 backend/server.py :$AUDIO_PORT"
  ( cd "$ROOT/backend" && exec uvicorn server:app --host 0.0.0.0 --port "$AUDIO_PORT" ) \
    >"$RUN_DIR/audio.log" 2>&1 &
  echo $! >"$RUN_DIR/audio.pid"
}

start_web() {
  if [[ -f "$RUN_DIR/web.pid" ]] && kill -0 "$(cat "$RUN_DIR/web.pid")" 2>/dev/null; then
    echo "web: 已在运行（pid $(cat "$RUN_DIR/web.pid")）"
    return 0
  fi
  local dist_flag=""
  if [[ -d "$ROOT/dist" && "${SERVE_DIST:-1}" == "1" ]]; then dist_flag="--dist"; fi
  echo "web: 启动 scripts/serve.mjs $dist_flag :$PORT"
  ( cd "$ROOT" && HOST="$HOST" PORT="$PORT" exec node scripts/serve.mjs $dist_flag ) \
    >"$RUN_DIR/web.log" 2>&1 &
  echo $! >"$RUN_DIR/web.pid"
}

if [[ "$WEB_ONLY" -eq 0 ]]; then
  start_audio
  [[ "$WAIT" -eq 1 ]] && wait_health audio "http://127.0.0.1:${AUDIO_PORT}/api/v1/health" 300 || true
fi

start_web
[[ "$WAIT" -eq 1 ]] && wait_health web "http://127.0.0.1:${PORT}/api/v1/health" 60 || true

echo
echo "web  : http://${HOST}:${PORT}/#/audio/forgery"
echo "api  : http://${HOST}:${PORT}/api/v1/audio/forgery"
if [[ "$WEB_ONLY" -eq 0 ]]; then
  echo "audio: http://127.0.0.1:${AUDIO_PORT}/docs"
fi
echo "日志 : $RUN_DIR/{web,audio}.log   停止：./deploy/stop-all.sh"

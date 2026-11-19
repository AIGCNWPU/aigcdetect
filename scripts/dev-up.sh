#!/bin/bash
# 本机/开发机一键启动：常驻推理(8617) + 平台(4173) + 市场API(8090)
# 用法：bash scripts/dev-up.sh [--no-inference] [--no-api]
#       bash scripts/dev-up.sh --stop
# VS Code 用户：启动后在 PORTS 面板 Forward 4173 / 8090 即可点开界面。
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM_ROOT="${AIGC_PLATFORM_ROOT:-/sdb/data_public/lvjiawen/aigc_platform}"
ENV_FILE="$PLATFORM_ROOT/project/.env.image-documents.local"
FORENSICS_PY="$PLATFORM_ROOT/runtime/envs/forensics-runtime/bin/python"
GPU="${AIGC_DEV_GPU:-2}"
LOG_DIR="${TMPDIR:-/tmp}"

stop_all() {
  pkill -f "inference_daemon.py" 2>/dev/null
  pkill -f "serve.mjs" 2>/dev/null
  pkill -f "uvicorn app:app" 2>/dev/null
  sleep 2
  echo "已停止：推理/平台/市场API"
}

case "${1:-}" in
  --stop) stop_all; exit 0;;
esac

port_busy() { ss -tln 2>/dev/null | grep -q ":$1 "; }
if port_busy 4173 || port_busy 8090 || port_busy 8617; then
  echo "端口已被占用（4173/8090/8617），先执行：bash scripts/dev-up.sh --stop"
  exit 1
fi

WANT_INFERENCE=1; WANT_API=1
for arg in "$@"; do
  [ "$arg" = "--no-inference" ] && WANT_INFERENCE=0
  [ "$arg" = "--no-api" ] && WANT_API=0
done

# ① 常驻推理（DDA-H+/SEED/TruFor/VLAForge/RPA/翻拍）
if [ "$WANT_INFERENCE" = 1 ]; then
  if [ -x "$FORENSICS_PY" ]; then
    AIGC_PLATFORM_ROOT="$PLATFORM_ROOT" nohup "$FORENSICS_PY" \
      "$ROOT/scripts/image-validation/inference_daemon.py" \
      --gpu "$GPU" --port 8617 --models mirror,seed,forensics,recapture \
      > "$LOG_DIR/dev-inference.log" 2>&1 &
    echo "推理服务启动中（约 1–2 分钟，日志 $LOG_DIR/dev-inference.log）"
  else
    echo "警告：未找到 $FORENSICS_PY，跳过常驻推理（检测将走按任务加载，较慢）"
  fi
fi

# ② 平台页面 + 业务 API
if [ -f "$ENV_FILE" ]; then set -a; . "$ENV_FILE"; set +a; fi
( cd "$ROOT" && AIGC_PLATFORM_ROOT="$PLATFORM_ROOT" BIND_HOST=0.0.0.0 PORT=4173 \
    PROXY_BACKEND=0 REVIEW_ENGINE=direct AIGC_INFERENCE_URL=http://127.0.0.1:8617 \
    AIGC_GPU_MIN_FREE_MB=12000 nohup node scripts/serve.mjs > "$LOG_DIR/dev-platform.log" 2>&1 & )
echo "平台启动中（日志 $LOG_DIR/dev-platform.log）"

# ③ 市场 API
if [ "$WANT_API" = 1 ]; then
  ( cd "$ROOT/services/market-api" && AIGC_MARKET_API_MODE=upstream \
      AIGC_MARKET_API_UPSTREAM=http://127.0.0.1:4173 AIGC_MARKET_API_APPCODES=dev-apicode \
      AIGC_MARKET_API_SYNC_TIMEOUT=300 nohup python3 -m uvicorn app:app --host 0.0.0.0 --port 8090 \
      > "$LOG_DIR/dev-market-api.log" 2>&1 & )
  echo "市场 API 启动中（日志 $LOG_DIR/dev-market-api.log）"
fi

sleep 6
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo
echo "平台页面： http://127.0.0.1:4173/   或  http://${IP:-<本机IP>}:4173/"
echo "  · 2.1： /#/image/general"
echo "  · 2.3： /#/image/documents"
[ "$WANT_API" = 1 ] && echo "市场 API： http://${IP:-<本机IP>}:8090  （Authorization: APPCODE dev-apicode）"
echo "VS Code：PORTS 面板 Forward 4173 / 8090 → 点 localhost 链接打开"
echo "停止：   bash scripts/dev-up.sh --stop"

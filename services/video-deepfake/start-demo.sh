#!/usr/bin/env bash
# 一键启动 3.2 人物换脸与深度伪造检测演示：智鉴 推理服务(8601) + 前端网关(4174)
# 用法：bash services/video-deepfake/start-demo.sh   （在任意目录执行均可）
# 不影响 3.1 通用视频检测（4173/8600）的进程。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SERVICE_DIR="$PROJECT_ROOT/services/video-deepfake"
BASE="/mnt/vos-6d37s2q0/users/${USER}"
PORT_ALGO="${VLAFORGE_PORT:-8601}"
PORT_WEB="${DEEPFAKE_WEB_PORT:-4174}"
LOG="${VERITAS_DEEPFAKE_LOG:-/tmp/veritas-deepfake-demo.log}"

algo_health() { curl -s -m 3 "http://127.0.0.1:$PORT_ALGO/health" 2>/dev/null; }
web_health() { curl -s -m 3 "http://127.0.0.1:$PORT_WEB/api/v1/video/deepfake/health" 2>/dev/null; }

# 独立会话启动，避免脚本退出时被当成作业等待而挂住
start_bg() {  # $1=工作目录，其余为命令
  local dir="$1"; shift
  ( cd "$dir" && setsid nohup "$@" >> "$LOG" 2>&1 < /dev/null & )
}

# ---- 前置检查 ----
PY="$SERVICE_DIR/.venv/bin/python"
if [[ ! -x "$PY" ]]; then
  cat >&2 <<EOF
未找到 Python 环境：$PY

请先执行：
  cd "$SERVICE_DIR"
  ~/conda/envs/video-general/bin/python -m venv --system-site-packages .venv
  .venv/bin/python -m pip install -r requirements.txt
EOF
  exit 1
fi

if [[ -n "${VLAFORGE_CHECKPOINT:-}" ]]; then
  if [[ ! -f "${VLAFORGE_CHECKPOINT}" ]]; then
    echo "VLAFORGE_CHECKPOINT 指向的文件不存在：${VLAFORGE_CHECKPOINT}" >&2
    exit 1
  fi
  echo "使用指定权重：${VLAFORGE_CHECKPOINT}"
elif [[ ! -f "$SERVICE_DIR/artifacts/model.pth" ]]; then
  cat >&2 <<EOF
未找到模型权重：$SERVICE_DIR/artifacts/model.pth

把权重文件放在该路径（文件名必须是 model.pth），或保留原文件名并用
  VLAFORGE_CHECKPOINT=/绝对路径/VLAForge.pth bash services/video-deepfake/start-demo.sh

可执行 .venv/bin/python download_weights.py（需能访问 Google Drive）；
国内网络请自行下载后放入该目录，并核对 SHA-256：
  2bc0c1e33d08a241386f88e3a9bc0ee4a504def129be0b4a9197b33f6feaff1f
EOF
  exit 1
fi
if [[ ! -f "$SERVICE_DIR/artifacts/face_detection_yunet.onnx" ]]; then
  ( cd "$SERVICE_DIR" && "$PY" download_weights.py >/dev/null 2>&1 ) || true
fi

NODE_BIN="${NODE_BIN:-}"
if [[ -z "$NODE_BIN" ]]; then
  if command -v node >/dev/null 2>&1; then NODE_BIN="$(command -v node)"
  elif [[ -x "$BASE/conda/envs/video-general/bin/node" ]]; then NODE_BIN="$BASE/conda/envs/video-general/bin/node"
  elif [[ -x "/opt/miniforge3/bin/node" ]]; then NODE_BIN="/opt/miniforge3/bin/node"
  else echo "未找到 node（需要 Node.js >=20），可用 NODE_BIN=/path/to/node 指定" >&2; exit 1
  fi
fi

touch "$LOG" 2>/dev/null || LOG=/tmp/veritas-deepfake-demo.log

# ---- 推理服务 8601 ----
if algo_health | grep -q '"ready":true'; then
  echo "✓ 智鉴 推理服务已在运行 (端口 $PORT_ALGO)"
else
  echo "… 启动 智鉴 推理服务 (端口 $PORT_ALGO)"
  # 只在显式指定时透传权重路径；传空串会让 engine 读到空路径而非默认值
  algo_env=( "CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-0}" )
  if [[ -n "${VLAFORGE_DEVICE:-}" ]]; then algo_env+=( "VLAFORGE_DEVICE=$VLAFORGE_DEVICE" ); fi
  if [[ -n "${VLAFORGE_CHECKPOINT:-}" ]]; then algo_env+=( "VLAFORGE_CHECKPOINT=$VLAFORGE_CHECKPOINT" ); fi
  if [[ -n "${YUNET_CHECKPOINT:-}" ]]; then algo_env+=( "YUNET_CHECKPOINT=$YUNET_CHECKPOINT" ); fi
  start_bg "$SERVICE_DIR" env "${algo_env[@]}" \
    "$PY" -m uvicorn app:app --host 127.0.0.1 --port "$PORT_ALGO"
fi

echo -n "… 等待模型加载（首次约 10-30 秒）"
ready=""
for _ in $(seq 1 60); do
  if algo_health | grep -q '"ready":true'; then ready=1; break; fi
  sleep 2; echo -n "."
done
echo ""
if [[ -z "$ready" ]]; then
  echo "✗ 推理服务未就绪，最近日志：" >&2
  tail -n 20 "$LOG" >&2
  exit 1
fi
algo_health | sed 's/^/  /'
echo ""

# ---- 前端网关 4174 ----
if web_health | grep -q '"ready":true'; then
  echo "✓ 前端网关已在运行 (端口 $PORT_WEB)"
else
  echo "… 启动前端网关 (端口 $PORT_WEB)"
  start_bg "$PROJECT_ROOT" env \
    VLAFORGE_SERVICE_URL="http://127.0.0.1:$PORT_ALGO" \
    HOST=0.0.0.0 PORT="$PORT_WEB" \
    "$NODE_BIN" scripts/serve.mjs
  for _ in $(seq 1 15); do
    if web_health >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi

if ! web_health | grep -q '"ready":true'; then
  echo "✗ 前端网关未就绪，最近日志：" >&2
  tail -n 20 "$LOG" >&2
  exit 1
fi

LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo ""
echo "=== 全部就绪 ==="
echo "服务器本机:   http://127.0.0.1:$PORT_WEB/#/video/deepfake"
[[ -n "$LAN_IP" ]] && echo "局域网内:     http://$LAN_IP:$PORT_WEB/#/video/deepfake"
echo "自己电脑访问: 先建隧道，再在浏览器打开 http://127.0.0.1:$PORT_WEB/#/video/deepfake"
echo "              ssh -p 22022 -N -L $PORT_WEB:127.0.0.1:$PORT_WEB ${USER}@101.200.176.142"
echo "              想同时看 3.1 就再加一段 -L 4173:127.0.0.1:4173（本脚本不动 4173/8600）"
echo "日志:         tail -f $LOG"

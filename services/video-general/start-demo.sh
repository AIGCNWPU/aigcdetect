#!/usr/bin/env bash
# 一键启动 3.1 通用AI生成视频检测演示：推理服务(8600) + 前端网关(4173)
# 用法：bash services/video-general/start-demo.sh   （在仓库根目录执行）
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_NAME="${VERITAS_ENV:-video-general}"
BASE="/mnt/vos-6d37s2q0/users/${USER}"

source /opt/miniforge3/etc/profile.d/conda.sh
conda activate "$ENV_NAME"
export LD_LIBRARY_PATH="$CONDA_PREFIX/lib:${LD_LIBRARY_PATH:-}"
export TORCH_HOME="$BASE/cache/torch"
export RESTRAV_DEVICE="${RESTRAV_DEVICE:-cuda:0}"
export RESTRAV_SERVICE_URL=http://127.0.0.1:8600

start_if_down() {  # $1=端口 $2=名称 $3=启动命令(工作目录 $4)
  if curl -s -m 3 "http://127.0.0.1:$1/health" >/dev/null 2>&1; then
    echo "✓ $2 已在运行 (端口 $1)"
    return
  fi
  echo "… 启动 $2"
  ( cd "$4" && nohup bash -c "$3" >> /tmp/veritas-demo.log 2>&1 & )
}

start_if_down 8600 "ReStraV 推理服务" \
  "python -m uvicorn app:app --host 127.0.0.1 --port 8600" \
  "$PROJECT_ROOT/services/video-general"

echo -n "… 等待模型加载（首次约 30-60 秒）"
for _ in $(seq 1 30); do
  curl -s -m 3 http://127.0.0.1:8600/health | grep -q '"modelReady":true' && break
  sleep 3; echo -n "."
done
echo ""

start_if_down 4173 "前端网关" \
  "RESTRAV_SERVICE_URL=$RESTRAV_SERVICE_URL HOST=0.0.0.0 PORT=4173 node scripts/serve.mjs" \
  "$PROJECT_ROOT"

echo ""
echo "=== 全部就绪 ==="
echo "服务器本机:   http://127.0.0.1:4173/#/video/general"
echo "自己电脑访问: VS Code Remote-SSH 打开本仓库后自动转发 4173，或"
echo "              ssh -p 22022 -N -L 4173:127.0.0.1:4173 ${USER}@101.200.176.142"
echo "日志: tail -f /tmp/veritas-demo.log"

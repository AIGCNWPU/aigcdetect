#!/usr/bin/env bash
# 一键启动 3.1 通用AI生成视频检测演示：推理服务(8600) + 前端网关(4173)
# 用法：bash services/video-general/start-demo.sh   （在仓库根目录执行）
#
# 引擎：VIDEO_GENERAL_ENGINE=auto（默认）——存在 Native-Scale 官方权重时用
# Native-Scale（ICLR 2026），否则自动回退到本地训练的 ReStraV；实际引擎见
# http://127.0.0.1:8600/health 的 engine 字段与页面结果中的「检测模型」。
# 强制指定：VIDEO_GENERAL_ENGINE=native-scale 或 restrav。
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_NAME="${VERITAS_ENV:-video-general}"
BASE="/mnt/vos-6d37s2q0/users/${USER}"

source /opt/miniforge3/etc/profile.d/conda.sh
conda activate "$ENV_NAME"
# ReStraV 回退引擎需要 conda 自带 FFmpeg 共享库与 DINOv2 权重缓存
export LD_LIBRARY_PATH="$CONDA_PREFIX/lib:${LD_LIBRARY_PATH:-}"
export TORCH_HOME="$BASE/cache/torch"
export NATIVE_SCALE_DEVICE="${NATIVE_SCALE_DEVICE:-cuda:0}"
export VIDEO_GENERAL_ENGINE="${VIDEO_GENERAL_ENGINE:-auto}"
export VIDEO_GENERAL_SERVICE_URL="${VIDEO_GENERAL_SERVICE_URL:-http://127.0.0.1:8600}"

start_if_down() {  # $1=端口 $2=名称 $3=启动命令 $4=工作目录
  if curl -s -m 3 "http://127.0.0.1:$1/health" >/dev/null 2>&1; then
    echo "✓ $2 已在运行 (端口 $1)"
    return
  fi
  echo "… 启动 $2"
  ( cd "$4" && nohup bash -c "$3" >> /tmp/veritas-demo.log 2>&1 & )
}

start_if_down 8600 "视频检测推理服务" \
  "python -m uvicorn app:app --host 127.0.0.1 --port 8600" \
  "$PROJECT_ROOT/services/video-general"

echo -n "… 等待模型加载（首次约 30-60 秒）"
for _ in $(seq 1 30); do
  curl -s -m 3 http://127.0.0.1:8600/health | grep -q '"modelReady":true' && break
  sleep 3; echo -n "."
done
echo ""
curl -s -m 5 http://127.0.0.1:8600/health | python3 -c "import json,sys; d=json.load(sys.stdin); print('  当前引擎:', d.get('engine'), '| 模型就绪:', d.get('modelReady'))" 2>/dev/null || true

start_if_down 4173 "前端网关" \
  "VIDEO_GENERAL_SERVICE_URL=$VIDEO_GENERAL_SERVICE_URL HOST=0.0.0.0 PORT=4173 node scripts/serve.mjs" \
  "$PROJECT_ROOT"

echo ""
echo "=== 全部就绪 ==="
echo "服务器本机:   http://127.0.0.1:4173/#/video/general"
echo "自己电脑访问: VS Code Remote-SSH 打开本仓库后自动转发 4173，或"
echo "              ssh -p 22022 -N -L 4173:127.0.0.1:4173 ${USER}@101.200.176.142"
echo "日志: tail -f /tmp/veritas-demo.log"

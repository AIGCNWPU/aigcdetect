#!/usr/bin/env bash
# 一键启动 3.1 通用AI生成视频检测演示：Native-Scale 推理服务(8600) + 前端网关(4173)
# 用法：bash services/video-general/start-demo.sh   （在仓库根目录执行）
#
# 前置：官方权重 services/video-general/artifacts/Qwen2.5-ViT_140k_224p_448p.pth
# （从 https://github.com/mgiant/Qwen2.5ViT-AIGVDetection 的 448p Google Drive 链接下载，
#  不纳入 Git；缺失时服务会明确报“模型未就绪”）
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_NAME="${VERITAS_ENV:-video-general}"

source /opt/miniforge3/etc/profile.d/conda.sh
conda activate "$ENV_NAME"
# torchcodec 需要 conda 自带 FFmpeg 4-8 的共享库
export LD_LIBRARY_PATH="$CONDA_PREFIX/lib:${LD_LIBRARY_PATH:-}"
export NATIVE_SCALE_DEVICE="${NATIVE_SCALE_DEVICE:-cuda:0}"
export VIDEO_GENERAL_SERVICE_URL="${VIDEO_GENERAL_SERVICE_URL:-http://127.0.0.1:8600}"

start_if_down() {  # $1=端口 $2=名称 $3=启动命令 $4=工作目录
  if curl -s -m 3 "http://127.0.0.1:$1/health" >/dev/null 2>&1; then
    echo "✓ $2 已在运行 (端口 $1)"
    return
  fi
  echo "… 启动 $2"
  # setsid 让服务进入独立进程组，退出终端/关闭会话不会被连带回收
  ( cd "$4" && setsid nohup bash -c "$3" >> /tmp/veritas-demo.log 2>&1 < /dev/null & )
}

start_if_down 8600 "视频检测推理服务" \
  "python -m uvicorn app:app --host 127.0.0.1 --port 8600" \
  "$PROJECT_ROOT/services/video-general"

echo -n "… 等待模型加载（首次约 30-60 秒）"
for _ in $(seq 1 40); do
  HEALTH=$(curl -s -m 3 http://127.0.0.1:8600/health || true)
  echo "$HEALTH" | grep -q '"modelReady":true' && break
  sleep 3; echo -n "."
done
echo ""
echo "$HEALTH" | python3 -c "import json,sys; d=json.load(sys.stdin); print('  引擎:', d.get('engine'), '| 模型就绪:', d.get('modelReady'), '| 权重文件:', d.get('checkpoint'), ('| 错误: ' + str(d.get('error'))[:120]) if d.get('error') else '')" 2>/dev/null || true

start_if_down 4173 "前端网关" \
  "VIDEO_GENERAL_SERVICE_URL=$VIDEO_GENERAL_SERVICE_URL HOST=0.0.0.0 PORT=4173 node scripts/serve.mjs" \
  "$PROJECT_ROOT"

echo ""
echo "=== 启动完成 ==="
echo "服务器本机:   http://127.0.0.1:4173/#/video/general"
echo "自己电脑访问: VS Code Remote-SSH 打开本仓库后自动转发 4173，或"
echo "              ssh -p 22022 -N -L 4173:127.0.0.1:4173 ${USER}@101.200.176.142"
echo "日志: tail -f /tmp/veritas-demo.log"

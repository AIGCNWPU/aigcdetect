#!/bin/bash
# 在服务器上准备 spoof-diarization 的运行环境（独立 venv，不动 holi 线上环境）。
# 用法：nohup bash scripts/server_setup.sh > setup.log 2>&1 &
set -u

T=/mnt/vos-6d37s2q0/users/zqy/projects/spoof-diarization
P=/mnt/vos-6d37s2q0/users/zqy
VENV=$P/conda/envs/spoof
HOLI=$P/conda/envs/holi/bin/python

export HF_TOKEN="$(cat "$HOME/.hf_token" 2>/dev/null)"
export HF_ENDPOINT=https://hf-mirror.com
export HF_HOME=$P/cache/huggingface
export PIP_CACHE_DIR=$P/cache/pip
export TMPDIR=$P/tmp
export XDG_CACHE_HOME=$P/cache/xdg
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" "$HF_HOME" "$XDG_CACHE_HOME"

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "==== 开始 ===="
log "HF token 长度: ${#HF_TOKEN}"
log "减轻 I/O：暂停数据集下载"
pkill -f fetch_dailytalkedit_subset 2>/dev/null
sleep 2

# ---------------------------------------------------------------- venv
if [ ! -x "$VENV/bin/python" ]; then
    log "创建 venv（继承 holi 的 torch/transformers）"
    "$HOLI" -m venv --system-site-packages "$VENV" || {
        log "venv 失败，改用 conda"
        "$P/conda/bin/conda" create -y -p "$VENV" python=3.11 && \
        "$VENV/bin/pip" install -q torch==2.9.1 --index-url https://download.pytorch.org/whl/cu128
    }
else
    log "venv 已存在"
fi

log "pip 升级"
"$VENV/bin/python" -m pip install -q --upgrade pip 2>&1 | tail -3

log "安装 pyannote / 绘图 / http 依赖"
"$VENV/bin/python" -m pip install -q \
    "pyannote.audio>=4.0.0" "pyannote.metrics>=3.2" soundfile librosa matplotlib pyyaml requests 2>&1 | tail -25
log "pip 退出码: $?"

log "版本自检"
"$VENV/bin/python" - <<'PY'
import sys
print("python", sys.version.split()[0])
import numpy, soundfile, yaml, matplotlib
print("numpy", numpy.__version__, "soundfile", soundfile.__version__)
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available(), torch.cuda.device_count())
import pyannote.audio
print("pyannote.audio", pyannote.audio.__version__)
import pyannote.metrics
print("pyannote.metrics ok")
PY

# ---------------------------------------------------------------- 模型
log "拉取 pyannote/speaker-diarization-community-1"
"$VENV/bin/python" - <<'PY'
from huggingface_hub import snapshot_download
path = snapshot_download(
    "pyannote/speaker-diarization-community-1",
    token=open("/home/zqy/.hf_token").read().strip(),
    allow_patterns=["*.yaml", "*.bin", "*.safetensors", "*.pt", "*.json", "*.txt", "*.md"],
)
print("snapshot ->", path)
PY
log "模型拉取退出码: $?"

# ---------------------------------------------------------------- 冒烟
log "找一个已经下载好的 val/test 音频做冒烟"
WAV=$(ls "$T"/data/DailyTalkEdit/daily_talk_edit/concat_utts/*_modified.wav 2>/dev/null | head -1)
if [ -n "${WAV:-}" ]; then
    log "冒烟输入: $WAV"
    cd "$T" || exit 1
    "$VENV/bin/python" run_pipeline.py \
        --input "$WAV" \
        --out "$T/outputs/smoke/$(basename "$WAV" .wav)" \
        --set detect.backend=http \
        --set detect.http.url=http://127.0.0.1:8000 \
        --debug-plot --force 2>&1 | tail -40
    log "冒烟退出码: $?"
else
    log "还没有下载好的音频，跳过冒烟"
fi

log "==== 结束 ===="

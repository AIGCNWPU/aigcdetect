#!/bin/bash
# 修复独立的 spoof venv：pip 之前把 torch 升到了 2.15，和 holi 的 torchvision 0.24.1 不匹配，
# 导致 pyannote 导入报 "partially initialized module 'torchvision'"。
# 做法：删掉 venv 自带的 torch/torchvision/torchaudio，让它回落到 holi 的 torch 2.9.1。
set -u

P=/mnt/vos-6d37s2q0/users/zqy
V=$P/conda/envs/spoof
T=$P/projects/spoof-diarization
SP=$V/lib/python3.11/site-packages

export TMPDIR=$P/tmp
export PIP_CACHE_DIR=$P/cache/pip
export HF_ENDPOINT=https://hf-mirror.com
export HF_HOME=$P/cache/huggingface
mkdir -p "$TMPDIR" "$PIP_CACHE_DIR" "$HF_HOME"

log() { echo "[$(date +%H:%M:%S)] $*"; }

log "==== 开始修复 ===="
# HF token 不要写进仓库：从环境变量 HF_TOKEN 写入（或提前手工放好 ~/.hf_token）
if [ -n "${HF_TOKEN:-}" ]; then
    printf '%s\n' "$HF_TOKEN" > "$HOME/.hf_token"
    chmod 600 "$HOME/.hf_token"
    log "token 字节数: $(wc -c < "$HOME/.hf_token")"
else
    log "未设置 HF_TOKEN，沿用已有的 ~/.hf_token（若不存在，pyannote 下载会失败）"
fi

log "移除 venv 自带的 torch 系（改用 holi 的 2.9.1）"
rm -rf "$SP"/torch "$SP"/torch-* "$SP"/torchgen* "$SP"/functorch* \
       "$SP"/torchvision "$SP"/torchvision-* "$SP"/torchaudio "$SP"/torchaudio-* 2>/dev/null
log "剩余 torch*: $(ls -d "$SP"/torch* 2>/dev/null | xargs -r -n1 basename | tr '\n' ' ')"

log "导入自检"
"$V/bin/python" - <<'PY'
import torch
print("torch", torch.__version__, "cuda", torch.cuda.is_available())
for name in ("torchvision", "torchaudio"):
    try:
        module = __import__(name)
        print(name, module.__version__)
    except Exception as exc:
        print(name, "FAILED:", type(exc).__name__, exc)
try:
    import pyannote.audio
    print("pyannote.audio", pyannote.audio.__version__)
except Exception as exc:
    print("pyannote.audio FAILED:", type(exc).__name__, exc)
PY
log "自检退出码: $?"

log "缺 torchaudio 就补一个 2.9.1（--no-deps，不动 torch）"
if ! "$V/bin/python" -c "import torchaudio" >/dev/null 2>&1; then
    "$V/bin/python" -m pip install -q --no-deps "torchaudio==2.9.1" \
        --index-url https://download.pytorch.org/whl/cu128 2>&1 | tail -5
    log "torchaudio 安装退出码: $?"
fi
"$V/bin/python" -c "import torch, pyannote.audio; print('import-ok', torch.__version__, pyannote.audio.__version__)" 2>&1 | tail -6

log "==== 下载 pyannote/speaker-diarization-community-1 ===="
"$V/bin/python" - <<'PY'
from pathlib import Path
from huggingface_hub import snapshot_download
token = Path.home().joinpath(".hf_token").read_text().strip()
path = snapshot_download("pyannote/speaker-diarization-community-1", token=token)
print("snapshot ->", path)
PY
log "下载退出码: $?"

log "==== 冒烟 ===="
WAV=$(ls "$T"/data/DailyTalkEdit/daily_talk_edit/concat_utts/*_modified.wav 2>/dev/null | head -1)
if [ -n "${WAV:-}" ]; then
    log "输入: $WAV"
    cd "$T" || exit 1
    "$V/bin/python" run_pipeline.py \
        --input "$WAV" \
        --out "$T/outputs/smoke/$(basename "$WAV" .wav)" \
        --set detect.backend=http \
        --set detect.http.url=http://127.0.0.1:8000 \
        --debug-plot --force 2>&1 | tail -35
    log "冒烟退出码: ${PIPESTATUS[0]}"
else
    log "还没有下载好的音频，跳过冒烟"
fi
log "==== 结束 ===="

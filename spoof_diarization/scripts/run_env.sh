#!/bin/bash
# 运行前 source 这个文件：保证 HF 走镜像、缓存和 token 就位，并且用独立的 venv。
#   source scripts/run_env.sh
#   $VENV run_pipeline.py ...
export HF_ENDPOINT=https://hf-mirror.com
export HF_HOME=/mnt/vos-6d37s2q0/users/zqy/cache/huggingface
export HF_TOKEN="$(cat "$HOME/.hf_token" 2>/dev/null)"
export TMPDIR=/mnt/vos-6d37s2q0/users/zqy/tmp
export PYTHONUNBUFFERED=1
mkdir -p "$TMPDIR"

export VENV=/mnt/vos-6d37s2q0/users/zqy/conda/envs/spoof/bin/python
export PROJ=/mnt/vos-6d37s2q0/users/zqy/projects/spoof-diarization

#!/bin/bash
# 在服务器上跑 build_gt.py，自动带上数据路径与 HF 环境。
#   bash scripts/run_build_gt.sh val
#   bash scripts/run_build_gt.sh test --limit 5 --export-check 5
set -u
PROJ=/mnt/vos-6d37s2q0/users/zqy/projects/spoof-diarization
# shellcheck source=/dev/null
source "$PROJ/scripts/run_env.sh"
EDIT=$PROJ/data/DailyTalkEdit
TALK=/mnt/vos-6d37s2q0/users/zqy/datasets/dailytalk
IDX=$PROJ/data/dailytalk_index.json
SPLIT="${1:-val}"
shift || true
cd "$PROJ" || exit 1
exec "$VENV" build_gt.py --split "$SPLIT" "$@" \
    --set "paths.dailytalkedit_root=$EDIT" \
    --set "paths.dailytalk_root=$TALK" \
    --dailytalk-index "$IDX"

#!/usr/bin/env python
"""诊断单个对话的时间轴：累计时长 vs 互相关对齐 vs fake_region。

用法：
    python scripts/diag_timeline.py --dialog 0 --split val
    python scripts/diag_timeline.py --dialog 48 --split val --n 3
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from spoofdiar import audio as audio_io  # noqa: E402
from spoofdiar import gtbuild, parsing  # noqa: E402
from spoofdiar.dailytalk import DailyTalkEdit, DailyTalkIndex  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dialog", required=True)
    parser.add_argument("--split", default="val")
    parser.add_argument("--edit-root", default="data/DailyTalkEdit")
    parser.add_argument("--talk-root", default="/mnt/vos-6d37s2q0/users/zqy/datasets/dailytalk")
    parser.add_argument("--index", default="data/dailytalk_index.json")
    parser.add_argument("--n", type=int, default=12)
    args = parser.parse_args()

    edit = DailyTalkEdit(args.edit_root)
    index = DailyTalkIndex(args.talk_root, args.index)
    dialog_id = str(args.dialog)

    turns = index.turns(dialog_id)
    durations = [index.utterance_duration(dialog_id, t.key, t.speaker) for t in turns]
    cumulative = gtbuild.cumulative_starts(durations)

    entry = edit.modify_entry(dialog_id) or {}
    target = int(entry.get("target_utterance_idx", -1))
    row = None
    for item in edit.split_rows(args.split):
        if gtbuild.split_dialog_id(str(item.get("filename", ""))) == dialog_id:
            row = item
            break
    given = parsing.normalize_regions(row.get("fake_region") if row else None)

    concat, sr = audio_io.read_audio(edit.original_wav(dialog_id))
    mono = audio_io.to_mono(concat)
    utterances = [
        audio_io.to_mono(audio_io.read_audio(index.wav_path(dialog_id, t.key, t.speaker))[0])
        for t in turns
    ]

    # 逐句单独相关：在所给期望位置附近 ±1.5s 搜索，看真正的峰值在哪
    print(f"dialog={dialog_id} duration={mono.size / sr:.3f}s target={target} given={given}")
    print(f"{'i':>3} {'key':>4} {'spk':>3} {'dur':>7} {'cumsum':>8} {'peak':>8} {'score':>6}")
    cursor = 0.0
    for i, (turn, duration, utterance) in enumerate(zip(turns, durations, utterances)):
        guess = max(cumulative[i], cursor)
        start_frame = max(0, int((cumulative[i] - 1.5) * sr))
        end_frame = min(mono.size, int((cumulative[i] + duration + 1.5) * sr))
        offset, score = gtbuild._best_offset(utterance, mono[start_frame:end_frame])
        peak = (start_frame + offset) / sr
        print(
            f"{i:>3} {turn.key:>4} {turn.speaker:>3} {duration:>7.3f} {cumulative[i]:>8.3f} "
            f"{peak:>8.3f} {score:>6.3f}"
        )
        cursor = peak + duration
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

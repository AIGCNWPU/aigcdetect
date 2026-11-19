#!/usr/bin/env python
"""判断 fake_region 和 concat 音频到底哪个对：把两段候选区间和 modified 单句做互相关。

用法：
    python scripts/diag_region.py --dialog 0 --split val
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from spoofdiar import audio as audio_io  # noqa: E402
from spoofdiar import gtbuild, parsing  # noqa: E402
from spoofdiar.dailytalk import DailyTalkEdit, DailyTalkIndex  # noqa: E402


def score_at(mono: np.ndarray, sr: int, utt: np.ndarray, start: float) -> tuple[float, float]:
    """在 start 附近 ±0.5s 找最佳偏移，返回 (最佳位置, 归一化相关)。"""
    frame = int(round(start * sr))
    back = int(0.5 * sr)
    lo = max(0, frame - back)
    hi = min(mono.size, frame + utt.size + back)
    if hi - lo < utt.size:
        return start, 0.0
    offset, score = gtbuild._best_offset(utt, mono[lo:hi])
    return (lo + offset) / sr, score


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dialog", required=True)
    parser.add_argument("--split", default="val")
    parser.add_argument("--edit-root", default="data/DailyTalkEdit")
    parser.add_argument("--talk-root", default="/mnt/vos-6d37s2q0/users/zqy/datasets/dailytalk")
    parser.add_argument("--index", default="data/dailytalk_index.json")
    args = parser.parse_args()

    edit = DailyTalkEdit(args.edit_root)
    index = DailyTalkIndex(args.talk_root, args.index)
    dialog_id = str(args.dialog)

    turns = index.turns(dialog_id)
    durations = [index.utterance_duration(dialog_id, t.key, t.speaker) for t in turns]
    cumulative = gtbuild.cumulative_starts(durations)
    entry = edit.modify_entry(dialog_id) or {}
    target = int(entry.get("target_utterance_idx", -1))

    row = next(
        (
            item
            for item in edit.split_rows(args.split)
            if gtbuild.split_dialog_id(str(item.get("filename", ""))) == dialog_id
        ),
        None,
    )
    given = parsing.normalize_regions(row.get("fake_region") if row else None)

    utt_path = edit.modified_utt(dialog_id, target, turns[target].key)
    utt_audio, sr = audio_io.read_audio(utt_path)
    utt = audio_io.to_mono(utt_audio)

    original, _ = audio_io.read_audio(edit.original_wav(dialog_id))
    modified, _ = audio_io.read_audio(edit.modified_wav(dialog_id))
    orig_mono = audio_io.to_mono(original)
    mod_mono = audio_io.to_mono(modified)

    print(f"dialog={dialog_id} target={target} spk={turns[target].speaker}")
    print(f"  utt_file={utt_path.name} dur={{:.3f}}s".format(utt.size / sr))
    print(f"  cumulative_start={cumulative[target]:.3f}s  fake_region={given}")
    for name, mono in (("original", orig_mono), ("modified", mod_mono)):
        if given:
            pos, score = score_at(mono, sr, utt, given[0][0])
            print(f"  {name}: 在 fake_region 起点 {given[0][0]:.3f}s 附近 -> 最佳 {pos:.3f}s 相关={score:.3f}")
        pos2, score2 = score_at(mono, sr, utt, cumulative[target])
        print(f"  {name}: 在累计时长 {cumulative[target]:.3f}s 附近 -> 最佳 {pos2:.3f}s 相关={score2:.3f}")

    # 整段搜索：看这个单句到底在整段音频的哪里
    for name, mono in (("original", orig_mono), ("modified", mod_mono)):
        offset, score = gtbuild._best_offset(utt, mono)
        print(f"  {name}: 全段搜索最佳位置 {offset / sr:.3f}s 相关={score:.3f}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

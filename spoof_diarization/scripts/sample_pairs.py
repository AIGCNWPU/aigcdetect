#!/usr/bin/env python
"""按比例抽样对话对（分层：按被篡改句的说话人 0/1 分层），输出可复现的样本清单。

抽样必须在下载和建标注**之前**做，否则会把整份 val/test 都拉下来。
只读 metadata/*.jsonl 与 modify_config_pipeline.json，不碰音频。

用法：
    python scripts/sample_pairs.py --root data/DailyTalkEdit --splits val test --ratio 0.2
    python scripts/sample_pairs.py --root data/DailyTalkEdit --splits test --ratio 0.2 --seed 7

产物：
    data/gt/sample_{split}.json   {"split","ratio","seed","pairs":[...],"strata":{...}}
"""
from __future__ import annotations

import argparse
import json
import random
import re
from pathlib import Path


def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def dialog_id_of(filename: str) -> str:
    stem = Path(filename).stem
    for suffix in ("_modified", "_original"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem


def fake_speaker_of(entry: dict, target_index: int) -> int | None:
    """从 modify_config 的 original_dialogue 里读出目标句的说话人（0/1）。"""
    text = entry.get("original_dialogue") or ""
    for line in text.splitlines():
        match = re.match(r"\[(\d+)\]\s*Speaker\s*(\d+)\s*:", line)
        if match and int(match.group(1)) == int(target_index):
            return int(match.group(2))
    return None


def sample_split(
    root: Path, split: str, ratio: float, seed: int, per_stratum_min: int = 5
) -> dict:
    metadata = root / "daily_talk_edit" / "metadata"
    rows = read_jsonl(metadata / f"{split}.jsonl")
    with open(metadata / "modify_config_pipeline.json", "r", encoding="utf-8") as handle:
        config = json.load(handle)

    strata: dict[str, list[str]] = {"0": [], "1": [], "unknown": []}
    for row in rows:
        dialog_id = dialog_id_of(str(row.get("filename", "")))
        entry = config.get(dialog_id) or {}
        target = entry.get("target_utterance_idx")
        speaker = fake_speaker_of(entry, int(target)) if target is not None else None
        key = "unknown" if speaker is None else str(speaker)
        strata[key].append(dialog_id)

    rng = random.Random(seed)
    picked: list[str] = []
    detail: dict[str, dict] = {}
    for name, items in strata.items():
        if not items:
            detail[name] = {"n_total": 0, "n_picked": 0}
            continue
        take = max(per_stratum_min, int(round(len(items) * ratio))) if ratio < 1.0 else len(items)
        take = min(take, len(items))
        chosen = sorted(rng.sample(items, take), key=lambda value: int(value))
        picked.extend(chosen)
        detail[name] = {"n_total": len(items), "n_picked": take}

    picked = sorted(set(picked), key=lambda value: int(value))
    return {
        "split": split,
        "ratio": ratio,
        "seed": seed,
        "n_total": len(rows),
        "n_picked": len(picked),
        "strata": detail,
        "pairs": picked,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="按比例分层抽样对话对")
    parser.add_argument("--root", default="data/DailyTalkEdit", help="DailyTalkEdit 快照根目录")
    parser.add_argument("--splits", nargs="+", default=["val", "test"], choices=["val", "test"])
    parser.add_argument("--ratio", type=float, default=0.2, help="抽样比例，1.0 表示全量")
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--out-dir", default="data/gt")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    out_dir = Path(args.out_dir).expanduser().resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    for split in args.splits:
        payload = sample_split(root, split, args.ratio, args.seed)
        path = out_dir / f"sample_{split}.json"
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        print(
            f"[sample] {split}: {payload['n_picked']}/{payload['n_total']} 对 -> {path}  "
            f"分层={payload['strata']}",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

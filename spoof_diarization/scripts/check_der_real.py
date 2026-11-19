#!/usr/bin/env python
"""在真实预测上对比两套 DER 实现（自实现帧近似 vs pyannote.metrics）。

用法：
    python scripts/check_der_real.py [--gt data/gt/val.jsonl] [--results outputs/val] [--n 4]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from spoofdiar import gtbuild, metrics  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--gt", default="data/gt/val.jsonl")
    parser.add_argument("--results", default="outputs/val")
    parser.add_argument("--n", type=int, default=4)
    parser.add_argument("--collar", type=float, default=0.25)
    args = parser.parse_args()

    records = gtbuild.load_split(args.gt)
    results = Path(args.results)
    shown = 0
    for record in records:
        path = results / record["file_id"] / "result.json"
        if not path.is_file():
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        hyp = {
            str(speaker["id"]): [tuple(float(v) for v in pair) for pair in speaker["segments"]]
            for speaker in payload.get("speakers", [])
        }
        mine = metrics.diarization_error_rate(
            record["turns"], hyp, float(record["duration"]), collar=args.collar, step=0.01
        )
        theirs = metrics.der_with_pyannote(record["turns"], hyp, collar=args.collar)
        print(
            f"{record['file_id']:>16s} fallback={mine.get('der')} "
            f"(miss={mine.get('miss')} fa={mine.get('false_alarm')} conf={mine.get('confusion')} "
            f"ref_sec={mine.get('scored_seconds')})  "
            f"pyannote={None if theirs is None else theirs.get('der')}",
            flush=True,
        )
        shown += 1
        if shown >= args.n:
            break
    if shown == 0:
        print("没有找到可对比的结果", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

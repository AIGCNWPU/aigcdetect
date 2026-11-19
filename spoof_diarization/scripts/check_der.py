#!/usr/bin/env python
"""用合成数据校验 DER 实现：自写帧近似 vs pyannote.metrics。

四个用例，两套实现应当给出相同结论：
    1. 完全一致          -> 0
    2. A/B 标签互换      -> 0（最优配对应当纠回来）
    3. 一个说话人整体偏移 1s -> 相同且 > 0
    4. 少预测一段        -> miss > 0

用法：python scripts/check_der.py
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from spoofdiar import metrics  # noqa: E402

DURATION = 10.0
TURNS = [
    {"start": 0.0, "end": 2.0, "speaker": 0},
    {"start": 2.0, "end": 4.0, "speaker": 1},
    {"start": 4.0, "end": 6.0, "speaker": 0},
    {"start": 6.0, "end": 8.0, "speaker": 1},
    {"start": 8.0, "end": 10.0, "speaker": 0},
]


def run(name: str, hyp: dict[str, list[list[float]]]) -> None:
    mine = metrics.diarization_error_rate(TURNS, hyp, DURATION, collar=0.0, step=0.01)
    theirs = metrics.der_with_pyannote(TURNS, hyp, collar=0.0)
    print(
        f"{name:26s} fallback der={mine.get('der')} "
        f"(miss={mine.get('miss')} fa={mine.get('false_alarm')} conf={mine.get('confusion')})"
        f"   pyannote der={None if theirs is None else theirs.get('der')}"
    )


def main() -> int:
    perfect = {"A": [[0, 2], [4, 6], [8, 10]], "B": [[2, 4], [6, 8]]}
    swapped = {"A": [[2, 4], [6, 8]], "B": [[0, 2], [4, 6], [8, 10]]}
    shifted = {"A": [[0, 2], [5, 7], [8, 10]], "B": [[2, 4], [6, 8]]}
    missing = {"A": [[0, 2], [4, 6]], "B": [[2, 4], [6, 8]]}

    run("1 perfect", perfect)
    run("2 swapped labels", swapped)
    run("3 speaker-0 shifted 1s", shifted)
    run("4 missing last segment", missing)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

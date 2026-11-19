"""通用工具：区间运算、JSON 读写、随机种子、时间格式化。

区间统一用 `(start, end)` 的二元组表示，单位秒，左闭右开近似处理
（音频上按采样点取整，误差不超过 1 帧）。
"""
from __future__ import annotations

import json
import math
import os
import random
import re
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Iterable, Sequence

Interval = tuple[float, float]


# --------------------------------------------------------------------------- #
# 区间
# --------------------------------------------------------------------------- #
def merge_intervals(intervals: Iterable[Sequence[float]], min_gap: float = 0.0) -> list[Interval]:
    """排序并合并重叠/相邻（间隔 <= min_gap）的区间。"""
    items = sorted((float(s), float(e)) for s, e in intervals if float(e) > float(s))
    if not items:
        return []
    merged: list[Interval] = [items[0]]
    for start, end in items[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + min_gap:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))
    return merged


def clip_intervals(intervals: Iterable[Sequence[float]], start: float, end: float) -> list[Interval]:
    """裁剪到 [start, end]，丢弃裁空的区间。"""
    out: list[Interval] = []
    for s, e in merge_intervals(intervals):
        cs, ce = max(s, start), min(e, end)
        if ce > cs:
            out.append((cs, ce))
    return out


def complement_intervals(intervals: Iterable[Sequence[float]], start: float, end: float) -> list[Interval]:
    """[start, end] 里不属于 intervals 的部分。"""
    if end <= start:
        return []
    merged = clip_intervals(intervals, start, end)
    out: list[Interval] = []
    cursor = float(start)
    for s, e in merged:
        if s > cursor:
            out.append((cursor, s))
        cursor = max(cursor, e)
    if cursor < end:
        out.append((cursor, float(end)))
    return out


def total_duration(intervals: Iterable[Sequence[float]]) -> float:
    return float(sum(max(0.0, e - s) for s, e in merge_intervals(intervals)))


def overlap_duration(a: Iterable[Sequence[float]], b: Iterable[Sequence[float]]) -> float:
    """两组区间的交集总长。"""
    left = merge_intervals(a)
    right = merge_intervals(b)
    i = j = 0
    total = 0.0
    while i < len(left) and j < len(right):
        ls, le = left[i]
        rs, re = right[j]
        start, end = max(ls, rs), min(le, re)
        if end > start:
            total += end - start
        if le <= re:
            i += 1
        else:
            j += 1
    return float(total)


def intersect_len_with_interval(segment: Sequence[float], intervals: Iterable[Sequence[float]]) -> float:
    return overlap_duration([segment], intervals)


def covered_length_by(intervals: Iterable[Sequence[float]], reference: Sequence[float]) -> float:
    return overlap_duration(intervals, [reference])


def subtract_intervals(a: Iterable[Sequence[float]], b: Iterable[Sequence[float]]) -> list[Interval]:
    """a - b。"""
    left = merge_intervals(a)
    right = merge_intervals(b)
    out: list[Interval] = []
    for s, e in left:
        cursor = s
        for rs, re_ in right:
            if re_ <= cursor:
                continue
            if rs >= e:
                break
            if rs > cursor:
                out.append((cursor, min(rs, e)))
            cursor = max(cursor, min(re_, e))
            if cursor >= e:
                break
        if cursor < e:
            out.append((cursor, e))
    return out


def sample_index(seconds: float, sample_rate: int) -> int:
    return int(round(float(seconds) * int(sample_rate)))


def seconds_range(start: float, end: float, step: float) -> list[float]:
    if step <= 0:
        raise ValueError("step 必须为正")
    count = int(max(0, end - start) / step)
    return [start + i * step for i in range(count + 1)]


# --------------------------------------------------------------------------- #
# 文件
# --------------------------------------------------------------------------- #
def ensure_dir(path: str | os.PathLike[str]) -> Path:
    target = Path(path)
    target.mkdir(parents=True, exist_ok=True)
    return target


def write_json(path: str | os.PathLike[str], payload: Any, indent: int = 2) -> Path:
    """原子写入：先写临时文件再替换，避免中断留下半个 JSON。"""
    target = Path(path)
    ensure_dir(target.parent)
    fd, tmp_name = tempfile.mkstemp(prefix=target.name + ".", suffix=".tmp", dir=str(target.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=indent)
            handle.write("\n")
        os.replace(tmp_name, target)
    except BaseException:
        if os.path.exists(tmp_name):
            os.remove(tmp_name)
        raise
    return target


def read_json(path: str | os.PathLike[str], default: Any = None) -> Any:
    target = Path(path)
    if not target.is_file():
        return default
    with open(target, "r", encoding="utf-8") as handle:
        return json.load(handle)


def read_jsonl(path: str | os.PathLike[str]) -> list[dict[str, Any]]:
    target = Path(path)
    if not target.is_file():
        return []
    rows: list[dict[str, Any]] = []
    with open(target, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: str | os.PathLike[str], rows: Iterable[dict[str, Any]]) -> Path:
    target = Path(path)
    ensure_dir(target.parent)
    with open(target, "w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
    return target


def relpath(path: str | os.PathLike[str], base: str | os.PathLike[str] | None = None) -> str:
    try:
        target = Path(path).resolve()
        base_path = Path(base).resolve() if base else Path.cwd()
        return str(target.relative_to(base_path))
    except (ValueError, OSError):
        return str(path)


# --------------------------------------------------------------------------- #
# 其他
# --------------------------------------------------------------------------- #
def set_seed(seed: int) -> None:
    random.seed(seed)
    try:
        import numpy as np

        np.random.seed(seed % (2**32 - 1))
    except ImportError:  # pragma: no cover
        pass
    try:
        import torch

        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)
    except ImportError:  # pragma: no cover
        pass


def natural_key(text: str) -> list[Any]:
    """'10_2' 排在 '9_3' 之后。"""
    return [int(part) if part.isdigit() else part.lower() for part in re.split(r"(\d+)", str(text))]


def safe_name(text: str) -> str:
    cleaned = re.sub(r"[^0-9A-Za-z_.-]+", "_", str(text)).strip("_")
    return cleaned or "item"


def now_stamp() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def log(message: str, *, stream=None) -> None:
    print(message, file=stream or sys.stderr, flush=True)


def fmt_seconds(value: float) -> str:
    return f"{value:.2f}s"


def json_round(value: Any, digits: int = 4) -> Any:
    """递归四舍五入，避免 JSON 里出现 0.30000000000000004 这类噪声。"""
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, digits)
    if isinstance(value, dict):
        return {k: json_round(v, digits) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_round(v, digits) for v in value]
    return value

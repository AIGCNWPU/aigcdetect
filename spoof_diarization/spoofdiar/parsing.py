"""HoliAntiSpoof 输出的容错解析。

模型输出是 JSON 文本，但字段名与时间格式在模型卡里没有写死，所以这里：
    * 先用 JSONDecoder.raw_decode 找第一个完整对象（能容忍前后缀说明文字）；
    * 解析失败时退回正则，至少把 real_or_fake / 时间区间捞出来；
    * 时间支持 [s, e]、[[s,e], ...]、{"start":..,"end":..}、"0:12.3"、"all" 等写法。
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable, Sequence

from .utils import Interval, overlap_duration

REGION_KEYS = (
    "fake_region",
    "fake_regions",
    "spoof_region",
    "spoofing_region",
    "spoofing_time_region",
    "spoofed_region",
    "modification_region",
    "time_region",
    "region",
)

DECISION_KEYS = ("real_or_fake", "label", "decision", "verdict")

ALL_TOKENS = {"all", "entire", "whole", "full", "all of it", "whole clip", "entire clip"}


# --------------------------------------------------------------------------- #
# JSON
# --------------------------------------------------------------------------- #
def parse_model_output(raw_text: str) -> tuple[dict[str, Any], str | None]:
    """返回 (parsed, error)。解析失败时 parsed 为尽量补齐的字典。"""
    text = (raw_text or "").strip()
    if not text:
        return {}, "empty output"

    start = text.find("{")
    while start != -1:
        try:
            obj, _ = json.JSONDecoder().raw_decode(text[start:])
        except json.JSONDecodeError:
            obj = None
        if isinstance(obj, dict):
            return obj, None
        start = text.find("{", start + 1)

    # JSON 不合法（常见：键没加引号）时用正则兜底
    fallback: dict[str, Any] = {}
    match = re.search(r"real_or_fake\"?\s*[:=]\s*\"?\s*(real|fake)", text, re.IGNORECASE)
    if match:
        fallback["real_or_fake"] = match.group(1).lower()
    match = re.search(r"spoof_method\"?\s*[:=]\s*\"([^\"]+)\"", text)
    if match:
        fallback["spoof_method"] = match.group(1)
    match = re.search(r"fake_region\"?\s*[:=]\s*(\[[^\]]*\]|.+?)(?:\n|$)", text)
    if match:
        fallback["fake_region"] = match.group(1).strip()
    return fallback, "json decode failed"


def decision_text(parsed: dict[str, Any]) -> str | None:
    for key in DECISION_KEYS:
        value = parsed.get(key)
        if isinstance(value, str):
            lowered = value.strip().lower()
            if lowered.startswith("fake") or lowered.startswith("real"):
                return "fake" if lowered.startswith("fake") else "real"
        if isinstance(value, bool):
            return "fake" if value else "real"
    return None


# --------------------------------------------------------------------------- #
# 时间
# --------------------------------------------------------------------------- #
def parse_time_value(value: Any) -> float | None:
    """把 12.3 / "12.3" / "12.3s" / "0:12.3" / "00:01:02.5" 统一成秒。"""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if not isinstance(value, str):
        return None
    text = value.strip().lower().rstrip("s").strip()
    if not text:
        return None
    if ":" in text:
        parts = text.split(":")
        try:
            numbers = [float(part) for part in parts]
        except ValueError:
            return None
        seconds = 0.0
        for number in numbers:
            seconds = seconds * 60.0 + number
        return seconds
    try:
        return float(text)
    except ValueError:
        return None


def _normalize_pair(value: Any) -> Interval | None:
    if isinstance(value, dict):
        start = parse_time_value(value.get("start", value.get("begin", value.get("from"))))
        end = parse_time_value(value.get("end", value.get("stop", value.get("to"))))
        if start is None or end is None:
            return None
        return (min(start, end), max(start, end))
    if isinstance(value, (list, tuple)) and len(value) == 2:
        start = parse_time_value(value[0])
        end = parse_time_value(value[1])
        if start is None or end is None:
            return None
        return (min(start, end), max(start, end))
    return None


def normalize_regions(value: Any, duration: float | None = None) -> list[Interval]:
    """把各种写法统一成 [[s, e], ...]（秒，已裁剪、已排序）。"""
    raw: list[Interval] = []

    if value is None:
        return []

    if isinstance(value, str):
        text = value.strip().lower()
        if not text or text in {"none", "null", "[]", "no", "n/a"}:
            return []
        if text in ALL_TOKENS:
            return [(0.0, float(duration))] if duration else []
        # 抓 [a, b] 或 a - b 或 a~b 里的数字
        for chunk in re.findall(r"\[[^\]]*\]|[\d.]+\s*(?:-|~|to)\s*[\d.]+|[\d.]+", text):
            numbers = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", chunk) if x not in {"", "."}]
            if len(numbers) >= 2:
                raw.append((numbers[0], numbers[1]))
        if not raw:
            return []
    elif isinstance(value, dict):
        pair = _normalize_pair(value)
        if pair:
            raw.append(pair)
        elif isinstance(value.get("regions"), (list, tuple)):
            raw = normalize_regions(value["regions"], duration)
        else:
            return []
    elif isinstance(value, (list, tuple)):
        pair = _normalize_pair(value)
        if pair:
            raw.append(pair)
        else:
            for item in value:
                item_pair = _normalize_pair(item)
                if item_pair:
                    raw.append(item_pair)
                elif isinstance(item, (list, tuple)):
                    raw.extend(normalize_regions(item, duration))
    else:
        return []

    cleaned: list[Interval] = []
    for start, end in raw:
        if duration is not None:
            start = max(0.0, min(float(duration), start))
            end = max(0.0, min(float(duration), end))
        if end - start > 1e-3:
            cleaned.append((round(start, 3), round(end, 3)))
    return sorted(cleaned)


def find_region_value(parsed: dict[str, Any], depth: int = 0) -> Any:
    """在解析结果里找时间区间字段（允许嵌套一层）。"""
    for key in REGION_KEYS:
        if key in parsed:
            return parsed[key]
    if depth >= 1:
        return None
    for value in parsed.values():
        if isinstance(value, dict):
            found = find_region_value(value, depth + 1)
            if found is not None:
                return found
    return None


def extract_regions(parsed: dict[str, Any], duration: float | None = None) -> list[Interval]:
    return normalize_regions(find_region_value(parsed), duration)


def filter_regions_by_overlap(
    regions: Iterable[Sequence[float]],
    segments: Iterable[Sequence[float]],
    min_ratio: float = 0.1,
    min_seconds: float = 0.05,
) -> list[Interval]:
    """只保留与该说话人片段有实质交集的区间。

    落在掩码底噪里的区间是误报（本来就不是这个人说的话），
    这里丢掉但原样留在 fake_regions_raw 里备查。
    """
    seg_list = [(float(s), float(e)) for s, e in segments]
    kept: list[Interval] = []
    for start, end in regions:
        start, end = float(start), float(end)
        length = end - start
        if length <= 0:
            continue
        shared = overlap_duration([(start, end)], seg_list)
        if shared <= 0:
            continue
        if shared >= min_seconds and shared >= min_ratio * length:
            kept.append((round(start, 3), round(end, 3)))
    return kept

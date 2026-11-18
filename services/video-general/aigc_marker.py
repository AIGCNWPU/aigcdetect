"""AI 生成标识的前置判定。

依次检查文件名、容器元数据标签、文件内嵌标识串。命中强标识时，调用方
直接把整片判定为 AI 生成，同时仍继续执行模型检测，用于定位可疑片段。
模块只读文件，不修改上传内容。
"""
from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("video-general.aigc-marker")

PROBE_TIMEOUT = 10
MAX_LABEL_CHARS = 80
RAW_HEAD_BYTES = 2 * 1024 * 1024
RAW_TAIL_BYTES = 8 * 1024 * 1024

# 只匹配明确的生成标识，避免把普通 "AI教程" 等真实视频误判。
_PATTERNS = [
    ("AIGC", re.compile(r"aigc", re.I)),
    (
        "AI生成",
        re.compile(
            r"ai\s*生成|ai生成内容|由\s*ai\s*生成|人工智能生成|ai\s*创作|ai\s*合成|ai\s*换脸",
            re.I,
        ),
    ),
    (
        "AI生成",
        re.compile(
            r"ai[\s_-]*generated|ai[\s_-]*generation|"
            r"(?:generated|created)\s+(?:by|with|using)\s+ai",
            re.I,
        ),
    ),
    ("AI生成", re.compile(r"synthetic\s+(?:video|media)|deepfake", re.I)),
]


@dataclass(frozen=True)
class AigcMarker:
    """命中的 AI 生成标识。source 为 filename / metadata / embedded。"""

    source: str
    label: str


def detect_aigc_marker(path: str | Path, filename: str | None = None) -> AigcMarker | None:
    """返回命中的标识；未命中或读取失败时返回 None。"""
    name = Path(filename or str(path)).name
    matched = _match_text(name)
    if matched:
        return AigcMarker(source="filename", label=f"文件名包含“{_short(matched)}”")

    path = Path(path)
    for key, value in _probe_metadata(path):
        matched = _match_text(f"{key} {value}")
        if matched:
            return AigcMarker(
                source="metadata",
                label=f"元数据 {_short(f'{key}={value}')}",
            )

    matched = _scan_embedded(path)
    if matched:
        return AigcMarker(source="embedded", label=f"文件内嵌标识“{_short(matched)}”")
    return None


def apply_aigc_marker(
    result: dict,
    marker: AigcMarker | None,
    probability: float = 1.0,
) -> dict:
    """命中标识后覆盖风险与总体概率；模型原始得分保留在 meta 中。"""
    if not isinstance(result, dict) or marker is None:
        return result
    try:
        probability = float(probability)
    except (TypeError, ValueError):
        probability = 1.0
    probability = max(0.0, min(1.0, probability))

    meta = result.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        result["meta"] = meta

    if isinstance(meta.get("videoScore"), (int, float)):
        meta["modelVideoScore"] = meta["videoScore"]
    meta["modelRisk"] = result.get("risk")
    meta["videoScore"] = probability
    meta["aiMarker"] = {"source": marker.source, "label": marker.label}
    result["risk"] = "high"

    text = (
        f"检测到 AI 生成标识（{marker.label}），"
        f"已直接判定为 AI 生成视频（AI概率 {round(probability * 100)}%）。"
    )
    result["summary"] = text + (result.get("summary") or "")
    findings = [item for item in (result.get("findings") or []) if isinstance(item, str)]
    result["findings"] = ([text] + findings)[:12]
    return result


def _match_text(text: str) -> str | None:
    for label, pattern in _PATTERNS:
        if pattern.search(text):
            return label
    return None


def _short(text: str) -> str:
    text = re.sub(r"\s+", " ", str(text)).strip()
    return text if len(text) <= MAX_LABEL_CHARS else text[: MAX_LABEL_CHARS - 1] + "…"


def _ffprobe_path() -> str | None:
    candidates = [os.environ.get("FFPROBE_PATH"), shutil.which("ffprobe")]
    conda_prefix = os.environ.get("CONDA_PREFIX")
    if conda_prefix:
        candidates.append(str(Path(conda_prefix) / "bin" / "ffprobe"))
    for candidate in candidates:
        if candidate and Path(candidate).is_file():
            return candidate
    return None


def _probe_metadata(path: Path) -> list[tuple[str, str]]:
    ffprobe = _ffprobe_path()
    if not ffprobe:
        return []
    try:
        completed = subprocess.run(
            [ffprobe, "-v", "error", "-show_format", "-show_streams", "-of", "json", str(path)],
            capture_output=True,
            text=True,
            timeout=PROBE_TIMEOUT,
            check=False,
        )
        if completed.returncode != 0:
            return []
        payload = json.loads(completed.stdout or "{}")
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError):
        return []

    entries: list[tuple[str, str]] = []
    for key, value in ((payload.get("format") or {}).get("tags") or {}).items():
        entries.append((str(key), str(value)))
    for stream in payload.get("streams") or []:
        for key, value in (stream.get("tags") or {}).items():
            entries.append((str(key), str(value)))
    return entries


def _scan_embedded(path: Path) -> str | None:
    """扫描文件首尾的标识串，覆盖 ffprobe 未暴露的 udta/meta 标签。"""
    try:
        size = path.stat().st_size
        if size <= 0:
            return None
        if size <= RAW_HEAD_BYTES + RAW_TAIL_BYTES:
            data = path.read_bytes()
        else:
            with path.open("rb") as handle:
                head = handle.read(RAW_HEAD_BYTES)
                handle.seek(size - RAW_TAIL_BYTES)
                tail = handle.read()
            data = head + b"\n" + tail
    except OSError:
        return None
    return _match_text(data.decode("utf-8", errors="ignore"))

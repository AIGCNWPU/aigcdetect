"""音频读写：统一用 soundfile，保持采样率、声道数、子类型不变。"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import numpy as np
import soundfile as sf


def read_audio(path: str | os.PathLike[str], dtype: str = "float32") -> tuple[np.ndarray, int]:
    """读成 (frames, channels) 的二维数组。

    二维化是刻意的：后续所有按区间切片、按帧数校验的代码都不用再区分单/双声道。
    """
    data, sample_rate = sf.read(str(path), dtype=dtype, always_2d=True)
    return np.ascontiguousarray(data), int(sample_rate)


def audio_info(path: str | os.PathLike[str]) -> dict[str, Any]:
    """探测音频属性；格式用 soundfile 的命名（samplerate / frames / channels / subtype）。"""
    info = sf.info(str(path))
    return {
        "path": str(Path(path).resolve()),
        "samplerate": int(info.samplerate),
        "channels": int(info.channels),
        "frames": int(info.frames),
        "duration": float(info.frames) / float(info.samplerate) if info.samplerate else 0.0,
        "subtype": info.subtype,
        "format": info.format,
    }


def duration_seconds(path: str | os.PathLike[str]) -> float:
    return audio_info(path)["duration"]


def write_audio(
    path: str | os.PathLike[str],
    data: np.ndarray,
    sample_rate: int,
    subtype: str | None = None,
) -> Path:
    """写 wav；data 为 (frames, channels) 或一维。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    array = np.asarray(data)
    if array.ndim == 1:
        array = array[:, None]
    if not np.isfinite(array).all():
        array = np.nan_to_num(array, nan=0.0, posinf=0.0, neginf=0.0)
    array = np.clip(array, -1.0, 1.0)
    sf.write(str(target), array, int(sample_rate), subtype=subtype or "PCM_16")
    return target


def to_mono(data: np.ndarray) -> np.ndarray:
    if data.ndim == 1:
        return data.astype(np.float32, copy=False)
    return data.mean(axis=1).astype(np.float32, copy=False)


def rms_dbfs(data: np.ndarray) -> float:
    """整体电平（dBFS），静音返回 -inf。"""
    flat = np.asarray(data, dtype=np.float64).reshape(-1)
    if flat.size == 0:
        return float("-inf")
    mean_square = float(np.mean(flat**2))
    if mean_square <= 0:
        return float("-inf")
    return 10.0 * float(np.log10(mean_square))


def peak_dbfs(data: np.ndarray) -> float:
    flat = np.abs(np.asarray(data, dtype=np.float64).reshape(-1))
    if flat.size == 0:
        return float("-inf")
    peak = float(flat.max())
    if peak <= 0:
        return float("-inf")
    return 20.0 * float(np.log10(peak))

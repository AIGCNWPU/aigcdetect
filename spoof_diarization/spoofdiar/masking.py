"""静音掩码：把对方的语音替换成底噪，得到与原音频等长的单人音轨。

做法（对应 TASK_SPEC 3.2）：

1. 说话人 S 的每个片段首尾各外扩 pad，但外扩部分不得进入另一个人的片段；
2. 其余位置用底噪填充：从"两人都不说话"的片段里取素材循环铺满，
   素材总长不足 0.5 s 时退化成 -60 dBFS 白噪声；
3. 每个保留片段首尾做 fade 交叉淡化（语声 <-> 底噪），不是淡到 0。

所有长度都按采样帧计算，保证输出与原音频帧数完全相等。
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable, Sequence

import numpy as np

from . import audio as audio_io
from .utils import Interval, complement_intervals, merge_intervals, sample_index, total_duration


@dataclass
class MaskParams:
    pad: float = 0.2
    fade: float = 0.02
    fill: str = "noise"
    noise_min_segment: float = 0.1
    noise_min_total: float = 0.5
    noise_fallback_dbfs: float = -60.0

    @classmethod
    def from_config(cls, cfg: dict[str, Any]) -> "MaskParams":
        return cls(
            pad=float(cfg["mask"]["pad"]),
            fade=float(cfg["mask"]["fade"]),
            fill=str(cfg["mask"]["fill"]),
            noise_min_segment=float(cfg["mask"]["noise"]["min_segment"]),
            noise_min_total=float(cfg["mask"]["noise"]["min_total"]),
            noise_fallback_dbfs=float(cfg["mask"]["noise"]["fallback_dbfs"]),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "pad": self.pad,
            "fade": self.fade,
            "fill": self.fill,
            "noise_min_segment": self.noise_min_segment,
            "noise_min_total": self.noise_min_total,
            "noise_fallback_dbfs": self.noise_fallback_dbfs,
        }


@dataclass
class MaskResult:
    speaker: str
    audio: np.ndarray
    kept: list[Interval]
    info: dict[str, Any]


# --------------------------------------------------------------------------- #
# 1. 保留区间
# --------------------------------------------------------------------------- #
def plan_kept_intervals(
    speech: Iterable[Sequence[float]],
    other: Iterable[Sequence[float]],
    pad: float,
    total: float,
) -> list[Interval]:
    """给 speech 的片段加 pad，且不越过 other 的片段。

    对每个片段 [s, e]：
        left  = max(0, s - pad, other 中在 s 之前结束的最后一个片段的结束时间)
        right = min(total, e + pad, other 中在 e 之后开始的第一个片段的开始时间)
    """
    own = merge_intervals(speech)
    other_segments = merge_intervals(other)
    starts = [s for s, _ in other_segments]
    ends = [e for _, e in other_segments]

    kept: list[Interval] = []
    for start, end in own:
        left = start - pad
        before = [e for e in ends if e <= start]
        if before:
            left = max(left, max(before))
        right = end + pad
        after = [s for s in starts if s >= end]
        if after:
            right = min(right, min(after))
        left = max(0.0, left)
        right = min(float(total), right)
        if right > left:
            kept.append((left, right))
    return merge_intervals(kept)


# --------------------------------------------------------------------------- #
# 2. 底噪
# --------------------------------------------------------------------------- #
def silence_intervals(segments: dict[str, Iterable[Sequence[float]]], total: float) -> list[Interval]:
    """两人都不说话的时间段。"""
    spoken: list[Sequence[float]] = []
    for value in segments.values():
        spoken.extend(value)
    return complement_intervals(spoken, 0.0, total)


def build_noise_track(
    samples: np.ndarray,
    sample_rate: int,
    silence: Iterable[Sequence[float]],
    params: MaskParams,
    rng: np.random.Generator,
) -> tuple[np.ndarray, dict[str, Any]]:
    """生成与 samples 等长的底噪音轨。"""
    total_frames = samples.shape[0]
    channels = samples.shape[1] if samples.ndim > 1 else 1
    info: dict[str, Any] = {"mode": params.fill}

    if params.fill == "zero":
        info.update({"source": "zeros", "bank_seconds": 0.0})
        return np.zeros_like(samples, dtype=np.float32), info

    usable = [
        (s, e)
        for s, e in merge_intervals(silence)
        if (e - s) >= params.noise_min_segment
    ]
    pieces = [
        samples[sample_index(s, sample_rate) : sample_index(e, sample_rate)]
        for s, e in usable
    ]
    pieces = [piece for piece in pieces if piece.shape[0] > 0]
    bank = np.concatenate(pieces, axis=0) if pieces else np.zeros((0, channels), np.float32)
    bank_seconds = float(bank.shape[0]) / float(sample_rate)

    if bank.shape[0] == 0 or bank_seconds < params.noise_min_total:
        amplitude = float(10.0 ** (params.noise_fallback_dbfs / 20.0))
        track = rng.normal(0.0, amplitude, size=(total_frames, channels)).astype(np.float32)
        info.update(
            {
                "source": "gaussian",
                "bank_seconds": round(bank_seconds, 3),
                "silence_intervals": len(usable),
                "dbfs": params.noise_fallback_dbfs,
                "level_dbfs": round(audio_io.rms_dbfs(track), 2),
            }
        )
        return track, info

    offset = int(rng.integers(0, bank.shape[0]))
    repeats = int(np.ceil((total_frames + offset) / float(bank.shape[0])))
    tiled = np.tile(bank, (repeats, 1))[offset : offset + total_frames]
    info.update(
        {
            "source": "silence_bank",
            "bank_seconds": round(bank_seconds, 3),
            "silence_intervals": len(usable),
            "offset_frames": offset,
            "level_dbfs": round(audio_io.rms_dbfs(tiled), 2),
        }
    )
    return tiled.astype(np.float32, copy=False), info


# --------------------------------------------------------------------------- #
# 3. 合成
# --------------------------------------------------------------------------- #
def _fade_profile(length: int, fade_frames: int) -> np.ndarray:
    """语声权重：两端 0 -> 1 -> 0，中间恒 1。"""
    weight = np.ones(length, dtype=np.float32)
    ramp = min(fade_frames, length // 2)
    if ramp <= 0:
        return weight
    # 半余弦过渡比线性更平滑，听感上不会有"咔"声
    curve = (0.5 - 0.5 * np.cos(np.linspace(0.0, np.pi, ramp, dtype=np.float32))).astype(np.float32)
    weight[:ramp] = curve
    weight[length - ramp :] = curve[::-1]
    return weight


def composite_speaker(
    samples: np.ndarray,
    kept: Iterable[Sequence[float]],
    noise: np.ndarray,
    fade: float,
    sample_rate: int,
) -> np.ndarray:
    """底噪打底，保留区间贴上语声，边界与底噪交叉淡化。"""
    out = np.array(noise, dtype=np.float32, copy=True)
    fade_frames = max(0, int(round(fade * sample_rate)))
    total_frames = out.shape[0]

    for start, end in merge_intervals(kept):
        i0 = max(0, min(total_frames, sample_index(start, sample_rate)))
        i1 = max(i0, min(total_frames, sample_index(end, sample_rate)))
        length = i1 - i0
        if length <= 0:
            continue
        speech = samples[i0:i1]
        weight = _fade_profile(length, fade_frames)
        # 单声道时 weight[:, None] 与 (length,) 对齐；多声道时逐声道同权重
        if out.ndim > 1:
            weight_2d = weight[:, None]
        else:  # pragma: no cover - 内部始终传二维
            weight_2d = weight
        out[i0:i1] = speech * weight_2d + out[i0:i1] * (1.0 - weight_2d)
    return out


# --------------------------------------------------------------------------- #
# 4. 对外入口
# --------------------------------------------------------------------------- #
def build_masks(
    samples: np.ndarray,
    sample_rate: int,
    segments: dict[str, Iterable[Sequence[float]]],
    params: MaskParams,
    seed: int = 1234,
) -> tuple[dict[str, MaskResult], dict[str, Any]]:
    """对每个说话人生成一条掩码音轨。

    返回 (results, meta)。meta 里有自检信息，写进 mask_meta.json。
    """
    if samples.ndim == 1:
        samples = samples[:, None]
    total_frames = int(samples.shape[0])
    total = float(total_frames) / float(sample_rate)
    rng = np.random.default_rng(seed)

    silence = silence_intervals(segments, total)
    noise, noise_info = build_noise_track(samples, sample_rate, silence, params, rng)

    results: dict[str, MaskResult] = {}
    warnings: list[str] = []
    for speaker in sorted(segments.keys()):
        own = merge_intervals(segments[speaker])
        other: list[Interval] = []
        for name, value in segments.items():
            if name != speaker:
                other.extend(list(value))
        kept = plan_kept_intervals(own, other, params.pad, total)
        if not kept:
            warnings.append(f"说话人 {speaker} 没有可用语音片段，输出为纯底噪")
        track = composite_speaker(samples, kept, noise, params.fade, sample_rate)
        results[speaker] = MaskResult(
            speaker=speaker,
            audio=track,
            kept=kept,
            info={
                "segments": len(own),
                "speech_seconds": round(total_duration(own), 3),
                "kept_seconds": round(total_duration(kept), 3),
                "kept_intervals": [[round(s, 3), round(e, 3)] for s, e in kept],
            },
        )

    meta = {
        "sample_rate": int(sample_rate),
        "channels": int(samples.shape[1]),
        "duration": round(total, 4),
        "frames": total_frames,
        "params": params.as_dict(),
        "noise": noise_info,
        "warnings": warnings,
    }
    return results, meta

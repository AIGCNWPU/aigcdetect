"""波形对比图：原音频 / A / B 上下对齐，存到 debug/ 供人工检查。"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

from . import audio as audio_io


def _envelope(signal: np.ndarray, buckets: int = 4000) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """把长信号压成 (中心位置, 每桶最大值, 每桶最小值)，保留峰值。"""
    flat = np.asarray(signal, dtype=np.float32).reshape(-1)
    length = flat.size
    if length == 0:
        return np.zeros(0), np.zeros(0), np.zeros(0)
    if length <= buckets:
        index = np.arange(length)
        return index.astype(np.float64), flat, flat
    width = length // buckets
    trimmed = flat[: width * buckets].reshape(buckets, width)
    centers = (np.arange(buckets) + 0.5) * width
    return centers.astype(np.float64), trimmed.max(axis=1), trimmed.min(axis=1)


def plot_panels(
    panels: Sequence[tuple[str, np.ndarray]],
    sample_rate: int,
    path: str | Path,
    title: str = "",
    shades: Iterable[tuple[float, float]] | None = None,
) -> Path:
    """多面板波形图，共用时间轴。"""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)

    figure, axes = plt.subplots(
        len(panels), 1, figsize=(12, 2.2 * max(1, len(panels))), sharex=True
    )
    if len(panels) == 1:
        axes = [axes]

    for axis, (label, signal) in zip(axes, panels):
        centers, upper, lower = _envelope(signal)
        times = centers / float(sample_rate)
        axis.fill_between(times, lower, upper, color="#2b6cb0", linewidth=0.0, alpha=0.85)
        axis.set_ylabel(label, rotation=0, ha="right", va="center", fontsize=9)
        axis.set_ylim(-1.02, 1.02)
        axis.grid(True, linestyle=":", linewidth=0.4, alpha=0.5)
        axis.tick_params(labelsize=8)
        for start, end in shades or []:
            axis.axvspan(start, end, color="#f6ad55", alpha=0.18, linewidth=0)

    axes[-1].set_xlabel("time (s)", fontsize=9)
    if title:
        axes[0].set_title(title, fontsize=10)
    figure.tight_layout()
    figure.savefig(target, dpi=110)
    plt.close(figure)
    return target


def save_mask_figure(
    original_path: str | Path,
    masked: dict[str, str | Path],
    sample_rate: int,
    path: str | Path,
    title: str = "",
    speaker_segments: dict[str, list[Sequence[float]]] | None = None,
) -> Path:
    """原音频 + 每个说话人的掩码音轨。"""
    original, _ = audio_io.read_audio(original_path)
    panels: list[tuple[str, np.ndarray]] = [("original", audio_io.to_mono(original))]
    for name in sorted(masked):
        data, _ = audio_io.read_audio(masked[name])
        panels.append((name, audio_io.to_mono(data)))

    shades: list[tuple[float, float]] = []
    if speaker_segments:
        for segments in speaker_segments.values():
            shades.extend((float(start), float(end)) for start, end in segments)

    return plot_panels(panels, sample_rate, path, title=title, shades=shades)


def plot_confusion_matrix(
    matrix: dict[str, dict[str, int]],
    rows: Sequence[str],
    columns: Sequence[str],
    path: str | Path,
    title: str = "file-level confusion matrix",
) -> Path:
    """混淆矩阵热力图（标签用英文，避免服务器缺中文字体）。"""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    values = np.array([[matrix.get(row, {}).get(column, 0) for column in columns] for row in rows], dtype=int)

    figure, axis = plt.subplots(figsize=(1.6 * len(columns) + 2.2, 1.2 * len(rows) + 1.8))
    image = axis.imshow(values, cmap="Blues")
    axis.set_xticks(range(len(columns)), list(columns), fontsize=9)
    axis.set_yticks(range(len(rows)), list(rows), fontsize=9)
    axis.set_xlabel("predicted", fontsize=9)
    axis.set_ylabel("ground truth", fontsize=9)
    axis.set_title(title, fontsize=10)

    threshold = values.max() / 2.0 if values.size else 0.0
    for i in range(values.shape[0]):
        for j in range(values.shape[1]):
            axis.text(
                j,
                i,
                str(int(values[i, j])),
                ha="center",
                va="center",
                fontsize=10,
                color="white" if values[i, j] > threshold else "#1a202c",
            )
    figure.colorbar(image, ax=axis, fraction=0.046, pad=0.04)
    figure.tight_layout()
    figure.savefig(target, dpi=120)
    plt.close(figure)
    return target

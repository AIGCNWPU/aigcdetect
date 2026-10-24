"""提取训练特征：对 REAL/FAKE 视频逐个取视频中心 2 秒窗口（论文协议），
计算 21 维时间几何特征并写入 HDF5。

用法：python train/extract_features.py --data /path/to/restrav_training --out training_features.h5
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import h5py
import numpy as np
import torch
from tqdm import tqdm

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from restrav_core import ReStraVDetector, features_from_z  # noqa: E402


def decode_center_window(detector: ReStraVDetector, path: str):
    from torchcodec.decoders import VideoDecoder
    from torchcodec.samplers import clips_at_regular_timestamps

    decoder = VideoDecoder(path)
    duration = float(getattr(decoder.metadata, "duration_seconds", 0.0) or 0.0)
    if duration <= 0:
        raise ValueError(f"无法读取时长: {path}")
    window = min(2.0, duration)
    start = max(0.0, min(duration / 2.0 - window / 2.0, duration - window))
    clip = clips_at_regular_timestamps(
        decoder,
        num_frames_per_clip=24,
        seconds_between_frames=window / 23,
        seconds_between_clip_starts=1e9,
        sampling_range_start=start,
        sampling_range_end=min(duration, start + window),
        policy="repeat_last",
    ).data[0]
    if clip.shape[1] not in (1, 3):
        clip = clip.permute(0, 3, 1, 2)
    return clip


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True)
    parser.add_argument("--out", default="training_features.h5")
    parser.add_argument("--batch", type=int, default=32)
    parser.add_argument("--device", default="cuda:0" if torch.cuda.is_available() else "cpu")
    args = parser.parse_args()

    data = Path(args.data)
    suffixes = {".mp4", ".avi", ".webm", ".mkv", ".mov"}
    real = sorted(p for p in (data / "REAL").rglob("*") if p.suffix.lower() in suffixes)
    fake = sorted(p for p in (data / "FAKE").rglob("*") if p.suffix.lower() in suffixes)
    items = [(str(p), 1) for p in real] + [(str(p), 0) for p in fake]
    print(f"REAL {len(real)} · FAKE {len(fake)}")

    backbone = ReStraVDetector.__new__(ReStraVDetector)  # 仅用骨干网络，不加载 MLP 产物
    backbone.device = torch.device(args.device)
    backbone.backbone = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14").eval().to(backbone.device)

    valid_paths: list[str] = []
    valid_labels: list[int] = []
    valid_features: list[np.ndarray] = []
    batch_paths: list[str] = []
    batch_labels: list[int] = []
    batch_clips: list = []

    def flush() -> None:
        if not batch_clips:
            return
        z = backbone._embed_windows(batch_clips)
        feats = features_from_z(z).cpu().numpy()
        valid_features.append(feats)
        valid_paths.extend(batch_paths)
        valid_labels.extend(batch_labels)
        batch_paths.clear()
        batch_labels.clear()
        batch_clips.clear()

    for path, label in tqdm(items, desc="提取特征"):
        try:
            batch_clips.append(decode_center_window(backbone, path))
            batch_paths.append(path)
            batch_labels.append(label)
        except Exception as exc:
            tqdm.write(f"跳过 {Path(path).name}: {str(exc)[:120]}")
        if len(batch_clips) >= args.batch:
            flush()
    flush()

    features = np.concatenate(valid_features, axis=0)
    labels = np.array(valid_labels, dtype="i")
    with h5py.File(args.out, "w") as h5:
        dt = h5py.special_dtype(vlen=str)
        h5.create_dataset("path", data=np.array(valid_paths, dtype=object), dtype=dt)
        h5.create_dataset("label", data=labels)
        h5.create_dataset("features", data=features.astype("f"))
    print(f"有效样本 {len(labels)}（REAL {(labels == 1).sum()} / FAKE {(labels == 0).sum()}）→ {args.out}")


if __name__ == "__main__":
    main()

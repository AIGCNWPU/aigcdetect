"""下载 ReStraV 训练数据。

论文原配 REAL 来源（Video Similarity Challenge 的 URL 列表）对应的
dl.fbaipublicfiles.com 链接已失效（S3 AccessDenied），改用等价的公开
真实拍摄视频数据集 UCF101（13,320 段真实摄像机素材）。
FAKE 仍为 VidProM example 子集（多个文生视频模型生成）。

用法：python train/download_data.py --out /path/to/datasets/restrav_training
可选：--only real|fake、--fake-tars ms,t2vz,cog（默认三个较小生成器包）
国内网络建议 export HF_ENDPOINT=https://hf-mirror.com
"""

from __future__ import annotations

import argparse
import tarfile
import zipfile
from pathlib import Path

from huggingface_hub import hf_hub_download

UCF_REPO = "quchenyuan/UCF101-ZIP"
UCF_FILE = "UCF-101.zip"
VIDPROM_REPO = "WenhaoWang/VidProM"
DEFAULT_FAKE_TARS = ["ms_videos_example.tar", "t2vz_videos_example.tar", "cog_videos_example.tar"]

VIDEO_SUFFIXES = {".mp4", ".avi", ".webm", ".mkv", ".mov"}


def download_real(out: Path) -> None:
    real_dir = out / "REAL"
    existing = [p for p in real_dir.rglob("*") if p.suffix.lower() in VIDEO_SUFFIXES]
    if len(existing) > 1000:
        print(f"REAL 已存在 {len(existing)} 个视频，跳过下载")
        return
    real_dir.mkdir(parents=True, exist_ok=True)
    print(f"下载 {UCF_REPO}/{UCF_FILE}（约 6.96 GB）…")
    zip_path = hf_hub_download(UCF_REPO, UCF_FILE, repo_type="dataset", local_dir=out / "_downloads")
    print("解压 UCF101 …")
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(path=real_dir)
    count = len([p for p in real_dir.rglob("*") if p.suffix.lower() in VIDEO_SUFFIXES])
    print(f"REAL 完成：{count} 个真实视频")


def download_fake(out: Path, tars: list[str]) -> None:
    fake_dir = out / "FAKE"
    fake_dir.mkdir(parents=True, exist_ok=True)
    for name in tars:
        print(f"下载 VidProM example/{name} …")
        tar_path = hf_hub_download(VIDPROM_REPO, f"example/{name}", repo_type="dataset", local_dir=out / "_downloads")
        print(f"解包 {name} …")
        with tarfile.open(tar_path, "r") as tar:
            tar.extractall(path=fake_dir)
    count = len([p for p in fake_dir.rglob("*.mp4")])
    print(f"FAKE 完成：{count} 个AI生成视频")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, help="训练数据输出目录")
    parser.add_argument("--only", choices=["real", "fake"], default=None)
    parser.add_argument("--fake-tars", default=",".join(DEFAULT_FAKE_TARS), help="VidProM example tar 列表")
    args = parser.parse_args()
    out = Path(args.out)
    if args.only in (None, "real"):
        download_real(out)
    if args.only in (None, "fake"):
        download_fake(out, [t.strip() for t in args.fake_tars.split(",") if t.strip()])
    print(f"数据目录：{out.resolve()}")

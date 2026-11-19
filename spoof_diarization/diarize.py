#!/usr/bin/env python
"""说话人分离：一个 wav -> diarization.json + diarization.rttm。

用法：
    python diarize.py --input dialog.wav --out-dir outputs/single/dialog
    python diarize.py --input dialog.wav --out-dir /tmp/d --force --device cuda
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from spoofdiar import config as config_mod
from spoofdiar import utils
from spoofdiar.diarization import Diarizer


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="pyannote 两人说话人分离")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--input", required=True, help="对话音频（wav/flac..）")
    parser.add_argument("--out-dir", required=True, help="输出目录")
    parser.add_argument("--device", default=None, help="覆盖 diarization.device，如 cuda / cpu")
    parser.add_argument("--force", action="store_true", help="忽略已有 diarization.json")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    overrides = list(args.overrides)
    if args.device:
        overrides.append(f"diarization.device={args.device}")
    cfg = config_mod.load_config(args.config, overrides)

    input_path = Path(args.input)
    if not input_path.is_file():
        print(f"音频不存在：{input_path}", file=sys.stderr)
        return 2

    payload = Diarizer(cfg).run(input_path, args.out_dir, force=args.force)
    utils.log(f"[diarize] {input_path.name} -> {Path(args.out_dir) / 'diarization.json'}")
    for name, segments in payload.get("speakers", {}).items():
        utils.log(
            f"[diarize]   {name}（{payload.get('pyannote_labels', {}).get(name)}）："
            f"{len(segments)} 段，共 {utils.total_duration(segments):.2f}s"
        )
    if payload.get("diarization_warning"):
        utils.log(f"[diarize] 告警：{payload['diarization_warning']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

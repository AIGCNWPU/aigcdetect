#!/usr/bin/env python
"""静音掩码导出：原音频 + diarization.json -> A.wav / B.wav。

输出与输入**等长、同采样率、同声道数**；对方说话处换成底噪。

用法：
    python mask_export.py --input dialog.wav --diarization outputs/single/dialog --out-dir outputs/single/dialog
    python mask_export.py --input dialog.wav --diarization d/diarization.json --out-dir /tmp/m --fill zero
    python mask_export.py ... --fill zero --debug-plot        # 消融 + 波形图
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from spoofdiar import audio as audio_io
from spoofdiar import config as config_mod
from spoofdiar import utils
from spoofdiar.diarization import read_diarization
from spoofdiar.masking import MaskParams, build_masks


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="导出按说话人的静音掩码音轨")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--input", required=True, help="原始对话音频")
    parser.add_argument(
        "--diarization",
        required=True,
        help="diarization.json 或其所在目录",
    )
    parser.add_argument("--out-dir", required=True)
    parser.add_argument("--pad", type=float, default=None, help="片段外扩秒数（默认 0.2）")
    parser.add_argument("--fade", type=float, default=None, help="边界交叉淡化秒数（默认 0.02）")
    parser.add_argument("--fill", choices=["noise", "zero"], default=None, help="底噪 or 纯静音")
    parser.add_argument("--debug-plot", action="store_true", help="存一张原音频/A/B 的对比图")
    parser.add_argument("--seed", type=int, default=None, help="底噪起点随机种子")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    overrides = list(args.overrides)
    if args.pad is not None:
        overrides.append(f"mask.pad={args.pad}")
    if args.fade is not None:
        overrides.append(f"mask.fade={args.fade}")
    if args.fill is not None:
        overrides.append(f"mask.fill={args.fill}")
    cfg = config_mod.load_config(args.config, overrides)

    input_path = Path(args.input)
    if not input_path.is_file():
        print(f"音频不存在：{input_path}", file=sys.stderr)
        return 2
    diar_path = Path(args.diarization)
    if diar_path.is_dir():
        diar_path = diar_path / "diarization.json"
    payload = read_diarization(diar_path)
    segments = payload.get("speakers", {})
    if not segments:
        print(f"{diar_path} 里没有 speakers，无法导出掩码", file=sys.stderr)
        return 1

    samples, sample_rate = audio_io.read_audio(input_path)
    subtype = audio_io.audio_info(input_path)["subtype"]
    params = MaskParams.from_config(cfg)
    seed = int(args.seed if args.seed is not None else cfg["seed"])
    masks, meta = build_masks(samples, sample_rate, segments, params, seed=seed)

    out_dir = Path(args.out_dir)
    written: dict[str, Path] = {}
    for name in sorted(masks):
        path = out_dir / f"{name}.wav"
        audio_io.write_audio(path, masks[name].audio, sample_rate, subtype=subtype)
        written[name] = path
        if masks[name].audio.shape[0] != samples.shape[0]:
            print(
                f"自检失败：{name}.wav 帧数 {masks[name].audio.shape[0]} != 原音频 {samples.shape[0]}",
                file=sys.stderr,
            )
            return 1

    meta.update(
        {
            "file": str(input_path.resolve()),
            "file_id": input_path.stem,
            "length_check": {
                name: {
                    "frames": int(masks[name].audio.shape[0]),
                    "expected": int(samples.shape[0]),
                    "ok": True,
                }
                for name in sorted(masks)
            },
            "kept_intervals": {name: masks[name].info["kept_intervals"] for name in sorted(masks)},
            "kept_seconds": {name: masks[name].info["kept_seconds"] for name in sorted(masks)},
        }
    )
    utils.write_json(out_dir / "mask_meta.json", meta)

    if args.debug_plot:
        from spoofdiar.debug_plots import save_mask_figure

        figure = Path(cfg["paths"]["debug"]) / f"{input_path.stem}_mask.png"
        save_mask_figure(
            input_path,
            {name: str(path) for name, path in written.items()},
            sample_rate,
            figure,
            title=f"{input_path.name}  pad={params.pad}  fade={params.fade}  fill={params.fill}",
            speaker_segments=segments,
        )
        utils.log(f"[mask] 波形对比图：{figure}")

    utils.log(
        f"[mask] {input_path.name} -> {', '.join(str(p) for p in written.values())}"
        f"（{meta['duration']:.2f}s，{meta['channels']} 声道，底噪来源 {meta['noise'].get('source')}）"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python
"""单文件全流程（无需标注）：分离 -> 掩码 -> 检测 -> 判定 -> result.json。

用法：
    python run_pipeline.py --input dialog.wav --out outputs/single/dialog
    python run_pipeline.py --input dialog.wav --out outputs/single/dialog --debug-plot
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from spoofdiar import config as config_mod
from spoofdiar import decision, pipeline, utils


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="两人对话按说话人的伪造检测（单文件）")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--input", required=True, help="对话音频")
    parser.add_argument("--out", required=True, help="输出目录")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--device", default=None, help="覆盖 detect.local.device")
    parser.add_argument("--backend", choices=["local", "http"], default=None)
    parser.add_argument("--fill", choices=["noise", "zero"], default=None)
    parser.add_argument("--force", action="store_true", help="忽略所有缓存")
    parser.add_argument("--debug-plot", action="store_true", help="存原音频/A/B 波形对比图")
    parser.add_argument("--json", action="store_true", help="把 result.json 打到 stdout")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    overrides = list(args.overrides)
    if args.device:
        overrides.append(f"detect.local.device={args.device}")
    if args.backend:
        overrides.append(f"detect.backend={args.backend}")
    if args.fill:
        overrides.append(f"mask.fill={args.fill}")
    cfg = config_mod.load_config(args.config, overrides)

    input_path = Path(args.input)
    if not input_path.is_file():
        print(f"音频不存在：{input_path}", file=sys.stderr)
        return 2

    result = pipeline.run_file(
        input_path,
        args.out,
        cfg,
        threshold=args.threshold,
        force=args.force,
    )

    utils.log("")
    utils.log(f"[pipeline] {result['file_id']}  {result['duration']:.2f}s  verdict={result['verdict']}"
              f"  τ={result['threshold']:.3f}")
    for speaker in result["speakers"]:
        p_fake = speaker["p_fake"]
        utils.log(
            "[pipeline]   {id}（{label}）: p_fake={p}  is_fake={fake}  片段 {n} 段 / {sec:.2f}s".format(
                id=speaker["id"],
                label=speaker.get("pyannote_label"),
                p="None" if p_fake is None else f"{p_fake:.4f}",
                fake=speaker["is_fake"],
                n=len(speaker["segments"]),
                sec=speaker["total_speech"],
            )
        )
        for warning in speaker.get("warnings") or []:
            utils.log(f"[pipeline]     告警：{warning}")
    if result.get("diarization_warning"):
        utils.log(f"[pipeline]   分离告警：{result['diarization_warning']}")
    if result["speakers"]:
        utils.log(f"[pipeline] 结论：{result['verdict']}")

    if args.debug_plot:
        has_masked = (Path(args.out) / "A.wav").exists() and (Path(args.out) / "B.wav").exists()
        if has_masked:
            from spoofdiar.debug_plots import save_mask_figure

            diar = utils.read_json(Path(args.out) / "diarization.json", default={}) or {}
            figure = Path(cfg["paths"]["debug"]) / f"{result['file_id']}_mask.png"
            save_mask_figure(
                input_path,
                {"A": Path(args.out) / "A.wav", "B": Path(args.out) / "B.wav"},
                int(result["samplerate"]),
                figure,
                title=f"{result['file_id']}  verdict={result['verdict']}",
                speaker_segments={name: segs for name, segs in (diar.get("speakers") or {}).items()},
            )
            utils.log(f"[pipeline] 波形对比图：{figure}")

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

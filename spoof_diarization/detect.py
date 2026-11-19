#!/usr/bin/env python
"""伪造检测：一个（掩码后的）wav -> detection_{A,B}.json。

用法：
    # 单文件，自己指定输出
    python detect.py --input A.wav --out outputs/single/dialog/detection_A.json --speaker A

    # 配合掩码结果做区域过滤
    python detect.py --input A.wav --speaker A \
        --segments-json outputs/single/dialog/mask_meta.json \
        --out outputs/single/dialog/detection_A.json

    # 批量：一次加载模型跑多个文件
    python detect.py --input A.wav --input B.wav --out-dir outputs/single/dialog

注意：`--backend http` 会打到 config 里 detect.http.url 指向的服务；
该服务对 >30s 的音频会滑窗取最可疑窗口，与本地整段推理不完全等价。
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
from spoofdiar import detector as detector_mod
from spoofdiar import utils


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="HoliAntiSpoof 单文件检测")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--input", required=True, action="append", help="可重复给多个 wav")
    parser.add_argument("--out", default=None, help="只给一个 --input 时写这个文件")
    parser.add_argument("--out-dir", default=None, help="批量输出目录")
    parser.add_argument("--speaker", default=None, help="说话人标记（A / B），只影响文件名与字段")
    parser.add_argument(
        "--segments-json",
        default=None,
        help="diarization.json 或 mask_meta.json，用该说话人的片段过滤 fake_regions",
    )
    parser.add_argument("--backend", choices=["local", "http"], default=None)
    parser.add_argument("--device", default=None, help="覆盖 detect.local.device")
    parser.add_argument("--force", action="store_true", help="忽略 detection 缓存")
    return parser


def _load_segments(path: str | None, speaker: str | None) -> list[list[float]] | None:
    if not path:
        return None
    payload = utils.read_json(path, default=None)
    if not isinstance(payload, dict):
        print(f"读不到 {path}", file=sys.stderr)
        return None
    if speaker is None:
        return None
    speakers = payload.get("speakers")
    if isinstance(speakers, dict):
        return [[float(s), float(e)] for s, e in speakers.get(speaker, [])]
    if isinstance(speakers, list):  # mask_meta.json 里是 {name: kept_intervals}
        return None
    kept = payload.get("kept_intervals")
    if isinstance(kept, dict):
        return [[float(s), float(e)] for s, e in kept.get(speaker, [])]
    return None


def main() -> int:
    args = build_parser().parse_args()
    overrides = list(args.overrides)
    if args.backend:
        overrides.append(f"detect.backend={args.backend}")
    if args.device:
        overrides.append(f"detect.local.device={args.device}")
    cfg = config_mod.load_config(args.config, overrides)

    inputs = [Path(item) for item in args.input]
    missing = [str(path) for path in inputs if not path.is_file()]
    if missing:
        print(f"音频不存在：{', '.join(missing)}", file=sys.stderr)
        return 2
    if args.out and len(inputs) > 1:
        print("多个 --input 时请用 --out-dir，不要用 --out", file=sys.stderr)
        return 2
    if not args.out and not args.out_dir:
        print("需要 --out（单文件）或 --out-dir（批量）", file=sys.stderr)
        return 2

    detector = detector_mod.create_detector(cfg)
    segments = _load_segments(args.segments_json, args.speaker)

    exit_code = 0
    for path in inputs:
        out_path = Path(args.out) if args.out else Path(args.out_dir) / f"detection_{path.stem}.json"
        info = audio_io.audio_info(path)
        payload = detector_mod.run_detection(
            detector,
            path,
            out_path,
            cfg,
            speaker=args.speaker or path.stem,
            segments=segments,
            duration=info["duration"],
            force=args.force,
        )
        utils.log(
            "[detect] {name}: p_fake={p} score_source={src} step={step} regions={regions}".format(
                name=path.name,
                p="None" if payload.get("p_fake") is None else f"{payload['p_fake']:.4f}",
                src=payload.get("score_source"),
                step=payload.get("logit_step"),
                regions=payload.get("fake_regions"),
            )
        )
        for warning in payload.get("warnings", []):
            utils.log(f"[detect]   告警：{warning}")
        if payload.get("p_fake") is None:
            exit_code = 3
        raw = payload.get("raw_text") or ""
        if not raw.strip():
            utils.log("[detect]   告警：模型原始输出为空")
            exit_code = 3
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())

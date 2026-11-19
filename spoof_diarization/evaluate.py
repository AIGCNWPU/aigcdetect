#!/usr/bin/env python
"""评测：已有预测结果 + 标注 -> 全部指标与报告。

用法：
    python evaluate.py --split test
    python evaluate.py --split val --results outputs/val --threshold 0.42
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from spoofdiar import config as config_mod
from spoofdiar import decision, evaluation, gtbuild, utils


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="计算说话人单位指标、DER、错误分解")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--split", required=True, choices=["val", "test"])
    parser.add_argument("--gt", default=None, help="标注 jsonl（默认 {paths.data_gt}/{split}.jsonl）")
    parser.add_argument("--results", default=None, help="结果目录（默认 {paths.outputs}/{split}）")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--threshold-file", default=None)
    parser.add_argument(
        "--allow-default-threshold",
        action="store_true",
        help="test 上也允许退回 0.5（默认不允许，避免忘记在 val 上选阈值）",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    overrides = list(args.overrides)
    if args.threshold_file:
        overrides.append(f"decide.threshold_file={args.threshold_file}")
    cfg = config_mod.load_config(args.config, overrides)

    gt_path = Path(args.gt) if args.gt else Path(cfg["paths"]["data_gt"]) / f"{args.split}.jsonl"
    records = gtbuild.load_split(gt_path)
    if not records:
        print(f"读不到标注：{gt_path}（先跑 build_gt.py）", file=sys.stderr)
        return 2

    results = Path(args.results) if args.results else Path(cfg["paths"]["outputs"]) / args.split
    if not results.is_dir():
        print(f"结果目录不存在：{results}（先跑 run_eval.py）", file=sys.stderr)
        return 2

    threshold, source = decision.load_threshold(cfg, args.threshold)
    if source == "default" and not args.allow_default_threshold:
        print(
            "没有找到阈值：先跑 run_eval.py --split val 选阈值，"
            "或用 --threshold 指定（--allow-default-threshold 可退回 0.5）",
            file=sys.stderr,
        )
        return 2

    decision.apply_threshold_to_dir(results, threshold)
    metrics = evaluation.evaluate_split(
        records, results, cfg, threshold, threshold_source=source, split=args.split
    )
    utils.log(
        "[evaluate] 说话人单位：EER={eer} AUC={auc} Acc={acc}（n={n}）".format(
            eer=metrics["units"].get("eer"),
            auc=metrics["units"].get("auc"),
            acc=metrics["units"].get("accuracy"),
            n=metrics["units"].get("n"),
        )
    )
    utils.log(
        "[evaluate] 原始文件误报率={fp}，篡改归属准确率={attr}".format(
            fp=metrics["file_level"].get("original_false_positive_rate"),
            attr=metrics["file_level"].get("modified_attribution_accuracy"),
        )
    )
    utils.log(
        "[evaluate] DER：original={a} modified={b}（{src}）".format(
            a=metrics["diarization"]["original"].get("der"),
            b=metrics["diarization"]["modified"].get("der"),
            src=metrics["diarization"]["all"].get("source"),
        )
    )
    utils.log(f"[evaluate] 报告：{results / 'report.md'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

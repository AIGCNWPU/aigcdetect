#!/usr/bin/env python
"""判定：按阈值重算 result.json 里的 is_fake / verdict。

用法：
    # 用 outputs/threshold.json（或 config 里的值）刷新某个目录
    python decide.py --results outputs/val

    # 指定阈值
    python decide.py --results outputs/test --threshold 0.42

    # 在 val 上重新选阈值（EER），写回 threshold.json 并刷新
    python decide.py --results outputs/val --select --split val
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
    parser = argparse.ArgumentParser(description="按阈值刷新逐文件判定")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--results", required=True, help="结果目录（下面有 */result.json）")
    parser.add_argument("--threshold", type=float, default=None)
    parser.add_argument("--threshold-file", default=None, help="阈值文件（默认用 config 里的）")
    parser.add_argument("--select", action="store_true", help="用标注在 val 上重新选阈值")
    parser.add_argument("--gt", default=None, help="标注 jsonl（--select 时用）")
    parser.add_argument("--split", default=None, choices=["val", "test"])
    return parser


def main() -> int:
    args = build_parser().parse_args()
    overrides = list(args.overrides)
    if args.threshold_file:
        overrides.append(f"decide.threshold_file={args.threshold_file}")
    cfg = config_mod.load_config(args.config, overrides)

    results = Path(args.results)
    if not results.is_dir():
        print(f"结果目录不存在：{results}", file=sys.stderr)
        return 2

    threshold = args.threshold
    source = "cli"
    if args.select:
        if args.split != "val":
            print("--select 只在 val 上使用（test 不允许调阈值）", file=sys.stderr)
            return 2
        gt_path = Path(args.gt) if args.gt else Path(cfg["paths"]["data_gt"]) / "val.jsonl"
        records = gtbuild.load_split(gt_path)
        if not records:
            print(f"读不到标注：{gt_path}", file=sys.stderr)
            return 2
        probe = args.threshold if args.threshold is not None else 0.5
        analyses = [evaluation.analyse_file(record, results, probe, cfg) for record in records]
        units = [unit for analysis in analyses for unit in analysis["units"]]
        payload = decision.select_threshold(units, str(cfg["decide"]["threshold_scope"]))
        path = decision.save_threshold(cfg["decide"]["threshold_file"], payload, "val")
        threshold = float(payload["threshold"])
        source = f"file:{path}"
        utils.log(
            f"[decide] val 选阈值 τ={threshold:.4f}（EER={payload['eer']:.4f}，"
            f"n={payload['n_units']}，口径={payload['scope']}）-> {path}"
        )

    if threshold is None:
        threshold, source = decision.load_threshold(cfg)
    stats = decision.apply_threshold_to_dir(results, float(threshold))

    counts: dict[str, int] = {}
    for path in sorted(results.glob("*/result.json")):
        payload = utils.read_json(path, default=None)
        if isinstance(payload, dict):
            verdict = payload.get("verdict", "unknown")
            counts[verdict] = counts.get(verdict, 0) + 1

    utils.log(
        f"[decide] τ={float(threshold):.4f}（{source}），刷新 {stats['updated']} 个文件，"
        f"跳过 {stats['skipped']}"
    )
    for name in decision.VERDICTS:
        utils.log(f"[decide]   {name}: {counts.get(name, 0)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

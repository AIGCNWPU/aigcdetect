#!/usr/bin/env python
"""构建 on-the-fly 标注：data/gt/{val,test}.jsonl。

DailyTalkEdit 没有说话人标签，这里用 DailyTalk 的 metadata.json 补上，
并把"每句的起止时间"算出来（拼接有间隔时用互相关对齐）。

严禁使用 train 划分：HoliAntiSpoof 在 train 上训练过，用它会数据泄漏。

用法：
    python build_gt.py --split val
    python build_gt.py --split test --limit 5          # 先试跑
    python build_gt.py --split test --align always     # 强制逐句对齐
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from spoofdiar import config as config_mod
from spoofdiar import gtbuild, utils
from spoofdiar.dailytalk import DailyTalkEdit, DailyTalkIndex


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="构建 DailyTalkEdit 的逐句标注（不使用 train 划分）"
    )
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument(
        "--split",
        required=True,
        choices=["val", "test"],
        help="只用 val / test；train 被刻意排除（训练集泄漏）",
    )
    parser.add_argument("--limit", type=int, default=None, help="只处理前 N 个对话（冒烟用）")
    parser.add_argument(
        "--align",
        default="auto",
        choices=["auto", "always", "off"],
        help="auto=时长对不上才对齐；always=总是对齐；off=只用累计时长",
    )
    parser.add_argument("--out", default=None, help="输出 jsonl 路径（默认 {paths.data_gt}/{split}.jsonl）")
    parser.add_argument(
        "--dailytalk-index",
        default=None,
        help="只有 DailyTalk 时长索引（dailytalk_index.json）、没有整份音频时用它",
    )
    parser.add_argument(
        "--sample-file",
        default=None,
        help="sample_{split}.json：只建这些对话的标注（抽样评测时用）",
    )
    parser.add_argument("--force", action="store_true", help="覆盖已存在的标注文件")
    parser.add_argument(
        "--export-check",
        type=int,
        default=0,
        metavar="N",
        help="额外切出前 N 条伪造句（含原句）到 {paths.debug}/gt_check/ 供试听",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    cfg = config_mod.load_config(args.config, args.overrides)

    edit_root = cfg["paths"].get("dailytalkedit_root")
    talk_root = cfg["paths"].get("dailytalk_root")
    if not edit_root or not talk_root:
        print(
            "请先在 config.yaml 设置 paths.dailytalkedit_root 与 paths.dailytalk_root\n"
            "（或 --set paths.dailytalkedit_root=... --set paths.dailytalk_root=...）",
            file=sys.stderr,
        )
        return 2

    out_path = Path(args.out) if args.out else Path(cfg["paths"]["data_gt"]) / f"{args.split}.jsonl"
    stats_path = out_path.with_name(f"{args.split}_build_stats.json")
    if out_path.exists() and not args.force:
        print(f"{out_path} 已存在；加 --force 覆盖", file=sys.stderr)
        return 1

    edit = DailyTalkEdit(edit_root)
    index = DailyTalkIndex(talk_root, args.dailytalk_index)
    utils.log(
        f"[build_gt] DailyTalk 数据源：{'索引 ' + str(index.index_file) if index.index_file else '整份音频'}，"
        f"有音频={index.has_audio}"
    )

    only_pairs: set[str] | None = None
    if args.sample_file:
        payload = utils.read_json(args.sample_file, default=None) or {}
        pairs = payload.get("pairs") if isinstance(payload, dict) else payload
        only_pairs = {str(item) for item in pairs or []}
        utils.log(f"[build_gt] 只建 {len(only_pairs)} 个对话（来自 {args.sample_file}）")

    utils.log(f"[build_gt] split={args.split} align={args.align} 开始")
    records, stats = gtbuild.build_split(
        edit,
        index,
        args.split,
        align=args.align,
        limit=args.limit,
        only_pairs=only_pairs,
    )
    gtbuild.write_split(out_path, records, stats, stats_path)

    utils.log("")
    utils.log(f"[build_gt] 完成：{len(records)} 条标注 -> {out_path}")
    utils.log(
        "[build_gt] 对话：成功 {n_pairs_ok} / 请求 {n_pairs_requested}，失败 {n_pairs_failed}".format(**stats)
    )
    gap = stats["duration_gap"]
    utils.log(
        f"[build_gt] 拼接：max|gap|={gap['max_abs']}s，无间隔比例={gap['gapless_ratio']}，"
        f"对齐比例={gap['aligned_ratio']}"
    )
    region = stats["fake_region_check"]
    utils.log(
        f"[build_gt] 伪造区间：max|diff|={region['max_abs_diff']}s，"
        f"≤0.5s 比例={region['within_0.5s']}"
    )
    timeline = stats["modified_timeline_check"]
    utils.log(
        f"[build_gt] modified 时间轴：max|gap|={timeline['max_abs_gap']}s，"
        f"≤0.1s 比例={timeline['within_0.1s']}"
    )
    utils.log(f"[build_gt] 被篡改句说话人分布：{stats['fake_speaker_counts']}")
    if stats["failed"]:
        utils.log(f"[build_gt] 失败样本（前 5）：{stats['failed'][:5]}")
    if stats["warnings"]:
        utils.log(f"[build_gt] 告警样本数：{len(stats['warnings'])}，详见 {stats_path}")
    utils.log(f"[build_gt] 统计：{stats_path}")

    if args.export_check > 0:
        check_dir = Path(cfg["paths"]["debug"]) / "gt_check"
        samples = gtbuild.export_check_samples(
            edit, index, records, check_dir, n=args.export_check
        )
        utils.log(f"[build_gt] 试听样本 {len(samples)} 条 -> {check_dir}")
        for sample in samples:
            utils.log(
                f"[build_gt]   {sample['file_id']}  第 {sample['target_utt_idx']} 句"
                f"  speaker={sample['fake_speaker']}  {sample['fake_region']}"
            )
            utils.log(f"[build_gt]     原句：{sample['target_text_original']}")
            utils.log(f"[build_gt]     改后：{sample['target_text_modified']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

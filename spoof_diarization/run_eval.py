#!/usr/bin/env python
"""批量推理 + 评测。

用法：
    python run_eval.py --split val --limit 10        # 冒烟：10 对（20 个文件）
    python run_eval.py --split val                   # 选阈值
    python run_eval.py --split test                  # 正式结果（用 val 选的阈值）
    python run_eval.py --split test --fill zero      # 消融：纯静音填充

产物：
    outputs/{split}{tag}/{file_id}/...              每个文件的中间产物
    outputs/{split}{tag}/{predictions.jsonl, unit_scores.csv, metrics.json, ...}
    outputs/threshold.json                          val 选出的阈值
"""
from __future__ import annotations

import argparse
import random
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from spoofdiar import config as config_mod
from spoofdiar import decision, detector as detector_mod, evaluation, gtbuild, pipeline, utils
from spoofdiar.diarization import Diarizer, OracleDiarizer


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="批量推理 + 评测")
    parser.add_argument("--config", default=str(HERE / "config.yaml"))
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--split", required=True, choices=["val", "test"])
    parser.add_argument("--gt", default=None, help="标注 jsonl（默认 {paths.data_gt}/{split}.jsonl）")
    parser.add_argument("--limit", type=int, default=None, help="只跑前 N 对（冒烟测试）")
    parser.add_argument("--fill", choices=["noise", "zero"], default=None, help="掩码填充方式（消融）")
    parser.add_argument("--tag", default=None, help="输出目录后缀，默认按 fill 自动生成")
    parser.add_argument("--out", default=None, help="结果根目录（默认 {paths.outputs}/{split}{tag}）")
    parser.add_argument("--threshold", type=float, default=None, help="直接指定阈值（不再选）")
    parser.add_argument("--threshold-file", default=None)
    parser.add_argument("--force", action="store_true", help="忽略已有 result.json 与检测缓存")
    parser.add_argument("--no-eval", action="store_true", help="只推理，不评测")
    parser.add_argument("--no-plot", action="store_true", help="不生成波形对比图")
    parser.add_argument("--plot", type=int, default=3, help="给前 N 个文件画波形对比图（默认 3）")
    parser.add_argument("--backend", choices=["local", "http"], default=None)
    parser.add_argument("--device", default=None)
    parser.add_argument(
        "--sample-ratio",
        type=float,
        default=1.0,
        help="只跑这个比例的对话对（按被篡改人 0/1 分层、固定 seed，默认全量）",
    )
    parser.add_argument("--sample-seed", type=int, default=None, help="抽样随机种子（默认用 config.seed）")
    parser.add_argument(
        "--oracle-diarization",
        action="store_true",
        help="用标注 turns 代替 pyannote（上界实验，结果单独目录）",
    )
    return parser


def _select_pairs(
    records: list[dict],
    limit: int | None = None,
    ratio: float = 1.0,
    seed: int = 1234,
) -> tuple[list[dict], dict | None]:
    """按 pair_id 聚合，支持 --limit 与 --sample-ratio（分层抽样）。

    分层依据是"被篡改的是谁"（0/1），这样抽样不会让两成样本全是一个人。
    返回 (选中的记录, 抽样报告)。
    """
    pairs: dict[str, list[dict]] = {}
    order: list[str] = []
    for record in records:
        pair_id = str(record.get("pair_id"))
        if pair_id not in pairs:
            pairs[pair_id] = []
            order.append(pair_id)
        pairs[pair_id].append(record)

    chosen = list(order)
    report: dict | None = None
    if ratio < 1.0:
        strata: dict[str, list[str]] = {}
        for pair_id in order:
            fake_speaker = None
            for record in pairs[pair_id]:
                if record.get("condition") == "modified":
                    fake_speaker = record.get("fake_speaker")
            key = "unknown" if fake_speaker is None else str(int(fake_speaker))
            strata.setdefault(key, []).append(pair_id)
        rng = random.Random(seed)
        picked: list[str] = []
        detail: dict[str, dict] = {}
        for key, items in sorted(strata.items()):
            take = max(1, int(round(len(items) * ratio)))
            take = min(take, len(items))
            sample = rng.sample(items, take)
            picked.extend(sample)
            detail[key] = {"n_total": len(items), "n_picked": take}
        chosen = [pair_id for pair_id in order if pair_id in set(picked)]
        report = {
            "ratio": ratio,
            "seed": seed,
            "n_total_pairs": len(order),
            "n_picked_pairs": len(chosen),
            "strata": detail,
            "pairs": chosen,
        }

    if limit:
        chosen = chosen[: int(limit)]
        if report is not None:
            report["n_picked_pairs"] = len(chosen)
            report["pairs"] = chosen

    keep = set(chosen)
    selected = [record for record in records if str(record.get("pair_id")) in keep]
    return selected, report


def main() -> int:
    args = build_parser().parse_args()

    overrides = list(args.overrides)
    if args.fill:
        overrides.append(f"mask.fill={args.fill}")
    if args.backend:
        overrides.append(f"detect.backend={args.backend}")
    if args.device:
        overrides.append(f"detect.local.device={args.device}")
    if args.threshold_file:
        overrides.append(f"decide.threshold_file={args.threshold_file}")
    cfg = config_mod.load_config(args.config, overrides)

    gt_path = Path(args.gt) if args.gt else Path(cfg["paths"]["data_gt"]) / f"{args.split}.jsonl"
    records = gtbuild.load_split(gt_path)
    if not records:
        print(f"读不到标注：{gt_path}（先跑 build_gt.py --split {args.split}）", file=sys.stderr)
        return 2
    sample_seed = args.sample_seed if args.sample_seed is not None else int(cfg["seed"])
    records, sample_report = _select_pairs(
        records, args.limit, args.sample_ratio, sample_seed
    )

    tag = args.tag
    if tag is None:
        tag = "" if cfg["mask"]["fill"] == "noise" else f"_fill-{cfg['mask']['fill']}"
    if args.oracle_diarization:
        tag += "_oracle"
    out_root = Path(args.out) if args.out else Path(cfg["paths"]["outputs"]) / f"{args.split}{tag}"
    out_root.mkdir(parents=True, exist_ok=True)
    if sample_report is not None:
        utils.write_json(out_root / "sample_pairs.json", sample_report)
        utils.log(
            f"[run_eval] 抽样 {sample_report['n_picked_pairs']}/{sample_report['n_total_pairs']} 对"
            f"（ratio={args.sample_ratio}，seed={sample_seed}，分层={sample_report['strata']}）"
        )

    utils.log(
        f"[run_eval] split={args.split} 文件数={len(records)} fill={cfg['mask']['fill']} "
        f"backend={cfg['detect']['backend']}"
    )
    utils.log(f"[run_eval] 结果目录：{out_root}")

    # ---------------- 推理 ----------------
    detector = detector_mod.create_detector(cfg)
    diarizer = Diarizer(cfg) if not args.oracle_diarization else None
    if args.oracle_diarization:
        utils.log("[run_eval] ⚠ oracle 分离模式：直接用标注 turns 做掩码，只作上界参考")
    started = time.time()
    done = 0
    skipped = 0
    failures: list[tuple[str, str]] = []

    for index, record in enumerate(records, 1):
        file_id = record["file_id"]
        result_path = out_root / file_id / "result.json"
        if result_path.is_file() and not args.force:
            skipped += 1
            continue
        audio_path = Path(record["audio_path"])
        if not audio_path.is_file():
            failures.append((file_id, f"音频不存在：{audio_path}"))
            continue
        active_diarizer = (
            OracleDiarizer(record.get("turns") or [], cfg)
            if args.oracle_diarization
            else diarizer
        )
        try:
            pipeline.run_file(
                audio_path,
                out_root / file_id,
                cfg,
                threshold=args.threshold,
                detector=detector,
                diarizer=active_diarizer,
                force=args.force,
            )
        except Exception as exc:  # 单个文件失败不打断整批
            failures.append((file_id, f"{type(exc).__name__}: {exc}"))
            utils.log(f"[run_eval] [{index}/{len(records)}] {file_id} 失败：{exc}")
            continue
        done += 1
        elapsed = time.time() - started
        utils.log(
            f"[run_eval] [{index}/{len(records)}] {file_id} 完成"
            f"（已用 {elapsed / 60:.1f} min，跳过 {skipped}）"
        )

    utils.log(f"[run_eval] 推理结束：新算 {done}，跳过 {skipped}，失败 {len(failures)}")
    for file_id, message in failures[:10]:
        utils.log(f"[run_eval]   失败 {file_id}: {message}")

    if args.no_eval:
        return 1 if failures else 0

    # ---------------- 阈值 ----------------
    tau, source = decision.load_threshold(cfg, args.threshold)
    if args.split == "val" and args.threshold is None:
        analyses = [
            evaluation.analyse_file(record, out_root, 0.5, cfg) for record in records
        ]
        units = [unit for analysis in analyses for unit in analysis["units"]]
        payload = decision.select_threshold(units, str(cfg["decide"]["threshold_scope"]))
        threshold_path = Path(str(cfg["decide"]["threshold_file"]))
        if args.limit:
            threshold_path = threshold_path.with_name(
                f"threshold_smoke_limit{args.limit}.json"
            )
            utils.log(
                f"[run_eval] 只在 {args.limit} 对上选阈值，写到 {threshold_path.name}，"
                "不覆盖正式阈值"
            )
        elif args.sample_ratio < 1.0:
            threshold_path = threshold_path.with_name(
                f"threshold_sample{int(round(args.sample_ratio * 100))}.json"
            )
            utils.log(
                f"[run_eval] 只用 {args.sample_ratio:.0%} 的 val 选阈值，"
                f"写到 {threshold_path.name}（不覆盖全量阈值）"
            )
        decision.save_threshold(threshold_path, payload, "val")
        tau, source = float(payload["threshold"]), f"file:{threshold_path}"
        utils.log(
            f"[run_eval] val 选阈值 τ={tau:.4f}（EER={payload['eer']:.4f}，"
            f"n_units={payload['n_units']}，口径={payload['scope']}）"
        )
    elif args.split == "test" and args.threshold is None and source == "default":
        utils.log(
            "[run_eval] 找不到阈值文件；test 必须复用 val 的阈值。"
            "先跑 run_eval.py --split val，或用 --threshold 指定"
        )
        return 2

    decision.apply_threshold_to_dir(out_root, tau)

    # ---------------- 波形对比图 ----------------
    if not args.no_plot and args.plot > 0:
        from spoofdiar.debug_plots import save_mask_figure

        plotted = 0
        for record in records:
            if plotted >= args.plot:
                break
            file_dir = out_root / record["file_id"]
            original = Path(record["audio_path"])
            masked = {"A": file_dir / "A.wav", "B": file_dir / "B.wav"}
            if not original.is_file() or not all(path.is_file() for path in masked.values()):
                continue
            diar = utils.read_json(file_dir / "diarization.json", default={}) or {}
            figure = Path(cfg["paths"]["debug"]) / f"{record['file_id']}_mask.png"
            try:
                save_mask_figure(
                    original,
                    masked,
                    int((utils.read_json(file_dir / "result.json", default={}) or {}).get("samplerate") or 16000),
                    figure,
                    title=f"{record['file_id']}  {record.get('condition')}",
                    speaker_segments=diar.get("speakers") or {},
                )
                plotted += 1
            except Exception as exc:
                utils.log(f"[run_eval] 波形图失败（{record['file_id']}）：{exc}")
        if plotted:
            utils.log(f"[run_eval] 波形对比图 {plotted} 张 -> {cfg['paths']['debug']}")

    # ---------------- 评测 ----------------
    metrics = evaluation.evaluate_split(
        records, out_root, cfg, tau, threshold_source=source, split=args.split
    )
    units = metrics["units"]
    utils.log("")
    utils.log(
        "[run_eval] 主指标 EER={eer} AUC={auc} Acc={acc} BalAcc={bal}（n={n}）".format(
            eer=units.get("eer"),
            auc=units.get("auc"),
            acc=units.get("accuracy"),
            bal=units.get("balanced_accuracy"),
            n=units.get("n"),
        )
    )
    utils.log(
        "[run_eval] 原始误报率={fp}，篡改归属准确率={attr}".format(
            fp=metrics["file_level"].get("original_false_positive_rate"),
            attr=metrics["file_level"].get("modified_attribution_accuracy"),
        )
    )
    utils.log(
        "[run_eval] DER original={a} modified={b}，伪造句归属={c}".format(
            a=metrics["diarization"]["original"].get("der"),
            b=metrics["diarization"]["modified"].get("der"),
            c=metrics["diarization"]["fake_region_attribution"].get("mean"),
        )
    )
    utils.log(f"[run_eval] 报告：{out_root / 'report.md'}")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

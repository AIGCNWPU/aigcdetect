"""评测：把 result.json 与标注对齐，算检测指标、DER、归属正确率和错误分解。

坐标约定（很重要）：
    标注里的 speaker 0 / 1 记作 GT 的 A / B；
    预测里的 A / B 是 pyannote 按首次开口重命名的，与 GT 没有固定对应，
    所以先用"时间重叠最大"做 2x2 一一配对，再把预测结论映射回 GT 编号，
    混淆矩阵的行和列都在 GT 编号空间里，才可比。
"""
from __future__ import annotations

import csv
import os
from pathlib import Path
from typing import Any, Iterable

from . import decision, metrics, utils
from .decision import VERDICTS

ROW_CATEGORIES = ("both_real", "A_fake", "B_fake")
COL_CATEGORIES = VERDICTS


# --------------------------------------------------------------------------- #
# 单文件
# --------------------------------------------------------------------------- #
def _load_result(out_root: Path, file_id: str) -> dict[str, Any] | None:
    payload = utils.read_json(out_root / file_id / "result.json", default=None)
    return payload if isinstance(payload, dict) else None


def _pred_segments(result: dict[str, Any]) -> dict[str, list[list[float]]]:
    segments: dict[str, list[list[float]]] = {}
    for speaker in result.get("speakers", []):
        name = str(speaker.get("id"))
        segments[name] = [
            [float(pair[0]), float(pair[1])] for pair in speaker.get("segments", [])
        ]
    return segments


def analyse_file(
    record: dict[str, Any],
    out_root: Path,
    threshold: float,
    cfg: dict[str, Any],
) -> dict[str, Any]:
    """把一个文件的预测与 GT 对齐，返回逐文件分析结果。"""
    file_id = record["file_id"]
    result = _load_result(out_root, file_id)
    analysis: dict[str, Any] = {
        "file_id": file_id,
        "pair_id": record.get("pair_id"),
        "condition": record.get("condition"),
        "duration": record.get("duration"),
        "gt_fake_speaker": record.get("fake_speaker"),
        "gt_fake_regions": record.get("fake_regions") or [],
        "missing": result is None,
        "units": [],
        "pred_fake_gt": [],
        "truth_category": metrics.category_of(
            [] if record.get("fake_speaker") is None else [int(record["fake_speaker"])]
        ),
        "pred_category": None,
        "pairing": {},
        "der": None,
        "fake_region_attribution": None,
        "reasons": [],
    }
    if result is None:
        analysis["reasons"] = ["no_prediction"]
        return analysis

    result = decision.apply_threshold(result, threshold)
    pred_segments = _pred_segments(result)
    pairing = metrics.pair_speakers(pred_segments, record.get("turns") or [])
    mapping: dict[str, int | None] = pairing["mapping"]

    fake_speaker = record.get("fake_speaker")
    for speaker in result.get("speakers", []):
        name = str(speaker.get("id"))
        gt_speaker = mapping.get(name)
        if gt_speaker is None:
            continue
        is_fake = bool(speaker.get("is_fake"))
        analysis["units"].append(
            {
                "file_id": file_id,
                "condition": record.get("condition"),
                "gt_speaker": int(gt_speaker),
                "pred_speaker": name,
                "label": int(fake_speaker is not None and int(gt_speaker) == int(fake_speaker)),
                "p_fake": speaker.get("p_fake"),
                "is_fake": is_fake,
                "pred_fake_regions": speaker.get("fake_regions") or [],
            }
        )
        if is_fake:
            analysis["pred_fake_gt"].append(int(gt_speaker))

    analysis["pred_fake_gt"] = sorted(set(analysis["pred_fake_gt"]))
    analysis["pred_category"] = metrics.category_of(analysis["pred_fake_gt"])
    analysis["pairing"] = mapping
    analysis["pairing_overlap"] = pairing["overlap"]
    analysis["verdict"] = result.get("verdict")
    analysis["diarization_warning"] = result.get("diarization_warning")

    # DER（参考：GT turns；假设：分离出的 A/B 片段）
    der_result = metrics.diarization_error_rate(
        record.get("turns") or [],
        pred_segments,
        float(record.get("duration") or 0.0),
        collar=float(cfg["eval"]["collar"]),
        step=float(cfg["eval"]["frame_step"]),
    )
    analysis["der_fallback"] = der_result
    pyannote_der = metrics.der_with_pyannote(
        record.get("turns") or [],
        pred_segments,
        collar=float(cfg["eval"]["collar"]),
    )
    analysis["der_pyannote"] = pyannote_der
    analysis["der"] = (pyannote_der or {}).get("der") if pyannote_der else der_result.get("der")
    if pyannote_der and pyannote_der.get("der") is not None and der_result.get("der") is not None:
        # 两套实现的定义一致，差太多说明 pyannote 的调用方式或口径出了问题
        analysis["der_disagreement"] = round(
            abs(float(pyannote_der["der"]) - float(der_result["der"])), 4
        )
    else:
        analysis["der_disagreement"] = None

    # 伪造句归属：fake_regions 有多少比例被分给了"正确的那个人"
    if record.get("condition") == "modified" and record.get("fake_regions") and fake_speaker is not None:
        inverse = {int(gt): name for name, gt in mapping.items() if gt is not None}
        pred_name = inverse.get(int(fake_speaker))
        regions = record["fake_regions"]
        total = utils.total_duration(regions)
        if pred_name is not None and total > 0:
            covered = utils.overlap_duration(regions, pred_segments.get(pred_name, []))
            analysis["fake_region_attribution"] = round(covered / total, 4)
        else:
            analysis["fake_region_attribution"] = 0.0

    # 错误分解
    if record.get("condition") == "modified":
        analysis["reasons"] = _classify_error(analysis, threshold)
    return analysis


def _classify_error(analysis: dict[str, Any], threshold: float) -> list[str]:
    """给判错的 modified 文件标注原因（可多条）。"""
    truth = analysis["truth_category"]
    pred = analysis["pred_category"]
    reasons: list[str] = []
    if truth == pred:
        return reasons

    attribution = analysis.get("fake_region_attribution")
    if attribution is not None and attribution < 0.5:
        reasons.append("diarization_misattributed")

    fake_speaker = analysis.get("gt_fake_speaker")
    for unit in analysis["units"]:
        p_fake = unit.get("p_fake")
        if p_fake is None:
            continue
        if int(unit["gt_speaker"]) == int(fake_speaker):
            if float(p_fake) < float(threshold):
                reasons.append("detector_miss")
        else:
            if float(p_fake) >= float(threshold):
                reasons.append("detector_false_positive")

    if not reasons:
        reasons.append("other")
    return reasons


def _primary_reason(reasons: Iterable[str]) -> str:
    ordered = (
        "no_prediction",
        "diarization_misattributed",
        "detector_miss",
        "detector_false_positive",
        "other",
    )
    present = set(reasons)
    for name in ordered:
        if name in present:
            return name
    return "none"


# --------------------------------------------------------------------------- #
# 聚合
# --------------------------------------------------------------------------- #
def _write_unit_csv(path: Path, units: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    columns = [
        "file_id",
        "condition",
        "gt_speaker",
        "pred_speaker",
        "label",
        "p_fake",
        "is_fake",
    ]
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns, extrasaction="ignore")
        writer.writeheader()
        for unit in units:
            writer.writerow(unit)


def _write_confusion_csv(path: Path, table: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    rows = table["rows"]
    columns = table["columns"]
    with open(path, "w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["truth\\pred", *columns, "support"])
        for row in rows:
            values = [table["matrix"][row].get(column, 0) for column in columns]
            writer.writerow([row, *values, sum(values)])


def _aggregate_der(analyses: list[dict[str, Any]], condition: str | None, collar: float) -> dict[str, Any]:
    subset = [item for item in analyses if condition is None or item["condition"] == condition]
    subset = [item for item in subset if item.get("der") is not None]
    if not subset:
        return {"n": 0, "der": None}

    source = "pyannote.metrics" if all(item.get("der_pyannote") for item in subset) else "fallback"
    numerator = 0.0
    denominator = 0.0
    components = {"miss": 0.0, "false_alarm": 0.0, "confusion": 0.0}
    for item in subset:
        fallback = item.get("der_fallback") or {}
        scored = float(fallback.get("scored_seconds") or 0.0)
        if source == "pyannote.metrics":
            value = float(item["der_pyannote"]["der"])
        else:
            value = float(fallback.get("der") or 0.0)
        numerator += value * scored
        denominator += scored
        for key in components:
            components[key] += float(fallback.get(key) or 0.0) * scored

    if denominator <= 0:
        return {"n": len(subset), "der": None, "source": source}
    return {
        "n": len(subset),
        "der": round(numerator / denominator, 6),
        "miss": round(components["miss"] / denominator, 6),
        "false_alarm": round(components["false_alarm"] / denominator, 6),
        "confusion": round(components["confusion"] / denominator, 6),
        "scored_seconds": round(denominator, 2),
        "collar": collar,
        "source": source,
    }


def _markdown_table(headers: list[str], rows: list[list[Any]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "| " + " | ".join(["---"] * len(headers)) + " |"]
    for row in rows:
        lines.append("| " + " | ".join("" if value is None else str(value) for value in row) + " |")
    return "\n".join(lines)


def evaluate_split(
    records: list[dict[str, Any]],
    out_root: str | os.PathLike[str],
    cfg: dict[str, Any],
    threshold: float,
    threshold_source: str = "unknown",
    split: str = "test",
) -> dict[str, Any]:
    """跑完整评测并把 4 个产物写到 out_root。"""
    root = Path(out_root)
    analyses = [analyse_file(record, root, threshold, cfg) for record in records]

    units = [unit for analysis in analyses for unit in analysis["units"]]
    scored_units = [unit for unit in units if unit.get("p_fake") is not None]

    labels = [int(unit["label"]) for unit in scored_units]
    scores = [float(unit["p_fake"]) for unit in scored_units]
    predictions = [bool(unit["is_fake"]) for unit in scored_units]

    unit_metrics: dict[str, Any] = {"n": len(scored_units), "n_missing_score": len(units) - len(scored_units)}
    if scored_units and len(set(labels)) > 1:
        eer, eer_threshold = decision.eer_and_threshold(labels, scores)
        unit_metrics.update(
            {
                "eer": round(eer, 6),
                "eer_threshold": round(eer_threshold, 6),
                "auc": round(metrics.roc_auc(labels, scores) or 0.0, 6),
            }
        )
    else:
        unit_metrics.update({"eer": None, "auc": None})
    unit_metrics.update(metrics.classification_metrics(labels, predictions))

    modified_units = [unit for unit in scored_units if unit.get("condition") == "modified"]
    modified_metrics: dict[str, Any] = {"n": len(modified_units)}
    if modified_units and len({int(unit["label"]) for unit in modified_units}) > 1:
        eer, eer_threshold = decision.eer_and_threshold(
            [int(unit["label"]) for unit in modified_units],
            [float(unit["p_fake"]) for unit in modified_units],
        )
        modified_metrics.update(
            {
                "eer": round(eer, 6),
                "eer_threshold": round(eer_threshold, 6),
                "auc": round(
                    metrics.roc_auc(
                        [int(unit["label"]) for unit in modified_units],
                        [float(unit["p_fake"]) for unit in modified_units],
                    )
                    or 0.0,
                    6,
                ),
            }
        )
    modified_metrics.update(
        metrics.classification_metrics(
            [int(unit["label"]) for unit in modified_units],
            [bool(unit["is_fake"]) for unit in modified_units],
        )
    )

    truth_categories = [analysis["truth_category"] for analysis in analyses if not analysis["missing"]]
    pred_categories = [analysis["pred_category"] for analysis in analyses if not analysis["missing"]]
    confusion = metrics.classification_table(
        truth_categories, pred_categories, ROW_CATEGORIES, COL_CATEGORIES
    )

    originals = [analysis for analysis in analyses if analysis["condition"] == "original" and not analysis["missing"]]
    modified = [analysis for analysis in analyses if analysis["condition"] == "modified" and not analysis["missing"]]
    original_false_positive = (
        sum(1 for analysis in originals if analysis["pred_fake_gt"]) / len(originals)
        if originals
        else None
    )
    attribution_correct = 0
    for analysis in modified:
        if analysis["gt_fake_speaker"] is None:
            continue
        if analysis["pred_fake_gt"] == [int(analysis["gt_fake_speaker"])]:
            attribution_correct += 1
    attribution_accuracy = attribution_correct / len(modified) if modified else None

    der_all = _aggregate_der(analyses, None, float(cfg["eval"]["collar"]))
    der_original = _aggregate_der(analyses, "original", float(cfg["eval"]["collar"]))
    der_modified = _aggregate_der(analyses, "modified", float(cfg["eval"]["collar"]))

    attributions = [
        analysis["fake_region_attribution"]
        for analysis in modified
        if analysis["fake_region_attribution"] is not None
    ]
    fake_region_attribution = {
        "n": len(attributions),
        "mean": round(float(sum(attributions) / len(attributions)), 6) if attributions else None,
        "median": round(float(sorted(attributions)[len(attributions) // 2]), 6) if attributions else None,
        "perfect_ratio": round(sum(1 for value in attributions if value >= 0.99) / len(attributions), 6)
        if attributions
        else None,
    }

    wrong = [analysis for analysis in modified if analysis["truth_category"] != analysis["pred_category"]]
    reason_counts: dict[str, int] = {}
    for analysis in wrong:
        key = _primary_reason(analysis["reasons"])
        reason_counts[key] = reason_counts.get(key, 0) + 1

    result = {
        "split": split,
        "threshold": float(threshold),
        "threshold_source": threshold_source,
        "diagnostics": {
            "n_records": len(records),
            "n_results": len(records) - sum(1 for analysis in analyses if analysis["missing"]),
            "n_missing_results": sum(1 for analysis in analyses if analysis["missing"]),
            "missing_ids": [analysis["file_id"] for analysis in analyses if analysis["missing"]][:20],
            "n_diarization_warning": sum(
                1 for analysis in analyses if analysis.get("diarization_warning")
            ),
            "n_der_disagreement": sum(
                1
                for analysis in analyses
                if (analysis.get("der_disagreement") or 0.0) > 0.05
            ),
        },
        "units": unit_metrics,
        "units_modified_only": modified_metrics,
        "file_level": {
            "confusion": confusion,
            "original_false_positive_rate": None
            if original_false_positive is None
            else round(float(original_false_positive), 6),
            "modified_attribution_accuracy": None
            if attribution_accuracy is None
            else round(float(attribution_accuracy), 6),
            "n_original": len(originals),
            "n_modified": len(modified),
        },
        "diarization": {
            "all": der_all,
            "original": der_original,
            "modified": der_modified,
            "fake_region_attribution": fake_region_attribution,
        },
        "errors": {
            "n_wrong": len(wrong),
            "by_primary_reason": reason_counts,
            "samples": [
                {
                    "file_id": analysis["file_id"],
                    "truth": analysis["truth_category"],
                    "pred": analysis["pred_category"],
                    "reasons": analysis["reasons"],
                    "p_fake": [unit.get("p_fake") for unit in analysis["units"]],
                }
                for analysis in wrong[: int(cfg["eval"]["top_errors"])]
            ],
        },
        "created_at": utils.now_stamp(),
    }

    utils.write_json(root / "metrics.json", result)
    _write_unit_csv(root / "unit_scores.csv", units)
    _write_confusion_csv(root / "confusion_matrix.csv", confusion)
    utils.write_jsonl(
        root / "predictions.jsonl",
        [
            {
                "file_id": analysis["file_id"],
                "pair_id": analysis["pair_id"],
                "condition": analysis["condition"],
                "verdict": analysis.get("verdict"),
                "pairing": analysis["pairing"],
                "pairing_overlap": analysis.get("pairing_overlap"),
                "pred_fake_gt": analysis["pred_fake_gt"],
                "truth_category": analysis["truth_category"],
                "pred_category": analysis["pred_category"],
                "der": analysis.get("der"),
                "fake_region_attribution": analysis.get("fake_region_attribution"),
                "reasons": analysis["reasons"],
                "gt": {
                    "fake_speaker": analysis["gt_fake_speaker"],
                    "fake_regions": analysis["gt_fake_regions"],
                },
                "speakers": [
                    {
                        "id": unit["pred_speaker"],
                        "gt_speaker": unit["gt_speaker"],
                        "label": unit["label"],
                        "p_fake": unit["p_fake"],
                        "is_fake": unit["is_fake"],
                        "fake_regions": unit["pred_fake_regions"],
                    }
                    for unit in analysis["units"]
                ],
            }
            for analysis in analyses
        ],
    )

    try:
        from .debug_plots import plot_confusion_matrix

        plot_confusion_matrix(
            confusion["matrix"],
            confusion["rows"],
            confusion["columns"],
            root / "confusion_matrix.png",
            title=f"{split} file-level confusion (threshold={threshold:.3f})",
        )
    except Exception as exc:  # pragma: no cover - matplotlib 缺失不应阻断评测
        utils.log(f"[warning] 混淆矩阵图生成失败：{exc}")

    _write_report(root / "report.md", result, analyses, wrong)
    return result


def _write_report(
    path: Path,
    result: dict[str, Any],
    analyses: list[dict[str, Any]],
    wrong: list[dict[str, Any]],
) -> None:
    split = result["split"]
    units = result["units"]
    modified = result["units_modified_only"]
    file_level = result["file_level"]
    diarization = result["diarization"]

    lines: list[str] = []
    lines.append(f"# {split} 评测报告")
    lines.append("")
    lines.append(f"生成时间：{result['created_at']}　阈值 τ = {result['threshold']:.4f}"
                 f"（来源：{result['threshold_source']}）")
    lines.append("")
    lines.append(
        "标签空间说明：标注的 speaker 0 / 1 在下面记作 A / B。"
        "预测的 A / B 与 GT 没有固定对应，已按时间重叠最大做 2x2 配对后再映射回 GT 编号，"
        "所以混淆矩阵的行和列都落在同一套编号上。"
    )
    lines.append("")

    lines.append("## 1. 说话人单位检测指标（主指标）")
    lines.append("")
    rows = [
        ["全部文件", units.get("n"), units.get("eer"), units.get("auc"), units.get("accuracy"),
         units.get("precision"), units.get("recall"), units.get("balanced_accuracy")],
        ["仅 modified", modified.get("n"), modified.get("eer"), modified.get("auc"),
         modified.get("accuracy"), modified.get("precision"), modified.get("recall"),
         modified.get("balanced_accuracy")],
    ]
    lines.append(_markdown_table(
        ["口径", "样本数", "EER", "AUC", "Acc", "Precision", "Recall", "Balanced Acc"], rows))
    lines.append("")

    lines.append("## 2. 文件级结论")
    lines.append("")
    lines.append(_markdown_table(
        ["指标", "数值"],
        [
            ["原始文件误报率（判出任意一人为假）", file_level.get("original_false_positive_rate")],
            ["篡改文件归属准确率（正好判出被篡改的人）", file_level.get("modified_attribution_accuracy")],
            ["original 文件数", file_level.get("n_original")],
            ["modified 文件数", file_level.get("n_modified")],
        ],
    ))
    lines.append("")
    confusion = file_level["confusion"]
    rows = [
        [row, *[confusion["matrix"][row].get(column, 0) for column in confusion["columns"]],
         sum(confusion["matrix"][row].values())]
        for row in confusion["rows"]
    ]
    lines.append(_markdown_table(["真值 \\ 预测", *confusion["columns"], "合计"], rows))
    lines.append("")

    lines.append("## 3. 说话人分离质量")
    lines.append("")
    lines.append(_markdown_table(
        ["口径", "文件数", "DER", "Miss", "FA", "Confusion", "计分时长(s)", "来源"],
        [
            [name, diarization[key].get("n"), diarization[key].get("der"),
             diarization[key].get("miss"), diarization[key].get("false_alarm"),
             diarization[key].get("confusion"), diarization[key].get("scored_seconds"),
             diarization[key].get("source")]
            for name, key in (("original", "original"), ("modified", "modified"), ("all", "all"))
        ],
    ))
    lines.append("")
    attribution = diarization["fake_region_attribution"]
    lines.append(
        f"伪造句归属正确率（fake_regions 被分给正确说话人的比例）："
        f"均值 {attribution.get('mean')}，中位数 {attribution.get('median')}，"
        f"完全正确占比 {attribution.get('perfect_ratio')}（n={attribution.get('n')}）"
    )
    lines.append("")
    lines.append(
        "这一项和检测指标要分开看：DER 高说明分人本身就错，"
        "归属正确率低而 DER 正常说明错在伪造句那一小段。"
    )
    lines.append("")

    lines.append("## 4. 错误分解（modified 判错的文件）")
    lines.append("")
    errors = result["errors"]
    lines.append(_markdown_table(
        ["原因", "数量"],
        [
            ["分离把伪造句分错了人（diarization_misattributed）",
             errors["by_primary_reason"].get("diarization_misattributed", 0)],
            ["检测器漏报（detector_miss）", errors["by_primary_reason"].get("detector_miss", 0)],
            ["检测器把真人误报（detector_false_positive）",
             errors["by_primary_reason"].get("detector_false_positive", 0)],
            ["没有预测文件（no_prediction）", errors["by_primary_reason"].get("no_prediction", 0)],
            ["其他（other）", errors["by_primary_reason"].get("other", 0)],
            ["合计", errors["n_wrong"]],
        ],
    ))
    lines.append("")
    if errors["samples"]:
        lines.append("典型错误样本：")
        lines.append("")
        lines.append(_markdown_table(
            ["file_id", "真值", "预测", "原因", "两人 p_fake"],
            [
                [sample["file_id"], sample["truth"], sample["pred"],
                 ",".join(sample["reasons"]),
                 "/".join("None" if value is None else f"{float(value):.3f}" for value in sample["p_fake"])]
                for sample in errors["samples"]
            ],
        ))
        lines.append("")

    diagnostics = result["diagnostics"]
    lines.append("## 5. 复现信息")
    lines.append("")
    lines.append(f"- 记录数：{diagnostics['n_records']}，有结果：{diagnostics['n_results']}，"
                 f"缺结果：{diagnostics['n_missing_results']}")
    if diagnostics["missing_ids"]:
        lines.append(f"- 缺失的文件：{', '.join(diagnostics['missing_ids'])}")
    lines.append(f"- 分离告警文件数：{diagnostics['n_diarization_warning']}")
    lines.append(f"- 无有效分数的说话人单位：{units.get('n_missing_score')}")
    if diagnostics.get("n_der_disagreement"):
        lines.append(
            f"- ⚠ 有 {diagnostics['n_der_disagreement']} 个文件两套 DER 实现相差 > 0.05，"
            "请检查 pyannote.metrics 的调用方式"
        )
    lines.append("")
    lines.append("产物：`predictions.jsonl`、`unit_scores.csv`、`metrics.json`、"
                 "`confusion_matrix.csv`、`confusion_matrix.png`、`report.md`")
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")

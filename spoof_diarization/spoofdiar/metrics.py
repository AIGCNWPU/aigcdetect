"""指标：EER / AUC / 分类指标 / DER / 说话人配对 / 混淆矩阵。

不依赖 sklearn；DER 优先用 pyannote.metrics，没有装则用本文件里的等价实现
（10 ms 帧粒度 + collar，口径与 pyannote 一致：collar 内与双方都静音的帧不计分）。
"""
from __future__ import annotations

from typing import Any, Iterable, Sequence

import numpy as np

from .utils import Interval, merge_intervals, overlap_duration, total_duration


# --------------------------------------------------------------------------- #
# 二分类
# --------------------------------------------------------------------------- #
def roc_auc(labels: Sequence[int], scores: Sequence[float]) -> float | None:
    """秩和法 AUC，并列取平均秩。"""
    y = np.asarray(list(labels), dtype=int)
    s = np.asarray(list(scores), dtype=float)
    n_pos = int(y.sum())
    n_neg = int(y.size - n_pos)
    if n_pos == 0 or n_neg == 0:
        return None

    order = np.argsort(s, kind="mergesort")
    ranks = np.empty(s.size, dtype=float)
    sorted_scores = s[order]
    index = 0
    while index < sorted_scores.size:
        end = index
        while end + 1 < sorted_scores.size and sorted_scores[end + 1] == sorted_scores[index]:
            end += 1
        average_rank = (index + end) / 2.0 + 1.0
        ranks[order[index : end + 1]] = average_rank
        index = end + 1

    rank_sum = float(ranks[y == 1].sum())
    auc = (rank_sum - n_pos * (n_pos + 1) / 2.0) / (n_pos * n_neg)
    return float(auc)


def classification_metrics(labels: Sequence[int], predictions: Sequence[bool]) -> dict[str, Any]:
    """准确率 / 精确率 / 召回率 / 平衡准确率 / F1。"""
    y = np.asarray(list(labels), dtype=int)
    p = np.asarray([bool(value) for value in predictions])
    if y.size == 0:
        return {"n": 0}
    tp = int(np.sum(p & (y == 1)))
    fp = int(np.sum(p & (y == 0)))
    tn = int(np.sum(~p & (y == 0)))
    fn = int(np.sum(~p & (y == 1)))
    total = tp + fp + tn + fn
    accuracy = (tp + tn) / total if total else 0.0
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    specificity = tn / (tn + fp) if (tn + fp) else 0.0
    balanced = (recall + specificity) / 2.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    return {
        "n": total,
        "tp": tp,
        "fp": fp,
        "tn": tn,
        "fn": fn,
        "accuracy": round(float(accuracy), 6),
        "precision": round(float(precision), 6),
        "recall": round(float(recall), 6),
        "specificity": round(float(specificity), 6),
        "balanced_accuracy": round(float(balanced), 6),
        "f1": round(float(f1), 6),
        "positive_rate": round(float(y.mean()), 6),
    }


# --------------------------------------------------------------------------- #
# 说话人配对
# --------------------------------------------------------------------------- #
def group_turns_by_speaker(turns: Iterable[dict[str, Any]]) -> dict[int, list[Interval]]:
    grouped: dict[int, list[Interval]] = {}
    for turn in turns:
        speaker = int(turn["speaker"])
        grouped.setdefault(speaker, []).append((float(turn["start"]), float(turn["end"])))
    return {speaker: merge_intervals(segments) for speaker, segments in grouped.items()}


def pair_speakers(
    pred_segments: dict[str, list[Sequence[float]]],
    gt_turns: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """按时间重叠最大把预测的 A/B 配到标注的 speaker 0/1。

    两人对两人只有两种配法，直接枚举；配不上的（标注只有一个人）返回 None。
    """
    gt = group_turns_by_speaker(gt_turns)
    pred_names = sorted(pred_segments)
    gt_speakers = sorted(gt)

    matrix: dict[str, dict[str, float]] = {}
    for name in pred_names:
        matrix[name] = {
            str(speaker): round(overlap_duration(pred_segments[name], gt[speaker]), 4)
            for speaker in gt_speakers
        }

    mapping: dict[str, int | None] = {name: None for name in pred_names}
    if not gt_speakers:
        return {"mapping": mapping, "overlap": matrix, "total_overlap": 0.0}

    if len(gt_speakers) == 1:
        only = gt_speakers[0]
        best_name = max(
            pred_names,
            key=lambda name: overlap_duration(pred_segments[name], gt[only]),
        )
        mapping[best_name] = only
        return {
            "mapping": mapping,
            "overlap": matrix,
            "total_overlap": round(overlap_duration(pred_segments[best_name], gt[only]), 4),
        }

    candidates = [gt_speakers[: len(pred_names)], list(reversed(gt_speakers[: len(pred_names)]))]
    best_assignment = candidates[0]
    best_score = -1.0
    for assignment in candidates:
        score = 0.0
        for name, speaker in zip(pred_names, assignment):
            score += overlap_duration(pred_segments[name], gt[speaker])
        if score > best_score:
            best_score = score
            best_assignment = assignment

    for name, speaker in zip(pred_names, best_assignment):
        mapping[name] = speaker
    return {
        "mapping": mapping,
        "overlap": matrix,
        "total_overlap": round(float(best_score), 4),
    }


# --------------------------------------------------------------------------- #
# DER
# --------------------------------------------------------------------------- #
def _frames_for(intervals: Iterable[Sequence[float]], n_frames: int, step: float) -> np.ndarray:
    mask = np.zeros(n_frames, dtype=bool)
    for start, end in merge_intervals(intervals):
        i0 = int(round(start / step))
        i1 = int(round(end / step))
        mask[max(0, i0) : min(n_frames, i1)] = True
    return mask


def _collar_mask(
    turns: Iterable[dict[str, Any]], n_frames: int, step: float, collar: float
) -> np.ndarray:
    if collar <= 0:
        return np.zeros(n_frames, dtype=bool)
    mask = np.zeros(n_frames, dtype=bool)
    for turn in turns:
        for boundary in (float(turn["start"]), float(turn["end"])):
            i0 = int(round((boundary - collar) / step))
            i1 = int(round((boundary + collar) / step))
            mask[max(0, i0) : min(n_frames, i1)] = True
    return mask


def diarization_error_rate(
    ref_turns: Iterable[dict[str, Any]],
    hyp_segments: dict[str, list[Sequence[float]]],
    duration: float,
    collar: float = 0.25,
    step: float = 0.01,
) -> dict[str, Any]:
    """DER（帧近似）。hyp_segments 的键先按 overlap 映射到 ref 的 speaker 编号。"""
    turns = [dict(turn) for turn in ref_turns]
    if duration <= 0 or not turns:
        return {"der": None, "reason": "no reference"}

    n_frames = max(1, int(round(duration / step)))
    pairing = pair_speakers(hyp_segments, turns)
    mapping = pairing["mapping"]

    grouped = group_turns_by_speaker(turns)
    ref_speakers = sorted(grouped)
    position_of = {speaker: index for index, speaker in enumerate(ref_speakers)}

    ref_index = np.full(n_frames, -1, dtype=np.int16)
    for speaker in ref_speakers:
        ref_index[_frames_for(grouped[speaker], n_frames, step)] = position_of[speaker]

    # 预测的 A/B 换成 ref 的 speaker 位置；配不上的记为 -2（全部算误报）
    pred_index = np.full(n_frames, -1, dtype=np.int16)
    for name, segments in hyp_segments.items():
        target = mapping.get(name)
        index = position_of.get(int(target), -2) if target is not None else -2
        pred_index[_frames_for(segments, n_frames, step)] = index

    ignored = _collar_mask(turns, n_frames, step, collar)
    # NIST 口径：分母是"参考语音时长"（去掉 collar），不是并集
    ref_has = (~ignored) & (ref_index >= 0)
    pred_has = (~ignored) & (pred_index >= 0)
    ref_frames = int(ref_has.sum())
    if ref_frames == 0:
        return {"der": None, "reason": "no reference frames"}

    miss = int((ref_has & ~pred_has).sum())
    false_alarm = int((~ref_has & pred_has).sum())
    correct = int((ref_has & pred_has & (ref_index == pred_index)).sum())
    confusion = int((ref_has & pred_has & (ref_index != pred_index)).sum())

    denominator = float(ref_frames)
    der = (miss + false_alarm + confusion) / denominator
    return {
        "der": round(float(der), 6),
        "miss": round(miss / denominator, 6),
        "false_alarm": round(false_alarm / denominator, 6),
        "confusion": round(confusion / denominator, 6),
        "scored_seconds": round(denominator * step, 3),
        "n_ref_frames": ref_frames,
        "pairing": pairing["mapping"],
        "total_overlap": pairing["total_overlap"],
    }


def der_with_pyannote(
    ref_turns: Iterable[dict[str, Any]],
    hyp_segments: dict[str, list[Sequence[float]]],
    collar: float = 0.25,
) -> dict[str, Any] | None:
    """用 pyannote.metrics 算 DER；没装就返回 None，由调用方退回自实现。"""
    try:
        from pyannote.core import Annotation, Segment
        from pyannote.metrics.diarization import DiarizationErrorRate
    except ImportError:
        return None

    reference = Annotation()
    for turn in ref_turns:
        reference[Segment(float(turn["start"]), float(turn["end"])), f"spk{int(turn['speaker'])}"] = "gt"

    hypothesis = Annotation()
    for name, segments in hyp_segments.items():
        for start, end in merge_intervals(segments):
            hypothesis[Segment(float(start), float(end)), str(name)] = "hyp"

    try:
        metric = DiarizationErrorRate(collar=float(collar), skip_overlap=False)
        # 3.x 与 4.x 的位置参数顺序不一样，用关键字避免踩坑
        detailed = metric(reference=reference, hypothesis=hypothesis, detailed=True)
    except TypeError:
        try:
            detailed = metric(hypothesis, reference, detailed=True)
        except Exception:  # pragma: no cover - 版本差异
            return None
    except Exception:  # pragma: no cover - 版本差异
        return None
    key = "diarization error rate"
    if key not in detailed:
        return None
    return {
        "der": round(float(detailed[key]), 6),
        "miss": round(float(detailed.get("missed detection", float("nan"))), 6),
        "false_alarm": round(float(detailed.get("false alarm", float("nan"))), 6),
        "confusion": round(float(detailed.get("confusion", float("nan"))), 6),
        "source": "pyannote.metrics",
    }


# --------------------------------------------------------------------------- #
# 其他
# --------------------------------------------------------------------------- #
def classification_table(
    truth: Sequence[str],
    predicted: Sequence[str],
    rows: Sequence[str],
    columns: Sequence[str],
) -> dict[str, Any]:
    """混淆矩阵 + 每类计数。"""
    matrix = {row: {column: 0 for column in columns} for row in rows}
    for gt, pred in zip(truth, predicted):
        if gt in matrix and pred in matrix[gt]:
            matrix[gt][pred] += 1
    total = sum(sum(row.values()) for row in matrix.values())
    correct = sum(matrix[row].get(row, 0) for row in rows if row in columns)
    per_class: dict[str, Any] = {}
    for row in rows:
        support = sum(matrix[row].values())
        hit = matrix[row].get(row, 0)
        per_class[row] = {
            "support": support,
            "recall": round(hit / support, 6) if support else None,
        }
    return {
        "rows": list(rows),
        "columns": list(columns),
        "matrix": matrix,
        "n": total,
        "accuracy": round(correct / total, 6) if total else None,
        "per_class": per_class,
    }


def category_of(fake_speakers: Iterable[int]) -> str:
    """把"被判为假的说话人集合"归一成四类结论（说话人编号取自 GT 空间）。"""
    speakers = sorted(set(int(speaker) for speaker in fake_speakers))
    if not speakers:
        return "both_real"
    if len(speakers) >= 2:
        return "both_fake"
    return "A_fake" if speakers[0] == 0 else "B_fake"


def mean_or_none(values: Iterable[float | None]) -> float | None:
    items = [float(value) for value in values if value is not None]
    if not items:
        return None
    return float(sum(items) / len(items))


def total_speech(segments: Iterable[Sequence[float]]) -> float:
    return total_duration(segments)

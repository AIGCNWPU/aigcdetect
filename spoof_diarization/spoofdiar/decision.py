"""判定：阈值选择（EER）与文件级结论。

τ 只在 val 上选，test 直接复用；两者都不允许在 test 上重新调参。
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Iterable, Sequence

import numpy as np

from . import utils

VERDICTS = ("both_real", "A_fake", "B_fake", "both_fake")


def speaker_is_fake(p_fake: float | None, threshold: float) -> bool:
    return p_fake is not None and float(p_fake) >= float(threshold)


def verdict_from_flags(a_fake: bool, b_fake: bool) -> str:
    if a_fake and b_fake:
        return "both_fake"
    if a_fake:
        return "A_fake"
    if b_fake:
        return "B_fake"
    return "both_real"


def verdict_of_result(result: dict[str, Any], threshold: float) -> str:
    flags = {speaker["id"]: speaker_is_fake(speaker.get("p_fake"), threshold) for speaker in result.get("speakers", [])}
    return verdict_from_flags(flags.get("A", False), flags.get("B", False))


# --------------------------------------------------------------------------- #
# EER
# --------------------------------------------------------------------------- #
def eer_and_threshold(labels: Sequence[int], scores: Sequence[float]) -> tuple[float, float]:
    """按说话人单位计算 EER 和对应的阈值。

    采用"阈值取分数本身、score >= t 判为假"的扫描方式，取 |FAR-FRR| 最小的点，
    EER 取该点的 (FAR+FRR)/2。样本量在千级时这个精度足够，且完全可复现。
    """
    y = np.asarray(list(labels), dtype=int)
    s = np.asarray(list(scores), dtype=float)
    if y.size == 0:
        raise ValueError("没有样本，无法计算 EER")
    if len(set(y.tolist())) < 2:
        raise ValueError("标签只有一类，无法计算 EER")

    n_pos = int(y.sum())
    n_neg = int(y.size - n_pos)
    best = None
    for threshold in np.unique(s):
        predicted = s >= threshold
        false_positive = int(np.sum(predicted & (y == 0)))
        false_negative = int(np.sum(~predicted & (y == 1)))
        far = false_positive / n_neg
        frr = false_negative / n_pos
        gap = abs(far - frr)
        if best is None or gap < best[0]:
            best = (gap, far, frr, float(threshold))
    assert best is not None
    eer = (best[1] + best[2]) / 2.0
    return float(eer), best[3]


def select_threshold(units: Iterable[dict[str, Any]], scope: str = "all") -> dict[str, Any]:
    """在 val 的说话人单位上选阈值。

    同时给出 all / modified 两种口径，最终按 scope 取用，便于检查口径差异。
    """
    all_units = [unit for unit in units if unit.get("p_fake") is not None]
    variants: dict[str, Any] = {}
    for name, subset in (
        ("all", all_units),
        ("modified", [unit for unit in all_units if unit.get("condition") == "modified"]),
    ):
        if not subset:
            variants[name] = None
            continue
        labels = [int(unit["label"]) for unit in subset]
        scores = [float(unit["p_fake"]) for unit in subset]
        try:
            eer, threshold = eer_and_threshold(labels, scores)
        except ValueError as exc:
            variants[name] = {"error": str(exc), "n_units": len(subset)}
            continue
        variants[name] = {
            "eer": round(eer, 6),
            "threshold": round(threshold, 6),
            "n_units": len(subset),
            "n_positive": int(sum(labels)),
            "n_negative": int(len(labels) - sum(labels)),
        }

    chosen = variants.get(scope)
    if not chosen or "threshold" not in chosen:
        raise ValueError(f"scope={scope} 没有可用的阈值（{chosen}）")
    return {
        "threshold": chosen["threshold"],
        "eer": chosen["eer"],
        "scope": scope,
        "n_units": chosen["n_units"],
        "n_positive": chosen["n_positive"],
        "n_negative": chosen["n_negative"],
        "variants": variants,
        "selected_at": utils.now_stamp(),
    }


def save_threshold(path: str | os.PathLike[str], payload: dict[str, Any], split: str) -> Path:
    body = dict(payload)
    body["split"] = split
    return utils.write_json(path, body)


def load_threshold(cfg: dict[str, Any], explicit: float | None = None) -> tuple[float, str]:
    """返回 (阈值, 来源说明)。优先级：命令行 > config.decide.threshold > 阈值文件 > 0.5。"""
    if explicit is not None:
        return float(explicit), "cli"
    configured = cfg["decide"].get("threshold")
    if configured is not None:
        return float(configured), "config"

    path = Path(str(cfg["decide"]["threshold_file"]))
    payload = utils.read_json(path, default=None)
    if isinstance(payload, dict) and payload.get("threshold") is not None:
        return float(payload["threshold"]), f"file:{path}"
    return 0.5, "default"


# --------------------------------------------------------------------------- #
# 回写判定
# --------------------------------------------------------------------------- #
def apply_threshold(result: dict[str, Any], threshold: float) -> dict[str, Any]:
    """按给定阈值重算 is_fake / verdict，返回同一个 dict（就地修改）。"""
    updated = dict(result)
    speakers = []
    for speaker in result.get("speakers", []):
        item = dict(speaker)
        item["is_fake"] = speaker_is_fake(item.get("p_fake"), threshold)
        speakers.append(item)
    updated["speakers"] = speakers
    updated["threshold"] = float(threshold)
    flags = {item["id"]: bool(item["is_fake"]) for item in speakers}
    updated["verdict"] = verdict_from_flags(flags.get("A", False), flags.get("B", False))
    return updated


def apply_threshold_to_dir(out_dir: str | os.PathLike[str], threshold: float) -> dict[str, int]:
    """把目录下所有 result.json 的判定更新成新阈值。"""
    root = Path(out_dir)
    touched = 0
    skipped = 0
    for path in sorted(root.glob("*/result.json")):
        payload = utils.read_json(path, default=None)
        if not isinstance(payload, dict):
            skipped += 1
            continue
        utils.write_json(path, apply_threshold(payload, threshold))
        touched += 1
    return {"updated": touched, "skipped": skipped}

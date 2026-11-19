"""标注构建：把 DailyTalkEdit 的 metadata 与 DailyTalk 的说话人标签合成 GT。

核心难点是时间轴（TASK_SPEC 1.3 第 3、4 条）：
    * concat_utts 若不是"无间隔直接拼接"，各句起点不能用累计时长算；
    * 这里先用累计时长，与真实文件时长比对，超出容差时用归一化互相关逐句对齐；
    * modified 版本里被替换句的时长变了，后续句子整体平移，
      算出来的伪造区间要与 metadata 里的 fake_region 对照。
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Iterable

import numpy as np

from . import audio as audio_io
from . import parsing, utils
from .dailytalk import DailyTalkEdit, DailyTalkIndex, DailyTalkTurn
from .utils import Interval


# --------------------------------------------------------------------------- #
# 时间轴
# --------------------------------------------------------------------------- #
def cumulative_starts(durations: Iterable[float], start: float = 0.0) -> list[float]:
    starts: list[float] = []
    cursor = float(start)
    for duration in durations:
        starts.append(cursor)
        cursor += float(duration)
    return starts


def _best_offset(template: np.ndarray, region: np.ndarray) -> tuple[int, float]:
    """归一化互相关，返回 (相对 region 起点的偏移采样数, 相关系数)。"""
    length = int(template.size)
    span = int(region.size)
    if length == 0 or span < length:
        return 0, 0.0
    template = template.astype(np.float64)
    region = region.astype(np.float64)
    template = template - float(template.mean())
    region = region - float(region.mean())

    size = 1 << int(np.ceil(np.log2(span + length - 1)))
    spectrum_region = np.fft.rfft(region, size)
    spectrum_template = np.fft.rfft(template, size)
    corr = np.fft.irfft(spectrum_region * np.conj(spectrum_template), size)
    valid = corr[: span - length + 1]

    cumulative = np.concatenate([[0.0], np.cumsum(region**2)])
    energy = cumulative[length:] - cumulative[:-length]
    denominator = np.sqrt(np.maximum(energy, 1e-12)) * (float(np.linalg.norm(template)) + 1e-12)
    scores = valid / denominator
    index = int(np.argmax(scores))
    return index, float(scores[index])


def align_starts(
    concat: np.ndarray,
    sample_rate: int,
    utterances: list[np.ndarray],
    expected_starts: list[float],
    back: float = 0.3,
    ahead: float = 0.8,
    min_score: float = 0.45,
) -> tuple[list[float], list[float], list[bool]]:
    """逐句在 concat 里找真实起点。

    返回 (starts, scores, accepted)。相关系数低于 min_score 时保留预期位置。
    """
    total = concat.size
    starts: list[float] = []
    scores: list[float] = []
    accepted: list[bool] = []
    cursor = 0.0

    for utterance, expected in zip(utterances, expected_starts):
        length = int(utterance.size)
        if length == 0 or total == 0:
            starts.append(expected)
            scores.append(0.0)
            accepted.append(False)
            cursor = expected + float(length) / float(sample_rate)
            continue

        guess = max(float(expected), cursor)
        start_frame = max(0, int(round((guess - back) * sample_rate)))
        end_frame = min(total, int(round((guess + float(length) / sample_rate + ahead) * sample_rate)))
        if end_frame - start_frame < length:
            starts.append(guess)
            scores.append(0.0)
            accepted.append(False)
            cursor = guess + float(length) / float(sample_rate)
            continue

        region = concat[start_frame:end_frame]
        offset, score = _best_offset(utterance, region)
        found = (start_frame + offset) / float(sample_rate)
        if score >= min_score:
            starts.append(round(found, 4))
            scores.append(round(score, 4))
            accepted.append(True)
            cursor = found + float(length) / float(sample_rate)
        else:
            starts.append(round(guess, 4))
            scores.append(round(score, 4))
            accepted.append(False)
            cursor = guess + float(length) / float(sample_rate)

    return starts, scores, accepted


# --------------------------------------------------------------------------- #
# 单条样本
# --------------------------------------------------------------------------- #
def _turns_payload(
    starts: list[float],
    durations: list[float],
    turns: list[DailyTalkTurn],
) -> list[dict[str, Any]]:
    payload: list[dict[str, Any]] = []
    for turn, start, duration in zip(turns, starts, durations):
        payload.append(
            {
                "start": round(float(start), 4),
                "end": round(float(start) + float(duration), 4),
                "speaker": int(turn.speaker),
                "utt_idx": int(turn.index),
            }
        )
    return payload


def dialogue_length_hint(entry: dict[str, Any] | None) -> int | None:
    """从 modify_config 里的 original_dialogue 数出句子条数。"""
    if not entry:
        return None
    text = entry.get("original_dialogue")
    if not isinstance(text, str):
        return None
    return len(re.findall(r"^\[\d+\]", text, flags=re.MULTILINE))


def build_pair(
    edit: DailyTalkEdit,
    index: DailyTalkIndex,
    dialog_id: str,
    row: dict[str, Any],
    split: str,
    align: str = "auto",
    tolerance: float = 0.06,
) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any]]:
    """构造 (original, modified) 两条标注；失败时返回 (None, None, report)。"""
    report: dict[str, Any] = {"dialog_id": dialog_id, "warnings": [], "errors": []}

    original_path = edit.original_wav(dialog_id)
    modified_path = edit.modified_wav(dialog_id)
    if not original_path.is_file() or not modified_path.is_file():
        report["errors"].append(
            f"concat_utts 缺少文件：{original_path.name} / {modified_path.name}"
        )
        return None, None, report

    try:
        turns = index.turns(dialog_id)
    except KeyError as exc:
        report["errors"].append(str(exc))
        return None, None, report

    entry = edit.modify_entry(dialog_id)
    if entry is None:
        report["errors"].append("modify_config_pipeline.json 里没有这条对话")
        return None, None, report
    target_index = int(entry.get("target_utterance_idx", -1))
    if not 0 <= target_index < len(turns):
        report["errors"].append(
            f"target_utterance_idx={target_index} 超出对话句数 {len(turns)}"
        )
        return None, None, report

    speech_hint = dialogue_length_hint(entry)
    if speech_hint is not None and speech_hint != len(turns):
        report["warnings"].append(
            f"modify_config 里 {speech_hint} 句，DailyTalk metadata 里 {len(turns)} 句，不一致"
        )

    # ---- 每句的时长（优先用 DailyTalk 索引，没音频也能建时间轴）
    durations: list[float] = []
    missing: list[str] = []
    for turn in turns:
        try:
            durations.append(
                float(index.utterance_duration(dialog_id, turn.key, turn.speaker))
            )
        except (FileNotFoundError, KeyError) as exc:
            missing.append(f"utt {turn.index} key={turn.key} spk={turn.speaker}")
            durations.append(0.0)

    if missing:
        report["errors"].append("DailyTalk 缺少单句音频或时长：" + "; ".join(missing[:5]))
        return None, None, report

    original_duration = audio_io.audio_info(original_path)["duration"]
    modified_duration = audio_io.audio_info(modified_path)["duration"]
    total_speech = float(sum(durations))
    gap = original_duration - total_speech

    checks: dict[str, Any] = {
        "original_duration": round(original_duration, 4),
        "modified_duration": round(modified_duration, 4),
        "sum_utterance_duration": round(total_speech, 4),
        "gap_seconds": round(gap, 4),
        "gapless": abs(gap) <= tolerance,
        "aligned": False,
        "alignment_scores": [],
        "turn_count_dailytalk": len(turns),
        "turn_count_config": speech_hint,
        "durations_from": "index" if index.index_file else "wav",
    }

    starts = cumulative_starts(durations)
    should_align = align == "always" or (
        align == "auto" and abs(gap) > tolerance
    )
    if should_align and not index.has_audio:
        should_align = False
        report["warnings"].append(
            "只有 DailyTalk 索引、没有单句音频，跳过互相关对齐（用累计时长）"
        )
    if should_align:
        concat, sample_rate = audio_io.read_audio(original_path)
        mono = audio_io.to_mono(concat)
        wav_paths = [
            index.wav_path(dialog_id, turn.key, turn.speaker) for turn in turns
        ]
        utterances = [audio_io.to_mono(audio_io.read_audio(path)[0]) for path in wav_paths]
        starts, scores, accepted = align_starts(mono, sample_rate, utterances, starts)
        checks["aligned"] = True
        checks["alignment_scores"] = scores
        checks["alignment_accepted"] = accepted
        if not all(accepted):
            report["warnings"].append(
                f"{sum(1 for flag in accepted if not flag)}/{len(accepted)} 句对齐失败，用累计时长兜底"
            )

    # ---- modified 时间轴：替换目标句时长，后续整体平移
    modified_utt_path = edit.modified_utt(dialog_id, target_index, turns[target_index].key)
    modified_utt_duration = audio_io.audio_info(modified_utt_path)["duration"]
    delta = modified_utt_duration - durations[target_index]

    modified_durations = list(durations)
    modified_durations[target_index] = modified_utt_duration
    modified_starts = list(starts)
    for position in range(target_index + 1, len(modified_starts)):
        modified_starts[position] += delta

    computed_region: Interval = (
        float(modified_starts[target_index]),
        float(modified_starts[target_index]) + float(modified_utt_duration),
    )

    given_regions = parsing.normalize_regions(
        row.get("fake_region"), duration=modified_duration
    )
    checks["region_computed"] = [round(computed_region[0], 3), round(computed_region[1], 3)]
    checks["region_given"] = [[round(s, 3), round(e, 3)] for s, e in given_regions]
    if given_regions:
        given = given_regions[0]
        checks["region_abs_diff"] = round(
            max(abs(computed_region[0] - given[0]), abs(computed_region[1] - given[1])), 4
        )
        checks["region_overlap_ratio"] = round(
            utils.overlap_duration([computed_region], [given])
            / max(1e-9, utils.total_duration([given])),
            4,
        )
        if checks["region_abs_diff"] > 0.5:
            report["warnings"].append(
                "计算出的伪造区间与 fake_region 相差 "
                f"{checks['region_abs_diff']:.2f}s（computed={checks['region_computed']}，"
                f"given={checks['region_given']}）"
            )
    else:
        report["warnings"].append("metadata 里没有可用的 fake_region")

    fake_speaker = int(turns[target_index].speaker)
    fake_regions = [[round(s, 4), round(e, 4)] for s, e in given_regions]

    # 自检：modified 的时间轴只把目标句换掉、其余结构不变，
    # 所以它的总时长应当正好是 original 时长加上 delta。
    expected_modified_duration = original_duration + delta
    checks["expected_modified_duration"] = round(expected_modified_duration, 4)
    checks["modified_duration_gap"] = round(modified_duration - expected_modified_duration, 4)
    if abs(checks["modified_duration_gap"]) > tolerance:
        report["warnings"].append(
            "modified 时间轴重建有偏差：实际 "
            f"{modified_duration:.2f}s，预期 {expected_modified_duration:.2f}s"
            "（说明句间结构或对齐有问题）"
        )

    common = {
        "pair_id": str(dialog_id),
        "split": split,
        "dialog_id": str(dialog_id),
        "target_utt_idx": int(target_index),
        "checks": checks,
    }
    original_record = dict(common)
    original_record.update(
        {
            "file_id": f"{dialog_id}_original",
            "condition": "original",
            "audio_path": str(original_path.resolve()),
            "duration": round(original_duration, 3),
            "turns": _turns_payload(starts, durations, turns),
            "fake_speaker": None,
            "fake_regions": [],
            "semantic_influence": row.get("semantic_influence"),
        }
    )
    modified_record = dict(common)
    modified_record.update(
        {
            "file_id": f"{dialog_id}_modified",
            "condition": "modified",
            "audio_path": str(modified_path.resolve()),
            "duration": round(modified_duration, 3),
            "turns": _turns_payload(modified_starts, modified_durations, turns),
            "fake_speaker": fake_speaker,
            "fake_regions": fake_regions,
            "semantic_influence": row.get("semantic_influence"),
            "modified_utt_path": str(modified_utt_path.resolve()),
            "modified_utt_duration": round(modified_utt_duration, 4),
        }
    )
    return original_record, modified_record, report


# --------------------------------------------------------------------------- #
# 整个 split
# --------------------------------------------------------------------------- #
def split_dialog_id(filename: str) -> str:
    """'7_modified.wav' -> '7'。"""
    stem = Path(filename).name
    if stem.endswith(".wav"):
        stem = stem[: -len(".wav")]
    for suffix in ("_modified", "_original"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem.split("_")[0]


def build_split(
    edit: DailyTalkEdit,
    index: DailyTalkIndex,
    split: str,
    align: str = "auto",
    limit: int | None = None,
    tolerance: float = 0.06,
    only_pairs: set[str] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    rows = edit.split_rows(split)
    if only_pairs:
        rows = [
            row for row in rows if split_dialog_id(str(row.get("filename", ""))) in only_pairs
        ]
    if limit is not None:
        rows = rows[: int(limit)]

    records: list[dict[str, Any]] = []
    reports: list[dict[str, Any]] = []
    seen: set[str] = set()

    for row in rows:
        dialog_id = split_dialog_id(str(row.get("filename", "")))
        if dialog_id in seen:
            continue
        seen.add(dialog_id)
        original, modified, report = build_pair(
            edit, index, dialog_id, row, split, align=align, tolerance=tolerance
        )
        report["ok"] = original is not None and modified is not None
        reports.append(report)
        if original and modified:
            records.append(original)
            records.append(modified)

    records.sort(key=lambda item: (utils.natural_key(item["pair_id"]), item["condition"]))
    stats = summarize(reports, records, split)
    return records, stats


def summarize(
    reports: list[dict[str, Any]], records: list[dict[str, Any]], split: str
) -> dict[str, Any]:
    ok = [report for report in reports if report.get("ok")]
    failed = [report for report in reports if not report.get("ok")]
    warnings = [
        {"dialog_id": report["dialog_id"], "warnings": report["warnings"]}
        for report in reports
        if report.get("warnings")
    ]
    gaps = [
        record["checks"]["gap_seconds"]
        for record in records
        if record["condition"] == "original"
    ]
    gapless = [record["checks"]["gapless"] for record in records if record["condition"] == "original"]
    region_diffs = [
        record["checks"]["region_abs_diff"]
        for record in records
        if record["condition"] == "modified" and "region_abs_diff" in record["checks"]
    ]
    timeline_gaps = [
        abs(record["checks"]["modified_duration_gap"])
        for record in records
        if record["condition"] == "modified" and "modified_duration_gap" in record["checks"]
    ]
    aligned = [record["checks"]["aligned"] for record in records if record["condition"] == "original"]
    return {
        "split": split,
        "n_pairs_requested": len(reports),
        "n_pairs_ok": len(ok),
        "n_pairs_failed": len(failed),
        "n_files": len(records),
        "failed": [
            {"dialog_id": report["dialog_id"], "errors": report["errors"]} for report in failed
        ],
        "warnings": warnings,
        "duration_gap": {
            "n": len(gaps),
            "max_abs": round(max((abs(value) for value in gaps), default=0.0), 4),
            "mean": round(float(np.mean(gaps)), 4) if gaps else None,
            "gapless_ratio": round(sum(1 for flag in gapless if flag) / len(gapless), 4)
            if gapless
            else None,
            "aligned_ratio": round(sum(1 for flag in aligned if flag) / len(aligned), 4)
            if aligned
            else None,
        },
        "fake_region_check": {
            "n": len(region_diffs),
            "max_abs_diff": round(max(region_diffs), 4) if region_diffs else None,
            "mean_abs_diff": round(float(np.mean(region_diffs)), 4) if region_diffs else None,
            "within_0.5s": round(sum(1 for value in region_diffs if value <= 0.5) / len(region_diffs), 4)
            if region_diffs
            else None,
        },
        "modified_timeline_check": {
            "n": len(timeline_gaps),
            "max_abs_gap": round(max(timeline_gaps), 4) if timeline_gaps else None,
            "within_0.1s": round(sum(1 for value in timeline_gaps if value <= 0.1) / len(timeline_gaps), 4)
            if timeline_gaps
            else None,
        },
        "fake_speaker_counts": _count_by(
            [record["fake_speaker"] for record in records if record["condition"] == "modified"]
        ),
    }


def _count_by(values: Iterable[Any]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key = "null" if value is None else str(value)
        counts[key] = counts.get(key, 0) + 1
    return counts


def write_split(
    path: str | Path,
    records: list[dict[str, Any]],
    stats: dict[str, Any] | None = None,
    stats_path: str | Path | None = None,
) -> None:
    utils.write_jsonl(path, records)
    if stats is not None and stats_path is not None:
        utils.write_json(stats_path, stats)


def load_split(path: str | Path) -> list[dict[str, Any]]:
    return utils.read_jsonl(path)


# --------------------------------------------------------------------------- #
# 人工抽检：把伪造句切出来试听
# --------------------------------------------------------------------------- #
def export_check_samples(
    edit: DailyTalkEdit,
    index: DailyTalkIndex,
    records: list[dict[str, Any]],
    out_dir: str | Path,
    n: int = 5,
) -> list[dict[str, Any]]:
    """切出伪造句（同时切出原文件同一句）供人工试听，并写 manifest.json。

    验收要求"按 turns 切出伪造句所在片段试听，确认说话人和时间对得上"，
    听的时候对照 manifest 里的目标句文本、说话人、时间即可。
    """
    out = Path(out_dir)
    utils.ensure_dir(out)
    by_id = {record["file_id"]: record for record in records}
    manifest: list[dict[str, Any]] = []

    for record in records:
        if len(manifest) >= n:
            break
        if record.get("condition") != "modified":
            continue
        regions = record.get("fake_regions") or []
        if not regions:
            continue
        pair_id = str(record["pair_id"])
        target = int(record.get("target_utt_idx", -1))
        if target < 0:
            continue

        entry = edit.modify_entry(pair_id) or {}
        turns = index.turns(pair_id)
        speaker = int(record.get("fake_speaker", -1))
        start, end = float(regions[0][0]), float(regions[0][1])

        modified_audio, sample_rate = audio_io.read_audio(record["audio_path"])
        subtype = audio_io.audio_info(record["audio_path"])["subtype"]
        fake_clip = modified_audio[
            max(0, int(round(start * sample_rate))) : int(round(end * sample_rate))
        ]
        fake_path = out / f"{record['file_id']}_fake_{start:.2f}-{end:.2f}.wav"
        audio_io.write_audio(fake_path, fake_clip, sample_rate, subtype=subtype)

        original_path = None
        original_record = by_id.get(f"{pair_id}_original")
        if original_record is not None:
            original_audio, _ = audio_io.read_audio(original_record["audio_path"])
            original_turn = (original_record.get("turns") or [])[target]
            o_start = float(original_turn["start"])
            o_end = float(original_turn["end"])
            clip = original_audio[
                max(0, int(round(o_start * sample_rate))) : int(round(o_end * sample_rate))
            ]
            original_path = out / f"{record['file_id']}_original_utt_{o_start:.2f}-{o_end:.2f}.wav"
            audio_io.write_audio(original_path, clip, sample_rate, subtype=subtype)

        manifest.append(
            {
                "file_id": record["file_id"],
                "pair_id": pair_id,
                "target_utt_idx": target,
                "fake_speaker": speaker,
                "fake_region": [round(start, 3), round(end, 3)],
                "target_text_original": turns[target].text if target < len(turns) else None,
                "target_text_modified": entry.get("modified_text"),
                "clip_fake": str(fake_path.resolve()),
                "clip_original_utterance": None
                if original_path is None
                else str(original_path.resolve()),
                "note": "先听 clip_fake 确认是篡改后的那句，再听 clip_original_utterance 对照同一句的原文",
            }
        )

    utils.write_json(out / "manifest.json", {"samples": manifest})
    return manifest

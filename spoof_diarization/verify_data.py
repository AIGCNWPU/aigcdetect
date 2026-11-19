#!/usr/bin/env python
"""核实 DailyTalkEdit / DailyTalk 的数据事实（TASK_SPEC 1.3 的七条）。

用法：
    python verify_data.py --split test --samples 5
    python verify_data.py --split val --samples 10 --report docs/data_notes_measured.md

这个脚本不改任何数据，只打印与落盘一份测量记录，用来填 docs/data_notes.md
里那些"必须实测"的条目。
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from spoofdiar import config as config_mod
from spoofdiar import gtbuild, utils
from spoofdiar.dailytalk import DailyTalkEdit, DailyTalkIndex
from spoofdiar import audio as audio_io


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="核实数据集结构与标注字段")
    parser.add_argument(
        "--config", default=str(HERE / "config.yaml"), help="配置文件路径"
    )
    parser.add_argument("--set", dest="overrides", action="append", default=[], metavar="KEY=VALUE")
    parser.add_argument("--split", default="test", choices=["val", "test"], help="只看 val / test，不碰 train")
    parser.add_argument("--samples", type=int, default=5, help="逐条核实的样本数")
    parser.add_argument(
        "--report", default=None, help="把测量结果写进这个 markdown 文件（默认只打印）"
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    cfg = config_mod.load_config(args.config, args.overrides)
    edit_root = cfg["paths"].get("dailytalkedit_root")
    talk_root = cfg["paths"].get("dailytalk_root")
    if not edit_root:
        print("请先在 config.yaml 里设置 paths.dailytalkedit_root", file=sys.stderr)
        return 2

    lines: list[str] = []

    def emit(text: str = "") -> None:
        print(text)
        lines.append(text)

    emit(f"# 数据核实记录（split={args.split}）")
    emit("")
    emit(f"生成时间：{utils.now_stamp()}")
    emit("")

    edit = DailyTalkEdit(edit_root)
    emit("## 0. 目录")
    for key, value in edit.summary().items():
        emit(f"- {key}: {value}")
    emit("")

    rows = edit.split_rows(args.split)
    emit(f"## 7. {args.split} 的实际样本数")
    emit("")
    emit(f"- `metadata/{args.split}.jsonl` 行数：**{len(rows)}**")
    for other in ("train", "val", "test"):
        path = edit.metadata_dir / f"{other}.jsonl"
        count = len(utils.read_jsonl(path)) if path.is_file() else None
        emit(f"- {other}.jsonl：{count}（train 不参与任何流程）")
    emit("")

    emit("## 2. fake_region 的原始格式")
    emit("")
    emit("前 5 条原文（逐字打印）：")
    emit("")
    emit("```json")
    for line in rows[:5]:
        emit(json.dumps(line, ensure_ascii=False))
    emit("```")
    emit("")
    kinds: dict[str, int] = {}
    region_lengths: list[int] = []
    for row in rows:
        value = row.get("fake_region")
        kinds[type(value).__name__] = kinds.get(type(value).__name__, 0) + 1
        if isinstance(value, list):
            region_lengths.append(len(value))
    emit(f"- 字段类型分布：{kinds}")
    emit(f"- 每条的区间个数：{sorted(set(region_lengths)) if region_lengths else '没有 list'}")
    samples = []
    for row in rows[:50]:
        value = row.get("fake_region")
        if isinstance(value, list) and value and isinstance(value[0], list):
            start, end = value[0][0], value[0][1]
            if isinstance(start, (int, float)) and isinstance(end, (int, float)):
                samples.append(float(end) - float(start))
    if samples:
        emit(
            "- 区间长度（秒）：最小 {:.2f} / 中位 {:.2f} / 最大 {:.2f}（前 50 条）".format(
                min(samples), sorted(samples)[len(samples) // 2], max(samples)
            )
        )
    emit("")

    emit("## 6. 采样率 / 声道数")
    emit("")
    probe_rows: list[list[Any]] = []
    if rows:
        dialog_id = gtbuild.split_dialog_id(str(rows[0].get("filename", "")))
        targets = [edit.original_wav(dialog_id), edit.modified_wav(dialog_id)]
        for path in targets:
            if path.is_file():
                info = audio_io.audio_info(path)
                probe_rows.append([path.name, info["samplerate"], info["channels"],
                                   info["subtype"], round(info["duration"], 2)])
    if probe_rows:
        emit("| 文件 | 采样率 | 声道 | 子类型 | 时长(s) |")
        emit("| --- | --- | --- | --- | --- |")
        for row in probe_rows:
            emit("| " + " | ".join(str(value) for value in row) + " |")
    else:
        emit("- 没找到 concat_utts 文件，跳过")
    emit("")

    if not talk_root:
        emit("## 1 / 3 / 4 / 5：需要 DailyTalk")
        emit("")
        emit("未配置 `paths.dailytalk_root`，跳过 `<id>` 对应关系、拼接是否无间隔、")
        emit("伪造区间复核和说话人解析。补上后再跑一次本脚本。")
        _write(args.report, lines)
        return 0

    talk = DailyTalkIndex(talk_root)
    emit("## DailyTalk 索引")
    for key, value in talk.summary().items():
        emit(f"- {key}: {value}")
    emit("")

    emit("## 1. `<id>` 与 DailyTalk 的 `dialog_idx`")
    emit("")
    emit("约定：`<id>` 就是 DailyTalk 的 `dialog_idx`；`<utt_id>` 是它在对话里的句序（0 起）。")
    emit("")
    emit("| <id> | DailyTalk 句数 | modify_config 目标句序 | 目标句 key | 目标句说话人 | 句数一致 |")
    emit("| --- | --- | --- | --- | --- | --- |")
    for row in rows[: max(args.samples, 5)]:
        dialog_id = gtbuild.split_dialog_id(str(row.get("filename", "")))
        try:
            turns = talk.turns(dialog_id)
        except KeyError:
            emit(f"| {dialog_id} | 缺失 | - | - | - | ✗ |")
            continue
        entry = edit.modify_entry(dialog_id) or {}
        target = entry.get("target_utterance_idx")
        key = turns[int(target)].key if target is not None and int(target) < len(turns) else "-"
        speaker = turns[int(target)].speaker if target is not None and int(target) < len(turns) else "-"
        hint = gtbuild.dialogue_length_hint(entry)
        emit(
            f"| {dialog_id} | {len(turns)} | {target} | {key} | {speaker} | "
            f"{'✓' if hint == len(turns) else '✗'} |"
        )
    emit("")

    emit(f"## 3 / 4. 拼接是否无间隔、伪造区间是否对得上（{args.samples} 条）")
    emit("")
    emit("| <id> | original 时长 | 各句时长之和 | 差值 | computed 区间 | fake_region | 端点最大差 | 覆盖比 |")
    emit("| --- | --- | --- | --- | --- | --- | --- | --- |")
    gaps: list[float] = []
    region_diffs: list[float] = []
    for row in rows[: args.samples]:
        dialog_id = gtbuild.split_dialog_id(str(row.get("filename", "")))
        original, modified, report = gtbuild.build_pair(
            edit, talk, dialog_id, row, args.split, align="off"
        )
        if original is None:
            emit(f"| {dialog_id} | - | - | - | - | - | - | 失败：{'；'.join(report['errors'])} |")
            continue
        checks = original["checks"]
        gaps.append(float(checks["gap_seconds"]))
        diff = checks.get("region_abs_diff")
        if diff is not None:
            region_diffs.append(float(diff))
        emit(
            "| {} | {:.2f} | {:.2f} | {:+.3f} | {} | {} | {} | {} |".format(
                dialog_id,
                checks["original_duration"],
                checks["sum_utterance_duration"],
                checks["gap_seconds"],
                checks.get("region_computed"),
                checks.get("region_given"),
                "n/a" if diff is None else f"{diff:.3f}",
                checks.get("region_overlap_ratio", "n/a"),
            )
        )
    emit("")
    if gaps:
        emit(
            "- 时长差值：max|gap| = {:.3f}s，mean = {:+.3f}s → {}".format(
                max(abs(value) for value in gaps),
                sum(gaps) / len(gaps),
                "**无间隔直接拼接**，累计时长可直接当作各句起点"
                if max(abs(value) for value in gaps) <= 0.06
                else "**有间隔或做了重采样**，需要互相关对齐（build_gt.py --align auto 已内置）",
            )
        )
    if region_diffs:
        emit(
            "- 伪造区间端点最大差：{:.3f}s（{} 条 ≤ 0.5s）".format(
                max(region_diffs), sum(1 for value in region_diffs if value <= 0.5)
            )
        )
    emit("")

    emit("## 5. 被替换句的说话人解析")
    emit("")
    resolved = 0
    distribution: dict[str, int] = {}
    for row in rows:
        dialog_id = gtbuild.split_dialog_id(str(row.get("filename", "")))
        try:
            turns = talk.turns(dialog_id)
        except KeyError:
            continue
        entry = edit.modify_entry(dialog_id) or {}
        target = entry.get("target_utterance_idx")
        if target is None or int(target) >= len(turns):
            continue
        resolved += 1
        speaker = str(turns[int(target)].speaker)
        distribution[speaker] = distribution.get(speaker, 0) + 1
    emit(f"- 成功解析：{resolved}/{len(rows)}")
    emit(f"- 说话人分布：{distribution}（0=男，1=女）")
    emit("")

    _write(args.report, lines)
    return 0


def _write(path: str | None, lines: list[str]) -> None:
    if not path:
        return
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n已写入 {target}")


if __name__ == "__main__":
    raise SystemExit(main())

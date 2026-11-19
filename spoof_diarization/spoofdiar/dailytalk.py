"""DailyTalkEdit / DailyTalk 数据索引。

DailyTalkEdit 的结构（已在 HF 上核实）：

    daily_talk_edit/
        concat_utts/<id>_original.wav
        concat_utts/<id>_modified.wav
        modified_utts/<id>_<utt_id>_modified.wav
        metadata/{train,val,test}.jsonl          # filename / fake_region / semantic_influence
        metadata/modify_config_pipeline.json     # dialog_id -> target_utterance_idx ...

DailyTalk 的结构（lhotse 的 daily_talk recipe 与官方仓库确认）：

    metadata.json = {dialog_id: {utt_key: {"speaker": 0|1, "text": ...}}}
    data/<utt_key>_<speaker>_d<dialog_id>.wav
    speaker 0 = 男, 1 = 女

DailyTalkEdit 没有说话人标签，被篡改句的说话人要从 DailyTalk 的 metadata.json 查。
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import audio as audio_io
from . import utils

WAV_PATTERN = re.compile(r"^(?P<key>.+)_(?P<speaker>[01])_d(?P<dialog>\d+)$")


@dataclass
class DailyTalkTurn:
    index: int
    key: str
    speaker: int
    text: str


class DailyTalkEdit:
    """DailyTalkEdit 数据集（只读）。"""

    def __init__(self, root: str | Path):
        self.root = Path(root).expanduser().resolve()
        self.base = self.root / "daily_talk_edit"
        if not self.base.is_dir():
            # 也允许直接指向 daily_talk_edit/
            if (self.root / "concat_utts").is_dir():
                self.base = self.root
            else:
                raise FileNotFoundError(
                    f"{self.root} 下找不到 daily_talk_edit/，请把 dailytalkedit_root 指到 HF snapshot 根目录"
                )
        self.metadata_dir = self.base / "metadata"
        self.concat_dir = self.base / "concat_utts"
        self.modified_dir = self.base / "modified_utts"
        self._modify_config: dict[str, Any] | None = None

    # ------------------------------------------------------------------ 元数据
    def split_rows(self, split: str) -> list[dict[str, Any]]:
        path = self.metadata_dir / f"{split}.jsonl"
        if not path.is_file():
            raise FileNotFoundError(
                f"找不到 {path}；split 只能是 train/val/test，且需要先下载数据集"
            )
        return utils.read_jsonl(path)

    @property
    def modify_config(self) -> dict[str, Any]:
        if self._modify_config is None:
            path = self.metadata_dir / "modify_config_pipeline.json"
            if not path.is_file():
                raise FileNotFoundError(f"找不到 {path}")
            with open(path, "r", encoding="utf-8") as handle:
                payload = json.load(handle)
            if not isinstance(payload, dict):
                raise ValueError(f"{path} 顶层不是字典")
            self._modify_config = {str(key): value for key, value in payload.items()}
        return self._modify_config

    def modify_entry(self, dialog_id: str | int) -> dict[str, Any] | None:
        return self.modify_config.get(str(dialog_id))

    # ------------------------------------------------------------------ 音频
    def original_wav(self, dialog_id: str | int) -> Path:
        return self.concat_dir / f"{dialog_id}_original.wav"

    def modified_wav(self, dialog_id: str | int) -> Path:
        return self.concat_dir / f"{dialog_id}_modified.wav"

    def modified_utt(self, dialog_id: str | int, target_index: int, utt_key: str | None = None) -> Path:
        """被替换句的单独音频；文件名里的 utt_id 一般是 target_utterance_idx。"""
        candidates = [self.modified_dir / f"{dialog_id}_{target_index}_modified.wav"]
        if utt_key is not None and str(utt_key) != str(target_index):
            candidates.append(self.modified_dir / f"{dialog_id}_{utt_key}_modified.wav")
        for candidate in candidates:
            if candidate.is_file():
                return candidate

        # 兜底：按数字后缀匹配（防止 utt_id 与 target_index 的编号方式不同）
        suffix = re.compile(rf"^{re.escape(str(dialog_id))}_(?P<id>.+)_modified\.wav$")
        matches: list[tuple[int, Path]] = []
        for path in sorted(self.modified_dir.glob(f"{dialog_id}_*_modified.wav")):
            match = suffix.match(path.name)
            if not match:
                continue
            digits = re.findall(r"\d+", match.group("id"))
            if digits and int(digits[-1]) == int(target_index):
                matches.append((int(digits[-1]), path))
        if matches:
            return matches[0][1]
        raise FileNotFoundError(
            f"找不到 dialog {dialog_id} 第 {target_index} 句的 modified 音频，"
            f"候选：{', '.join(str(path) for path in candidates)}"
        )

    # ------------------------------------------------------------------ 概览
    def summary(self) -> dict[str, Any]:
        info: dict[str, Any] = {"root": str(self.root), "base": str(self.base)}
        for split in ("train", "val", "test"):
            path = self.metadata_dir / f"{split}.jsonl"
            info[f"{split}_rows"] = len(utils.read_jsonl(path)) if path.is_file() else None
        info["concat_files"] = len(list(self.concat_dir.glob("*_original.wav")))
        info["modified_utt_files"] = len(list(self.modified_dir.glob("*_modified.wav")))
        return info


class DailyTalkIndex:
    """DailyTalk 原始数据：把 utt_key 映射到 wav，并提供说话人标签。

    两种数据来源：

    1. 完整解压的 DailyTalk（`metadata.json` + `data/**.wav`）——能读时长，也能喂对齐；
    2. 只有一份 **索引 JSON**（`dailytalk_index.json`）——含每个 utt 的 speaker/text/时长，
       没有音频。几十 KB 就能把「说话人 + 时间轴」建出来，适合带宽不够把整份
       DailyTalk（约 5 GB）传上去的场景。此时无法做互相关对齐（本来也用不到，
       见 docs/data_notes.md 第 3 条）。
    """

    def __init__(self, root: str | Path, index_file: str | Path | None = None):
        self.root = Path(root).expanduser().resolve()
        metadata_path = self.root / "metadata.json"
        nested = self.root / "dailytalk" / "metadata.json"
        if not metadata_path.is_file() and nested.is_file():
            self.root = nested.parent
            metadata_path = nested

        self.table: dict[str, Any] | None = None
        sidecar = Path(index_file) if index_file else (self.root / "dailytalk_index.json")
        if not sidecar.is_file() and not index_file:
            sibling = self.root.parent / "dailytalk_index.json"
            if sibling.is_file():
                sidecar = sibling
        if sidecar.is_file():
            with open(sidecar, "r", encoding="utf-8") as handle:
                self.table = json.load(handle)
            self.index_file: Path | None = sidecar
        else:
            self.index_file = None
            if not metadata_path.is_file():
                raise FileNotFoundError(
                    f"{self.root} 下既没有 metadata.json 也没有 dailytalk_index.json；"
                    "请把 dailytalk_root 指到解压后的 DailyTalk 目录，或用 index_file 指定索引"
                )
            with open(metadata_path, "r", encoding="utf-8") as handle:
                self.table = json.load(handle)

        self.metadata: dict[str, Any] = self.table or {}
        self.data_dir = self.root / "data"
        self._index: dict[tuple[str, str, int], Path] | None = None

    # ------------------------------------------------------------------ 索引
    def _build_index(self) -> dict[tuple[str, str, int], Path]:
        index: dict[tuple[str, str, int], Path] = {}
        if not self.data_dir.is_dir():
            return index
        for path in self.data_dir.rglob("*.wav"):
            match = WAV_PATTERN.match(path.stem)
            if not match:
                continue
            key = match.group("key")
            index[(match.group("dialog"), key, int(match.group("speaker")))] = path
        return index

    @property
    def index(self) -> dict[tuple[str, str, int], Path]:
        if self._index is None:
            self._index = self._build_index()
        return self._index

    # ------------------------------------------------------------------ 读取
    def dialog(self, dialog_id: str | int) -> dict[str, Any]:
        key = str(dialog_id)
        if key not in self.metadata:
            raise KeyError(f"DailyTalk metadata.json 里没有 dialog {key}")
        return self.metadata[key]

    def turns(self, dialog_id: str | int) -> list[DailyTalkTurn]:
        dialog = self.dialog(dialog_id)
        keys = _ordered_keys(dialog)
        return [
            DailyTalkTurn(
                index=position,
                key=key,
                speaker=int(dialog[key]["speaker"]),
                text=str(dialog[key].get("text", "")),
            )
            for position, key in enumerate(keys)
        ]

    def wav_path(self, dialog_id: str | int, utt_key: str, speaker: int) -> Path:
        dialog = str(dialog_id)
        key = str(utt_key)
        direct = self.index.get((dialog, key, int(speaker)))
        if direct is not None:
            return direct

        # utt_key 可能是 "0_9" 这种带对话前缀的写法，用最后一段再试
        tail = key.split("_")[-1]
        if tail != key:
            direct = self.index.get((dialog, tail, int(speaker)))
            if direct is not None:
                return direct

        candidate = self.data_dir / f"{key}_{int(speaker)}_d{dialog}.wav"
        if candidate.is_file():
            return candidate
        for path in self.data_dir.rglob(f"*{key}_{int(speaker)}_d{dialog}.wav"):
            return path
        raise FileNotFoundError(
            f"DailyTalk 里找不到 dialog {dialog} 的 {key} 句（speaker={speaker}）；"
            f"检查 data/ 是否完整"
        )

    def summary(self) -> dict[str, Any]:
        return {
            "root": str(self.root),
            "dialogs": len(self.metadata),
            "wav_files": len(self.index),
            "has_audio": self.has_audio,
            "index_file": str(self.index_file) if self.index_file else None,
        }

    # ------------------------------------------------------------------ 时长
    @property
    def has_audio(self) -> bool:
        """有没有单句 wav（只有索引时为 False，此时不能做互相关对齐）。"""
        return self.data_dir.is_dir() and bool(self.index)

    def utterance_duration(self, dialog_id: str | int, utt_key: str, speaker: int) -> float:
        """优先用索引里的时长，没有就去读 wav。"""
        entry = self.dialog(dialog_id).get(str(utt_key)) or {}
        duration = entry.get("duration")
        if duration is not None:
            return float(duration)
        return audio_io.audio_info(self.wav_path(dialog_id, utt_key, speaker))["duration"]


def _ordered_keys(dialog: dict[str, Any]) -> list[str]:
    """按句子在对话里的顺序返回 utt_key。

    DailyTalk 的键可能是 "0".."11"，也可能是 "3_0".."3_11"。两种都按尾部数字排序。
    **必须无条件按数字排**：直接从 zip 建索引时，键的写入顺序是文件名的字典序
    （0,1,10,11,2,...），不是对话顺序；按原顺序取会整体错位。
    只有尾部不是数字时才退回原始顺序。
    """
    keys = [str(key) for key in dialog.keys()]
    pairs: list[tuple[int, str]] = []
    for key in keys:
        match = re.search(r"(\d+)$", key)
        if match is None:
            return keys
        pairs.append((int(match.group(1)), key))
    if len({number for number, _ in pairs}) != len(pairs):
        return keys
    return [key for _, key in sorted(pairs)]


def probe_duration(path: str | Path) -> float:
    return audio_io.audio_info(path)["duration"]

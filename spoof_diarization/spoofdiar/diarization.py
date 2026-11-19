"""说话人分离：pyannote community-1，固定两人，输出独占结果并按首次开口重命名。

命名规则（TASK_SPEC 3.1）：pyannote 的 SPEAKER_xx 编号是随机的，
先开口的记作 A，另一个记作 B；原始编号保存在 `pyannote_labels` 里。
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Iterable

from . import audio as audio_io
from . import utils
from .utils import Interval, merge_intervals, total_duration

DEFAULT_WARNING = "未检测到说话人"


def _as_intervals(tracks: Iterable[tuple[float, float]]) -> list[Interval]:
    return merge_intervals([(float(s), float(e)) for s, e in tracks])


def rename_speakers(
    raw: dict[str, list[Interval]],
    min_speech_seconds: float = 1.0,
) -> tuple[dict[str, list[Interval]], dict[str, str], list[str]]:
    """把 SPEAKER_xx 改成 A/B。

    返回 (renamed, label_map, warnings)。label_map 是 A -> 原始标签。
    """
    warnings: list[str] = []
    cleaned = {
        label: merge_intervals(segments)
        for label, segments in raw.items()
        if merge_intervals(segments)
    }
    if not cleaned:
        return {}, {}, [DEFAULT_WARNING]

    ordered = sorted(cleaned.items(), key=lambda item: min(s for s, _ in item[1]))

    if len(ordered) > 2:
        # 理论上 num_speakers=2 不会出现；真出现了就保留说得最多的两个，避免把
        # 第三个人误当成主要说话人。丢掉的片段在掩码里会被底噪覆盖，日志里写清楚。
        by_speech = sorted(cleaned.items(), key=lambda item: total_duration(item[1]), reverse=True)
        keep = {label for label, _ in by_speech[:2]}
        dropped = [label for label, _ in ordered if label not in keep]
        ordered = [item for item in ordered if item[0] in keep]
        warnings.append(
            "检测到 %d 个说话人，仅保留时长最长的 %s，丢弃 %s"
            % (len(cleaned), "/".join(item[0] for item in ordered), ",".join(dropped))
        )

    names = ["A", "B"]
    renamed: dict[str, list[Interval]] = {}
    label_map: dict[str, str] = {}
    for index, (label, segments) in enumerate(ordered):
        name = names[index] if index < len(names) else f"S{index}"
        renamed[name] = segments
        label_map[name] = label

    if len(renamed) < 2:
        warnings.append("只检测到 1 个说话人，另一人被置为空")
    for name, segments in renamed.items():
        speech = total_duration(segments)
        if speech < min_speech_seconds:
            warnings.append(f"说话人 {name} 总时长 {speech:.2f}s < {min_speech_seconds:.2f}s")
    return renamed, label_map, warnings


def read_diarization(path: str | os.PathLike[str]) -> dict[str, Any]:
    """读 diarization.json，兼容平铺的 {"A": [[s,e]], ...} 老格式。"""
    payload = utils.read_json(path, default=None)
    if payload is None:
        raise FileNotFoundError(f"找不到分离结果：{path}")
    if isinstance(payload, dict) and isinstance(payload.get("speakers"), dict):
        payload = dict(payload)
        payload["speakers"] = {
            key: [(float(s), float(e)) for s, e in value]
            for key, value in payload["speakers"].items()
        }
        return payload
    if isinstance(payload, dict) and all(
        isinstance(value, list) and (not value or isinstance(value[0], (list, tuple)))
        for value in payload.values()
    ):
        return {
            "speakers": {
                key: [(float(s), float(e)) for s, e in value] for key, value in payload.items()
            },
            "pyannote_labels": {},
            "warnings": [],
            "diarization_warning": None,
        }
    raise ValueError(f"无法识别的 diarization.json 结构：{path}")


def write_rttm(path: str | os.PathLike[str], file_id: str, speakers: dict[str, list[Interval]]) -> Path:
    """写 RTTM（标签用重命名后的 A/B）。"""
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    rows: list[str] = []
    for name in sorted(speakers):
        for start, end in merge_intervals(speakers[name]):
            rows.append(
                "SPEAKER {file} 1 {start:.3f} {dur:.3f} <NA> <NA> {label} <NA> <NA>".format(
                    file=file_id,
                    start=start,
                    dur=max(0.0, end - start),
                    label=name,
                )
            )
    with open(target, "w", encoding="utf-8") as handle:
        handle.write("\n".join(rows) + ("\n" if rows else ""))
    return target


class Diarizer:
    """pyannote 管线的薄封装：一次加载，多次调用。"""

    def __init__(self, cfg: dict[str, Any]):
        self.cfg = cfg
        self.model_name = str(cfg["diarization"]["model"])
        self.device = str(cfg["diarization"]["device"])
        self.num_speakers = int(cfg["diarization"]["num_speakers"])
        self.use_exclusive = bool(cfg["diarization"]["exclusive"])
        self.min_speech_seconds = float(cfg["diarization"]["min_speech_seconds"])
        self.token_env = str(cfg["diarization"]["hf_token_env"])
        self._pipeline = None
        self._warned_exclusive = False

    # ---------------------------------------------------------------- 加载
    def load(self) -> None:
        if self._pipeline is not None:
            return
        try:
            import torch
            from pyannote.audio import Pipeline
        except ImportError as exc:  # pragma: no cover - 依赖缺失
            raise RuntimeError(
                "需要 pyannote.audio 4.x 与 torch：pip install -r requirements.txt"
            ) from exc

        token = os.environ.get(self.token_env) or None
        if not token:
            utils.log(
                f"[warning] 环境变量 {self.token_env} 为空；若模型未登录会直接失败。"
                f"先在 HF 模型页同意条款，再 export {self.token_env}=hf_xxx"
            )

        try:
            pipeline = Pipeline.from_pretrained(self.model_name, token=token)
        except TypeError:
            # pyannote.audio < 3.3 用 use_auth_token
            pipeline = Pipeline.from_pretrained(self.model_name, use_auth_token=token)

        device = self.device
        if device.startswith("cuda") and not torch.cuda.is_available():
            utils.log("[warning] CUDA 不可用，说话人分离退回 CPU（会明显变慢）")
            device = "cpu"
        try:
            pipeline.to(torch.device(device))
        except Exception as exc:  # pragma: no cover - 某些版本不支持 to()
            utils.log(f"[warning] pipeline.to({device}) 失败（{exc}），继续用默认设备")
        self._pipeline = pipeline
        self.device = device

    # ---------------------------------------------------------------- 推理
    def diarize(self, wav_path: str | os.PathLike[str]) -> dict[str, list[Interval]]:
        """返回 {原始标签: [[s, e], ...]}（独占结果）。

        这里把音频读成 waveform dict 再喂给管线，而不是直接传文件路径：
        pyannote.audio 4.x 传路径时会走 torchcodec，那个库对 torch 版本很挑，
        换环境就容易报 "torchcodec is not available"。用 soundfile 自己读最稳。
        """
        import numpy as np
        import torch

        self.load()
        assert self._pipeline is not None

        data, sample_rate = audio_io.read_audio(wav_path)
        waveform = torch.from_numpy(np.ascontiguousarray(data.T, dtype=np.float32))
        output = self._pipeline(
            {"waveform": waveform, "sample_rate": int(sample_rate)},
            num_speakers=self.num_speakers,
        )

        annotation = None
        if self.use_exclusive:
            annotation = getattr(output, "exclusive_speaker_diarization", None)
            if annotation is None and not self._warned_exclusive:
                self._warned_exclusive = True
                utils.log(
                    "[warning] 当前 pyannote 版本没有 exclusive_speaker_diarization，"
                    "退回普通 speaker_diarization（可能有重叠）"
                )
        if annotation is None:
            annotation = getattr(output, "speaker_diarization", None)
        if annotation is None:
            # 老版本直接返回 Annotation
            annotation = output

        raw: dict[str, list[Interval]] = {}
        for turn, _, label in annotation.itertracks(yield_label=True):
            raw.setdefault(str(label), []).append((float(turn.start), float(turn.end)))
        return {label: merge_intervals(segments) for label, segments in raw.items()}

    # ---------------------------------------------------------------- 全流程
    def run(
        self,
        wav_path: str | os.PathLike[str],
        out_dir: str | os.PathLike[str],
        force: bool = False,
    ) -> dict[str, Any]:
        """分离 + 重命名 + 落盘 diarization.json / diarization.rttm。"""
        from . import audio as audio_io

        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        json_path = out / "diarization.json"
        if json_path.is_file() and not force:
            return read_diarization(json_path)

        info = audio_io.audio_info(wav_path)
        raw = self.diarize(wav_path)
        renamed, label_map, warnings = rename_speakers(raw, self.min_speech_seconds)

        payload = {
            "file": str(Path(wav_path).resolve()),
            "duration": round(info["duration"], 4),
            "samplerate": info["samplerate"],
            "channels": info["channels"],
            "speakers": {
                name: [[round(s, 4), round(e, 4)] for s, e in segments]
                for name, segments in renamed.items()
            },
            "pyannote_labels": label_map,
            "raw_labels": sorted(raw.keys()),
            "warnings": warnings,
            "diarization_warning": "; ".join(warnings) if warnings else None,
            "model": self.model_name,
            "exclusive": self.use_exclusive,
        }
        utils.write_json(json_path, payload)
        file_id = Path(wav_path).stem
        write_rttm(out / "diarization.rttm", file_id, renamed)
        return payload


class OracleDiarizer:
    """用标注里的 turns 代替 pyannote（oracle 上界实验）。

    只在评测时用：它回答"如果分离是完美的，这套方法的性能上限是多少"，
    差值就是分离环节吃掉的性能。**不能当正式结果**，因为真实的对话音频
    不可能预先知道谁在什么时候说话。
    """

    backend = "oracle"

    def __init__(self, turns: Iterable[dict[str, Any]], cfg: dict[str, Any]):
        self.turns = list(turns)
        self.min_speech_seconds = float(cfg["diarization"]["min_speech_seconds"])
        self.model_name = "ground-truth"
        self.use_exclusive = True

    def run(
        self,
        wav_path: str | os.PathLike[str],
        out_dir: str | os.PathLike[str],
        force: bool = False,
    ) -> dict[str, Any]:
        from . import audio as audio_io

        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        json_path = out / "diarization.json"
        if json_path.is_file() and not force:
            return read_diarization(json_path)

        info = audio_io.audio_info(wav_path)
        raw: dict[str, list[Interval]] = {}
        for turn in self.turns:
            label = f"SPEAKER_{int(turn['speaker']):02d}"
            raw.setdefault(label, []).append((float(turn["start"]), float(turn["end"])))
        renamed, label_map, warnings = rename_speakers(raw, self.min_speech_seconds)

        payload = {
            "file": str(Path(wav_path).resolve()),
            "duration": round(info["duration"], 4),
            "samplerate": info["samplerate"],
            "channels": info["channels"],
            "speakers": {
                name: [[round(s, 4), round(e, 4)] for s, e in segments]
                for name, segments in renamed.items()
            },
            "pyannote_labels": label_map,
            "raw_labels": sorted(raw.keys()),
            "warnings": warnings,
            "diarization_warning": "; ".join(warnings) if warnings else None,
            "model": self.model_name,
            "exclusive": True,
            "oracle": True,
        }
        utils.write_json(json_path, payload)
        write_rttm(out / "diarization.rttm", Path(wav_path).stem, renamed)
        return payload

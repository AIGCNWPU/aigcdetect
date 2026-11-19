"""双人对话分人判定：说话人分离 → 单人音轨还原 → 逐人鉴伪 → 汇总结论。

设计要点
--------
* 复用 `engine.Engine` 已加载的 HoliAntiSpoof：本模块只负责分离与掩码，
  通过 `score_fn` 注入打分，避免再加载一份 18 GB 主模型。
* 分离用 `spoof_diarization` 里的 `spoofdiar`（pyannote 封装）。
  该包不在本仓库的安装依赖里，通过 `SPOOFDIAR_ROOT` 指定路径按需导入；
  未配置时接口返回 503 / DIALOGUE_UNAVAILABLE，而不是编造结果。
* 单人音频与"伪多人"（第二位说话人语音过短）自动回退单轨结论，
  由 `server.py` 继续走原来的整段推理。
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable

# 第二位说话人至少要有这么多语音才算"真的两个人"
MIN_SECOND_SPEAKER_SEC = float(os.environ.get("DIALOGUE_MIN_SECOND_SPEAKER_SEC", "2.0"))
MIN_SECOND_SPEAKER_RATIO = float(os.environ.get("DIALOGUE_MIN_SECOND_SPEAKER_RATIO", "0.05"))
# 判定线：与离线评测保持一致（val 上按说话人级 EER 选定后固定）
DIALOGUE_THRESHOLD = float(os.environ.get("DIALOGUE_THRESHOLD", "0.99593"))
MAX_SPEAKERS = int(os.environ.get("DIALOGUE_MAX_SPEAKERS", "4"))


class DialogueUnavailable(RuntimeError):
    """分离器不可用（未配置 spoofdiar / 缺依赖 / 缺 token）。"""


def _load_spoofdiar():
    root = os.environ.get("SPOOFDIAR_ROOT", "").strip()
    if not root:
        raise DialogueUnavailable(
            "未配置 SPOOFDIAR_ROOT：分人检测需要 spoof_diarization 包（pyannote 分离）"
        )
    if root not in sys.path:
        sys.path.insert(0, root)
    try:
        from spoofdiar import audio as audio_io
        from spoofdiar.diarization import Diarizer
        from spoofdiar.masking import MaskParams, build_masks
    except Exception as exc:  # pragma: no cover - 依赖缺失
        raise DialogueUnavailable(f"spoofdiar 导入失败：{exc}") from exc
    return audio_io, Diarizer, MaskParams, build_masks


def _diarization_config(device: str) -> dict[str, Any]:
    return {
        "diarization": {
            "model": os.environ.get("DIARIZATION_MODEL", "pyannote/speaker-diarization-community-1"),
            "device": os.environ.get("DIARIZATION_DEVICE", device),
            # 0 = 自动判断人数；产品里必须用自动，否则单人音频会被硬拆成两半
            "num_speakers": int(os.environ.get("DIARIZATION_NUM_SPEAKERS", "0")),
            "exclusive": True,
            "min_speech_seconds": float(os.environ.get("DIARIZATION_MIN_SPEECH_SECONDS", "1.0")),
            "hf_token_env": os.environ.get("DIARIZATION_TOKEN_ENV", "HF_TOKEN"),
        },
        "mask": {
            "pad": float(os.environ.get("MASK_PAD", "0.05")),
            "fade": float(os.environ.get("MASK_FADE", "0.02")),
            "fill": os.environ.get("MASK_FILL", "noise"),
            "noise": {"dbfs": float(os.environ.get("MASK_NOISE_DBFS", "-60"))},
        },
    }


def _speaker_stats(segments: list[list[float]]) -> dict[str, Any]:
    total = sum(max(0.0, float(end) - float(start)) for start, end in segments)
    return {"segments": segments, "speech": round(total, 3)}


def _is_real_dialogue(stats: dict[str, dict[str, Any]], duration: float) -> bool:
    """护栏：只有一位说话人，或其他人语音过短，都按单人处理。"""
    if len(stats) < 2:
        return False
    ordered = sorted(stats.values(), key=lambda item: item["speech"], reverse=True)
    second = ordered[1]["speech"]
    floor = max(MIN_SECOND_SPEAKER_SEC, duration * MIN_SECOND_SPEAKER_RATIO)
    return second >= floor


def detect(
    audio_path: str | os.PathLike[str],
    score_fn: Callable[[str], dict[str, Any]],
    device: str = "cuda:0",
) -> dict[str, Any]:
    """对一段音频做分人判定。

    score_fn: 接收 wav 路径，返回 {"pFake": float, "raw": str} —— 由调用方注入，
              通常是已加载模型的 Engine.infer_file。
    返回 mode="single" 时调用方应回退到整段推理。
    """
    audio_io, Diarizer, MaskParams, build_masks = _load_spoofdiar()
    cfg = _diarization_config(device)

    with tempfile.TemporaryDirectory(prefix="dialogue-") as workdir:
        work = Path(workdir)
        diarizer = Diarizer(cfg)
        diarizer.load()
        payload = diarizer.run(audio_path, work / "diar", force=True)

        duration = float(payload.get("duration") or 0.0)
        raw_speakers: dict[str, list[list[float]]] = payload.get("speakers") or {}
        stats = {name: _speaker_stats(segments) for name, segments in raw_speakers.items()}
        stats = {name: item for name, item in stats.items() if item["speech"] > 0.2}

        if not _is_real_dialogue(stats, duration):
            return {
                "mode": "single",
                "reason": "one_speaker" if len(stats) < 2 else "second_speaker_too_short",
                "duration": round(duration, 3),
                "speakers": [],
            }

        if len(stats) > MAX_SPEAKERS:
            return {
                "mode": "single",
                "reason": f"too_many_speakers({len(stats)})",
                "duration": round(duration, 3),
                "speakers": [],
            }

        samples, sample_rate = audio_io.read_audio(audio_path)
        samples = audio_io.to_mono(samples)
        params = MaskParams.from_config(cfg)
        masks, mask_meta = build_masks(samples, sample_rate, raw_speakers, params)

        order = sorted(stats.keys())
        speakers: list[dict[str, Any]] = []
        raws: dict[str, str] = {}
        for index, name in enumerate(order):
            track_path = work / f"{name}.wav"
            audio_io.write_audio(track_path, masks[name].audio, sample_rate)
            scored = score_fn(str(track_path))
            p_fake = float(scored.get("pFake") or 0.0)
            speaker_id = "A" if index == 0 else ("B" if index == 1 else f"S{index + 1}")
            speakers.append({
                "id": speaker_id,
                "label": name,
                "segments": [[round(float(s), 2), round(float(e), 2)] for s, e in stats[name]["segments"]],
                "totalSpeech": round(stats[name]["speech"], 2),
                "pFake": round(p_fake, 6),
                "isFake": p_fake >= DIALOGUE_THRESHOLD,
                "fakeRegions": [],
            })
            raws[speaker_id] = str(scored.get("raw") or "")

    fake_count = sum(1 for item in speakers if item["isFake"])
    if fake_count == 0:
        verdict = "both_real"
    elif fake_count == len(speakers):
        verdict = "both_fake"
    else:
        verdict = "A_fake" if speakers[0]["isFake"] else "B_fake"

    return {
        "mode": "dialogue",
        "duration": round(duration, 3),
        "verdict": verdict,
        "threshold": DIALOGUE_THRESHOLD,
        "speakers": speakers,
        "raw": raws,
        "warnings": list(mask_meta.get("warnings") or []) + list(payload.get("warnings") or []),
    }

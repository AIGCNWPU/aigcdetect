"""单文件全流程：分离 -> 掩码 -> 检测 -> 判定 -> result.json。"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from . import audio as audio_io
from . import config, decision, detector as detector_mod, utils
from .diarization import Diarizer
from .masking import MaskParams, build_masks

SPEAKERS = ("A", "B")


def _speaker_entry(
    name: str,
    diar: dict[str, Any],
    segments: list[list[float]],
) -> dict[str, Any]:
    return {
        "id": name,
        "pyannote_label": (diar.get("pyannote_labels") or {}).get(name),
        "segments": [[round(float(start), 3), round(float(end), 3)] for start, end in segments],
        "total_speech": round(utils.total_duration(segments), 3),
        "p_fake": None,
        "is_fake": False,
        "fake_regions": [],
    }


def run_file(
    wav_path: str | os.PathLike[str],
    out_dir: str | os.PathLike[str],
    cfg: dict[str, Any],
    threshold: float | None = None,
    detector: Any = None,
    diarizer: Any = None,
    force: bool = False,
    keep_audio: bool | None = None,
) -> dict[str, Any]:
    """跑一个文件，返回写进 result.json 的 dict。

    detector / diarizer 允许从外面传进来复用（批量时避免反复加载模型）。
    """
    wav = Path(wav_path)
    if not wav.is_file():
        raise FileNotFoundError(f"音频不存在：{wav}")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    info = audio_io.audio_info(wav)
    tau, threshold_source = (
        (float(threshold), "cli") if threshold is not None else decision.load_threshold(cfg)
    )

    # 1) 说话人分离（带缓存）
    diarizer = diarizer or Diarizer(cfg)
    diar = diarizer.run(wav, out, force=force)
    speakers = {
        name: [(float(start), float(end)) for start, end in segments]
        for name, segments in diar.get("speakers", {}).items()
    }

    # 2) 静音掩码
    samples, sample_rate = audio_io.read_audio(wav)
    params = MaskParams.from_config(cfg)
    masks, mask_meta = build_masks(
        samples, sample_rate, speakers, params, seed=int(cfg["seed"])
    )

    masked_paths: dict[str, Path] = {}
    for name in sorted(masks):
        path = out / f"{name}.wav"
        audio_io.write_audio(
            path, masks[name].audio, sample_rate, subtype=info.get("subtype")
        )
        masked_paths[name] = path

    length_check = {
        name: {
            "frames": int(masks[name].audio.shape[0]),
            "expected": int(samples.shape[0]),
            "ok": bool(masks[name].audio.shape[0] == samples.shape[0]),
        }
        for name in sorted(masks)
    }
    mask_meta.update(
        {
            "file": str(wav.resolve()),
            "file_id": wav.stem,
            "length_check": length_check,
            "diarization_warning": diar.get("diarization_warning"),
            "kept_intervals": {
                name: masks[name].info["kept_intervals"] for name in sorted(masks)
            },
        }
    )
    utils.write_json(out / "mask_meta.json", mask_meta)

    # 3) 伪造检测
    detector = detector or detector_mod.create_detector(cfg)
    entries: list[dict[str, Any]] = []
    for name in SPEAKERS:
        entry = _speaker_entry(name, diar, speakers.get(name, []))
        if name not in masks:
            entry["warnings"] = ["该说话人在分离结果里不存在，跳过检测"]
            entries.append(entry)
            continue
        payload = detector_mod.run_detection(
            detector,
            masked_paths[name],
            detector_mod.detection_path(out, name),
            cfg,
            speaker=name,
            segments=speakers.get(name, []),
            duration=info["duration"],
            force=force,
        )
        entry["p_fake"] = payload.get("p_fake")
        entry["is_fake"] = decision.speaker_is_fake(payload.get("p_fake"), tau)
        entry["fake_regions"] = payload.get("fake_regions", [])
        entry["score_source"] = payload.get("score_source")
        entry["logit_step"] = payload.get("logit_step")
        entry["warnings"] = payload.get("warnings", [])
        entries.append(entry)

    # 4) 文件级结论
    flags = {entry["id"]: bool(entry["is_fake"]) for entry in entries}
    result = {
        "file_id": wav.stem,
        "duration": round(float(info["duration"]), 3),
        "verdict": decision.verdict_from_flags(flags.get("A", False), flags.get("B", False)),
        "threshold": float(tau),
        "threshold_source": threshold_source,
        "diarization_warning": diar.get("diarization_warning"),
        "speakers": entries,
        "config": config.summary(cfg),
        "audio_path": str(wav.resolve()),
        "samplerate": info["samplerate"],
        "channels": info["channels"],
        "backend": getattr(detector, "backend", "unknown"),
        "created_at": utils.now_stamp(),
    }
    utils.write_json(out / "result.json", result)

    # 5) 可选：删掉掩码音频省磁盘（检测已经跑完了）
    keep = cfg["mask"].get("keep_masked_audio", True) if keep_audio is None else bool(keep_audio)
    if not keep:
        for path in masked_paths.values():
            if path.exists():
                path.unlink()

    return result

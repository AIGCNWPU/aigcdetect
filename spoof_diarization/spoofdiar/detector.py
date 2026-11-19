"""HoliAntiSpoof 伪造检测：本地推理与已部署 HTTP 服务两种后端。

伪造概率的算法（TASK_SPEC 2.2）：

    在生成序列里定位解码为 real / fake 的那一步，读取两个 token 的 logit，
    p_fake = softmax([real_logit, fake_logit])[1]

模型卡把这一步写死成 6，但这里不硬编码：先按 `real_or_fake` 键锚定找，
再断言它等于 expected_logit_step，不一致就告警并把实际步号写进结果。
"""
from __future__ import annotations

import base64
import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from . import audio as audio_io
from . import parsing, utils

STOP_PATTERN = re.compile(r"<\|im_end\|>|<\|endoftext\|>")
VALUE_PATTERN = re.compile(r"real_or_fake\"?\s*:\s*\"?\s*(real|fake)\s*\"?$")


@dataclass
class Detection:
    p_fake: float | None = None
    real_logit: float | None = None
    fake_logit: float | None = None
    logit_step: int | None = None
    parsed: dict[str, Any] = field(default_factory=dict)
    fake_regions_raw: list[list[float]] = field(default_factory=list)
    raw_text: str = ""
    score_source: str = "logits"
    warnings: list[str] = field(default_factory=list)
    region_hint: list[list[float]] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {
            "p_fake": None if self.p_fake is None else float(self.p_fake),
            "real_logit": self.real_logit,
            "fake_logit": self.fake_logit,
            "logit_step": self.logit_step,
            "parsed": self.parsed,
            "fake_regions_raw": self.fake_regions_raw,
            "raw_text": self.raw_text,
            "score_source": self.score_source,
            "warnings": self.warnings,
        }


# --------------------------------------------------------------------------- #
# 本地推理
# --------------------------------------------------------------------------- #
class LocalDetector:
    backend = "local"

    def __init__(self, cfg: dict[str, Any]):
        section = cfg["detect"]["local"]
        self.cfg = cfg
        self.base_model = str(section["base_model"])
        self.adapter = str(section["adapter"])
        self.device = str(section["device"])
        self.dtype_name = str(section["dtype"]).lower()
        self.attn = str(section["attn"])
        self.merge_adapter = bool(section["merge_adapter"])
        self.max_new_tokens = int(section["max_new_tokens"])
        self.expected_step = int(section["expected_logit_step"])
        model_root = section.get("model_root")
        if model_root:
            root = Path(model_root)
            self.base_model = str(root / "Qwen2.5-Omni-7B")
            self.adapter = str(root / "HoliAntiSpoof")
        self.prompt = str(cfg["detect"]["prompt"])
        self.system = str(cfg["detect"]["system"])
        self._model = None
        self._processor = None
        self._tokenizer = None
        self._real_id: int | None = None
        self._fake_id: int | None = None
        self.load_seconds: float | None = None

    # ------------------------------------------------------------------ 加载
    def load(self) -> None:
        if self._model is not None:
            return
        import time

        import torch
        from peft import PeftModel
        from transformers import Qwen2_5OmniProcessor, Qwen2_5OmniThinkerForConditionalGeneration

        started = time.time()
        dtype = {
            "bfloat16": torch.bfloat16,
            "bf16": torch.bfloat16,
            "float16": torch.float16,
            "fp16": torch.float16,
            "float32": torch.float32,
            "auto": "auto",
        }.get(self.dtype_name, torch.bfloat16)

        device = self.device
        if device.startswith("cuda") and not torch.cuda.is_available():
            utils.log("[warning] CUDA 不可用，HoliAntiSpoof 退回 CPU（7B 模型会非常慢）")
            device = "cpu"

        kwargs = {"torch_dtype": dtype, "device_map": device}
        try:
            model = Qwen2_5OmniThinkerForConditionalGeneration.from_pretrained(
                self.base_model, attn_implementation=self.attn, **kwargs
            )
        except (ImportError, RuntimeError, ValueError) as exc:
            if self.attn == "sdpa":
                raise
            utils.log(f"[warning] attn_implementation={self.attn} 不可用（{exc}），退回 sdpa")
            self.attn = "sdpa"
            model = Qwen2_5OmniThinkerForConditionalGeneration.from_pretrained(
                self.base_model, attn_implementation="sdpa", **kwargs
            )

        model = PeftModel.from_pretrained(model, self.adapter)
        if self.merge_adapter:
            try:
                model = model.merge_and_unload()
            except Exception as exc:  # pragma: no cover - 取决于 peft/模型组合
                utils.log(f"[warning] merge_and_unload 失败（{exc}），保留未合并的适配器")
        model.eval()

        processor = Qwen2_5OmniProcessor.from_pretrained(self.base_model)
        tokenizer = processor.tokenizer

        self._model = model
        self._processor = processor
        self._tokenizer = tokenizer
        self._real_id, self._fake_id = resolve_decision_token_ids(tokenizer)
        self.device = device
        self.load_seconds = round(time.time() - started, 1)
        utils.log(
            f"[detect] 模型加载完成 {self.load_seconds}s，device={device}，"
            f"real_id={self._real_id}，fake_id={self._fake_id}"
        )

    # ------------------------------------------------------------------ 推理
    def detect(self, wav_path: str | os.PathLike[str]) -> Detection:
        import torch
        from qwen_omni_utils import process_mm_info

        self.load()
        assert self._model is not None and self._processor is not None
        processor, tokenizer, model = self._processor, self._tokenizer, self._model

        conversation = [
            {"role": "system", "content": [{"type": "text", "text": self.system}]},
            {
                "role": "user",
                "content": [
                    {"type": "audio", "audio": str(wav_path)},
                    {"type": "text", "text": self.prompt},
                ],
            },
        ]
        text = processor.apply_chat_template(conversation, add_generation_prompt=True, tokenize=False)
        audios, _, _ = process_mm_info(conversation, use_audio_in_video=False)
        inputs = processor(
            text=text,
            audio=audios,
            images=None,
            videos=None,
            return_tensors="pt",
            padding=True,
            use_audio_in_video=False,
        )
        inputs = inputs.to(model.device).to(model.dtype)

        with torch.inference_mode():
            outputs = model.generate(
                **inputs,
                max_new_tokens=self.max_new_tokens,
                tokenizer=tokenizer,
                stop_strings=["<|im_end|>", "<|endoftext|>"],
                output_scores=True,
                return_dict_in_generate=True,
                do_sample=False,
            )

        prompt_length = int(inputs["input_ids"].shape[1])
        trimmed = outputs.sequences[0, prompt_length:]
        token_ids = trimmed.tolist()
        raw_text = decode_generated(tokenizer, token_ids)

        detection = Detection(raw_text=raw_text)
        detection.parsed, parse_error = parsing.parse_model_output(raw_text)
        if parse_error:
            detection.warnings.append(f"模型输出解析失败：{parse_error}")

        step, anchored = self._find_decision_step(token_ids)
        if step is None:
            detection.warnings.append("生成序列里没有 real/fake token，退回文本判定")
            detection.score_source = "text_fallback"
            decision = parsing.decision_text(detection.parsed)
            detection.p_fake = None if decision is None else (1.0 if decision == "fake" else 0.0)
        else:
            detection.logit_step = step
            if not anchored:
                detection.warnings.append("real/fake 未按 real_or_fake 键锚定，取第一个匹配 token")
            if step != self.expected_step:
                detection.warnings.append(
                    f"决策步为 {step}，与模型卡写的 {self.expected_step} 不一致（已按实际步号计算）"
                )
            scores = outputs.scores[step][0]
            real_logit = float(scores[self._real_id].item())
            fake_logit = float(scores[self._fake_id].item())
            detection.real_logit = real_logit
            detection.fake_logit = fake_logit
            detection.p_fake = float(
                torch.softmax(torch.tensor([real_logit, fake_logit]), dim=0)[1].item()
            )

        return detection

    def _find_decision_step(self, token_ids: list[int]) -> tuple[int | None, bool]:
        """定位 real/fake 的生成步。

        优先找"紧跟 real_or_fake 键之后"的那个 token，避免把键名里的 fake 当成值。
        """
        assert self._tokenizer is not None
        real_id, fake_id = self._real_id, self._fake_id
        candidates = [i for i, tid in enumerate(token_ids) if tid in (real_id, fake_id)]
        if not candidates:
            return None, False

        for index in candidates:
            prefix = decode_generated(self._tokenizer, token_ids[: index + 1]).strip()
            match = VALUE_PATTERN.search(prefix)
            if match:
                expected = match.group(1)
                actual = "real" if token_ids[index] == real_id else "fake"
                if expected == actual:
                    return index, True
        return candidates[0], False


# --------------------------------------------------------------------------- #
# HTTP 后端
# --------------------------------------------------------------------------- #
class HttpDetector:
    """复用已部署的 backend/server.py（POST /api/v1/audio/forgery）。

    注意：该服务对超过 30 s 的音频会滑窗后取最可疑窗口，与本地整段推理不完全等价。
    """

    backend = "http"

    def __init__(self, cfg: dict[str, Any]):
        section = cfg["detect"]["http"]
        self.url = str(section["url"]).rstrip("/")
        self.timeout = float(section["timeout"])
        self.session = None
        self.load_seconds = None

    def load(self) -> None:
        import requests

        self.session = requests.Session()
        try:
            response = self.session.get(f"{self.url}/api/v1/health", timeout=10)
            response.raise_for_status()
        except Exception as exc:  # pragma: no cover - 网络问题
            raise RuntimeError(f"连不上 HoliAntiSpoof 服务 {self.url}：{exc}") from exc

    def detect(self, wav_path: str | os.PathLike[str]) -> Detection:
        import requests

        if self.session is None:
            self.load()
        assert self.session is not None

        with open(wav_path, "rb") as handle:
            encoded = base64.b64encode(handle.read()).decode("ascii")
        payload = {"audioBase64": encoded, "fileName": Path(wav_path).name}
        response = self.session.post(
            f"{self.url}/api/v1/audio/forgery", json=payload, timeout=self.timeout
        )
        if response.status_code != 200:
            raise requests.HTTPError(f"{response.status_code}: {response.text[:500]}")
        body = response.json().get("data") or {}

        detection = Detection(
            p_fake=body.get("pFake"),
            raw_text=body.get("raw") or "",
            score_source="http",
        )
        detection.parsed, parse_error = parsing.parse_model_output(detection.raw_text)
        if parse_error:
            detection.warnings.append(f"模型输出解析失败：{parse_error}")
        if body.get("spoofMethod") and "spoof_method" not in detection.parsed:
            detection.parsed["spoof_method"] = body["spoofMethod"]
        if body.get("realOrFake") and "real_or_fake" not in detection.parsed:
            detection.parsed["real_or_fake"] = body["realOrFake"]
        hint = body.get("fakeRegion")
        if isinstance(hint, list):
            detection.region_hint = [
                [float(pair[0]), float(pair[1])]
                for pair in hint
                if isinstance(pair, (list, tuple)) and len(pair) == 2
            ]
        elif hint == "all":
            detection.warnings.append("HTTP 后端把整段标为伪造区间（all），未写入 hint")
        if detection.p_fake is None:
            decision = parsing.decision_text(detection.parsed)
            detection.p_fake = None if decision is None else (1.0 if decision == "fake" else 0.0)
        return detection


def resolve_decision_token_ids(tokenizer: Any) -> tuple[int, int]:
    """取 real / fake 的 vocab id；带空格前缀的变体也认。"""
    unk = getattr(tokenizer, "unk_token_id", None)
    ids: list[int] = []
    for name in ("real", "fake"):
        candidates = [name, " " + name]
        chosen = None
        for candidate in candidates:
            token_id = tokenizer.convert_tokens_to_ids(candidate)
            if isinstance(token_id, list):
                token_id = token_id[0]
            if token_id is not None and token_id != unk:
                chosen = int(token_id)
                break
        if chosen is None:
            raise RuntimeError(f"tokenizer 里找不到 {name!r} 对应的 token")
        ids.append(chosen)
        if tokenizer.convert_tokens_to_ids(name) != chosen:
            utils.log(f"[warning] token {name!r} 需要带空格前缀，已用 {name!r} -> {chosen}")
    return ids[0], ids[1]


def decode_generated(tokenizer: Any, token_ids: list[int]) -> str:
    text = tokenizer.decode(
        token_ids, skip_special_tokens=False, clean_up_tokenization_spaces=False
    )
    match = STOP_PATTERN.search(text)
    if match:
        text = text[: match.start()]
    return text.strip()


# --------------------------------------------------------------------------- #
# 对外
# --------------------------------------------------------------------------- #
def create_detector(cfg: dict[str, Any]):
    backend = str(cfg["detect"]["backend"])
    if backend == "http":
        return HttpDetector(cfg)
    if backend == "local":
        return LocalDetector(cfg)
    raise ValueError(f"未知的 detect.backend：{backend}")


def detection_path(out_dir: str | os.PathLike[str], speaker: str) -> Path:
    return Path(out_dir) / f"detection_{speaker}.json"


def load_detection(path: str | os.PathLike[str]) -> dict[str, Any] | None:
    payload = utils.read_json(path, default=None)
    return payload if isinstance(payload, dict) else None


def run_detection(
    detector: Any,
    wav_path: str | os.PathLike[str],
    out_path: str | os.PathLike[str],
    cfg: dict[str, Any],
    speaker: str | None = None,
    segments: list[list[float]] | None = None,
    duration: float | None = None,
    force: bool = False,
) -> dict[str, Any]:
    """跑一条掩码音轨，写 detection_{A,B}.json。"""
    out_path = Path(out_path)
    use_cache = bool(cfg["detect"]["cache"])
    if out_path.is_file() and use_cache and not force:
        cached = load_detection(out_path)
        if cached is not None and cached.get("p_fake") is not None:
            return cached

    info = audio_io.audio_info(wav_path)
    if duration is None:
        duration = info["duration"]

    detection = detector.detect(wav_path)
    regions_raw = detection.fake_regions_raw or [
        [float(s), float(e)]
        for s, e in parsing.extract_regions(detection.parsed, duration)
    ]
    if not regions_raw and detection.region_hint:
        regions_raw = [[float(s), float(e)] for s, e in detection.region_hint]

    min_ratio = float(cfg["detect"]["min_region_overlap_ratio"])
    min_seconds = float(cfg["detect"]["min_region_overlap_seconds"])
    regions = (
        parsing.filter_regions_by_overlap(regions_raw, segments, min_ratio, min_seconds)
        if segments
        else regions_raw
    )

    payload = detection.as_dict()
    payload.update(
        {
            "speaker": speaker,
            "file": str(Path(wav_path).resolve()),
            "duration": round(float(duration), 4),
            "backend": getattr(detector, "backend", "unknown"),
            # 原样保留模型给的区间（含落在底噪里的误报），过滤后的另存为 fake_regions
            "fake_regions_raw": [[round(float(s), 3), round(float(e), 3)] for s, e in regions_raw],
            "fake_regions": [[round(s, 3), round(e, 3)] for s, e in regions],
        }
    )
    utils.write_json(out_path, payload)
    return payload

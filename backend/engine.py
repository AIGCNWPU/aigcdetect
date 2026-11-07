"""HoliAntiSpoof 推理引擎：一次加载，多次调用。

被 detect.py（命令行）和 server.py（HTTP 服务）共用，避免逻辑分叉。
"""
import os
import re
import tempfile
import threading
import time

import av
import librosa
import numpy as np
import soundfile as sf
import torch
from peft import PeftModel
from qwen_omni_utils import process_mm_info
from transformers import Qwen2_5OmniProcessor, Qwen2_5OmniThinkerForConditionalGeneration

MODEL_ROOT = os.environ.get("MODEL_ROOT", "/mnt/vos-6d37s2q0/users/zqy/models")
MODEL_DIR = os.path.join(MODEL_ROOT, "Qwen2.5-Omni-7B")
ADAPTER_DIR = os.path.join(MODEL_ROOT, "HoliAntiSpoof")

PROMPT = ("Determine whether this audio clip is a spoof or not. If it is a spoof, "
          "determine the spoofing method and the spoofing region.")
SYSTEM = ("You are Qwen, a virtual human developed by the Qwen Team, Alibaba Group, "
          "capable of perceiving auditory and visual inputs, as well as generating text and speech.")
STOP = re.compile(r"<\|im_end\|>|<\|endoftext\|>")

# 同步接口的时长上限：超过就快速失败，避免请求挂几分钟后被中间层掐断。
MAX_MEDIA_SECONDS = float(os.environ.get("MAX_MEDIA_SECONDS", "120"))


class MediaTooLong(ValueError):
    """媒体超过同步接口允许的时长。"""

METHOD_LABELS = {
    "text to speech synthesis": "语音合成 TTS",
    "tts": "语音合成 TTS",
    "voice conversion": "声音转换 VC",
    "vc": "声音转换 VC",
    "cut and paste": "剪切拼接",
    "speech editing": "语音编辑",
    "vocoder resynthesis": "声码器重合成",
    "codec resynthesis": "编解码器重合成",
}


def probe_media(path):
    """探测容器里有哪些轨道。返回 (has_video, has_audio, duration_sec)。"""
    with av.open(path) as container:
        has_video = any(stream.type == "video" for stream in container.streams)
        has_audio = any(stream.type == "audio" for stream in container.streams)
        duration = float(container.duration / av.time_base) if container.duration else 0.0
    return has_video, has_audio, duration


def extract_audio(src, dst, sample_rate=16000):
    """从任意容器里抽出第一条音轨，重采样成 16 kHz 单声道 PCM16 WAV。

    浏览器不能可靠地解封装视频容器，所以在服务端用 PyAV（FFmpeg）做：
    解复用 → 解码音频帧 → 重采样 → 落盘 WAV。
    """
    with av.open(src) as container:
        audio_streams = [stream for stream in container.streams if stream.type == "audio"]
        if not audio_streams:
            raise ValueError("媒体文件不包含音轨")
        stream = audio_streams[0]
        resampler = av.AudioResampler(format="s16", layout="mono", rate=sample_rate)
        chunks = []
        for frame in container.decode(stream):
            for out in resampler.resample(frame):
                chunks.append(out.to_ndarray().reshape(-1))
        for out in resampler.resample(None):  # flush 尾部缓冲
            chunks.append(out.to_ndarray().reshape(-1))

    samples = np.concatenate(chunks) if chunks else np.zeros(0, dtype=np.int16)
    sf.write(dst, samples, sample_rate, subtype="PCM_16")
    return len(samples) / float(sample_rate)


class Engine:
    def __init__(self, device="cuda:0", chunk_sec=30, window_sec=10, hop_sec=5):
        self.device = device
        self.chunk_sec = chunk_sec
        self.window_sec = window_sec
        self.hop_sec = hop_sec
        self._lock = threading.Lock()
        self.model = None
        self.processor = None
        self.real_id = None
        self.fake_id = None

    # ---------- 加载 ----------
    def load(self):
        t0 = time.time()
        model = Qwen2_5OmniThinkerForConditionalGeneration.from_pretrained(
            MODEL_DIR, torch_dtype="auto", device_map=self.device, attn_implementation="sdpa")
        model = PeftModel.from_pretrained(model, ADAPTER_DIR)
        model.eval()
        processor = Qwen2_5OmniProcessor.from_pretrained(MODEL_DIR)
        tok = processor.tokenizer
        self.model = model
        self.processor = processor
        self.real_id = tok.convert_tokens_to_ids("real")
        self.fake_id = tok.convert_tokens_to_ids("fake")
        self.load_seconds = round(time.time() - t0, 1)
        return self.load_seconds

    # ---------- 单段推理 ----------
    def _infer_path(self, path):
        conv = [
            {"role": "system", "content": [{"type": "text", "text": SYSTEM}]},
            {"role": "user", "content": [{"type": "audio", "audio": path},
                                         {"type": "text", "text": PROMPT}]},
        ]
        tok = self.processor.tokenizer
        text = self.processor.apply_chat_template(conv, add_generation_prompt=True, tokenize=False)
        audios, _, _ = process_mm_info(conv, use_audio_in_video=False)
        inputs = self.processor(text=text, audio=audios, images=None, videos=None,
                                return_tensors="pt", padding=True, use_audio_in_video=False)
        inputs = inputs.to(self.model.device).to(self.model.dtype)

        with torch.no_grad():
            out = self.model.generate(**inputs, max_new_tokens=192, tokenizer=tok,
                                      stop_strings=["<|im_end|>", "<|endoftext|>"],
                                      output_scores=True, return_dict_in_generate=True)

        trimmed = out.sequences[0, len(inputs["input_ids"][0]):]
        raw = tok.decode(trimmed, skip_special_tokens=True)
        match = STOP.search(raw)
        if match:
            raw = raw[:match.start()]
        raw = raw.strip()

        real_logit = out.scores[6][0, self.real_id].item()
        fake_logit = out.scores[6][0, self.fake_id].item()
        p_fake = torch.softmax(torch.tensor([real_logit, fake_logit]), 0)[1].item()

        return {"pFake": float(p_fake), "raw": raw}

    # ---------- 对外：文件推理（含长音频切窗） ----------
    def infer_file(self, path):
        duration = float(librosa.get_duration(path=path))
        started = time.time()

        if duration <= self.chunk_sec:
            with self._lock:
                result = self._infer_path(path)
            windows = []
            top = result
        else:
            # 长音频：按 window_sec 切窗、hop 滑动，取最可疑的一段
            audio, sr = librosa.load(path, sr=16000, mono=True)
            windows = []
            best = None
            pos = 0.0
            while pos < duration:
                end = min(pos + self.window_sec, duration)
                if end - pos < 1.0:
                    break
                chunk_path = f"{path}.{int(pos * 1000)}.wav"
                sf.write(chunk_path, audio[int(pos * sr):int(end * sr)], sr)
                try:
                    with self._lock:
                        partial = self._infer_path(chunk_path)
                finally:
                    if os.path.exists(chunk_path):
                        os.remove(chunk_path)
                windows.append({"start": round(pos, 2), "end": round(end, 2),
                                "pFake": round(partial["pFake"], 4)})
                if best is None or partial["pFake"] > best["pFake"]:
                    best = {"pFake": partial["pFake"], "raw": partial["raw"],
                            "start": round(pos, 2), "end": round(end, 2)}
                if end >= duration:
                    break
                pos += self.hop_sec
            top = best
            result = best

        parsed = {}
        try:
            import json
            parsed = json.loads(result["raw"])
        except Exception:
            parsed = {}

        method = parsed.get("spoof_method")
        region = parsed.get("fake_region")
        analyzed = duration
        if windows:
            # 切窗模式下，区间由"超过阈值的窗口"合并得到，而不是取单个 argmax。
            # 否则全真人音频也会被报出一段（argmax 总要选一个），那是假的定位。
            hot = [(w["start"], w["end"]) for w in windows if w["pFake"] >= 0.5]
            if not hot:
                region = None
            elif len(hot) == len(windows):
                region = "all"
            else:
                merged = []
                for start, end in sorted(hot):
                    if merged and start <= merged[-1][1]:
                        merged[-1][1] = max(merged[-1][1], end)
                    else:
                        merged.append([start, end])
                region = [[round(a, 2), round(b, 2)] for a, b in merged]
            analyzed = windows[-1]["end"]

        return {
            "pFake": round(float(result["pFake"]), 4),
            "realOrFake": parsed.get("real_or_fake") or ("fake" if result["pFake"] >= 0.5 else "real"),
            "spoofMethod": method,
            "spoofMethodLabel": METHOD_LABELS.get((method or "").lower(), method),
            "fakeRegion": region,
            "semanticInfluence": parsed.get("semantic_influence"),
            "durationSec": round(duration, 2),
            "windows": windows,
            "coverage": {"analyzed": round(analyzed, 2), "total": round(duration, 2)},
            "latencyMs": int((time.time() - started) * 1000),
            "raw": result["raw"],
        }

    # ---------- 对外：任意媒体（音频或视频） ----------
    def infer_media(self, path):
        """视频先抽音轨再检测；音频直接检测。

        返回结构在 infer_file 的基础之上补充 media / audioExtracted / audioDurationSec。
        """
        has_video, has_audio, container_duration = probe_media(path)
        if container_duration and container_duration > MAX_MEDIA_SECONDS:
            raise MediaTooLong(
                f"媒体时长 {container_duration:.0f} 秒，超过同步接口上限 {MAX_MEDIA_SECONDS:.0f} 秒")
        if not has_video:
            result = self.infer_file(path)
            result.update({"media": "audio", "audioExtracted": False,
                           "audioDurationSec": result["durationSec"],
                           "containerDurationSec": round(container_duration, 2)})
            return result

        if not has_audio:
            raise ValueError("视频不包含音轨，无法进行语音鉴伪")

        fd, wav_path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            audio_seconds = extract_audio(path, wav_path)
            result = self.infer_file(wav_path)
        finally:
            if os.path.exists(wav_path):
                os.remove(wav_path)

        result.update({
            "media": "video",
            "audioExtracted": True,
            "audioDurationSec": round(audio_seconds, 2),
            "containerDurationSec": round(container_duration or audio_seconds, 2),
        })
        return result

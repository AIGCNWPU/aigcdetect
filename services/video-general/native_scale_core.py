"""Native-Scale visual detector with existing 2s/24-frame window selection.
Model: https://github.com/mgiant/Qwen2.5ViT-AIGVDetection
"""
from __future__ import annotations

import base64
import json
import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torchvision.transforms.functional as T
from torchvision.transforms import InterpolationMode

try:
    from torchcodec.decoders import VideoDecoder
    from torchcodec.samplers import clips_at_regular_timestamps
except Exception as exc:  # pragma: no cover - 环境缺 ffmpeg 时给出可读错误
    raise RuntimeError("torchcodec 不可用，请安装 FFmpeg 共享库后重试") from exc

# 保留现有服务采样参数；不同于官方默认8帧协议
FRAMES_PER_WINDOW = 24
WINDOW_SECONDS = 2.0
MAX_WINDOWS = 12  # 60 秒以上视频固定 12 窗，避免长视频开销过大

# 临时展示阈值，未在业务数据上校准
HIGH_RISK = 0.8
MEDIUM_RISK = 0.5
SUSPICIOUS_WINDOW = 0.5  # 临时单窗口提示阈值

_lock = threading.Lock()  # 单卡串行推理，避免并发显存竞争


@dataclass
class WindowResult:
    index: int
    start: float
    end: float
    center: float
    frames: int
    fake_prob: float
    decoded: bool
    error: str = ""


class NativeScaleDetector:
    """加载 Native-Scale 官方视觉编码器和分类头，对单个视频输出前端契约结构的结果。"""

    def __init__(self, artifacts_dir: str | Path, device: str | None = None):
        from transformers import Qwen2_5_VLConfig, Qwen2VLVideoProcessor
        from transformers.models.qwen2_5_vl.modeling_qwen2_5_vl import Qwen2_5_VisionTransformerPretrainedModel
        artifacts = Path(artifacts_dir)
        checkpoint = artifacts / "Qwen2.5-ViT_140k_224p_448p.pth"
        if not checkpoint.is_file():
            raise FileNotFoundError(f"缺少 Native-Scale 官方权重：{checkpoint}")
        self.device = torch.device(device or ("cuda:0" if torch.cuda.is_available() else "cpu"))
        config = Qwen2_5_VLConfig.from_dict(json.loads((artifacts / "config.json").read_text()))
        self.backbone = Qwen2_5_VisionTransformerPretrainedModel._from_config(
            config.vision_config, dtype=torch.float32, attn_implementation="sdpa")
        self.head = nn.Linear(config.vision_config.out_hidden_size, 1)
        state = torch.load(checkpoint, map_location="cpu", weights_only=True)
        state = state.get("model_state_dict", state)
        state = {k.removeprefix("module."): v for k, v in state.items()}
        # Match official backbone + head exactly; reject partial/random initialization.
        model = nn.ModuleDict({"backbone": self.backbone, "head": self.head})
        model.load_state_dict(state, strict=True)
        model.eval().to(self.device)
        self.processor = Qwen2VLVideoProcessor(size={"shortest_edge": 50176, "longest_edge": 200704}, do_sample_frames=False, cap_pixels_per_frame=False)
        self.checkpoint_name = checkpoint.name

    # ------------------------------------------------------------------ #
    def _plan_windows(self, duration: float) -> list[tuple[float, float]]:
        """在 [0, duration] 内均匀布点，返回每个窗口的中心时刻与窗口时长。"""
        window = min(WINDOW_SECONDS, duration) if duration > 0 else WINDOW_SECONDS
        if duration <= window + 0.2:  # 短视频整段作为一个窗口
            return [(duration / 2.0, window)]
        count = min(MAX_WINDOWS, max(2, math.ceil(duration / 5.0)))
        first, last = window / 2.0, duration - window / 2.0
        centers = [first + (last - first) * i / (count - 1) for i in range(count)]
        return [(c, window) for c in centers]

    def _decode_window(self, decoder: VideoDecoder, center: float, window: float):
        start = max(0.0, center - window / 2.0)
        end = start + window
        clip = clips_at_regular_timestamps(
            decoder,
            num_frames_per_clip=FRAMES_PER_WINDOW,
            seconds_between_frames=window / max(FRAMES_PER_WINDOW - 1, 1),
            seconds_between_clip_starts=1e9,
            sampling_range_start=start,
            sampling_range_end=end,
            policy="repeat_last",
        ).data[0]
        if clip.shape[1] not in (1, 3):
            clip = clip.permute(0, 3, 1, 2)
        return clip

    def _score_windows(self, clips: list[torch.Tensor]) -> np.ndarray:
        scores = []
        with torch.inference_mode():
            for clip in clips:
                inputs = self.processor(videos=[clip], return_tensors="pt", do_sample_frames=False, cap_pixels_per_frame=False)
                pixels = inputs["pixel_values_videos"].to(self.device, dtype=torch.float32)
                grid = inputs["video_grid_thw"].to(self.device)
                output = self.backbone(hidden_states=pixels, grid_thw=grid)
                features = output.pooler_output
                # Official model averages all merged patch tokens, then applies head.
                logits = self.head(features.mean(dim=0, keepdim=True))
                score = float(logits.sigmoid().item())
                if not math.isfinite(score):
                    raise ValueError("模型输出非有限值，无法给出检测结论。")
                scores.append(score)
        return np.asarray(scores)

    # ------------------------------------------------------------------ #
    def detect(self, video_path: str | Path) -> dict[str, Any]:
        with _lock:
            return self._detect_locked(video_path)

    def _detect_locked(self, video_path: str | Path) -> dict[str, Any]:
        decoder = VideoDecoder(str(video_path))
        duration = float(getattr(decoder.metadata, "duration_seconds", 0.0) or 0.0)
        if duration <= 0:
            raise ValueError("无法读取视频时长，文件可能损坏或格式不受支持。")

        plan = self._plan_windows(duration)
        clips, windows = [], []
        for i, (center, window) in enumerate(plan):
            start = max(0.0, min(center - window / 2.0, duration - min(window, duration)))
            end = min(duration, start + window)
            result = WindowResult(index=i, start=start, end=end, center=center, frames=0, fake_prob=0.0, decoded=False)
            try:
                clip = self._decode_window(decoder, center, window)
                clips.append((result, clip))
                result.decoded = True
            except Exception as exc:  # 单窗口失败不影响整片结论
                result.error = str(exc)[:200]
            windows.append(result)

        if not clips:
            raise ValueError("视频解码全部失败，无法完成检测：" + (windows[0].error or "未知错误"))

        probs = self._score_windows([clip for _, clip in clips])
        for (result, clip), p in zip(clips, probs):
            result.fake_prob = float(p)
            result.frames = int(clip.shape[0])
        decoded = [w for w in windows if w.decoded]

        sampled_frames = sum(w.frames for w in windows)
        suspicious = [w for w in decoded if w.fake_prob >= SUSPICIOUS_WINDOW]
        decoded_ratio = len(clips) / len(plan)
        mean_prob = float(np.mean([w.fake_prob for w in decoded]))
        max_prob = max(w.fake_prob for w in decoded)
        video_score = 0.5 * mean_prob + 0.5 * max_prob

        risk = "high" if video_score >= HIGH_RISK else "medium" if video_score >= MEDIUM_RISK else "low"
        coverage = "partial"

        percent = lambda v: f"{v * 100:.0f}%"
        summary = (
            f"Native-Scale 对 {len(clips)} 个采样窗口进行视觉伪造检测，"
            f"窗口模型得分均值 {percent(mean_prob)}、最大 {percent(max_prob)}。"
            "分数与风险分档尚未进行本业务校准，不代表真实概率。"
        )
        scope = (
            f"保留全片均匀采样策略：{len(plan)} 个约{WINDOW_SECONDS:.0f}秒窗口，每窗{FRAMES_PER_WINDOW}帧；"
            f"实际解码 {len(clips)}/{len(plan)} 个窗口，共{sampled_frames}帧。"
            "采用官方448p像素预算和原始比例预处理；仅覆盖采样窗口。"
        )

        findings = [
            f"采样窗口模型得分均值 {percent(mean_prob)}，最大 {percent(max_prob)}（综合得分 {percent(video_score)}）"
        ]
        findings += [
            f"第 {w.index + 1} 个采样窗口（{w.start:.1f}s–{w.end:.1f}s）AI生成模型得分 {percent(w.fake_prob)}"
            for w in sorted(suspicious, key=lambda w: -w.fake_prob)[:6]
        ]
        if len(clips) < len(plan):
            findings.append(f"{len(plan) - len(clips)} 个采样窗口解码失败，检测为部分覆盖。")

        clips_by_index = {result.index: clip for result, clip in clips}
        segments, frames = self._build_segments_and_frames(windows, duration, clips_by_index)
        return {
            "risk": risk,
            "summary": summary,
            "coverage": coverage,
            "scope": scope,
            "duration": round(duration, 2),
            "sampledFrames": sampled_frames,
            "findings": findings[:12],
            "segments": segments,
            "frames": frames,
            "meta": {
                "method": "Native-Scale (ICLR 2026)",
                "backbone": "Qwen2.5-VL Vision Transformer",
                "checkpoint": self.checkpoint_name,
                "thresholdsCalibrated": False,
                "samplingVersion": "uniform-2s-24frames-v1",
                "windowsPlanned": len(plan),
                "windowsDecoded": len(clips),
                "videoScore": round(video_score, 4),
                "meanFakeProb": round(mean_prob, 4),
                "maxFakeProb": round(max_prob, 4),
            },
        }

    def _build_segments_and_frames(
        self, windows: list[WindowResult], duration: float, clips_by_index: dict[int, torch.Tensor]
    ) -> tuple[list[dict], list[dict]]:
        """相邻可疑窗口合并为时间段；每个窗口输出中帧作为代表画面。"""
        decoded = [w for w in windows if w.decoded]
        suspicious = [w for w in decoded if w.fake_prob >= SUSPICIOUS_WINDOW]

        merged: list[list[WindowResult]] = []
        for w in suspicious:
            if merged and w.start <= merged[-1][-1].end + 0.5:  # 相邻或重叠则合并
                merged[-1].append(w)
            else:
                merged.append([w])

        segments, frames = [], []
        # 全部窗口都给代表画面（前端支持“仅看可疑画面”筛选与对照）
        for w in decoded:
            time = min(w.start + (w.end - w.start) / 2.0, duration)
            risk = "high" if w.fake_prob >= HIGH_RISK else "medium" if w.fake_prob >= SUSPICIOUS_WINDOW else "low"
            frames.append({
                "id": f"frame-{w.index + 1}",
                "time": round(time, 2),
                "risk": risk,
                "caption": f"第{w.index + 1}个采样窗口中帧 · {time:.1f}s · 模型得分{w.fake_prob * 100:.0f}%",
                "image": self._middle_frame_jpeg(clips_by_index[w.index]),
            })

        for group in merged:
            start = max(0.0, group[0].start)
            end = min(duration, group[-1].end)
            if end - start < 0.3:
                end = min(duration, start + 0.3)
            prob = max(w.fake_prob for w in group)
            risk = "high" if prob >= HIGH_RISK else "medium"
            head = group[0]
            segments.append({
                "id": f"segment-{head.index + 1}",
                "start": round(start, 2),
                "end": round(end, 2),
                "risk": risk,
                "summary": (
                    f"{'、'.join(f'第{w.index + 1}窗口' for w in group)}的视觉检测得分达到提示阈值，"
                    f"AI生成模型得分 {prob * 100:.0f}%；不代表逐帧定位或确定性结论。"
                ),
                "frameId": f"frame-{head.index + 1}",
            })
        return segments, frames

    @staticmethod
    def _middle_frame_jpeg(clip: torch.Tensor) -> str:
        """可疑窗口的代表画面：最宽 1280 的 JPEG 转 data URL，便于报告离线留存。"""
        try:
            from torchvision.io import encode_jpeg

            image = clip[clip.shape[0] // 2].cpu()
            _, h, w = image.shape
            if w > 1280:
                image = T.resize(image, [int(h * 1280 / w), 1280], InterpolationMode.BICUBIC, antialias=True)
            jpeg = encode_jpeg(image.clamp(0, 255).to(torch.uint8), quality=72)
            if isinstance(jpeg, torch.Tensor):  # torchvision 返回 uint8 Tensor 而非 bytes
                jpeg = jpeg.numpy().tobytes()
            return "data:image/jpeg;base64," + base64.b64encode(jpeg).decode("ascii")
        except Exception:
            return ""

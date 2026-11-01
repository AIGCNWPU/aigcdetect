"""ReStraV 通用AI生成视频检测推理核心。

方法依据 NeurIPS 2025 论文 "AI-Generated Video Detection via Perceptual
Straightening"（Internò et al.）：视频帧经 DINOv2 编码后在表征空间形成轨迹，
真实拍摄视频的轨迹更"直"，AI生成视频的轨迹更"弯"。逐窗口计算步进距离与
转角（曲率）等 21 维时间几何特征，用轻量 MLP 判别真伪。

在原始实现（https://github.com/ChristianInterno/ReStraV）单窗口采样的基础上，
本服务按前端契约做了以下适配：
- 全片均匀采样多个约 2 秒窗口（每个 24 帧），逐窗口判别；
- 聚合为整片风险、可疑时间段（相邻可疑窗口合并）与代表画面（窗口中帧 JPEG）；
- 输出 coverage / scope / findings 等字段，供 VERITAS 前端直接展示。
"""

from __future__ import annotations

import base64
import math
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms.functional as T
from torchvision.transforms import InterpolationMode

try:
    from torchcodec.decoders import VideoDecoder
    from torchcodec.samplers import clips_at_regular_timestamps
except Exception as exc:  # pragma: no cover - 环境缺 ffmpeg 时给出可读错误
    raise RuntimeError("torchcodec 不可用，请安装 FFmpeg 共享库后重试") from exc

# 与论文一致的采样参数
FRAMES_PER_WINDOW = 24
WINDOW_SECONDS = 2.0
MAX_WINDOWS = 12  # 60 秒以上视频固定 12 窗，避免长视频开销过大

# 风险分档阈值（基于验证集上 REAL/FAKE 概率分布标定）
HIGH_RISK = 0.65
MEDIUM_RISK = 0.35
SUSPICIOUS_WINDOW = 0.5  # 单窗口概率达到该值视为可疑片段

_lock = threading.Lock()  # 单卡串行推理，避免并发显存竞争


class MLP(nn.Module):
    """与 ReStraV train.py 完全一致的结构，加载训练产物 model.pt。"""

    def __init__(self, in_dim: int = 21, h1: int = 64, h2: int = 32):
        super().__init__()
        self.net = nn.Sequential(
            nn.Linear(in_dim, h1),
            nn.ReLU(),
            nn.Linear(h1, h2),
            nn.ReLU(),
            nn.Linear(h2, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.net(x)


def _preprocess(frames: torch.Tensor) -> torch.Tensor:
    frames = frames.float() / 255.0
    return torch.stack(
        [T.resize(x, [224, 224], InterpolationMode.BICUBIC, antialias=True) for x in frames]
    )


def _compute_temporal_geometry(z: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    delta = z[:, 1:, :] - z[:, :-1, :]
    d = delta.norm(dim=-1)
    cos = F.cosine_similarity(delta[:, :-1, :], delta[:, 1:, :], dim=-1)
    theta = torch.rad2deg(torch.acos(cos.clamp(-1, 1)))
    return d, theta


def _moment4(x: torch.Tensor) -> tuple[torch.Tensor, ...]:
    return x.mean(dim=-1), x.amin(dim=-1), x.amax(dim=-1), x.var(dim=-1, unbiased=False)


def features_from_z(z: torch.Tensor) -> torch.Tensor:
    """逐窗口 21 维时间几何特征：7 早期距离 + 6 早期转角 + 8 个统计量。"""
    d, t = _compute_temporal_geometry(z)
    d7 = d[:, :7]
    t6 = t[:, :6]
    mu_d, mn_d, mx_d, var_d = _moment4(d)
    mu_t, mn_t, mx_t, var_t = _moment4(t)
    stats = torch.stack([mu_d, mn_d, mx_d, var_d, mu_t, mn_t, mx_t, var_t], dim=1)
    return torch.cat([d7, t6, stats], dim=1)


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


class ReStraVDetector:
    """加载 DINOv2 + 训练产物，对单个视频输出前端契约结构的结果。"""

    def __init__(self, artifacts_dir: str | Path, device: str | None = None):
        self.device = torch.device(device or ("cuda:0" if torch.cuda.is_available() else "cpu"))
        artifacts = Path(artifacts_dir)
        self.backbone = torch.hub.load("facebookresearch/dinov2", "dinov2_vits14").eval().to(self.device)
        self.model = MLP()
        self.model.load_state_dict(
            torch.load(artifacts / "model.pt", map_location="cpu", weights_only=True)
        )
        self.model.to(self.device).eval()
        self.mean = np.load(artifacts / "mean.npy").astype(np.float32)
        self.std = np.load(artifacts / "std.npy").astype(np.float32)

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

    def _embed_windows(self, clips: list[torch.Tensor]) -> torch.Tensor:
        batch = torch.cat([_preprocess(c) for c in clips], dim=0).to(self.device)
        with torch.no_grad():
            feats = self.backbone.forward_features(batch)
            cls = feats["x_norm_clstoken"].unsqueeze(1)
            patches = feats["x_norm_patchtokens"]
            tokens = torch.cat([cls, patches], dim=1)
        return tokens.flatten(1).view(len(clips), clips[0].shape[0], -1)

    def _classify(self, z: torch.Tensor) -> np.ndarray:
        x = features_from_z(z).cpu().numpy().astype(np.float32)
        x = (x - self.mean.squeeze()) / self.std.squeeze()
        with torch.no_grad():
            prob_real = torch.sigmoid(self.model(torch.from_numpy(x).to(self.device)))
        return (1.0 - prob_real.cpu().numpy().ravel())  # FAKE 概率

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

        z = self._embed_windows([clip for _, clip in clips])
        probs = self._classify(z)
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
        coverage = "full" if decoded_ratio == 1.0 else "partial"

        percent = lambda v: f"{v * 100:.0f}%"
        summary = (
            f"基于 ReStraV 感知直线化方法，在 DINOv2 表征空间对全片 {len(plan)} 个采样窗口"
            f"（每窗口约{FRAMES_PER_WINDOW}帧）计算时间几何特征。"
            f"{'未发现' if not suspicious else '发现 ' + str(len(suspicious)) + ' 个'}呈现AI生成特征的采样窗口，"
            f"窗口AI概率均值 {percent(mean_prob)}、最大 {percent(max_prob)}，综合风险："
            f"{'高' if risk == 'high' else '中' if risk == 'medium' else '低'}。"
            + ("真实拍摄视频的时间轨迹通常更平滑，AI生成视频的表征轨迹弯曲度显著偏高。" if suspicious else
               "视频表征轨迹的平滑程度与真实拍摄视频一致。")
        )
        scope = (
            f"全片均匀采样 {len(plan)} 个约{WINDOW_SECONDS:.0f}秒窗口（共{sampled_frames}帧，"
            f"实际解码 {len(clips)}/{len(plan)} 个），逐窗口提取21维时间几何特征并由 ReStraV 分类器判别。"
            + ("" if coverage == "full" else f"有 {len(plan) - len(clips)} 个窗口解码失败，未纳入结论。")
        )

        findings = [
            f"采样窗口AI概率均值 {percent(mean_prob)}，最大 {percent(max_prob)}（综合得分 {percent(video_score)}）"
        ]
        findings += [
            f"第 {w.index + 1} 个采样窗口（{w.start:.1f}s–{w.end:.1f}s）AI生成概率 {percent(w.fake_prob)}"
            for w in sorted(suspicious, key=lambda w: -w.fake_prob)[:6]
        ]
        if coverage == "partial":
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
                "method": "ReStraV (Perceptual Straightening, NeurIPS 2025)",
                "backbone": "DINOv2 ViT-S/14",
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
                "caption": f"第{w.index + 1}个采样窗口中帧 · {time:.1f}s · AI概率{w.fake_prob * 100:.0f}%",
                "image": self._middle_frame_jpeg(clips_by_index[w.index]) if w.fake_prob >= SUSPICIOUS_WINDOW else "",
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
                    f"{'、'.join(f'第{w.index + 1}窗口' for w in group)}的时间几何特征偏离真实拍摄视频，"
                    f"AI生成概率 {prob * 100:.0f}%，表征轨迹弯曲度偏高。"
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

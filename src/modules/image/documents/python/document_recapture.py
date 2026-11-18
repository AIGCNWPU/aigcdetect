#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""屏幕翻拍检测特征提取与打分（规则特征 + 轻量分类器，openspec refine-image-documents-workflow T13）。

用途：判断材料是否为"对着屏幕（手机/显示器）翻拍"而非直接拍摄纸质原件/扫描件。

原理（无需 GPU、无需 torch，推理仅 numpy + PIL）：
  翻拍在图像上留下若干可测痕迹——
  1. 子像素条纹：LCD 的 RGB 条纹在采集后形成周期约 3px 的色彩振荡；
  2. 摩尔纹：屏幕像素栅格与相机传感器干涉，在中频带产生窄峰、方向性强；
  3. 屏幕光照：局部高光/亮度梯度、白点偏移、动态范围压缩；
  4. 二次采样：高频衰减但边缘有振铃，JPEG 块效应与屏幕栅格叠加；
  5. 纹理节律：局部方差分布比真实纸面更"整齐"（摩尔纹周期性）。

特征由 `extract_features` 提取，`RecaptureScorer` 读取 JSON 权重（该 JSON 由
scripts/image-validation/train_recapture.py 用合成翻拍/真实原件训练得到）。
分数为未校准模型信号，只作"疑似翻拍"提示，不构成鉴伪结论。
"""

import json
import math
import os

import numpy as np
from PIL import Image

FEATURE_NAMES = [
    "hf_ratio", "hf_mid_ratio", "moire_peak_ratio", "moire_peak_count", "moire_angular_std",
    "autocorr_x_peak", "autocorr_y_peak", "local_var_kurtosis", "edge_width_rel", "jpeg_blockiness",
    "glare_ratio", "illum_gradient", "lap_norm",
    "subpixel_rg_std", "subpixel_bg_std", "subpixel_p3_power", "sat_mean", "sat_std",
    "color_ratio", "rg_corr", "white_point_shift", "highlight_ratio", "shadow_ratio",
    "aniso", "zero_grad_max", "ink_rel",
]


def _to_gray(image, max_side=768):
    im = image.convert("L")
    if max(im.size) > max_side:
        r = max_side / max(im.size)
        im = im.resize((int(im.width * r), int(im.height * r)))
    return np.asarray(im, dtype=np.float32)


def _to_rgb(image, max_side=768):
    im = image.convert("RGB")
    if max(im.size) > max_side:
        r = max_side / max(im.size)
        im = im.resize((int(im.width * r), int(im.height * r)))
    return np.asarray(im, dtype=np.float32)


def _spectrum(gray):
    f = np.fft.fftshift(np.abs(np.fft.fft2(gray - float(gray.mean()))) ** 2)
    h, w = f.shape
    fy = (np.arange(h) - h // 2) / h
    fx = (np.arange(w) - w // 2) / w
    radius = np.sqrt(fy[:, None] ** 2 + fx[None, :] ** 2)
    return f, radius


def _band_ratio(power, radius, lo, hi):
    total = float(power.sum()) + 1e-9
    band = (radius >= lo) & (radius < hi)
    return float(power[band].sum()) / total


def _moire_features(power, radius):
    """中频环内的窄峰与方向性：摩尔纹的典型形态。"""
    ring = (radius >= 0.05) & (radius < 0.20)
    if not ring.any():
        return 0.0, 0.0, 0.0
    values = power[ring]
    median = float(np.median(values)) + 1e-9
    peak = float(values.max()) / median
    count = float(np.sum(values > median * 8.0)) / max(1.0, values.size)
    # 方向性：按角度分桶后能量的离散程度
    angles = np.arctan2(*np.meshgrid(np.arange(power.shape[1]) - power.shape[1] // 2,
                                     np.arange(power.shape[0]) - power.shape[0] // 2)[::-1])
    bins = ((angles[ring] + math.pi) / math.pi * 12).astype(int) % 12
    sums = np.zeros(12)
    np.add.at(sums, bins, values)
    total = float(sums.sum()) + 1e-9
    shares = sums / total
    angular_std = float(np.std(shares - 1.0 / 12))
    return peak, count, angular_std


def _autocorr_peak(gray, axis, max_lag=8):
    """一维自相关在 lag 2..max_lag 的相对峰值：屏幕栅格/周期性纹理。"""
    prof = gray.mean(axis=axis)
    prof = prof - prof.mean()
    denom = float(np.dot(prof, prof)) + 1e-9
    peaks = []
    for lag in range(2, min(max_lag, len(prof) - 1) + 1):
        peaks.append(float(np.dot(prof[:-lag], prof[lag:])) / denom)
    return max(peaks) if peaks else 0.0


def _local_var_kurtosis(gray, win=5):
    h, w = gray.shape
    if h < win * 3 or w < win * 3:
        return 0.0
    # 用差分近似局部方差，避免大窗口卷积开销
    d = np.abs(np.diff(gray, axis=0))[:, :-1] + np.abs(np.diff(gray, axis=1))[:-1, :]
    d = d[::2, ::2]
    mean, std = float(d.mean()), float(d.std()) + 1e-9
    return float(np.mean(((d - mean) / std) ** 4))


def _glare_and_illumination(gray):
    h, w = gray.shape
    ys, xs = np.mgrid[0:h, 0:w]
    total = float(h * w) + 1e-9
    # 低阶平面拟合 → 光照梯度
    a = np.stack([xs.ravel() / max(1, w), ys.ravel() / max(1, h), np.ones(h * w)], axis=1)
    target = gray.ravel()
    coef, *_ = np.linalg.lstsq(a, target, rcond=None)
    gradient = float(np.hypot(coef[0], coef[1]))
    p99 = float(np.percentile(gray, 99))
    glare = float(np.sum(gray >= p99) / total)
    return glare, gradient


def _subpixel_features(rgb):
    """LCD 子像素条纹：列均值序列中 R-G / B-G 的周期振荡（周期≈3px）。"""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    out = []
    for diff in (r - g, b - g):
        col = diff.mean(axis=0)
        col = col - np.convolve(col, np.ones(15) / 15, mode="same")
        out.append(float(np.std(col)))
    rg, bg = out
    col = (r - g).mean(axis=0)
    col = col - float(col.mean())
    if len(col) < 12:
        p3 = 0.0
    else:
        spec = np.abs(np.fft.rfft(col))
        idx = int(round(len(col) / 3.0))
        idx = max(1, min(idx, len(spec) - 1))
        p3 = float(spec[idx] / (spec[1:].mean() + 1e-9))
    return rg, bg, p3


def extract_features(image):
    """PIL.Image → dict(feature_name → float)。缺失项填 0。"""
    gray = _to_gray(image)
    rgb = _to_rgb(image)
    h, w = gray.shape
    feats = {name: 0.0 for name in FEATURE_NAMES}

    p1, p99 = np.percentile(gray, 1), np.percentile(gray, 99)
    span = max(1.0, float(p99 - p1))
    power, radius = _spectrum(gray)
    feats["hf_ratio"] = _band_ratio(power, radius, 0.35, 0.71)
    feats["hf_mid_ratio"] = _band_ratio(power, radius, 0.15, 0.35)
    peak, count, angular = _moire_features(power, radius)
    feats["moire_peak_ratio"] = min(peak, 100.0)
    feats["moire_peak_count"] = count * 100.0
    feats["moire_angular_std"] = angular * 10.0

    feats["autocorr_x_peak"] = _autocorr_peak(gray, axis=0)
    feats["autocorr_y_peak"] = _autocorr_peak(gray, axis=1)
    feats["local_var_kurtosis"] = min(_local_var_kurtosis(gray), 200.0)

    grad = np.abs(np.diff(gray, axis=1))
    width = []
    for row in grad[:400]:
        pk = float(row.max())
        if pk < 8:
            continue
        idx = np.where(row >= pk * 0.5)[0]
        for group in np.split(idx, np.where(np.diff(idx) > 2)[0] + 1):
            if group.size:
                width.append(int(group.size))
    feats["edge_width_rel"] = (float(np.median(width)) / max(1.0, h) * 100.0) if width else 0.0

    gx = np.abs(np.diff(gray, axis=1))
    cols = np.arange(gx.shape[1])
    boundary, inner = gx[:, cols % 8 == 7], gx[:, cols % 8 != 7]
    feats["jpeg_blockiness"] = float(boundary.mean() / (inner.mean() + 1e-6)) if inner.size else 0.0

    glare, illum = _glare_and_illumination(gray)
    feats["glare_ratio"] = glare * 100.0
    feats["illum_gradient"] = illum / span * 10.0
    feats["lap_norm"] = min(float(np.var(4 * gray[1:-1, 1:-1] - gray[:-2, 1:-1] - gray[2:, 1:-1] - gray[1:-1, :-2] - gray[1:-1, 2:]))
                            / (span ** 2), 500.0) if h > 2 and w > 2 else 0.0

    rg, bg, p3 = _subpixel_features(rgb)
    feats["subpixel_rg_std"] = rg
    feats["subpixel_bg_std"] = bg
    feats["subpixel_p3_power"] = min(p3, 50.0)
    sat = np.abs(rgb[..., 0] - rgb[..., 1]) + np.abs(rgb[..., 1] - rgb[..., 2])
    feats["sat_mean"] = float(sat.mean())
    feats["sat_std"] = float(sat.std())
    quant = (rgb // 16).reshape(-1, 3)
    feats["color_ratio"] = len(np.unique(quant, axis=0)) / max(1.0, quant.shape[0]) * 100.0
    r, g = rgb[..., 0].ravel(), rgb[..., 1].ravel()
    feats["rg_corr"] = float(np.corrcoef(r, g)[0, 1]) if r.size > 2 and r.std() > 1e-6 and g.std() > 1e-6 else 0.0
    feats["white_point_shift"] = float(rgb[..., 0].mean() - rgb[..., 2].mean())
    feats["highlight_ratio"] = float(np.mean(rgb.max(axis=2) >= 250)) * 100.0
    feats["shadow_ratio"] = float(np.mean(rgb.min(axis=2) <= 5)) * 100.0

    ax = float(np.abs(np.diff(gray, axis=1)).mean()) / span
    ay = float(np.abs(np.diff(gray, axis=0)).mean()) / span
    feats["aniso"] = float(max(ax, ay) / max(1e-9, min(ax, ay))) if ax and ay else 1.0
    feats["zero_grad_max"] = float(max(np.mean(gx.mean(axis=0) < 0.5), np.mean(np.abs(np.diff(gray, axis=0)).mean(axis=1) < 0.5))) * 100.0

    dark = gray < (float(gray.mean()) - 0.6 * float(gray.std() + 1e-6))
    runs = []
    if 0.002 < dark.mean() < 0.5:
        for row in dark[:600]:
            idx = np.where(row)[0]
            if idx.size == 0:
                continue
            for group in np.split(idx, np.where(np.diff(idx) > 1)[0] + 1):
                if group.size:
                    runs.append(int(group.size))
            if len(runs) > 4000:
                break
    feats["ink_rel"] = (float(np.median(runs)) / max(1.0, h) * 100.0) if runs else 0.0
    return feats


def feature_vector(feats):
    return np.array([float(feats.get(name, 0.0)) for name in FEATURE_NAMES], dtype=np.float64)


class RecaptureScorer:
    """读取 JSON 权重做纯 numpy 推理（标准化 + 逻辑回归 / 单隐层 MLP）。"""

    def __init__(self, path=None):
        self.model = None
        self.reason = "model_unavailable"
        if not path:
            path = os.environ.get("AIGC_RECAPTURE_MODEL") or self._default_path()
        try:
            with open(path, "r", encoding="utf-8") as fh:
                model = json.load(fh)
            if model.get("features") != FEATURE_NAMES:
                raise ValueError("feature_mismatch")
            self.model = model
            self.reason = None
        except Exception as error:
            self.reason = f"model_unavailable:{type(error).__name__}"

    @staticmethod
    def _default_path():
        """权重位置：平台 weights/recapture/（git 忽略）；兼容仓库内 models/ 回退。"""
        platform_root = os.environ.get("AIGC_PLATFORM_ROOT")
        candidates = []
        if platform_root:
            candidates.append(os.path.join(platform_root, "weights", "recapture", "recapture_v1.json"))
        here = os.path.dirname(os.path.abspath(__file__))
        candidates.append(os.path.abspath(os.path.join(here, "..", "models", "recapture_v1.json")))
        for candidate in candidates:
            if os.path.isfile(candidate):
                return candidate
        return candidates[0]

    @property
    def available(self):
        return self.model is not None

    def _standardize(self, x):
        mean = np.array(self.model["mean"], dtype=np.float64)
        scale = np.array(self.model["scale"], dtype=np.float64)
        return (x - mean) / np.where(np.abs(scale) < 1e-9, 1.0, scale)

    def score(self, feats):
        """→ (probability 0..1, details)。模型缺失返回 (None, {"reason": ...})。"""
        if not self.available:
            return None, {"reason": self.reason}
        x = self._standardize(feature_vector(feats))
        kind = self.model.get("kind", "logistic")
        if kind == "mlp":
            w1 = np.array(self.model["w1"], dtype=np.float64)
            b1 = np.array(self.model["b1"], dtype=np.float64)
            w2 = np.array(self.model["w2"], dtype=np.float64)
            b2 = float(self.model["b2"])
            hidden = np.maximum(0.0, x @ w1 + b1)
            logit = float(hidden @ w2 + b2)
        else:
            coef = np.array(self.model["coef"], dtype=np.float64)
            logit = float(x @ coef + float(self.model["intercept"]))
        prob = 1.0 / (1.0 + math.exp(-logit))
        return prob, {"kind": kind, "logit": round(logit, 4),
                      "modelVersion": self.model.get("version"),
                      "semantics": "uncalibrated_synthetic_trained_screen_recapture"}

    def level(self, prob):
        """→ (level, score0_100)。阈值来自训练集验证集选择，仅作提示分级。"""
        thresholds = self.model.get("thresholds") or {}
        high = float(thresholds.get("high", 0.75))
        medium = float(thresholds.get("medium", 0.5))
        score = None if prob is None else int(round(min(max(prob, 0.0), 1.0) * 100))
        if prob is None:
            return "unknown", None
        if prob >= high:
            return "likely", score
        if prob >= medium:
            return "suspected", score
        return "unlikely", score

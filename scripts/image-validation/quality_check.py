#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""材料图像属性鉴别 v1.2（规则基线 + OCR 空间/置信度融合，openspec refine-image-documents-workflow T7）。

输出属性概率与**模糊细项**：
  blurry 模糊（分级 + 类型 + 可定位区域）| photocopy | screen_recapture | screenshot | scanned | handwritten

模糊判定主干（无模型，多证据；阈值按实测标定，非校准概率）
------------------------------------------------------------
1. **文字行高归一化边缘宽度** `rel = edge_width_px / text_line_height_px`
   实测：同为清晰的发票与小票 rel≈0.09–0.10；高斯模糊 σ=3 升至 0.23–0.24。
   该指标与文档类型、字号、对比度基本无关，是主判据。
2. **方向化锐度** `ax, ay`：对比度归一化后水平/垂直梯度均值。
   `anisotropy = max/min`：实测清晰/各向同性模糊 ≤1.7，水平运动模糊 5.2、垂直 2.6
   → 用于区分 defocus 与 motion，并给出模糊方向。
3. **整数倍放大（低分辨率）**：零梯度列/行占比（最近邻放大典型 >0.6）+ 笔画宽度。
4. **压缩损伤**：8×8 块边界梯度比，用于解释边缘变宽而非归因于失焦。
5. **OCR 置信度融合**：按文字长度加权的平均识别置信度 + 低置信行占比。
   约束：**OCR 置信度低不能单独判为模糊**（可能字体/遮挡/手写）——无视觉证据时上限 0.6，
   并给出 recognition_ambiguous_not_blur。
6. **无 OCR 时**（无文字或 OCR 未执行）：退化为全局绝对判据，分数上限 0.6 并标注
   no_text_evidence —— 模糊本质是"文字可读性"，没有文字证据时只给提示。

输入：--image-manifest [{sample_id,path,expected_sha256}]
     --ocr（可选）ocr.json，按 sample_id 融合文字框与识别置信度
输出：--output JSON {provider,source_revision,score_semantics,ocr_fusion,samples:[...]}
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

PROVIDER = "quality_rules_v1.2"
REVISION = "quality-rules/1.2-ocr-spatial-fusion"

# 标定值（2026-11-17 实测，ink_rel = 笔画行程 / 文字行高）：
#   清晰发票/小票 0.093–0.095；真实软图 0.162；σ=1.5 0.238；最近邻放大 0.211；
#   水平运动模糊 0.350；σ=3.0 0.474。
REL_CLEAR = 0.10
REL_SEVERE = 0.40
MOTION_MIN_ACUITY = 0.02      # 被抑制方向的对比度归一化锐度下限（区分天然横线多的文档）
MOTION_SCORE = 0.55
MOTION_SEVERE_ANISO = 4.0
LOWRES_INK_REL = 0.18         # 笔画偏宽且边缘仍锐利 → 放大而非光学模糊
LOWRES_LAP = 250.0
CLEAR_LAP = 300.0
OCR_CONF_HIGH = 0.90
OCR_CONF_LOW = 0.45
OCR_ALONE_CAP = 0.60
NO_TEXT_CAP = 0.60
MOTION_ANISOTROPY = 2.2


def digest(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def clamp01(x):
    return float(min(1.0, max(0.0, x)))


# ---------------------------------------------------------------- 基础算子

def gray_array(image, max_side=None):
    im = image.convert("L")
    if max_side and max(im.size) > max_side:
        r = max_side / max(im.size)
        im = im.resize((int(im.width * r), int(im.height * r)))
    return np.asarray(im, dtype=np.float32)


def laplacian_variance(gray):
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    g = gray
    lap = 4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())


def edge_width_px(gray, max_rows=400):
    """梯度半高宽中位数（像素）：清晰文字约 1–2px，失焦/抖动明显变宽。"""
    if gray.shape[0] < 6 or gray.shape[1] < 6:
        return None
    g = gray - float(gray.mean())
    grad = np.abs(np.diff(g, axis=1))
    widths = []
    for row in grad[:max_rows]:
        peak = float(row.max())
        if peak < 8:
            continue
        idx = np.where(row >= peak * 0.5)[0]
        if idx.size == 0:
            continue
        for group in np.split(idx, np.where(np.diff(idx) > 2)[0] + 1):
            if group.size:
                widths.append(int(group.size))
        if len(widths) > 3000:
            break
    return float(np.median(widths)) if widths else None


def directional_acuity(gray):
    """→ (ax, ay, anisotropy)。对比度归一化后按方向统计梯度，用于识别运动模糊与方向。"""
    if gray.shape[0] < 8 or gray.shape[1] < 8:
        return None, None, None
    p1, p99 = np.percentile(gray, 1), np.percentile(gray, 99)
    span = max(1.0, float(p99 - p1))
    ax = float(np.abs(np.diff(gray, axis=1)).mean()) / span
    ay = float(np.abs(np.diff(gray, axis=0)).mean()) / span
    low = max(1e-9, min(ax, ay))
    return ax, ay, float(max(ax, ay) / low)


def zero_gradient_ratio(gray):
    """→ (零梯度列占比, 零梯度行占比)。整数倍最近邻放大会让多数列/行完全没有变化。"""
    if gray.shape[0] < 16 or gray.shape[1] < 16:
        return None, None
    gx = np.abs(np.diff(gray, axis=1))
    gy = np.abs(np.diff(gray, axis=0))
    return float(np.mean(gx.mean(axis=0) < 0.5)), float(np.mean(gy.mean(axis=1) < 0.5))


def high_frequency_ratio(gray):
    f = np.fft.rfft2(gray - float(gray.mean()))
    power = np.abs(f) ** 2
    fy = np.fft.fftfreq(gray.shape[0])[:, None]
    fx = np.fft.rfftfreq(gray.shape[1])[None, :]
    band = (np.abs(fy) > 0.35) | (np.abs(fx) > 0.35)
    return float(power[band].sum() / (power.sum() + 1e-9))


def jpeg_blockiness(gray):
    """8×8 块边界梯度 / 块内梯度；压缩失真会抬高该比值。"""
    if gray.shape[0] < 16 or gray.shape[1] < 16:
        return 0.0
    gx = np.abs(np.diff(gray, axis=1))
    cols = np.arange(gx.shape[1])
    boundary = gx[:, (cols % 8) == 7]
    inner = gx[:, (cols % 8) != 7]
    if inner.size == 0 or float(inner.mean()) <= 1e-6:
        return 0.0
    return float(boundary.mean() / inner.mean())


def ink_run_px(gray):
    """墨迹行程中位数：文字笔画在行方向的连续深色长度（低分辨率放大后明显变宽）。"""
    if gray.shape[0] < 8 or gray.shape[1] < 8:
        return None
    dark = gray < (float(gray.mean()) - 0.6 * float(gray.std() + 1e-6))
    if dark.mean() < 0.002 or dark.mean() > 0.5:
        return None
    runs = []
    for row in dark[:800]:
        idx = np.where(row)[0]
        if idx.size == 0:
            continue
        for group in np.split(idx, np.where(np.diff(idx) > 1)[0] + 1):
            if group.size:
                runs.append(int(group.size))
        if len(runs) > 5000:
            break
    return float(np.median(runs)) if runs else None


def bimodality(gray):
    hist, _ = np.histogram(gray, bins=64, range=(0, 255))
    hist = hist / (hist.sum() + 1e-9)
    return clamp01(float(hist.max()) * 3)


def color_stats(image, max_side=320):
    im = image.convert("RGB")
    if max(im.size) > max_side:
        r = max_side / max(im.size)
        im = im.resize((int(im.width * r), int(im.height * r)))
    arr = np.asarray(im)
    quantized = (arr // 16).reshape(-1, 3)
    unique = len(np.unique(quantized, axis=0))
    total = quantized.shape[0]
    saturation = np.abs(arr[..., 0].astype(int) - arr[..., 1]) + np.abs(arr[..., 1].astype(int) - arr[..., 2])
    return unique, total, float(saturation.mean())


def border_uniform(image):
    arr = np.asarray(image.convert("RGB"))
    edges = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    uniq = len(np.unique(edges // 8, axis=0))
    h, w = arr.shape[:2]
    return uniq <= 4, (w % 8 == 0 and h % 8 == 0)


# ---------------------------------------------------------------- OCR 融合

def load_ocr(path):
    """→ {sample_id: [ {weight, conf, box} ]}；缺失/损坏返回 {}。"""
    if not path:
        return {}
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}
    result = {}
    for sample in data.get("samples") or []:
        if sample.get("status") not in ("succeeded", "completed"):
            continue
        entries = []
        for region in sample.get("regions") or []:
            text = (region.get("observed_text") or "").strip()
            conf = region.get("recognition_confidence")
            polygon = region.get("polygon")
            if not isinstance(conf, (int, float)) or not isinstance(polygon, list) or len(polygon) < 4:
                continue
            try:
                xs = [float(p[0]) for p in polygon]
                ys = [float(p[1]) for p in polygon]
            except (TypeError, ValueError, IndexError):
                continue
            box = (min(xs), min(ys), max(xs), max(ys))
            if box[2] - box[0] < 10 or box[3] - box[1] < 8:
                continue
            entries.append({"weight": max(1.0, min(len(text), 40)), "conf": float(conf), "box": box})
        if entries:
            result[sample.get("sample_id")] = entries
    return result


def ocr_evidence(entries):
    """→ (加权平均置信度, 低置信占比, 行数)。"""
    if not entries:
        return None, None, 0
    total_w = sum(e["weight"] for e in entries)
    mean_conf = sum(e["conf"] * e["weight"] for e in entries) / total_w
    low_w = sum(e["weight"] for e in entries if e["conf"] < 0.8)
    return mean_conf, low_w / total_w, len(entries)


def text_region_stats(entries, gray_full):
    """逐文字行统计：行高、边缘宽度、行高归一化相对模糊度、局部锐度、识别置信度。"""
    if not entries:
        return None
    stats = []
    h_img, w_img = gray_full.shape[:2]
    for entry in entries:
        x1, y1, x2, y2 = (int(round(v)) for v in entry["box"])
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w_img, x2), min(h_img, y2)
        if x2 - x1 < 10 or y2 - y1 < 8:
            continue
        patch = gray_full[y1:y2, x1:x2]
        line_height = float(y2 - y1)
        ink = ink_run_px(patch)
        stats.append({
            "box": (x1, y1, x2, y2),
            "lineHeight": line_height,
            "edgeWidth": edge_width_px(patch, max_rows=120),
            "inkRun": ink,
            # 主判据：笔画行程 / 行高。清晰文字≈0.09–0.10，与文档类型、字号、对比度基本无关。
            # 严重模糊/低对比时墨迹无法测出（None），此时只保留行级锐度与识别置信度证据。
            "inkRel": None if ink is None else ink / line_height,
            "lap": laplacian_variance(patch),
            "conf": entry["conf"],
        })
    return stats or None


def score_blur(metrics, ocr_tuple, stats):
    """组合视觉与 OCR 证据 → (score, level, type, reasons, sub)。"""
    lap = metrics["lapVariance"]
    ax, ay, aniso = metrics["ax"], metrics["ay"], metrics["anisotropy"]
    zero_col, zero_row = metrics["zeroColRatio"], metrics["zeroRowRatio"]
    blocky = metrics["blockiness"]
    ink = metrics["inkRunPx"]
    reasons = []

    mean_conf, low_ratio, line_count = ocr_tuple if ocr_tuple else (None, None, 0)

    inked = [s for s in (stats or []) if s.get("inkRel") is not None]
    if len(inked) >= 5:
        rel = float(np.median([s["inkRel"] for s in inked]))
        rel_term = clamp01((rel - REL_CLEAR) / (REL_SEVERE - REL_CLEAR))
        path = "text_normalized"
    elif stats:
        # OCR 有文字行但笔画不可测（过度模糊/极低对比）：用行级锐度与识别置信度估计，上限 0.75
        rel = None
        local_sharp = float(np.median([s["lap"] for s in stats]))
        partial = 0.7 * clamp01((CLEAR_LAP - local_sharp) / 280.0) + 0.3 * clamp01((0.020 - min(ax or 0.02, ay or 0.02)) / 0.014)
        rel_term = min(0.75, max(partial, 0.25))
        path = "text_partial_evidence"
        reasons.append("ink_not_measurable")
    else:
        # 无文字证据：退化为绝对判据（提示级别，上限 NO_TEXT_CAP）
        rel = None
        fallback = 0.7 * clamp01((0.020 - min(ax or 0.02, ay or 0.02)) / 0.014) + 0.3 * clamp01((CLEAR_LAP - lap) / 280.0)
        rel_term = min(NO_TEXT_CAP, fallback)
        path = "global_fallback"
        reasons.append("no_text_evidence")

    ocr_term = 0.0
    if mean_conf is not None:
        ocr_term = 0.6 * clamp01((OCR_CONF_HIGH - mean_conf) / (OCR_CONF_HIGH - OCR_CONF_LOW)) \
            + 0.4 * clamp01(low_ratio or 0)

    # 融合：视觉主判据为主；OCR 仅在高置信模糊时加权放大，低置信不能单独定罪
    if rel_term >= 0.45:
        score = clamp01(max(rel_term, 0.7 * rel_term + 0.3 * ocr_term))
    else:
        score = clamp01(max(rel_term, min(OCR_ALONE_CAP, 0.5 * ocr_term)))
        if ocr_term > 0.4 and rel_term < 0.25:
            reasons.append("recognition_ambiguous_not_blur")

    # 运动模糊：方向各向异性显著，且被抑制方向的锐度确实低（排除天然横线多的文档）
    motion = aniso is not None and aniso >= MOTION_ANISOTROPY \
        and min(ax or 1.0, ay or 1.0) < MOTION_MIN_ACUITY
    if motion:
        motion_floor = 0.75 if aniso >= MOTION_SEVERE_ANISO else MOTION_SCORE
        score = clamp01(max(score, motion_floor))
        reasons.append("directional_motion_blur")

    # 低分辨率/放大：笔画偏宽但边缘仍锐利（lap 高）→ 放大造成，而非光学失焦
    upscale = (rel is not None and rel >= LOWRES_INK_REL) and lap >= LOWRES_LAP and not motion
    if upscale:
        reasons.append("upscaled_or_low_resolution")
    if blocky > 1.9 and score < 0.6:
        reasons.append("compression_artifacts")

    if score < 0.20:
        level = "clear"
    elif score < 0.45:
        level = "slight"
    elif score < 0.7:
        level = "moderate"
    else:
        level = "severe"

    if level == "clear":
        blur_type = "none"
    elif upscale:
        blur_type = "low_resolution"
    elif motion:
        blur_type = "motion"
    elif "compression_artifacts" in reasons:
        blur_type = "compression"
    elif rel_term >= 0.45:
        # 光学失焦与"双线性放大"在单张图上不可区分，统一按失焦描述并在建议中提示原始文件
        blur_type = "defocus"
    else:
        blur_type = "mixed"

    sub = {
        "path": path,
        "relInkRun": None if rel is None else round(rel, 4),
        "medianInkRunPx": None if not inked else round(float(np.median([s["inkRun"] for s in inked])), 2),
        "medianEdgeWidthPx": None if not stats or any(s["edgeWidth"] is None for s in stats) else round(float(np.median([s["edgeWidth"] for s in stats])), 2),
        "medianLineHeightPx": None if not stats else round(float(np.median([s["lineHeight"] for s in stats])), 2),
        "relScore": round(rel_term, 3),
        "lapVariance": round(lap, 1),
        "directionalAcuity": None if ax is None else {"x": round(ax, 4), "y": round(ay, 4)},
        "anisotropy": None if aniso is None else round(aniso, 2),
        "motionDirection": ("horizontal" if (ax is not None and ax < ay) else "vertical") if motion else None,
        "zeroGradientRatio": None if zero_col is None else {"cols": round(zero_col, 3), "rows": round(zero_row, 3)},
        "inkRunPx": None if ink is None else round(ink, 2),
        "compressionBlockiness": round(blocky, 3),
        "ocrMeanConfidence": None if mean_conf is None else round(mean_conf, 4),
        "ocrLowConfidenceRatio": None if low_ratio is None else round(low_ratio, 4),
        "ocrLineCount": line_count,
        "ocrScore": round(ocr_term, 3),
    }
    return score, level, blur_type, reasons, sub


def blur_regions(stats):
    """逐行定位可疑模糊区域（不给文字内容，仅位置/严重度/行高归一化宽度）。"""
    if not stats:
        return []
    regions = []
    for s in stats:
        rel_component = 0.25 if s["inkRel"] is None else 0.55 * clamp01((s["inkRel"] - REL_CLEAR) / (REL_SEVERE - REL_CLEAR))
        severity = clamp01(rel_component
                           + 0.25 * clamp01((CLEAR_LAP - s["lap"]) / (CLEAR_LAP - 20.0))
                           + 0.20 * clamp01((OCR_CONF_HIGH - s["conf"]) / (OCR_CONF_HIGH - OCR_CONF_LOW)))
        if severity < 0.5:
            continue
        x1, y1, x2, y2 = s["box"]
        regions.append({
            "top": y1, "left": x1, "width": x2 - x1, "height": y2 - y1,
            "severity": round(severity, 3),
            "relInkRun": None if s["inkRel"] is None else round(s["inkRel"], 4),
            "recognitionConfidence": round(s["conf"], 4),
        })
    regions.sort(key=lambda r: r["severity"], reverse=True)
    return regions[:24]


# ---------------------------------------------------------------- 主流程

def analyze(path, entries=None):
    image = Image.open(path)
    exif = image.getexif().get(274, 1)
    image = ImageOps.exif_transpose(image).convert("RGB")
    gray_full = gray_array(image)
    gray_view = gray_array(image, max_side=640)
    hf_view = high_frequency_ratio(gray_view)
    ax, ay, aniso = directional_acuity(gray_view)
    zero_col, zero_row = zero_gradient_ratio(gray_view)

    stats = text_region_stats(entries or [], gray_full)
    ocr_tuple = ocr_evidence(entries or [])

    metrics = {
        "lapVariance": float(np.median([s["lap"] for s in stats])) if stats else laplacian_variance(gray_view),
        "ax": ax, "ay": ay, "anisotropy": aniso,
        "zeroColRatio": zero_col, "zeroRowRatio": zero_row,
        "blockiness": jpeg_blockiness(gray_view),
        "inkRunPx": ink_run_px(gray_full),
    }
    score, level, blur_type, reasons, blur_sub = score_blur(metrics, ocr_tuple, stats)
    regions = blur_regions(stats) if score >= 0.20 else []

    n_colors, n_pixels, mean_sat = color_stats(image)
    color_ratio = n_colors / max(1, n_pixels) * 100
    border_single, dims_regular = border_uniform(image)
    bi = bimodality(gray_view)

    attr = {
        "blurry": round(score, 4),
        "photocopy": round(clamp01(0.5 * max(0, (0.15 - color_ratio) / 0.15) + 0.3 * max(0, (10 - mean_sat) / 10)
                                   + 0.2 * max(0, (0.005 - hf_view) / 0.005))
                           * (1 if metrics["lapVariance"] > 100 else 0.4), 4),
        "screen_recapture": round(clamp01((hf_view - 0.09) * 8), 4),
        "screenshot": 0.7 if (dims_regular and border_single and hf_view < 0.02 and mean_sat < 8)
        else 0.2 if (dims_regular and border_single) else 0.0,
        "scanned": round(clamp01((bi - 0.85) / 0.15) * (0.5 if mean_sat < 5 else 0.2)
                         * clamp01((0.02 - hf_view) / 0.02), 4),
        # 规则基线无法可靠区分手写与特殊字体/低质量印刷，v1.2 明确不评估（v2 由模型给出）。
        "handwritten": None,
    }

    notes = []
    if score >= 0.7:
        notes.append("疑似模糊较严重，文字可读性受影响，建议补拍清晰原件后复检")
    elif score >= 0.45:
        notes.append("疑似轻度模糊，建议核对模糊区域或补拍")
    if regions:
        notes.append(f"可定位 {len(regions)} 处模糊区域")
    if blur_type == "motion":
        direction = "水平" if blur_sub["motionDirection"] == "horizontal" else "垂直"
        notes.append(f"疑似{direction}方向运动模糊（拍摄抖动），建议重新拍摄")
    if blur_type == "low_resolution":
        notes.append("图像疑似被放大或分辨率偏低，建议提供原始文件")
    elif blur_type in ("defocus", "mixed") and score >= 0.45:
        notes.append("若该图由翻拍或放大得到，请提供原始文件以便复核")
    if "recognition_ambiguous_not_blur" in reasons:
        notes.append("识别置信度偏低但图像较清晰，可能是字体/遮挡/手写，非模糊")
    if "no_text_evidence" in reasons:
        notes.append("未提取到文字行，模糊判断仅基于整体图像，参考价值有限")
    if "ink_not_measurable" in reasons:
        notes.append("文字笔画不可稳定测量（可能过度模糊或对比度过低），已结合识别置信度估计")
    if attr["photocopy"] >= 0.6:
        notes.append("疑似复印件，建议提供原件照片")
    if attr["screen_recapture"] >= 0.6:
        notes.append("疑似屏幕翻拍，建议直接拍摄纸质原件")
    if attr["screenshot"] >= 0.6:
        notes.append("疑似电子截图而非实拍")
    if attr["scanned"] >= 0.6:
        notes.append("疑似扫描件")
    # 手写属性在规则基线中不评估，故不生成提示。

    return {
        "attributes": attr,
        "blur": {
            "score": round(score, 4),
            "level": level,
            "type": blur_type,
            "ocrFused": bool(stats),
            "reasons": reasons,
            "details": blur_sub,
            "regions": regions,
        },
        "notes": notes,
        "exif_orientation": exif,
        "metrics": {
            "laplacian_variance": round(metrics["lapVariance"], 1),
            "high_frequency_ratio": round(hf_view, 5),
            "directional_acuity": None if ax is None else {"x": round(ax, 4), "y": round(ay, 4)},
            "anisotropy": None if aniso is None else round(aniso, 2),
            "zero_gradient_ratio": None if zero_col is None else {"cols": round(zero_col, 3), "rows": round(zero_row, 3)},
            "ink_run_px": None if metrics["inkRunPx"] is None else round(metrics["inkRunPx"], 2),
            "jpeg_blockiness": round(metrics["blockiness"], 3),
            "color_ratio_pct": round(color_ratio, 3),
            "bimodality": round(bi, 3),
            "mean_saturation": round(mean_sat, 1),
            "text_lines_used": len(stats or []),
        },
    }


def main():
    parser = argparse.ArgumentParser(description="材料图像属性鉴别 v1.2（规则基线 + OCR 融合）")
    parser.add_argument("--image-manifest", type=Path, required=True)
    parser.add_argument("--ocr", type=Path, default=None)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    ocr_by_sample = load_ocr(args.ocr)
    report = {"provider": PROVIDER, "source_revision": REVISION,
              "score_semantics": "uncalibrated_heuristic_hints_not_conclusions",
              "ocr_fusion": {"available": bool(ocr_by_sample),
                             "source": str(args.ocr) if args.ocr else None},
              "samples": []}
    for row in json.loads(args.image_manifest.read_text()):
        sample = {"sample_id": row["sample_id"], "status": "failed"}
        try:
            sha = digest(row["path"])
            if sha != row["expected_sha256"]:
                raise ValueError("source_changed")
            sample.update(analyze(row["path"], ocr_by_sample.get(row["sample_id"])))
            sample["input_sha256"] = sha
            sample["status"] = "succeeded"
        except Exception as error:  # 属性失败不影响其他阶段
            sample["reason"] = f"quality_analysis_failed:{type(error).__name__}"
        report["samples"].append(sample)
    args.output.write_text(json.dumps(report, ensure_ascii=False))
    print(json.dumps({"samples": len(report["samples"]),
                      "succeeded": sum(s["status"] == "succeeded" for s in report["samples"]),
                      "ocr_fusion": report["ocr_fusion"]["available"]}))


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""篡改热力图 → tamperedLocation 像素连通域框。

平台 2.1 的 TruFor 局部篡改输出为 anomalyMap / confidenceMap / overlay 连续图（PNG base64），
对外 API 需要阿里云市场风格的离散区域坐标。此处对置信度图做阈值分割 + 连通域，
输出原图像素坐标（top/left/width/height）与域内平均置信度。

坐标语义与平台声明一致（tamper.coordinates = exif_oriented_full_image）。
"""

import base64
import io
import re

import numpy as np
from PIL import Image

DATA_URL = re.compile(r"^data:image/(?:png|jpeg|webp);base64,(.+)$", re.S)


def decode_map(data_url_or_b64):
    """dataURL / 裸 base64 → (numpy 灰度 0..1, (w,h))；失败返回 None。"""
    if not data_url_or_b64 or not isinstance(data_url_or_b64, str):
        return None
    match = DATA_URL.match(data_url_or_b64.strip())
    raw = match.group(1) if match else data_url_or_b64.strip()
    try:
        bytes_data = base64.b64decode(raw)
        image = Image.open(io.BytesIO(bytes_data)).convert("L")
        return np.asarray(image, dtype=np.float32) / 255.0, image.size
    except Exception:
        return None


def locations_from_map(confidence_map, image_size, restrict_probability=0.5, max_locations=8):
    """置信度图 → [{top,left,width,height,probability}]，原图像素坐标，按面积降序。"""
    decoded = decode_map(confidence_map)
    if not decoded:
        return []
    heat, (map_w, map_h) = decoded
    img_w, img_h = image_size or (map_w, map_h)
    threshold = min(max(float(restrict_probability or 0.5), 0.0), 1.0)
    mask = heat >= threshold
    if not mask.any():
        return []
    try:
        from scipy import ndimage
        labels, count = ndimage.label(mask)
    except Exception:  # scipy 不可用时退化为整图单框
        return [{
            "top": 0, "left": 0, "width": int(img_w), "height": int(img_h),
            "probability": round(float(heat[mask].mean()), 6),
        }]
    scale_x, scale_y = img_w / map_w, img_h / map_h
    boxes = []
    for index in range(1, count + 1):
        region = labels == index
        size = int(region.sum())
        if size < max(4.0, heat.size * 0.00005):  # 过滤孤立噪点
            continue
        ys, xs = np.nonzero(region)
        left, top = int(xs.min()), int(ys.min())
        right, bottom = int(xs.max()) + 1, int(ys.max()) + 1
        boxes.append({
            "top": int(round(top * scale_y)),
            "left": int(round(left * scale_x)),
            "width": int(round((right - left) * scale_x)),
            "height": int(round((bottom - top) * scale_y)),
            "probability": round(float(heat[region].mean()), 6),
        })
    boxes.sort(key=lambda box: box["width"] * box["height"], reverse=True)
    return boxes[: max(1, int(max_locations or 8))]

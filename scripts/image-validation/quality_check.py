#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""材料图像属性鉴别 v1（规则基线，openspec refine-image-documents-workflow T7）。

对渲染后的材料页图输出六个疑似属性及概率（0-1，未校准启发式，仅作直观提示，
不替代篡改检测与内容核验）：
  blurry 模糊 | photocopy 疑似复印件 | screen_recapture 疑似屏幕翻拍
  screenshot 疑似屏幕截图 | scanned 疑似扫描件 | handwritten 疑似手写

输入：--image-manifest（[{sample_id,path,expected_sha256}]，与 OCR 共用）
输出：--output JSON {provider,source_revision,samples:[{sample_id,status,input_sha256,attributes,notes}]}
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image


def digest(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def clamp01(x):
    return float(min(1.0, max(0.0, x)))


def gray_array(image, max_side=640):
    im = image.convert('L')
    if max(im.size) > max_side:
        r = max_side / max(im.size)
        im = im.resize((int(im.width * r), int(im.height * r)))
    return np.asarray(im, dtype=np.float32)


def laplacian_variance(gray):
    g = gray
    lap = 4 * g[1:-1, 1:-1] - g[:-2, 1:-1] - g[2:, 1:-1] - g[1:-1, :-2] - g[1:-1, 2:]
    return float(lap.var())


def high_frequency_ratio(gray):
    f = np.fft.rfft2(gray - gray.mean())
    power = np.abs(f) ** 2
    fy = np.fft.fftfreq(gray.shape[0])[:, None]
    fx = np.fft.rfftfreq(gray.shape[1])[None, :]
    band = (np.abs(fy) > 0.35) | (np.abs(fx) > 0.35)
    return float(power[band].sum() / (power.sum() + 1e-9))


def bimodality(gray):
    """直方图双峰强度（0-1）：扫描件前景/背景分离明显。"""
    hist, _ = np.histogram(gray, bins=64, range=(0, 255))
    hist = hist / (hist.sum() + 1e-9)
    peak = hist.max()
    return clamp01(peak * 3)  # 单峰占比越高越双峰


def color_stats(image, max_side=320):
    im = image.convert('RGB')
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
    arr = np.asarray(image.convert('RGB'))
    h, w, _ = arr.shape
    edges = np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])
    uniq = len(np.unique(edges // 8, axis=0))
    return uniq <= 4, (w % 8 == 0 and h % 8 == 0)


def analyze(path):
    image = Image.open(path)
    exif = image.getexif().get(274, 1)
    from PIL import ImageOps
    image = ImageOps.exif_transpose(image).convert('RGB')
    gray = gray_array(image)
    lap_var = laplacian_variance(gray)
    hf = high_frequency_ratio(gray)
    bi = bimodality(gray)
    n_colors, n_pixels, mean_sat = color_stats(image)
    color_ratio = n_colors / max(1, n_pixels) * 100  # 量化后颜色占比%
    border_single, dims_regular = border_uniform(image)

    # 阈值按真实样本标定（2026-11-15）：清晰实拍票据 lap≈900–3300、hf 0.001–0.07、sat 3.6–18；
    # 人造模糊图 lap≈5。属性为未校准启发式提示。
    attr = {
        # 模糊：拉普拉斯方差低（文字边缘弱）；lap≥300 视为清晰
        'blurry': clamp01((300 - lap_var) / 280),
        # 复印件：近零色彩+低饱和+高频缺失（网点丢失），且非模糊（lap>100）时才可信
        'photocopy': clamp01(0.5 * max(0, (0.15 - color_ratio) / 0.15) + 0.3 * max(0, (10 - mean_sat) / 10) + 0.2 * max(0, (0.005 - hf) / 0.005)) * (1 if lap_var > 100 else 0.4),
        # 屏幕翻拍：高频带摩尔纹能量异常（实拍样本 hf≤0.07）
        'screen_recapture': clamp01((hf - 0.09) * 8),
        # 屏幕截图：规整尺寸 + 单色边框 + 平滑高频 + 低环境色温（排除清晰实拍票据）
        'screenshot': (0.7 if dims_regular and border_single and hf < 0.02 and mean_sat < 8 else 0.2 if dims_regular and border_single else 0.0),
        # 扫描件（弱特征）：强双峰 + 极低饱和 + 高频缺失（排除高频丰富的实拍）
        'scanned': clamp01((bi - 0.85) / 0.15) * (0.5 if mean_sat < 5 else 0.2) * clamp01((0.02 - hf) / 0.02),
        # 手写（弱特征低置信）：颜色少但高频中等
        'handwritten': clamp01(0.35 if (color_ratio < 0.5 and 0.08 < hf < 0.2) else 0.0),
    }
    notes = []
    if attr['blurry'] >= 0.6:
        notes.append('疑似模糊，建议补拍清晰原件后复检')
    if attr['photocopy'] >= 0.6:
        notes.append('疑似复印件，建议提供原件照片')
    if attr['screen_recapture'] >= 0.6:
        notes.append('疑似屏幕翻拍，建议直接拍摄纸质原件')
    if attr['screenshot'] >= 0.6:
        notes.append('疑似电子截图而非实拍')
    if attr['scanned'] >= 0.6:
        notes.append('疑似扫描件')
    if attr['handwritten'] >= 0.35:
        notes.append('含疑似手写内容')
    return {'attributes': attr, 'notes': notes, 'exif_orientation': exif,
            'metrics': {'laplacian_variance': round(lap_var, 1), 'high_frequency_ratio': round(hf, 4),
                        'color_ratio_pct': round(color_ratio, 3), 'bimodality': round(bi, 3),
                        'mean_saturation': round(mean_sat, 1)}}


def main():
    parser = argparse.ArgumentParser(description='材料图像属性鉴别 v1（规则基线）')
    parser.add_argument('--image-manifest', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = {'provider': 'quality_rules_v1', 'source_revision': 'quality-rules/1.0',
              'score_semantics': 'uncalibrated_heuristic_hints_not_conclusions', 'samples': []}
    for row in json.loads(args.image_manifest.read_text()):
        sample = {'sample_id': row['sample_id'], 'status': 'failed'}
        try:
            sha = digest(row['path'])
            if sha != row['expected_sha256']:
                raise ValueError('source_changed')
            sample.update(analyze(row['path']))
            sample['input_sha256'] = sha
            sample['status'] = 'succeeded'
        except Exception as error:  # 属性失败不影响其他阶段
            sample['reason'] = f'quality_analysis_failed:{type(error).__name__}'
        report['samples'].append(sample)
    args.output.write_text(json.dumps(report, ensure_ascii=False))
    print(json.dumps({'samples': len(report['samples']),
                      'succeeded': sum(s['status'] == 'succeeded' for s in report['samples'])}))


if __name__ == '__main__':
    raise SystemExit(main())

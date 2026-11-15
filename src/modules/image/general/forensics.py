"""Local face-forgery and closed-set generator evidence; no network calls.

The face rectangles identify scored faces, not pixel-accurate tamper masks.
Source softmax scores remain candidates even when the whole-image score is high.
"""
import argparse
import base64
import hashlib
import importlib.util
import io
import json
import logging
from pathlib import Path
import sys
import time

import numpy as np
from PIL import Image, ImageOps

_engines = {}
SOURCE_SHA = 'bb6a7b3cb50368f0f8ebabb6910a12bfc9afe4a4ef0ab034ff07c70a61f605a3'


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class SourceEngine:
    def __init__(self, root, device, checkpoint='openfake_27class.pt'):
        import torch
        sys.path.insert(0, str(root / 'third_party'))
        from rpa.models.cnn import build_model
        from rpa.datalib.patches import patchify, aggregate
        self.torch, self.patchify, self.aggregate = torch, patchify, aggregate
        self.device = torch.device(device)
        path = root / 'weights/rpa' / checkpoint
        self.digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if checkpoint == 'openfake_27class.pt' and self.digest != SOURCE_SHA:
            raise ValueError('RPA checkpoint checksum mismatch')
        ckpt = torch.load(path, map_location='cpu', weights_only=True)
        self.names = ckpt['class_names']
        self.model = build_model(ckpt['config'], len(self.names))
        self.model.load_state_dict(ckpt['model'], strict=True)
        self.model = self.model.eval().to(self.device)
        self.patch = int(ckpt['config']['dataset']['patch'])
        self.mean = torch.as_tensor(ckpt['channel_mean']).reshape(1, 3, 1, 1)
        self.std = torch.as_tensor(ckpt['channel_std']).reshape(1, 3, 1, 1)

    def score(self, rgb):
        torch = self.torch
        if min(rgb.size) < self.patch:
            return {'status': 'not_applicable', 'reason': 'image_too_small',
                    'summary': f'图片短边不足 {self.patch} 像素，暂不分析生成来源。'}
        if rgb.width * rgb.height > 4096 * 4096:
            return {'status': 'not_applicable', 'reason': 'image_too_large',
                    'summary': '图片超过当前来源分析尺寸上限，未缩放后强行归因。'}
        tensor = torch.from_numpy(np.array(rgb, dtype=np.float32) / 255).permute(2, 0, 1)
        # Materialize a bounded number of patches at a time. A 4K input must
        # not allocate all RGB patches plus activations on the GPU at once.
        patches, weights = self.patchify(tensor, self.patch)
        logits = []
        with torch.inference_mode():
            for batch in patches.split(64):
                logits.append(self.model(((batch-self.mean)/self.std).to(self.device)).float().cpu())
        combined = self.aggregate(torch.cat(logits), weights, 'logit_avg')
        if not torch.isfinite(combined).all():
            raise ValueError('Nonfinite source logits')
        values, indices = combined.softmax(-1).topk(3)
        return {'status': 'completed', 'model': 'RPA OpenFake27',
                'weightsSha256': self.digest, 'calibration': 'uncalibrated_closed_set',
                'sourceVerdict': None, 'patchSize': self.patch, 'patchCount': len(patches),
                'supportedSources': self.names, 'aggregation': 'logit_avg',
                'candidates': [{'source': self.names[i], 'score': float(v)}
                               for v, i in zip(values.tolist(), indices.tolist())],
                'summary': '已完成已知生成器候选分析；未知来源和混合编辑暂不能确定归属。'}


class FaceEngine:
    def __init__(self, root, device):
        import os
        service = Path(__file__).resolve().parents[4] / 'services/video-deepfake'
        os.environ['VLAFORGE_DEVICE'] = str(device)
        os.environ['VLAFORGE_CHECKPOINT'] = str(root / 'weights/vlaforge/model.pth')
        os.environ['YUNET_CHECKPOINT'] = str(root / 'weights/vlaforge/face_detection_yunet.onnx')
        # Reuse the project's tested CLIP-backbone loading adapter, with the
        # separately downloaded, pinned official source selected explicitly.
        os.environ['VLAFORGE_SOURCE'] = str(root / 'third_party/vlaforge')
        self.face_module = load_module('image_face_crops', service / 'faces.py')
        self.detector = self.face_module.FaceDetector()
        # Still-image crops use a less restrictive detector threshold than
        # the video service. Keep its geometry and minimum-size filtering.
        self.detector.net.setScoreThreshold(.8)
        self.engine = load_module('image_vlaforge', service / 'engine.py').Engine()

    def score(self, rgb):
        import cv2
        bgr = cv2.cvtColor(np.asarray(rgb), cv2.COLOR_RGB2BGR)
        boxes = self.detector.detect(bgr)
        faces = []
        for box in boxes[:16]:
            crop = self.face_module.crop_face(bgr, box)
            score = self.engine.score(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            if not np.isfinite(score) or not 0 <= score <= 1:
                raise ValueError('Invalid face score')
            faces.append({'box': [int(v) for v in box], 'score': score,
                          'signal': 'suspicious' if score > .5 else 'no_obvious_signal'})
        preview = rgb.copy()
        preview.thumbnail((1000, 1000))
        buffer = io.BytesIO()
        preview.save(buffer, format='PNG')
        return {'status': 'completed' if faces else 'not_applicable',
                'reason': None if faces else 'no_eligible_face', 'model': 'VLAForge',
                'faces': faces, 'detectedFaceCount': len(boxes), 'analyzedFaceCount': len(faces),
                'truncated': len(boxes) > 16, 'threshold': .5,
                'imageSize': list(rgb.size), 'coordinates': 'exif_oriented_xywh',
                'preview': 'data:image/png;base64,' + base64.b64encode(buffer.getvalue()).decode(),
                'preprocess': 'YuNet score>=0.8, >=50px; square crop 1.4; RGB256; CLIP normalization',
                'calibration': 'uncalibrated', 'localization': 'face_boxes_not_tamper_masks',
                'summary': f'已分析 {len(faces)} 张人脸，可点击人脸对照伪造线索。' if faces else
                           '未检测到符合分析条件的人脸；此结果不代表图片真实。'}


def analyze_forensics(path, root, device='cpu', global_score=None):
    from tamper import TamperEngine
    root = Path(root).resolve()
    with Image.open(path) as source:
        source.load()
        input_encoding = source.format
        rgb = ImageOps.exif_transpose(source).convert('RGB')
    results = {'schemaVersion': 1}
    for key, cls in [('face', FaceEngine), ('source', SourceEngine), ('tamper', TamperEngine)]:
        start = time.monotonic()
        try:
            cache_key = (key, str(root), str(device))
            if cache_key not in _engines:
                _engines[cache_key] = cls(root, device)
            result = _engines[cache_key].score(rgb)
        except Exception as error:
            logging.exception('%s analysis failed', key)
            result = {'status': 'failed', 'reason': 'model_unavailable',
                      'summary': {'face': '本次人像分析未完成。', 'source': '本次生成来源分析未完成。',
                                  'tamper': '本次局部篡改分析未完成。'}[key]}
        result['seconds'] = round(time.monotonic() - start, 3)
        results[key] = result
    results['source']['applicability'] = (
        'whole_image_signal_present' if global_score is not None and global_score > .5
        else 'no_whole_image_signal' if global_score is not None else 'global_analysis_unavailable')
    results['source']['inputEncoding'] = input_encoding
    results['source']['encodingSensitive'] = input_encoding in {'JPEG', 'WEBP'}
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--device', default='cpu')
    args = parser.parse_args()
    import torch
    torch.set_num_threads(4)
    results = []
    for item in json.loads(Path(args.manifest).read_text()):
        try:
            evidence = analyze_forensics(item['path'], args.root, args.device, item.get('score'))
            results.append({'id': item['id'], 'forensics': evidence})
        except Exception:
            logging.exception('Image decode failed')
            results.append({'id': item['id'], 'status': 'failed', 'reason': 'invalid_image'})
        output = Path(args.output)
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(results, ensure_ascii=False))


if __name__ == '__main__':
    main()

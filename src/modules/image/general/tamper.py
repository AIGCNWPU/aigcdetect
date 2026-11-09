"""TruFor official phase-3 inference adapter; localization is a model estimate."""
import base64
import hashlib
import io
from pathlib import Path
import sys

import numpy as np
from PIL import Image


def png(image):
    stream = io.BytesIO()
    image.save(stream, format='PNG')
    return 'data:image/png;base64,' + base64.b64encode(stream.getvalue()).decode()


class TamperEngine:
    def __init__(self, root, device):
        import torch
        source = Path(root) / 'third_party/trufor/TruFor_train_test'
        sys.path.insert(0, str(source))
        from lib.config import config
        from lib.models.cmx.builder_np_conf import EncoderDecoder
        cfg = config.clone()
        cfg.defrost()
        cfg.merge_from_file(str(source / 'lib/config/trufor_ph3.yaml'))
        cfg.freeze()
        path = Path(root) / 'weights/trufor/trufor.pth.tar'
        self.digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if self.digest != 'ac1d90e329a72e0d66e8665e123a19e94bfae3209c3ef8a4f9ca3b91578c7844':
            raise ValueError('TruFor checkpoint checksum mismatch')
        self.torch, self.device = torch, torch.device(device)
        # The hash-pinned official checkpoint includes NumPy scalar training metrics.
        with torch.serialization.safe_globals([np.core.multiarray.scalar, np.dtype,
                                               type(np.dtype('float64')), type(np.dtype('float32'))]):
            checkpoint = torch.load(path, map_location='cpu', weights_only=True)
        self.model = EncoderDecoder(cfg=cfg)
        self.model.load_state_dict(checkpoint['state_dict'], strict=True)
        self.model = self.model.eval().to(self.device)

    def predict(self, rgb, max_side=1024):
        torch = self.torch
        image = rgb.copy()
        if max_side:
            image.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)
        # Official TestDataset uses /256, NOT /255; model applies its own ImageNet normalization.
        tensor = torch.from_numpy(np.array(image, dtype=np.float32).transpose(2, 0, 1) / 256).unsqueeze(0).to(self.device)
        with torch.inference_mode(), torch.backends.cudnn.flags(enabled=False):
            pred, conf, det, _ = self.model(tensor, save_np=False)
            anomaly = pred[0].softmax(dim=0)[1].float().cpu().numpy()
            confidence = conf[0, 0].sigmoid().float().cpu().numpy()
            score = det.sigmoid().item()
        if not np.isfinite(anomaly).all() or not np.isfinite(confidence).all() or not np.isfinite(score):
            raise ValueError('nonfinite_trufor_output')
        return score, anomaly, confidence, image

    def score(self, rgb):
        if min(rgb.size) < 64:
            return {'status': 'not_applicable', 'reason': 'image_too_small', 'model': 'TruFor',
                    'summary': '图片短边不足 64 像素，暂不进行局部篡改分析。'}
        score, anomaly, confidence, image = self.predict(rgb)
        # A fixed 0..1 color scale: never stretch each image's maximum to "high anomaly".
        heat = np.stack([255 * anomaly, 90 * (1 - anomaly), 255 * (1 - anomaly)], axis=-1).astype('uint8')
        overlay = np.concatenate([np.full((*anomaly.shape, 1), 245, dtype='uint8'),
                                  np.full((*anomaly.shape, 1), 65, dtype='uint8'),
                                  np.full((*anomaly.shape, 1), 95, dtype='uint8'),
                                  (anomaly * confidence * 190).astype('uint8')[..., None]], axis=-1)
        combined = Image.alpha_composite(image.convert('RGBA'), Image.fromarray(overlay, 'RGBA')).convert('RGB')
        return {'status': 'completed', 'model': 'TruFor', 'weightsSha256': self.digest,
                'score': score, 'threshold': .3, 'calibration': 'uncalibrated',
                'signal': 'suspicious' if score > .3 else 'no_obvious_signal',
                'imageSize': list(rgb.size), 'inferenceSize': list(image.size),
                'resized': image.size != rgb.size, 'coordinates': 'exif_oriented_full_image',
                'preprocess': 'RGB /256; official phase3; long edge limited to 1024 for serving',
                'localization': 'predicted_anomaly_not_ground_truth',
                'preview': png(image), 'overlay': png(combined),
                'anomalyMap': png(Image.fromarray(heat)),
                'confidenceMap': png(Image.fromarray((confidence * 255).astype('uint8'))),
                'overlayMethod': 'red alpha=anomaly*confidence*190', 'mapRange': [0, 1],
                'meanConfidence': float(confidence.mean()),
                'summary': '发现疑似局部篡改线索。' if score > .3 else '本次未发现明显局部篡改线索。'}

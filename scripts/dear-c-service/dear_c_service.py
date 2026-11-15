"""Serve the fixed DEAR-C checkpoint for image source fusion."""
import argparse
import hashlib
from http.server import ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import sys
import time

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cospy-service'))
from http_service import State, make_handler

SOURCE_SHA = 'dadf718acf6c6b1bdfb59a04acf7265a90a6aefb03927cc5699a93d7d16c25bc'
CHECKPOINT_SHA = 'c8fa321d0cac86d36def6508f787f65bf22420d4648722956ad00375a347c7bc'
PROFILE = 'dear-c-thumbnail1024-fp16-v1'


def source_digest(source):
    digest = hashlib.sha256()
    for file in sorted(source.glob('dear/**/*.py')):
        digest.update(file.relative_to(source).as_posix().encode() + b'\0')
        digest.update(hashlib.sha256(file.read_bytes()).digest())
    return digest.hexdigest()


class DearCEngine:
    def __init__(self, config):
        source = Path(config['source_dir']).resolve()
        checkpoint = Path(config['checkpoint']).resolve()
        if source_digest(source) != SOURCE_SHA:
            raise RuntimeError('DEAR-C source files do not match the pinned release')
        if hashlib.sha256(checkpoint.read_bytes()).hexdigest() != CHECKPOINT_SHA:
            raise RuntimeError('DEAR-C checkpoint integrity mismatch')

        os.environ.update(CUDA_VISIBLE_DEVICES=config['gpu_uuid'], HF_HUB_OFFLINE='1')
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(source))
        import torch
        from torchvision import transforms
        from dear.detector.corvi_mask_gated_detector import CorviMaskGatedDetector

        torch.set_num_threads(2)
        torch.set_num_interop_threads(2)
        fraction = float(config.get('memory_fraction', 0.20))
        if not 0 < fraction <= 0.25:
            raise RuntimeError('GPU memory fraction must be between 0 and 0.25')
        if torch.cuda.mem_get_info(0)[0] < 9 * 1024**3:
            raise RuntimeError('At least 9 GiB of free GPU memory is required')
        torch.cuda.set_per_process_memory_fraction(fraction, 0)
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.backends.cudnn.allow_tf32 = False
        torch.manual_seed(42)
        detector = CorviMaskGatedDetector(device='cpu')
        state = torch.load(checkpoint, map_location='cpu', weights_only=True)['model']
        detector.model.load_state_dict(state, strict=True)
        detector.model = detector.model.to('cuda:0').eval().requires_grad_(False)
        self.detector = detector
        self.torch = torch
        self.transform = transforms.Compose([
            transforms.ToTensor(),
            transforms.Normalize((0.485, 0.456, 0.406), (0.229, 0.224, 0.225)),
        ])
        self.info = {
            'provider': 'DEAR-C',
            'model': 'DEAR-C-CORVI',
            'source_sha256': SOURCE_SHA,
            'checkpoint_sha256': CHECKPOINT_SHA,
            'preprocessing_profile': PROFILE,
            'localization_supported': False,
        }

    def infer(self, image, metadata):
        torch = self.torch
        started = time.monotonic()
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        with torch.inference_mode():
            tensor = self.transform(image).unsqueeze(0).to('cuda:0')
            with torch.autocast(device_type='cuda', dtype=torch.float16):
                logit = float(self.detector.predict(tensor).flatten()[0].float().item())
        if not math.isfinite(logit):
            raise RuntimeError('Non-finite DEAR-C score')
        return {
            **self.info,
            'status': 'succeeded',
            'input': metadata,
            'inference_size': list(image.size),
            'raw_logit': logit,
            'inference_seconds': round(time.monotonic() - started, 4),
        }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    config = json.loads(parser.parse_args().config.read_text())
    token_path = Path(config['token_file'])
    if token_path.stat().st_mode & 0o077:
        raise RuntimeError('Token file must be private')
    token = token_path.read_text().strip()
    if len(token) < 32:
        raise RuntimeError('Invalid private service token')
    engine = DearCEngine(config)
    handler = make_handler(State(engine, token), service_name='DearCService/1.0')
    with ThreadingHTTPServer(('127.0.0.1', int(config.get('port', 18127))), handler) as server:
        print(json.dumps({'event': 'ready', 'model': engine.info}), flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()

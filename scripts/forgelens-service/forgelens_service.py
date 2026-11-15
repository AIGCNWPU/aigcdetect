"""Local ForgeLens inference using the pinned GenImage checkpoint."""
import argparse
import hashlib
from http.server import ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'cospy-service'))
from http_service import State, make_handler

COMMIT = '9660c91d0c40dcdf3bef5155bd1c38ec866db13e'
CHECKPOINT_SHA = '05a8b0ac9a36f4ebf4ce7b0031471326463acff3955be462251f2fe13808ce8f'
CLIP_SHA = 'b8cca3fd41ae0c99ba7e8951adf17d267cdb84cd88be6f7c2e0eca1737a03836'
MODEL_NAME = 'ForgeLens-GenImage'


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as file:
        for block in iter(lambda: file.read(8 * 1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


class ForgeLensEngine:
    def __init__(self, config):
        source = Path(config['source_dir']).resolve()
        checkpoint = Path(config['checkpoint']).resolve()
        clip_path = Path(config['clip_checkpoint']).resolve()
        revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
        modifications = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True)
        if revision != COMMIT or modifications.strip():
            raise RuntimeError('ForgeLens source revision mismatch')
        if digest(checkpoint) != CHECKPOINT_SHA or digest(clip_path) != CLIP_SHA:
            raise RuntimeError('ForgeLens checkpoint integrity mismatch')

        os.environ.update(CUDA_VISIBLE_DEVICES=config['gpu_uuid'], HF_HUB_OFFLINE='1', PYTHONDONTWRITEBYTECODE='1')
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(source))
        import numpy as np
        import torch
        from torchvision import transforms

        torch.set_num_threads(4)
        torch.manual_seed(3407)
        np.random.seed(3407)
        fraction = float(config.get('memory_fraction', 0.15))
        if not 0 < fraction <= 0.25:
            raise RuntimeError('GPU memory fraction must be between 0 and 0.25')
        torch.cuda.set_per_process_memory_fraction(fraction, 0)
        if torch.cuda.mem_get_info(0)[0] < 8 * 1024**3:
            raise RuntimeError('At least 8 GiB of free GPU memory is required')
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
        torch.backends.cuda.matmul.allow_tf32 = False
        torch.use_deterministic_algorithms(True, warn_only=True)

        # Upstream modules parse options during import as well as model creation.
        service_args = sys.argv
        sys.argv = [
            'forgelens', '--experiment_name', 'GenImage', '--eval_stage', '2',
            '--WSGM_count', '4', '--WSGM_reduction_factor', '4', '--FAFormer_layers', '2',
            '--FAFormer_reduction_factor', '1', '--FAFormer_head', '2', '--seed', '3407',
        ]
        try:
            from options.options import Options
            from models.network.clip import clip
            from models.network.net_stage2 import net_stage2
            from util import translate_duplicate

            load_clip = clip.load
            clip.load = lambda _name, device='cpu', **kwargs: load_clip(str(clip_path), device=device, **kwargs)
            try:
                model = net_stage2(Options().parse(), train=False)
            finally:
                clip.load = load_clip
        finally:
            sys.argv = service_args
        checkpoint_types = [
            argparse.Namespace, np.core.multiarray.scalar, np.dtype,
            type(np.dtype('float64')), type(np.dtype('float32')),
        ]
        with torch.serialization.safe_globals(checkpoint_types):
            state = torch.load(checkpoint, map_location='cpu', weights_only=True)
        model.load_state_dict(state['model_state_dict'], strict=True)
        del state
        self.torch = torch
        self.model = model.to('cuda:0').eval().requires_grad_(False)
        self.transform = transforms.Compose([
            transforms.Lambda(translate_duplicate),
            transforms.CenterCrop((224, 224)),
            transforms.ToTensor(),
            transforms.Normalize([0.48145466, 0.4578275, 0.40821073], [0.26862954, 0.26130258, 0.27577711]),
        ])
        self.info = {
            'provider': 'ForgeLens',
            'model': MODEL_NAME,
            'source_commit': COMMIT,
            'checkpoint_sha256': CHECKPOINT_SHA,
            'clip_sha256': CLIP_SHA,
            'preprocessing': 'EXIF orientation and alpha normalization, publisher translate_duplicate and center crop',
            'precision': 'CUDA float16 autocast',
            'full_image_pixel_coverage': False,
            'localization_supported': False,
        }

    def infer(self, image, metadata):
        torch = self.torch
        tensor = self.transform(image).unsqueeze(0).to('cuda:0')
        torch.cuda.synchronize()
        started = time.monotonic()
        with torch.inference_mode():
            with torch.autocast(device_type='cuda', dtype=torch.float16):
                logit = self.model(tensor).flatten()[0]
            score = float(torch.sigmoid(logit).item())
        raw_logit = float(logit.float().item())
        torch.cuda.synchronize()
        if not math.isfinite(score) or not math.isfinite(raw_logit):
            raise RuntimeError('Non-finite model output')
        return {
            **self.info,
            'status': 'succeeded',
            'input': metadata,
            'generated_score': score,
            'raw_logit': raw_logit,
            'predicted_class': 'generated' if score >= 0.5 else 'real',
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
    engine = ForgeLensEngine(config)
    handler = make_handler(State(engine, token), service_name='ForgeLensService/1.0')
    with ThreadingHTTPServer(('127.0.0.1', int(config.get('port', 18085))), handler) as server:
        print(json.dumps({'event': 'ready', 'address': server.server_address, 'model': engine.info}), flush=True)
        server.serve_forever()


if __name__ == '__main__':
    main()

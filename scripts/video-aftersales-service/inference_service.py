"""Loopback-only Native-Scale inference for current uploaded videos."""
import argparse
import base64
import fcntl
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import secrets
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from video_sampling import visible_frame_indices

ROOT = Path(os.environ.get('VIDEO_SERVICE_ROOT', str(Path.home() / '.local/share/veritas/native-scale')))
MAX_BYTES = 200 * 1024**2


def checkpoint(path):
    import torch
    state = torch.load(path, map_location='cpu', weights_only=True)
    for key in ('model_state_dict', 'state_dict'):
        if isinstance(state, dict) and key in state:
            state = state[key]
            break
    if not isinstance(state, dict) or not state:
        raise ValueError('Invalid checkpoint state')
    return {k.removeprefix('module.'): v for k, v in state.items()}


def load_audit(name, model, state):
    # The detection checkpoint must cover the entire constructed graph. Never
    # retain randomly initialized detection parameters behind strict=False.
    result = model.load_state_dict(state, strict=True)
    audit = {'model': name, 'strict': True, 'missing': result.missing_keys,
             'unexpected': result.unexpected_keys, 'tensors': len(state),
             'parameters': sum(p.numel() for p in model.parameters()),
             'loaded_at': time.time()}
    (ROOT / 'state' / (name + '-load.json')).write_text(json.dumps(audit, indent=2))


class Clip:
    def __init__(self, filename):
        import decord
        self.reader = decord.VideoReader(str(filename), ctx=decord.cpu(0), num_threads=2, fault_tol=0)
        self.encoded_count = len(self.reader)
        self.index_map, self.duration = visible_frame_indices(self.reader)
        self.count = len(self.index_map)
        self.fps = float(self.reader.get_avg_fps())
        if self.count < 2 or not math.isfinite(self.fps) or not 0.1 <= self.fps <= 240:
            raise ValueError('Video metadata is invalid')
        if not math.isfinite(self.duration) or not 0 < self.duration <= 600.5:
            raise ValueError('Video duration exceeds limits')
        first = self.reader[self.index_map[0]].asnumpy()
        self.height, self.width = first.shape[:2]
        if max(self.width, self.height) > 4096 or self.width * self.height > 9000000:
            raise ValueError('Video resolution exceeds limits')

    def frames(self, indices):
        # Decode errors propagate; never substitute black images.
        return self.reader.get_batch([self.index_map[i] for i in indices]).asnumpy()

    def times(self, indices):
        return [round(float(self.reader.get_frame_timestamp(self.index_map[i])[0]), 5) for i in indices]

    def end_time(self, index):
        if index+1 < self.count:
            return float(self.reader.get_frame_timestamp(self.index_map[index+1])[0])
        return self.duration

    def uniform(self, count):
        import numpy as np
        return sorted(set(int(i) for i in np.linspace(0, self.count - 1, min(count, self.count))))

    def metadata(self):
        return {'duration': self.duration, 'width': self.width, 'height': self.height,
                'fps': self.fps, 'total_frames': self.encoded_count, 'visible_frames': self.count,
                'excluded_reference_frames': self.encoded_count-self.count}


class NativeDetector:
    def __init__(self):
        import torch
        from transformers import AutoConfig, AutoVideoProcessor
        from transformers.models.qwen2_5_vl.modeling_qwen2_5_vl import Qwen2_5_VisionTransformerPretrainedModel
        source = ROOT / 'upstream/native-scale/models/Qwen2_5VL_ViT/model.py'
        spec = importlib.util.spec_from_file_location('published_native_model', source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        def architecture(model_source, dtype, attn_implementation):
            config = AutoConfig.from_pretrained(model_source, local_files_only=True)
            return Qwen2_5_VisionTransformerPretrainedModel._from_config(
                config.vision_config, dtype=dtype, attn_implementation=attn_implementation)

        # Full SFT state replaces the base initialization, verified strictly below.
        module._load_visual_backbone = architecture
        model_source = str(ROOT / 'weights/Qwen2.5-VL-3B-Instruct')
        self.model = module.Qwen2_5_ViT(model_source=model_source, tuning_mode='sft',
                                      use_bf16=True, head_dtype='bf16', attn_implementation='sdpa')
        load_audit('native-scale', self.model, checkpoint(ROOT / 'weights/native-scale-448p.pth'))
        self.model = self.model.eval().to('cuda')
        self.processor = AutoVideoProcessor.from_pretrained(model_source, local_files_only=True)
        self.processor.size = {'shortest_edge': 224**2, 'longest_edge': 448**2}

    def infer(self, clip):
        import numpy as np
        import torch
        from PIL import Image
        interval = max(1, int(clip.fps / 2))
        span = interval * 7 + 1
        center = max(0, (clip.count - span) // 2)
        starts = [center]
        if clip.duration > 8:
            starts = sorted(set([center] + [int(i) for i in np.linspace(0, max(0, clip.count - span),
                                                    min(8, max(2, math.ceil(clip.duration / 15))))]))
        windows = []
        for start in starts:
            indices = list(range(start, min(clip.count, start + span), interval))[:8]
            frames = [Image.fromarray(frame) for frame in clip.frames(indices)]
            processed = self.processor(videos=[frames], return_tensors='pt', patch_size=14)
            with torch.inference_mode():
                score = float(self.model(pixel_values=processed['pixel_values_videos'].to('cuda', torch.bfloat16),
                                         image_grid_hws=processed['video_grid_thw'].to('cuda'))['prob'][0].float())
            if not math.isfinite(score) or not 0 <= score <= 1:
                raise ValueError('Non-finite inference result')
            times = clip.times(indices)
            windows.append({'start': times[0], 'end': min(clip.duration, clip.end_time(indices[-1])),
                            'score': score, 'times': times, 'official_center': start == center})
        return {'applicability': 'applicable', 'score': max(w['score'] for w in windows),
                'center_score': next(w['score'] for w in windows if w['official_center']),
                'aggregation': 'maximum_sampled_window', 'windows': windows,
                'sampled_frames': len(set(t for w in windows for t in w['times']))}


def frame_preview(clip):
    from PIL import Image
    output = []
    indices = clip.uniform(8)
    for index, stamp in zip(indices, clip.times(indices)):
        picture = Image.fromarray(clip.frames([index])[0])
        picture.thumbnail((1024, 1024))
        stream = io.BytesIO()
        picture.save(stream, format='JPEG', quality=90)
        output.append({'time': stamp, 'data_url': 'data:image/jpeg;base64,' + base64.b64encode(stream.getvalue()).decode()})
    return {'frames': output, 'sampled_frames': len(indices)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', choices=['native'], default='native')
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    import cv2
    import torch
    cv2.setNumThreads(2)
    torch.set_num_threads(2)
    torch.set_num_interop_threads(2)
    torch.cuda.set_per_process_memory_fraction(.45)
    token = (ROOT / 'state/service-token').read_text().strip()
    if len(token) < 32:
        raise RuntimeError('Service token is not configured')
    model = NativeDetector()
    for folder in (ROOT / 'state').glob('video-current-*'):
        owner = folder / 'owner.json'
        if owner.is_file():
            try:
                pid = json.loads(owner.read_text())['pid']
                os.kill(pid, 0)
            except ProcessLookupError:
                import shutil
                shutil.rmtree(folder)
    gate = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *values):
            # No filenames, request bodies, uploaded content, or authorization logs.
            print(json.dumps({'time': time.time(), 'status': str(values[1]) if len(values) > 1 else 'event'}), flush=True)

        def send_json(self, code, data):
            body = json.dumps(data, allow_nan=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            if self.path != '/health':
                return self.send_json(404, {'error': 'not_found'})
            self.send_json(200, {'ready': True, 'kind': args.kind, 'storage': 'temporary', 'strict_checkpoint': True})

        def do_POST(self):
            self.connection.settimeout(180)
            if not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                self.close_connection = True
                return self.send_json(401, {'error': 'unauthorized'})
            if self.path not in ('/v1/analyze', '/v1/frames'):
                return self.send_json(404, {'error': 'not_found'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                length = 0
            if not 0 < length <= MAX_BYTES or self.headers.get('Content-Type') not in ('video/mp4', 'video/webm'):
                self.close_connection = True
                return self.send_json(400, {'error': 'invalid_upload'})
            if not gate.acquire(blocking=False):
                self.close_connection = True
                return self.send_json(429, {'error': 'busy'})
            started = time.monotonic()
            try:
                with tempfile.TemporaryDirectory(prefix=f'video-current-{args.kind}-', dir=ROOT / 'state') as directory:
                    (Path(directory) / 'owner.json').write_text(json.dumps({'pid': os.getpid()}))
                    filename = Path(directory) / ('input.mp4' if self.headers['Content-Type'] == 'video/mp4' else 'input.webm')
                    digest = hashlib.sha256()
                    remaining = length
                    with filename.open('wb') as output:
                        while remaining:
                            data = self.rfile.read(min(1024**2, remaining))
                            if not data:
                                raise ValueError('Incomplete upload')
                            digest.update(data)
                            output.write(data)
                            remaining -= len(data)
                    clip = Clip(filename)
                    with (ROOT / 'state/gpu.lock').open('a') as lock:
                        until = time.monotonic() + 180
                        while True:
                            try:
                                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                                break
                            except BlockingIOError:
                                if time.monotonic() >= until:
                                    raise TimeoutError('GPU busy')
                                time.sleep(.2)
                        result = frame_preview(clip) if self.path == '/v1/frames' else model.infer(clip)
                    result.update({'input_sha256': digest.hexdigest(), 'metadata': clip.metadata(),
                                   'elapsed_seconds': round(time.monotonic() - started, 3)})
                    self.send_json(200, result)
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as error:
                print(json.dumps({'inference_error': type(error).__name__, 'detail': str(error)[:400]}), flush=True)
                try:
                    self.send_json(422, {'error': 'video_analysis_failed'})
                except OSError:
                    pass
            finally:
                gate.release()

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'port': args.port, 'kind': args.kind}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()

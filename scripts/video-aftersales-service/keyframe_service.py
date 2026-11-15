"""Current-upload video keyframes; reuses the separately deployed MIRROR service."""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
import os
from pathlib import Path
import secrets
import statistics
import tempfile
import threading
import time
import urllib.parse
import urllib.error
import urllib.request
from video_sampling import visible_frame_indices

THRESHOLD = 0.35755555331707006
SOURCE_COMMIT = '7f108fdd5c132e205df6f24954045cc9ba533361'
PROTOCOL = 'uniform-8-png-median-v1'
DETAIL_PROTOCOL = 'uniform-8-native-center-context-v1'
DETAIL_THRESHOLD = 0.824063926935196
DETAIL_GUARD = 0.2163227200508118
MAX_BYTES = 200 * 1024**2


def finite_score(value):
    return type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 1


def mirror_score(body, mirror, deadline):
    frame_sha = hashlib.sha256(body).hexdigest()
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    for attempt in range(6):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise TimeoutError('Keyframe analysis exceeded its time limit')
        request = urllib.request.Request(mirror['url'].rstrip('/') + '/v1/detect', data=body,
            headers={'Authorization': 'Bearer ' + mirror['token'], 'Content-Type': 'image/png'})
        try:
            with opener.open(request, timeout=max(1, min(35, remaining))) as response:
                raw = response.read(256 * 1024 + 1)
            break
        except urllib.error.HTTPError as error:
            retry = error.code == 429 and attempt < 5
            error.close()
            if not retry:
                raise
            delay = min(.25 * (attempt + 1), deadline - time.monotonic())
            if delay <= 0:
                raise TimeoutError('Image service remained busy')
            time.sleep(delay)
    if len(raw) > 256 * 1024:
        raise ValueError('Image response exceeds limit')
    value = json.loads(raw)
    if (value.get('status') != 'succeeded' or value.get('source_commit') != SOURCE_COMMIT
            or value.get('input', {}).get('sha256') != frame_sha
            or value.get('input', {}).get('format') != 'PNG'
            or value.get('scope') != 'publisher_preprocessed_center_view'
            or not finite_score(value.get('generated_score'))):
        raise ValueError('Image identity, source revision or score mismatch')
    return value['generated_score'], frame_sha


def analyze(filename, expected_sha, mirror, deadline):
    return analyze_view(filename, expected_sha, mirror, deadline, detail=False)


def analyze_detail(filename, expected_sha, mirror, deadline):
    return analyze_view(filename, expected_sha, mirror, deadline, detail=True)


def analyze_view(filename, expected_sha, mirror, deadline, detail=False):
    import decord
    from PIL import Image
    reader = decord.VideoReader(str(filename), ctx=decord.cpu(), num_threads=2, fault_tol=0)
    encoded_count = len(reader)
    visible, duration = visible_frame_indices(reader)
    count = len(visible)
    if count < 8:
        raise ValueError('At least eight decodable frames are required')
    if not math.isfinite(duration) or not 0 < duration <= 600.5:
        raise ValueError('Invalid video duration')
    indices = [visible[min(count - 1, int(count * (i + .5) / 8))] for i in range(8)]
    first = reader[indices[0]].asnumpy()
    height, width = first.shape[:2]
    if min(width, height) < 32 or max(width, height) > 4096 or width * height > 9000000:
        raise ValueError('Invalid video dimensions')
    frames = []
    for index in indices:
        if time.monotonic() >= deadline:
            raise TimeoutError('Keyframe analysis exceeded its time limit')
        # Keep the evaluated extraction and the image service's reference preprocessing.
        pixels = reader[index].asnumpy()
        if pixels.shape[:2] != (height, width):
            raise ValueError('Video dimensions changed while decoding')
        image = Image.fromarray(pixels)
        if detail:
            cw, ch = min(504, width), min(504, height)
            left, top = (width - cw) // 2, (height - ch) // 2
            box = (left, top, left + cw, top + ch)
            image = image.crop(box)
        output = io.BytesIO()
        image.save(output, format='PNG')
        body = output.getvalue()
        if len(body) > 12 * 1024**2:
            raise ValueError('Lossless keyframe exceeds image service limit')
        score, frame_sha = mirror_score(body, mirror, deadline)
        timestamp = float(reader.get_frame_timestamp(index)[0])
        if not math.isfinite(timestamp) or not 0 <= timestamp < duration:
            raise ValueError('Invalid keyframe timestamp')
        frames.append({'frame_index': index, 'time': timestamp,
            'score': score, 'frame_sha256': frame_sha, **({'box': box} if detail else {})})
    median = statistics.median(frame['score'] for frame in frames)
    threshold = DETAIL_THRESHOLD if detail else THRESHOLD
    return {'status': 'succeeded', 'protocol': DETAIL_PROTOCOL if detail else PROTOCOL, 'source_commit': SOURCE_COMMIT,
        'input_sha256': expected_sha, 'metadata': {'duration': duration, 'width': width, 'height': height, 'total_frames': encoded_count, 'visible_frames': count, 'excluded_reference_frames': encoded_count-count},
        'sample_count': 8, 'aggregation': 'median', 'score': median, 'threshold': threshold,
        'review_signal': median >= threshold, 'coverage': 'partial', 'frames': frames,
        **({'view': 'center-original-pixels', 'full_view_guard': DETAIL_GUARD} if detail else {}),
        'outside_evaluated_duration_range': not 4 <= duration <= 14,
        'localization_supported': False}


def make_handler(config, state_dir, analyze_video=analyze, analyze_details=analyze_detail):
    gate = threading.BoundedSemaphore(1)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # No credentials, uploaded filenames, model payloads or case logs.

        def send_json(self, status, value):
            body = json.dumps(value, allow_nan=False).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def do_GET(self):
            if self.path != '/health':
                return self.send_json(404, {'error': 'not_found'})
            ready = False
            try:
                opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                with opener.open(config['mirror']['url'].rstrip('/') + '/health', timeout=3) as response:
                    ready = json.load(response).get('ready') is True
            except (OSError, ValueError):
                pass
            self.send_json(200, {'ready': ready, 'kind': 'keyframes', 'protocol': PROTOCOL,
                'detail_protocol': DETAIL_PROTOCOL,
                'sample_count': 8, 'storage': 'temporary-current-upload', 'localization_supported': False})

        def do_POST(self):
            self.connection.settimeout(60)
            if not secrets.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + config['token']):
                self.close_connection = True
                return self.send_json(401, {'error': 'unauthorized'})
            if self.path not in ('/v1/analyze', '/v1/detail'):
                self.close_connection = True
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
                with tempfile.TemporaryDirectory(prefix='video-keyframes-', dir=state_dir) as directory:
                    (Path(directory) / 'owner.json').write_text(json.dumps({'pid': os.getpid()}))
                    filename = Path(directory) / 'input.upload'
                    digest = hashlib.sha256()
                    remaining = length
                    with filename.open('wb') as output:
                        while remaining:
                            if time.monotonic() - started > 120:
                                raise TimeoutError('Upload timed out')
                            chunk = self.rfile.read(min(1024**2, remaining))
                            if not chunk:
                                raise ValueError('Incomplete upload')
                            output.write(chunk)
                            digest.update(chunk)
                            remaining -= len(chunk)
                    processor = analyze_details if self.path == '/v1/detail' else analyze_video
                    value = processor(filename, digest.hexdigest(), config['mirror'], time.monotonic() + 200)
                    value['elapsed_seconds'] = round(time.monotonic() - started, 3)
                # Finish deleting the original upload before acknowledging completion.
                self.send_json(200, value)
            except (OSError, ValueError, RuntimeError, TimeoutError):
                self.send_json(422, {'error': 'keyframe_analysis_failed'})
            finally:
                gate.release()

    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--port', type=int, default=18087)
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(args.config.read_text())
    url = urllib.parse.urlsplit(config['mirror']['url'])
    if url.scheme != 'http' or url.hostname not in ('127.0.0.1', 'localhost', '::1') or url.username or url.password or url.query or url.fragment:
        raise ValueError('Image service must use an authenticated loopback endpoint')
    if len(config['token']) < 32 or len(config['mirror']['token']) < 32:
        raise ValueError('Service credentials are missing')
    state_dir = Path(config['state_dir']).expanduser().resolve()
    state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    for folder in state_dir.glob('video-keyframes-*'):
        try:
            pid = json.loads((folder / 'owner.json').read_text())['pid']
            if not isinstance(pid, int) or pid <= 0:
                continue
            os.kill(pid, 0)
        except ProcessLookupError:
            import shutil
            shutil.rmtree(folder)
        except (OSError, ValueError, KeyError):
            continue
    server = ThreadingHTTPServer(('127.0.0.1', args.port), make_handler(config, state_dir))
    server.daemon_threads = True
    print(json.dumps({'ready': True, 'kind': 'keyframes', 'port': args.port}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()

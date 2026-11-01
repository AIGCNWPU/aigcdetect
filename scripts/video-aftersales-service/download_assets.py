"""Fetch pinned public model assets through an explicitly supplied download proxy."""
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
import hashlib
import json
import os
import shutil
import threading
import time
import urllib.request

ROOT = Path(os.environ.get('VIDEO_SERVICE_ROOT', str(Path.home() / '.local/share/veritas/native-scale')))
PROXY = os.environ.get('VIDEO_DOWNLOAD_PROXY')
STATE = ROOT / 'state'
WEIGHTS = ROOT / 'weights'
STATE.mkdir(parents=True, exist_ok=True)
WEIGHTS.mkdir(parents=True, exist_ok=True)
lock = threading.Lock()
statuses = {}
started = time.time()


def opener():
    return urllib.request.build_opener(urllib.request.ProxyHandler({'http': PROXY, 'https': PROXY}) if PROXY else urllib.request.ProxyHandler())


def read_json(url):
    with opener().open(url, timeout=45) as response:
        return json.load(response)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def progress(name, **values):
    with lock:
        statuses.setdefault(name, {}).update(values)
        temporary = STATE / 'download-progress.json.tmp'
        temporary.write_text(json.dumps({'started_at': started, 'updated_at': time.time(), 'assets': statuses}, indent=2))
        temporary.replace(STATE / 'download-progress.json')


def fetch(asset):
    path = WEIGHTS / asset['file']
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_file():
        actual = digest(path)
        if (not asset.get('size') or path.stat().st_size == asset['size']) and (not asset.get('sha256') or actual == asset['sha256']):
            progress(asset['name'], status='downloaded', received=path.stat().st_size, sha256=actual)
            return {**asset, 'size': path.stat().st_size, 'sha256': actual, 'downloaded_at': time.time()}
    part = Path(str(path) + '.part')
    progress(asset['name'], status='downloading', received=0, expected=asset.get('size'))
    if asset.get('drive_id'):
        import gdown
        stopped = threading.Event()

        def monitor():
            while not stopped.wait(2):
                candidates = list(path.parent.glob(path.name + '.part*'))
                progress(asset['name'], received=max((p.stat().st_size for p in candidates if p.is_file()), default=0))

        thread = threading.Thread(target=monitor, daemon=True)
        thread.start()
        try:
            result = gdown.download(id=asset['drive_id'], output=str(part), proxy=PROXY, quiet=True, use_cookies=False, resume=True)
            if not result:
                raise RuntimeError('Google Drive did not return a file')
        finally:
            stopped.set()
            thread.join(timeout=3)
    else:
        offset = part.stat().st_size if part.exists() else 0
        request = urllib.request.Request(asset['url'], headers={'Range': f'bytes={offset}-'} if offset else {})
        with opener().open(request, timeout=120) as response:
            if 'text/html' in response.headers.get('Content-Type', ''):
                raise RuntimeError('Asset request returned HTML')
            if offset and response.status != 206:
                offset = 0
            total = asset.get('size') or offset + int(response.headers.get('Content-Length') or 0) or None
            last = time.monotonic()
            with part.open('ab' if offset else 'wb') as output:
                received = offset
                while True:
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    output.write(block)
                    received += len(block)
                    if time.monotonic() - last >= 2:
                        progress(asset['name'], received=received, expected=total)
                        last = time.monotonic()
                    if shutil.disk_usage(ROOT).free < 2 * 1024**3:
                        raise RuntimeError('Download stopped to preserve 2 GiB free disk')
    actual = digest(part)
    if asset.get('size') and part.stat().st_size != asset['size']:
        raise RuntimeError('Asset size does not match publisher metadata')
    if asset.get('sha256') and actual != asset['sha256']:
        raise RuntimeError('Asset SHA-256 does not match publisher metadata')
    if path.suffix == '.pth':
        with part.open('rb') as stream:
            prefix = stream.read(4)
        if not (prefix.startswith(b'PK') or prefix.startswith(b'\x80')):
            raise RuntimeError('Checkpoint is not a supported binary container')
    part.replace(path)
    progress(asset['name'], status='downloaded', received=path.stat().st_size, expected=path.stat().st_size, sha256=actual)
    return {**asset, 'size': path.stat().st_size, 'sha256': actual, 'downloaded_at': time.time()}


def main():
    (STATE / 'download.pid').write_text(str(os.getpid()) + '\n')
    if shutil.disk_usage(ROOT).free < 8 * 1024**3:
        raise RuntimeError('At least 8 GiB free disk is required before downloading')
    assets = [
        {'name': 'native-scale-448p', 'file': 'native-scale-448p.pth', 'drive_id': '155ywOZpTu69tm6khb54gYNcOnHQlhyBi', 'publisher_checksum': False, 'sha256': '80d17c909120a5d025fa03fa7d8c6ac70df313115cab3d5f82fc57a1ce772429'},
    ]
    hub = read_json('https://huggingface.co/api/models/Qwen/Qwen2.5-VL-3B-Instruct/revision/66285546d2b821cf421d4f5eb2576359d3770cd3?blobs=true')
    (STATE / 'qwen-hub.json').write_text(json.dumps(hub, indent=2))
    required = {'config.json', 'preprocessor_config.json'}
    for item in hub['siblings']:
        filename = item['rfilename']
        if filename in required or filename == 'video_preprocessor_config.json':
            assets.append({'name': 'qwen-' + filename, 'file': 'Qwen2.5-VL-3B-Instruct/' + filename,
                           'url': f'https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct/resolve/{hub["sha"]}/{filename}',
                           'size': item.get('size'), 'sha256': item.get('lfs', {}).get('sha256'),
                           'publisher_checksum': bool(item.get('lfs', {}).get('sha256')), 'revision': hub['sha']})
    assert required.issubset({Path(a['file']).name for a in assets})
    ledger = []
    (STATE / 'download-assets.json').write_text(json.dumps(assets, indent=2))
    for asset in assets:
        progress(asset['name'], status='queued', received=0, expected=asset.get('size'))
    failures = []
    def retry(asset):
        for attempt in range(3):
            try:
                return fetch(asset)
            except Exception as error:
                if attempt == 2:
                    raise
                progress(asset['name'], status='retrying', attempt=attempt + 1, error=f'{type(error).__name__}: {str(error)[:300]}')
                time.sleep(2 ** (attempt + 1))

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = {executor.submit(retry, asset): asset for asset in assets}
        for future in as_completed(futures):
            asset = futures[future]
            try:
                ledger.append(future.result())
                print(json.dumps({'name': asset['name'], 'status': 'downloaded'}), flush=True)
            except Exception as error:
                failures.append(asset['name'])
                progress(asset['name'], status='failed', error=f'{type(error).__name__}: {str(error)[:500]}')
                print(json.dumps({'name': asset['name'], 'status': 'failed', 'error': str(error)[:300]}), flush=True)
            (STATE / 'weight-ledger.json').write_text(json.dumps(ledger, indent=2))
    if failures:
        raise RuntimeError('Incomplete assets: ' + ', '.join(failures))
    (STATE / 'downloads-complete').write_text('All downloads and available publisher checksums checked; model loading is a separate check.\n')


if __name__ == '__main__':
    main()

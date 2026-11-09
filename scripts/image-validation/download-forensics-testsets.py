"""Download bounded, unmodified test subsets with source manifests.

DeepFakeFace: seeded, matched archive names from wiki/insight/inpainting.
DRAGON: first 25 images from each of five official test shards, original PNGs.
No resizing or JPEG re-encoding is performed.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import io
import json
from pathlib import Path
import random
import tarfile
import time
import urllib.request
import zipfile

FACE_REV = 'eb2a54fbf2567790bd3dc61d09fdaade6bb6c31c'
DRAGON_REV = 'b97e033b697162e9ace07653b42c982ab087c9b6'


class RemoteFile(io.RawIOBase):
    """Seekable, validated HTTP ranges; zipfile reads only selected members."""
    def __init__(self, url, size):
        self.url, self.size, self.position = url, size, 0
        self.cache_start, self.cache = 0, b''

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.size + offset
        if self.position < 0:
            raise ValueError('Negative seek')
        return self.position

    def read(self, count=-1):
        if self.position >= self.size:
            return b''
        count = min(self.size-self.position, count if count >= 0 else self.size-self.position)
        if not count:
            return b''
        if self.cache_start <= self.position and self.position+count <= self.cache_start+len(self.cache):
            start = self.position-self.cache_start
            self.position += count
            return self.cache[start:start+count]
        start = self.position
        # ZIP performs separate 30-byte header, filename and payload reads.
        # Coalesce these into one range rather than three network round trips.
        end = min(self.size-1, start+max(count, 256*1024)-1)
        fetch_count = end-start+1
        url = self.url + f'?download=true&range_start={start}&range_end={end}'
        request = urllib.request.Request(url, headers={'Range': f'bytes={start}-{end}'})
        for attempt in range(4):
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    if response.status != 206 or not response.headers.get('Content-Range', '').startswith(f'bytes {start}-'):
                        raise ValueError('Server did not honor the exact byte range')
                    data = response.read(fetch_count+1)
                if len(data) != fetch_count:
                    raise ValueError('Truncated range')
                self.cache_start, self.cache = start, data
                self.position += count
                return data[:count]
            except Exception:
                if attempt == 3:
                    raise
                time.sleep(attempt+1)


def store(data, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {'path': str(path.resolve()), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}


def write_manifest(root, samples, meta):
    root.mkdir(parents=True, exist_ok=True)
    (root/'manifest.json').write_text(json.dumps(samples, ensure_ascii=False, indent=2)+'\n')
    (root/'provenance.json').write_text(json.dumps(meta, ensure_ascii=False, indent=2)+'\n')


def faces(root, count):
    archives = {'wiki': 1766572515, 'insight': 1081375437, 'inpainting': 1082027665}
    def open_archive(name):
        url = f'https://huggingface.co/datasets/OpenRL/DeepFakeFace/resolve/{FACE_REV}/{name}.zip'
        archive = zipfile.ZipFile(RemoteFile(url, archives[name]))
        names = {str(Path(info.filename).parts[-2]+'/'+Path(info.filename).name): info.filename
                 for info in archive.infolist() if not info.is_dir() and
                 Path(info.filename).suffix.lower() in {'.jpg', '.png', '.jpeg'}}
        return archive, names
    opened = dict(zip(archives, ThreadPoolExecutor(max_workers=3).map(open_archive, archives)))
    common = sorted(set.intersection(*(set(names) for _, names in opened.values())))
    if len(common) < count:
        raise ValueError(f'Insufficient matched face files: {len(common)}')
    selected = random.Random(20261105).sample(common, count)
    def download_group(name):
        archive, names = opened[name]
        rows = []
        for index, key in enumerate(selected):
            member = names[key]
            data = archive.read(member)
            row = store(data, root/name/f'{index:04d}{Path(member).suffix.lower()}')
            row.update(id=f'dff-{name}-{index:04d}', label=0 if name=='wiki' else 1,
                       manipulation={'wiki':'real','insight':'face_swap','inpainting':'face_inpainting'}[name],
                       sourceArchive=name+'.zip', archiveMember=member, pairId=key)
            rows.append(row)
            if (index+1) % 10 == 0:
                print(f'DeepFakeFace {name}: {index+1}/{count}', flush=True)
        archive.close()
        return rows
    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = [row for group in pool.map(download_group, archives) for row in group]
    write_manifest(root, rows, {'dataset':'OpenRL/DeepFakeFace','revision':FACE_REV,
        'url':'https://huggingface.co/datasets/OpenRL/DeepFakeFace',
        'selection':'seed 20261105; matched original archive members; no re-encoding',
        'samples':len(rows),'perGroup':count,'bytes':sum(r['bytes'] for r in rows),
        'scope':'Bounded engineering evaluation; not the full published benchmark',
        'annotation':'Image-level labels only; no pixel masks',
        'license':'See upstream dataset card; real images retain original IMDB-WIKI terms'})


def dragon(root):
    def download_shard(index):
        shard = f'test/dragon_test_{index:02d}.tar'
        url = f'https://huggingface.co/datasets/lesc-unifi/dragon/resolve/{DRAGON_REV}/{shard}?download=true'
        rows, metadata = [], {}
        with urllib.request.urlopen(url, timeout=90) as response:
            with tarfile.open(fileobj=response, mode='r|') as archive:
                for member in archive:
                    if member.name.endswith('.json'):
                        metadata[member.name[:-5]] = json.load(archive.extractfile(member))
                    elif member.name.endswith('.png'):
                        key = member.name[:-4]
                        info = metadata[key]
                        row = store(archive.extractfile(member).read(), root/'images'/Path(member.name).name)
                        row.update(id='dragon-'+key, source=info['model'], label=1,
                                   promptId=info['prompt_id'], sampleNumber=info['sample_num'],
                                   archiveMember=member.name, shard=shard, split='test')
                        rows.append(row)
                        if len(rows) == 25:
                            break
        print(f'DRAGON {shard}: {len(rows)} images', flush=True)
        if len(rows) != 25 or len({r['source'] for r in rows}) != 25:
            raise ValueError('Unexpected shard ordering; balanced 25-source subset not obtained')
        return rows
    with ThreadPoolExecutor(max_workers=3) as pool:
        rows = [r for group in pool.map(download_shard, [0,2,4,6,8]) for r in group]
    write_manifest(root, rows, {'dataset':'lesc-unifi/dragon','revision':DRAGON_REV,
        'url':'https://huggingface.co/datasets/lesc-unifi/dragon','split':'test',
        'selection':'First 25 PNGs in official test shards 00,02,04,06,08; no re-encoding',
        'samples':len(rows),'sources':25,'perSource':5,'bytes':sum(r['bytes'] for r in rows),
        'license':'CC-BY-SA-4.0','scope':'Small engineering subset, not a replacement for full benchmark'})


def openfake(root):
    import pyarrow.parquet as pq
    revision = '750279a9710d3d98bbc6d0d87250312cfdf922a0'
    shard = 'data/test-00000-of-00007.parquet'
    url = f'https://huggingface.co/datasets/ComplexDataLab/OpenFake/resolve/{revision}/{shard}'
    print('OpenFake: reading first official test row group, approximately 106 MB',flush=True)
    file = pq.ParquetFile(RemoteFile(url, 4782084032))
    table = file.read_row_group(0, columns=['image','label','model'])
    samples = []
    for i, item in enumerate(table.to_pylist()):
        data = item['image']['bytes']
        if data is None:
            raise ValueError('External image paths are not supported')
        from PIL import Image
        with Image.open(io.BytesIO(data)) as image:
            suffix = {'PNG':'.png','JPEG':'.jpg','WEBP':'.webp'}[image.format]
        row = store(data, root/'images'/f'{i:04d}{suffix}')
        row.update(id=f'openfake-v1-test-{i:04d}',source=item['model'].replace('.', '-'),
                   originalModel=item['model'],label=0 if item['label']=='real' else 1,
                   split='test',shard=shard,rowGroup=0,rowIndex=i)
        samples.append(row)
    write_manifest(root,samples,{'dataset':'ComplexDataLab/OpenFake','revision':revision,
        'url':'https://huggingface.co/datasets/ComplexDataLab/OpenFake/tree/v1.0',
        'selection':'First row group of official test shard 0; original embedded image bytes',
        'samples':len(samples),'bytes':sum(r['bytes'] for r in samples),
        'license':'See upstream OpenFake v1 card; noncommercial restrictions may apply',
        'scope':'Small engineering subset; class counts are reported rather than assumed balanced'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--dataset', choices=['faces','dragon','openfake','both'], default='both')
    parser.add_argument('--face-pairs', type=int, default=40)
    args = parser.parse_args()
    if args.dataset in {'faces','both'}:
        faces(args.output/'deepfakeface', args.face_pairs)
    if args.dataset in {'dragon','both'}:
        dragon(args.output/'dragon')
    if args.dataset == 'openfake':
        openfake(args.output/'openfake-original')

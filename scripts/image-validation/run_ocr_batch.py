"""Resume a frozen manifest with bounded CPU workers; preserve every completed result."""
import argparse,json,subprocess,sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from smoke_ocr import sha256

def main():
    p=argparse.ArgumentParser();p.add_argument('--manifest',type=Path,required=True);p.add_argument('--prefix',type=Path,required=True);p.add_argument('--weights',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True);p.add_argument('--workers',type=int,default=4);a=p.parse_args()
    if not 1<=a.workers<=4:raise ValueError('At most four CPU workers')
    manifest=json.loads(a.manifest.read_text());prefix=json.loads(a.prefix.read_text());byid={s['sample_id']:s for s in prefix['samples']}
    expected={r['sample_id']:r for r in manifest}
    if len(expected)!=len(manifest) or len(byid)!=len(prefix['samples']) or set(byid)-set(expected):raise ValueError('Invalid prefix ids')
    if prefix['manifest_sha256']!=sha256(a.manifest):raise ValueError('Changed frozen manifest')
    for i,s in byid.items():
        if s['input_sha256']!=expected[i]['expected_sha256']:raise ValueError('Prefix hash mismatch')
    a.output_dir.mkdir(parents=True,exist_ok=True)
    if (a.output_dir/'execution.json').exists():raise FileExistsError('Preserve previous execution')
    pending=[m for m in manifest if m['sample_id'] not in byid]
    execution={'manifest_sha256':sha256(a.manifest),'prefix_sha256':sha256(a.prefix),'completed_prefix':len(byid),'remaining':len(pending),'workers':a.workers,'threads_per_worker':4,'selection':'all_uncompleted_frozen_samples','completed_failures_retried':False,'current_incomplete_image_restarted':True}
    (a.output_dir/'execution.json').write_text(json.dumps(execution,indent=2)+'\n')
    def worker(i):
        chunk=pending[i::a.workers];inputs=a.output_dir/f'worker-{i}-manifest.json';out=a.output_dir/f'worker-{i}-results.json'
        inputs.write_text(json.dumps(chunk,indent=2)+'\n')
        if not chunk:return None
        with (a.output_dir/f'worker-{i}.log').open('w') as log:
            code=subprocess.call([sys.executable,str(Path(__file__).with_name('smoke_ocr.py')),'--image-manifest',str(inputs),'--weights',str(a.weights),'--output',str(out)],stdout=log,stderr=subprocess.STDOUT)
        return (out,inputs,code)
    with ThreadPoolExecutor(max_workers=a.workers) as pool:results=list(pool.map(worker,range(a.workers)))
    for result in results:
        if result is None:continue
        out,inputs,code=result
        if not out.exists():continue
        r=json.loads(out.read_text())
        if r['manifest_sha256']!=sha256(inputs) or r['model_asset_sha256']!=prefix['model_asset_sha256'] or r['versions']!=prefix['versions']:raise ValueError('Worker settings differ')
        for s in r['samples']:
            i=s['sample_id']
            if i in byid or i not in expected or s['input_sha256']!=expected[i]['expected_sha256']:raise ValueError('Invalid worker result')
            byid[i]=s
    merged=dict(prefix, samples=[byid[m['sample_id']] for m in manifest if m['sample_id'] in byid],execution=execution,
       latency_scope='mixed_prefix_sequential_and_four_worker_CPU_execution_not_single_worker_benchmark')
    (a.output_dir/'merged-results.json').write_text(json.dumps(merged,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'completed':len(byid),'expected':len(manifest),'succeeded':sum(s['status']=='succeeded' for s in byid.values())}))
    return 0 if len(byid)==len(manifest) and all(s['status']=='succeeded' for s in byid.values()) else 1
if __name__=='__main__':raise SystemExit(main())

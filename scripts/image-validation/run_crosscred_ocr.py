"""Bounded local OCR runner for frozen CrossCred shards, no external API."""
import argparse, json, os, subprocess, sys, time
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);args=p.parse_args();root=args.root.resolve();project=root/'project';out=root/'runtime/replay/crosscred-full-20261027';jobs=[]
for i in range(6):
 target=out/f'shard-{i}-ocr.json'
 if target.exists():raise RuntimeError('Output already exists; inspect before rerunning')
 log=(out/f'shard-{i}.log').open('w');env=dict(os.environ,OMP_NUM_THREADS='4',MKL_NUM_THREADS='4')
 command=[str(root/'runtime/envs/ocr-runtime/bin/python'),str(project/'scripts/image-validation/smoke_ocr.py'),'--weights',str(root/'weights/ocr'),'--image-manifest',str(out/f'shard-{i}-manifest.json'),'--output',str(target)]
 child=subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,env=env,cwd=project,start_new_session=True);jobs.append((child,log));print(json.dumps({'shard':i,'pid':child.pid}),flush=True)
while any(child.poll() is None for child,_ in jobs):
 status=[{'shard':i,'exit':child.poll()} for i,(child,_) in enumerate(jobs)];(out/'worker-status.json').write_text(json.dumps(status,indent=2));time.sleep(5)
for child,log in jobs:log.close()
status=[child.returncode for child,_ in jobs];(out/'worker-exits.json').write_text(json.dumps(status));print(json.dumps({'exits':status}),flush=True)
if any(status):sys.exit(1)

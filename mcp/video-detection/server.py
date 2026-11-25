"""MCP adapter for the bundled CPU video detectors (SDK 1.x)."""
import argparse
import concurrent.futures
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import threading
from types import SimpleNamespace
import uuid
from mcp.server.fastmcp import FastMCP

ROOT = Path(__file__).resolve().parents[2]
SKILLS = ROOT / 'skills'
INPUT_ROOT = Path(os.environ.get('VIDEO_INPUT_ROOT', str(Path.home() / 'Downloads'))).expanduser().resolve()
OUTPUT_ROOT = Path(os.environ.get('VIDEO_OUTPUT_ROOT', str(ROOT / 'outputs/mcp'))).expanduser().resolve()
ENDPOINTS = {'general': os.environ.get('VIDEO_GENERAL_ENDPOINT', 'http://127.0.0.1:18600'), 'deepfake': os.environ.get('VIDEO_FACE_ENDPOINT', 'http://127.0.0.1:18601')}
MODULES = {}
for name, folder in [('general','video-general-detect'),('deepfake','video-face-deepfake-detect')]:
    spec = importlib.util.spec_from_file_location('detector_'+name, SKILLS/folder/'scripts/detect.py')
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); MODULES[name] = mod

mcp = FastMCP('Video Detection', host='127.0.0.1', port=int(os.environ.get('VIDEO_MCP_PORT','18700')))
# One worker avoids concurrent CPU inference and stdout capture conflicts.
pool = concurrent.futures.ThreadPoolExecutor(max_workers=1)
lock = threading.Lock()
jobs = {}

def job_dir(job_id):
    if len(job_id)!=32 or any(c not in '0123456789abcdef' for c in job_id): raise ValueError('Invalid job_id')
    d=OUTPUT_ROOT/job_id
    if not (d/'status.json').is_file(): raise ValueError('Unknown job_id')
    return d

def save(d, state):
    tmp=d/'status.tmp';tmp.write_text(json.dumps(state,ensure_ascii=False),encoding='utf-8');tmp.replace(d/'status.json')

def run_job(job_id, path, modules):
    d=OUTPUT_ROOT/job_id; state={'job_id':job_id,'status':'running','results':{}};save(d,state)
    try:
        for name in modules:
            capture=io.StringIO()
            with contextlib.redirect_stdout(capture):
                MODULES[name].detect(SimpleNamespace(video=str(path),endpoint=ENDPOINTS[name],output=str(d/name),timeout=1800,allow_remote=False,allow_external_review=False))
            files=json.loads(capture.getvalue());raw=json.loads(Path(files['json']).read_text());result=raw.get('data',raw)
            state['results'][name]={'risk':result['risk'],'summary':result.get('summary',''),'report':files['report'],'json':files['json']}
        state['status']='completed'
    except Exception as e: state.update(status='failed',error=str(e))
    save(d,state)

@mcp.tool()
def get_detection_status() -> dict:
    """Check availability of the two local CPU detector backends."""
    result={}
    for name,mod in MODULES.items():
        try: result[name]=mod.health(ENDPOINTS[name],False)
        except Exception as e: result[name]={'ready':False,'error':str(e)}
    return result

@mcp.tool()
def submit_video_detection(video_path: str, module: str='both') -> dict:
    """Queue an existing local video under VIDEO_INPUT_ROOT. module: general, deepfake, both. No external review or paid API calls."""
    if module not in ('general','deepfake','both'): raise ValueError('Invalid module')
    p=Path(video_path).expanduser().resolve()
    if not p.is_relative_to(INPUT_ROOT) or not p.is_file(): raise ValueError('Video must be an existing file under VIDEO_INPUT_ROOT')
    modules=list(MODULES) if module=='both' else [module]
    if not 0<p.stat().st_size<=min(MODULES[n].MAX_BYTES for n in modules): raise ValueError('Video exceeds module upload limit or is empty')
    with lock:
        if sum(not f.done() for f in jobs.values())>=8: raise ValueError('Queue full; retry after current jobs finish')
        jid=uuid.uuid4().hex;d=OUTPUT_ROOT/jid;d.mkdir(parents=True)
        state={'job_id':jid,'status':'queued','results':{}};save(d,state)
        jobs[jid]=pool.submit(run_job,jid,p,modules)
    return state

@mcp.tool()
def get_detection_result(job_id: str) -> dict:
    """Return persisted job status and compact results, without inline image data."""
    state=json.loads((job_dir(job_id)/'status.json').read_text())
    if state['status'] in ('queued','running') and job_id not in jobs:
        state.update(status='interrupted',error='Server restarted; submit a new job')
    return state

@mcp.tool()
def get_detection_report(job_id: str, module: str='general') -> str:
    """Return the Markdown report of a completed module. Raw JSON/evidence paths are in get_detection_result."""
    if module not in MODULES: raise ValueError('Invalid module')
    state=get_detection_result(job_id);entry=state.get('results',{}).get(module)
    if not entry: raise ValueError('No report available for this module')
    p=Path(entry['report']).resolve()
    if not p.is_relative_to(job_dir(job_id)): raise ValueError('Invalid report location')
    return p.read_text(encoding='utf-8')

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--transport',choices=['stdio','streamable-http'],default='stdio')
    args=parser.parse_args();mcp.run(transport=args.transport)

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
export const platformRoot = path.resolve(process.env.AIGC_PLATFORM_ROOT || path.join(projectRoot, '..'));
const exec = promisify(execFile);
export const python = name => path.join(platformRoot, 'runtime/envs', name, 'bin/python');
export function localEnvironment() {
  const cache = path.join(platformRoot, 'runtime/cache');
  return {...process.env, PYTHONUNBUFFERED:'1', HF_HUB_OFFLINE:'1', TRANSFORMERS_OFFLINE:'1',
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK:'True', OMP_NUM_THREADS:'4', MKL_NUM_THREADS:'4',
    HF_HOME:path.join(cache,'huggingface'), TORCH_HOME:path.join(cache,'torch'),
    XDG_CACHE_HOME:cache, MPLCONFIGDIR:path.join(cache,'matplotlib'),
    TRITON_CACHE_DIR:path.join(cache,'triton'), CUDA_CACHE_PATH:path.join(cache,'cuda'),
    LD_LIBRARY_PATH:(process.env.LD_LIBRARY_PATH || '').split(':').filter(v=>v&&!/^\/usr\/local\/cuda[^/]*\/lib(?:64)?\/?$/.test(v)).join(':')};
}

// Child output remains in the local run directory; never forward tracebacks to clients.
export async function runLocal(command, args, {log, timeout=600000}={}) {
  const chunks=[]; let bytes=0;
  return new Promise((resolve,reject)=>{
    const child=spawn(command,args,{cwd:projectRoot,env:localEnvironment(),stdio:['ignore','pipe','pipe']});
    const collect=data=>{if(bytes<2*1024*1024){chunks.push(data);bytes+=data.length;}};
    child.stdout.on('data',collect);child.stderr.on('data',collect);
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeout);
    child.on('error',error=>{clearTimeout(timer);reject(new Error(error.code==='ENOENT'?'local_runtime_missing':'local_process_failed'));});
    child.on('close',async code=>{
      clearTimeout(timer);
      try {if(log)await writeFile(log,Buffer.concat(chunks),{flag:'wx',mode:0o600});}
      catch {return reject(new Error('local_log_failed'));}
      resolve({code,timedOut});
    });
  });
}

export async function selectGpu(outputDir, label) {
  const {stdout}=await exec('nvidia-smi',['--query-gpu=index,uuid,memory.total,memory.used,utilization.gpu','--format=csv,noheader,nounits'],{timeout:10000});
  await writeFile(path.join(outputDir,`${label}-gpu.csv`),stdout,{flag:'wx',mode:0o600});
  const available=stdout.trim().split('\n').map(line=>line.split(',').map(s=>s.trim()))
    .filter(r=>Number(r[2])-Number(r[3])>=24000&&Number(r[4])<15).sort((a,b)=>Number(a[3])-Number(b[3]));
  if(!available.length)throw new Error('no_idle_gpu');
  return available[0][0];
}

export async function executeStage(stage, manifestPath, outputDir) {
  await mkdir(outputDir,{recursive:true,mode:0o700});
  let command,args,resultFile;
  if(stage==='mirror') {
    const gpu=await selectGpu(outputDir,stage);
    const ledger=path.join(outputDir,'checkpoint-ledger.json');
    await writeFile(ledger,JSON.stringify({target:path.join(platformRoot,'weights/mirror/checkpoint-h-cur.pth'),sha256:'829ef07b52caa26c1cb3917e603a275cfd1c7f494f7b750f86fb218710ac66d5'}),{flag:'wx',mode:0o600});
    command=python('mirror-runtime');resultFile=path.join(outputDir,'mirror.json');
    args=['scripts/image-validation/smoke_mirror.py','--code',path.join(platformRoot,'third_party/mirror'),'--checkpoint',path.join(platformRoot,'weights/mirror/checkpoint-h-cur.pth'),'--ledger',ledger,'--backbone',path.join(platformRoot,'weights/mirror/backbone-from-phase2'),'--manifest',manifestPath,'--output',resultFile,'--gpu',gpu];
  } else if(stage==='seed') {
    const gpu=await selectGpu(outputDir,stage);
    command=python('seed-runtime');resultFile=path.join(outputDir,'results.json');
    args=['scripts/image-validation/evaluate_seed.py','--source',path.join(platformRoot,'third_party/seed'),'--weights',path.join(platformRoot,'weights/seed'),'--manifest',manifestPath,'--output-dir',outputDir,'--gpu',gpu,'--max-pixels','20000000'];
  } else if(stage==='ocr') {
    command=python('ocr-runtime');resultFile=path.join(outputDir,'ocr.json');
    args=['scripts/image-validation/smoke_ocr.py','--weights',path.join(platformRoot,'weights/ocr'),'--image-manifest',manifestPath,'--output',resultFile];
  } else throw new Error('unknown_stage');
  const execution=await runLocal(command,args,{log:path.join(outputDir,'process.log'),timeout:900000});
  let report;
  try {report=JSON.parse(await readFile(resultFile,'utf8'));} catch {throw new Error(execution.timedOut?'stage_timeout':'stage_failed');}
  // A partial CLI report never implies successful processing of missing pages.
  return {...report,execution};
}

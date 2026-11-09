import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
export const platformRoot = path.resolve(process.env.AIGC_PLATFORM_ROOT || path.join(projectRoot, '..'));
const exec = promisify(execFile);
// A shared Conda interpreter can be selected without changing the isolated-env layout.
export const python = name => process.env.AIGC_PYTHON || path.join(platformRoot, 'runtime/envs', name, 'bin/python');
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

export function gpuMemoryPolicy(env=process.env) {
  const minimumFreeMB=Number(env.AIGC_GPU_MIN_FREE_MB||24000);
  const limitMB=env.AIGC_GPU_MEMORY_LIMIT_MB?Number(env.AIGC_GPU_MEMORY_LIMIT_MB):null;
  if(!Number.isSafeInteger(minimumFreeMB)||minimumFreeMB<1024||
     (limitMB!==null&&(!Number.isSafeInteger(limitMB)||limitMB<1024||limitMB+1024>minimumFreeMB)))throw new Error('invalid_gpu_memory_policy');
  return {minimumFreeMB,limitMB};
}

export function rankAvailableGpus(csv, minimumFreeMB, maxUtilization=95) {
  if(!Number.isFinite(maxUtilization)||maxUtilization<0||maxUtilization>100)throw new Error('invalid_gpu_utilization_limit');
  return csv.trim().split('\n').map(line=>line.split(',').map(s=>s.trim()))
    .filter(r=>r.length>=5&&Number(r[2])-Number(r[3])>=minimumFreeMB&&Number.isFinite(Number(r[4]))&&Number(r[4])<=maxUtilization)
    .sort((a,b)=>Number(a[4])-Number(b[4])||(Number(b[2])-Number(b[3]))-(Number(a[2])-Number(a[3])));
}

export async function selectGpu(outputDir, label) {
  const {minimumFreeMB}=gpuMemoryPolicy();
  const {stdout}=await exec('nvidia-smi',['--query-gpu=index,uuid,memory.total,memory.used,utilization.gpu','--format=csv,noheader,nounits'],{timeout:10000});
  await writeFile(path.join(outputDir,`${label}-gpu.csv`),stdout,{flag:'w',mode:0o600});
  const available=rankAvailableGpus(stdout,minimumFreeMB,Number(process.env.AIGC_GPU_MAX_UTILIZATION||95));
  if(!available.length)throw new Error('no_idle_gpu');
  return available[0][0];
}

export async function executeStage(stage, manifestPath, outputDir) {
  await mkdir(outputDir,{recursive:true,mode:0o700});
  let command,args,resultFile;
  if(stage==='mirror') {
    const gpu=await selectGpu(outputDir,stage);
    // Keep the legacy stage key for saved reports; the active classifier is DDA H+.
    const rows=JSON.parse(await readFile(manifestPath,'utf8'));
    const input=path.join(outputDir,'dda-manifest.json');
    await writeFile(input,JSON.stringify(rows.map(r=>({id:r.sample_id,path:r.path}))),{flag:'wx',mode:0o600});
    command=python('mirror-runtime');resultFile=path.join(outputDir,'dda.json');
    args=['src/modules/image/general/analyze.py','--root',platformRoot,'--manifest',input,'--output',resultFile,'--gpu',gpu,'--classify-only'];
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
  if(stage==='mirror')return {provider:'dda_hplus',source_revision:'dda_hplus_official_20261025',samples:report.map(r=>({sample_id:r.id,status:r.status==='completed'?'succeeded':'failed',input_sha256:r.diagnostics?.sha256,stored_size:r.diagnostics?.dimensions,generated_score:r.score,coverage:r.coverage,model:r.model})),execution};
  // A partial CLI report never implies successful processing of missing pages.
  return {...report,execution};
}

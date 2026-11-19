// Publish only scored, complete paired runs; never load gold labels into inference.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const out=path.resolve(process.argv[2]||'');if(!process.argv[2])throw Error('Run directory required');
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const audit=await load(path.join(out,'judgments.json'));
if(audit.samples.length!==8||!audit.reviewed)throw Error('Complete evidence review required');
if(audit.samples.filter(s=>s.expectedAnomaly).length!==4||audit.samples.some((s,i)=>s.id!==`doc-${String(i+1).padStart(2,'0')}`))throw Error('Frozen sample order or labels changed');
const methods=[{id:'agent',title:'智鉴智能核验'},{id:'direct',title:'直接语义核验'},{id:'rules',title:'本地规则'}];
const categories=['基础金额','运费与明细','折扣与尾差','含税与税额'];
const rows=categories.map(title=>({title,total:2,correct:{agent:0,direct:0,rules:0}}));
const summary=Object.fromEntries(methods.map(m=>[m.id,{detected:0,normal:0,abstained:0,correct:0,falseAlarms:0}]));
for(const [index,sample] of audit.samples.entries()){
 for(const method of methods){
  const judgment=sample.methods[method.id];
  if(!judgment||!['anomaly','normal','unresolved'].includes(judgment.prediction)||!judgment.reason)throw Error('Missing judgment');
  const file=path.join(out,sample.id,method.id==='rules'?'local.json':(method.id==='agent'?'claude-agent-sdk':'direct')+'-result.json');
  const hash=createHash('sha256').update(await readFile(file)).digest('hex');if(hash!==judgment.resultSha256)throw Error('Result changed after review');
  const record=summary[method.id];if(judgment.prediction==='unresolved')record.abstained++;
  if(!sample.expectedAnomaly&&judgment.prediction==='anomaly')record.falseAlarms++;
  const correct=(sample.expectedAnomaly&&judgment.prediction==='anomaly'&&judgment.matchesExpectedIssue===true)||(!sample.expectedAnomaly&&judgment.prediction==='normal');
  if(correct){rows[Math.floor(index/2)].correct[method.id]++;record.correct++;record[sample.expectedAnomaly?'detected':'normal']++;}
 }
}
const progress=await load(path.join(out,'progress.json'));
for(const method of methods.filter(m=>m.id!=='rules')){const runs=progress.filter(r=>r.engine===(method.id==='agent'?'claude-agent-sdk':'direct'));if(runs.length!==8)throw Error('Missing paired runs');summary[method.id].averageSeconds=runs.reduce((n,r)=>n+r.seconds,0)/runs.length;}
const data={published:true,datasetLabel:'公开合成票据 · 8份试测',samples:8,positive:4,negative:4,date:'2026-11-06',scope:'英文合成PDF经渲染和OCR后核验；单文件金额一致性小样本，不包括跨文件核对或视觉篡改定位。采用同一输入比较规则与语义处理流程。',methods,rows,summary};
await writeFile(new URL('../../src/modules/image/documents/benchmark-data.js',import.meta.url),'// Generated from frozen, reviewed paired results.\nexport const documentBenchmark='+JSON.stringify(data,null,2)+';\n');
await writeFile(path.join(out,'benchmark.json'),JSON.stringify(data,null,2));console.log(JSON.stringify(summary));

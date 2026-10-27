// Development expansion on newly frozen real OCR; no API and no author labels in execution.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {extractOcrMaterial} from '../../src/modules/image/documents/server/ocr-fields.js';
import {evaluateReview} from '../../src/modules/image/documents/server/review-plan.js';
import {assessExecution,ruleTitle} from '../../src/modules/image/documents/server/execution-assessment.js';
import {presentReview} from '../../src/modules/image/documents/server/review-presentation.js';
const [rootArg,outputArg]=process.argv.slice(2);if(!rootArg||!outputArg)throw new Error('Usage: evaluate-expanded-content.mjs PLATFORM_ROOT NEW_OUTPUT');
const root=path.resolve(rootArg),output=path.resolve(outputArg),input=path.join(root,'runtime/replay/local-content-20261027');
if(!output.startsWith(path.join(root,'runtime')+path.sep))throw new Error('Output must be under platform runtime');
const read=async p=>JSON.parse(await readFile(p,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const save=async(p,v)=>writeFile(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const [manifest,groups,ocr]=await Promise.all(['expanded-manifest.json','expanded-groups.json','expanded-ocr.json'].map(f=>read(path.join(input,f))));
if(ocr.samples.length!==manifest.length)throw new Error('Wait for all frozen OCR samples');
let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw new Error('API forbidden');};
await mkdir(output,{mode:0o700});
const report={version:'expanded-local-review/1.0',date:'2026-10-27',apiCalls:0,modelCalls:0,networkAttempts:0,scope:'new development groups, not independent accuracy',groups:[]};let sections='';
const objectives={2:'identity_consistency',5:'identity_consistency',4:'identity_consistency',8:'merchant_reconciliation',73:'identity_consistency',75:'procurement_review'};
for(const group of groups){
 const gid=group.group_id,slug=`group-${String(gid).padStart(2,'0')}`,dir=path.join(output,slug);await mkdir(dir,{mode:0o700});
 const materials=[],extractions=[],images=[];
 for(const id of group.sample_ids){
  const row=manifest.find(r=>r.sample_id===id),s=ocr.samples.find(r=>r.sample_id===id);
  if(s.status!=='succeeded'){images.push({id,status:'ocr_failed'});continue;}
  const bytes=await readFile(row.path);if(sha(bytes)!==row.expected_sha256||sha(bytes)!==s.input_sha256)throw new Error('Source mismatch');
  const extraction=extractOcrMaterial(s,{id,type:row.material_type}),m=extraction.material;
  m.textBlocks=s.regions.map(r=>({id:r.region_id,text:r.observed_text,confidence:r.recognition_confidence,page:1,source:{polygon:r.polygon}}));
  materials.push(m);extractions.push(extraction);
  const name=id+path.extname(row.path);await copyFile(row.path,path.join(dir,name));
  await save(path.join(dir,id+'-ocr.txt'),s.regions.map(r=>`[${r.region_id}] 识别分数${r.recognition_confidence}\n${r.observed_text}`).join('\n\n'));
  images.push({id,name,regions:s.regions.length,sha256:sha(bytes)});
 }
 if(!materials.length){report.groups.push({groupId:gid,status:'no_successful_ocr'});continue;}
 const batch={id:`expanded-${gid}`,version:1,materials},review=evaluateReview(batch,{coreMaterialId:materials[0].id,objective:objectives[gid],jurisdiction:'CN'});
 review.executionAssessment=assessExecution({batch,review,materials});
 const presentation=presentReview({materials,review,semanticReview:{status:'not_run',reason:'local_only',items:[]}}),checks=[...review.checks,...review.candidates];
 const summary={groupId:gid,type:group.type,files:materials.length,fields:materials.reduce((n,m)=>n+m.fields.length,0),zeroFields:materials.filter(m=>!m.fields.length).map(m=>m.id),formats:materials.map(m=>({id:m.id,format:m.contentFormat?.kind})),candidates:review.plan.contentCandidates.length,checks:Object.fromEntries(['PASS','FAIL','WARN','NEI'].map(s=>[s,checks.filter(c=>c.status===s).length])),warnings:presentation.warnings.length};
 await save(path.join(dir,'result.json'),{summary,batch,extractions,review,presentation,images});
 await save(path.join(dir,'publisher-label.json'),{notUsedAsInput:true,publisherAnnotation:group.publisher_annotation});
 let md=`# 新增第${gid}组\n\n${group.type}\n\n真实新OCR，自动规则输出；API调用0。\n\n`;
 let html=`<section id="expanded-${gid}"><h2>新增第${gid}组：${esc(group.type)}</h2><p>${summary.files}张、${summary.fields}字段、${summary.candidates}候选。<a href="${slug}/result.json">机器结果</a> · <a href="${slug}/local-results.md">文字结果</a></p>`;
 for(const m of materials){
  const image=images.find(i=>i.id===m.id);html+=`<details><summary>${esc(m.id)}：${esc(m.contentFormat?.kind)}，${m.fields.length}字段</summary><img src="${slug}/${image.name}" loading="lazy"><p><a href="${slug}/${m.id}-ocr.txt">完整OCR文字</a></p><table><tr><th>字段/角色</th><th>值</th><th>识别分数</th></tr>${m.fields.map(f=>`<tr><td>${esc(f.key)}/${esc(f.role)}</td><td>${esc(f.value)}</td><td>${esc(f.confidence)}</td></tr>`).join('')}</table></details>`;
  md+=`## ${m.id}：${m.contentFormat?.kind}\n\n`+m.fields.map(f=>`- ${f.key}/${f.role}：${f.value}，识别分数${f.confidence}`).join('\n')+'\n\n';
 }
 html+='<details open><summary>自动本地逐项检查</summary><table><tr><th>检查</th><th>状态</th><th>原因</th><th>证据</th></tr>'+checks.map(c=>`<tr class="${c.status}"><td>${esc(c.title||ruleTitle(c.rule))}</td><td>${esc(c.status)}</td><td>${esc(c.explanation||c.reason)}</td><td>${esc((c.evidence||[]).map(e=>`${e.materialId}/${e.key}：${e.value}`).join('\n'))}</td></tr>`).join('')+'</table></details></section>';
 md+='## 自动逐项检查\n\n'+checks.map(c=>`- ${c.title||c.rule}：${c.status}；${c.explanation||c.reason}`).join('\n')+'\n';
 await save(path.join(dir,'local-results.md'),md);sections+=html;report.groups.push(summary);console.log(JSON.stringify(summary));
}
report.networkAttempts=networkAttempts;report.totals={files:report.groups.reduce((s,g)=>s+(g.files||0),0),fields:report.groups.reduce((s,g)=>s+(g.fields||0),0),candidates:report.groups.reduce((s,g)=>s+(g.candidates||0),0),zeroFieldFiles:report.groups.flatMap(g=>g.zeroFields||[])};
await save(path.join(output,'report.json'),report);
await save(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>新增普通格式本地核验</title><style>body{font:16px/1.6 system-ui;max-width:1400px;margin:auto;padding:20px;background:#f5f7fb}section{background:white;margin:24px 0;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd4df;padding:8px;white-space:pre-line;overflow-wrap:anywhere}img{max-width:100%;max-height:800px}.FAIL{background:#fff0ed}.NEI{background:#fffbe9}summary{cursor:pointer;font-weight:bold;padding:10px}</style><h1>新增普通格式核验</h1><p>新增${report.totals.files}张，${report.totals.fields}字段，${report.totals.candidates}候选。所有字段、状态、原因、证据均为程序自动输出；作者说明单独保存，未输入规则。本轮API0。</p>${sections}</html>`);
await save(path.join(output,'README.md'),'# 新增普通格式核验\n\n[结果页面](index.html) · [汇总](report.json)\n\n真实新OCR与自动规则；没有调用API。未识别和缺字段保留为未覆盖，不把条目数当准确率。\n');
if(networkAttempts)throw new Error('Network attempted');
console.log(JSON.stringify(report.totals));

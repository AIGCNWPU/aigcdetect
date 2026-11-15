// Full CrossCred group replay. Publisher labels never enter extraction or rules.
import {readFile,writeFile,mkdir,copyFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const serverRoot=process.env.LOCAL_RULE_SERVER_ROOT?pathToFileURL(path.resolve(process.env.LOCAL_RULE_SERVER_ROOT)+path.sep):new URL('../../src/modules/image/documents/server/',import.meta.url);
const {extractOcrMaterial}=await import(new URL('ocr-fields.js',serverRoot));
const {evaluateReview}=await import(new URL('review-plan.js',serverRoot));
const {assessExecution}=await import(new URL('execution-assessment.js',serverRoot));
const {presentReview}=await import(new URL('review-presentation.js',serverRoot));
const [rootArg,outArg,...flags]=process.argv.slice(2);if(!rootArg||!outArg)throw new Error('Usage: evaluate-crosscred-full.mjs PLATFORM_ROOT NEW_OUTPUT [--partial]');
const root=path.resolve(rootArg),out=path.resolve(outArg),input=path.join(root,'runtime/replay/crosscred-full-20261027');
if(!out.startsWith(path.join(root,'runtime')+path.sep))throw new Error('Output must be under runtime');
const partial=flags.includes('--partial'),read=async p=>JSON.parse(await readFile(p,'utf8')),sha=b=>createHash('sha256').update(b).digest('hex');
const save=async(p,v)=>writeFile(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const [manifest,groups,reused]=await Promise.all(['manifest.json','groups.json','reused-ocr.json'].map(f=>read(path.join(input,f))));
const samples=new Map(reused.samples.map(s=>[s.sample_id,s]));
for(const name of (await readdir(input)).filter(n=>/^shard-\d+-ocr\.json$/.test(n))){const r=await read(path.join(input,name));if(JSON.stringify(r.model_asset_sha256)!==JSON.stringify(reused.model_asset_sha256))throw new Error('OCR asset mismatch');for(const s of r.samples)samples.set(s.sample_id,s);}
if(!partial&&samples.size!==manifest.length)throw new Error(`OCR unfinished: ${samples.size}/${manifest.length}`);
let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw new Error('No network/API in local replay');};
await mkdir(out,{mode:0o700});await mkdir(path.join(out,'assets'),{mode:0o700});
const materials=new Map(),extractions=new Map(),imageById=new Map();
for(const row of manifest){const s=samples.get(row.sample_id);if(!s||s.status!=='succeeded')continue;const data=await readFile(row.path);if(sha(data)!==row.expected_sha256||s.input_sha256!==row.expected_sha256)throw new Error('Original/OCR SHA mismatch');
 const e=extractOcrMaterial(s,{id:row.sample_id,type:'unknown'}),m=e.material;m.jurisdiction='CN';m.textBlocks=s.regions.map(r=>({id:r.region_id,text:r.observed_text,confidence:r.recognition_confidence,page:1,source:{polygon:r.polygon}}));
 materials.set(m.id,m);extractions.set(m.id,e);const imageName=m.id+path.extname(row.path);if(!flags.includes('--no-assets'))await copyFile(row.path,path.join(out,'assets',imageName));imageById.set(m.id,imageName);
}
const report={version:'crosscred-full/1.0',createdAt:new Date().toISOString(),partial,scope:'dataset-driven development, not independent accuracy',apiCalls:0,modelCalls:0,networkAttempts:0,manifestSha256:sha(await readFile(path.join(input,'manifest.json'))),ocr:{expected:manifest.length,available:samples.size,succeeded:[...samples.values()].filter(s=>s.status==='succeeded').length,failed:[...samples.values()].filter(s=>s.status!=='succeeded').map(s=>({id:s.sample_id,error:s.error}))},groups:[],types:[]};
for(const g of groups){const current=g.sample_ids.map(id=>materials.get(id)).filter(Boolean),slug=`group-${String(g.group_id).padStart(2,'0')}`;await mkdir(path.join(out,slug));
 const summary={groupId:g.group_id,publishedType:g.published_type,publisherGroup:g.type,expectedAvailable:g.sample_ids.length,files:current.length,missingFiles:g.missing_files,ocrPending:g.sample_ids.filter(id=>!samples.has(id)),ocrFailed:g.sample_ids.filter(id=>samples.has(id)&&!materials.has(id)),inputComplete:g.complete&&current.length===g.sample_ids.length,fields:current.reduce((n,m)=>n+m.fields.length,0),zeroFieldFiles:current.filter(m=>!m.fields.length).map(m=>m.id),unknownFormatFiles:current.filter(m=>m.contentFormat?.status!=='matched').map(m=>m.id),formats:current.map(m=>({id:m.id,format:m.contentFormat?.kind,fields:m.fields.length})),candidates:0,differenceChecks:0};
 let result={summary,images:current.map(m=>({id:m.id,name:imageById.get(m.id)})),publisherAnnotation:{notUsedAsInput:true,annotation:g.annotation}};
 if(current.length){const core=current[0],objective=['invoice','digital_invoice'].includes(core.type)?'invoice_review':['contract','delivery_note'].includes(core.type)?'procurement_review':['receipt','order'].includes(core.type)?'merchant_reconciliation':'identity_consistency';
  const batch={id:`crosscred-group-${g.group_id}`,version:1,materials:current},review=evaluateReview(batch,{coreMaterialId:core.id,objective,jurisdiction:'CN'});review.executionAssessment=assessExecution({batch,review,materials:current});const presentation=presentReview({materials:current,review,semanticReview:{status:'not_run',reason:'local_only',items:[]}});
  const all=[...review.checks,...review.candidates];Object.assign(summary,{coreMaterialId:core.id,objective,candidates:review.plan.contentCandidates.length,comparisonChecks:all.filter(c=>c.comparedKey).length,comparisonResolved:all.filter(c=>c.comparedKey&&c.status!=='NEI').length,comparisonPending:all.filter(c=>c.comparedKey&&c.status==='NEI').length,recognitionReviewCandidates:review.plan.contentCandidates.filter(c=>c.recognitionRequiresReview).length,differenceChecks:all.filter(c=>c.comparedKey&&['FAIL','WARN'].includes(c.status)).length,checks:Object.fromEntries(['PASS','FAIL','WARN','NEI'].map(status=>[status,all.filter(c=>c.status===status).length])),warnings:presentation.warnings.length});
  Object.assign(result,{batch,review,presentation,extractions:current.map(m=>extractions.get(m.id))});
 }
 summary.executionStatus=summary.ocrPending.length?'pending':summary.ocrFailed.length?'ocr_failed':g.missing_files.length?'partial_missing_source':'completed';
 await save(path.join(out,slug,'result.json'),result);await save(path.join(out,slug,'ocr.txt'),current.map(m=>`## ${m.id}\n`+m.textBlocks.map(t=>`[${t.id}] ${t.text}`).join('\n')).join('\n\n'));report.groups.push(summary);
}
for(const type of [...new Set(manifest.map(m=>m.published_type))]){const rows=manifest.filter(m=>m.published_type===type),ids=rows.map(r=>r.sample_id),gs=report.groups.filter(g=>g.publishedType===type);report.types.push({type,images:ids.length,ocrSucceeded:ids.filter(id=>materials.has(id)).length,withFields:ids.filter(id=>materials.get(id)?.fields.length).length,formatMatched:ids.filter(id=>materials.get(id)?.contentFormat?.status==='matched').length,groups:gs.length,groupsWithComparison:gs.filter(g=>g.comparisonChecks>0).length,groupsWithDifference:gs.filter(g=>g.differenceChecks>0).length});}
report.totals={images:manifest.length,groups:groups.length,availableOcr:samples.size,fields:[...materials.values()].reduce((n,m)=>n+m.fields.length,0),withFields:[...materials.values()].filter(m=>m.fields.length).length,formatMatched:[...materials.values()].filter(m=>m.contentFormat?.status==='matched').length,completedGroups:report.groups.filter(g=>g.executionStatus==='completed').length,missingSourceGroups:report.groups.filter(g=>g.missingFiles.length).length,groupsWithComparison:report.groups.filter(g=>g.comparisonChecks>0).length,groupsWithDifference:report.groups.filter(g=>g.differenceChecks>0).length,groupsWithOnlyPendingComparison:report.groups.filter(g=>g.comparisonChecks>0&&!g.comparisonResolved).length,recognitionReviewCandidates:report.groups.reduce((n,g)=>n+(g.recognitionReviewCandidates||0),0),candidates:report.groups.reduce((n,g)=>n+g.candidates,0)};report.networkAttempts=networkAttempts;
await save(path.join(out,'report.json'),report);await save(path.join(out,'coverage.md'),'# CrossCred覆盖矩阵\n\n|发布者类别|图数|OCR成功|有字段|匹配格式|组数|有比较组|有差异组|\n|---|---:|---:|---:|---:|---:|---:|---:|\n'+report.types.map(t=>`|${t.type}|${t.images}|${t.ocrSucceeded}|${t.withFields}|${t.formatMatched}|${t.groups}|${t.groupsWithComparison}|${t.groupsWithDifference}|`).join('\n')+'\n\n运行、格式、关联及差异覆盖分别统计；不把作者标签当真实业务真值。\n');
console.log(JSON.stringify(report.totals));

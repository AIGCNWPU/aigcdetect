/** Freeze real replay outputs for the in-product examples; never runs inference. */
import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {platformRoot as root} from '../../src/modules/image/documents/server/local-runtime.js';
import {presentReview} from '../../src/modules/image/documents/server/review-presentation.js';
const read=async p=>JSON.parse(await readFile(p,'utf8'));
const out=path.join(root,'runtime/public-examples');await mkdir(out,{recursive:true});
const publish=async(name,value)=>{const file=path.join(out,name);await writeFile(file+'.tmp',JSON.stringify(value));await rename(file+'.tmp',file);};
const visual=path.join(root,'runtime/replay/visual-diagnostics-20261031');
const results=await read(visual+'/results-c2pa-verified.json'),manifest=await read(visual+'/manifest.json');
const images=[];
for(const index of [0,3,6,7]){const row=manifest[index],bytes=await readFile(row.path);images.push({name:({0:'真实照片',3:'生成图片',6:'生成图片 · 本次漏检',7:'生成图片 · 区域响应'})[index]+path.extname(row.path),size:bytes.length,sourceLabel:index===0?'real':'generated',dataUrl:'data:image/'+(/png$/i.test(row.path)?'png':'jpeg')+';base64,'+bytes.toString('base64'),result:results[index]});}
await publish('general.json',{example:true,source:'真实数据集固定回放；包含漏检样本',images});
const source=path.join(root,'runtime/replay/agent-four-types-20261031/group-16');const local=await read(source+'/local.json');
const semantic=await read(path.join(root,'runtime/replay/contract-evidence-20261102-v2/group-16/result.json'));
if(semantic.status!=='completed'||!semantic.items?.length)throw Error('actual_semantic_review_required');
semantic.materialAliases=Object.fromEntries(local.batch.materials.map((m,i)=>['m'+(i+1),m.id]));
const visualDir=path.join(root,'runtime/replay/complete-example-20261101');
const dda=await read(visualDir+'/mirror-report.json'),seed=await read(visualDir+'/seed-report.json');
const materials=[];
for(const [i,m] of local.batch.materials.entries()){
 const s=local.sources.find(s=>s.id===m.id),bytes=await readFile(s.path),sha=createHash('sha256').update(bytes).digest('hex');
 const d=dda.samples.find(v=>v.sample_id===m.id),t=seed.samples.find(v=>v.sample_id===m.id);
 if(sha!==s.sha256||[d,t].some(v=>v?.status!=='succeeded'||v.input_sha256!==sha))throw Error('example_visual_source_mismatch');
 const size=[m.pages[0].width,m.pages[0].height];
 if(JSON.stringify(size)!==JSON.stringify(d.stored_size)||JSON.stringify(size)!==JSON.stringify(t.oriented_size))throw Error('example_geometry_mismatch');
 const stages={mirror:{status:'completed',score:d.generated_score,provider:dda.provider,model:d.model,completedPages:1,totalPages:1},seed:{status:'completed',score:t.detector_score,provider:seed.provider,completedPages:1,totalPages:1},ocr:{status:'completed',completedPages:1,totalPages:1},rules:{status:'completed'},explanation:{status:'completed'}};
 materials.push({...m,name:`销售合同${i+1}.png`,status:'completed',checks:local.review.perMaterial.find(p=>p.materialId===m.id)?.checks||[],stages,
 pages:[{page:1,status:'completed',rendered_size:size,previewDataUrl:'data:image/png;base64,'+bytes.toString('base64'),regions:t.regions,stages}]});
}
const presentation=presentReview({materials,review:local.review,semanticReview:semantic});
await publish('documents.json',{example:true,status:'completed',materials,review:local.review,semanticReview:semantic,presentation,limitations:[]});
console.log('Saved real general-image and complete document examples; no API calls');

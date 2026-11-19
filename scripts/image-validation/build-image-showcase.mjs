// Rebuild the fixed frontend example from an existing verified run. No inference/API calls.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url));
const root=process.env.AIGC_PLATFORM_ROOT;if(!root)throw new Error('AIGC_PLATFORM_ROOT required');
const run=process.env.IMAGE_SHOWCASE_RUN||path.join(root,'runtime/replay/full-image-features-20261103');
const result=JSON.parse(await readFile(path.join(run,'results.json'),'utf8')).find(x=>x.id==='visual-8');
const source=JSON.parse(await readFile(path.join(run,'manifest.json'),'utf8')).find(x=>x.id===result.id);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
if(source.label!==1||result.status!=='completed'||result.verdict!=='likely_ai'||result.sensitivity.status!=='completed'||result.spatial?.status!=='completed')throw new Error('unexpected_showcase_result');
if(digest(await readFile(source.path))!==result.diagnostics.sha256)throw new Error('source_hash_mismatch');
const target=path.join(project,'public/image-examples/watch');await mkdir(target,{recursive:true});
const layers={},assets={};
for(const name of ['original','sensitivity','residual','aiFeatures']) {
 const uri=result.diagnostics.layers[name];if(!uri?.startsWith('data:image/png;base64,'))throw new Error('missing_layer');
 const bytes=Buffer.from(uri.split(',')[1],'base64');await writeFile(path.join(target,name+'.png'),bytes);
 layers[name]=`/public/image-examples/watch/${name}.png`;assets[name]=digest(bytes);
}
const showcase={title:'精密机械 · 腕表',score:result.score,verdict:result.verdict,
 diagnostics:{...result.diagnostics,layers},spatial:{status:result.spatial.status,windowCount:result.spatial.windowCount},sensitivity:{status:'completed',markedCount:result.sensitivity.markedCount}};
await writeFile(path.join(project,'src/modules/image/general/example.js'),'// Generated from a verified detection run; rebuild with build-image-showcase.mjs.\nexport const generalShowcase='+JSON.stringify(showcase,null,2)+';\n');
await writeFile(path.join(target,'provenance.json'),JSON.stringify({dataset:source.dataset,generator:source.generator,sampleId:source.sample_id,label:source.label,sourceSha256:result.diagnostics.sha256,score:result.score,model:result.model,sensitivity:result.sensitivity,spatial:result.spatial,assets},null,2)+'\n');
console.log('Exported verified watch example with full-image feature distribution.');

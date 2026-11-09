// Export only measured outputs; original and portrait examples retain separate hashes.
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const project=fileURLToPath(new URL('../../',import.meta.url));
const root=process.env.AIGC_PLATFORM_ROOT;if(!root)throw Error('AIGC_PLATFORM_ROOT required');
const run=process.env.IMAGE_SHOWCASE_RUN||path.join(root,'runtime/research/ui-revision-20261106');
const result=JSON.parse(await readFile(path.join(run,'results.json'),'utf8')).find(r=>r.id==='doubao-2');
const source=JSON.parse(await readFile(path.join(run,'manifest.json'),'utf8')).find(r=>r.id==='doubao-2');
const portrait=JSON.parse(await readFile(path.join(run,'face.json'),'utf8'));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
if(result?.status!=='completed'||result.spatial?.status!=='completed'||result.forensics?.tamper?.status!=='completed'||portrait.face?.status!=='completed')throw Error('incomplete_detection');
if(hash(await readFile(source.path))!==result.diagnostics.sha256||hash(await readFile(portrait.sourcePath))!==portrait.sourceSha256)throw Error('source_hash_mismatch');
const target=path.join(project,'public/image-examples/doubao');await mkdir(target,{recursive:true});
const assets={};
async function asset(name,uri){if(!/^data:image\/png;base64,/.test(uri))throw Error('invalid_image_asset');const bytes=Buffer.from(uri.split(',')[1],'base64');await writeFile(path.join(target,name+'.png'),bytes);assets[name+'.png']=hash(bytes);return '/public/image-examples/doubao/'+name+'.png';}
const layers={};for(const [name,uri] of Object.entries(result.diagnostics.layers))layers[name]=await asset(name,uri);
await copyFile(source.path,path.join(target,'original.jpg'));assets['original.jpg']=result.diagnostics.sha256;layers.original='/public/image-examples/doubao/original.jpg';
const forensics=structuredClone(result.forensics);forensics.face=structuredClone(portrait.face);forensics.face.exampleTitle='伪造人像示例';
forensics.face.preview=await asset('face-preview',portrait.face.preview);
for(const key of ['preview','overlay','anomalyMap','confidenceMap'])forensics.tamper[key]=await asset('tamper-'+key,forensics.tamper[key]);
const showcase={title:'林间暖阳 · 豆包2',score:result.score,verdict:result.verdict,diagnostics:{...result.diagnostics,layers},forensics,spatial:{status:result.spatial.status,windowCount:result.spatial.windowCount},sensitivity:{status:result.sensitivity.status,markedCount:result.sensitivity.markedCount}};
await writeFile(path.join(project,'src/modules/image/general/example.js'),'// Measured user-supplied examples. Rebuild with build-user-image-showcase.mjs.\nexport const generalShowcase='+JSON.stringify(showcase,null,2)+';\n');
await writeFile(path.join(target,'provenance.json'),JSON.stringify({source:'User supplied Doubao 2',sourceSha256:result.diagnostics.sha256,portraitSource:portrait.sourceName||'User supplied portrait',portraitSha256:portrait.sourceSha256,score:result.score,model:result.model,spatial:result.spatial,face: {...portrait.face,preview:undefined},tamper:{score:result.forensics.tamper.score,threshold:result.forensics.tamper.threshold},assets},null,2)+'\n');
console.log('Exported Doubao 2 full-image showcase with independent measured portrait.');

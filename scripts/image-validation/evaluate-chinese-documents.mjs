// Reproducible local validation against downloaded source manifest and real OCR.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {extractOcrMaterial} from '../../src/modules/image/documents/server/ocr-fields.js';
import {evaluateBatch,fingerprint,validateBatch} from '../../src/modules/image/documents/server/batch-engine.js';
const [directory,output]=process.argv.slice(2);
if(!directory||!output)throw new Error('Usage: node evaluate-chinese-documents.mjs research-directory output.json');
const root=resolve(directory),sources=JSON.parse(await readFile(join(root,'sources.json'),'utf8'));
const report={purpose:'public_chinese_document_diagnostic_not_accuracy_benchmark',externalVerification:'not_run',overallAuthenticity:null,documents:[]};
for(const source of sources) {
 if(source.error){report.documents.push({id:source.id,status:'download_failed',reason:source.error});continue;}
 const actual=createHash('sha256').update(await readFile(source.path)).digest('hex');
 if(actual!==source.sha256)throw new Error('Downloaded source changed');
 const manifest=JSON.parse(await readFile(join(root,source.id,'pages/manifest.json'),'utf8'));
 const ocr=JSON.parse(await readFile(join(root,source.id,'ocr.json'),'utf8'));
 if(manifest.file_sha256!==source.sha256)throw new Error('PDF hash mismatch');
 const document={id:source.id,source,status:manifest.status,ocrFingerprint:fingerprint(ocr),pages:[]};
 for(const page of manifest.pages) {
  const sample=ocr.samples.find(s=>s.sample_id===`pdf-page-${page.page}`);
  if(page.status!=='succeeded'||sample?.status!=='succeeded'){document.pages.push({page:page.page,status:'not_evaluated',reason:sample?.error??page.status});continue;}
  if(sample.input_sha256!==page.rendered_sha256||JSON.stringify(sample.oriented_size)!==JSON.stringify(page.rendered_size))throw new Error('Rendered OCR page mismatch');
  const type=source.id==='official-blank'?'invoice':'digital_invoice';
  const extracted=extractOcrMaterial({...sample,model_asset_sha256:ocr.model_asset_sha256},{id:`${source.id}-page-${page.page}`,type});
  const m=extracted.material;
  m.fileSha256=source.sha256;m.pages[0].number=page.page;
  for(const f of m.fields) {f.source.fileSha256=source.sha256;f.source.page=page.page;f.source.renderedSha256=page.rendered_sha256;f.source.pixelToPdf=page.pixel_to_pdf;f.source.coordinateSpace='rendered_page_pixels';}
  const batch={id:m.id,version:1,materials:[m]};validateBatch(batch);
  document.pages.push({page:page.page,status:'evaluated',regions:sample.regions.length,seconds:sample.seconds,extraction:extracted,result:evaluateBatch(batch)});
 }
 report.documents.push(document);
}
report.summary={documentsDownloaded:report.documents.filter(d=>d.status!=='download_failed').length,pagesEvaluated:report.documents.flatMap(d=>d.pages??[]).filter(p=>p.status==='evaluated').length};
const checks=report.documents.flatMap(d=>(d.pages??[]).flatMap(p=>p.result?.checks??[]));
const materials=report.documents.flatMap(d=>(d.pages??[]).filter(p=>p.extraction&&d.id!=='official-blank').map(p=>p.extraction.material));
if(materials.length)report.unconfirmedCrossMaterialBatch=evaluateBatch({id:'public-chinese-diagnostic',version:1,materials});
report.summary.fields=materials.reduce((n,m)=>n+m.fields.length,0);
report.summary.crossCandidates=report.unconfirmedCrossMaterialBatch?.candidates.length??0;
report.summary.checks=Object.fromEntries(['PASS','FAIL','NEI','NOT_APPLICABLE'].map(s=>[s,checks.filter(c=>c.status===s).length]));
await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary));

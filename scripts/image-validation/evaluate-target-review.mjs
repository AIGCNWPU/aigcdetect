// New report only; preserved source OCR and source images are read, never rewritten.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {extractOcrMaterial} from '../../src/modules/image/documents/server/ocr-fields.js';
import {evaluateReview} from '../../src/modules/image/documents/server/review-plan.js';
const [rootArg,outputArg]=process.argv.slice(2);
if(!rootArg||!outputArg)throw new Error('Usage: node evaluate-target-review.mjs AIGC_PLATFORM_ROOT new-output-directory');
const root=resolve(rootArg),project=join(root,'project'),output=resolve(outputArg);
if(!output.startsWith(root+'/'))throw new Error('Output must stay inside platform root');
await mkdir(output,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
const load=async path=>JSON.parse(await readFile(path,'utf8'));
const report={protocolVersion:'target-review-development/0.1',engineVersion:'core-material-review/0.1',purpose:'development_rule_scope_and_evidence_diagnostic',evaluatedAt:new Date().toISOString(),externalApiCalls:0,newModelRuns:0,ocrMode:'cached_real_ocr_with_original_image_hash_validation',independentHoldout:{evaluated:0,reason:'all_existing_samples_already_used_in_prior_development_or_model_diagnostics; freeze_new_sources_before_tuning'},samples:[],controlledCases:[]};
const entries=[];
for(const id of ['procurement-food','procurement-equipment','official-blank']) {
 const path=join(project,'tmp/image-workspace/chinese-validation-v1',id,'ocr.json'),ocr=await load(path);
 for(const s of ocr.samples)entries.push({sample:s,ocr,path,jurisdiction:'CN',dataset:id,type:id==='official-blank'?'invoice':'digital_invoice',image:join(project,'tmp/image-workspace/chinese-validation-v1',id,'pages',`page-${String(Number(s.sample_id.split('-').at(-1))).padStart(4,'0')}.png`),inferenceHost:'source_server_preserved_ocr',license:'public_official_documents_no_dataset_redistribution_license_asserted'});
}
const cordPath=join(project,'tmp/image-workspace/evaluation-20261021/cord/ocr-results.json'),cord=await load(cordPath);
for(const s of cord.samples.slice(0,5))entries.push({sample:s,ocr:cord,path:cordPath,jurisdiction:'ID',dataset:'CORD-v2-official-test-development-reuse',type:'receipt',image:join(project,'tmp/image-workspace/evaluation-20261021/cord',`test-${s.sample_id.split('-').at(-1)}.png`),inferenceHost:'source_server_preserved_ocr',license:'CC-BY-4.0; naver-clova-ix/cord-v2, revision 7f0115a4b758a71d6473b8d085751692da2fef98'});
const newPath=join(root,'runtime/replay/acceptance-20261022/ocr-headless-results.json'),newOcr=await load(newPath);
const newSample=newOcr.samples.find(s=>s.input_path.includes('procurement-equipment'));
if(newSample)entries.push({sample:newSample,ocr:newOcr,path:newPath,jurisdiction:'CN',dataset:'procurement-equipment-page1-new-host-repeat',type:'digital_invoice',image:newSample.input_path,inferenceHost:'target_server_20261022',license:'public_official_document_no_dataset_redistribution_license_asserted'});
for(const [i,entry] of entries.entries()) {
 const {sample,ocr}=entry;
 if(sample.status!=='succeeded'){report.samples.push({dataset:entry.dataset,status:'ocr_failed'});continue;}
 const actualHash=hash(await readFile(entry.image));if(actualHash!==sample.input_sha256)throw new Error('Image hash does not match OCR source');
 const extracted=extractOcrMaterial({...sample,model_asset_sha256:ocr.model_asset_sha256},{id:`sample-${i}`,type:entry.type});
 extracted.material.jurisdiction=entry.jurisdiction;
 const batch={id:`review-${i}`,version:1,materials:[extracted.material]},options={coreMaterialId:extracted.material.id,role:'company',objective:'invoice_review',jurisdiction:entry.jurisdiction};
 const result=evaluateReview(batch,options);
 report.samples.push({sampleId:sample.sample_id,dataset:entry.dataset,usage:'development_diagnostic',license:entry.license,image:entry.image,imageSha256:actualHash,ocrSource:entry.path,ocrSha256:hash(await readFile(entry.path)),inferenceHost:entry.inferenceHost,fieldCount:extracted.material.fields.length,extraction:extracted,result});
 if(entry.dataset==='procurement-equipment-page1-new-host-repeat') {
  const altered=structuredClone(batch),f=altered.materials[0].fields.find(f=>f.key==='gross_amount');
  if(f) {
   f.value=String(Number(f.value)+1);f.version++;altered.materials[0].version++;altered.version++;
   report.controlledCases.push({kind:'synthetic_field_perturbation_not_image_tampering',description:'Only extracted gross amount plus CNY 1; original OCR text and image unchanged',result:evaluateReview(altered,options)});
  }
 }
}
const checks=report.samples.flatMap(s=>s.result?.checks??[]);
report.summary={sampleRuns:report.samples.length,uniqueImageCount:new Set(report.samples.map(s=>s.imageSha256)).size,extractedFields:report.samples.reduce((n,s)=>n+(s.fieldCount??0),0),checkCounts:Object.fromEntries(['PASS','FAIL','NEI','NOT_APPLICABLE','ERROR'].map(status=>[status,checks.filter(c=>c.status===status).length])),indonesianChineseFormatChecks:report.samples.filter(s=>s.dataset.startsWith('CORD')).flatMap(s=>s.result.checks).filter(c=>c.rule==='invoice_number_format'||c.rule==='identity_structure').length,controlledFailureRules:report.controlledCases.flatMap(c=>c.result.checks.filter(r=>r.status==='FAIL').map(r=>r.rule)),accuracyMetrics:null};
await writeFile(join(output,'rules-experiment.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
await writeFile(join(output,'rules-summary.json'),JSON.stringify(report.summary,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(report.summary));

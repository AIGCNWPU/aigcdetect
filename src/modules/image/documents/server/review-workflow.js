import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { executeStage, runLocal, python } from './local-runtime.js';
import { extractOcrMaterial } from './ocr-fields.js';
import { extractDocxFields } from './docx-fields.js';
import { evaluateReview, buildUserConfirmedRelations } from './review-plan.js';
import {assessExecution} from './execution-assessment.js';
import {presentReview} from './review-presentation.js';
import {buildSemanticPackage,runSemanticReview} from './semantic-review.js';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const unavailable=reason=>({status:'not_run',reason});
function stageSummary(pages,stage) {
  const values=pages.map(p=>p.stages?.[stage]).filter(Boolean);
  if(!values.length)return unavailable('no_rendered_page');
  const succeeded=values.filter(v=>v.status==='completed');
  return {status:succeeded.length===values.length?'completed':succeeded.length?'partial':values.every(v=>v.status==='not_run')?'not_run':'failed',
    ...(succeeded.some(v=>Number.isFinite(v.score))?{score:Math.max(...succeeded.filter(v=>Number.isFinite(v.score)).map(v=>v.score)),scoreSemantics:'uncalibrated_model_score'}:{}),
    completedPages:succeeded.length,totalPages:values.length};
}

export async function runReview(payload,outputDir,update=()=>{},adapters={}) {
  const stage=adapters.executeStage || executeStage;
  const local=adapters.runLocal || runLocal;
  const materials=[], rows=[], pageIndex=new Map();
  const internal=[];
  update({phase:'parsing'});
  for(const [i,file] of payload.files.entries()) {
    const dir=path.join(outputDir,`material-${i+1}`);await mkdir(dir,{mode:0o700});
    const ext=path.extname(file.name).toLowerCase();const original=path.join(dir,`original${ext}`);
    const bytes=Buffer.from(file.contentBase64,'base64');await writeFile(original,bytes,{flag:'wx',mode:0o600});
    const hash=sha256(bytes), parsedDir=path.join(dir,'parsed');
    let parsed;
    try {
      await local(python('ocr-runtime'),['scripts/image-validation/parse_material.py','--input',original,'--output-dir',parsedDir,'--material-id',file.id,'--max-pages','20',...(payload.options?.renderWord===false?[]:['--render-docx'])],{log:path.join(dir,'parse.log'),timeout:180000});
      parsed=JSON.parse(await readFile(path.join(parsedDir,'material.json'),'utf8'));
      if(parsed.file_sha256!==hash||parsed.material_id!==file.id)throw new Error('parsed_source_mismatch');
    } catch {parsed={status:'failed',error:'parse_failed',pages:[],blocks:[],coverage:{}};}
    const material={id:file.id,name:file.name,type:file.materialType||'unknown',version:1,fileSha256:hash,
      status:parsed.status,kind:parsed.kind,coverage:parsed.coverage,warnings:parsed.warnings||[],error:parsed.error,
      pages:[],fields:[],checks:[],textBlocks:[],stages:{explanation:unavailable('not_requested')}};
    const item={id:file.id,type:material.type,version:1,fileSha256:hash,jurisdiction:payload.jurisdiction,pages:[],fields:[],textBlocks:[]};
    // Parsed DOCX text remains separate from rendered OCR to avoid merging conflicting sources.
    if(parsed.kind==='docx'&&parsed.blocks?.length&&!parsed.pages?.some(p=>p.status==='completed')) {
      item.representation='docx_text';item.fields=extractDocxFields(parsed,item);
      material.textBlocks=parsed.blocks.slice(0,200).map((b,i)=>({...b,id:b.id||`block-${i+1}`,confidence:1,source:{provider:'docx_xml',fileSha256:hash,location:b.source_location}}));material.fields=item.fields;
      item.textBlocks=material.textBlocks;material.textCoverage={truncated:parsed.blocks.length>200};
    }
    for(const p of parsed.pages||[]) {
      const page={page:p.page,status:p.status,rendered_size:p.rendered_size,source_location:p.source_location,
        geometry:p.geometry,pixel_to_pdf:p.pixel_to_pdf,stages:{}};
      material.pages.push(page);
      const usable=p.status==='completed'&&p.rendered_file&&rows.length<20;
      const size=p.rendered_size||[];
      item.pages.push({number:p.page,status:usable?'succeeded':p.status==='completed'?'resource_limit':'failed',width:size[0],height:size[1]});
      if(!usable){if(p.status==='completed'){page.status='resource_limit';material.status='partial';}continue;}
      const imagePath=path.resolve(parsedDir,p.rendered_file);
      if(!imagePath.startsWith(parsedDir+path.sep))throw new Error('invalid_render_path');
      const sampleId=`m${i+1}-p${p.page}`;
      const renderedSha256=sha256(await readFile(imagePath));
      if(p.rendered_sha256&&p.rendered_sha256!==renderedSha256)throw new Error('rendered_source_mismatch');
      rows.push({sample_id:sampleId,material_id:file.id,page:p.page,path:imagePath,expected_sha256:renderedSha256});
      pageIndex.set(sampleId,{material,item,page,renderedSha256});
      // A bounded local thumbnail, not an external image URL.
      try {
        const thumb=path.join(dir,`preview-${p.page}.jpg`);
        await local(python('ocr-runtime'),['-c','from PIL import Image;import sys; im=Image.open(sys.argv[1]).convert("RGB");im.thumbnail((1000,1000));im.save(sys.argv[2],quality=78)',imagePath,thumb],{timeout:15000});
        page.previewDataUrl='data:image/jpeg;base64,'+(await readFile(thumb)).toString('base64');
      } catch {page.previewUnavailable=true;}
    }
    if(!item.pages.length&&item.representation!=='docx_text')item.pages=[{number:1,status:'not_run'}];
    internal.push(item);materials.push(material);update({materials});
  }
  const manifest=path.join(outputDir,'pages.json');await writeFile(manifest,JSON.stringify(rows,null,2),{flag:'wx',mode:0o600});
  for(const name of ['mirror','seed','ocr']) {
    update({phase:name,materials});
    if(!rows.length)continue;
    if(name!=='ocr'&&payload.options?.runModels===false) {
      for(const {page} of pageIndex.values())page.stages[name]=unavailable('user_disabled');
      continue;
    }
    let report;
    try {report=await stage(name,manifest,path.join(outputDir,name));}
    catch(error){report={samples:[],stageError:['no_idle_gpu','stage_timeout','local_runtime_missing'].includes(error.message)?error.message:'stage_failed'};}
    const samples=new Map((report.samples||[]).map(s=>[s.sample_id,s]));
    for(const [id,{page,item,material,renderedSha256}] of pageIndex) {
      const sample=samples.get(id);
      if(sample?.status!=='succeeded'){page.stages[name]={status:'failed',reason:report.stageError||'page_analysis_failed'};continue;}
      if(sample.input_sha256!==renderedSha256){page.stages[name]={status:'failed',reason:'analysis_source_mismatch'};continue;}
      const analyzedSize=name==='mirror'?sample.stored_size:sample.oriented_size;
      if(!Array.isArray(analyzedSize)||analyzedSize.length!==2||analyzedSize.some((v,i)=>v!==page.rendered_size[i])) {
        page.stages[name]={status:'failed',reason:'analysis_geometry_mismatch'};continue;
      }
      page.stages[name]={status:'completed',provider:report.provider,modelVersion:report.source_revision||report.source_commit||report.versions,
        ...(name==='mirror'?{score:sample.generated_score}:name==='seed'?{score:sample.detector_score}:{})};
      if(name==='seed'){page.regions=sample.regions||[];page.stages.seed.threshold=report.threshold;}
      if(name==='ocr') {
        try {
          const extracted=extractOcrMaterial({...sample,model_asset_sha256:report.model_asset_sha256},{id:item.id,type:item.type});
          if(item.type==='unknown'&&extracted.classification){item.type=extracted.material.type;material.type=extracted.material.type;material.classification=extracted.classification;}
          if(extracted.material.contentFormat?.status==='matched'){
            item.contentFormat=extracted.material.contentFormat;material.contentFormat=extracted.material.contentFormat;
            if(extracted.material.invoiceSubtype)item.invoiceSubtype=extracted.material.invoiceSubtype;
            // A multi-page line set cannot inherit a single page's completeness.
            item.contentExtraction={...extracted.material.contentExtraction,lineItemsComplete:material.pages.length===1&&extracted.material.contentExtraction?.lineItemsComplete===true};
          }
          for(const field of extracted.material.fields) {
            field.id=`p${page.page}-${field.id}`;
            if(field.taxScope)field.taxScope=`page-${page.page}:${field.taxScope}`;
            field.source={...field.source,page:page.page,fileSha256:item.fileSha256,renderedSha256:sample.input_sha256,parentVersion:item.version,
              pixelToPdf:page.pixel_to_pdf,geometry:page.geometry};
            item.fields.push(field);
          }
          const remaining=2000-material.textBlocks.length;
          const sourceBlocks=sample.regions.filter(r=>r.observed_text?.trim());
          material.textBlocks.push(...sourceBlocks.slice(0,Math.max(0,remaining)).map(r=>({id:`p${page.page}-${r.region_id}`,text:r.observed_text,page:page.page,confidence:r.recognition_confidence,
            source:{provider:'ocr',fileSha256:item.fileSha256,renderedSha256:sample.input_sha256,page:page.page,polygon:r.polygon}})));
          item.textBlocks=material.textBlocks;
          material.textCoverage={truncated:material.textCoverage?.truncated||sourceBlocks.length>remaining};
          page.extractionCoverage=extracted.coverage;page.ocrReview=extracted.review;
        } catch {page.stages.ocr={status:'failed',reason:'field_evidence_invalid'};}
        material.fields=item.fields;
      }
    }
    for(const material of materials)for(const key of ['mirror','seed','ocr'])material.stages[key]=stageSummary(material.pages,key);
    update({materials});
  }
  // Duplicate keys across separate pages are not silently collapsed into one document.
  for(const item of internal) {
    const counts=new Map();
    for(const f of item.fields)counts.set(`${f.role}:${f.key}:${f.taxScope||''}`,(counts.get(`${f.role}:${f.key}:${f.taxScope||''}`)||0)+1);
    for(const f of item.fields)if(counts.get(`${f.role}:${f.key}:${f.taxScope||''}`)>1)f.extractionAmbiguous=true;
  }
  update({phase:'rules',materials});
  const batch={id:path.basename(outputDir),version:1,materials:internal};
  // Only explicit user assertions become context, with an auditable local-user label.
  const confirmed={batchId:batch.id,batchVersion:batch.version,relations:[]},unresolvedConfirmations=[];
  for(const confirmation of payload.confirmations||[]) {
    try {confirmed.relations.push(...buildUserConfirmedRelations(batch,{coreMaterialId:payload.coreMaterialId,confirmations:[confirmation]}).relations);}
    catch {unresolvedConfirmations.push({materialId:confirmation.materialId,status:'NEI',reason:'confirmation_role_or_evidence_unavailable'});}
  }
  confirmed.relations=[...new Map(confirmed.relations.map(r=>[r.id,r])).values()];
  const review=evaluateReview(batch,{coreMaterialId:payload.coreMaterialId,objective:payload.objective,
    jurisdiction:payload.jurisdiction,...confirmed});
  review.unresolvedConfirmations=unresolvedConfirmations;
  const context={region:payload.context?.region||'unspecified',businessDate:payload.context?.businessDate};
  review.executionAssessment=assessExecution({batch,review,materials,context});
  for(const material of materials) {
    material.checks=(review.checks||[]).filter(c=>c.materialId===material.id||c.evidence?.some(e=>e.materialId===material.id));
    for(const key of ['mirror','seed','ocr'])material.stages[key]??=stageSummary(material.pages,key);
    material.stages.rules={status:'completed',scope:'configured_local_rules_only'};
    if(material.status!=='failed'&&(['mirror','seed','ocr'].some(k=>material.stages[k].status!=='completed')||!material.fields.length))material.status='partial';
  }
  update({phase:'semantic_review',materials});
  let semanticReview;
  try {
    const pkg=buildSemanticPackage({batch,review,materials,objective:payload.objective,privacyMode:payload.options?.privacyMode||'redacted',context});
    semanticReview=await runSemanticReview(pkg,{enabled:payload.options?.semanticReview===true,outputDir:path.join(outputDir,'semantic'),sender:adapters.semanticSender,agentSdk:adapters.reviewAgentSdk});
    semanticReview.losses??=pkg.losses||[];semanticReview.omitted??=pkg.omitted||[];
    await writeFile(path.join(outputDir,'semantic-request.json'),JSON.stringify(pkg,null,2),{flag:'wx',mode:0o600});
  } catch {semanticReview={status:'failed',reason:'semantic_preparation_failed',items:[],privacyMode:payload.options?.privacyMode||'redacted'};}
  for(const material of materials) {
    const pending=review.executionAssessment.items.filter(i=>i.route==='semantic'&&i.materialIds.includes(material.id));
    const answered=new Set((semanticReview.items||[]).map(i=>i.assessmentId));
    material.stages.explanation=!pending.length?unavailable('no_pending_items'):{status:['succeeded','completed'].includes(semanticReview.status)?pending.every(i=>answered.has(i.id))?'completed':'partial':semanticReview.status==='failed'?'failed':'not_run',reason:semanticReview.reason};
  }
  const presentation=presentReview({materials,review,semanticReview});
  const result={status:materials.every(m=>m.status==='completed')?'completed':'partial',phase:'finished',materials,review,semanticReview,presentation,
    limitations:['本地开发工作台；公共登录、权限和长期存储尚未接入。','核验仅覆盖已提取字段和已配置规则；不等于税务查验或身份真实性核验。',
      '多页材料未自动判定同一主体；重复字段需复核。','显示标识候选仅核对可见内容差异；用户确认和官方身份/交易核验分别记录。']};
  await writeFile(path.join(outputDir,'batch.json'),JSON.stringify(batch,null,2),{flag:'wx',mode:0o600});
  await writeFile(path.join(outputDir,'result.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
  update(result);return result;
}

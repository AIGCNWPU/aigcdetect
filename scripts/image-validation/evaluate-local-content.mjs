/** Frozen Chinese OCR replay. No annotation enters extraction or rule execution.
 * This is dataset-driven development regression, never an independent accuracy estimate.
 * Usage: node scripts/image-validation/evaluate-local-content.mjs PLATFORM_ROOT NEW_OUTPUT_DIR
 */
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {extractOcrMaterial} from '../../src/modules/image/documents/server/ocr-fields.js';
import {evaluateReview} from '../../src/modules/image/documents/server/review-plan.js';
import {assessExecution,ruleTitle} from '../../src/modules/image/documents/server/execution-assessment.js';
import {presentReview} from '../../src/modules/image/documents/server/review-presentation.js';
const [rootArg,outputArg,extraOcrArg]=process.argv.slice(2);
if(!rootArg||!outputArg)throw new Error('Usage: evaluate-local-content.mjs PLATFORM_ROOT NEW_OUTPUT_DIR [EXTRA_OCR_JSON]');
const root=path.resolve(rootArg),output=path.resolve(outputArg),frozen=path.join(root,'runtime/replay/chinese-live-20261026');
if(!output.startsWith(path.join(root,'runtime')+path.sep)||output===frozen||output.startsWith(frozen+path.sep))throw new Error('Choose a NEW output directory inside runtime, outside frozen records');
let networkAttempts=0;globalThis.fetch=async()=>{networkAttempts++;throw new Error('External API/network calls are prohibited in this local evaluation');};
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=async(p,v)=>writeFile(p,typeof v==='string'?v:JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const md=s=>String(s??'').replace(/[|\n\r]/g,' ');
const formatTitle=m=>({tax_payment_certificate:'税收完税证明',account_commitment:'账户承诺函',legacy_vat_invoice:'增值税电子普通发票',household_register:'常住人口登记卡',purchase_contract:'购销合同',rental_contract:'房屋租赁合同'}[m.contentFormat?.kind]||m.contentFormat?.kind||m.contentFormat?.id||'尚未识别格式');
const reasonNames={missing_or_ambiguous_amounts:'不含税金额、税额或价税合计字段缺失或存在多个候选，未完成计算',institution_policy_not_configured:'没有配置适用单位制度，未进行制度核验',calendar_date_only:'仅验证日期在日历中存在',displayed_amount_arithmetic_only:'已对显示的不含税金额、税额、价税合计进行加法核对',no_supported_fields:'未提取出受支持的业务字段',legacy_invoice_subtype_not_confirmed:'尚未确认适用的旧版发票类型',engineering_rule_scope_only:'只确认工程场景适用，不代表审核通过',recognition_requires_review:'文字识别置信度未达到门槛，需要核对原图',recognition_quality:'文字识别质量待确认',same_identifier_content_conflict:'相同标识下内容存在差异，需要结合版本和业务背景复核'};
const reasonText=c=>{const text=c.explanation||c.message||reasonNames[c.reason]||`原因码：${c.reason||'未提供'}（详细计算及证据见原始JSON）`;return text+(c.calculation?.expectedAmount!=null?`；计算应为${c.calculation.expectedAmount}，材料显示${c.calculation.actualAmount}`:'');};
// Fixed developer checklist: author labels and separately identified arithmetic facts.
// This map is consumed ONLY AFTER evaluateReview has returned. Never supplied to rules.
const checklist={
  0:[['纳税机关不同',['issuing_authority','tax_authority']],['纳税人名称不同',['name','taxpayer_name']],['纳税人识别号不同',['tax_identifier','taxpayer_number','taxpayer_id']],['填发日期不同',['issue_date','certificate_date']],['税种不同',['tax_category','tax_type']],['税款所属时期不同',['tax_period']],['入退库日期不同',['treasury_date','payment_date']]],
  1:[['相同身份下账户集合不同',['account','account_list','alipay_accounts','email','alipay_account']]],
  34:[['同票标识下开票日期不同',['invoice_date']],['购买方名称不同',['buyer','buyer_name','name']],['商品服务不同',['item_description','item_name','goods_name','service_name','line_item','goods']],['不含税金额不同',['net_amount']],['价税合计不同',['gross_amount']]],
  43:[['相同身份号码对应姓名不同',['name']]],
  72:[['相同订单号下交易日期不同',['transaction_date','order_date','contract_date']],['付款方不同',['name','payer','payer_name','buyer','buyer_name']],['合计金额不同',['contract_total','contract_amount','gross_amount','total_amount']]],
  74:[['相同承租人身份号码对应姓名不同',['name','tenant_name']]],
};
const objectives={0:'identity_consistency',1:'identity_consistency',34:'invoice_review',43:'identity_consistency',72:'procurement_review',74:'procurement_review'};
const [manifest,groups,ocr]=await Promise.all([load(path.join(frozen,'ocr-manifest.json')),load(path.join(frozen,'groups.json')),load(path.join(frozen,'ocr.json'))]);
let extraManifestPath=null,extraOcrPath=null;
if(extraOcrArg){
 extraOcrPath=path.resolve(extraOcrArg);extraManifestPath=path.join(path.dirname(extraOcrPath),'extra-ocr-manifest.json');
 const [additional,extra]=await Promise.all([load(extraManifestPath),load(extraOcrPath)]);
 if(additional.length!==4||extra.samples?.length!==4)throw new Error('Supplement must contain all four frozen tax-certificate images');
 for(const row of additional){if(row.group_id!==0||manifest.some(x=>x.sample_id===row.sample_id))throw new Error('Supplement group/id mismatch');manifest.push(row);groups.find(x=>x.group_id===0).sample_ids.push(row.sample_id);}
 for(const sample of extra.samples)ocr.samples.push(sample);
 if(JSON.stringify(extra.model_asset_sha256)!==JSON.stringify(ocr.model_asset_sha256))throw new Error('Supplement OCR assets differ; do not silently merge');
}
await mkdir(path.dirname(output),{recursive:true,mode:0o700});
await mkdir(output,{recursive:false,mode:0o700});
const report={version:'local-content-regression/1.0',createdAt:new Date().toISOString(),scope:'Six frozen CrossCred groups (optional four real-OCR tax supplements); real original OCR reused; dataset-driven development, not a holdout',networkAttempts:0,apiCalls:0,modelCalls:0,simulatedProviderCalls:0,labelsInjectedIntoRules:false,independentHoldout:false,sourceArtifacts:{},groups:[]};
for(const filename of ['ocr-manifest.json','groups.json','ocr.json'])report.sourceArtifacts[filename]=sha(await readFile(path.join(frozen,filename)));
report.implementationSha256={};
for(const filename of ['ocr-fields.js','content-fields.js','content-rules.js','content-rule-catalog.json','batch-engine.js','document-rules.js','review-plan.js','execution-assessment.js','review-presentation.js','semantic-review.js'])report.implementationSha256[filename]=sha(await readFile(fileURLToPath(new URL('../../src/modules/image/documents/server/'+filename,import.meta.url))));
if(extraOcrPath){report.sourceArtifacts['extra-ocr.json']=sha(await readFile(extraOcrPath));report.sourceArtifacts['extra-ocr-manifest.json']=sha(await readFile(extraManifestPath));}
let sections='';
for(const group of groups){
 const id=group.group_id,slug=`group-${String(id).padStart(2,'0')}`,dir=path.join(output,slug);await mkdir(dir,{mode:0o700});
 const materials=[],extractions=[],inputs=[];
 for(const sampleId of group.sample_ids){
  const entry=manifest.find(x=>x.sample_id===sampleId),sample=ocr.samples.find(x=>x.sample_id===sampleId);
  if(!entry||sample?.status!=='succeeded')throw new Error(`Missing successful frozen OCR: ${sampleId}`);
  const image=await readFile(entry.path),digest=sha(image);
  if(digest!==entry.expected_sha256||digest!==sample.input_sha256)throw new Error(`Source image hash mismatch: ${sampleId}`);
  const extracted=extractOcrMaterial({...sample,model_asset_sha256:ocr.model_asset_sha256},{id:sampleId,type:entry.material_type});
  const material=extracted.material;
  material.textBlocks=sample.regions.map(r=>({id:r.region_id,text:r.observed_text,confidence:r.recognition_confidence,page:1,polygon:structuredClone(r.polygon)}));
  materials.push(material);extractions.push(extracted);
  const imageName=sampleId+path.extname(entry.path);await copyFile(entry.path,path.join(dir,imageName));
  const text=sample.regions.map(r=>`[${r.region_id}] OCR置信度=${r.recognition_confidence}\n${r.observed_text}\n坐标=${JSON.stringify(r.polygon)}`).join('\n\n');
  await save(path.join(dir,sampleId+'-ocr.txt'),text+'\n');
  inputs.push({id:sampleId,image:imageName,sha256:digest,ocrRegions:sample.regions.length,extraction:extracted});
 }
 // Native objective/core selection only. No author labels, relation confirmations or answers.
 const batch={id:`local-replay-${id}`,version:1,materials};
 const options={coreMaterialId:materials[0].id,objective:objectives[id],jurisdiction:'CN'};
 const review=evaluateReview(batch,options);review.executionAssessment=assessExecution({batch,review,materials});
 const semanticReview={status:'not_run',reason:'local_only_evaluation_no_model',items:[],losses:[]};
 const presentation=presentReview({materials,review,semanticReview});
 const baseline=await load(path.join(frozen,'semantic-live',`group-${id}-local.json`));
 const checks=[...(review.checks||[]),...(review.candidates||[])];
 const uniqueChecks=[...new Map(checks.map(c=>[JSON.stringify(c),c])).values()];
 const businessChecks=uniqueChecks.filter(c=>c.rule!=='scenario_applicability');
 const fields=materials.flatMap(m=>m.fields.map(f=>({materialId:m.id,...f})));
 const labelMatches=(checklist[id]||[]).map(([label,keys])=>{
   const hits=uniqueChecks.filter(c=>['FAIL','WARN','REVIEW','CONFLICT'].includes(c.status)&&typeof c.comparedKey==='string'&&keys.includes(c.comparedKey));
   const disputed=(id===34&&keys.includes('invoice_date'))||(id===0&&extraOcrPath&&(keys.includes('issue_date')||keys.includes('tax_type')));
   return {label,keys,applicability:disputed?'author_label_not_visible_in_complete_group_verified_20261026':'expected_difference_in_scope',status:disputed?'author_annotation_disputed_no_visible_difference':hits.length?'machine_candidate_requires_manual_confirmation':'not_matched_by_field_key',checks:hits.map(c=>({rule:c.rule,status:c.status,reason:c.reason,key:c.key,comparedKey:c.comparedKey,materialIds:c.materialIds,evidence:(c.evidence||[]).map(e=>({materialId:e.materialId,fieldId:e.fieldId,key:e.key,role:e.role}))})),assumption:id===1?'账户清单须完整且同口径才可将不同账户集合认定为违反承诺；仅差异为本地事实':id===34?'同票代码和号码且非有效更正/重开/版本差异，才进一步判定业务异常':'共享标识必须识别可信且角色相同；材料差异不等于确定造假'};
 });
 const baselineChecks=[...(baseline.review.checks||[]),...(baseline.review.candidates||[])];
 const summary={groupId:id,type:group.type,objective:options.objective,files:materials.length,baseline:{files:baseline.materials.length,fields:baseline.materials.reduce((s,m)=>s+m.fields,0),confirmedEdges:baseline.review.plan.edges.length,checks:Object.fromEntries(['PASS','FAIL','NEI'].map(s=>[s,baselineChecks.filter(c=>c.status===s).length]))},current:{fields:fields.length,original16Fields:fields.filter(f=>!/^cc-g00-[3-6]$/.test(f.materialId)).length,supplementFields:fields.filter(f=>/^cc-g00-[3-6]$/.test(f.materialId)).length,zeroFieldDocuments:materials.filter(m=>!m.fields.length).length,confirmedEdges:review.plan.edges.length,contentCandidates:review.plan.contentCandidates?.length||0,checks:Object.fromEntries(['PASS','FAIL','WARN','NEI','REVIEW','NOT_APPLICABLE'].map(s=>[s,businessChecks.filter(c=>c.status===s).length])),warnings:presentation.warnings?.length||0,execution:review.executionAssessment.counts},labelMatches,interpretation:'Checklist matches are heuristic pointers, not author-label accuracy. See manual assessment and raw evidence.'};
 await save(path.join(dir,'result.json'),{summary,batch,extractions,review,presentation,semanticReview});
 await save(path.join(dir,'publisher-label.json'),{dataset:'CrossCred',groupId:id,annotation:group.publisher_annotation,notUsedAsInput:true,labels:labelMatches});
 let markdown=`# 第${id}组本地核验\n\n${group.type}\n\n**本轮没有调用API，也没有调用本地大模型。** 重用已冻结真实OCR，重新执行当前提取和本地规则。\n\n目标：${options.objective}。本轮文件${materials.length}份，历史基线${summary.baseline.files}份。已确认关系${review.plan.edges.length}条；自动候选${review.plan.contentCandidates?.length||0}条。\n\n## 改进前后\n\n|项目|旧结果|本轮|\n|---|---:|---:|\n|业务字段|${summary.baseline.fields}|${summary.current.fields}|\n|明确本地FAIL|${summary.baseline.checks.FAIL}|${summary.current.checks.FAIL}|\n|用户问题提醒|未重新计算|${summary.current.warnings}|\n\n计数不等于正确率，场景接受也不等于业务审核通过。\n`;
 let html=`<section id="${slug}"><h2>第${id}组：${esc(group.type)}</h2><p>业务字段 ${summary.baseline.fields} → ${summary.current.fields}；本地FAIL ${summary.baseline.checks.FAIL} → ${summary.current.checks.FAIL}；用户提醒 ${summary.current.warnings}。</p><p><a href="${slug}/result.json">完整本地JSON</a> · <a href="${slug}/local-results.md">中文结果</a> · <a href="${slug}/publisher-label.json">作者标注与独立对照</a></p>`;
 for(const input of inputs){const m=input.extraction.material;
  markdown+=`\n## ${m.id}\n\n格式：${md(formatTitle(m))}；字段数${m.fields.length}；OCR文字块${input.ocrRegions}。\n\n|字段|角色|值|OCR置信度|\n|---|---|---|---:|\n`+m.fields.map(f=>`|${md(f.key)}|${md(f.role)}|${md(f.value)}|${f.confidence}|`).join('\n')+'\n';
  html+=`<details><summary>${esc(m.id)}：${esc(formatTitle(m))}，${m.fields.length}个字段，${input.ocrRegions}个OCR块</summary><img loading="lazy" src="${slug}/${esc(input.image)}" alt="原始数据集图片"><p><a href="${slug}/${m.id}-ocr.txt">完整OCR文字、置信度与坐标</a></p><table><tr><th>字段/角色</th><th>值</th><th>OCR置信度</th></tr>${m.fields.map(f=>`<tr><td>${esc(f.key)} / ${esc(f.role)}</td><td>${esc(f.value)}</td><td>${esc(f.confidence)}</td></tr>`).join('')}</table></details>`;
 }
 markdown+='\n## 单文件与跨文件逐项结果\n\n|检查|状态|含义与原因|\n|---|---|---|\n'+uniqueChecks.map(c=>`|${md(c.rule)}|${md(c.status)}|${md(reasonText(c))}；原码 ${md(c.reason)}|`).join('\n')+'\n';
 html+='<details open><summary>本地逐项检查</summary><table><tr><th>检查</th><th>状态</th><th>原因</th><th>证据</th></tr>'+uniqueChecks.map(c=>`<tr class="${esc(c.status)}"><td>${esc(ruleTitle(c.rule))}<br><code>${esc(c.rule)}</code></td><td>${esc(c.status)}</td><td>${esc(reasonText(c))}<br><code>${esc(c.reason)}</code></td><td>${esc((c.evidence||[]).map(e=>`${e.materialId}/${e.key||e.fieldId}: ${e.value??''}`).join('\n'))}</td></tr>`).join('')+'</table></details>';
 markdown+='\n## 对照作者标注\n\n此表只在规则执行结束后计算，未输入答案。自动匹配仅提供人工核对线索，不能直接当召回率。\n\n'+labelMatches.map(l=>`- ${l.label}：${l.status}；候选检查${l.checks.length}条。前提：${l.assumption}`).join('\n')+'\n';
 html+='<details><summary>作者期望与自动对照线索</summary><p>答案未输入规则。以下关键词匹配仅辅助人工复核，不作为准确率。</p><ul>'+labelMatches.map(l=>`<li>${esc(l.label)}：${esc(l.status)}，候选${l.checks.length}条。${esc(l.assumption)}</li>`).join('')+'</ul></details><details><summary>用户汇总输出</summary><pre>'+esc(JSON.stringify(presentation,null,2))+'</pre></details></section>';
 await save(path.join(dir,'local-results.md'),markdown);sections+=html;report.groups.push(summary);
 console.log(JSON.stringify({groupId:id,fields:summary.current.fields,checks:summary.current.checks,candidates:summary.current.contentCandidates,warnings:summary.current.warnings}));
}
report.networkAttempts=networkAttempts;
report.totals={files:report.groups.reduce((s,g)=>s+g.files,0),baselineFields:report.groups.reduce((s,g)=>s+g.baseline.fields,0),fields:report.groups.reduce((s,g)=>s+g.current.fields,0),original16Fields:report.groups.reduce((s,g)=>s+g.current.original16Fields,0),supplementFields:report.groups.reduce((s,g)=>s+g.current.supplementFields,0),zeroFieldDocuments:report.groups.reduce((s,g)=>s+g.current.zeroFieldDocuments,0),warnings:report.groups.reduce((s,g)=>s+g.current.warnings,0),FAIL:report.groups.reduce((s,g)=>s+g.current.checks.FAIL,0),contentCandidates:report.groups.reduce((s,g)=>s+g.current.contentCandidates,0)};
await save(path.join(output,'report.json'),report);
await save(path.join(output,'README.md'),`# 真实中文本地核验复跑\n\n[打开结果页面](index.html) · [机器结果](report.json)\n\n6组${report.totals.files}张原图，源图与OCR哈希逐一验证。${extraOcrPath?'完税证明扩展为作者完整6张，额外4张OCR单独冻结；旧baseline只有16张，本轮20张，字段总数增量同时包含样本扩展。':'本轮与旧baseline同为16张。'}原16张业务字段${report.totals.baselineFields} → ${report.totals.original16Fields}，追加4张字段${report.totals.supplementFields}，本轮总字段${report.totals.fields}；零字段文件${report.totals.zeroFieldDocuments}；本地FAIL ${report.totals.FAIL}条；候选关系${report.totals.contentCandidates}条。\n\n**API调用0次，模型调用0次，模拟提供者调用0次；网络尝试${networkAttempts}次。** 本轮展示真实本地规则执行结果。OCR结果沿用2026-10-26已冻结输出，未人工补写漏识文字或答案。\n\n这是基于同批数据集开发的回归，不能用于独立泛化准确率。作者标签只在执行后用于对照。账户不同等事实需与业务违规/造假结论区分。共享标识匹配产生候选，不冒充用户确认的关系。OCR置信度不是规则正确率或真实性概率。\n\n${report.groups.map(g=>`- [第${g.groupId}组](group-${String(g.groupId).padStart(2,'0')}/local-results.md)：${g.type}`).join('\n')}\n\n完整OCR和原图可能含个人信息，仅在本地核验目录查看。原实验文件保持不变。\n`);
await save(path.join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>中文材料本地规则核验</title><style>body{font:16px/1.65 system-ui,sans-serif;margin:auto;padding:24px;max-width:1280px;background:#f5f7fb;color:#172234}section{padding:20px;background:white;border-radius:12px;margin:24px 0}summary{cursor:pointer;font-weight:600;padding:12px 0}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #ccd4df;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}td{white-space:pre-line}.FAIL{background:#fff0ed}.NEI{background:#fffbe9}img{max-width:100%;max-height:900px;display:block}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{font-size:12px}a{color:#1757aa}</style><h1>中文材料本地规则核验</h1><p>真实冻结OCR复跑，API与模型调用均为0。原16张字段${report.totals.baselineFields} → ${report.totals.original16Fields}；新增样本字段${report.totals.supplementFields}；本轮总字段${report.totals.fields}；本地FAIL ${report.totals.FAIL}条；用户提醒${report.totals.warnings}条。</p><p>这是开发回归，不代表独立准确率。作者答案未输入规则。共享标识差异需结合版本、角色和业务前提复核；OCR置信度不是鉴伪概率。</p><nav>${report.groups.map(g=>`<a href="#group-${String(g.groupId).padStart(2,'0')}">第${g.groupId}组</a>`).join(' | ')}</nav>${sections}</html>`);
if(networkAttempts!==0)throw new Error('Unexpected network attempt');
console.log(JSON.stringify({output,totals:report.totals,apiCalls:0,modelCalls:0,networkAttempts}));

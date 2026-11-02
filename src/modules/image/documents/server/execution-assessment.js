import {CONTENT_RULE_NAMES} from './content-rules.js';
export const ASSESSMENT_VERSION='local-review-routing/0.2';
const names={invoice_net_tax_gross:'价税金额核对',amount_words_numeric:'大小写金额核对',displayed_tax_rate:'税率与税额核对',displayed_date_interval:'起止日期核对',displayed_calendar_date:'日期有效性',identity_structure:'身份号码校验',identity_birth_date:'出生日期核对',identity_gender:'性别核对',invoice_number_format:'发票号码格式',invoice_number_year:'发票年份核对',invoice_code_format:'发票代码格式',field_comparison:'关联材料内容核对',settlement_sum:'收付款合计',invoice_set_sum:'票据集合合计',institution_policy:'适用审核制度',identity_historical_region:'历史行政区划依据',field_extraction_coverage:'材料信息完整性',scenario_applicability:'核验目标适用性',jurisdiction_specific_rules:'地区规则覆盖',core_relationship_coverage:'材料关联信息',aggregate_selection:'汇总范围'};
export const ruleTitle=rule=>names[rule]||CONTENT_RULE_NAMES[rule]||'材料内容核对';
const quality=ref=>typeof ref.confidence==='number'&&ref.confidence>=.9&&ref.source&&typeof ref.source.observedText==='string';
const policyRules=new Set(['institution_policy','identity_historical_region','jurisdiction_specific_rules']);
const unique=x=>[...new Set(x.filter(Boolean))];

/** Grades describe execution sufficiency, not calibrated correctness or authenticity. */
export function assessExecution({batch,review,materials=[],context={}}) {
  const items=[],core=review.plan.coreMaterialId;
  for(const [i,check] of [...review.checks,...review.candidates].entries()) {
    if(check.rule==='scenario_applicability'&&check.status==='PASS')continue;
    if(check.rule==='institution_policy'&&!['procurement_review','research_reimbursement'].includes(review.plan.objective))continue;
    const refs=check.evidence||[];
    const missing=refs.length===0,recognition=refs.length>0&&refs.every(quality)&&!refs.some(ref=>batch.materials.find(m=>m.id===ref.materialId)?.fields.find(f=>f.id===ref.fieldId)?.extractionAmbiguous);
    let grade='C',route='supplement';
    if(['PASS','FAIL','WARN'].includes(check.status)&&recognition) {grade='A';route='local';}
    else if(check.status==='NOT_APPLICABLE') {grade='D';route='unsupported';}
    else if(policyRules.has(check.rule)||/not_configured|outside_objective|unsupported/.test(check.reason||'')) {grade='D';route='unsupported';}
    items.push({id:`check-${i+1}`,rule:check.rule,title:check.title||ruleTitle(check.rule),explanation:check.explanation,scope:check.scope,requiresContext:check.requiresContext===true,status:check.status,grade,route,reason:check.reason,evidence:refs,
      materialIds:unique([check.materialId,...(check.materialIds||[]),...refs.map(e=>e.materialId)]),
      dimensions:{applicability:grade==='D'?'uncovered':'scoped',provenance:missing?'missing':'bound',recognition:recognition?'sufficient':'needs_review',relationship:check.relationshipEvidence?.trust||(check.relationId?'explicit_confirmation':'single_material_or_missing'),coverage:grade==='A'?'executed':'unresolved'}});
  }
  const eligible=new Set([core,...review.plan.edges.map(e=>e.auxiliaryMaterialId),...review.plan.aggregates.flatMap(g=>g.materialIds),...(review.plan.contentCandidates||[]).map(c=>c.auxiliaryMaterialId)]);
  const byId=new Map(materials.map(m=>[m.id,m]));
  for(const material of batch.materials) {

    const raw=(byId.get(material.id)?.textBlocks||material.textBlocks||[]);
    const adequate=raw.filter(b=>typeof b.text==='string'&&b.text.trim().length>1&&Number.isFinite(b.confidence)&&b.confidence>=.9);
    const known=new Set(material.fields.flatMap(f=>[f.source?.observedText,...(f.source?.regions||[]).map(r=>r.observedText)]).filter(Boolean).map(s=>s.trim()));
    const residual=adequate.filter(b=>!known.has(b.text.trim()));
    const meaningful=adequate.length >= 2 || residual.some(b=>/合同|付款|支付|分期|验收|报销|审批|用途|约定|费用|收款|退还|补贴|申请|证明/.test(b.text))||residual.map(b=>b.text).join('').length>=40;
    if(meaningful)items.push({id:`context-${items.length+1}`,rule:'document_context_review',title:'材料内容与条款复核',status:'NEI',grade:'B',route:'semantic',reason:'context_not_covered_by_deterministic_rules',
      materialIds:[material.id],evidence:material.fields.filter(f=>f.confidence>=.9&&!f.extractionAmbiguous).map(f=>({materialId:material.id,fieldId:f.id,key:f.key,role:f.role,value:f.value,confidence:f.confidence,source:f.source})),
      question:'结合本材料的用途、条款和显示内容，检查含义是否自洽、是否存在规则未覆盖的矛盾；有问题或合理均说明理由。只引用实际提供内容。',
      dimensions:{applicability:'semantic',provenance:'bound',recognition:'sufficient',relationship:'single_material',coverage:'semantic_required'}});
    if(raw.some(b=>typeof b.text==='string'&&b.text.trim()&&(!Number.isFinite(b.confidence)||b.confidence<.9)))items.push({id:`recognition-${items.length+1}`,rule:'recognition_quality',title:'文字识别待确认',status:'NEI',grade:'C',route:'supplement',reason:'low_quality_text_not_sent_for_guessing',materialIds:[material.id],evidence:[],dimensions:{recognition:'needs_review',coverage:'incomplete'}});
    if(byId.get(material.id)?.coverage?.text_omitted_parts?.length||byId.get(material.id)?.textCoverage?.truncated)items.push({id:`coverage-${items.length+1}`,rule:'text_coverage',title:'材料内容未完整提取',status:'NEI',grade:'C',route:'supplement',reason:'text_coverage_incomplete',materialIds:[material.id],evidence:[],dimensions:{coverage:'incomplete'}});
  }
  // Explicit core edges, never unrelated auxiliary-to-auxiliary combinations.
  for(const edge of batch.materials.filter(m=>m.id!==core).map(m=>review.plan.edges.find(e=>e.auxiliaryMaterialId===m.id)||{coreMaterialId:core,auxiliaryMaterialId:m.id,relationId:null})) {
    const ids=[edge.coreMaterialId,edge.auxiliaryMaterialId];
    const hasContext=ids.some(id=>items.some(i=>i.rule==='document_context_review'&&i.materialIds.includes(id)));
    const readable=ids.every(id=>{
      const m=byId.get(id)||batch.materials.find(x=>x.id===id);
      return m&&(m.fields?.some(f=>f.confidence>=.9&&!f.extractionAmbiguous)||m.textBlocks?.some(b=>b.confidence>=.9&&b.text?.trim()));
    });
    if(hasContext&&readable)items.push({id:`relationship-${items.length+1}`,rule:'relationship_context_review',title:'关联材料语义核对',status:'NEI',grade:'B',route:'semantic',reason:edge.relationId?'confirmed_core_relation_with_unresolved_context':'core_material_content_comparison',materialIds:ids,evidence:[],relationId:edge.relationId,
      question:'围绕核心材料逐项核对姓名、号码、账户、金额、日期、条款及业务含义，指出具体矛盾、分别引用两份内容并解释原因；首先根据材料内容判断哪些事项可比较，不把不同业务正常差异认定为错误。',dimensions:{applicability:'core_edge',provenance:'bound',recognition:'sufficient',relationship:edge.relationId?'explicit_confirmation':'user_requested_content_comparison',coverage:'semantic_required'}});
  }
  for(const candidate of review.plan.contentCandidates||[]) {
    const ids=[candidate.coreMaterialId,candidate.auxiliaryMaterialId];
    if(items.some(i=>i.status==='WARN'&&i.materialIds.every(id=>ids.includes(id))))items.push({id:`candidate-context-${items.length+1}`,rule:'relationship_context_review',title:'已发现差异的适用条件复核',status:'NEI',grade:'B',route:'semantic',reason:'observed_identifier_difference_requires_business_context',materialIds:ids,evidence:candidate.basis,question:'本地已完成显示标识与内容差异核对，仅判断这些差异是否有条款、版本或业务例外解释；不要重新计算或取消本地差异。可见标识相同不是官方同主体或同交易确认。',dimensions:{relationship:candidate.trust,coverage:'semantic_required'}});
  }
  for(const excluded of review.plan.excluded.filter(e=>e.reason!=='duplicate_source_excluded'&&!(review.plan.contentCandidates||[]).some(c=>c.auxiliaryMaterialId===e.materialId)))items.push({id:`excluded-${items.length+1}`,rule:'material_relationship',title:'辅助材料尚未纳入核对',status:'NEI',grade:'C',route:'supplement',reason:excluded.reason,materialIds:[excluded.materialId],evidence:[],dimensions:{relationship:'unconfirmed',coverage:'excluded'}});
  for(const page of review.incompletePages||[])items.push({id:`page-${items.length+1}`,rule:'page_coverage',title:'页面尚未完成核验',status:'NEI',grade:'C',route:'supplement',reason:page.reason||page.status,materialIds:[page.materialId],evidence:[],dimensions:{coverage:'incomplete'}});
  const counts=Object.fromEntries(['A','B','C','D'].map(g=>[g,items.filter(i=>i.grade===g).length]));
  return {version:ASSESSMENT_VERSION,items,counts,coverage:{localResolved:counts.A,totalPlanned:items.length,localResolutionRate:items.length?counts.A/items.length:0,semanticRequired:counts.B,supplementRequired:counts.C,unsupported:counts.D,semantics:'engineering_execution_coverage_not_accuracy'},context:{region:context.region||'unspecified',businessDate:context.businessDate||null},recognitionGate:.9,calibration:'not_calibrated'};
}

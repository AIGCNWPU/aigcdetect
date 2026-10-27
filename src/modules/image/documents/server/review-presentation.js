import {ruleTitle} from './execution-assessment.js';
const unique=values=>[...new Set(values.filter(Boolean))];
const reasons={zero_displayed_rate_tax_consistency:'该行显示税率为0%，但税额不为0，请核对该行开票内容。',displayed_rate_times_line_net:'该行税额与显示税率、不含税金额不一致，请核对金额与计税说明。',explicit_start_end_order:'材料的结束日期早于开始日期，请核对起止时间。',same_scope_amount_comparison:'已确认同一交易和金额范围的材料显示金额不同。',displayed_amount_arithmetic_only:'不含税金额与税额之和不等于价税合计。',displayed_upper_lower_amount_consistency:'材料的大写金额与小写金额不一致。',identity_checksum_mismatch:'身份号码的校验位不匹配，请先核对原件和识别内容。',identity_impossible_birth_date:'身份号码中的出生日期不符合日历。',calendar_date_only:'材料中的日期不符合日历规则。',number_year_matches_issue_date:'发票号码中的年份与开票日期不一致。'};
export function presentReview({materials,review,semanticReview}) {
  const assessment=review.executionAssessment,items=assessment.items;
  const warnings=items.filter(i=>i.grade==='A'&&['FAIL','WARN'].includes(i.status)).map(i=>({id:i.id,title:i.title||ruleTitle(i.rule),message:i.explanation||reasons[i.reason]||'本项内容核对发现不一致，请查看相关材料并更正或提供说明。',severity:i.status==='WARN'?'review':'warning',scope:i.scope,materialIds:i.materialIds,evidence:i.evidence}));
  for(const material of materials) {
    if(['completed','partial'].includes(material.stages?.seed?.status)&&((material.stages.seed.score??0)>=.5||material.pages?.some(p=>p.regions?.length)))warnings.push({id:`visual-${material.id}`,title:'存在局部修改线索',message:'材料中有需要重点复核的区域，请结合标记位置检查原件。',materialIds:[material.id]});
    if(['completed','partial'].includes(material.stages?.mirror?.status)&&(material.stages.mirror.score??0)>=.5)warnings.push({id:`origin-${material.id}`,title:'存在图像生成线索',message:'材料图像存在生成线索，请核对来源及原件。',materialIds:[material.id]});
  }
  const aiItems=semanticReview?.items||[];
  const succeeded=['completed','succeeded'].includes(semanticReview?.status);
  if(succeeded)for(const [i,item] of aiItems.entries())if(item.verdict==='issues_found')warnings.push({id:`semantic-${i+1}`,title:'智能复核发现内容问题',message:[item.warning,item.explanation].filter(Boolean).join(' '),materialIds:items.find(x=>x.id===item.assessmentId)?.materialIds||[],evidenceIds:item.evidenceIds,assessmentId:item.assessmentId,evidence:items.find(x=>x.id===item.assessmentId)?.evidence||[]});
  const resolved=new Set(succeeded?aiItems.filter(i=>['reasonable','issues_found'].includes(i.verdict)).map(i=>i.assessmentId):[]);
  const outstanding=items.filter(i=>i.route!=='local'&&!resolved.has(i.id));
  const names=new Map(materials.map(m=>[m.id,m.name||'相关材料']));
  const actionItems=outstanding.map(i=>({materialIds:i.materialIds||[],message:(()=>{
    const label=(i.materialIds||[]).map(id=>names.get(id)).filter(Boolean).join('、');
    const prefix=label?`${label}：`:'';
    if(i.grade==='D')return `${prefix}${i.title}尚无充分依据，请补充本次适用的制度或参考资料。`;
    if(i.grade==='B')return `${prefix}${i.title}尚未完成，请结合下方智能复核状态处理。`;
    if(i.rule==='recognition_quality')return `${prefix}请确认识别不清的文字，必要时补充清晰材料。`;
    if(i.rule==='material_relationship')return `${prefix}请确认与核心材料的关系后再核对。`;
    return `${prefix}${i.title}所需信息不完整，请补充对应内容或确认比较范围。`;
  })()}));
  const actions=unique(actionItems.map(item=>item.message));
  if(succeeded)for(const item of aiItems)if(item.recommendation){actions.push(item.recommendation);actionItems.push({materialIds:items.find(i=>i.id===item.assessmentId)?.materialIds||[],message:item.recommendation});}
  if(['provider_not_configured','provider_disabled'].includes(semanticReview?.reason))actions.push('智能复核服务暂未配置；本地检查结果已保留。');
  if(semanticReview?.status==='failed')actions.push('智能复核暂未完成，可稍后重新提交；本地检查结果已保留。');
  if(semanticReview?.losses?.length||semanticReview?.omitted?.length)actions.push('部分内容因脱敏或输入范围限制未能完成智能复核，请查看待补项。');
  const incomplete=materials.some(m=>m.status!=='completed')||outstanding.length>0||semanticReview?.omitted?.length>0||semanticReview?.losses?.length>0||semanticReview?.status==='failed';
  const status=warnings.length?'issues_found':incomplete?'needs_more_information':'no_issues_found';
  const title={issues_found:'发现需要处理的问题',needs_more_information:'还需补充信息',no_issues_found:'本次检查未发现问题'}[status];
  const summary=warnings.length?`本次发现 ${warnings.length} 项需关注内容，请核对下列问题后再办理相关业务。`:incomplete?'已完成可执行的检查，仍有信息或核验事项需要补充。':'在本次已覆盖的核验范围内，材料内容未发现异常。';
  return {status,title,summary,warnings,actions:unique(actions),actionItems,coverage:assessment.coverage,
    aiReview:{status:semanticReview?.status||'not_run',summary:succeeded?semanticReview.summary:'',findings:succeeded?aiItems:[],reason:semanticReview?.reason,privacyMode:semanticReview?.privacyMode,losses:semanticReview?.losses||[]},
    disclaimer:'本平台提供辅助审核，AI分析可能存在误差，请结合原始材料办理。'};
}

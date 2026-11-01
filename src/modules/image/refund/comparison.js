export const refundComparisonDimensions=Object.freeze({appearance:'商品外观',style:'商品款式',issue:'问题现象'});
export const refundComparisonOutcomes=Object.freeze({match:'一致',mismatch:'不一致',unknown:'无法判断'});

export function validateRefundComparison(value,imageId,fields) {
  const invalid=()=>{throw new Error('核对结果不完整或与当前资料不匹配，请重试。');};
  const text=(input,max)=>typeof input==='string' && input.trim().length>0 && input.length<=max;
  if(!value || value.imageId!==imageId || value.kind!=='comparison' || !['full','partial'].includes(value.coverage) ||
    !text(value.scope,2000) || !text(value.summary,4000) || !Array.isArray(value.checks) || value.checks.length!==3)invalid();
  const references=Object.freeze({appearance:[fields.productName,fields.productInfo].map(v=>String(v||'').trim()).filter(Boolean).join('\n'),style:String(fields.style||'').trim(),issue:String(fields.description||'').trim()});
  const seen=new Set();
  const checks=value.checks.map(check=>{
    if(!check || !Object.hasOwn(refundComparisonDimensions,check.dimension) || seen.has(check.dimension) || !Object.hasOwn(refundComparisonOutcomes,check.outcome) ||
      !text(check.observed,2000) || !text(check.evidence,2000) || (!references[check.dimension] && check.outcome!=='unknown'))invalid();
    seen.add(check.dimension);
    return Object.freeze({dimension:check.dimension,outcome:check.outcome,observed:check.observed,evidence:check.evidence});
  });
  checks.sort((a,b)=>Object.keys(refundComparisonDimensions).indexOf(a.dimension)-Object.keys(refundComparisonDimensions).indexOf(b.dimension));
  return Object.freeze({imageId,kind:'comparison',summary:value.summary,coverage:value.coverage,scope:value.scope,references,checks:Object.freeze(checks),...(value.provenance?.provider==='DeepSeek'?{provenance:Object.freeze({provider:'DeepSeek'})}:{})});
}

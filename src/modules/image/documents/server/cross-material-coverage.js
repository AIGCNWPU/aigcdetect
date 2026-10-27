const types=['identity','invoice','digital_invoice','receipt','certificate'];
export function combinationId(a,b) {
  const x=types.indexOf(a),y=types.indexOf(b);
  if(x<0||y<0) return null;
  const i=Math.min(x,y),j=Math.max(x,y);
  return `C${String(i*5-i*(i-1)/2+j-i+1).padStart(2,'0')}`;
}
export function pairCoverage(a,b,checks,duplicate) {
  const leftKeys=new Set(a.fields.map(f=>f.key)),rightKeys=new Set(b.fields.map(f=>f.key));
  return {combinationId:combinationId(a.type,b.type),materialIds:[a.id,b.id],
    status:checks.length?'evaluated':'NEI',reason:checks.length?'generic_field_checks_only':'no_comparable_fields',
    sameSource:duplicate,checkCount:checks.length,
    missingOnLeft:[...rightKeys].filter(k=>!leftKeys.has(k)),missingOnRight:[...leftKeys].filter(k=>!rightKeys.has(k)),
    statusCounts:Object.fromEntries(['PASS','FAIL','NEI','NOT_APPLICABLE'].map(s=>[s,checks.filter(c=>c.status===s).length])),
    specializedRules:'not_fully_implemented'};
}

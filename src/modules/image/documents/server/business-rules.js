import {displayedDate} from './date-fields.js';

export const BUSINESS_RULE_VERSION='displayed-business-facts/0.1';
const reliable=f=>f&&f.confidence>=.9&&!f.extractionAmbiguous&&f.value?.trim();
// Display consistency only: this is not a determination of the legally applicable tax rate.
export function businessChecks(material,{evidence,decimal}) {
  const checks=[];
  const emit=(rule,status,reason,fields,extra={})=>checks.push({rule,ruleVersion:BUSINESS_RULE_VERSION,status,reason,evidence:fields.map(f=>evidence(material,f)),...extra});
  const rates=material.fields.filter(f=>f.key==='tax_rate');
  for(const rate of rates) {
    const fields=material.fields.filter(f=>['net_amount','tax_amount','line_net_amount','line_tax_amount'].includes(f.key)&&f.taxScope&&f.taxScope===rate.taxScope);
    const tax=fields.filter(f=>['tax_amount','line_tax_amount'].includes(f.key)),net=fields.filter(f=>['net_amount','line_net_amount'].includes(f.key));
    const refs=[rate,...fields];
    if(!rate.taxScope||tax.length!==1||net.length>1||rates.filter(f=>f.taxScope===rate.taxScope).length!==1) {
      emit('displayed_tax_rate','NEI','tax_line_scope_not_confirmed',refs);continue;
    }
    if(refs.some(f=>!reliable(f))) {emit('displayed_tax_rate','NEI','recognition_requires_review',refs);continue;}
    const special=material.fields.some(f=>f.taxScope===rate.taxScope&&f.key==='tax_method'&&(!reliable(f)||f.value.trim()!=='一般计税'));
    if(special||refs.some(f=>/差额|免税|不征税|\*/.test(f.source.observedText))) {emit('displayed_tax_rate','NEI','special_tax_method_requires_review',refs);continue;}
    const match=rate.value.trim().match(/^(\d{1,3}(?:\.\d{1,4})?)\s*[%％]$/);
    if(!match||Number(match[1])>100||tax[0].currency!=='CNY'||(net.length&&net[0].currency!=='CNY')) {emit('displayed_tax_rate','NEI','rate_or_currency_not_explicit',refs);continue;}
    try {
      const percent=decimal(match[1]),taxValue=decimal(tax[0].value);
      if(percent===0n)emit('displayed_tax_rate',taxValue===0n?'PASS':'FAIL','zero_displayed_rate_tax_consistency',refs);
      else if(net.length!==1)emit('displayed_tax_rate','NEI','missing_line_net_amount',refs);
      else {
        const difference=decimal(net[0].value)*percent-taxValue*100000000n;
        emit('displayed_tax_rate',(difference<0n?-difference:difference)<=1000000000000n?'PASS':'FAIL','displayed_rate_times_line_net',refs,{tolerance:'CNY 0.01',scope:'explicit_line_not_tax_eligibility'});
      }
    }catch {emit('displayed_tax_rate','NEI','ambiguous_numeric_text',refs);}
  }
  for(const [startKey,endKey,label] of [['travel_start_date','travel_end_date','travel'],['contract_start_date','contract_end_date','contract']]) {
    const starts=material.fields.filter(f=>f.key===startKey),ends=material.fields.filter(f=>f.key===endKey);
    if(!starts.length&&!ends.length)continue;
    const refs=[...starts,...ends];
    if(starts.length!==1||ends.length!==1||refs.some(f=>!reliable(f))) {emit('displayed_date_interval','NEI','date_interval_missing_or_ambiguous',refs);continue;}
    const a=displayedDate(starts[0].value,starts[0].dateFormat),b=displayedDate(ends[0].value,ends[0].dateFormat);
    emit('displayed_date_interval',a.status!=='PASS'||b.status!=='PASS'?'NEI':a.canonical<=b.canonical?'PASS':'FAIL','explicit_start_end_order',refs,{event:label});
  }
  return checks;
}

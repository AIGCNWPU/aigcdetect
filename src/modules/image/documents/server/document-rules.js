import { displayedDate } from './date-fields.js';
import { businessChecks } from './business-rules.js';

export const DOCUMENT_RULE_VERSION='document-facts/0.1';
export const RULE_SOURCES={
 identity:'https://zjw.beijing.gov.cn/Portals/0/zhuanti/fazhan/%E8%BA%AB%E4%BB%BD%E8%AF%81GB11643-1999.pdf',
 digitalInvoice:'https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html',
 legacyElectronicInvoice:'https://fgk.chinatax.gov.cn/zcfgk/c100012/c5194596/content.html',
 money:'local:displayed-financial-numerals/0.1',
};
const reliable=f=>f&&f.confidence>=.90&&!f.extractionAmbiguous&&f.value.trim();
export function identityNumber(value) {
 const text=value.trim().toUpperCase();
 if(!/^\d{17}[\dX]$/.test(text)) return {status:/[^\dXx]/.test(value.trim())?'NEI':'FAIL',reason:'identity_format_not_18_digits_or_ocr_ambiguity'};
 const weights=[7,9,10,5,8,4,2,1,6,3,7,9,10,5,8,4,2];
 const expected='10X98765432'[[...text.slice(0,17)].reduce((sum,n,i)=>sum+Number(n)*weights[i],0)%11];
 const birth=`${text.slice(6,10)}-${text.slice(10,12)}-${text.slice(12,14)}`;
 const calendar=displayedDate(birth,'YYYY-MM-DD');
 return {status:expected===text[17]&&calendar.status==='PASS'?'PASS':'FAIL',reason:calendar.status!=='PASS'?'identity_impossible_birth_date':expected!==text[17]?'identity_checksum_mismatch':'identity_structure_checksum_only',expectedCheckCharacter:expected,birthDate:birth,gender:Number(text[16])%2?'男':'女',regionVerification:'not_run'};
}

const digits='零壹贰叁肆伍陆柒捌玖';
function section(n) {
 let out='',zero=false;
 for(let i=3;i>=0;i--) {const d=Math.floor(n/10**i)%10;if(d) {if(zero)out+='零';out+=digits[d]+['','拾','佰','仟'][i];zero=false;} else if(out)zero=true;}
 return out;
}
function words(cents) {
 let integer=cents/100n, parts=[];
 do {parts.push(Number(integer%10000n));integer/=10000n;} while(integer);
 let out='',gap=false;
 for(let i=parts.length-1;i>=0;i--) {if(!parts[i]) {if(out)gap=true;continue;} if(out&&(gap||parts[i]<1000))out+='零';out+=section(parts[i])+['','万','亿'][i];gap=false;}
 out=(out||'零')+'元';
 const jiao=Number(cents/10n%10n),fen=Number(cents%10n);
 if(jiao)out+=digits[jiao]+'角';
 if(fen)out+=(jiao?'':'零')+digits[fen]+'分';
 if(!fen)out+='整';
 return out;
}
/** Strict supported financial numeral grammar; unfamiliar variants remain NEI. */
export function chineseMoney(value) {
 const text=value.trim().replace(/^人民币/,'').replace(/^[⊗Ⓧ]/,'').replaceAll('圆','元').replace(/正$/,'整');
 const match=text.match(/^([零壹贰叁肆伍陆柒捌玖拾佰仟万亿]+)元(.*)$/);
 if(!match) return null;
 let total=0n,group=0n,digit=null,lastSmall=10000n,lastLarge=1000000000000n;
 for(const c of match[1]) {
  const d=digits.indexOf(c);
  if(d>=0) {if(d===0){if(digit!==null)return null;continue;} if(digit!==null)return null;digit=BigInt(d);continue;}
  const small={拾:10n,佰:100n,仟:1000n}[c];
  if(small) {if(digit===null||small>=lastSmall)return null;group+=digit*small;digit=null;lastSmall=small;continue;}
  const large={万:10000n,亿:100000000n}[c];
  if(!large||large>=lastLarge)return null;
  group+=digit??0n;if(!group)return null;total+=group*large;group=0n;digit=null;lastSmall=10000n;lastLarge=large;
 }
 total+=group+(digit??0n);
 const tail=match[2];
 const fraction=tail.match(/^(?:([壹贰叁肆伍陆柒捌玖])角)?(?:零?([壹贰叁肆伍陆柒捌玖])分)?(?:整)?$/);
 if(!fraction)return null;
 const cents=total*100n+BigInt(fraction[1]?digits.indexOf(fraction[1])*10:0)+BigInt(fraction[2]?digits.indexOf(fraction[2]):0);
 if(total>=1000000000000n)return null;
 const canonical=words(cents);
 const optionalGroupZero=s=>s.replace(/([万亿])零(?=[壹贰叁肆伍陆柒捌玖])/g,'$1');
 const a=optionalGroupZero(text),b=optionalGroupZero(canonical);
 if(a!==b && !(b.endsWith('角整')&&a===b.slice(0,-1))) return null;
 return cents;
}

export function documentChecks(material,{evidence,decimal}) {
 const checks=[];
 const emit=(rule,status,reason,fields,extra={})=>checks.push({rule,ruleVersion:DOCUMENT_RULE_VERSION,status,reason,evidence:fields.map(f=>evidence(material,f)),...extra});
 const select=(key,role)=>material.fields.filter(f=>f.key===key&&(role===undefined||f.role===role));
 for(const id of select('identity_number')) {
  const checked=reliable(id)?identityNumber(id.value):{status:'NEI',reason:'recognition_requires_review'};
  emit('identity_structure',checked.status,checked.reason,[id],{...checked,source: RULE_SOURCES.identity});
  emit('identity_historical_region','NEI','historical_region_table_not_configured',[id],{source:RULE_SOURCES.identity});
  for(const key of ['birth_date','gender']) {
   const others=select(key,id.role);
   if(others.length!==1) {emit(`identity_${key}`,'NEI','missing_or_ambiguous_related_field',[id,...others]);continue;}
   const f=others[0];
   if(checked.status!=='PASS'||!reliable(f)||select('identity_number',id.role).length!==1) {emit(`identity_${key}`,'NEI','identity_or_related_field_requires_review',[id,f]);continue;}
   const actual=key==='birth_date'?displayedDate(f.value,f.dateFormat).canonical:f.value.trim();
   if(!actual||(key==='gender'&&!['男','女'].includes(actual))) {emit(`identity_${key}`,'NEI','unsupported_related_field_value',[id,f]);continue;}
   emit(`identity_${key}`,actual===(key==='birth_date'?checked.birthDate:checked.gender)?'PASS':'FAIL','displayed_identity_field_consistency',[id,f],{source:RULE_SOURCES.identity});
  }
 }
 if(['invoice','digital_invoice'].includes(material.type)) {
  const fields=select('invoice_number');
  if(fields.length!==1) emit('invoice_number_format','NEI','missing_or_ambiguous_invoice_number',fields);
  else {
   const f=fields[0];const subtype=material.invoiceSubtype;
   if(!reliable(f)) emit('invoice_number_format','NEI','recognition_requires_review',fields);
   else if(material.type!=='digital_invoice'&&subtype!=='vat_electronic_ordinary') emit('invoice_number_format','NEI','legacy_invoice_subtype_not_confirmed',fields);
   else {
    const text=f.value.trim(),size=material.type==='digital_invoice'?20:8;
    emit('invoice_number_format',/^\d+$/.test(text)?(text.length===size?'PASS':'FAIL'):'NEI',/^\d+$/.test(text)?'invoice_number_length_only':'invoice_number_ocr_or_mask_ambiguity',fields,{expectedDigits:size,actualDigits:text.length,invoiceType:material.type==='digital_invoice'?'数电发票':'增值税电子普通发票',source:material.type==='digital_invoice'?RULE_SOURCES.digitalInvoice:RULE_SOURCES.legacyElectronicInvoice});
    if(material.type==='digital_invoice') {
     const dates=select('invoice_date');const date=dates.length===1&&reliable(dates[0])?displayedDate(dates[0].value,dates[0].dateFormat):null;
     if(!/^\d{20}$/.test(text)||date?.status!=='PASS') emit('invoice_number_year','NEI','number_or_date_requires_review',[f,...dates]);
     else if(date.canonical<'2024-12-01') emit('invoice_number_year','NEI','pre_national_rollout_requires_regional_rule',[f,...dates]);
     else emit('invoice_number_year',text.slice(0,2)===date.canonical.slice(2,4)?'PASS':'FAIL','number_year_matches_issue_date',[f,...dates],{source:RULE_SOURCES.digitalInvoice});
    }
   }
  }
  if(material.invoiceSubtype==='vat_electronic_ordinary') {
   const codes=select('invoice_code');
   emit('invoice_code_format',codes.length===1&&reliable(codes[0])?(/^0\d{11}$/.test(codes[0].value.trim())?'PASS':/^\d+$/.test(codes[0].value.trim())?'FAIL':'NEI'):'NEI','legacy_electronic_ordinary_code_structure_only',codes,{invoiceType:'增值税电子普通发票',expectedDigits:12,requiredPrefix:'0',actualDigits:codes.length===1?codes[0].value.trim().length:null,actualPrefix:codes.length===1?codes[0].value.trim().slice(0,1):null,source:RULE_SOURCES.legacyElectronicInvoice});
  }
 }
 const upper=select('gross_amount_words'),lower=select('gross_amount');
 if(upper.length||lower.length) {
  const refs=[...upper,...lower];
  if(upper.length!==1||lower.length!==1||refs.some(f=>!reliable(f))) emit('amount_words_numeric','NEI','missing_ambiguous_or_unreliable_amount',refs);
  else if(lower[0].currency!=='CNY') emit('amount_words_numeric','NEI','cny_not_confirmed',refs);
  else {
   const cents=chineseMoney(upper[0].value);
   try {const numeric=decimal(lower[0].value);emit('amount_words_numeric',cents===null?'NEI':cents*10000n===numeric?'PASS':'FAIL',cents===null?'unsupported_financial_numeral_form':'displayed_upper_lower_amount_consistency',refs,{source:RULE_SOURCES.money});}
   catch {emit('amount_words_numeric','NEI','ambiguous_numeric_text',refs);}
  }
 }
 return [...checks,...businessChecks(material,{evidence,decimal})];
}

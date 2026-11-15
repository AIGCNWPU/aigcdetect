// Remaining Chinese material formats. Titles/labels/geometry only, no benchmark answers.
export const CATALOG_CONTENT_VERSION='cn-catalog-fields/0.1';
const clean=s=>s.replace(/\s/g,'').replaceAll('（','(').replaceAll('）',')');
const box=r=>[Math.min(...r.polygon.map(p=>p[0])),Math.min(...r.polygon.map(p=>p[1])),Math.max(...r.polygon.map(p=>p[0])),Math.max(...r.polygon.map(p=>p[1]))];
const cx=r=>(box(r)[0]+box(r)[2])/2,cy=r=>(box(r)[1]+box(r)[3])/2,h=r=>box(r)[3]-box(r)[1];
const row=(a,b)=>Math.abs(cy(a)-cy(b))<=Math.max(h(a),h(b))*.8;
const date=s=>/^\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?$/.test(s);
export function enrichCatalogFields(sample,{material,digest}){
 const regions=sample.regions.filter(r=>r.observed_text?.trim()),width=sample.oriented_size[0],height=sample.oriented_size[1],fields=[],review=[];
 const format={kind:'unknown',id:'unknown',status:'NEI',reason:'supported_title_not_found',evidenceRegionIds:[]};
 const ordered=[...regions].sort((a,b)=>Math.abs(cy(a)-cy(b))<Math.min(h(a),h(b))*.4?cx(a)-cx(b):cy(a)-cy(b));
 function title(pattern,kind){const hits=regions.filter(r=>pattern.test(clean(r.observed_text)));if(!hits.length)return false;Object.assign(format,{kind,id:kind,status:'matched',reason:'explicit_title',evidenceRegionIds:hits.map(r=>r.region_id)});return true;}
 function add(key,value,proof,extra={}){
  if(!value?.trim()||!proof.length)return;value=value.trim();const role=extra.role||'transaction',sources=[...new Map(proof.map(r=>[r.region_id,r])).values()];
  if(material.fields.some(f=>f.key===key&&f.role===role&&f.taxScope===extra.taxScope))return;
  if(fields.some(f=>f.key===key&&f.role===role&&f.value===value))return;
  const anchor=sources.at(-1),f={id:`catalog-${fields.length+1}`,key,role,value,version:1,confidence:Math.min(...sources.map(r=>r.recognition_confidence)),...extra,source:{fileSha256:material.fileSha256,page:1,provider:'ocr',observedText:anchor.observed_text,polygon:structuredClone(anchor.polygon),coordinateSpace:'exif_oriented_image_pixels',precision:'ocr_region',ocrFingerprint:digest,extractionVersion:CATALOG_CONTENT_VERSION,regions:sources.map(r=>({regionId:r.region_id,observedText:r.observed_text,polygon:structuredClone(r.polygon),confidence:r.recognition_confidence}))}};
  if(key.endsWith('_date')){if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(value))f.dateFormat='YYYY-MM-DD';if(/^\d{4}年\d{1,2}月\d{1,2}日$/.test(value))f.dateFormat='YYYY年MM月DD日';if(/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(value))f.dateFormat='YYYY.MM.DD';}
  fields.push(f);if(f.confidence<.9)review.push({fieldId:f.id,key,role,reason:'recognition_requires_review'});
 }
 function label(key,names,{role='transaction',test=s=>s.length>0,transform=s=>s,below=false,contains=false,boundary=false,extra={}}={}){
  for(const r of regions)for(const name of names){const text=clean(r.observed_text),pos=contains?text.indexOf(name):text.startsWith(name)?0:-1;if(pos<0)continue;if(boundary&&text.slice(pos+name.length)&&!/^[:：]/.test(text.slice(pos+name.length)))continue;
   const value=text.slice(pos+name.length).replace(/^[:：，,]/,'');
   if(value&&test(value)){add(key,transform(value),[r],{role,...extra});break;}
   if(value)continue;
   let values=regions.filter(v=>v!==r&&row(r,v)&&box(v)[0]>=box(r)[2]-width*.04&&box(v)[0]-box(r)[2]<width*.65&&test(clean(v.observed_text)));
   if(!values.length&&below)values=regions.filter(v=>v!==r&&box(v)[1]>=box(r)[3]-h(r)*.1&&box(v)[1]-box(r)[3]<h(r)*4&&Math.abs(box(v)[0]-box(r)[0])<width*.35&&test(clean(v.observed_text)));
   if(values.length){const nearest=Math.min(...values.map(v=>Math.hypot(Math.max(0,box(v)[0]-box(r)[2]),cy(v)-cy(r))));for(const v of values.filter(v=>Math.hypot(Math.max(0,box(v)[0]-box(r)[2]),cy(v)-cy(r))<=nearest+width*.008))add(key,transform(clean(v.observed_text)),[r,v],{role,...extra});}
   else review.push({key,role,reason:'content_label_value_missing',regionIds:[r.region_id]});break;
  }
 }
 function scan(regex,callback){let offset=0;const spans=ordered.map(r=>{const start=offset;offset+=r.observed_text.length+1;return{r,start,end:offset-1};});const text=ordered.map(r=>r.observed_text).join('\n');for(const m of text.matchAll(regex))callback(m,spans.filter(s=>s.end>m.index&&s.start<m.index+m[0].length).map(s=>s.r));}
 const id=s=>/^[0-9][0-9Xx*＊]{14,19}$/.test(s),person=s=>/^[\p{Script=Han}*＊·]{2,20}$/u.test(s)&&!/身份证|法定|代表|代理|电话|日期/.test(s),company=s=>s.length>2&&!/^纳税人|识别号|有效证件|截止/.test(s);
 if(title(/^无欠税证明$/,'no_arrears_certificate')){
  label('name',['纳税人名称'],{role:'taxpayer',test:s=>company(s)&&!/^\(个/.test(s),transform:s=>s.split(/[，,]?纳税人/)[0]});
  label('tax_identifier',['纳税人识别号','识别号'],{role:'taxpayer',contains:true,below:true,test:s=>/^[0-9A-Z]{12,22}$/i.test(s)});
  const resident=regions.some(r=>/有效证件类型.*居民身份证/.test(clean(r.observed_text)));
  label(resident?'identity_number':'displayed_document_number',['有效证件号码'],{role:'holder',test:id,below:true,contains:true});
  scan(/无欠税证\s*[（(]\s*(\d{4})\s*[）)]\s*(\d{1,30})\s*号/g,(m,p)=>add('certificate_number',`无欠税证(${m[1]})${m[2]}号`,p));
  for(const r of regions){const m=clean(r.observed_text).match(/^(.{2,25}?税)无欠税证/);if(m)add('issuing_authority',m[1],[r]);}
  scan(/截至\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/g,(m,p)=>add('tax_status_date',clean(m[1]),p));
 }
 if(title(/^收入纳税明细(?:详情)?$/,'income_tax_detail')){
  label('name',['扣缴义务人名称','扣缴义务人名'],{role:'withholding_agent',test:company});
  label('tax_identifier',['扣缴义务人纳税人识别号','扣缴义务人纳税'],{role:'withholding_agent',test:s=>/^[0-9A-Z]{12,22}$/i.test(s)});
  label('issuing_authority',['主管税务机关'],{test:s=>/税务|税局/.test(s)});
  label('declaration_date',['申报日期'],{test:date});label('tax_period',['税款所属期'],{test:s=>/^\d{4}-\d{2}$/.test(s)});
  for(const [key,names] of [['income_amount',['收入']],['current_income_amount',['本期收入']],['declared_tax_amount',['已申报税额']]])label(key,names,{test:s=>/^[\d,]+(?:\.\d{1,2})?元?$/.test(s),transform:s=>s.replace(/元$/,'').replaceAll(',',''),extra:{currency:'CNY',basis:key}});
 }
 if(title(/^淘宝网店铺经营证明$/,'online_shop_certificate')){
  label('name',['账户名称'],{role:'account_holder',test:company});
  label('shop_url',['店铺地址'],{test:s=>/^https?:\/\/[^\s]+$/i.test(s)});
  scan(/营业执照[：:]\s*([0-9A-Z]{12,22})/g,(m,p)=>add('business_credit_code',m[1],p,{role:'account_holder'}));
  label('business_credit_code',['营业执照'],{role:'account_holder',contains:true,test:s=>/^[0-9A-Z]{12,22}\)?$/i.test(s),transform:s=>s.replace(/\)$/,'')});
 }
 const appIdHeaders=regions.filter(r=>/^小程序(?:ID|Id|id)$/.test(clean(r.observed_text))),appNameHeaders=regions.filter(r=>clean(r.observed_text)==='小程序名称');
 if(appIdHeaders.length===1&&appNameHeaders.length===1){
  Object.assign(format,{kind:'miniapp_information',id:'miniapp_information',status:'matched',reason:'explicit_table_headers',evidenceRegionIds:[appIdHeaders[0].region_id,appNameHeaders[0].region_id]});
  const ih=appIdHeaders[0],nh=appNameHeaders[0];
  const ids=regions.filter(r=>box(r)[1]>=box(ih)[3]&&cy(r)-cy(ih)<height*.5&&Math.abs(cx(r)-cx(ih))<width*.15&&/^[A-Za-z0-9_-]{6,64}$/.test(clean(r.observed_text)));
  for(const r of ids){add('application_id',clean(r.observed_text),[ih,r]);const names=regions.filter(v=>row(r,v)&&Math.abs(cx(v)-cx(nh))<width*.17&&!/小程序|名称|取消|确定/.test(clean(v.observed_text)));for(const v of names)add('application_name',clean(v.observed_text),[nh,v]);}
 }
 if(title(/^销售合同$/,'sales_contract')){
  label('contract_number',['合同编号','合同号'],{test:s=>/^[A-Za-z0-9_-]{4,80}$/.test(s)});label('transaction_date',['签定日期','签订日期'],{test:date});
  const partyValue=s=>s.length>1&&s.length<100&&!/^[甲乙]方$|^\(|[：:，,]/.test(s);
  label('name',['甲方(需方)','甲方(采购方)','甲方(买方)','甲方'],{role:'party_a',boundary:true,test:partyValue});label('name',['乙方(供方)','乙方(供货方)','乙方(卖方)','乙方'],{role:'party_b',boundary:true,test:partyValue});
  label('contract_total',['合同总额(见订单明细)','合同总额','合同总金额'],{contains:true,test:s=>/^[¥￥]?[0-9]+(?:\.[0-9]{1,2})?$/.test(s),transform:s=>s.replace(/^[¥￥]/,''),extra:{currency:'CNY',basis:'contract_total'}});
  const ah=regions.filter(r=>clean(r.observed_text)==='甲方'),bh=regions.filter(r=>clean(r.observed_text)==='乙方');
  if(ah.length&&bh.length){const left=ah.at(-1),right=bh.at(-1),middle=(cx(left)+cx(right))/2,bottom=Math.min(cy(left),cy(right));
   for(const r of regions.filter(r=>cy(r)>bottom))for(const [tag,key,test] of [['委托代理人','authorized_agent',person],['法定代表人','legal_representative',person],['电话','phone_number',s=>/^[0-9*＊()\-]{7,30}$/.test(s)],['地址','registered_address',s=>s.length>2]]){
    const t=clean(r.observed_text);if(!t.startsWith(tag))continue;const role=cx(r)<middle?'party_a':'party_b',inline=t.slice(tag.length).replace(/^[:：]/,'');
    if(inline&&test(inline))add(key,inline,[r],{role});else for(const v of regions.filter(v=>v!==r&&row(r,v)&&box(v)[0]>=box(r)[2]-width*.03&&(role==='party_a'?cx(v)<middle:cx(v)>=middle)&&test(clean(v.observed_text))))add(key,clean(v.observed_text),[r,v],{role});
   }
  }
 }
 if(title(/^商用办公室租赁合同$/,'commercial_lease')){
  for(const [pattern,role] of [[/^\(?甲方\)?出租方[:：]?/,'lessor'],[/^\(?乙方\)?承租方[:：]?/,'lessee'],[/^签字代表[:：]?/,'lessee_representative']])for(const marker of regions.filter(r=>pattern.test(clean(r.observed_text)))){
   const text=clean(marker.observed_text),tail=text.replace(pattern,'').split(/身份证|统一信用/)[0];
   if(tail&&tail.length<80)add('name',tail,[marker],{role});
   else for(const v of regions.filter(r=>r!==marker&&row(r,marker)&&box(r)[0]>=box(marker)[2]-width*.03&&(person(clean(r.observed_text).split(/身份证/)[0])||/公司$/.test(clean(r.observed_text)))))add('name',clean(v.observed_text).split(/身份证/)[0],[marker,v],{role});
   const labels=regions.filter(r=>/身份证号/.test(r.observed_text)&&row(r,marker));
   for(const lab of labels){const inline=clean(lab.observed_text).match(/身份证号[:：]?([0-9Xx*＊]{15,20})/);if(inline)add('identity_number',inline[1],[marker,lab],{role});else for(const v of regions.filter(r=>r!==lab&&row(r,lab)&&box(r)[0]>=box(lab)[2]-width*.03&&id(clean(r.observed_text))))add('identity_number',clean(v.observed_text),[marker,lab,v],{role});}
  }
  label('business_credit_code',['统一信用代码','统一社会信用代码'],{role:'lessee',test:s=>/^[0-9A-Z]{12,22}$/i.test(s)});
  scan(/月租金\s*([0-9]+(?:\.[0-9]{1,2})?)\s*元/g,(m,p)=>add('monthly_rent',m[1],p,{currency:'CNY',basis:'monthly_rent'}));
  scan(/合同有效期限[:：]?\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s*至\s*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/g,(m,p)=>{add('contract_start_date',clean(m[1]),p);add('contract_end_date',clean(m[2]),p);});
 }

 if(title(/^纳税证明$/,'tax_status_certificate')){
  for(const r of regions){const t=clean(r.observed_text);if(/^.{0,20}(?:纳税证|无欠税证)[（(]\d{4}[）)]\d{1,30}号$/.test(t))add('certificate_number',t,[r]);}
  scan(/(?:统一社会信用代码|纳税人识别号)\s*[:：]?\s*([A-Z0-9]{12,22})/g,(m,p)=>add('tax_identifier',m[1],p,{role:'subject'}));
  for(const r of regions){const t=clean(r.observed_text),m=t.match(/^([^()]{2,80})(?:\(个人独资\))?\((?:统一社会信用代码|纳税人识别号)/);if(m)add('name',m[1],[r],{role:'subject'});}
  // A standalone company line directly before an explicit identifier paragraph.
  for(const lab of regions.filter(r=>/^[（(]?纳税人识别号/.test(clean(r.observed_text)))){
   const nearby=regions.filter(r=>r!==lab&&cy(r)<cy(lab)&&cy(lab)-cy(r)<height*.12&&/公司|商贸馆|经营部|商行|商贸行|店|铺/.test(r.observed_text)&&!/[：:]|纳税人识别/.test(r.observed_text));
   if(nearby.length){const nearest=Math.max(...nearby.map(cy));for(const r of nearby.filter(r=>Math.abs(cy(r)-nearest)<h(r)*.5))add('name',clean(r.observed_text),[r,lab],{role:'subject'});}
  }
 }
 if(title(/^借条$/,'loan_note')){
  scan(/本人[:：]\s*([\p{Script=Han}*＊·]{2,12}?)\s*身份证(?:号码|号)\s*[:：]?\s*([0-9Xx*＊]{15,20})/gu,(m,p)=>{add('name',m[1],p,{role:'borrower'});add('identity_number',m[2],p,{role:'borrower'});});
  scan(/特向\s*([\p{Script=Han}*＊·]{2,12}?)\s*(?:借款[，,]?\s*)?身份证(?:号码|号)?\s*[:：]?\s*([0-9Xx*＊]{15,20})/gu,(m,p)=>{add('name',m[1],p,{role:'lender'});add('identity_number',m[2],p,{role:'lender'});});
  scan(/借\s*款(?:人民币(?:元)?[：:]?)?\s*([0-9]+(?:\.[0-9]{1,2})?)\s*元/g,(m,p)=>add('loan_amount',m[1],p,{currency:'CNY',basis:'loan_amount'}));
  label('loan_date',['立据日期'],{test:date});scan(/于\s*(\d{4}年\d{1,2}月\d{1,2}日)\s*前还清/g,(m,p)=>add('repayment_date',m[1],p));
 }
 for(const f of fields)if(fields.filter(v=>v.key===f.key&&v.role===f.role&&v.taxScope===f.taxScope).length>1){f.extractionAmbiguous=true;review.push({fieldId:f.id,key:f.key,role:f.role,reason:'multiple_content_candidates'});}
 const used=new Set(fields.flatMap(f=>f.source.regions.map(r=>r.regionId)));
 return{fields,review,format,coverage:{status:fields.length?'partial':'NEI',matchedFields:fields.length,lineItemsComplete:false,unmatchedRegionIds:regions.filter(r=>!used.has(r.region_id)).map(r=>r.region_id)}};
}

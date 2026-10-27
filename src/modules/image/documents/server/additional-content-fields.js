// Additive, title-gated facts for common Chinese forms. No dataset/sample lookups.
export const ADDITIONAL_CONTENT_VERSION='cn-additional-content/0.3';
const clean=s=>s.replace(/\s/g,'').replaceAll('（','(').replaceAll('）',')');
const box=r=>[Math.min(...r.polygon.map(p=>p[0])),Math.min(...r.polygon.map(p=>p[1])),Math.max(...r.polygon.map(p=>p[0])),Math.max(...r.polygon.map(p=>p[1]))];
const center=r=>{const b=box(r);return[(b[0]+b[2])/2,(b[1]+b[3])/2];};
const sameRow=(a,b)=>Math.abs(center(a)[1]-center(b)[1])<=Math.max(box(a)[3]-box(a)[1],box(b)[3]-box(b)[1])*.8;
const date=/^\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?(?:\s*\d{1,2}:\d{2}(?::\d{2})?)?$/;
const identity=/^\d[\dXx*＊]{14,19}$/;
export function enrichAdditionalFields(sample,{material,digest}) {
 const regions=sample.regions.filter(r=>r.observed_text?.trim());
 const width=sample.oriented_size[0],fields=[],review=[];
 const geometricRows=[];
 for(const r of [...regions].sort((a,b)=>center(a)[1]-center(b)[1])) {const group=geometricRows.find(g=>sameRow(g[0],r));if(group)group.push(r);else geometricRows.push([r]);}
 const ordered=geometricRows.flatMap(g=>g.sort((a,b)=>box(a)[0]-box(b)[0]));
 const format={kind:'unknown',id:'unknown',status:'NEI',reason:'supported_title_not_found',evidenceRegionIds:[]};
 function title(pattern,kind){const hits=regions.filter(r=>pattern.test(clean(r.observed_text)));if(!hits.length)return false;Object.assign(format,{kind,id:kind,status:'matched',reason:'explicit_title',evidenceRegionIds:hits.map(r=>r.region_id)});return true;}
 function add(key,value,proof,extra={}) {
  if(!value?.trim()||!proof.length)return;
  const role=extra.role??'transaction',sources=[...new Map(proof.map(r=>[r.region_id,r])).values()];
  if(material.fields.some(f=>f.key===key&&f.role===role&&f.taxScope===extra.taxScope))return;
  if(fields.some(f=>f.key===key&&f.role===role&&f.value===value.trim()))return;
  const anchor=sources.at(-1);
  const f={id:`additional-${fields.length+1}`,key,role,value:value.trim(),version:1,confidence:Math.min(...sources.map(r=>r.recognition_confidence)),...extra,source:{fileSha256:material.fileSha256,page:1,provider:'ocr',observedText:anchor.observed_text,polygon:structuredClone(anchor.polygon),coordinateSpace:'exif_oriented_image_pixels',precision:'ocr_region',ocrFingerprint:digest,extractionVersion:ADDITIONAL_CONTENT_VERSION,regions:sources.map(r=>({regionId:r.region_id,observedText:r.observed_text,polygon:structuredClone(r.polygon),confidence:r.recognition_confidence}))}};
  if(key.endsWith('_date')){if(/^\d{4}-\d{1,2}-\d{1,2}$/.test(value))f.dateFormat='YYYY-MM-DD';if(/^\d{4}年\d{1,2}月\d{1,2}日$/.test(value))f.dateFormat='YYYY年MM月DD日';}
  fields.push(f);
  if(f.confidence<.9)review.push({fieldId:f.id,key,role,reason:'recognition_requires_review',regionIds:sources.map(r=>r.region_id)});
 }
 function label(key,names,{role='transaction',test=s=>s.length>0,transform=s=>s,extra={}}={}) {
  for(const r of regions)for(const name of names) {
   const text=clean(r.observed_text);if(!text.startsWith(name))continue;
   const value=text.slice(name.length).replace(/^[:：]/,'');
   if(value&&test(value)){add(key,transform(value),[r],{role,...extra});break;}
   if(value&&value!==name.at(-1))continue;
   if(value)review.push({key,role,reason:'label_duplicate_suffix_requires_review',regionIds:[r.region_id]});
   const candidates=regions.filter(v=>v!==r&&sameRow(r,v)&&box(v)[0]>=box(r)[2]-Math.min(width*.04,(box(r)[2]-box(r)[0])*.25)&&box(v)[0]-box(r)[2]<width*.7&&test(clean(v.observed_text)));
   if(!candidates.length){review.push({key,role,reason:'content_label_value_missing',regionIds:[r.region_id]});break;}
   const nearest=Math.min(...candidates.map(v=>box(v)[0]));
   for(const v of candidates.filter(v=>Math.abs(box(v)[0]-nearest)<width*.015))add(key,transform(clean(v.observed_text)),[r,v],{role,...extra});
   break;
  }
 }
 function scan(regex,callback){let offset=0;const spans=ordered.map(r=>{const start=offset;offset+=r.observed_text.length+1;return{r,start,end:offset-1};});const text=ordered.map(r=>r.observed_text).join('\n');for(const m of text.matchAll(regex))callback(m,spans.filter(s=>s.end>m.index&&s.start<m.index+m[0].length).map(s=>s.r));}
 const cashOptions={test:s=>/^(?:人民币|[￥¥])?[\d,]+(?:\.\d{1,2})?元?$/.test(s),transform:s=>s.replace(/^(?:人民币|[￥¥])/,'').replace(/元$/,'').replaceAll(',',''),extra:{currency:'CNY'}};
 if(title(/^纳税证明$/,'tax_status_certificate')) {
  label('certificate_number',['文书凭证序号','证明编号','凭证序号'],{test:s=>/^[\dA-Z()-]{6,80}$/i.test(s)});
  scan(/(?:^|\n)([^\n：:]{2,60}?)\s*统一社会信用代码\s*[:：]\s*([A-Za-z0-9]{10,20})(?=[\s，,在]|$)/g,(m,p)=>{add('name',m[1],p,{role:'subject'});add('tax_identifier',m[2],p,{role:'subject'});});
  label('tax_identifier',['统一社会信用代码','纳税人识别号'],{role:'subject',test:s=>/^[\dA-Z]{10,20}$/i.test(s)});
  label('name',['纳税人名称'],{role:'subject'});
  label('issuing_authority',['税务机关','开具机关'],{role:'issuer',test:s=>/税务局|税务所|税务分局/.test(s)});
  label('issue_date',['开具日期','填发日期'],{test:s=>date.test(s)});
  for(const r of regions)if(/^[\p{Script=Han}]{2,12}纳税证\(\d{4}\)\d{4,30}$/u.test(clean(r.observed_text)))add('certificate_reference',clean(r.observed_text),[r]);
  scan(/截至\s*(\d{4}年\d{1,2}月\d{1,2}日)/g,(m,p)=>add('tax_status_date',m[1],p));
  label('paid_tax_amount',['自缴税款合计','已缴税费合计'],{...cashOptions,extra:{currency:'CNY',basis:'paid_tax_amount'}});
 }
 if(title(/^(?:生活缴费凭证|电费缴费凭证|水费缴费凭证)$/,'utility_payment_receipt')) {
  label('household_number',['户号','用户编号','客户编号'],{role:'subject',test:s=>/^[\dA-Za-z-]{5,40}$/.test(s)});
  label('registered_address',['住址信息','用电地址','用水地址','户址'],{role:'subject',test:s=>s.length>4});
  label('name',['户名','用户名称'],{role:'subject'});
  label('name',['收费单位'],{role:'payee',test:s=>s.length>3});
  label('payment_account',['支付账号','付款账号'],{role:'payer',test:s=>/^[\w.*+@-]{5,100}$/.test(s),extra:{privacyClass:'direct_identifier'}});
  label('transaction_number',['支付宝流水号','交易流水号','交易单号'],{test:s=>/^[A-Za-z0-9]{8,60}$/.test(s)});
  label('transaction_date',['付款时间','缴费时间'],{test:s=>date.test(s)});
  label('payment_amount',['实付金额','缴费金额','支付金额'],{...cashOptions,extra:{currency:'CNY',basis:'payment_amount'}});
  // Large unlabelled amount is accepted only once between title and fee labels.
  const headers=regions.filter(r=>/^生活缴费凭证$/.test(clean(r.observed_text)));
  const types=regions.filter(r=>/^(?:缴费类型|电费|水费|燃气费)$/.test(clean(r.observed_text))).sort((a,b)=>center(a)[1]-center(b)[1]).slice(0,1);
  if(headers.length===1&&types.length===1){const amounts=regions.filter(r=>center(r)[1]>box(headers[0])[3]&&center(r)[1]<box(types[0])[1]&&/^[￥¥]\d+(?:\.\d{1,2})?$/.test(clean(r.observed_text)));if(amounts.length===1)add('payment_amount',clean(amounts[0].observed_text).slice(1),[headers[0],amounts[0]],{currency:'CNY',basis:'payment_amount'});}
 }
 if(title(/^[<〈‹←]?(?:缴费详情|账单详情)$/,'utility_bill_detail')) {
  const householdPattern=/^([A-Za-z0-9-]{5,40})[|｜]([^|｜]{1,40})$|^(\d{5,40})([\p{Script=Han}*＊·]{1,40})$/u;
  label('household_number',['户号信息','用户信息'],{role:'subject',test:s=>householdPattern.test(s),transform:s=>(s.match(householdPattern)[1]||s.match(householdPattern)[3])});
  label('name',['户号信息','用户信息'],{role:'subject',test:s=>householdPattern.test(s),transform:s=>(s.match(householdPattern)[2]||s.match(householdPattern)[4])});
  label('household_number',['户号信息','用户编号','客户编号','缴费户号','缴费编号'],{role:'subject',test:s=>/^[A-Za-z0-9-]{5,40}$/.test(s)});
  label('name',['户号信息'],{role:'subject',test:s=>/^[\p{Script=Han}*＊·]{2,20}$/u.test(s)});
  label('name',['用户名','户名','缴费户名'],{role:'subject',test:s=>s.length>1&&!/单位|编号|交易/.test(s)});
  label('registered_address',['住址信息','用电地址','用水地址','地址'],{role:'subject',test:s=>s.length>4});
  label('name',['缴费单位','收费单位'],{role:'payee',test:s=>s.length>3});
  label('transaction_number',['交易单号'],{test:s=>/^[A-Za-z0-9]{8,60}$/.test(s)});
  label('displayed_payment_time',['交易时间'],{test:s=>date.test(s)});
  label('amount_due',['应缴金额'],{...cashOptions,extra:{currency:'CNY',basis:'amount_due'}});
  // Header provider and signed debit amount must precede the explicit status strip.
  // The printed minus is retained: no inferred refund/positive-payment conversion.
  const top=regions.filter(r=>/^[<〈‹←]?缴费详情$/.test(clean(r.observed_text)));
  const stops=regions.filter(r=>/^(?:已到账|支付成功|缴费成功|机构处理|缴费到账)$/.test(clean(r.observed_text))).sort((a,b)=>center(a)[1]-center(b)[1]);
  if(top.length===1&&stops.length) {
   const header=regions.filter(r=>center(r)[1]>box(top[0])[3]&&center(r)[1]<box(stops[0])[1]);
   for(const r of header.filter(r=>/^(?:国网|南方电网|[^()]{2,30}(?:电力|供电|供水|燃气))[^\n]{0,60}(?:公司|公司[（(][^）)]{1,20}[）)]|局)$/.test(clean(r.observed_text))))add('name',clean(r.observed_text),[top[0],r],{role:'payee'});
   const amounts=header.filter(r=>/^[+-]?[￥¥]?\d+(?:\.\d{1,2})?$/.test(clean(r.observed_text)));
   if(amounts.length===1)add('payment_amount',clean(amounts[0].observed_text).replace(/[￥¥]/,''),[top[0],amounts[0]],{currency:'CNY',basis:'displayed_signed_payment_amount',signedDisplay:true});
  }
  if(material.type==='certificate')review.push({reason:'declared_type_format_requires_review',declaredType:material.type,detectedFormat:'utility_bill_detail'});
 }
 if(title(/^借条$/,'loan_note')) {
  label('name',['借款人姓名','借款人'],{role:'borrower',test:s=>/^[\p{Script=Han}*＊·]{2,20}$/u.test(s)&&!s.includes('身份证')});
  label('name',['出借人姓名','出借人','贷款人'],{role:'lender',test:s=>/^[\p{Script=Han}*＊·]{2,20}$/u.test(s)&&!s.includes('身份证')});
  // Identity attaches only to an explicit party clause, never the nearest global number.
  scan(/借款人\s*[:：]\s*([^\s：:]{2,20})\s*身份证号码\s*[:：]?\s*([\dXx*＊]{15,20})/g,(m,p)=>{add('name',m[1],p,{role:'borrower'});if(identity.test(m[2]))add('identity_number',m[2],p,{role:'borrower'});});
  scan(/特向\s*([^\s：:]{2,20})\s*身\s*份证\s*号码为\s*[:：]\s*([\dXx*＊]{15,20})/g,(m,p)=>{add('name',m[1],p,{role:'lender'});if(identity.test(m[2]))add('identity_number',m[2],p,{role:'lender'});});
  label('identity_number',['借款人身份证号码','借款人身份证号'],{role:'borrower',test:s=>identity.test(s)});
  label('identity_number',['出借人身份证号码','出借人身份证号'],{role:'lender',test:s=>identity.test(s)});
  scan(/借款\s*(\d+(?:\.\d{1,2})?)\s*元/g,(m,p)=>add('loan_amount',m[1],p,{currency:'CNY',basis:'loan_amount'}));
  label('loan_date',['借款日期'],{test:s=>date.test(s)});
  label('repayment_date',['还款日期'],{test:s=>/^\d{4}年\d{1,2}月\d{1,2}日/.test(s),transform:s=>s.match(/^\d{4}年\d{1,2}月\d{1,2}日/)[0]});
 }
 const jd=regions.some(r=>/^京东(?:超市|商城)?$/.test(clean(r.observed_text)));
 const orders=regions.filter(r=>/^订单(?:编号|号)[:：]?$/.test(clean(r.observed_text))||/^订单(?:编号|号)[:：][A-Za-z0-9-]+$/.test(clean(r.observed_text)));
 if(jd&&orders.length){Object.assign(format,{kind:'jd_order',id:'jd_order',status:'matched',reason:'explicit_platform_and_order_label',evidenceRegionIds:orders.map(r=>r.region_id)});
  label('order_number',['订单编号','订单号'],{test:s=>/^[A-Za-z0-9-]{6,40}$/.test(s)});
  label('order_total',['实付金额','实付款'],{...cashOptions,extra:{currency:'CNY',basis:'order_total'}});
  label('name',['付款人'],{role:'payer',test:s=>/^[\p{Script=Han}*＊·]{1,20}$/u.test(s)});
  scan(/付款人\s*[:：]\s*([^\s，,：:]{1,20})(?=\s|联系电话)/g,(m,p)=>add('name',m[1],p,{role:'payer'}));
  label('transaction_date',['下单时间','交易时间','订单创建时间'],{test:s=>date.test(s)});
  // Do not guess which of advertisement/product/payment amounts is the paid total.
  for(const r of regions.filter(r=>/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}$/.test(r.observed_text.trim())))add('displayed_order_date',r.observed_text,[r]);
 }

 if(title(/^营业执照(?:\(副本\))?$/,'business_license')) {
  label('business_credit_code',['统一社会信用代码'],{role:'subject',test:s=>/^[0-9A-Z]{12,22}$/i.test(s)});
  if(!fields.some(f=>f.key==='business_credit_code'))for(const r of regions.filter(r=>clean(r.observed_text)==='统一社会信用代码')){
   const choices=regions.filter(v=>v!==r&&/^[0-9A-Z]{18}$/i.test(clean(v.observed_text))&&box(v)[1]>=box(r)[3]&&box(v)[1]-box(r)[3]<(box(r)[3]-box(r)[1])*3&&Math.abs(box(v)[0]-box(r)[0])<width*.12);
   for(const v of choices)add('business_credit_code',clean(v.observed_text),[r,v],{role:'subject'});
  }
  label('name',['名称'],{role:'subject',test:s=>s.length>1&&!/^类型|组成形式/.test(s)});
  label('name',['经营者','法定代表人','负责人'],{role:'operator',test:s=>/^[\p{Script=Han}*＊·]{2,20}$/u.test(s)});
  label('registration_date',['注册日期','成立日期'],{test:s=>date.test(s)});
  label('registered_address',['经营场所','住所'],{role:'subject',test:s=>s.length>2&&!/经营范围|注册日期/.test(s)});
 }
 if(title(/^授权书$/,'authorization_letter')) {
  label('authorization_contract_number',['授权经销合同号','授权合同号','合同编号'],{test:s=>/^[A-Za-z0-9()\-]{4,80}$/.test(s)});
  label('name',['兹授权','滋授权','被授权人'],{role:'grantee',test:s=>/^[\p{Script=Han}*＊·]{2,20}$/u.test(s)});
  scan(/为大陆地区经销代理\s*([^\n]{2,80}公司)/g,(m,p)=>add('name',m[1].trim(),p,{role:'grantor'}));
  scan(/授权期限[：:]?\s*(\d{4}年\d{1,2}月\d{1,2}日)\s*至\s*(\d{4}年\d{1,2}月\d{1,2}日)/g,(m,p)=>{add('authorization_start_date',m[1],p);add('authorization_end_date',m[2],p);});
 }
 if(title(/^在职证明$/,'employment_certificate')) {
  label('identity_number',['身份证号码','身份证号','身份证号碼','男，身份证号码','男,身份证号码','女，身份证号码','女,身份证号码'],{role:'subject',test:s=>identity.test(s)});
  label('employment_start_date',['入职日期时间','入职日期'],{test:s=>date.test(s)});
  scan(/兹证明[，,]?\s*([\p{Script=Han}*＊·]{2,12}?)\s*[男女，,]/gu,(m,p)=>add('name',m[1],p,{role:'subject'}));
  // When the sex marker is in the following block, the explicit proof label
  // may be OCR'd as a standalone block. Bind only nearby name-shaped values.
  label('name',['兹证明，','兹证明,','兹证明人','兹证明'],{role:'subject',test:s=>/^[\p{Script=Han}*＊·]{2,12}$/u.test(s)&&!/身份证|目前|业务|在职|日期/.test(s)});
 }
 if(title(/^出库单$/,'dispatch_note')) {
  label('dispatch_number',['出库编号','出库单号'],{test:s=>/^[A-Za-z0-9-]{4,60}$/.test(s)});
  label('transaction_date',['日期','出库日期'],{test:s=>date.test(s)});
  label('registered_address',['地址'],{role:'recipient',test:s=>s.length>1&&!/日期|客户/.test(s)});
  label('customer_contact',['客户'],{role:'recipient',test:s=>s.length>1&&!/^地址|日期/.test(s)});

  for(const contact of [...fields].filter(f=>f.key==='customer_contact')){
   const match=contact.value.match(/^([\p{Script=Han}*＊·]{2,20})([0-9][0-9*＊-]{6,20})$/u);
   if(match){const proof=contact.source.regions.map(v=>regions.find(r=>r.region_id===v.regionId)).filter(Boolean);add('name',match[1],proof,{role:'recipient'});add('phone_number',match[2],proof,{role:'recipient',displayOnly:true});}
  }
  const heading=regions.find(r=>clean(r.observed_text)==='出库单');
  if(heading)for(const r of regions.filter(r=>center(r)[1]<box(heading)[1]&&/公司$/.test(clean(r.observed_text))))add('name',clean(r.observed_text),[r],{role:'issuer'});
  const columnNames=['编号','名称','规格','数量'];
  const columns=columnNames.map(n=>regions.filter(r=>clean(r.observed_text)===n));
  if(columns.every(c=>c.length===1)){
   const heads=columns.map(c=>c[0]),centers=heads.map(h=>center(h)[0]),bottom=Math.max(...heads.map(h=>box(h)[3]));
   const totals=regions.filter(r=>/^合计[:：]?/.test(clean(r.observed_text))&&box(r)[1]>bottom),end=totals.length?Math.min(...totals.map(r=>box(r)[1])):Infinity;
   const cells=regions.filter(r=>center(r)[1]>bottom+Math.max(...heads.map(h=>box(h)[3]-box(h)[1]))*.2&&box(r)[3]<end),rowGroups=[];
   for(const r of [...cells].sort((a,b)=>center(a)[1]-center(b)[1])){let g=rowGroups.find(g=>sameRow(g[0],r));if(g)g.push(r);else rowGroups.push([r]);}
   const rows=[],proof=[...heads];
   for(const group of rowGroups){
    const buckets=centers.map(()=>[]);
    for(const r of group){const x=center(r)[0];let k=centers.reduce((best,c,i)=>Math.abs(c-x)<Math.abs(centers[best]-x)?i:best,0);if(Math.abs(centers[k]-x)<width*.16)buckets[k].push(r);}
    if(!buckets.every(b=>b.length===1)){review.push({key:'dispatch_items',reason:'dispatch_row_incomplete',regionIds:group.map(r=>r.region_id)});continue;}
    const values=buckets.map(b=>clean(b[0].observed_text));
    if(!/^\d+(?:\.\d+)?$/.test(values[3])){review.push({key:'dispatch_items',reason:'dispatch_quantity_ambiguous',regionIds:group.map(r=>r.region_id)});continue;}
    rows.push({item_code:values[0],item_description:values[1],specification:values[2],quantity:values[3]});proof.push(...buckets.flat());
   }
   if(rows.length)add('dispatch_items',JSON.stringify(rows),proof,{valueType:'item_table',rowsComplete:!review.some(r=>r.reason==='dispatch_row_incomplete'||r.reason==='dispatch_quantity_ambiguous')});
  }
 }

 // Locale-neutral displayed payment labels. Preserve punctuation and do not
 // infer currency or thousands separators from the dataset/country.
 if(format.kind==='unknown'&&regions.some(r=>clean(r.observed_text)==='TOTAL')&&regions.some(r=>clean(r.observed_text)==='CASH')) {
  Object.assign(format,{kind:'retail_payment_receipt',id:'retail_payment_receipt',status:'matched',reason:'explicit_total_and_cash_labels',evidenceRegionIds:regions.filter(r=>/^(TOTAL|CASH)$/.test(clean(r.observed_text))).map(r=>r.region_id)});
  label('displayed_receipt_total',['TOTAL'],{test:s=>/^\d+(?:[.,]\d+)*$/.test(s)});
  label('displayed_cash',['CASH'],{test:s=>/^\d+(?:[.,]\d+)*$/.test(s)});
  for(const f of fields)if(['displayed_receipt_total','displayed_cash'].includes(f.key))review.push({fieldId:f.id,key:f.key,reason:'currency_and_number_locale_not_confirmed'});
 }
 for(const f of fields)if(f.key==='tax_identifier'&&!/^(?:[\dA-Z]{15}|[\dA-Z]{18}|[\dA-Z]{20})$/i.test(f.value))review.push({fieldId:f.id,key:f.key,role:f.role,reason:'tax_identifier_shape_requires_review',valuePreserved:true});
 for(const f of fields)if(fields.filter(v=>v.key===f.key&&v.role===f.role&&v.taxScope===f.taxScope).length>1){f.extractionAmbiguous=true;review.push({fieldId:f.id,key:f.key,role:f.role,reason:'multiple_content_candidates'});}
 const used=new Set(fields.flatMap(f=>f.source.regions.map(r=>r.regionId)));
 return{fields,review,format,coverage:{status:fields.length?'partial':'NEI',reason:fields.length?'format_content_candidates':'no_supported_content_candidates',matchedFields:fields.length,lineItemsComplete:false,unmatchedRegionIds:regions.filter(r=>!used.has(r.region_id)).map(r=>r.region_id)}};
}

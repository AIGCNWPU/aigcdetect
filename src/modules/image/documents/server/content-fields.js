// Chinese document content adapters. These extract displayed facts, not legal truth.
// Every candidate keeps whole OCR polygons; regular-expression offsets are not boxes.
export const CONTENT_FIELDS_VERSION='cn-content-fields/0.2';
export const CONTENT_FORMAT_CATALOG=Object.freeze([
 {id:'tax_payment_certificate',titles:['税收完税证明'],fieldFamilies:['certificate_number','name','tax_identifier','issuing_authority','issue_date','tax_type','tax_period','treasury_date','paid_tax_amount'],scope:'displayed taxpayer/issuer and complete aligned tax-table columns'},
 {id:'account_commitment',titles:['承诺函'],fieldFamilies:['name','identity_number','account_list','issue_date','commitment_end_date'],scope:'bounded explicitly registered account clause; no assumption of unique account ownership'},
 {id:'legacy_vat_electronic_ordinary',titles:['增值税电子普通发票'],fieldFamilies:['name','tax_identifier','quantity','unit_price','line_net_amount','tax_rate','line_tax_amount','net_amount','tax_amount','gross_amount','gross_amount_words'],scope:'printed row/column positions; independent of legal tax eligibility'},
 {id:'household_register_card',titles:['常住人口登记卡'],fieldFamilies:['name','identity_number'],scope:'name/identity cells; does not repair checksum or administrative area'},
 {id:'purchase_contract',titles:['购销合同','采购合同'],fieldFamilies:['order_number','name','transaction_date','quantity','unit_price','line_net_amount','contract_total','item_description'],scope:'parties and explicit purchase row; single-row amount marked derivation'},
 {id:'rental_contract',titles:['房屋租赁合同'],fieldFamilies:['name','identity_number','registered_address','monthly_rent','deposit_months','prepaid_months','initial_payment','initial_payment_composition','payment_adjustment'],scope:'explicit rent/payment composition; adjustment text prevents naive arithmetic'},
]);
const compact=s=>s.replace(/\s/g,'').replaceAll('（','(').replaceAll('）',')');
const bounds=r=>[Math.min(...r.polygon.map(p=>p[0])),Math.min(...r.polygon.map(p=>p[1])),Math.max(...r.polygon.map(p=>p[0])),Math.max(...r.polygon.map(p=>p[1]))];
const cx=r=>{const b=bounds(r);return(b[0]+b[2])/2;};
const cy=r=>{const b=bounds(r);return(b[1]+b[3])/2;};
const height=r=>bounds(r)[3]-bounds(r)[1];
const row=(a,b)=>Math.abs(cy(a)-cy(b))<=Math.max(height(a),height(b))*.8;
const numeric=s=>/^[+-]?\d{1,15}(?:\.\d{1,6})?$/.test(s);
const money=s=>compact(s).replace(/^(?:人民币|CNY|[¥￥])/,'').replace(/元$/,'');
const sameSlot=(a,b)=>a.key===b.key&&a.role===b.role&&a.taxScope===b.taxScope;

/** Pure additive extraction. Caller merges fields and applies returned format metadata.
 * Does not read labels, annotations, filenames or sample IDs, and performs no API calls.
 */
export function enrichContentFields(sample,{material,digest}) {
 const regions=sample.regions.filter(r=>r.observed_text?.trim()),fields=[],review=[];
 const width=sample.oriented_size[0];
 let lineItemsComplete=false,detectedLineCount=0,extractedLineCount=0;
 const sorted=[...regions].sort((a,b)=>cy(a)-cy(b)||cx(a)-cx(b));
 const all=sorted.map(r=>r.observed_text).join('\n');
 const hasTitle=pattern=>regions.some(r=>pattern.test(compact(r.observed_text)));
 const titles=regions.filter(r=>/承诺函|税收完税证明|常住人口登记卡|购销合同|采购合同|房屋租赁合同|增值税电子|电子普通发票/.test(compact(r.observed_text)));
 const format={kind:'unknown',status:'NEI',reason:'supported_title_not_found',evidenceRegionIds:titles.map(r=>r.region_id)};
 function make(key,value,proof,extra={}) {
  if(typeof value!=='string'||!value.trim()||!proof.length)return;
  const unique=[...new Map(proof.map(r=>[r.region_id,r])).values()];
  const anchor=unique.at(-1),role=extra.role??'transaction';
  const candidate={key,role,taxScope:extra.taxScope};
  // Existing explicit/layout extraction wins. Never silently replace its candidate.
  if(material.fields.some(f=>sameSlot(f,candidate)))return;
  if(fields.some(f=>sameSlot(f,candidate)&&f.value===value&&f.source.regions.map(r=>r.regionId).join()===unique.map(r=>r.region_id).join()))return;
  const f={id:`content-${fields.length+1}`,key,role,value:value.trim(),version:1,confidence:Math.min(...unique.map(r=>r.recognition_confidence)),...extra,
   source:{fileSha256:material.fileSha256,page:1,provider:'ocr',observedText:anchor.observed_text,polygon:structuredClone(anchor.polygon),coordinateSpace:'exif_oriented_image_pixels',precision:'ocr_region',ocrFingerprint:digest,extractionVersion:CONTENT_FIELDS_VERSION,
    regions:unique.map(r=>({regionId:r.region_id,observedText:r.observed_text,polygon:structuredClone(r.polygon),confidence:r.recognition_confidence}))}};
  if(key.endsWith('_date')) {
   if(/^\d{4}-\d{2}-\d{2}$/.test(value))f.dateFormat='YYYY-MM-DD';
   if(/^\d{4}年\d{1,2}月\d{1,2}日$/.test(value))f.dateFormat='YYYY年MM月DD日';
   if(/^\d{4}\.\d{1,2}\.\d{1,2}$/.test(value))f.dateFormat='YYYY.MM.DD';
  }
  fields.push(f);
  if(f.confidence<.9)review.push({fieldId:f.id,key,role,reason:'recognition_requires_review',regionIds:unique.map(r=>r.region_id)});
 }
 function cash(key,value,proof,extra={}) {
  const v=money(value);if(numeric(v))make(key,v,proof,{currency:'CNY',basis:key,...extra});
 }
 // Full-paragraph matches may span OCR rows. Evidence maps back to exact raw rows.
 function scan(regex,fn,list=sorted) {
  let offset=0;
  const spans=list.map(r=>{const start=offset;offset+=r.observed_text.length+1;return{r,start,end:offset-1};});
  const text=list.map(r=>r.observed_text).join('\n');
  for(const match of text.matchAll(regex)) {
   const proof=spans.filter(s=>s.end>match.index&&s.start<match.index+match[0].length).map(s=>s.r);
   fn(match,proof);
  }
 }
 // Generic labelled values: inline, or nearest right-hand OCR cell in the same row.
 function label(key,labels,{role='transaction',test=s=>s.length>0,transform=s=>s,area=()=>true,extra={}}={}) {
  for(const r of regions.filter(area)) {
   const t=compact(r.observed_text);
   for(const name of labels) {
    if(!t.startsWith(name))continue;
    const rest=t.slice(name.length).replace(/^[：:]/,'');
    const exact=t===name||t===name+'：'||t===name+':';
    if(!exact&&rest&&test(rest)){make(key,transform(rest),[r],{role,...extra});break;}
    if(!exact)continue;
    const candidates=regions.filter(v=>v!==r&&area(v)&&row(r,v)&&bounds(v)[0]>=bounds(r)[2]&&bounds(v)[0]-bounds(r)[2]<width*.26&&test(compact(v.observed_text)));
    if(!candidates.length){review.push({key,role,reason:'content_label_value_missing',regionIds:[r.region_id]});break;}
    const nearest=Math.min(...candidates.map(v=>bounds(v)[0]));
    const values=candidates.filter(v=>Math.abs(bounds(v)[0]-nearest)<width*.02);
    for(const v of values)make(key,transform(compact(v.observed_text)),[r,v],{role,...extra});
    break;
   }
  }
 }
 const idTest=s=>/^[0-9][0-9Xx*＊]{14,19}$/.test(s);
 if(hasTitle(/^承诺函$/)) {
  Object.assign(format,{kind:'account_commitment',status:'matched',reason:'explicit_title'});
  label('identity_number',['身份证号码','身份证号','公民身份号码'],{role:'subject',test:idTest});
  for(const r of regions){
   const raw=compact(r.observed_text),name=raw.match(/^本人\(姓名[：:]?(.*)$/);
   if(name){
    const inline=name[1].split(/身份证|身份證|证件|[，,）)]/)[0];
    if(/^[\p{Script=Han}*＊·]{2,20}$/u.test(inline))make('name',inline,[r],{role:'subject'});
    else if(!inline){
     const values=regions.filter(v=>v!==r&&row(r,v)&&bounds(v)[0]>=bounds(r)[2]-width*.05&&/^[\p{Script=Han}*＊·]{2,20}$/u.test(compact(v.observed_text))&&!/身份证|本人|姓名|承诺|账户|身份信息/.test(v.observed_text));
     for(const v of values)make('name',compact(v.observed_text),[r,v],{role:'subject'});
    }
   }
  }
  if(!fields.some(f=>f.key==='identity_number'))for(const r of regions.filter(r=>/身份证号码|身份证号/.test(r.observed_text))){
   const inline=compact(r.observed_text).match(/身份证(?:号码|号)[：:]?([0-9Xx*＊]{15,20})/);
   if(inline)make('identity_number',inline[1],[r],{role:'subject'});
   else{
    const values=regions.filter(v=>v!==r&&row(r,v)&&bounds(v)[0]>=bounds(r)[2]-width*.08&&idTest(compact(v.observed_text)));
    for(const v of values)make('identity_number',compact(v.observed_text),[r,v],{role:'subject'});
   }
  }
  if(!fields.some(f=>f.key==='identity_number'))for(const lab of regions.filter(r=>/身份证号码|身份证号/.test(r.observed_text))){
   for(const r of regions.filter(r=>r!==lab&&row(r,lab)&&bounds(r)[0]>=bounds(lab)[2]-width*.04)){
    const m=compact(r.observed_text).match(/^([0-9][0-9Xx*＊]{14,19})(?=[^0-9Xx*＊]|$)/);if(m)make('identity_number',m[1],[lab,r],{role:'subject'});
   }
  }
  // Account lists are only taken from the explicit 注册的账户 ... 所有 clause.
  scan(/注册的\s*(?:支付宝|微信)?\s*账[户号][\s\S]{0,1500}?(?:为本人|以下简称)/g,(m,p)=>{
   const accounts=[...m[0].matchAll(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g)].map(x=>x[0]);
   if(accounts.length)make('account_list',JSON.stringify([...new Set(accounts)].sort()),p,{role:'subject',accountType:'email',privacyClass:'direct_identifier'});
  });
  label('issue_date',['时间','签署日期'],{test:s=>/^\d{4}[.年/-]\d{1,2}[.月/-]\d{1,2}日?$/.test(s)});
  scan(/承诺在\s*(\d{4}年\d{1,2}月\d{1,2}(?:日)?)\s*前/g,(m,p)=>make('commitment_end_date',m[1],p));
 }
 const taxHeaderEvidence=regions.filter(r=>/^(?:税务机关|纳税人识别号|纳税人名称|缴费人名称|填发日期)[：:]?/.test(compact(r.observed_text)));
 const structuredTax=(taxHeaderEvidence.length>=4||(taxHeaderEvidence.length>=3&&regions.some(r=>/^税款所属时?期$/.test(compact(r.observed_text)))))&&regions.some(r=>/^No\.?(?:\d+)?$|完税|税证明/i.test(compact(r.observed_text)));
 if(hasTitle(/^税收完税证明$/)||structuredTax) {
  Object.assign(format,{kind:'tax_payment_certificate',status:'matched',reason:hasTitle(/^税收完税证明$/)?'explicit_title':'explicit_tax_header_structure',evidenceRegionIds:taxHeaderEvidence.map(r=>r.region_id)});
  label('name',['纳税人名称','缴费人名称'],{role:'subject'});
  label('tax_identifier',['纳税人识别号','统一社会信用代码'],{role:'subject',test:s=>/^[0-9A-Z]{15,20}$/i.test(s)});
  label('issuing_authority',['税务机关'],{role:'issuer',test:s=>s.length>5&&/税务局|税务分局|税务所/.test(s)});
  label('issue_date',['填发日期'],{test:s=>/^\d{4}[-年]\d{1,2}[-月]\d{1,2}日?$/.test(s)});
  for(const r of regions)if(/^[\dA-Z]*[（(]\d{1,4}[)）][\p{Script=Han}A-Z0-9]*证明[\dA-Z]+$/u.test(compact(r.observed_text)))make('certificate_number',compact(r.observed_text),[r]);
  label('certificate_number',['No.','No','NO.','NO'],{test:s=>/^\d{4,30}$/.test(s)});
  for(const r of regions)if(/^[（(]\d{1,4}[)）][\p{Script=Han}]{1,10}\d{4,30}$/u.test(compact(r.observed_text)))make('certificate_number',compact(r.observed_text),[r]);
  const originalHeaders=regions.filter(r=>compact(r.observed_text)==='原凭证号');
  for(const header of originalHeaders){
   const boundary=regions.filter(r=>/^(?:金额合计|本页以下|备注)/.test(compact(r.observed_text))&&cy(r)>cy(header));
   const end=boundary.length?Math.min(...boundary.map(cy)):sample.oriented_size[1];
   const values=regions.filter(r=>cy(r)>bounds(header)[3]&&cy(r)<end&&Math.abs(cx(r)-cx(header))<width*.07&&/^\d{4,30}$/.test(compact(r.observed_text)));
   for(const r of values)make('original_voucher_number',compact(r.observed_text),[header,r]);
  }
  taxTable();
 }
 function taxTable() {
  const definitions=[['tax_type',/^税种$/],['tax_period',/^税款所属时期$/],['treasury_date',/^入\(退\)库日期$/],['paid_tax_amount',/^实缴\(退\)税额$/]];
  const headers=definitions.map(([,pattern])=>regions.filter(r=>pattern.test(compact(r.observed_text))));
  const end=regions.filter(r=>/以上情况[，,]?特此证明/.test(compact(r.observed_text)));
  if(headers.some(a=>a.length!==1)||end.length!==1||headers.some(a=>!row(a[0],headers[0][0]))) {
   review.push({reason:'tax_table_boundaries_missing_or_ambiguous',keys:definitions.map(d=>d[0])});return;
  }
  const hs=headers.map(a=>a[0]),lefts=hs.map((h,i)=>i?(bounds(hs[i-1])[2]+bounds(h)[0])/2:bounds(h)[0]-width*.015);
  const right=(i)=>i<hs.length-1?lefts[i+1]:Math.min(width,bounds(hs[i])[2]+width*.025);
  const cells=hs.map((h,i)=>regions.filter(r=>cy(r)>bounds(h)[3]&&cy(r)<bounds(end[0])[1]&&cx(r)>=lefts[i]&&cx(r)<right(i)));
  // Type anchors and all date/amount cells must share exactly one geometric row.
  const types=cells[0].filter(r=>/^(?:[\p{Script=Han}]{1,20}(?:税|附加)|其他收入)$/u.test(compact(r.observed_text))).sort((a,b)=>cy(a)-cy(b));
  if(!types.length){review.push({reason:'tax_table_rows_missing'});return;}
  const owner=cell=>{
   const ranked=types.map((r,i)=>({i,d:Math.abs(cy(cell)-cy(r))})).sort((a,b)=>a.d-b.d);
   return ranked[0].d<=height(cell)*1.2&&(!ranked[1]||ranked[1].d-ranked[0].d>2)?ranked[0].i:-1;
  };
  const records=definitions.map(()=>[]),proofs=definitions.map(()=>[]),complete=definitions.map(()=>true);
  for(let i=0;i<types.length;i++) {
   const anchor=types[i],mapped=cells.map(col=>col.filter(r=>owner(r)===i).sort((a,b)=>cx(a)-cx(b)));
   for(let c=0;c<definitions.length;c++) {
    const selected=mapped[c];let value=selected.map(r=>compact(r.observed_text)).join('');
    let valid=selected.length===1;
    if(c===1) {
     const dates=[...value.matchAll(/\d{4}-\d{2}-\d{2}/g)];
     const residue=value.replace(/\d{4}-\d{2}-\d{2}/g,'').replace(/至|[-—~～]/g,'');
     valid=selected.length>0&&dates.length===2&&!residue;
    }
    if(c===2)valid=valid&&/^\d{4}-\d{2}-\d{2}$/.test(value);
    if(c===3)valid=valid&&numeric(value);
    if(!valid){complete[c]=false;continue;}
    records[c].push({row:i+1,taxType:compact(anchor.observed_text),value});
    proofs[c].push(anchor,...selected);
   }
  }
  // Unanchored date/amount data implies an omitted row; that column is incomplete.
  for(let c=1;c<cells.length;c++)for(const cell of cells[c])if((/\d{4}-\d{2}-\d{2}/.test(cell.observed_text)||numeric(compact(cell.observed_text)))&&owner(cell)<0)complete.fill(false);
  for(let c=0;c<definitions.length;c++) {
   const [key]=definitions[c];
   if(!complete[c]||records[c].length!==types.length){review.push({key,reason:'tax_table_column_cells_missing_or_ambiguous',detectedRows:types.length,completeRows:records[c].length});continue;}
   make(key,JSON.stringify(records[c]),[...hs,...proofs[c],end[0]],{valueType:'table_column',dateCollection:key==='treasury_date',tableRows:records[c].length,columnComplete:true,tableComplete:complete.every(Boolean)});
  }
 }
 if(hasTitle(/^常住人口登记卡$/)) {
  Object.assign(format,{kind:'household_register_card',status:'matched',reason:'explicit_title'});
  const surname=regions.filter(r=>compact(r.observed_text)==='姓'),names=regions.filter(r=>compact(r.observed_text)==='名');
  for(const left of surname)for(const right of names.filter(r=>row(left,r)&&cx(r)>cx(left))) {
   const values=regions.filter(r=>row(r,right)&&bounds(r)[0]>bounds(right)[2]&&cx(r)<width*.5&&/^[\p{Script=Han}*＊·]{2,20}$/u.test(compact(r.observed_text)));
   if(values.length===1)make('name',compact(values[0].observed_text),[left,right,values[0]],{role:'subject'});
  }
  label('name',['姓名'],{role:'subject',test:s=>/^[\p{Script=Han}*＊·]{2,20}$/u.test(s)});
  // Numeric candidate must lie in the left identity-number cell of this format.
  for(const r of regions)if(idTest(compact(r.observed_text))&&cx(r)<width*.52&&cy(r)>sample.oriented_size[1]*.35&&cy(r)<sample.oriented_size[1]*.6)
   make('identity_number',compact(r.observed_text),[titles.find(r=>/常住人口/.test(r.observed_text)),r].filter(Boolean),{role:'subject'});
 }
 if(hasTitle(/^(?:货物|商品|产品)?(?:购销|采购)合同$/)) {
  Object.assign(format,{kind:'purchase_contract',status:'matched',reason:'explicit_title'});
  label('order_number',['订单编号','订单号','合同编号'],{test:s=>/^[A-Za-z0-9_-]{4,80}$/.test(s)});
  label('transaction_date',['交易时间','交易日期'],{test:s=>/^\d{4}[-年]\d{1,2}[-月]\d{1,2}日?$/.test(s)});
  label('name',['甲方(需货方)','甲方(采购方)','甲方'],{role:'buyer',test:s=>/公司|厂|机构|大学|商店|商行/.test(s)});
  label('name',['乙方(供货方)','乙方(供应方)','乙方'],{role:'seller',test:s=>/公司|厂|机构|大学|商店|商行/.test(s)});
  label('name',['付款方','付款人'],{role:'payer',test:s=>/^[\p{Script=Han}*＊·]{2,30}$/u.test(s)});
  const amountHeaders=regions.filter(r=>compact(r.observed_text)==='金额'),priceHeaders=regions.filter(r=>compact(r.observed_text)==='单价'),quantityHeaders=regions.filter(r=>compact(r.observed_text)==='数量');
  for(const ah of amountHeaders) {
   const qh=quantityHeaders.find(r=>row(r,ah)),ph=priceHeaders.find(r=>row(r,ah));
   if(!qh||!ph)continue;
   const rows=regions.filter(r=>cy(r)>bounds(ah)[3]&&cy(r)<cy(ah)+sample.oriented_size[1]*.12&&cx(r)>cx(ah)-width*.03&&cx(r)<cx(ah)+width*.1&&numeric(compact(r.observed_text)));
   for(const r of rows) {
    const scope=`purchase-row:${r.region_id}`;
    cash('line_net_amount',r.observed_text,[ah,r],{taxScope:scope});
    for(const [key,h,next]of[['quantity',qh,ph],['unit_price',ph,ah]]) {
     const vs=regions.filter(v=>row(v,r)&&cx(v)>bounds(h)[0]-width*.02&&cx(v)<bounds(next)[0]&&numeric(compact(v.observed_text)));
     for(const v of vs)make(key,compact(v.observed_text),[h,v],{taxScope:scope,...(key==='unit_price'?{currency:'CNY',basis:key}:{})});
    }
    if(rows.length===1)cash('contract_total',r.observed_text,[ah,r],{derivation:'single_explicit_product_amount'});
   }
  }
  label('contract_total',['合同总金额','合同金额','合计金额(小写)','合计金额（小写）'],{test:s=>numeric(money(s)),transform:money,extra:{currency:'CNY',basis:'contract_total'}});
  const productHeaders=regions.filter(r=>compact(r.observed_text)==='产品名称');
  for(const h of productHeaders) {
   const next=regions.find(r=>compact(r.observed_text)==='规格型号'&&row(h,r));
   if(next) {
    const cells=sorted.filter(r=>cy(r)>bounds(h)[3]&&cy(r)<cy(h)+sample.oriented_size[1]*.1&&cx(r)>bounds(h)[0]-width*.03&&cx(r)<bounds(next)[0]&&r.observed_text.trim());
    if(cells.length)make('item_description',cells.map(r=>r.observed_text).join(' '),[h,...cells]);
   }
  }
 }
 if(hasTitle(/^房屋租赁合同$/)) {
  Object.assign(format,{kind:'rental_contract',status:'matched',reason:'explicit_title'});
  const parties=regions.filter(r=>/^[甲乙]方\((房主|出租人|承租人)\)[：:]/.test(compact(r.observed_text))).sort((a,b)=>cy(a)-cy(b));
  for(let i=0;i<parties.length;i++) {
   const p=parties[i],role=compact(p.observed_text).startsWith('甲')?'lessor':'lessee',end=parties[i+1]?cy(parties[i+1]):cy(p)+height(p)*5;
   const inline=compact(p.observed_text).replace(/^[甲乙]方\([^)]*\)[：:]/,'');
   if(inline)make('name',inline,[p],{role});
   else {
    const values=regions.filter(r=>row(r,p)&&bounds(r)[0]>bounds(p)[2]&&/^[\p{Script=Han}*＊·]{2,30}$/u.test(compact(r.observed_text)));
    if(values.length===1)make('name',compact(values[0].observed_text),[p,values[0]],{role});
   }
   const labels=regions.filter(r=>/^(?:证件编号|身份证号|身份证号码)[：:]?$/.test(compact(r.observed_text))&&cy(r)>=cy(p)-height(p)&&cy(r)<end&&parties.every(other=>other===p||Math.abs(cy(r)-cy(p))<Math.abs(cy(r)-cy(other))));
   for(const lab of labels) {
    const candidates=regions.filter(r=>idTest(compact(r.observed_text))&&cy(r)>=cy(lab)-height(lab)&&cy(r)<end);
    const aligned=candidates.filter(r=>row(r,lab)&&bounds(r)[0]>=bounds(lab)[2]);
    const ids=aligned.length?aligned:candidates.filter(r=>cy(r)>cy(lab)&&cy(r)-cy(lab)<height(lab)*4);
    for(const r of ids)make('identity_number',compact(r.observed_text),[p,lab,r],{role});
   }
  }
  scan(/坐落在([\s\S]{1,200}?)(?:房间|出租给乙方)/g,(m,p)=>make('registered_address',m[1].replace(/\s+/g,' ').trim(),p,{role:'property'}));
  // Explicit small-written monthly rent only; never silently repair OCR capital words.
  scan(/月租金为[\s\S]{0,100}?[（(]小写\s*[：:]\s*[¥￥]\s*(\d+(?:\.\d+)?)/g,(m,p)=>cash('monthly_rent',m[1],p));
  const numbers={'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10};
  scan(/押([一二两三四五六七八九十\d]+)付([一二两三四五六七八九十\d]+)/g,(m,p)=>{
   for(const [key,v]of[['deposit_months',m[1]],['prepaid_months',m[2]]]) {
    const n=numbers[v]??(/^\d{1,2}$/.test(v)?Number(v):null);if(n!==null)make(key,String(n),p);
   }
  });
  scan(/第一次[\s\S]{0,100}?支付\s*(\d+(?:\.\d+)?)元/g,(m,p)=>cash('initial_payment',m[1],p));
  scan(/其中包括[\s\S]{1,150}?[。；;]/g,(m,p)=>make('initial_payment_composition',m[0].replace(/\s+/g,''),p));
  // Preserve concessions/offsets separately; downstream arithmetic must abstain.
  for(const r of regions)if(/优惠|减免|抵扣|折扣|免租|已付|另付|另收|服务费|物业费/.test(r.observed_text))make('payment_adjustment',r.observed_text,[r]);
 }
 const legacyTitle=regions.some(r=>/^[\p{Script=Han}]{0,12}增值税电子(?:普通发票)?$/u.test(compact(r.observed_text))&&regions.some(v=>/^(?:[\p{Script=Han}]{0,12}增值税电子)?普通发票$/u.test(compact(v.observed_text))&&(v===r||row(r,v))));
 if((material.type==='invoice'||material.type==='digital_invoice'||material.type==='unknown')&&(legacyTitle||hasTitle(/^[\p{Script=Han}]{0,12}电子普通发票$/u))) {
  Object.assign(format,{kind:'legacy_vat_electronic_ordinary',status:'matched',reason:'explicit_title',invoiceSubtype:'vat_electronic_ordinary'});
  legacyVat();
 }
 function legacyVat() {
  const marker=regions.find(r=>compact(r.observed_text)==='购买方'),seller=regions.find(r=>compact(r.observed_text)==='销售方');
  const tableHeader=regions.find(r=>/货物或应税劳务|服务名称/.test(r.observed_text));
  for(const [role,start,end]of[['buyer',marker,tableHeader],['seller',seller,null]]) {
   if(!start)continue;
   const area=r=>cx(r)<width*.53&&cy(r)>cy(start)-height(start)*2&&(!end||cy(r)<bounds(end)[1]);
   for(const r of regions.filter(area)) {
    const m=compact(r.observed_text).match(/^(?:名称|称)[：:](.+)$/);
    if(m)make('name',m[1],[start,r],{role});
   }
   label('tax_identifier',['纳税人识别号','统一社会信用代码'],{role,area,test:s=>/^[A-Z0-9]{15,20}$/i.test(s)});
  }
  const header=key=>regions.filter(r=>compact(r.observed_text)===key&&(!tableHeader||row(r,tableHeader)));
  const netH=header('金额'),taxH=header('税额'),rateH=header('税率');
  if(netH.length!==1||taxH.length!==1||rateH.length!==1){review.push({reason:'legacy_vat_headers_missing_or_ambiguous'});return;}
  const net=netH[0],tax=taxH[0],rate=rateH[0];
  const gross=regions.filter(r=>/^\(小写\)[¥￥][+-]?\d+(?:\.\d+)?$/.test(compact(r.observed_text)));
  const grossLabel=regions.filter(r=>/^价税合计\(大写\)/.test(compact(r.observed_text)));
  for(const r of gross)cash('gross_amount',compact(r.observed_text).replace(/^\(小写\)/,''),[r]);
  for(const h of grossLabel) {
   const inline=compact(h.observed_text).replace(/^价税合计\(大写\)/,'');
   if(inline)make('gross_amount_words',inline,[h],{currency:'CNY'});
   else for(const r of regions.filter(r=>row(r,h)&&bounds(r)[0]>bounds(h)[2]&&cx(r)<width*.7&&/[元圆角分整]/.test(r.observed_text)))make('gross_amount_words',compact(r.observed_text),[h,r],{currency:'CNY'});
  }
  const bottom=gross.length?Math.min(...gross.map(cy)):sample.oriented_size[1]*.75;
  // Summary currency signs and same row establish totals even when 合计 OCR is absent.
  const sums=regions.filter(r=>cy(r)>cy(net)+height(net)*3&&cy(r)<bottom&&/^[¥￥][+-]?\d+(?:\.\d+)?$/.test(compact(r.observed_text)));
  for(const n of sums.filter(r=>cx(r)>bounds(net)[0]-width*.03&&cx(r)<bounds(rate)[0])) {
   const ts=sums.filter(r=>row(r,n)&&cx(r)>bounds(tax)[0]-width*.02);
   if(ts.length!==1)continue;
   cash('net_amount',n.observed_text,[net,n]);cash('tax_amount',ts[0].observed_text,[tax,ts[0]]);
  }
  const columns=[['quantity',header('数量')[0]],['unit_price',header('单价')[0]],['line_net_amount',net],['tax_rate',rate],['line_tax_amount',tax]].filter(x=>x[1]);
  const rates=regions.filter(r=>cy(r)>bounds(rate)[3]&&cy(r)<bottom&&cx(r)>bounds(rate)[0]-width*.03&&cx(r)<bounds(tax)[0]&&/^(?:\d+(?:\.\d+)?[%％]|免税|不征税)$/.test(compact(r.observed_text)));
  detectedLineCount=rates.length;
  for(const rr of rates) {
   const scope=`legacy-vat-row:${rr.region_id}`;
   make('tax_rate',compact(rr.observed_text),[rate,rr],{taxScope:scope});
   for(let i=0;i<columns.length;i++) {
    const [key,h]=columns[i];if(key==='tax_rate')continue;
    const next=columns[i+1]?.[1];
    const cells=regions.filter(r=>row(r,rr)&&cx(r)>bounds(h)[0]-width*.025&&(!next||cx(r)<bounds(next)[0]-width*.003)&&numeric(money(r.observed_text)));
    for(const r of cells)make(key,money(r.observed_text),[h,rr,r],{taxScope:scope,...(key!=='quantity'?{currency:'CNY',basis:key}:{})});
   }
   if(tableHeader) {
    const spec=header('规格型号')[0],limit=spec?bounds(spec)[0]:width*.35;
    for(const r of regions.filter(r=>row(r,rr)&&cx(r)<limit&&!numeric(compact(r.observed_text))))make('item_description',r.observed_text,[tableHeader,r],{taxScope:scope});
   }
   const special=regions.filter(r=>/差额计税|差额征税|简易计税/.test(r.observed_text));
   for(const r of special)make('tax_method',r.observed_text,[r],{taxScope:scope});
   const scoped=fields.filter(f=>f.taxScope===scope);
   if(['quantity','unit_price','line_net_amount','tax_rate','line_tax_amount','item_description'].every(key=>scoped.filter(f=>f.key===key).length===1))extractedLineCount++;
  }
  // Full-table sums require explicit 合计 + price/tax/grand-total boundaries,
  // clean item rows, and no unassigned populated numeric cells between them.
  const totals=regions.filter(r=>compact(r.observed_text)==='合计'&&cy(r)>cy(net)&&cy(r)<bottom);
  const tableCells=regions.filter(r=>cy(r)>bounds(net)[3]&&cy(r)<(totals.length===1?bounds(totals[0])[1]:bottom)&&cx(r)>=bounds(net)[0]-width*.025&&numeric(money(r.observed_text)));
  const assigned=new Set(fields.filter(f=>f.taxScope).flatMap(f=>f.source.regions.map(r=>r.regionId)));
  lineItemsComplete=totals.length===1&&gross.length===1&&rates.length>0&&detectedLineCount===extractedLineCount&&tableCells.every(r=>assigned.has(r.region_id));
 }
 for(const f of fields) {
  if(fields.filter(g=>sameSlot(f,g)).length>1) {f.extractionAmbiguous=true;review.push({fieldId:f.id,key:f.key,role:f.role,reason:'multiple_content_candidates'});}
  if(f.key==='identity_number'&&!/^\d{17}[0-9Xx]$/.test(f.value))review.push({fieldId:f.id,key:f.key,reason:'identity_shape_requires_review',valuePreserved:true});
 }
 format.id=format.kind;
 const used=new Set(fields.flatMap(f=>f.source.regions.map(r=>r.regionId)));
 return {fields,review,format,coverage:{status:fields.length?'partial':'NEI',reason:fields.length?'format_content_candidates':'no_supported_content_candidates',matchedFields:fields.length,lineItemsComplete,detectedLineCount,extractedLineCount,unmatchedRegionIds:regions.filter(r=>!used.has(r.region_id)).map(r=>r.region_id)}};
}

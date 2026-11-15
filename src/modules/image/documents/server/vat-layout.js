// Explicit Chinese digital VAT layout. Geometry is in the original OCR image.
// Table summaries are read from their row/column intersection, never inferred from sums.
export const VAT_LAYOUT_VERSION='cn-digital-vat-layout/0.2';
const compact=s=>s.replace(/\s/g,'').replaceAll('（','(').replaceAll('）',')');
const bounds=r=>[Math.min(...r.polygon.map(p=>p[0])),Math.min(...r.polygon.map(p=>p[1])),Math.max(...r.polygon.map(p=>p[0])),Math.max(...r.polygon.map(p=>p[1]))];
const cy=r=>{const b=bounds(r);return (b[1]+b[3])/2;};
const cx=r=>{const b=bounds(r);return (b[0]+b[2])/2;};
const sameRow=(a,b)=>{const x=bounds(a),y=bounds(b);return Math.min(x[3],y[3])-Math.max(x[1],y[1])>=.5*Math.min(x[3]-x[1],y[3]-y[1]);};
export function vatLayout(sample,{material,digest}) {
 const regions=sample.regions, width=sample.oriented_size[0], review=[],fields=[];
 const titles=regions.filter(r=>/^电子发票\((普通发票|增值税专用发票)\)$/.test(compact(r.observed_text)));
 if(material.type!=='digital_invoice'||titles.length!==1) return {matched:false,fields,review};
 const title=titles[0];
 const headers=key=>regions.filter(r=>compact(r.observed_text)===key&&cy(r)>cy(title));
 const netHeaders=headers('金额'),taxHeaders=headers('税额');
 const make=(key,value,proof,extra={})=>{
  const unique=[...new Map([title,...proof].flatMap(r=>r.parts??[r]).map(r=>[r.region_id,r])).values()];
  const anchor=proof.at(-1);
  fields.push({id:`vat-${fields.length+1}`,key,role:'transaction',value,version:1,confidence:Math.min(...unique.map(r=>r.recognition_confidence)),...extra,
   source:{fileSha256:material.fileSha256,page:1,provider:'ocr',observedText:anchor.observed_text,polygon:structuredClone(anchor.polygon),
    coordinateSpace:'exif_oriented_image_pixels',precision:'ocr_region',ocrFingerprint:digest,extractionVersion:VAT_LAYOUT_VERSION,
    templateSource:'https://fgk.chinatax.gov.cn/zcfgk/c100012/c5236067/content.html',
    regions:unique.map(r=>({regionId:r.region_id,observedText:r.observed_text,polygon:structuredClone(r.polygon),confidence:r.recognition_confidence}))}});
 };
 // Role labels delimit columns; generic names elsewhere are never promoted.
 const buyers=headers('购买方信息'),sellers=headers('销售方信息');
 if(buyers.length===1&&sellers.length===1&&cx(buyers[0])<cx(sellers[0])) {
  for(const [role,marker,right] of [['buyer',buyers[0],bounds(sellers[0])[0]],['seller',sellers[0],width]]) {
   const area=bounds(marker);
   for(const [key,label] of [['name','名称'],['tax_identifier','统一社会信用代码/纳税人识别号']]) {
    const options=regions.filter(r=>bounds(r)[0]>=area[2]&&bounds(r)[2]<=right&&cy(r)>=area[1]&&cy(r)<=area[3]&&new RegExp(`^${label}[：:]\\S+`).test(r.observed_text.trim()));
    if(options.length===1) make(key,options[0].observed_text.trim().replace(new RegExp(`^${label}[：:]`),''),[marker,options[0]],{role});
    else review.push({key,role,reason:'vat_party_value_missing_or_ambiguous'});
   }
  }
 }
 const totals=headers('合计');
 // Some printed labels use separated characters. Join only an unambiguous
 // horizontal 合 + 计 in the label column, preserving both original boxes.
 for(const left of headers('合')) {
  const rights=headers('计').filter(r=>sameRow(left,r)&&bounds(r)[0]>bounds(left)[2]&&bounds(r)[2]<width*.4&&bounds(r)[0]-bounds(left)[2]<width*.15);
  if(rights.length!==1)continue;
  const right=rights[0];
  if(regions.some(r=>r!==left&&r!==right&&r.observed_text.trim()&&sameRow(left,r)&&cx(r)>cx(left)&&cx(r)<cx(right)))continue;
  const a=bounds(left),b=bounds(right);
  totals.push({region_id:'joined-total',observed_text:'合计',parts:[left,right],polygon:[[a[0],Math.min(a[1],b[1])],[b[2],Math.min(a[1],b[1])],[b[2],Math.max(a[3],b[3])],[a[0],Math.max(a[3],b[3])]]});
 }

 if(totals.length===1&&netHeaders.length===1&&taxHeaders.length===1&&sameRow(netHeaders[0],taxHeaders[0])&&cx(netHeaders[0])<cx(taxHeaders[0])&&cy(totals[0])>cy(netHeaders[0])) {
  for(const [key,header] of [['net_amount',netHeaders[0]],['tax_amount',taxHeaders[0]]]) {
   const values=regions.filter(r=>sameRow(r,totals[0])&&Math.abs(cx(r)-cx(header))<width*.09&&/^[¥￥]\s*[+-]?[\d.]+$/.test(r.observed_text.trim()));
   if(values.length===1)make(key,values[0].observed_text.trim().replace(/^[¥￥]\s*/,''),[netHeaders[0],taxHeaders[0],totals[0],values[0]],{currency:'CNY',basis:key});
   else review.push({key,reason:'vat_summary_cell_missing_or_ambiguous',regionIds:[...(totals[0].parts??[totals[0]]).map(r=>r.region_id),...values.map(r=>r.region_id)]});
  }
 } else review.push({reason:'vat_summary_headers_or_total_row_missing_or_ambiguous'});
 const lower=regions.filter(r=>compact(r.observed_text).startsWith('(小写)'));
 const upper=regions.filter(r=>compact(r.observed_text).startsWith('价税合计(大写)'));
 if(lower.length===1&&upper.length===1&&sameRow(lower[0],upper[0])) {
  const small=lower[0],big=upper[0];
  const inline=compact(small.observed_text).slice('(小写)'.length);
  const choices=inline?[small]:regions.filter(r=>r!==small&&sameRow(r,small)&&bounds(r)[0]>=bounds(small)[2]&&/^[¥￥]\s*[+-]?[\d.]+$/.test(r.observed_text.trim()));
  if(choices.length===1&&/^[¥￥][+-]?[\d.]+$/.test(inline||compact(choices[0].observed_text))) make('gross_amount',(inline||compact(choices[0].observed_text)).slice(1),[big,small,choices[0]],{currency:'CNY',basis:'gross_amount'});
  else review.push({key:'gross_amount',reason:'vat_gross_value_missing_or_ambiguous'});
  const wordsInline=compact(big.observed_text).slice('价税合计(大写)'.length);
  const wordChoices=wordsInline?[big]:regions.filter(r=>r!==big&&sameRow(r,big)&&bounds(r)[0]>=bounds(big)[2]&&bounds(r)[2]<=bounds(small)[0]&&/[圆元]/.test(r.observed_text));
  if(wordChoices.length===1) make('gross_amount_words',wordsInline||wordChoices[0].observed_text.trim(),[big,small,wordChoices[0]],{currency:'CNY'});
  else review.push({key:'gross_amount_words',reason:'vat_words_value_missing_or_ambiguous'});
 }
 // Line rates are never compared against the invoice-wide tax total.
 const rateHeaders=regions.filter(r=>['税率','税率/征收率'].includes(compact(r.observed_text))&&cy(r)>cy(title));
 if(rateHeaders.length===1&&netHeaders.length===1&&taxHeaders.length===1&&totals.length===1&&sameRow(rateHeaders[0],netHeaders[0])&&sameRow(rateHeaders[0],taxHeaders[0])&&cx(netHeaders[0])<cx(rateHeaders[0])&&cx(rateHeaders[0])<cx(taxHeaders[0])) {
  const special=regions.some(r=>/差额征税|差额计税/.test(r.observed_text));
  const rates=regions.filter(r=>cy(r)>bounds(rateHeaders[0])[3]&&cy(r)<bounds(totals[0])[1]&&Math.abs(cx(r)-cx(rateHeaders[0]))<width*.055&&/^(?:\d{1,3}(?:\.\d{1,4})?[%％]|免税|不征税|\*+)$/.test(compact(r.observed_text)));
  for(const rate of rates) {
   const values=header=>regions.filter(r=>sameRow(r,rate)&&Math.abs(cx(r)-cx(header))<width*.065&&/^[¥￥]?\s*[+-]?\d+(?:\.\d+)?$/.test(r.observed_text.trim()));
   const nets=values(netHeaders[0]),taxes=values(taxHeaders[0]);
   if(special||nets.length!==1||taxes.length!==1||rates.some(r=>r!==rate&&sameRow(r,rate))) {review.push({key:'tax_rate',reason:'tax_line_missing_ambiguous_or_special'});continue;}
   const taxScope=`vat-row:${rate.region_id}`;
   const proof=[netHeaders[0],rateHeaders[0],taxHeaders[0],rate];
   make('tax_rate',compact(rate.observed_text),proof,{taxScope});
   for(const [key,cell] of [['line_net_amount',nets[0]],['line_tax_amount',taxes[0]]])make(key,cell.observed_text.trim().replace(/^[¥￥]\s*/,''),[...proof,cell],{taxScope,currency:'CNY',basis:key});
  }
 }
 return {matched:true,fields,review};
}

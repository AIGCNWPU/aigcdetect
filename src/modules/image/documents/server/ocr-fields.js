import {enrichCatalogFields} from './catalog-content-fields.js';
import {enrichAdditionalFields} from './additional-content-fields.js';
import {enrichContentFields} from './content-fields.js';
import { vatLayout } from './vat-layout.js';
import { fingerprint, validateBatch } from './batch-engine.js';

// Explicit research labels only. These are extraction semantics, not legal rules.
export const OCR_FIELDS_VERSION = 'explicit-ocr-fields/0.6';
const templates = [
  ...[['本行税率','tax_rate'],['本行税额','line_tax_amount'],['本行不含税金额','line_net_amount'],['本行计税方式','tax_method']].map(([label,key])=>({label,key,role:'transaction',types:['invoice','digital_invoice']})),
  ...[['出差开始日期','travel_start_date'],['出差结束日期','travel_end_date'],['合同生效日期','contract_start_date'],['合同截止日期','contract_end_date']].map(([label,key])=>({label,key,role:'transaction',types:['contract','travel_approval','certificate']})),
  {label:'公民身份号码',key:'identity_number',role:'subject',types:['identity']},
  {label:'身份证号',key:'identity_number',role:'subject',types:['identity','certificate']},
  {label:'性别',key:'gender',role:'subject',types:['identity','certificate']},
  {label:'发票代码',key:'invoice_code',role:'transaction',types:['invoice']},
  {label:'姓名',key:'name',role:'subject',types:['identity']},
  {label:'出生日期',key:'birth_date',role:'subject',types:['identity','certificate']},
  {label:'证明对象姓名',key:'name',role:'subject',types:['certificate']},
  {label:'购买方名称',key:'name',role:'buyer',types:['invoice','digital_invoice']},
  {label:'销售方名称',key:'name',role:'seller',types:['invoice','digital_invoice']},
  {label:'付款人',key:'name',role:'payer',types:['receipt','certificate']},
  {label:'收款人',key:'name',role:'payee',types:['receipt','certificate']},
  {label:'发票号码',key:'invoice_number',role:'transaction',types:['invoice','digital_invoice','certificate']},
  {label:'交易编号',key:'transaction_number',role:'transaction',types:['invoice','digital_invoice','receipt','certificate']},
  {label:'开票日期',key:'invoice_date',role:'transaction',types:['invoice','digital_invoice']},
  {label:'不含税金额',key:'net_amount',role:'transaction',types:['invoice','digital_invoice']},
  {label:'税额',key:'tax_amount',role:'transaction',types:['invoice','digital_invoice']},
  {label:'价税合计（小写）',key:'gross_amount',role:'transaction',types:['invoice','digital_invoice']},
  {label:'实付金额',key:'payment_amount',role:'transaction',types:['receipt']},
];
const box = r => [Math.min(...r.polygon.map(p=>p[0])),Math.min(...r.polygon.map(p=>p[1])),Math.max(...r.polygon.map(p=>p[0])),Math.max(...r.polygon.map(p=>p[1]))];
const assert = (ok,message) => {if(!ok) throw new Error(message);};

/** Adapt one existing smoke_ocr sample. File type is supplied, never guessed.
 * Whole OCR polygons remain whole: text offsets do not imply character boxes.
 */
export function extractOcrMaterial(sample,{id,type,version=1}) {
  assert(sample?.status==='succeeded','OCR did not succeed');
  assert(Array.isArray(sample.oriented_size)&&sample.oriented_size.length===2&&sample.oriented_size.every(n=>Number.isInteger(n)&&n>0),'Invalid OCR dimensions');
  assert(Array.isArray(sample.regions),'Missing OCR regions');
  const [width,height]=sample.oriented_size;
  const material={id,type,version,fileSha256:sample.input_sha256,pages:[{number:1,status:'succeeded',width,height}],fields:[]};
  // Reuse the core source/geometry validator for every region, including unused ones.
  const raw=sample.regions.map(r=>{
    assert(r.coordinate_space==='exif_oriented_image_pixels'&&r.source?.page===1&&r.source?.input_sha256===sample.input_sha256,'OCR source/coordinate mismatch');
    assert(typeof r.observed_text==='string','Missing OCR text');
    return {id:r.region_id,key:'raw_ocr',role:'unresolved',value:r.observed_text,version:1,confidence:r.recognition_confidence,
      source:{fileSha256:sample.input_sha256,page:1,provider:'ocr',observedText:r.observed_text.trim()?r.observed_text:'[empty OCR validation probe]',polygon:r.polygon}};
  });
  validateBatch({id:'ocr-validation',version:1,materials:[{...material,fields:raw}]});
  const definitions=templates.filter(t=>t.types.includes(type));
  const matches=[];
  for(const r of sample.regions) for(const t of definitions) {
    const text=r.observed_text.trim();
    if(text===t.label||text===`${t.label}：`||text===`${t.label}:`) matches.push({region:r,template:t,inline:null});
    else for(const colon of ['：',':']) if(text.startsWith(t.label+colon)&&text.slice(t.label.length+1).trim()) {
      matches.push({region:r,template:t,inline:text.slice(t.label.length+1).trim()});break;
    }
  }
  const labels=new Set(matches.map(m=>m.region.region_id));
  const pending=[];const review=[];
  for(const match of matches) {
    const {region,template,inline}=match;
    const a=box(region);
    const choices=inline ? [region] : sample.regions.filter(r=>{
      if(labels.has(r.region_id)||!r.observed_text.trim()) return false;
      const b=box(r),overlap=Math.min(a[3],b[3])-Math.max(a[1],b[1]);
      return b[0]>=a[2]&&b[0]-a[2]<=Math.max(4*(a[3]-a[1]),width*.15)&&overlap>=.6*Math.min(a[3]-a[1],b[3]-b[1]);
    });
    if(choices.length!==1) {review.push({key:template.key,role:template.role,reason:choices.length?'ambiguous_row_values':'missing_label_value',regionIds:[region.region_id,...choices.map(r=>r.region_id)]});continue;}
    pending.push({match,valueRegion:choices[0],value:inline??choices[0].observed_text.trim()});
  }
  const digest=fingerprint(sample);
  for(const p of pending) {
    const {match:{region,template},valueRegion,value}=p;
    // A value shared by two labels is ambiguous even if each label has one candidate.
    if(pending.filter(x=>x.valueRegion.region_id===valueRegion.region_id).length>1) {
      review.push({key:template.key,role:template.role,reason:'value_shared_by_labels',regionIds:[region.region_id,valueRegion.region_id]});continue;
    }
    const confidence=Math.min(region.recognition_confidence,valueRegion.recognition_confidence);
    const field={id:`field-${material.fields.length+1}`,key:template.key,role:template.role,value,version:1,confidence,
      source:{fileSha256:sample.input_sha256,page:1,provider:'ocr',observedText:valueRegion.observed_text,
        polygon:structuredClone(valueRegion.polygon),coordinateSpace:'exif_oriented_image_pixels',precision:'ocr_region',
        ocrFingerprint:digest,extractionVersion:OCR_FIELDS_VERSION,
        regions:[...new Map([region,valueRegion].map(r=>[r.region_id,{regionId:r.region_id,observedText:r.observed_text,polygon:structuredClone(r.polygon),confidence:r.recognition_confidence}])).values()]}};
    if(template.label.startsWith('本行'))field.taxScope='explicit-line:page-1';
    if(field.key.endsWith('_date') && /^\d{4}-\d{2}-\d{2}$/.test(value)) field.dateFormat='YYYY-MM-DD';
    if(field.key.endsWith('_date') && /^\d{4}年\d{1,2}月\d{1,2}日$/.test(value)) field.dateFormat='YYYY年MM月DD日';
    if(field.key.endsWith('_amount')) {
      const money=value.match(/^(?:人民币|CNY)\s*([+-]?\d{1,15}(?:\.\d{1,6})?)$/);
      if(money) {field.value=money[1];field.currency='CNY';field.basis=field.key;}
    }
    material.fields.push(field);
    if(confidence<.90) review.push({fieldId:field.id,key:field.key,reason:'recognition_requires_review',regionIds:[valueRegion.region_id]});
  }
  const layout=vatLayout(sample,{material,digest});
  if(layout.matched) {
    material.fields=material.fields.filter(f=>!['net_amount','tax_amount','gross_amount','gross_amount_words'].includes(f.key));
    for(let i=review.length-1;i>=0;i--) if(['net_amount','tax_amount','gross_amount','gross_amount_words'].includes(review[i].key)) review.splice(i,1);
    material.fields.push(...layout.fields);
    for(const f of layout.fields) if(f.confidence<.90) review.push({fieldId:f.id,key:f.key,reason:'recognition_requires_review'});
    review.push(...layout.review);
  }
  const content=enrichContentFields(sample,{material,digest});
  const extra=enrichAdditionalFields(sample,{material:{...material,fields:[...material.fields,...content.fields]},digest});
  const catalog=enrichCatalogFields(sample,{material:{...material,fields:[...material.fields,...content.fields,...extra.fields]},digest});
  extra.fields.push(...catalog.fields);extra.review.push(...catalog.review);
  if(catalog.format.status==='matched'&&extra.format.status!=='matched'){extra.format=catalog.format;extra.coverage=catalog.coverage;}
  content.fields.push(...extra.fields);content.review.push(...extra.review);
  if(extra.format.status==='matched'&&content.format.status!=='matched'){
    content.format=extra.format;content.coverage={...extra.coverage,matchedFields:content.fields.length};
  }else if(extra.format.status==='matched'&&content.format.kind!==extra.format.kind){
    content.review.push({reason:'multiple_content_formats',formats:[content.format.kind,extra.format.kind]});
    content.format={...content.format,status:'ambiguous'};content.coverage.lineItemsComplete=false;
  }
  if(type==='unknown'&&content.format.status==='matched'){
    const inferred={legacy_vat_electronic_ordinary:'invoice',tax_payment_certificate:'certificate',account_commitment:'certificate',household_register_card:'household_register',purchase_contract:'contract',rental_contract:'contract',tax_status_certificate:'certificate',utility_payment_receipt:'receipt',utility_bill_detail:'receipt',loan_note:'certificate',jd_order:'order',business_license:'certificate',authorization_letter:'authorization',employment_certificate:'certificate',dispatch_note:'delivery_note',retail_payment_receipt:'receipt',no_arrears_certificate:'certificate',income_tax_detail:'certificate',online_shop_certificate:'certificate',miniapp_information:'certificate',sales_contract:'contract',commercial_lease:'contract'}[content.format.kind];
    if(inferred){const classified=extractOcrMaterial(sample,{id,type:inferred,version});classified.classification={declaredType:type,inferredType:inferred,basis:content.format.evidenceRegionIds};return classified;}
  }
  material.fields.push(...content.fields);
  material.contentFormat=content.format;
  material.contentExtraction=content.coverage;
  if(content.format.invoiceSubtype)material.invoiceSubtype=content.format.invoiceSubtype;
  review.push(...content.review);
  // Repeated labels are retained as candidates, never arbitrarily reduced to one.
  for(const field of material.fields) if(material.fields.filter(f=>f.key===field.key&&f.role===field.role&&f.taxScope===field.taxScope).length>1) {
    field.extractionAmbiguous=true;
    review.push({fieldId:field.id,key:field.key,reason:'multiple_field_candidates'});
  }
  validateBatch({id:'extracted-validation',version:1,materials:[material]});
  return {version:OCR_FIELDS_VERSION,format:content.format,material,review,coverage:{status:material.fields.length?'partial':'NEI',reason:material.fields.length?'explicit_labels_only':'no_supported_labels',matchedFields:material.fields.length,unmatchedRegionIds:sample.regions.filter(r=>!material.fields.some(f=>f.source.regions.some(s=>s.regionId===r.region_id))).map(r=>r.region_id)},externalVerification:'not_run'};
}

// Product registry + request builders + response normalizers for the Aliyun
// Cloud Marketplace benchmark (2026-11-09 research picks). Endpoints for most
// products are only visible on the product page API console after purchase;
// only the officially documented idcard endpoint ships as a default. All
// normalizers are pure so tests run without network.

export const marketProducts=[
  {key:'invoice-ocr',name:'增值税发票识别（阿里官方读光）',code:'cmapi027758',page:'https://market.aliyun.com/products/57124001/cmapi027758.html',trial:'0.01元/500次',category:'ocr',endpointDefault:null},
  {key:'idcard-ocr',name:'身份证识别（阿里官方读光，含 tamper_score）',code:'cmapi010401',page:'https://market.aliyun.com/products/57124001/cmapi010401.html',trial:'0.01元/500次',category:'ocr',endpointDefault:'https://cardnumber.market.alicloudapi.com/rest/160601/ocr/ocr_idcard.json'},
  {key:'invoice-verify',name:'发票查验（中科逸视）',code:'cmapi00071008',page:'https://market.aliyun.com/detail/cmapi00071008',trial:'0.02元/10次',category:'verify',endpointDefault:null},
  {key:'vat-verify',name:'VerifyVATInvoice 发票核验（阿里官方 OpenAPI）',code:'VerifyVATInvoice',page:'https://help.aliyun.com/zh/ocr/developer-reference/api-ocr-api-2021-07-07-verifyvatinvoice',trial:'开通送50次',category:'verify',endpointDefault:null},
  {key:'doc-compare',name:'批量文档比对（阿里官方）',code:'cmapi00043681',page:'https://market.aliyun.com/products/57124001/cmapi00043681.html',trial:'页面试用SKU',category:'compare',endpointDefault:null},
  {key:'tamper-detect',name:'证件票据图片PS篡改检测定位（快证签）',code:'cmapi00074097',page:'https://market.aliyun.com/products/201204006/cmapi00074097.html',trial:'2元体验包',category:'tamper',endpointDefault:null},
  {key:'aigc-detect',name:'AI生成图片检测（万维易源）',code:'cmapi00063095',page:'https://market.aliyun.com/products/57124001/cmapi00063095.html',trial:'2元/100次',category:'aigc',endpointDefault:null},
];

const text=value=>String(value??'').trim();
const num=value=>{const parsed=Number(value);return Number.isFinite(parsed)?parsed:null;};
const pick=(object,keys)=>{for(const key of keys)if(object&&object[key]!==undefined&&object[key]!==null&&object[key]!=='')return object[key];return undefined;};

export function buildRequest(productKey,input={}){
  const product=marketProducts.find(item=>item.key===productKey);
  if(!product)throw Error(`unknown product: ${productKey}`);
  if(product.key==='idcard-ocr')return {body:{image:input.image,configure:{side:input.side||'face',quality_info:true}}};
  if(product.key==='invoice-ocr')return {body:{image:input.image}};
  if(product.key==='invoice-verify')return {body:{...input.fields}};
  if(product.key==='vat-verify')return {body:{...input.fields}};
  if(product.key==='doc-compare')return {body:{standard:input.standard,compare:input.compare}};
  if(product.key==='tamper-detect')return {body:{image:input.image}};
  if(product.key==='aigc-detect')return {body:{image:input.image}};
  throw Error(`no builder for ${productKey}`);
}

export function normalizeResponse(productKey,response){
  const body=response?.body??response??{};
  // Cloud-marketplace envelopes vary per vendor; unwrap the common ones once.
  const payload=body.data&&typeof body.data==='object'&&!Array.isArray(body.data)?body.data:body;
  if(productKey==='idcard-ocr'){
    const info=payload.data||payload;
    const front=info?.face||info?.front||info;
    const fields=[['name',text(front?.name)],['gender',text(front?.gender)],['nationality',text(front?.nationality)],['birth_date',text(front?.birth)||text(front?.birthDate)],['address',text(front?.address)],['id_number',text(front?.num)||text(front?.idNumber)]].filter(([,value])=>value);
    const quality=info?.quality_info||info?.qualityInfo||{};
    return {kind:'ocr',fields,tamperScore:num(quality?.tamper_score??quality?.tamperScore),isCopy:quality?.is_copy??quality?.isCopy===true,reshoot:quality?.is_reshoot??quality?.isReshoot===true,success:fields.length>0};
  }
  if(productKey==='invoice-ocr'){
    const rows=Array.isArray(payload.data)?payload.data:[payload.data??payload];
    const first=rows[0]||{};
    const fields=[['invoice_code',text(pick(first,['invoiceCode','fpdm','invoice_code']))],['invoice_number',text(pick(first,['invoiceNum','fphm','invoice_number']))],['invoice_date',text(pick(first,['invoiceDate','kprq','invoice_date']))],['gross_amount',text(pick(first,['totalAmount','jshj','gross_amount','amountInFiguers']))],['net_amount',text(pick(first,['totalAmountWithoutTax','hjje','net_amount']))],['tax_amount',text(pick(first,['totalTax','hjse','tax_amount']))],['seller_name',text(pick(first,['sellerName','xhfmc','seller_name']))],['seller_tax_id',text(pick(first,['sellerTaxId','xhfsbh','seller_tax_id']))],['buyer_name',text(pick(first,['buyerName','ghfmc','buyer_name']))],['buyer_tax_id',text(pick(first,['buyerTaxId','ghfsbh','buyer_tax_id']))]].filter(([,value])=>value);
    return {kind:'ocr',fields,success:fields.length>0};
  }
  if(productKey==='invoice-verify'){
    const verified=Boolean(pick(payload,['verified','is_true','isTrue','success'])===true||String(pick(payload,['status','state','invoiceStatus'])).includes('一致'));
    return {kind:'verify',verified,status:text(pick(payload,['status','state','invoiceStatus','msg','message'])),fields:payload,success:response?.status===200};
  }
  if(productKey==='vat-verify'){
    const verified=String(pick(payload,['verifyResult','result','status'])).includes('一致')||payload?.success===true;
    return {kind:'verify',verified,status:text(pick(payload,['verifyResult','result','status'])),fields:payload,success:response?.status===200};
  }
  if(productKey==='doc-compare'){
    const diffs=Array.isArray(payload.diffs||payload.differences)?(payload.diffs||payload.differences):[];
    return {kind:'compare',differenceCount:diffs.length||num(payload.diffCount)||0,diffs,success:response?.status===200};
  }
  if(productKey==='tamper-detect'){
    const tampered=Boolean(pick(payload,['tamper','isTamper','tampered','is_tamper'])===true||num(pick(payload,['tamperScore','tamper_score','score']))>=60);
    const regions=Array.isArray(payload.regions||payload.boxes)?(payload.regions||payload.boxes).map(region=>({x:num(region.x??region.left),y:num(region.y??region.top),width:num(region.width??region.w),height:num(region.height??region.h)})):[];
    return {kind:'tamper',tampered,score:num(pick(payload,['tamperScore','tamper_score','score'])),regions,success:response?.status===200};
  }
  if(productKey==='aigc-detect'){
    const score=num(pick(payload,['score','aigcScore','aigc_score','probability']));
    const aiGenerated=String(pick(payload,['result','label','isAigc','is_aigc'])).includes('AI')||String(pick(payload,['result','label'])).includes('生成')||score!==null&&score>=0.5;
    return {kind:'aigc',aiGenerated,score,success:response?.status===200};
  }
  throw Error(`no normalizer for ${productKey}`);
}

export function fieldMap(normalized){
  return Object.fromEntries((normalized?.fields||[]).filter(([,value])=>value));
}

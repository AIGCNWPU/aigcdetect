import {displayedDate} from './date-fields.js';
import {readFileSync} from 'node:fs';
export const contentRuleCatalog=JSON.parse(readFileSync(new URL('./content-rule-catalog.json',import.meta.url),'utf8'));
// Local displayed-content checks. Identifier matches never establish registry truth.
export const CONTENT_RULE_VERSION='displayed-content-rules/1.2';
const good=f=>f&&f.confidence>=.9&&!f.extractionAmbiguous&&typeof f.value==='string'&&f.value.trim();
const norm=v=>String(v).normalize('NFC').replace(/\s+/g,'').replace(/[：:]/g,':');
const abs=n=>n<0n?-n:n;
const unique=a=>[...new Set(a)];
const fieldNames={authorized_agent:'委托代理人',legal_representative:'法定代表人',application_name:'小程序名称',business_credit_code:'统一社会信用代码',income_amount:'收入金额',declared_tax_amount:'已申报税额',tax_status_date:'纳税状态日期',declaration_date:'申报日期',monthly_rent:'月租金',contract_start_date:'合同开始日期',contract_end_date:'合同结束日期',phone_number:'联系电话',business_credit_code:'统一社会信用代码',customer_contact:'客户',dispatch_items:'出库明细',registration_date:'注册日期',authorization_start_date:'授权开始日期',authorization_end_date:'授权结束日期',employment_start_date:'入职日期',name:'名称/姓名',identity_number:'身份号码',tax_identifier:'纳税人标识',invoice_date:'开票日期',transaction_date:'交易日期',issue_date:'出具日期',issuing_authority:'出具机关',tax_type:'税种',tax_period:'税款所属期间',treasury_date:'入退库日期',item_description:'商品或服务',quantity:'数量',unit_price:'单价',net_amount:'不含税金额',tax_amount:'税额',gross_amount:'价税合计',order_total:'订单实付金额',displayed_order_date:'订单显示时间',gross_amount_words:'大写金额',paid_tax_amount:'实缴税额集合',contract_total:'合同金额',payment_amount:'付款金额',account_list:'账户列表',registered_address:'地址'};
export const CONTENT_RULE_NAMES={same_tax_voucher_content:'同原凭证内容核对',same_taxpayer_content:'同纳税人标识内容核对',same_application_content:'同小程序标识内容核对',same_shop_content:'同店铺地址内容核对',same_registration_content:'同登记代码内容核对',same_authorization_content:'同授权合同内容核对',same_dispatch_content:'同出库编号内容核对',authorization_period:'授权起止日期核对',invoice_line_arithmetic:'明细数量与单价核对',invoice_line_totals:'明细与汇总金额核对',rental_initial_payment:'租金押付与首付款核对',contract_line_total:'合同数量单价与总额核对',same_voucher_content:'同票据标识内容核对',same_certificate_content:'同证明编号内容核对',same_contract_content:'同合同或订单编号内容核对',same_identity_content:'同显示身份标识内容核对',same_utility_account_content:'同户号缴费内容核对',commitment_account_set_difference:'承诺账户集合核对',format_field_coverage:'材料格式与关键字段覆盖'};
export const CONTENT_REASON_NAMES={
 line_quantity_times_unit_price:'同一明细行的数量乘单价与金额比较',
 complete_line_sum:'已确认完整明细与汇总行比较',
 line_set_incomplete:'明细提取尚不完整，不能强制汇总',
 displayed_rental_composition:'明示押金与预付租金组成不等于首付款',
 rental_components_incomplete:'缺少明确的租金、押付月数、首付金额或组成条款',
 payment_adjustment_requires_review:'存在抵扣、优惠或其他付款约定，须先核实计算范围',
 content_recognition_requires_review:'有关字段识别质量不足或存在多个候选',
 matching_displayed_identifier_content_difference:'相同显示标识下的对应内容不同，请核实原件及版本',
 matching_displayed_identifier_content_equal:'相同显示标识下的本项内容一致',
 matching_identifier_missing_comparison_field:'已发现共同标识，但比较字段缺失或有多个候选',
 account_set_difference_not_automatic_violation:'材料列出的账户不同，请核对各份材料的账户内容',
 account_sets_equal:'各份材料列出的账户一致',
 unknown_content_format:'尚无匹配的材料内容格式',
 required_content_fields_missing:'此格式的关键字段尚未全部提取',
 authorization_content_differs:'相同授权合同号下授权对象或条款不同，请核对授权范围、有效时点和版本。',
 registration_content_differs:'相同统一社会信用代码下登记内容不同，请核对原件、登记变更记录及对应时间。',
 authorization_dates_missing:'未能唯一提取授权起止日期，尚未完成期限核验',
 authorization_dates_invalid:'授权日期无法可靠解析，请核对原件',
 authorization_date_order:'已比较授权开始日期和结束日期',
 format_fields_available:'本格式所列关键字段已经提取，未覆盖文字仍需单独核验',
};
const msg=(rule,status,reason,refs,extra={})=>({rule,ruleVersion:CONTENT_RULE_VERSION,status,reason,evidence:refs,title:CONTENT_RULE_NAMES[rule],explanation:CONTENT_REASON_NAMES[reason]||reason,...extra});
const one=(m,key,role)=>m.fields.filter(f=>f.key===key&&(!role||f.role===role));
const displayMoney=n=>`${n<0n?'-':''}${abs(n)/1000000n}.${String(abs(n)%1000000n).padStart(6,'0').slice(0,2)}`;
const number=(f,decimal)=>decimal(f.value.replace(/[,，]/g,''));

export function contentChecks(material,{evidence,decimal}) {
 const result=[],emit=(rule,status,reason,fs,extra)=>result.push(msg(rule,status,reason,fs.map(f=>evidence(material,f)),{materialId:material.id,...extra}));
 const numeric=(rule,fields,calculate,reason,extra={})=>{
  if(fields.some(f=>!good(f))){emit(rule,'NEI','content_recognition_requires_review',fields,extra);return;}
  try{const {expected,actual,tolerance=10000n}=calculate();emit(rule,abs(expected-actual)<=tolerance?'PASS':'FAIL',reason,fields,{...extra,calculation:{expected:String(expected),actual:String(actual),scale:1000000,tolerance:String(tolerance),expectedAmount:displayMoney(expected),actualAmount:displayMoney(actual)}});}
  catch{emit(rule,'NEI','ambiguous_numeric_text',fields,extra);}
 };
 const scopes=unique(material.fields.filter(f=>f.taxScope&&['quantity','unit_price','line_net_amount'].includes(f.key)).map(f=>f.taxScope));
 for(const scope of scopes){
  const get=key=>material.fields.filter(f=>f.key===key&&f.taxScope===scope);
  const parts=['quantity','unit_price','line_net_amount'].map(get);
  if(parts.every(x=>x.length===1)){
   const fs=parts.map(x=>x[0]);
   if(fs[1].currency&&fs[2].currency&&fs[1].currency!==fs[2].currency){emit('invoice_line_arithmetic','NEI','currency_not_comparable',fs,{taxScope:scope});continue;}
   numeric('invoice_line_arithmetic',fs,()=>({expected:number(fs[0],decimal)*number(fs[1],decimal)/1000000n,actual:number(fs[2],decimal)}),'line_quantity_times_unit_price',{taxScope:scope});
  }
 }
 if(material.contentExtraction?.lineItemsComplete===true){
  for(const [line,total] of [['line_net_amount','net_amount'],['line_tax_amount','tax_amount']]){
   const fs=material.fields.filter(f=>f.key===line&&f.taxScope),totals=one(material,total);
   if(fs.length&&totals.length===1&&unique(fs.map(f=>f.taxScope)).length===fs.length){
    const all=[...fs,totals[0]];
    if(all.some(f=>f.currency!=='CNY')){emit('invoice_line_totals','NEI','currency_not_comparable',all,{comparedKey:total});continue;}
    numeric('invoice_line_totals',all,()=>({expected:fs.reduce((sum,f)=>sum+number(f,decimal),0n),actual:number(totals[0],decimal)}),'complete_line_sum',{comparedKey:total});
   }
  }
 }
 const rentKeys=['monthly_rent','deposit_months','prepaid_months','initial_payment','initial_payment_composition'];
 const rent=rentKeys.map(k=>one(material,k));
 if(rent.some(fs=>fs.length)||formatId(material).includes('rental')){
  const fs=rent.flat();
  if(rent.some(f=>f.length!==1))emit('rental_initial_payment','NEI','rental_components_incomplete',fs,{missingKeys:rentKeys.filter((k,i)=>rent[i].length!==1)});
  else if(one(material,'payment_adjustment').length)emit('rental_initial_payment','NEI','payment_adjustment_requires_review',[...fs,...one(material,'payment_adjustment')]);
  else {
   const [monthly,deposit,prepaid,initial,composition]=rent.map(f=>f[0]);
   const text=(composition.source.regions||[]).map(r=>r.observedText).join('')||composition.source.observedText;
   const explicit=/押金/.test(text)&&/租金|房租/.test(text)&&/含|包括|包含|为|总计|首付/.test(text);
   if(!explicit)emit('rental_initial_payment','NEI','rental_components_incomplete',fs);
   else numeric('rental_initial_payment',fs,()=>({expected:number(monthly,decimal)*(number(deposit,decimal)+number(prepaid,decimal))/1000000n,actual:number(initial,decimal)}),'displayed_rental_composition',{scope:'explicit_deposit_plus_prepaid_rent_only'});
  }
 }
 if(formatId(material).includes('purchase')){
  const parts=['quantity','unit_price','contract_total'].map(k=>one(material,k));
  if(parts.every(fs=>fs.length===1)&&one(material,'payment_adjustment').length===0){
   const fs=parts.map(a=>a[0]);
   numeric('contract_line_total',fs,()=>({expected:number(fs[0],decimal)*number(fs[1],decimal)/1000000n,actual:number(fs[2],decimal)}),'line_quantity_times_unit_price',{scope:'single_explicit_quantity_and_price'});
  }
 }
 if(formatId(material)==='authorization_letter'){
  const starts=one(material,'authorization_start_date'),ends=one(material,'authorization_end_date'),fs=[...starts,...ends];
  if(starts.length!==1||ends.length!==1)emit('authorization_period','NEI','authorization_dates_missing',fs);
  else if(fs.some(f=>!good(f)))emit('authorization_period','NEI','content_recognition_requires_review',fs);
  else {
   const a=displayedDate(starts[0].value,starts[0].dateFormat),b=displayedDate(ends[0].value,ends[0].dateFormat);
   if(a.status!=='PASS'||b.status!=='PASS')emit('authorization_period','NEI','authorization_dates_invalid',fs);
   else emit('authorization_period',a.canonical<=b.canonical?'PASS':'FAIL','authorization_date_order',fs);
  }
 }
 return result;
}
const formatId=m=>typeof m.contentFormat==='string'?m.contentFormat:m.contentFormat?.id||m.contentFormat?.kind||'';
function anchors(m){
 const reviewable=f=>{const value=f.source?.regions?.at(-1);return f.confidence>=.75&&!f.extractionAmbiguous&&value?.confidence>=.95&&norm(value.observedText).includes(norm(f.value));};
 const by=(key)=>one(m,key).filter(f=>good(f)||reviewable(f));
 const answer=[];
 for(const [key,kind] of [['business_credit_code','registration'],['authorization_contract_number','authorization'],['dispatch_number','dispatch']]){
  const fs=by(key);if(fs.length!==1)continue;
  const value=norm(fs[0].value);
  if(kind==='registration'?!/^[0-9A-Z]{18}$/.test(value):value.length<4)continue;
  answer.push({kind,token:`${kind}:${formatId(m)}:${value}`,fields:fs});
 }

 const app=by('application_id'),shop=by('shop_url');
 if(app.length===1)answer.push({kind:'application',token:`application:${formatId(m)}:${norm(app[0].value)}`,fields:app});
 if(shop.length===1&&/^https?:\/\//i.test(shop[0].value))answer.push({kind:'shop',token:`shop:${formatId(m)}:${norm(shop[0].value).replace(/\/$/,'')}`,fields:shop});
 if(['no_arrears_certificate','income_tax_detail','tax_payment_certificate','tax_status_certificate'].includes(formatId(m)))for(const f of by('tax_identifier'))if(/^[A-Z0-9]{12,22}$/.test(f.value))answer.push({kind:'taxpayer',token:`taxpayer:${formatId(m)}:${f.role}:${norm(f.value)}`,role:f.role,fields:[f]});
 const invoice=by('invoice_number'),codes=by('invoice_code');
 if(invoice.length===1&&(m.type==='invoice'||m.type==='digital_invoice')){
  // Legacy invoice numbers alone are not globally unique. Require code as well.
  if(codes.length===1)answer.push({kind:'voucher',token:`invoice:${norm(codes[0].value)}:${norm(invoice[0].value)}`,fields:[codes[0],invoice[0]]});
  else if(m.type==='digital_invoice'&&/^\d{20}$/.test(invoice[0].value))answer.push({kind:'voucher',token:`digital:${invoice[0].value}`,fields:invoice});
 }
 for(const key of ['certificate_number','order_number','contract_number']){
  const fs=by(key);
  if(fs.length===1&&norm(fs[0].value).length>=4)answer.push({kind:key==='certificate_number'?'certificate':'contract',token:`${key}:${formatId(m)||m.type}:${norm(fs[0].value)}`,fields:fs});
 }
 const household=by('household_number');
 if(household.length===1&&norm(household[0].value).length>=5){
  const provider=one(m,'name','payee').filter(good);
  answer.push({kind:'utility',token:`utility:${formatId(m)}:${norm(household[0].value)}`,fields:[household[0],...provider]});
 }
 for(const f of by('identity_number')){
  // A printed identifier may itself be invalid. It is only an exact-string candidate.
  if(norm(f.value).length>=10&&!/[*＊•]/.test(f.value))answer.push({kind:'identity',token:`identity:${norm(f.value)}`,fields:[f],role:f.role});
 }
 const original=by('original_voucher_number'),issuer=one(m,'issuing_authority').filter(good);
 if(formatId(m)==='tax_payment_certificate'&&original.length===1&&issuer.length===1)answer.push({kind:'tax_voucher',token:`tax-voucher:${norm(issuer[0].value)}:${norm(original[0].value)}`,fields:[...original,...issuer]});
 return answer;
}
const fieldsFor=Object.fromEntries(Object.entries(contentRuleCatalog.crossMaterialProfiles).map(([kind,profile])=>[kind,profile.fields]));
const normValue=(f)=>{
 if(f.key==='dispatch_items'){try{return JSON.stringify(JSON.parse(f.value).map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)))).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));}catch{return norm(f.value);}}
 if(f.key==='account_list')return parseAccounts(f.value).join(';');
 if(f.valueType==='table_column') {try{return JSON.stringify(JSON.parse(f.value).map(({row,...v})=>{
    if(f.key==='tax_period'&&typeof v.value==='string'){
      const dates=[...v.value.matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m=>m[0]);
      const rest=v.value.replace(/\d{4}-\d{2}-\d{2}/g,'').replace(/[\s至~～—–-]/g,'');
      if(dates.length===2&&!rest&&dates.every(d=>displayedDate(d,'YYYY-MM-DD').status==='PASS'))v.value=dates.join('/');
    }
    return v;
   }));}catch{return norm(f.value);}}
 return norm(f.value);
};
function parseAccounts(value){try{const arr=JSON.parse(value);if(Array.isArray(arr))return unique(arr.map(v=>String(v).trim().toLowerCase())).sort();}catch{}return unique(value.split(/[;；,，\s]+/).filter(Boolean).map(v=>v.toLowerCase())).sort();}

/** Linear core-star candidate selection; no publisher group labels or answers as input. */
export function compareCoreContent(batch,{coreMaterialId,referenceFallback=true,compareOnlyKeys=null},{evidence}){
 const core=batch.materials.find(m=>m.id===coreMaterialId);
 const byToken=new Map();let anchorCount=0;
 for(const m of batch.materials)for(const a of anchors(m)){
  anchorCount++;if(!byToken.has(a.token))byToken.set(a.token,[]);byToken.get(a.token).push({material:m,anchor:a});
 }
 const candidates=[],checks=[],seen=new Set(),strongAux=new Set();
 for(const coreAnchor of anchors(core))for(const {material:aux,anchor} of byToken.get(coreAnchor.token)||[]){
  if(aux.id===core.id||aux.fileSha256===core.fileSha256)continue;
  if(coreAnchor.kind==='tax_voucher'&&strongAux.has(aux.id))continue;
  const pair=`${aux.id}:${anchor.kind}:${coreAnchor.role||''}:${anchor.role||''}`;if(seen.has(pair))continue;seen.add(pair);
  const utilityProviders=['utility','dispatch'].includes(anchor.kind)?[one(core,'name',anchor.kind==='dispatch'?'issuer':'payee').filter(good),one(aux,'name',anchor.kind==='dispatch'?'issuer':'payee').filter(good)]:null;
  const providerMismatch=utilityProviders&&utilityProviders.every(v=>v.length===1)&&norm(utilityProviders[0][0].value)!==norm(utilityProviders[1][0].value);
  const basis=[...coreAnchor.fields.map(f=>evidence(core,f)),...anchor.fields.map(f=>evidence(aux,f))];
  const recognitionRequiresReview=[...coreAnchor.fields,...anchor.fields].some(f=>!good(f));
  const candidate={recognitionRequiresReview,id:`content-candidate-${candidates.length+1}`,coreMaterialId:core.id,auxiliaryMaterialId:aux.id,kind:anchor.kind,status:recognitionRequiresReview?'recognition_review_required':'observed_identifier_match',trust:recognitionRequiresReview?'recognition_needs_review':'observed_text_not_registry_or_transaction_confirmation',...(providerMismatch?{scopeConfirmed:false,contextReason:anchor.kind==='dispatch'?'dispatch_issuer_differs':'utility_provider_differs'}:{}),basis};
  candidates.push(candidate);if(!recognitionRequiresReview)strongAux.add(aux.id);
  const rule={voucher:'same_voucher_content',certificate:'same_certificate_content',contract:'same_contract_content',identity:'same_identity_content',utility:'same_utility_account_content',registration:'same_registration_content',authorization:'same_authorization_content',dispatch:'same_dispatch_content',taxpayer:'same_taxpayer_content',application:'same_application_content',shop:'same_shop_content',tax_voucher:'same_tax_voucher_content'}[anchor.kind];
  for(const key of fieldsFor[anchor.kind].filter(k=>!compareOnlyKeys||compareOnlyKeys.includes(k))){
   let a=one(core,key),b=one(aux,key);
   const roles=anchor.kind==='identity'?[coreAnchor.role]:unique([...a,...b].map(f=>f.role));
   for(const role of roles){
    let aa=a.filter(f=>f.role===role),bb=b.filter(f=>f.role===(anchor.kind==='identity'?anchor.role:role));
    // For identities, compare the role linked by that exact identifier, not every person in a contract.
    if(anchor.kind==='identity'&&role!==coreAnchor.role&&role!==anchor.role&&key!=='account_list')continue;
    if(!aa.length&&!bb.length)continue;
    const refs=[...aa.map(f=>evidence(core,f)),...bb.map(f=>evidence(aux,f))];
    const extras={candidateId:candidate.id,comparedKey:key,comparedRole:role,materialIds:[core.id,aux.id],relationshipEvidence:candidate,scope:'displayed_identifier_consistency_not_authenticity'};
    if(recognitionRequiresReview){checks.push(msg(rule,'NEI','content_recognition_requires_review',[...refs,...basis],extras));continue;}
    if(aa.length>1||bb.length>1){
     // Fully extracted tables can be compared as multisets, independent of row order.
     const complete=core.contentExtraction?.lineItemsComplete&&aux.contentExtraction?.lineItemsComplete;
     if(!complete||aa.some(f=>!good(f))||bb.some(f=>!good(f))){checks.push(msg(rule,'NEI','matching_identifier_missing_comparison_field',refs,extras));continue;}
     const av=aa.map(normValue).sort(),bv=bb.map(normValue).sort();
     checks.push(msg(rule,JSON.stringify(av)===JSON.stringify(bv)?'PASS':'FAIL',JSON.stringify(av)===JSON.stringify(bv)?'matching_displayed_identifier_content_equal':'matching_displayed_identifier_content_difference',refs,extras));continue;
    }
    if(aa.length!==1||bb.length!==1){checks.push(msg(rule,'NEI','matching_identifier_missing_comparison_field',refs,{...extras,missingMaterialIds:[...(!aa.length?[core.id]:[]),...(!bb.length?[aux.id]:[])]}));continue;}
    if(key==='dispatch_items'&&(!aa[0].rowsComplete||!bb[0].rowsComplete)){checks.push(msg(rule,'NEI','line_set_incomplete',refs,extras));continue;}
    if(!good(aa[0])||!good(bb[0])){checks.push(msg(rule,'NEI','content_recognition_requires_review',refs,extras));continue;}
    const equal=normValue(aa[0])===normValue(bb[0]);
    if(key==='account_list'){
     const left=parseAccounts(aa[0].value),right=parseAccounts(bb[0].value);
     checks.push(msg('commitment_account_set_difference',equal?'PASS':'WARN',equal?'account_sets_equal':'account_set_difference_not_automatic_violation',refs,{...extras,comparison:{leftCount:left.length,rightCount:right.length,intersection:left.filter(x=>right.includes(x)),onlyCore:left.filter(x=>!right.includes(x)),onlyAuxiliary:right.filter(x=>!left.includes(x))},requiresContext:!equal,benchmarkAssumptionApplied:false}));
    }else checks.push(msg(rule,equal?'PASS':providerMismatch||['registration','authorization','taxpayer','application','shop','tax_voucher'].includes(anchor.kind)?'WARN':'FAIL',equal?'matching_displayed_identifier_content_equal':anchor.kind==='authorization'?'authorization_content_differs':anchor.kind==='registration'?'registration_content_differs':'matching_displayed_identifier_content_difference',refs,{...extras,requiresContext:!equal&&['registration','authorization','taxpayer','application','shop','tax_voucher'].includes(anchor.kind)}));
   }
  }
 }
 // If the core's field is unreadable, retain its NEI but allow one complete
 // representative per field within that exact core-anchored cluster. No all-pairs.
 let referenceChecks=0;
 if(referenceFallback)for(const a of anchors(core)){
  const pool=[...new Map((byToken.get(a.token)||[]).map(x=>[x.material.id,x.material])).values()];
  if(pool.length<3)continue;
  for(const key of fieldsFor[a.kind]){
   const coreValues=one(core,key);
   if(coreValues.length&&coreValues.every(good))continue;
   const ref=pool.find(m=>m.id!==core.id&&one(m,key).length===1&&good(one(m,key)[0]));
   if(!ref)continue;
   const supplemented=compareCoreContent({...batch,materials:pool},{coreMaterialId:ref.id,referenceFallback:false,compareOnlyKeys:[key]},{evidence});
   for(const c of supplemented.checks){
    if(c.materialIds.includes(core.id))continue;
    checks.push({...c,candidateId:`reference-${referenceChecks+1}`,referenceComparison:true,referenceMaterialId:ref.id,coreMaterialId:core.id,scope:'core_identifier_cluster_reference_comparison_not_core_field_recovery'});referenceChecks++;
   }
  }
 }
 return {version:CONTENT_RULE_VERSION,candidates,checks,complexity:{strategy:'indexed_core_identifier_star',materialsIndexed:batch.materials.length,identifierEntries:anchorCount,candidateCount:candidates.length,referenceChecks,checks:checks.length},externalVerification:'not_run'};
}

export function explainLocalCheck(check){
 const title=check.title||CONTENT_RULE_NAMES[check.rule]||({invoice_net_tax_gross:'价税金额核对',amount_words_numeric:'大小写金额核对',displayed_tax_rate:'税率与税额核对',displayed_calendar_date:'日期有效性',identity_structure:'身份号码校验',invoice_number_format:'发票号码格式',invoice_code_format:'发票代码格式',institution_policy:'适用审核制度',scenario_applicability:'核验目标适用性'})[check.rule]||check.rule;
 const field=fieldNames[check.comparedKey]||check.comparedKey;
 const refs=check.evidence||[];
 const baseReasons={
  date_format_not_confirmed:'尚未确认该日期文字的格式，没有执行日历有效性判断。',
  displayed_rate_times_line_net:'已按同一行显示税率和不含税金额核对税额，采用0.01元容差；这不判断法定适用税率。',
  displayed_upper_lower_amount_consistency:'已核对本材料大写与小写金额；状态仅描述这两个显示值是否一致。',
  historical_region_table_not_configured:'尚未配置历史行政区划参考表，没有核验身份号码的历史地区编码。',
  identity_checksum_mismatch:'显示身份号码的校验位不符合校验计算，请核对原件及识别值；不据此断言身份虚假。',
  identity_format_not_18_digits_or_ocr_ambiguity:'显示身份号码不符合18位格式或存在识别歧义，请核对原件；不自动补写号码。',
  identity_or_related_field_requires_review:'身份号码或用于关联的字段尚不适合直接比较，需要先核对识别内容。',
  identity_structure_checksum_only:'身份号码结构、出生日期和校验位检查通过；未查询官方身份登记。',
  invoice_number_length_only:`已按本次确认票种检查发票号码位数${check.expectedDigits?`，要求${check.expectedDigits}位`:''}。`,
  legacy_electronic_ordinary_code_structure_only:'已检查传统电子普通发票代码的12位及首位规则；疑似文件遭遇篡改，请核对原件。',
  missing_or_ambiguous_related_field:'用于对应核验的字段缺失或存在多个候选，尚未完成比较。',
  recognition_requires_review:'有关文字识别分数不足或存在提取歧义，需要核对原图后再判断。',
  currency_not_comparable:'字段币种不明确或不一致，没有执行金额比较。',
  ambiguous_numeric_text:'数值文字尚不能唯一解析，没有猜测金额。',
 };
 let explanation=baseReasons[check.reason]||check.explanation||CONTENT_REASON_NAMES[check.reason];
 if(check.reason==='matching_displayed_identifier_content_difference')explanation=`${field||'对应内容'}在相同显示标识的材料之间不同；疑似文件遭遇篡改，请核对原件。`;
 if(check.reason==='missing_or_ambiguous_amounts')explanation='未能唯一提取不含税金额、税额及价税合计，尚未完成计算；不代表原件没有这些内容。';
 if(check.reason==='institution_policy_not_configured')explanation='尚未配置本次适用的机构制度，没有完成制度合规核验。';
 if(check.reason==='legacy_invoice_subtype_not_confirmed')explanation='尚未确认传统发票的具体类型，没有执行对应的号码格式检查。';
 if(check.reason==='engineering_rule_scope_only')explanation='该材料类型属于当前功能接受范围；不代表业务内容审核通过。';
 if(check.reason==='displayed_amount_arithmetic_only'){
  const amount=v=>{const m=String(v).match(/^([+-]?\d+)(?:\.(\d+))?$/);if(!m)return String(v);let f=(m[2]||'').padEnd(2,'0');while(f.length>2&&f.endsWith('0'))f=f.slice(0,-1);return `${m[1]}.${f}`;};
  const net=check.netAmount??refs.find(e=>e.key==='net_amount')?.value,tax=check.taxAmount??refs.find(e=>e.key==='tax_amount')?.value;
  explanation=check.status==='FAIL'?`不含税金额${amount(net)}元＋税额${amount(tax)}元，应为${amount(check.expected)}元；票面价税合计${amount(check.actual)}元，相差${amount(check.difference)}元，超过${check.tolerance||'0.01'}元容差。疑似文件遭遇篡改，请核对原件。`:`价税合计核验正常：${amount(net)}元＋${amount(tax)}元＝${amount(check.actual)}元。`;
 }

 if(check.reason==='no_supported_fields')explanation='OCR可能已有文字，但尚未提取出可供本地规则使用的业务字段。';
 if(check.rule==='rental_initial_payment'&&check.calculation)explanation=`按明示月租与押付组成应为${check.calculation.expectedAmount}元，首付款写为${check.calculation.actualAmount}元；${check.status==='FAIL'?'两者不一致，请核对是否另有抵扣或补充约定。':'该组成计算一致。'}`;
 if(check.reason==='invoice_number_length_only'){
  const type=check.invoiceType||(check.expectedDigits===20?'数电发票':'增值税电子普通发票');
  explanation=check.status==='PASS'?`按照${type}规则核验，发票号码为${check.expectedDigits}位，核验正常。`:`按照${type}规则，发票号码应为${check.expectedDigits}位；本次识别为${check.actualDigits??refs[0]?.value?.length}位。疑似文件遭遇篡改，请核对原件。`;
 }
 if(check.reason==='legacy_electronic_ordinary_code_structure_only'){
  explanation=check.status==='PASS'?'按照增值税电子普通发票规则，代码为12位且以0开头，核验正常。':check.status==='FAIL'?`按照增值税电子普通发票规则，代码应为12位且以0开头；本次识别为${check.actualDigits??refs[0]?.value?.length}位、首位${check.actualPrefix??refs[0]?.value?.slice(0,1)}。疑似文件遭遇篡改，请核对原件。`:'发票代码尚未完整、清晰提取，暂不能核验。';
 }
 if(check.reason==='calendar_date_only')explanation='日期核验正常。';
 return {title,explanation:explanation||check.reason,evidenceCount:refs.length,scoreSemantics:'OCR识别分数，不是核验正确率或真实性概率'};
}

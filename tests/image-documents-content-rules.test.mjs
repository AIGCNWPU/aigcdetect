import test from 'node:test';
import assert from 'node:assert/strict';
import {contentChecks,compareCoreContent} from '../src/modules/image/documents/server/content-rules.js';
import {decimal,evidence} from '../src/modules/image/documents/server/batch-engine.js';
import {evaluateReview} from '../src/modules/image/documents/server/review-plan.js';
import {assessExecution} from '../src/modules/image/documents/server/execution-assessment.js';
import {presentReview} from '../src/modules/image/documents/server/review-presentation.js';
const deps={decimal,evidence};
function m(id,type,rows){const sha=id.charCodeAt(0).toString(16).padStart(2,'0').repeat(32);return {id,type,version:1,fileSha256:sha,pages:[{number:1,status:'succeeded',width:100,height:100}],fields:rows.map(([key,value,extra={}],i)=>({id:`f${i}`,key,value,role:'transaction',version:1,confidence:.99,source:{fileSha256:sha,page:1,provider:'ocr',observedText:value,polygon:[[0,0],[90,0],[90,10],[0,10]]},...extra}))};}
const invoice=(id,name,code='012345678901')=>m(id,'invoice',[['invoice_code',code],['invoice_number','12345678'],['name',name,{role:'buyer'}]]);
const batch=materials=>({id:'test',version:1,materials});
test('同代码和号码产生可见凭证候选及名称差异，不升级受信交易',()=>{
 const b=batch([invoice('a','甲'),invoice('b','乙')]);const r=compareCoreContent(b,{coreMaterialId:'a'},deps);
 assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].status,'observed_identifier_match');assert.match(r.candidates[0].trust,/not_registry/);
 assert.ok(r.checks.some(c=>c.comparedKey==='name'&&c.status==='FAIL'));assert.equal(r.externalVerification,'not_run');
});
test('相同票号不同代码、同名同金额和重复源图不能建立错误候选',()=>{
 const a=invoice('a','甲'),b=invoice('b','甲','112345678901');assert.equal(compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps).candidates.length,0);
 const c=m('c','contract',[['name','甲'],['gross_amount','100']]),d=m('d','contract',[['name','甲'],['gross_amount','100']]);assert.equal(compareCoreContent(batch([c,d]),{coreMaterialId:'c'},deps).candidates.length,0);
 const e=invoice('e','乙');e.fileSha256=a.fileSha256;assert.equal(compareCoreContent(batch([a,e]),{coreMaterialId:'a'},deps).candidates.length,0);
});
test('账户集合不同是确定差异WARN，不擅自应用完整列表违规条件',()=>{
 const a=m('a','certificate',[['identity_number','123456789012345678',{role:'subject'}],['account_list','["a@example.test"]',{role:'subject'}]]),b=m('b','certificate',[['identity_number','123456789012345678',{role:'subject'}],['account_list','["b@example.test","a@example.test"]',{role:'subject'}]]);
 const c=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps).checks.find(c=>c.comparedKey==='account_list');assert.equal(c.status,'WARN');assert.equal(c.comparison.intersection.length,1);assert.equal(c.comparison.onlyAuxiliary.length,1);assert.equal(c.benchmarkAssumptionApplied,false);
});
test('同一合同的两名当事人分别比较，不让首个身份候选吞掉第二个',()=>{
 const parts=(lessee)=>[['identity_number','111111111111111111',{role:'lessor'}],['name','出租人',{role:'lessor'}],['identity_number','222222222222222222',{role:'lessee'}],['name',lessee,{role:'lessee'}]];
 const r=compareCoreContent(batch([m('a','contract',parts('甲')),m('b','contract',parts('乙'))]),{coreMaterialId:'a'},deps);
 assert.equal(r.candidates.length,2);assert.ok(r.checks.some(c=>c.comparedKey==='name'&&c.comparedRole==='lessee'&&c.status==='FAIL'));
});
test('核心缺字段仍NEI，同编号组选择完整参考线性补核，不伪造核心字段',()=>{
 const make=(id,period)=>{const v=m(id,'certificate',[['certificate_number','CERT1234'],...(period?[['tax_period',period,{valueType:'table_column'}]]:[])]);v.contentFormat='tax_payment_certificate';return v;};
 const b=batch([make('a'),make('b','[{"row":1,"taxType":"税A","value":"2024-01"}]'),make('c','[{"row":1,"taxType":"税A","value":"2024-02"}]')]);
 const r=compareCoreContent(b,{coreMaterialId:'a'},deps);assert.ok(r.checks.some(c=>c.status==='NEI'&&c.comparedKey==='tax_period'));
 assert.ok(r.checks.some(c=>c.referenceComparison&&c.status==='FAIL'&&c.comparedKey==='tax_period'));assert.equal(b.materials[0].fields.length,1);assert.equal(r.complexity.referenceChecks,1);
});
test('低置信度或重复候选不能升级内容差异为确定FAIL',()=>{
 const a=invoice('a','甲'),b=invoice('b','乙');b.fields.find(f=>f.key==='name').confidence=.4;
 const r=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert.equal(r.checks.find(c=>c.comparedKey==='name').status,'NEI');
});
test('租赁组成跨OCR块仍能本地发现3400与2400差额，抵扣或缺字段弃权',()=>{
 const x=m('a','contract',[['monthly_rent','1700'],['deposit_months','1'],['prepaid_months','1'],['initial_payment','2400'],['initial_payment_composition','其中包括一个月押金及一个月房租。']]);
 x.contentFormat='rental_contract';x.fields.at(-1).source={...x.fields.at(-1).source,observedText:'押金及一个月房租。',regions:[{observedText:'其中包括一个月'},{observedText:'押金及一个月房租。'}]};
 let r=contentChecks(x,deps).find(c=>c.rule==='rental_initial_payment');assert.equal(r.status,'FAIL');assert.equal(r.calculation.expectedAmount,'3400.00');
 x.fields.push({...x.fields[0],id:'discount',key:'payment_adjustment',value:'已付1000元'});assert.equal(contentChecks(x,deps).find(c=>c.rule==='rental_initial_payment').status,'NEI');
 x.fields=x.fields.filter(f=>!['payment_adjustment','prepaid_months'].includes(f.key));assert.equal(contentChecks(x,deps).find(c=>c.rule==='rental_initial_payment').status,'NEI');
});
test('明细只在同一行计算，完整性未声明不强求明细汇总',()=>{
 const x=m('a','invoice',[['quantity','2',{taxScope:'r1'}],['unit_price','100',{taxScope:'r1',currency:'CNY'}],['line_net_amount','150',{taxScope:'r1',currency:'CNY'}],['net_amount','900',{currency:'CNY'}]]);
 const r=contentChecks(x,deps);assert.equal(r.find(c=>c.rule==='invoice_line_arithmetic').status,'FAIL');assert.equal(r.some(c=>c.rule==='invoice_line_totals'),false);
});
test('核心候选数量随辅助文件线性增长，不枚举全部材料对',()=>{
 const materials=Array.from({length:100},(_,i)=>invoice(String.fromCharCode(1000+i),'同名'));const r=compareCoreContent(batch(materials),{coreMaterialId:materials[0].id},deps);assert.equal(r.candidates.length,99);assert.ok(r.checks.length<=100);assert.equal(r.complexity.materialsIndexed,100);
});
test('本地价税FAIL即使语义NEI仍在用户提醒中',()=>{
 const x=invoice('a','甲');for(const [key,value] of [['net_amount','100'],['tax_amount','13'],['gross_amount','100']])x.fields.push({...x.fields[0],id:key,key,value,currency:'CNY',basis:key});
 const b=batch([x]),r=evaluateReview(b,{coreMaterialId:'a',objective:'invoice_review',jurisdiction:'CN'});r.executionAssessment=assessExecution({batch:b,review:r,materials:[x]});
 const p=presentReview({materials:[x],review:r,semanticReview:{status:'completed',items:[{verdict:'needs_more_information',recommendation:'核实版本'}]}});assert.equal(p.status,'issues_found');assert.ok(p.warnings.some(w=>/价税|金额/.test(w.title)));
});

test('税期两个已识别日期的分隔符缺失不制造差异，额外未知字符仍不得静默修复',()=>{
 const make=(id,value)=>{const x=m(id,'certificate',[['certificate_number','CERT1234'],['tax_period',JSON.stringify([{row:1,taxType:'增值税',value}]),{valueType:'table_column'}]]);x.contentFormat='tax_payment_certificate';return x;};
 const a=make('a','2024-01-012024-06-30'),b=make('b','2024-01-01至2024-06-30');
 let r=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert.equal(r.checks.find(c=>c.comparedKey==='tax_period').status,'PASS');
 const c=make('c','2024-01-01至2024-07-31');r=compareCoreContent(batch([a,c]),{coreMaterialId:'a'},deps);assert.equal(r.checks.find(c=>c.comparedKey==='tax_period').status,'FAIL');
 const d=make('d','2024-01-011至2024-06-30');r=compareCoreContent(batch([a,d]),{coreMaterialId:'a'},deps);assert.notEqual(r.checks.find(c=>c.comparedKey==='tax_period').status,'PASS');
});

test('自动原因显示金额差距、具体票种和正常日期，缺证不报疑似篡改',async()=>{
 const {invoiceArithmetic}=await import('../src/modules/image/documents/server/batch-engine.js');
 const {explainLocalCheck}=await import('../src/modules/image/documents/server/content-rules.js');
 const x=m('a','invoice',[['net_amount','1999.99',{currency:'CNY'}],['tax_amount','259.99',{currency:'CNY'}],['gross_amount','1999.99',{currency:'CNY'}]]);
 const c=invoiceArithmetic(x)[0],text=explainLocalCheck(c).explanation;
 assert.equal(c.difference,'259.990000');assert.match(text,/2259.98元/);assert.match(text,/相差259.99元/);assert.match(text,/疑似文件遭遇篡改，请核对原件/);
 assert.equal(explainLocalCheck({rule:'displayed_calendar_date',status:'PASS',reason:'calendar_date_only'}).explanation,'日期核验正常。');
 const number=explainLocalCheck({rule:'invoice_number_format',reason:'invoice_number_length_only',status:'FAIL',invoiceType:'增值税电子普通发票',expectedDigits:8,actualDigits:7});assert.match(number.explanation,/增值税电子普通发票/);assert.match(number.explanation,/应为8位/);assert.match(number.explanation,/识别为7位/);assert.doesNotMatch(number.explanation,/不是官方/);
 const missing=explainLocalCheck({rule:'invoice_net_tax_gross',status:'NEI',reason:'missing_or_ambiguous_amounts'});assert.doesNotMatch(missing.explanation,/疑似文件遭遇篡改/);
 x.fields[0].value='99999999999999.99';x.fields[1].value='.02';x.fields[1].value='0.02';x.fields[2].value='99999999999999.99';const large=explainLocalCheck(invoiceArithmetic(x)[0]).explanation;assert.match(large,/100000000000000.01元/);assert.match(large,/相差0.02元/);
});

test('同户号收费单位不同时保留差异WARN，不将两家公司的相同户号强认同户',()=>{
 const make=(id,provider,address)=>{const x=m(id,'receipt',[['household_number','123456789',{role:'subject'}],['name',provider,{role:'payee'}],['registered_address',address,{role:'subject'}]]);x.contentFormat='utility_payment_receipt';return x;};
 const r=compareCoreContent(batch([make('a','电力甲公司','甲地址'),make('b','电力乙公司','乙地址')]),{coreMaterialId:'a'},deps);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].contextReason,'utility_provider_differs');assert.equal(r.checks.find(c=>c.comparedKey==='registered_address').status,'WARN');
});

test('授权对象不同只报范围待核实，核心有多个正常角色不再补做辅助两两比较',()=>{
 const make=(id,person)=>{const x=m(id,'authorization',[['authorization_contract_number','ABC12345'],['name','甲公司',{role:'grantor'}],['name',person,{role:'grantee'}]]);x.contentFormat={kind:'authorization_letter'};return x;};
 const r=compareCoreContent(batch([make('a','张三'),make('b','李四'),make('c','王五')]),{coreMaterialId:'a'},deps);
 assert.equal(r.candidates.length,2);assert.equal(r.complexity.referenceChecks,0);
 assert.equal(r.checks.filter(c=>c.status==='WARN').length,2);assert(!r.checks.some(c=>c.status==='FAIL'));
});
test('登记代码相同的经营者差异不直接裁定无变更情况下造假',()=>{
 const a=m('a','certificate',[['business_credit_code','91350100MA2TRM6123'],['name','张三',{role:'operator'}]]),b=m('b','certificate',[['business_credit_code','91350100MA2TRM6123'],['name','李四',{role:'operator'}]]);a.contentFormat=b.contentFormat={kind:'business_license'};
 const r=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert.equal(r.candidates.length,1);assert.equal(r.checks[0].status,'WARN');assert.equal(r.checks[0].requiresContext,true);
 b.fields[0].value='91350100MA2TRM6124';assert.equal(compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps).candidates.length,0);
});
test('授权结束时间早于开始时间时本地报告异常，不推断是否仍然有效',()=>{
 const a=m('a','authorization',[['authorization_start_date','2026-12-01',{dateFormat:'YYYY-MM-DD'}],['authorization_end_date','2026-01-01',{dateFormat:'YYYY-MM-DD'}]]);a.contentFormat={kind:'authorization_letter'};
 assert.equal(contentChecks(a,deps).find(c=>c.rule==='authorization_period').status,'FAIL');
});

test('同出库编号但出具公司不同只产生待确认差异，不直接确认同一出库业务',()=>{
 const a=m('a','delivery_note',[['dispatch_number','ABC12345'],['name','甲公司',{role:'issuer'}],['customer_contact','张三',{role:'recipient'}]]),b=m('b','delivery_note',[['dispatch_number','ABC12345'],['name','乙公司',{role:'issuer'}],['customer_contact','李四',{role:'recipient'}]]);a.contentFormat=b.contentFormat={kind:'dispatch_note'};
 const r=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert.equal(r.candidates[0].scopeConfirmed,false);assert(r.checks.some(c=>c.status==='WARN'));assert(!r.checks.some(c=>c.status==='FAIL'));
});

test('出库明细按完整集合比较，行序不同不报错，缺行仍NEI',()=>{
 const rows=[{item_code:'01',item_description:'甲',quantity:'2'},{item_code:'02',item_description:'乙',quantity:'3'}];
 const make=(id,items)=>{const x=m(id,'delivery_note',[['dispatch_number','ABC12345'],['dispatch_items',JSON.stringify(items),{rowsComplete:true}]]);x.contentFormat={kind:'dispatch_note'};return x;};
 const a=make('a',rows),b=make('b',[...rows].reverse());
 assert.equal(compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps).checks.find(c=>c.comparedKey==='dispatch_items').status,'PASS');
 b.fields[1].rowsComplete=false;assert.equal(compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps).checks.find(c=>c.comparedKey==='dispatch_items').status,'NEI');
});

test('号码值清楚但角色绑定识别偏低时仅建待复核候选，所有比较保持NEI',()=>{
 const a=m('a','contract',[['identity_number','123456199001011234',{role:'lessor',confidence:.84}],['name','张三',{role:'lessor'}]]),b=m('b','contract',[['identity_number','123456199001011234',{role:'lessor'}],['name','李四',{role:'lessor'}]]);
 a.fields[0].source.regions=[{regionId:'label',observedText:'(甲方)出租人',confidence:.84},{regionId:'value',observedText:'123456199001011234',confidence:.999}];
 const r=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].recognitionRequiresReview,true);assert(r.checks.every(c=>c.status==='NEI'));assert(!r.checks.some(c=>c.status==='FAIL'));
});
test('相同扣缴义务人标识下名称差异为待核对，不当成原始主体确认',()=>{
 const a=m('a','certificate',[['tax_identifier','91350100MA2TRM6123',{role:'withholding_agent'}],['name','甲公司',{role:'withholding_agent'}]]),b=m('b','certificate',[['tax_identifier','91350100MA2TRM6123',{role:'withholding_agent'}],['name','乙公司',{role:'withholding_agent'}]]);a.contentFormat=b.contentFormat={kind:'income_tax_detail'};
 const r=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert.equal(r.candidates.length,1);assert(r.checks.some(c=>c.status==='WARN'));assert(!r.checks.some(c=>c.status==='FAIL'));
});

test('证明号不同但同机关同原凭证号只补充待核对候选，不伪造同证明关系',()=>{
 const make=(id,num,name)=>{const x=m(id,'certificate',[['certificate_number',num],['original_voucher_number','1119000789'],['issuing_authority','甲市税务局',{role:'issuer'}],['name',name,{role:'subject'}]]);x.contentFormat={kind:'tax_payment_certificate'};return x;};
 const a=make('a','11111111','甲公司'),b=make('b','22222222','乙公司');
 const r=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert.equal(r.candidates.length,1);assert.equal(r.candidates[0].kind,'tax_voucher');assert(r.checks.some(c=>c.status==='WARN'));assert(!r.checks.some(c=>c.status==='FAIL'));
 b.fields[0].value='11111111';const strong=compareCoreContent(batch([a,b]),{coreMaterialId:'a'},deps);assert(!strong.candidates.some(c=>c.kind==='tax_voucher'));
});

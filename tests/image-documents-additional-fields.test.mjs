import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichAdditionalFields} from '../src/modules/image/documents/server/additional-content-fields.js';
function run(lines,existing=[]) {
 const regions=lines.map(([text,x=30,y=0,w=200,confidence=.99],i)=>({region_id:`r${i}`,observed_text:text,recognition_confidence:confidence,polygon:[[x,y],[x+w,y],[x+w,y+20],[x,y+20]]}));
 const material={type:'certificate',fileSha256:'a'.repeat(64),fields:existing};
 const result=enrichAdditionalFields({regions,oriented_size:[1800,2500]},{material,digest:'b'.repeat(64)});
 assert.equal(material.type,'certificate');return result;
}
const get=(r,k,role)=>r.fields.find(f=>f.key===k&&(!role||f.role===role));
test('title gates extraction; mention is not a loan document',()=>{
 const r=run([['材料清单',30,0],['请提供借条',30,60],['借款人：张某',30,100]]);
 assert.equal(r.format.kind,'unknown');assert.equal(r.fields.length,0);
});
test('utility aliases preserve original OCR evidence, missing values and ambiguity',()=>{
 const r=run([['生活缴费凭证',30,0],['用户编号',30,100,100,.82],['12345678',300,100],['用电地址：甲市乙路1号',30,160],['用电地址：甲市乙路2号',30,220],['缴费时间：',30,280]]);
 assert.equal(get(r,'household_number').value,'12345678');assert.equal(get(r,'household_number').confidence,.82);
 assert.equal(get(r,'household_number').source.regions.length,2);
 assert.equal(r.fields.filter(f=>f.key==='registered_address').length,2);
 assert(r.fields.filter(f=>f.key==='registered_address').every(f=>f.extractionAmbiguous));
 assert(r.review.some(v=>v.reason==='content_label_value_missing'));
 assert(r.coverage.unmatchedRegionIds.includes('r5'));
});
test('loan attaches identities to separate explicit roles and never repairs values',()=>{
 const r=run([['借 条',400,0],['借款人：张*三 身份证号码：',30,80,600],['123456199001011234',700,80],['本人张*三因经营贷款周转特向',30,160,650],['李*四 身份证',750,160,300],['号码为：123456200001011235 借款499.97元',30,200,900],['借款日期：2026年1月1日',30,300],['还款日期：2026年2月1日前一次性还清',30,360]]);
 assert.equal(r.format.kind,'loan_note');assert.equal(get(r,'name','borrower').value,'张*三');
 assert.equal(get(r,'identity_number','borrower').value,'123456199001011234');
 assert.equal(get(r,'name','lender').value,'李*四');assert.equal(get(r,'identity_number','lender').value,'123456200001011235');
 assert.equal(get(r,'loan_amount').value,'499.97');assert.equal(get(r,'repayment_date').value,'2026年2月1日');
 assert.equal(get(r,'loan_date').dateFormat,'YYYY年MM月DD日');
});
test('tax status certificate extracts labelled identifier/name without inferring authority from location',()=>{
 const r=run([['纳税证明',30,0],['甲市纳税证（2026）123456',30,50],['甲乙设计工作室 统一社会信用代码：123456789012345ABC 在2026年1月1日',30,100,1400],['文书凭证序号：',30,200,250],['987654321000',400,200],['截至2026年1月31日，欠缴税费0元。',30,250]]);
 assert.equal(get(r,'name','subject').value,'甲乙设计工作室');assert.equal(get(r,'tax_identifier').value,'123456789012345ABC');
 assert.equal(get(r,'certificate_number').value,'987654321000');assert.equal(get(r,'tax_status_date').value,'2026年1月31日');
 assert(!get(r,'issuing_authority'));
});
test('Jingdong recognises explicit paid total and ignores promotional prices',()=>{
 const r=run([['京东超市',30,0],['商品促销 ￥100',30,80],['订单编号：',30,300,180],['2000001234',300,300],['实付金额 ￥999.95',700,300,500],['付款人：周* 联系电话：158****1234',30,400,1100],['2026-01-01 20:00:00',30,450]]);
 assert.equal(r.format.kind,'jd_order');assert.equal(get(r,'order_total').value,'999.95');assert.equal(get(r,'order_total').basis,'order_total');
 assert.equal(get(r,'order_number').value,'2000001234');assert.equal(get(r,'name','payer').value,'周*');
 assert(!get(r,'transaction_date'));assert.equal(get(r,'displayed_order_date').value,'2026-01-01 20:00:00');
});
test('existing slot wins, additive adapter never mutates existing source',()=>{
 const old={key:'household_number',role:'subject',value:'original'};
 const r=run([['生活缴费凭证',30,0],['户号：12345678',30,80]],[old]);assert(!get(r,'household_number'));assert.equal(old.value,'original');
});

test('wide mobile receipt labels and repeated OCR label suffix retain address evidence',()=>{
 const r=run([['生活缴费凭证',300,20],['¥500.00',600,90],['电费',80,160],['户号',50,240,100],['12345678901',1150,244,250],['住址信息息',50,300,200],['甲市乙路1号',1100,304,400]]);
 assert.equal(get(r,'household_number').value,'12345678901');assert.equal(get(r,'registered_address').value,'甲市乙路1号');
 assert.equal(get(r,'payment_amount').value,'500.00');
 assert(r.review.some(v=>v.reason==='label_duplicate_suffix_requires_review'));
});
test('short displayed tax identifier is retained for rule review rather than silently dropped',()=>{
 const r=run([['纳税证明',30,0],['某公司 统一社会信用代码：123456A1B23456 在2026年1月1日',30,80,1500]]);
 assert.equal(get(r,'tax_identifier').value,'123456A1B23456');assert(r.review.some(v=>v.reason==='tax_identifier_shape_requires_review'));
});
test('loan party geometry is row-ordered and fragmented 身份证 does not contaminate names',()=>{
 const r=run([['借条',400,0],['借款人：张*三身份证号码',30,100,400],['123456199001011234',650,104,400],['本人张*三因经营周转特向',30,180,700],['李*四',850,174,100],['身',1000,174,50],['份证号码为：',30,230,250],['123456200001011235',400,230,400],['借款800元整',900,224,300]]);
 assert.equal(get(r,'name','borrower').value,'张*三');assert.equal(get(r,'name','lender').value,'李*四');
 assert.equal(get(r,'identity_number','borrower').value,'123456199001011234');assert.equal(get(r,'identity_number','lender').value,'123456200001011235');
});

test('utility bill detail keeps combined household identity distinct from provider and preserves signed debit',()=>{
 const r=run([['< 缴费详情',100,20],['国网甲省电力公司（甲市）',100,100,900],['-100.00',600,170,300],['已到账',600,230],['支付成功',100,290],['户号信息',100,450,200],['12345678901 | TestUser',900,450,650],['住址信息',100,520,200],['甲省乙市某街道******',900,520,650],['常见问题',100,700],['电费多少钱一度',100,760],['99.00',600,820]]);
 assert.equal(r.format.kind,'utility_bill_detail');assert.equal(get(r,'household_number').value,'12345678901');
 assert.equal(get(r,'name','subject').value,'TestUser');assert.equal(get(r,'name','payee').value,'国网甲省电力公司(甲市)');
 assert.equal(get(r,'payment_amount').value,'-100.00');assert.equal(get(r,'payment_amount').signedDisplay,true);
 assert.equal(get(r,'registered_address').value,'甲省乙市某街道******');
 assert(r.review.some(v=>v.reason==='declared_type_format_requires_review'));
});

test('授权书按被授权人角色提取，保留合同号和明确期限',()=>{
 const r=run([['授权书',400,20],['兹授权',50,100,160],['张*甲',300,100,150],['为大陆地区经销代理某电子有限公司',50,160,1200],['授权期限：2024年1月1日至2026年12月31日',50,220,1200],['授权经销合同号：123456789',50,280,1000]]);
 assert.equal(r.format.kind,'authorization_letter');assert.equal(get(r,'name','grantee').value,'张*甲');assert.equal(get(r,'authorization_contract_number').value,'123456789');assert.equal(get(r,'authorization_end_date').value,'2026年12月31日');
});
test('营业执照保留统一代码、主体与经营者角色，不自动补登记地址',()=>{
 const r=run([['营业执照',400,20],['统一社会信用代码',50,100,300],['91350100MA2TRM6123',450,100,500],['名称',50,180,100],['某经营部',250,180,400],['经营者',50,240,150],['张*甲',250,240,200],['注册日期',900,240,200],['2024年11月07日',1150,240,300]]);
 assert.equal(r.format.kind,'business_license');assert.equal(get(r,'name','operator').value,'张*甲');assert.equal(get(r,'business_credit_code').value,'91350100MA2TRM6123');assert(!get(r,'registered_address'));
});
test('在职证明保留人员姓名、显示身份号和入职日期',()=>{
 const r=run([['在职证明',400,20],['兹证明',50,100,150],['张*甲',250,100,160],['男，身份证号码：',450,100,330],['12345619900101123',900,100,400],['入职日期时间：2024-05-12',50,200,600]]);
 assert.equal(r.format.kind,'employment_certificate');assert.equal(get(r,'name','subject').value,'张*甲');assert.equal(get(r,'employment_start_date').value,'2024-05-12');
});
test('未支持材料不因正文提到授权书而误分类',()=>{
 const r=run([['材料说明',400,20],['请补交授权书及营业执照',50,100,1200]]);assert.equal(r.format.kind,'unknown');assert.equal(r.fields.length,0);
});

test('标签框与值框少量重叠时保留明确姓名，代码可在标签正下方',()=>{
 const a=run([['授权书',400,20],['滋授权',100,100,180],['张*甲',260,100,140],['授权经销合同号：ABC12345',50,200,700]]);assert.equal(get(a,'name','grantee').value,'张*甲');
 const b=run([['营业执照',600,20],['统一社会信用代码',100,100,300],['91350100MA2TRM6123',100,140,400]]);assert.equal(get(b,'business_credit_code').value,'91350100MA2TRM6123');
});
test('在职身份证标签前含性别且兹证明带逗号时保持姓名与号码',()=>{
 const r=run([['在职证明',400,20],['兹证明，',100,100,180],['周*甲',270,100,150],['男，身份证号码：',500,100,300],['123456199001011234',900,100,400]]);
 assert.equal(get(r,'name','subject').value,'周*甲');assert.equal(get(r,'identity_number','subject').value,'123456199001011234');
});
test('TOTAL/CASH票据只保留显示值，不猜币种和千位分隔',()=>{
 const r=run([['TOTAL',50,100,200],['60.000',400,100,200],['CASH',50,160,200],['60.000',400,160,200]]);
 assert.equal(r.format.kind,'retail_payment_receipt');assert.equal(get(r,'displayed_receipt_total').value,'60.000');assert.equal(get(r,'displayed_receipt_total').currency,undefined);
});

test('出库表值框与表头轻微重叠时按列提取明细，不受文字顺序影响',()=>{
 const r=run([['出库单',400,10],['出库编号：ABC12345',900,10,700],['编号',50,100,100],['名称',350,100,100],['规格',650,100,100],['数量',950,100,100],['音箱',350,119,100],['311000',50,125,100],['128g',650,122,100],['50',950,121,100],['合计:50台',900,400,400]]);
 const rows=JSON.parse(get(r,'dispatch_items').value);assert.equal(rows[0].item_code,'311000');assert.equal(rows[0].quantity,'50');assert.equal(rows[0].item_description,'音箱');
});

test('出库客户中的姓名和脱敏电话分开保留，不修复星号',()=>{
 const r=run([['出库单',500,20],['客户',50,100,150],['韩*星 139****0321',300,100,600]]);
 assert.equal(get(r,'name','recipient').value,'韩*星');assert.equal(get(r,'phone_number','recipient').value,'139****0321');assert.equal(get(r,'phone_number','recipient').displayOnly,true);
});

test('账单应缴额与付款分开，户号姓名无分隔和分块都能绑定',()=>{
 const a=run([['账单详情',500,20],['缴费户名',40,100,200],['甲公司',500,100,300],['缴费户号',40,160,200],['12345678901',500,160,300],['应缴金额',40,220,200],['¥0.00',500,220,300],['输入金额',40,280,200],['￥100',500,280,300]]);
 assert.equal(get(a,'household_number').value,'12345678901');assert.equal(get(a,'amount_due').value,'0.00');assert(!get(a,'payment_amount'));
 const b=run([['缴费详情',500,20],['户号信息',40,100,200],['12345678901王*甲',500,100,500]]);assert.equal(get(b,'household_number').value,'12345678901');assert.equal(get(b,'name','subject').value,'王*甲');
 const c=run([['缴费详情',500,20],['户号信息',40,100,200],['12345678901',500,100,300],['王*乙',900,100,200]]);assert.equal(get(c,'household_number').value,'12345678901');assert.equal(get(c,'name','subject').value,'王*乙');
});

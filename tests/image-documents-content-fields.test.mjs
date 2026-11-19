import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichContentFields,CONTENT_FIELDS_VERSION} from '../src/modules/image/documents/server/content-fields.js';
import {validateBatch} from '../src/modules/image/documents/server/batch-engine.js';

const hash='a'.repeat(64),digest='b'.repeat(64);
function fixture(lines,type='certificate',existing=[]) {
 const regions=lines.map(([text,x,y,w=200,confidence=.99],i)=>({region_id:`r${i}`,observed_text:text,recognition_confidence:confidence,polygon:[[x,y],[x+w,y],[x+w,y+20],[x,y+20]]}));
 const sample={regions,oriented_size:[1800,2500],input_sha256:hash,status:'succeeded'};
 const material={id:'material',type,version:1,fileSha256:hash,pages:[{number:1,status:'succeeded',width:1800,height:2500}],fields:existing};
 return{sample,material,result:enrichContentFields(sample,{material,digest})};
}
const field=(r,key,role)=>r.fields.find(f=>f.key===key&&(!role||f.role===role));

test('commitment extracts split identity and bounded account list with original evidence, never repairs identity',()=>{
 const {result,material}=fixture([
  ['承诺函',500,20],['本人（姓名：张*三',80,80],['身份证号码：',400,80,180,.82],['12345619900101123',650,80,300],
  ['注册的账户',80,150],['a@test.cn, b@test.cn',400,150,500],['c@test.cn（邮箱或手机号码，以下简称为“该账户”）为本人所有。',80,210,1000],
  ['联系咨询outside@other.cn',80,400,700],
 ]);
 assert.equal(result.format.kind,'account_commitment');
 const identity=field(result,'identity_number');
 assert.equal(identity.value,'12345619900101123');
 assert.equal(identity.confidence,.82);
 assert(result.review.some(r=>r.reason==='identity_shape_requires_review'));
 assert.deepEqual(JSON.parse(field(result,'account_list').value),['a@test.cn','b@test.cn','c@test.cn']);
 assert.equal(field(result,'account_list').privacyClass,'direct_identifier');
 assert.equal(field(result,'account_list').source.ocrFingerprint,digest);
 assert.equal(field(result,'account_list').source.extractionVersion,CONTENT_FIELDS_VERSION);
 assert.equal(field(result,'account_list').source.regions.length,3);
 assert(!field(result,'account_list').value.includes('outside'));
 assert.equal(field(result,'name').value,'张*三');
 validateBatch({id:'probe',version:1,materials:[{...material,fields:result.fields}]});
});

test('existing semantic field is retained and extraction does not mutate material',()=>{
 const existing=[{key:'identity_number',role:'subject',value:'existing'}];
 const {result,material}=fixture([['承诺函',500,10],['身份证号码：123456199001011234',30,80,600]],'certificate',existing);
 assert(!field(result,'identity_number'));
 assert.deepEqual(material.fields,existing);
});

test('multiple labelled values remain explicitly ambiguous and low confidence is preserved',()=>{
 const {result}=fixture([['税收完税证明',500,20],['纳税人名称：甲公司',50,100,400,.55],['纳税人名称：乙公司',50,200,400,.99]]);
 const names=result.fields.filter(f=>f.key==='name');
 assert.equal(names.length,2);
 assert(names.every(f=>f.extractionAmbiguous));
 assert.equal(names[0].confidence,.55);
 assert(result.review.some(r=>r.reason==='recognition_requires_review'));
});

test('unrelated email text and generic document do not become an account commitment',()=>{
 const {result}=fixture([['公司业务介绍',100,20],['邮箱：service@test.cn',100,80],['金额：500',100,140]]);
 assert.equal(result.format.kind,'unknown');assert.equal(result.fields.length,0);
 assert.equal(result.coverage.lineItemsComplete,false);
 const mention=fixture([['材料提交要求',100,20],['请提供承诺函、房屋租赁合同。',100,80,900],['押一付一',100,140]]).result;
 assert.equal(mention.format.id,'unknown');assert.equal(mention.fields.length,0);
});

test('rental parses explicit rent, deposit/payment and composition with adjustment evidence',()=>{
 const {result}=fixture([
  ['房屋租赁合同',600,10],['甲方(房主)：赵某',60,80,300],['证件编号：',700,80,200],['123456197001011234',950,80,400],
  ['乙方(承租人)：',60,150,300],['钱某',400,150,120],['证件编号：',700,150,200],['123456199001011234',950,150,400],
  ['二、本房屋月租金为（人民币大写）：壹仟元',50,300,1200],['（小写：￥1000），租金每月结算。',50,350,1000],
  ['三、押二付一，第一次于2026年1月1日前支付2800元，',50,400,1400],['其中包括两个月房租押金及一个月房租。',50,450,1200],['本次优惠200元。',50,500,1000],
 ],'contract');
 assert.equal(field(result,'name','lessor').value,'赵某');assert.equal(field(result,'name','lessee').value,'钱某');
 assert.equal(field(result,'identity_number','lessor').value,'123456197001011234');
 assert.equal(field(result,'identity_number','lessee').value,'123456199001011234');
 assert(!field(result,'identity_number','lessee').extractionAmbiguous);
 assert.equal(field(result,'monthly_rent').value,'1000');assert.equal(field(result,'deposit_months').value,'2');assert.equal(field(result,'prepaid_months').value,'1');
 assert.equal(field(result,'initial_payment').value,'2800');
 assert.equal(field(result,'initial_payment_composition').value,'其中包括两个月房租押金及一个月房租。');
 assert.equal(field(result,'payment_adjustment').value,'本次优惠200元。');
});

test('title may be split across same row; legacy VAT extracts buyer and explicit totals/row scopes',()=>{
 const {result}=fixture([
  ['某地增值税电子',500,20,300],['普通发票',820,20,200],
  ['购买方',30,120,70],['名',140,100,30],['称：赵*甲',260,100,250],
  ['货物或应税劳务、服务名称',100,300,350],['规格型号',520,300,150],['数量',780,300,80],['单价',970,300,80],['金额',1200,300,80],['税率',1380,300,80],['税额',1530,300,80],
  ['*服务*咨询',100,360,300],['2',870,360,20],['100.00',1020,360,100],['200.00',1260,360,100],['0%',1390,360,50],['10.00',1590,360,100],
  ['合计',160,600,100],['￥200.00',1220,610,130],['￥10.00',1570,610,130],
  ['价税合计(大写)',160,680,300],['贰佰壹拾元整',500,680,400],['(小写)￥210.00',1280,680,300],
 ],'invoice');
 assert.equal(result.format.invoiceSubtype,'vat_electronic_ordinary');
 assert.equal(field(result,'name','buyer').value,'赵*甲');
 assert.equal(field(result,'net_amount').value,'200.00');assert.equal(field(result,'tax_amount').value,'10.00');assert.equal(field(result,'gross_amount').value,'210.00');
 assert.equal(field(result,'quantity').value,'2');assert.equal(field(result,'unit_price').value,'100.00');
 const scope=field(result,'tax_rate').taxScope;
 assert(scope);assert(result.fields.filter(f=>['quantity','unit_price','line_net_amount','line_tax_amount','item_description'].includes(f.key)).every(f=>f.taxScope===scope));
 assert.equal(result.coverage.detectedLineCount,1);assert.equal(result.coverage.extractedLineCount,1);assert.equal(result.coverage.lineItemsComplete,true);
});

test('legacy invoice with missing amount row is incomplete instead of inventing totals',()=>{
 const {result}=fixture([
  ['增值税电子普通发票',500,20,500],['货物或应税劳务、服务名称',100,300,350],['金额',1200,300,80],['税率',1380,300,80],['税额',1530,300,80],
  ['13%',1390,360,50],['20.00',1590,360,100],['(小写)￥120.00',1280,680,300],
 ],'invoice');
 assert.equal(field(result,'net_amount'),undefined);assert.equal(field(result,'line_net_amount'),undefined);
 assert.equal(result.coverage.lineItemsComplete,false);assert.equal(result.coverage.extractedLineCount,0);
});

function taxFixture({missingPeriod=false,missingType=false}={}) {
 return fixture([
  ['税收完税证明',500,20],['税种',100,100,100],['税款所属时期',400,100,180],['入(退)库日期',850,100,180],['实缴(退)税额',1300,100,180],
  ['增值税',100,160,150],['2024-01-01 至',380,160,180],['2024-03-31',590,160,170],['2024-04-15',850,160,180],['200.00',1320,160,150],
  ...(!missingType?[['企业所得税',100,220,180]]:[]),
  ...(!missingPeriod?[['2024-01-01 至 2024-03-31',380,220,380]]:[]),
  ['2024-04-16',850,220,180],['300.00',1320,220,150],['以上情况，特此证明',600,280,500],
 ]).result;
}

test('tax-table columns retain row/tax-type association and explicit multi-block periods',()=>{
 const result=taxFixture();
 for(const key of ['tax_type','tax_period','treasury_date','paid_tax_amount']) {
  const f=field(result,key);assert(f,key);assert.equal(f.valueType,'table_column');assert.equal(f.tableRows,2);assert.equal(f.columnComplete,true);
  assert.deepEqual(JSON.parse(f.value).map(r=>[r.row,r.taxType]),[[1,'增值税'],[2,'企业所得税']]);
 }
 assert.equal(JSON.parse(field(result,'paid_tax_amount').value)[1].value,'300.00');
 assert.equal(JSON.parse(field(result,'tax_period').value)[0].value,'2024-01-01至2024-03-31');
 assert.equal(field(result,'treasury_date').dateCollection,true);
});

test('missing period suppresses whole period column while preserving independently complete columns',()=>{
 const result=taxFixture({missingPeriod:true});
 assert.equal(field(result,'tax_period'),undefined);
 assert(field(result,'tax_type'));assert(field(result,'treasury_date'));assert(field(result,'paid_tax_amount'));
 assert(result.review.some(r=>r.key==='tax_period'&&r.reason==='tax_table_column_cells_missing_or_ambiguous'));
});

test('unanchored tax row makes all table columns incomplete',()=>{
 const result=taxFixture({missingType:true});
 assert.equal(result.fields.filter(f=>f.valueType==='table_column').length,0);
});

test('account bound stops at declaration clause and excludes later footer addresses',()=>{
 const {result}=fixture([
  ['承诺函',500,20],['注册的账户',50,100],['one@example.cn',400,100],
  ['two@example.cn（邮箱或手机号码，以下简称为“该账户”）为本人所有。',50,150,1000],
  ['联系邮箱：three@example.cn',50,200,1000],
 ]);
 assert.deepEqual(JSON.parse(field(result,'account_list').value),['one@example.cn','two@example.cn']);
 const mentioned=fixture([['合同说明书',500,20],['请提供增值税电子普通发票作为附件。',50,100,1200]],'invoice').result;
 assert.equal(mentioned.format.id,'unknown');
});

test('承诺函姓名不吞身份证标签，同一OCR行合并标签仍提取身份号码',()=>{
 const {result}=fixture([['承诺函',500,20],['本人(姓名：赵*甲身份证号码',80,80,450],['12345619900101123',600,80,350],['注册的账户',80,160],['a@test.cn（邮箱，以下简称该账户）为本人所有',300,160,900]]);
 assert.equal(field(result,'name').value,'赵*甲');assert.equal(field(result,'identity_number').value,'12345619900101123');
});
test('承诺函姓名分块且基线稍高时按几何绑定，不以阅读顺序吞入后续标签',()=>{
 const {result}=fixture([['承诺函',500,20],['赵*甲',300,77,80],['本人(姓名',80,80,200],['身份证号码',500,80,180],['12345619900101123',720,80,350]]);
 assert.equal(field(result,'name').value,'赵*甲');assert.equal(field(result,'identity_number').value,'12345619900101123');
});

test('承诺函姓名候选不含标题和邻接正文',()=>{
 const {result}=fixture([['承诺函',400,70],['本人(姓名',80,80,200],['李*婷',300,80,80],['承诺以本',700,90,150]]);
 assert.deepEqual(result.fields.filter(f=>f.key==='name').map(f=>f.value),['李*婷']);
});

test('承诺截止日期允许日期与前字被OCR拆成三块',()=>{
 const {result}=fixture([['承诺函',500,20],['本人承诺在',80,80],['2024年10月11日',350,80,300],['前，该账户进行的所有收款',700,80,500]]);
 assert.equal(field(result,'commitment_end_date').value,'2024年10月11日');
});

test('完税标题拆散时由明确税表头识别，No编号与地方旧编号都保留',()=>{
 const a=fixture([['税收',500,20],['证明',800,20],['No.0400078900123',1000,80,500],['税务机关：国家税务总局甲市税务局',40,160,1100],['纳税人识别号：91350100MA2TRM6123',40,220,1100],['纳税人名称：甲公司',40,280,900],['税款所属时期',600,380,300]]).result;
 assert.equal(a.format.kind,'tax_payment_certificate');assert.equal(field(a,'certificate_number').value,'0400078900123');
 const b=fixture([['税收完税证明',400,20,900],['(191)浙国现0400789',40,100,900]]).result;assert.equal(field(b,'certificate_number').value,'(191)浙国现0400789');
});
test('承诺函支付宝账户条款跨块，号码后粘正文仍保留原始19位数字',()=>{
 const {result}=fixture([['承诺函',500,20],['身份证号码',40,100,220],['9951101985121223456诺以本',400,100,900],['注册的支付宝账户：',40,200,500],['a@test.cn，b@test.cn',600,200,700],['(邮箱，以下简称该账户)为本人所有',40,260,1200]]);
 assert.equal(field(result,'identity_number').value,'9951101985121223456');assert.deepEqual(JSON.parse(field(result,'account_list').value),['a@test.cn','b@test.cn']);
});

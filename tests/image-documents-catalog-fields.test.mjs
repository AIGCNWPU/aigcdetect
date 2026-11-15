import test from 'node:test';
import assert from 'node:assert/strict';
import {enrichCatalogFields} from '../src/modules/image/documents/server/catalog-content-fields.js';
const run=lines=>{const regions=lines.map(([text,x=40,y=0,w=220,confidence=.99],i)=>({region_id:`r${i}`,observed_text:text,recognition_confidence:confidence,polygon:[[x,y],[x+w,y],[x+w,y+24],[x,y+24]]}));return enrichCatalogFields({regions,oriented_size:[1800,2500]},{material:{type:'unknown',fileSha256:'a'.repeat(64),fields:[]},digest:'b'.repeat(64)});};
const get=(r,key,role)=>r.fields.find(f=>f.key===key&&(!role||f.role===role));
test('无欠税证明保留编号、主体与截止日期，不宣称查询税务系统',()=>{
 const r=run([['无欠税证明',500,20],['甲市税无欠税证（2024）1234567号',40,100,1000],['纳税人名称：甲有限公司',40,200,900],['独资，纳税人识别号：91350100MA2TRM6123',40,260,1100],['有效证件类型：居民身份证，有效证件号码：',40,320,1000],['123456199001011234',40,380,500],['截至2024年10月09日，在系统未发现',40,440,1200]]);
 assert.equal(r.format.kind,'no_arrears_certificate');assert.equal(get(r,'certificate_number').value,'无欠税证(2024)1234567号');assert.equal(get(r,'name','taxpayer').value,'甲有限公司');assert.equal(get(r,'tax_status_date').value,'2024年10月09日');assert.equal(get(r,'identity_number','holder').value,'123456199001011234');assert.equal(get(r,'tax_identifier','taxpayer').value,'91350100MA2TRM6123');
});
test('小程序依明确表头和对应行提取，不把搜索框或状态当名称',()=>{
 const r=run([['小程序APPID/名称',1100,30,500],['小程序名称',500,140,300],['小程序ID',1050,140,250],['小程序状态',1450,140,250],['某微助手',500,300,300],['wxabcdef123456',1050,300,250],['已上架',1450,300,200],['取消',1300,800,200]]);
 assert.equal(r.format.kind,'miniapp_information');assert.equal(get(r,'application_id').value,'wxabcdef123456');assert.equal(get(r,'application_name').value,'某微助手');
 const wrong=run([['小程序APPID/名称',100,20,700],['wxabcdef123456',100,100,400]]);assert.equal(wrong.fields.length,0);
});
test('淘宝证明按账户主体提取，不因正文提及证明名称而误适配',()=>{
 const r=run([['淘宝网店铺经营证明',400,20,700],['账户名称：甲经营部',40,200,800],['店铺地址：https://shop123456789.taobao.com',40,260,1200]]);
 assert.equal(get(r,'name','account_holder').value,'甲经营部');assert.equal(get(r,'shop_url').value,'https://shop123456789.taobao.com');
 assert.equal(run([['请提供淘宝网店铺经营证明',40,20,1200]]).fields.length,0);
});
test('收入明细将扣缴义务人和收入/税额分开，不假定零税率不合法',()=>{
 const r=run([['收入纳税明细详情',400,20,700],['扣缴义务人名称：甲公司',40,120,1000],['扣缴义务人纳税人识别号：91350100MA2TRM6123',40,180,1400],['收入：3000.00元',40,240,600],['已申报税额：0.00元',40,300,600],['申报日期：2024-03-13',40,360,700]]);
 assert.equal(r.format.kind,'income_tax_detail');assert.equal(get(r,'name','withholding_agent').value,'甲公司');assert.equal(get(r,'income_amount').value,'3000.00');assert.equal(get(r,'declared_tax_amount').value,'0.00');
});
test('商用办公室出租人、承租公司、签字代表严格分角色',()=>{
 const r=run([['商用办公室租赁合同',400,20,700],['(甲方)出租方：周*',40,120,350],['身份证号：123456199001011234',500,120,900],['(乙方)承租方：甲有限公司',40,180,900],['统一信用代码：91350100MA2TRM6123',40,240,1000],['签字代表：李*',40,300,350],['身份证号：123456200001011235',500,300,900],['月租金4500元',40,500,500],['合同有效期限：2023年11月19日至2024年11月18日',40,700,1500]]);
 assert.equal(get(r,'identity_number','lessor').value,'123456199001011234');assert.equal(get(r,'identity_number','lessee_representative').value,'123456200001011235');assert.equal(get(r,'name','lessee').value,'甲有限公司');assert.equal(get(r,'contract_end_date').value,'2024年11月18日');
});
test('销售合同委托代理人按签章列归属，不串甲乙双方',()=>{
 const r=run([['销售合同',600,20,500],['合同编号：CONTRACT123',40,80,900],['甲方',300,600,150],['乙方',1250,600,150],['委托代理人：',40,700,250],['周*甲',350,700,200],['委托代理人：',950,700,250],['陈*乙',1300,700,200]]);
 assert.equal(get(r,'authorized_agent','party_a').value,'周*甲');assert.equal(get(r,'authorized_agent','party_b').value,'陈*乙');assert.equal(get(r,'contract_number').value,'CONTRACT123');
});

test('三位无欠税编号不被漏掉，居民身份类型未知时不误套身份校验',()=>{
 const r=run([['无欠税证明',500,20],['甲市税无欠税证（2024）123号',40,100,1100],['有效证件类型：营业执照，有效证件号码：123456199001011234',40,200,1700]]);
 assert.equal(get(r,'certificate_number').value,'无欠税证(2024)123号');assert(!get(r,'identity_number'));assert.equal(get(r,'displayed_document_number').value,'123456199001011234');
});
test('收入总览与本期收入分别提取，避免把不同标签伪装多候选歧义',()=>{
 const r=run([['收入纳税明细详情',400,20,700],['扣缴义务人名',40,120,300],['甲公司',700,120,400],['称：',40,150,200],['扣缴义务人纳税',40,220,400],['91350100MA2TRM6123',700,220,600],['人识别号：',40,250,300],['收入：3000.00元',40,400,700],['本期收入：2700.00元',40,460,700]]);
 assert.equal(get(r,'name','withholding_agent').value,'甲公司');assert.equal(get(r,'tax_identifier','withholding_agent').value,'91350100MA2TRM6123');assert.equal(get(r,'income_amount').value,'3000.00');assert.equal(get(r,'current_income_amount').value,'2700.00');assert(!get(r,'income_amount').extractionAmbiguous);
});
test('销售合同甲乙方限定标签边界，不将付款条款提取成乙方名称',()=>{
 const r=run([['销售合同',500,20],['甲方(需方):',40,100,300],['王*甲',400,100,200],['乙方(供方)：',40,160,300],['李*乙',400,160,200],['乙方交货后，甲方需结清全部货款',40,400,1200]]);
 assert.equal(get(r,'name','party_a').value,'王*甲');assert.equal(get(r,'name','party_b').value,'李*乙');assert.equal(r.fields.filter(f=>f.key==='name').length,2);
});

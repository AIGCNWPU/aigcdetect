import test from 'node:test';
import assert from 'node:assert/strict';
import {identityNumber,chineseMoney,documentChecks} from '../src/modules/image/documents/server/document-rules.js';
import {decimal} from '../src/modules/image/documents/server/batch-engine.js';
const field=(key,value,extra={})=>({id:key,key,value,role:'subject',confidence:.99,...extra});
const checks=(fields,extra={})=>documentChecks({fields,type:'certificate',...extra},{decimal,evidence:(m,f)=>({fieldId:f.id,value:f.value})});
test('GB11643 published example and check-digit mutation',()=>{
 assert.equal(identityNumber('11010519491231002X').status,'PASS');
 assert.equal(identityNumber('110105194912310020').status,'FAIL');
 assert.equal(identityNumber('11010519491231002x').gender,'女');
 assert.equal(identityNumber('11010519491231O02X').status,'NEI');
 assert.equal(identityNumber('11010519000229002X').reason,'identity_impossible_birth_date');
});
test('identity fields compare only reliable same-role values',()=>{
 const fields=[field('identity_number','11010519491231002X'),field('birth_date','1949年12月31日',{dateFormat:'YYYY年MM月DD日'}),field('gender','女')];
 assert.equal(checks(fields).find(c=>c.rule==='identity_birth_date').status,'PASS');
 fields[2].value='男';assert.equal(checks(fields).find(c=>c.rule==='identity_gender').status,'FAIL');
 fields[0].confidence=.8;assert.equal(checks(fields).find(c=>c.rule==='identity_gender').status,'NEI');
 assert.equal(checks(fields).find(c=>c.rule==='identity_historical_region').status,'NEI');
});
test('financial uppercase known values remain exact including zero positions',()=>{
 for(const [text,expected] of [['零元整',0n],['叁拾万圆整',30000000n],['⊗壹拾万零肆仟壹佰玖拾贰圆整',10419200n],['壹仟零壹元零伍分',100105n],['壹亿零叁万零陆元柒角整',10003000670n],['贰元叁角',230n],['贰元叁角肆分',234n]]) assert.equal(chineseMoney(text),expected,text);
 for(const text of ['拾元整','壹佰佰元整','壹贰元整','壹元玖分整','一百元','壹万万元整','壹元整其他','负壹元整']) assert.equal(chineseMoney(text),null,text);
});
test('amount mismatch is a displayed content conflict, unknown grammar stays NEI',()=>{
 const fs=[field('gross_amount_words','叁拾万元整'),field('gross_amount','300000.00',{currency:'CNY'})];
 assert.equal(checks(fs)[0].status,'PASS');fs[1].value='300001.00';assert.equal(checks(fs)[0].status,'FAIL');
 fs[0].value='三十万';assert.equal(checks(fs)[0].status,'NEI');
});
test('digital invoice length and year with policy date scope',()=>{
 const fs=[field('invoice_number','25412000001453227500'),field('invoice_date','2025年06月25日',{dateFormat:'YYYY年MM月DD日'})];
 assert.deepEqual(checks(fs,{type:'digital_invoice'}).map(c=>c.status),['PASS','PASS']);
 fs[1].value='2026年06月25日';assert.equal(checks(fs,{type:'digital_invoice'})[1].status,'FAIL');
 fs[1].value='2024年05月24日';assert.equal(checks(fs,{type:'digital_invoice'})[1].status,'NEI');
 fs[0].value='2541200000145322750';assert.equal(checks(fs,{type:'digital_invoice'})[0].status,'FAIL');
 fs[0].value='25412000001453227***';assert.equal(checks(fs,{type:'digital_invoice'})[0].status,'NEI');
});
test('legacy invoice subtype is explicit, no universal invoice checksum',()=>{
 const fs=[field('invoice_number','12345678'),field('invoice_code','012345678911')];
 assert.equal(checks(fs,{type:'invoice'})[0].status,'NEI');
 assert.deepEqual(checks(fs,{type:'invoice',invoiceSubtype:'vat_electronic_ordinary'}).map(c=>c.status),['PASS','PASS']);
});

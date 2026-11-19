import test from 'node:test';
import assert from 'node:assert/strict';
import {extractOcrMaterial} from '../src/modules/image/documents/server/ocr-fields.js';
import {evaluateBatch} from '../src/modules/image/documents/server/batch-engine.js';
const sha='a'.repeat(64);
function r(id,text,x,y,w=70){return {region_id:id,observed_text:text,recognition_confidence:.99,polygon:[[x,y],[x+w,y],[x+w,y+20],[x,y+20]],coordinate_space:'exif_oriented_image_pixels',source:{page:1,input_sha256:sha}};}
function sample(){return {status:'succeeded',input_sha256:sha,oriented_size:[1000,800],regions:[r('title','电子发票（普通发票）',300,10,300),r('number','发票号码：25412000000145322750',700,40,280),r('date','开票日期：2025年06月25日',700,70,280),r('net','金额',650,200),r('tax','税额',880,200),r('subtotal','小计',50,500),r('snet','¥10.00',650,500),r('stax','¥1.00',880,500),r('total','合计',50,550),r('tnet','¥100.00',650,550),r('ttax','¥13.00',880,550),r('upper','价税合计（大写）',50,600,200),r('words','壹佰壹拾叁圆整',280,600,300),r('lower','（小写）',650,600,80),r('gross','¥113.00',800,600,100)]};}
const extract=s=>extractOcrMaterial(s,{id:'m',type:'digital_invoice'});
test('VAT summary uses total row and both column headers, not subtotals',()=>{
 const m=extract(sample()).material;
 assert.equal(m.fields.find(f=>f.key==='net_amount').value,'100.00');
 assert.equal(m.fields.find(f=>f.key==='tax_amount').value,'13.00');
 const checks=evaluateBatch({id:'b',version:1,materials:[m]}).checks;
 assert.equal(checks.find(c=>c.rule==='invoice_net_tax_gross').status,'PASS');
 assert.equal(checks.find(c=>c.rule==='amount_words_numeric').status,'PASS');
 const f=m.fields.find(f=>f.key==='net_amount');assert(f.source.regions.some(r=>r.regionId==='total'));assert(!f.source.regions.some(r=>r.regionId==='subtotal'));
});
test('missing total label or duplicate cell does not trigger invented amounts',()=>{
 for(const mutate of [s=>s.regions=s.regions.filter(r=>r.region_id!=='total'),s=>s.regions.push(r('extra','¥200.00',680,550))]) {const s=sample();mutate(s);assert(!extract(s).material.fields.some(f=>f.key==='net_amount'));}
});
test('low-confidence title propagates into all layout fields',()=>{const s=sample();s.regions[0].recognition_confidence=.5;const m=extract(s).material;assert.equal(evaluateBatch({id:'b',version:1,materials:[m]}).checks.find(c=>c.rule==='invoice_net_tax_gross').status,'NEI');});
test('unknown title cannot enable currency or table inference',()=>{const s=sample();s.regions[0].observed_text='普通收据';assert(!extract(s).material.fields.some(f=>f.key==='gross_amount'));});
test('party markers scope repeated name labels and retain roles',()=>{
 const s=sample();
 const buyer=r('buyer','购买方信息',10,100,20),seller=r('seller','销售方信息',500,100,20);
 buyer.polygon[2][1]=buyer.polygon[3][1]=180;seller.polygon[2][1]=seller.polygon[3][1]=180;
 s.regions.push(buyer,seller,r('buyer-name','名称：甲公司',40,110,200),r('seller-name','名称：乙公司',540,110,200));
 const fields=extract(s).material.fields.filter(f=>f.key==='name');assert.deepEqual(fields.map(f=>[f.role,f.value]),[['buyer','甲公司'],['seller','乙公司']]);
 s.regions=s.regions.filter(r=>r.region_id!=='seller');assert.equal(extract(s).material.fields.filter(f=>f.key==='name').length,0);
});
test('spaced horizontal total label preserves both original OCR regions',()=>{
 const s=sample();s.regions=s.regions.filter(r=>r.region_id!=='total');s.regions.push(r('he','合',50,550,20),r('ji','计',150,550,20));
 const f=extract(s).material.fields.find(f=>f.key==='net_amount');assert.equal(f.value,'100.00');assert(f.source.regions.some(r=>r.regionId==='he'));assert(f.source.regions.some(r=>r.regionId==='ji'));assert(!f.source.regions.some(r=>r.regionId==='joined-total'));
});

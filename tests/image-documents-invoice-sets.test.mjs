import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateBatch} from '../src/modules/image/documents/server/batch-engine.js';
function material(id,value,type='digital_invoice') {const sha=id.charCodeAt(0).toString(16).repeat(32);return {id,type,version:1,fileSha256:sha,pages:[{number:1,status:'succeeded',width:100,height:100}],fields:[{id:'f',version:1,key:'gross_amount',role:'transaction',value,confidence:.99,currency:'CNY',invoiceIssuer:'issuer',invoiceReference:id,source:{fileSha256:sha,page:1,provider:'fixture',observedText:value,polygon:[[1,1],[50,1],[50,20],[1,20]]}}]};}
const ref=id=>({materialId:id,fieldId:'f'});
function fixture() {return {batch:{id:'b',version:1,materials:[material('t','100','certificate'),material('a','120'),material('r','-20')]},context:{batchId:'b',batchVersion:1,invoiceSets:[{id:'set',target:ref('t'),invoices:[ref('a'),ref('r')],complete:true,scopeConfirmed:true,reviewer:'fixture',reason:'complete confirmed scope',redReferences:[{red:ref('r'),original:ref('a'),reason:'explicit original invoice reference'}]}]}};}
const result=f=>evaluateBatch(f.batch,f.context).checks.find(c=>c.rule==='invoice_set_net_sum');
test('complete blue/red set uses signed decimals and preserves references',()=>{const f=fixture();assert.equal(result(f).status,'PASS');assert.equal(result(f).evidence.length,3);f.batch.materials[0].fields[0].value='101';assert.equal(result(f).status,'FAIL');});
test('incomplete set, unconfirmed red reference and currency remain NEI',()=>{
 for(const mutate of [f=>f.context.invoiceSets[0].complete=false,f=>f.context.invoiceSets[0].complete='true',f=>f.context.invoiceSets[0].redReferences=[],f=>f.batch.materials[1].fields[0].currency='USD',f=>f.batch.materials[1].fields[0].invoiceReference='',f=>f.batch.materials[1].fields[0].confidence=.5]) {const f=fixture();mutate(f);assert.equal(result(f).status,'NEI');}
});
test('duplicate views count once, conflicting duplicate amounts require review',()=>{const f=fixture();const copy=structuredClone(f.batch.materials[1]);copy.id='c';copy.fields[0].value='120.00';f.batch.materials.push(copy);f.context.invoiceSets[0].invoices.push(ref('c'));assert.equal(result(f).status,'PASS');assert.equal(result(f).deduplicatedInvoices,1);copy.fields[0].value='119';assert.equal(result(f).status,'NEI');});
test('invoice set context is bound to current batch version',()=>{const f=fixture();f.context.batchVersion=2;assert.throws(()=>result(f),/stale/);});

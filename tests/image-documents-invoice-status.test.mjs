import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceStatusChecks,INVOICE_STATUS_RULE} from '../src/modules/image/documents/server/invoice-status-rules.js';
import {evaluateBatch} from '../src/modules/image/documents/server/batch-engine.js';
import {evaluateReview} from '../src/modules/image/documents/server/review-plan.js';
import {assessExecution} from '../src/modules/image/documents/server/execution-assessment.js';
import {presentReview} from '../src/modules/image/documents/server/review-presentation.js';
import {buildSemanticPackage} from '../src/modules/image/documents/server/semantic-review.js';
import {renderDocumentPresentation,renderDocumentChecks} from '../src/modules/image/pages/documents.js';

const hash='a'.repeat(64),polygon=[[10,10],[500,10],[500,50],[10,50]];
function material(texts=['测试样张·无效·禁止报销']) {
  return {id:'invoice',name:'local-private-name.png',type:'invoice',version:1,fileSha256:hash,fields:[],pages:[{number:1,status:'succeeded',width:1000,height:800}],
    textBlocks:texts.map((text,i)=>({id:`block-${i}`,text,confidence:.99,page:1,source:{provider:'ocr',fileSha256:hash,renderedSha256:'b'.repeat(64),page:1,polygon:structuredClone(polygon)}}))};
}
function reviewFixture(m=material()) {
  const batch={id:'batch',version:1,materials:[m]};
  const review=evaluateReview(batch,{coreMaterialId:m.id,objective:'invoice_review',jurisdiction:'CN'});
  const materials=[{...m,status:'completed',stages:{}}];
  review.executionAssessment=assessExecution({batch,review,materials});
  return {batch,review,materials};
}

for(const phrase of ['测试样张·无效·禁止报销','测试样张/无效/禁止报销','测 试 样 张 • 无 效 • 禁 止 报 销','样票','【作废】','备注：本发票无效','本票已作废','发票状态：已作废','本发票状态：无效','普通发票测试联','本票仅供测试','仅供展示','禁止报销','本发票不得用于报销','本票不能作为报销凭证']) {
  test(`invoice declaration is a sourced local warning: ${phrase}`,()=>{
    const m=material([phrase]),[check]=invoiceStatusChecks(m);
    assert.equal(check?.status,'WARN');assert.equal(check.rule,INVOICE_STATUS_RULE);assert.match(check.ruleVersion,/invoice-status\//);
    assert.equal(check.evidence[0].value,phrase);assert.equal(check.evidence[0].source.observedText,phrase);
    assert.deepEqual(check.evidence[0].source.polygon,polygon);assert.equal(check.evidence[0].source.page,1);assert.equal(check.evidence[0].materialVersion,1);
    assert.equal(check.evidence[0].blockId,'block-0');assert.equal(check.evidence[0].fieldId,undefined);
  });
}

for(const phrase of ['未作废','发票状态：未作废','本发票并非无效','本票尚未作废','涂改无效','复印件无效','若本票无效则重开','如本发票作废请联系开票方','超过有效期无效','未盖章无效','该票作废申请已撤销','作废申请','测试服务费','商品名称：测试样张','购买方：无效测试有限公司','请勿将本发票标记为无效','本票没有禁止报销的声明','未发现无效字样','无效处理服务费','本票无效吗？']) {
  test(`negation, condition or mention is not a status declaration: ${phrase}`,()=>assert.deepEqual(invoiceStatusChecks(material([phrase])),[]));
}

test('no match never asserts the invoice is authentic; unrelated document types stay out of scope',()=>{
  assert.deepEqual(invoiceStatusChecks(material(['电子发票（普通发票）','合计1130.00'])),[]);
  for(const type of ['contract','identity','certificate'])assert.deepEqual(invoiceStatusChecks({...material(),type}),[]);
  assert.deepEqual(invoiceStatusChecks({...material(),type:'unknown'}),[]);
  const m=material(['电子发票（普通发票）','测试样张·无效·禁止报销']);m.type='unknown';assert.equal(invoiceStatusChecks(m)[0].status,'WARN');
});

test('conditional and descriptive context survives comma splitting without suppressing a separate declaration',()=>{
  for(const text of ['若有涂改，本票无效','备注：如果缺少签章，本发票无效','复印后，无效','商品名称：纸张，样张','未发现：无效、作废标记','本发票无效？'])assert.deepEqual(invoiceStatusChecks(material([text])),[]);
  assert.equal(invoiceStatusChecks(material(['若有涂改，本票无效。禁止报销']))[0].declarations[0],'restricted');
});

test('multiple locations are grouped while preserving both evidence boxes and all marker types',()=>{
  const m=material(['测试样张·无效·禁止报销','测试样张·无效·禁止报销']);
  const checks=invoiceStatusChecks(m);assert.equal(checks.length,1);assert.equal(checks[0].evidence.length,2);
  assert.deepEqual(checks[0].declarations,['sample','invalid','restricted']);
});

test('confidence threshold and bound source are mandatory for a definitive warning',()=>{
  for(const mutate of [b=>b.confidence=.899,b=>delete b.confidence,b=>b.confidence=1.1,b=>b.source.fileSha256='f'.repeat(64),b=>delete b.source.polygon,b=>b.source.polygon=[[1,1],[1,1],[1,1],[1,1]],b=>b.source.polygon[0][0]=-1,b=>b.source.page=2,b=>b.page=2,b=>delete b.source]) {
    const m=material();mutate(m.textBlocks[0]);const check=invoiceStatusChecks(m)[0];assert.equal(check.status,'NEI');
    const f=reviewFixture(m);assert.equal(presentReview(f).warnings.length,0);
    assert.equal(f.review.executionAssessment.items.find(i=>i.rule===INVOICE_STATUS_RULE).route,'supplement');
  }
  const m=material();m.textBlocks[0].confidence=.9;assert.equal(invoiceStatusChecks(m)[0].status,'WARN');
});

test('uncertain candidate remains separate from a clear marker and cannot dilute it',()=>{
  const m=material(['本发票无效','禁止报销']);m.textBlocks[1].confidence=.6;
  const checks=invoiceStatusChecks(m);assert.deepEqual(checks.map(c=>c.status),['WARN','NEI']);
  const f=reviewFixture(m);assert.equal(presentReview(f).warnings.length,1);
});

test('text-only DOCX evidence keeps structural location without inventing image coordinates',()=>{
  const m=material();m.representation='docx_text';m.pages=[];
  const b=m.textBlocks[0];delete b.page;b.source={provider:'docx_xml',fileSha256:hash,location:{part:'word/document.xml',paragraph:1}};
  const [check]=invoiceStatusChecks(m);assert.equal(check.status,'WARN');assert.equal(check.evidence[0].source.polygon,undefined);
  assert.equal(check.evidence[0].source.location.paragraph,1);
  b.source.location={part:'word/document.xml',table:1,row:2,cell:1};assert.equal(invoiceStatusChecks(m)[0].status,'WARN');
  b.source.location.cell=0;assert.equal(invoiceStatusChecks(m)[0].status,'NEI');
});

test('both production local entry points detect markers without amount fields or visual alerts',()=>{
  const f=reviewFixture();assert.equal(evaluateBatch(f.batch).checks.find(c=>c.rule===INVOICE_STATUS_RULE).status,'WARN');
  const item=f.review.executionAssessment.items.find(i=>i.rule===INVOICE_STATUS_RULE);
  assert.equal(item.grade,'A');assert.equal(item.route,'local');assert.equal(presentReview(f).status,'issues_found');
});

test('disabled, failed or reasonable semantic review cannot override the local marker alert',()=>{
  const f=reviewFixture();
  for(const semanticReview of [{status:'not_run',reason:'disabled'},{status:'failed'},{status:'completed',items:[{assessmentId:f.review.executionAssessment.items.find(i=>i.rule===INVOICE_STATUS_RULE).id,verdict:'reasonable'}]}]) {
    const p=presentReview({...f,semanticReview});assert.equal(p.status,'issues_found');assert.match(p.warnings[0].message,/禁止报销/);
  }
});

test('redacted and original packages keep safe markers and local findings linked to text evidence',()=>{
  const f=reviewFixture();
  for(const privacyMode of ['redacted','original']) {
    const pkg=buildSemanticPackage({...f,objective:'invoice_review',privacyMode});
    const finding=pkg.localFindings.find(x=>x.rule===INVOICE_STATUS_RULE);assert.ok(finding);assert.equal(finding.status,'WARN');
    assert.ok(finding.evidenceIds.length);assert.ok(finding.evidenceIds.every(id=>pkg.evidence.some(e=>e.id===id&&e.kind==='text'&&e.text==='测试样张·无效·禁止报销')));
    assert.doesNotMatch(JSON.stringify(pkg),/local-private-name|fileSha256|block-0|polygon/);
  }
});

test('new safe vocabulary does not release mixed private text or revive low-quality markers',()=>{
  const f=reviewFixture(material(['测试样张·无效·禁止报销','测试样张·无效·禁止报销；联系人赵敏，地址隐私街道；电话13800138000','本票已作废']));
  f.materials[0].textBlocks[2].confidence=.6;
  const pkg=buildSemanticPackage({...f,privacyMode:'redacted'}),wire=JSON.stringify(pkg);
  assert.doesNotMatch(wire,/赵敏|隐私街道|13800138000|本票已作废/);
  assert.ok(pkg.evidence.some(e=>e.text==='测试样张·无效·禁止报销'));
  assert.ok(pkg.losses.some(l=>l.kind==='unredactable_text'));assert.ok(pkg.losses.some(l=>l.kind==='uncertain_text'));
  assert.equal(pkg.items[0].evidenceComplete,false);
});

test('actual UI components show the warning, Chinese field label, source text and page',()=>{
  const f=reviewFixture(),presentation=presentReview(f);
  const html=renderDocumentPresentation({...f,presentation},{invoice:'样图'},'invoice');
  assert.match(html,/票面状态声明/);assert.match(html,/测试样张·无效·禁止报销/);assert.match(html,/第 1 页/);
  assert.doesNotMatch(html,/invoice_status_declaration/);
  assert.match(renderDocumentChecks(f.review.checks.filter(c=>c.rule===INVOICE_STATUS_RULE)),/需要复核/);
});

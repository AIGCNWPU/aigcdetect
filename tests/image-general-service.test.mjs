import test from 'node:test';import assert from 'node:assert/strict';
import {validateGeneralRequest,createGeneralService} from '../src/modules/image/general/service.js';
import {renderFileEvidence} from '../src/modules/image/general/forensics-view.js';
import {renderGeneralDiagnostics} from '../src/modules/image/pages/general.js';
import {readableReviewText,renderDocumentPresentation} from '../src/modules/image/pages/documents.js';
test('image upload rejects malformed base64, ID traversal and unsupported media',()=>{
 const good={action:'detect',id:'image-1',file:{name:'x.png',mediaType:'image/png',contentBase64:'AAAA'}};
 assert.equal(validateGeneralRequest(good).length,3);
 for(const p of [{...good,id:'../x'},{...good,file:{...good.file,contentBase64:'!'}},{...good,file:{...good.file,mediaType:'application/pdf'}}])assert.throws(()=>validateGeneralRequest(p),e=>e.code==='INVALID_IMAGE');
});
test('status lookup never treats a missing task as a success',async()=>{await assert.rejects(()=>createGeneralService()({action:'status',jobId:'unknown'}),e=>e.status===404);});
test('diagnostic layer labels and no credential are independent of AI score',()=>{
 const html=renderGeneralDiagnostics({url:'data:image/png;base64,AAAA',result:{score:.99,sensitivity:{markedCount:0,crop:[0,0,336,336]},diagnostics:{dimensions:[600,600],credentials:{status:'absent'},statistics:{},layers:{}}}});
 assert.match(renderFileEvidence({credentials:{status:'absent'}}),/未发现内容凭证/);assert.match(html,/暂无区域标记/);assert.doesNotMatch(html,/不是真伪概率|检测范围|16个区域|5个百分点|id="ig-opacity"/);assert.doesNotMatch(html,/压缩差异<\/button>/);
});
test('internal references are replaced with readable names and evidence IDs stay out of prose',()=>{
 const text=readableReviewText('m1（e35/e36）与m2(e1、e2)金额不同，见q1',{m1:'a',m2:'b'},{a:'合同',b:'发票'});assert(!/\b[eqm]\d+\b/.test(text));assert.match(text,/合同与发票金额不同/);
});
test('within the same scope issues precede passed and insufficient results',()=>{
 const result=renderDocumentPresentation({materials:[{id:'a'}],presentation:{aiReview:{status:'completed',findings:[{materialIds:['a'],verdict:'needs_more_information',explanation:'待补证'},{materialIds:['a'],verdict:'reasonable',explanation:'已通过'},{materialIds:['a'],verdict:'issues_found',warning:'发现差额',explanation:'金额有差异'}]}}},{a:'发票'},'a','single');assert(result.indexOf('发现差额')<result.indexOf('已通过'));assert(result.indexOf('已通过')<result.indexOf('待补证'));assert.match(result,/<details class="doc-smart-pending">/);
});

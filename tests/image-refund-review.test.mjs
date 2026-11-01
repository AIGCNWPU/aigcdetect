import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefundDetection } from '../src/modules/image/refund/detection.js';
import { validateRefundComparison } from '../src/modules/image/refund/comparison.js';
import { buildRefundSummary, filterRefundSummary } from '../src/modules/image/refund/case-summary.js';

const reviewFields={caseNumber:'CASE-3',productName:'陶瓷杯',productInfo:'白色杯身',style:'白色300ml',description:'杯口破损'};
const reviewImages=['a','b'].map(id=>({id,file:new File([id],id+'.png'),url:'blob:'+id,width:800,height:600}));
const reviewResult=(id='a',extra={})=>({imageId:id,kind:'comparison',summary:'需要核对',coverage:'full',scope:'可见外观、款式与杯口',checks:[
  {dimension:'appearance',outcome:'match',observed:'白色杯身',evidence:'可见主体外观符合资料'},
  {dimension:'style',outcome:'mismatch',observed:'型号不同',evidence:'可见型号与资料不同'},
  {dimension:'issue',outcome:'unknown',observed:'杯口不清晰',evidence:'无法确认破损'},
],...extra});
const baseResult=(id,kind,extra={})=>({imageId:id,kind,risk:'low',summary:'测试说明',coverage:'full',scope:'整图',...(kind==='tamper'?{regions:[]}:{}),...extra});

test('核对必须关联正确图片并包含三种维度、有效结论、观察与依据',()=>{
  const valid=reviewResult();const parsed=validateRefundComparison(valid,'a',reviewFields);
  assert.equal(parsed.references.style,reviewFields.style);assert.equal(parsed.checks[1].outcome,'mismatch');
  for(const value of [{...valid,imageId:'b'},{...valid,kind:'ai'},{...valid,checks:valid.checks.slice(1)},{...valid,checks:[valid.checks[0],valid.checks[0],valid.checks[2]]},{...valid,checks:valid.checks.map(item=>({...item,outcome:'safe'}))},{...valid,checks:valid.checks.map(item=>({...item,evidence:''}))}]){
    assert.throws(()=>validateRefundComparison(value,'a',reviewFields),/核对结果/);
  }
  valid.checks[0].observed='随后被修改';assert.notEqual(parsed.checks[0].observed,'随后被修改');
});

test('缺少款式参照只能无法判断，服务不能重写案件参照资料',()=>{
  const value=reviewResult();assert.throws(()=>validateRefundComparison(value,'a',{...reviewFields,style:''}),/核对结果/);
  value.checks[1].outcome='unknown';value.references={style:'伪造资料'};
  const parsed=validateRefundComparison(value,'a',{...reviewFields,style:''});assert.equal(parsed.references.style,'');
});

test('核对独立失败重试不覆盖两类风险，未配置不生成核对结论',async()=>{
  const gateway=createRefundDetection();const session=gateway.createSession();session.sync(reviewImages,reviewFields);
  await assert.rejects(session.run(['comparison']),/未接入/);assert.equal(session.entries[0].comparison.status,'idle');
  let fail=true;let calls=0;
  gateway.configure({ai:async({image})=>baseResult(image.id,'ai'),tamper:async({image})=>baseResult(image.id,'tamper'),comparison:async({image})=>{calls++;if(image.id==='a'&&fail)throw Error('核对失败');return reviewResult(image.id);}});
  await session.run(['ai','tamper','comparison']);assert.equal(session.entries[0].comparison.status,'failed');assert.equal(session.entries[1].comparison.status,'succeeded');
  const previous=session.entries[0].ai.result;fail=false;await session.run(['comparison'],['a']);
  assert.equal(calls,3);assert.equal(session.entries[0].comparison.status,'succeeded');assert.equal(session.entries[0].ai.result,previous);
  session.sync(reviewImages,{...reviewFields,description:'更换描述'});assert.equal(session.entries[0].comparison.result,null);session.dispose();
});

test('核对取消释放锁并丢弃迟到结果，重新核对可用',async()=>{
  const gateway=createRefundDetection();let finish,signal;
  gateway.configure({comparison:(_,options)=>{signal=options.signal;return new Promise(resolve=>{finish=resolve;});}});
  const session=gateway.createSession();session.sync([reviewImages[0]],reviewFields);const pending=session.run(['comparison']);await new Promise(resolve=>setImmediate(resolve));
  session.cancel();await pending;assert.equal(signal.aborted,true);assert.equal(gateway.busy,false);
  gateway.configure({comparison:async()=>reviewResult('a',{summary:'新结果'})});await session.run(['comparison']);finish(reviewResult());await new Promise(resolve=>setImmediate(resolve));
  assert.equal(session.entries[0].comparison.result.summary,'新结果');session.dispose();
});

test('汇总不合并风险结论；失败/缺失/部分覆盖不能记作三项完整完成',async()=>{
  const gateway=createRefundDetection();gateway.configure({ai:async({image})=>baseResult(image.id,'ai'),tamper:async({image})=>baseResult(image.id,'tamper',{coverage:'partial',scope:'仅杯口',risk:'high',regions:[{id:'r1',type:'add',description:'异常边缘',box:{x:.1,y:.1,width:.2,height:.2}}]}),comparison:async({image})=>{if(image.id==='b')throw Error('核对失败');return reviewResult(image.id);}});
  const session=gateway.createSession();session.sync(reviewImages,reviewFields);await session.run(['ai','tamper','comparison']);
  const summary=buildRefundSummary(session.entries);
  assert.equal(summary.total,2);assert.equal(summary.complete,0);assert.equal(summary.rows[0].ai.result.risk,'low');assert.equal(summary.rows[0].tamper.result.risk,'high');
  assert.equal(summary.rows[0].issues.length,2);assert.equal(summary.rows[0].regions[0].id,'r1');
  assert.equal(filterRefundSummary(summary.rows,'attention').length,2);assert.equal(filterRefundSummary(summary.rows,'incomplete').length,2);assert.equal(filterRefundSummary(summary.rows,'failed').length,1);
  session.sync([reviewImages[0]],reviewFields);assert.equal(buildRefundSummary(session.entries).total,1);
  session.sync([reviewImages[0]],{...reviewFields,style:'新款'});const reset=buildRefundSummary(session.entries);assert.equal(reset.rows[0].issues.length,0);assert.equal(reset.rows[0].regions.length,0);assert.equal(reset.complete,0);session.dispose();
});

test('全量一致与低风险仍只是分类结果，空筛选和空案件不生成安全结论',async()=>{
  const gateway=createRefundDetection();gateway.configure({ai:async()=>baseResult('a','ai'),tamper:async()=>baseResult('a','tamper'),comparison:async()=>reviewResult('a',{checks:reviewResult().checks.map(item=>({...item,outcome:'match'}))})});
  const session=gateway.createSession();session.sync([reviewImages[0]],reviewFields);await session.run(['ai','tamper','comparison']);
  const summary=buildRefundSummary(session.entries);assert.equal(summary.complete,1);assert.equal(filterRefundSummary(summary.rows,'attention').length,0);assert.equal(filterRefundSummary(summary.rows,'failed').length,0);assert.equal('risk' in summary,false);
  assert.deepEqual(buildRefundSummary([]),{rows:[],total:0,complete:0});session.dispose();
});

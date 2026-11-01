import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefundDetection, validateRefundDetectionResult } from '../src/modules/image/refund/detection.js';

const detectionFields={caseNumber:'A1',productName:'杯子',description:'破损',style:'',productInfo:''};
const detectionImages=[{id:'a',file:new File(['a'],'a.png'),url:'blob:a',width:800,height:600},{id:'b',file:new File(['b'],'b.png'),url:'blob:b',width:600,height:800}];
const resultFor=(imageId,kind,extras={})=>({imageId,kind,risk:'medium',summary:'需核查',coverage:'full',scope:'整张图片',...(kind==='tamper'?{regions:[{id:'r1',type:'add',description:'边缘异常',box:{x:.2,y:.3,width:.2,height:.1}}]}:{}),...extras});

test('未配置服务不调用请求、不生成结果；缺少图片和检测类型被拒绝',async()=>{
  const gateway=createRefundDetection();const session=gateway.createSession();
  session.sync(detectionImages,detectionFields);
  await assert.rejects(session.run(['ai']),/未接入/);
  assert.equal(session.entries[0].ai.status,'idle');
  await assert.rejects(session.run([]),/选择/);
  session.sync([],detectionFields);
  await assert.rejects(session.run(['ai']),/图片/);
  session.dispose();
});

test('结果校验拒绝错图、类型、缺失覆盖范围和非法区域；不把无区域当作安全',()=>{
  const valid=resultFor('a','tamper');
  assert.equal(validateRefundDetectionResult(valid,'a','tamper').risk,'medium');
  for(const invalid of [ {...valid,imageId:'b'}, {...valid,kind:'ai'}, {...valid,risk:'safe'}, {...valid,scope:''}, {...valid,regions:[{...valid.regions[0],box:{x:.9,y:0,width:.5,height:.1}}]}, {...valid,regions:[valid.regions[0],valid.regions[0]]} ]) {
    assert.throws(()=>validateRefundDetectionResult(invalid,'a','tamper'),/结果/);
  }
  const partial=validateRefundDetectionResult(resultFor('a','tamper',{risk:'unknown',coverage:'partial',scope:'仅左上区域',regions:[]}),'a','tamper');
  assert.equal(partial.risk,'unknown');assert.equal(partial.coverage,'partial');
});

test('两类逐图状态独立，部分失败继续执行，重试只影响目标项',async()=>{
  const gateway=createRefundDetection();let fail=true;const calls=[];
  gateway.configure({ai:async({image})=>{calls.push(image.id+'ai');return resultFor(image.id,'ai',{risk:'low'});},tamper:async({image})=>{calls.push(image.id+'tamper');if(image.id==='a'&&fail)throw Error('无法处理');return resultFor(image.id,'tamper');}});
  const session=gateway.createSession();session.sync(detectionImages,detectionFields);
  await session.run(['ai','tamper']);
  assert.deepEqual(session.entries.map(e=>[e.ai.status,e.tamper.status]),[['succeeded','failed'],['succeeded','succeeded']]);
  assert.equal(session.entries[0].ai.result.risk,'low');
  fail=false;await session.run(['tamper'],['a']);
  assert.equal(calls.length,5);assert.equal(session.entries[0].tamper.status,'succeeded');
  session.dispose();
});

test('取消未响应signal的适配器释放锁，迟到结果不覆盖再次检测',async()=>{
  const gateway=createRefundDetection();let finish,signal;
  gateway.configure({ai:({image},options)=>{signal=options.signal;return new Promise(resolve=>{finish=()=>resolve(resultFor(image.id,'ai'));});}});
  const session=gateway.createSession();session.sync(detectionImages,detectionFields);
  const pending=session.run(['ai']);
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(session.run(['ai']),/正在/);
  session.cancel();
  assert.equal(gateway.busy,false);assert.equal(signal.aborted,true);
  await pending;assert.equal(session.entries[0].ai.status,'cancelled');assert.equal(session.entries[1].ai.status,'cancelled');
  gateway.configure({ai:async({image})=>resultFor(image.id,'ai',{risk:'high'})});
  await session.run(['ai']);finish();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(session.entries[0].ai.result.risk,'high');session.dispose();
});

test('超时失败可重试，并向适配器传递取消信号',async()=>{
  const gateway=createRefundDetection({timeoutMs:10});let signal;
  gateway.configure({ai:(_,options)=>{signal=options.signal;return new Promise(()=>{});}});
  const session=gateway.createSession();session.sync([detectionImages[0]],detectionFields);
  await session.run(['ai']);
  assert.equal(session.entries[0].ai.status,'failed');assert.match(session.entries[0].ai.error,/超时/);
  assert.equal(signal.aborted,true);assert.equal(gateway.busy,false);session.dispose();
});

test('案件编辑清除旧结果；新图未检测、移除清理、同id换文件不能沿用结果',async()=>{
  const gateway=createRefundDetection();gateway.configure({ai:async({image})=>resultFor(image.id,'ai')});
  const session=gateway.createSession();session.sync([detectionImages[0]],detectionFields);await session.run(['ai']);
  session.sync(detectionImages,detectionFields);
  assert.equal(session.entries[0].ai.status,'succeeded');assert.equal(session.entries[1].ai.status,'idle');
  session.sync([detectionImages[0]],{...detectionFields,description:'另一问题'});assert.equal(session.entries[0].ai.status,'idle');
  await session.run(['ai']);session.sync([{...detectionImages[0],file:new File(['new'],'new.png')}],{...detectionFields,description:'另一问题'});
  assert.equal(session.entries[0].ai.status,'idle');session.sync([],detectionFields);assert.equal(session.entries.length,0);session.dispose();
});

test('销毁会话停止未完成项且不会通知新页面，快照不受适配器修改影响',async()=>{
  const gateway=createRefundDetection();let finish;let changes=0;
  gateway.configure({ai:({fields,image})=>{fields.productName='修改';return new Promise(resolve=>{finish=()=>resolve(resultFor(image.id,'ai'));});}});
  const session=gateway.createSession({onChange:()=>changes++});session.sync(detectionImages,detectionFields);
  const pending=session.run(['ai']);await new Promise(resolve=>setImmediate(resolve));session.dispose();const count=changes;
  finish();await pending;assert.equal(changes,count);assert.equal(gateway.busy,false);assert.equal(detectionFields.productName,'杯子');
});

test('检测中重复同步相同材料仍接收当前任务结果，不遗留检测中状态',async()=>{
  const gateway=createRefundDetection();let finish;
  gateway.configure({ai:({image})=>new Promise(resolve=>{finish=()=>resolve(resultFor(image.id,'ai'));})});
  const session=gateway.createSession();session.sync([detectionImages[0]],detectionFields);
  const pending=session.run(['ai']);await new Promise(resolve=>setImmediate(resolve));
  session.sync([{...detectionImages[0]}],{...detectionFields});
  assert.equal(session.busy,true);finish();await pending;
  assert.equal(session.entries[0].ai.status,'succeeded');assert.equal(session.entries[0].ai.result.imageId,'a');
  assert.equal(session.busy,false);session.dispose();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {validateAftersalesVideoFile,validateAftersalesVideoFields,createAftersalesVideoMaterials} from '../src/modules/video/aftersales/materials.js';
import {createAftersalesVideoSubmission} from '../src/modules/video/aftersales/submission.js';
const fields={caseNumber:' AS-1 ',productName:'杯子',style:'',productInfo:'',description:'开箱发现破损'};
const file=(name='证据.mp4',size=100,type='video/mp4')=>({name,size,type});
const metadata={url:'blob:test',duration:600,width:640,height:360};

test('视频材料拒绝格式/空文件/大小错误，资料检查必填及长度',()=>{
  assert.equal(typeof validateAftersalesVideoFile,'function');
  assert.equal(validateAftersalesVideoFile(file('a.MP4',209715200)),null);
  for(const input of [file('a.mp4',209715201),file('a.mp4',0),file('a.mov'),file('a.mp4',10,'image/png')]) assert.ok(validateAftersalesVideoFile(input));
  assert.deepEqual(validateAftersalesVideoFields(fields),{});
  assert.ok(validateAftersalesVideoFields({...fields,caseNumber:'  '}).caseNumber);
  assert.ok(validateAftersalesVideoFields({...fields,description:'x'.repeat(2001)}).description);
});

test('并发批次守住数量上限，混合失败保留有效项，移除释放资源',async()=>{
  assert.equal(typeof createAftersalesVideoMaterials,'function');
  const revoked=[];
  const collection=createAftersalesVideoMaterials({readVideo:async f=>{if(f.name==='broken.mp4')throw Error('不可解码');return {...metadata,url:`blob:${f.name}`};},revoke:url=>revoked.push(url)});
  const first=collection.add([file('broken.mp4'),file('1.mp4'),file('2.mp4'),file('3.mp4')]);
  const second=collection.add([file('4.mp4'),file('5.mp4'),file('6.mp4')]);
  assert.equal((await first).added,3); assert.equal((await second).errors.length,1);
  assert.equal(collection.items.length,5);
  collection.remove(collection.items[0].id); assert.deepEqual(revoked,['blob:1.mp4']);
  collection.dispose(); assert.equal(revoked.length,5); assert.equal(collection.items.length,0);
});

test('时长与尺寸校验拒绝无效元数据并释放URL',async()=>{
  assert.equal(typeof createAftersalesVideoMaterials,'function');
  for(const change of [{duration:601},{duration:Infinity},{duration:0},{width:0},{height:NaN}]){
    const revoked=[];
    const collection=createAftersalesVideoMaterials({readVideo:async()=>({...metadata,...change}),revoke:url=>revoked.push(url)});
    assert.equal((await collection.add([file()])).added,0); assert.deepEqual(revoked,['blob:test']);
  }
});

test('离开取消正在读取的材料，迟到结果不进入集合且释放URL',async()=>{
  assert.equal(typeof createAftersalesVideoMaterials,'function');
  let finish,signal; const revoked=[];
  const collection=createAftersalesVideoMaterials({readVideo:(_,{signal:s})=>{signal=s;return new Promise(resolve=>{finish=resolve;});},revoke:url=>revoked.push(url)});
  const pending=collection.add([file(),file('2.mp4')]); await Promise.resolve();
  collection.dispose(); assert.equal(signal.aborted,true); finish(metadata);
  await pending; assert.equal(collection.items.length,0); assert.deepEqual(revoked,['blob:test']);
});

test('提交必须有有效输入与明确接收回执，失败可重试且快照与输入分离',async()=>{
  assert.equal(typeof createAftersalesVideoSubmission,'function');
  const service=createAftersalesVideoSubmission(),videos=[{id:'v1',file:file(),...metadata}];
  await assert.rejects(service.submit(fields,videos),e=>e.code==='BACKEND_NOT_CONNECTED');
  await assert.rejects(service.submit(fields,[]),/至少/);
  await assert.rejects(service.submit({...fields,productName:''},videos),/商品/);
  let snapshot;
  service.configure(async value=>{snapshot=value;return {accepted:true};});
  await assert.rejects(service.submit(fields,videos),/回执/); assert.equal(service.busy,false);
  assert.equal(snapshot.fields.caseNumber,'AS-1'); assert.equal(snapshot.videos[0].file,videos[0].file); assert.equal('url' in snapshot.videos[0],false);
  service.configure(async()=>({accepted:true,receiptId:'R1'}));
  assert.deepEqual(await service.submit(fields,videos),{accepted:true,receiptId:'R1'});
});

test('提交防重复，取消立即释放锁，忽略旧回执且不干扰下一次提交',async()=>{
  assert.equal(typeof createAftersalesVideoSubmission,'function');
  const service=createAftersalesVideoSubmission(),controller=new AbortController(),videos=[{id:'v1',file:file(),...metadata}];
  let resolveOld;
  service.configure(()=>new Promise(resolve=>{resolveOld=resolve;}));
  const first=service.submit(fields,videos,{signal:controller.signal});
  await assert.rejects(service.submit(fields,videos),/重复/);
  controller.abort(); await assert.rejects(first,/取消/); assert.equal(service.busy,false);
  service.configure(async()=>({accepted:true,receiptId:'new'}));
  resolveOld({accepted:true,receiptId:'old'});
  assert.equal((await service.submit(fields,videos)).receiptId,'new');
});

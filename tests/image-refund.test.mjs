import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRefundFile, validateRefundFields, createRefundMaterials } from '../src/modules/image/refund/materials.js';
import { createRefundSubmission } from '../src/modules/image/refund/submission.js';

const file = (name='photo.png', size=100, type='image/png') => ({ name, size, type });
const fields = { caseNumber:'AS-001', productName:'陶瓷杯', style:'白色', productInfo:'300ml', description:'杯身破损' };
const preview = async value => ({ url:`blob:${value.name}`, width:800, height:600 });

test('文件格式、空文件、5 MiB边界与伪装后缀有明确校验', () => {
  assert.equal(validateRefundFile(file('a.png',5*1024*1024)), '');
  assert.match(validateRefundFile(file('a.png',5*1024*1024+1)), /5 MiB/);
  assert.match(validateRefundFile(file('a.png',0)), /空/);
  assert.match(validateRefundFile(file('a.svg',100,'image/svg+xml')), /格式/);
  assert.match(validateRefundFile(file('a.png',100,'image/jpeg')), /格式/);
  assert.equal(validateRefundFile(file('A.JPG',100,'')), '');
});

test('表单拒绝空白必填和超长输入，保留可选项', () => {
  assert.deepEqual(validateRefundFields(fields), {});
  assert.deepEqual(Object.keys(validateRefundFields({...fields,caseNumber:'  ',productName:'',description:' '})), ['caseNumber','productName','description']);
  assert.ok(validateRefundFields({...fields,productInfo:'字'.repeat(2001)}).productInfo);
  assert.deepEqual(validateRefundFields({...fields,style:'',productInfo:''}), {});
});

test('混合批次保留有效图片，损坏图片逐项拒绝', async () => {
  const collection = createRefundMaterials({readPreview:async f => {
    if(f.name==='broken.png') throw new Error('图片无法读取');
    return preview(f);
  },revoke:()=>{}});
  const result = await collection.add([file('good.png'),file('bad.txt',10,'text/plain'),file('broken.png')]);
  assert.equal(collection.items.length,1);
  assert.equal(collection.items[0].file.name,'good.png');
  assert.deepEqual(result.errors.map(x=>x.name), ['bad.txt','broken.png']);
  collection.dispose();
});

test('并发添加不会超过10张，移除释放对应URL，空批次无副作用', async () => {
  const revoked=[];
  const collection=createRefundMaterials({readPreview:preview,revoke:u=>revoked.push(u)});
  await Promise.all([collection.add(Array.from({length:7},(_,i)=>file(`a${i}.png`))),collection.add(Array.from({length:7},(_,i)=>file(`b${i}.png`)))]);
  assert.equal(collection.items.length,10);
  const first=collection.items[0];
  collection.remove(first.id);
  assert.equal(collection.items.length,9);
  assert.deepEqual(revoked,[first.url]);
  await collection.add([]);
  assert.equal(collection.items.length,9);
  collection.dispose();
  assert.equal(revoked.length,10);
  assert.equal(collection.items.length,0);
});

test('页面销毁时未完成的图片读取不会泄漏URL或重新加入列表', async () => {
  let finish;
  const revoked=[];
  const collection=createRefundMaterials({readPreview:()=>new Promise(resolve=>{finish=resolve;}),revoke:u=>revoked.push(u)});
  const adding=collection.add([file()]);
  await new Promise(resolve=>setImmediate(resolve));
  collection.dispose();
  finish({url:'blob:late',width:2,height:2});
  await adding;
  assert.deepEqual(revoked,['blob:late']);
  assert.equal(collection.items.length,0);
});

test('默认提交未接入，不伪造成功；缺少图片拒绝提交', async () => {
  const gateway=createRefundSubmission();
  await assert.rejects(gateway.submit(fields,[]), /图片/);
  await assert.rejects(gateway.submit(fields,[{file:file()}]), e=>e.code==='BACKEND_NOT_CONNECTED');
});

test('适配器收到独立资料快照，防重复提交，仅认可明确接收回执', async () => {
  const gateway=createRefundSubmission();
  let finish, received;
  gateway.configure(async snapshot=>{received=snapshot;return new Promise(resolve=>{finish=resolve;});});
  const mutable={...fields};
  const pending=gateway.submit(mutable,[{file:file()}]);
  mutable.productName='已编辑';
  assert.equal(received.fields.productName,'陶瓷杯');
  await assert.rejects(gateway.submit(fields,[{file:file()}]), /正在提交/);
  finish({accepted:true,receiptId:'receipt-1'});
  assert.equal((await pending).receiptId,'receipt-1');
  assert.equal(gateway.busy,false);
  gateway.configure(async()=>({}));
  await assert.rejects(gateway.submit(fields,[{file:file()}]), /接收回执/);
  assert.equal(gateway.busy,false);
});

test('适配器失败后可重试，原始资料与图片保持完整', async () => {
  const gateway=createRefundSubmission();
  const images=[{file:file()}];
  gateway.configure(async()=>{throw new Error('服务暂不可用');});
  await assert.rejects(gateway.submit(fields,images), /服务暂不可用/);
  assert.equal(images.length,1);
  assert.equal(fields.productName,'陶瓷杯');
  gateway.configure(async()=>({accepted:true,receiptId:'retry-1'}));
  assert.equal((await gateway.submit(fields,images)).receiptId,'retry-1');
});

test('离开页面取消提交，即使适配器不响应signal也释放锁，迟到回执不被接收', async () => {
  const gateway=createRefundSubmission();
  let finish;
  gateway.configure(()=>new Promise(resolve=>{finish=resolve;}));
  const controller=new AbortController();
  const pending=gateway.submit(fields,[{file:file()}],{signal:controller.signal});
  controller.abort();
  const outcome=await Promise.race([pending.then(()=> 'accepted',error=>error.message),new Promise(resolve=>setTimeout(()=>resolve('still locked'),100))]);
  assert.match(outcome,/取消/);
  assert.equal(gateway.busy,false);
  finish({accepted:true,receiptId:'late'});
  gateway.configure(async()=>({accepted:true,receiptId:'next'}));
  assert.equal((await gateway.submit(fields,[{file:file()}])).receiptId,'next');
});

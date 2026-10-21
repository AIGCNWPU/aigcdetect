import test from 'node:test';
import assert from 'node:assert/strict';
import * as detection from '../src/modules/video/aftersales/detection.js';
import * as cases from '../src/modules/video/aftersales/case-evidence.js';
const fields={caseNumber:'AS-1',productName:'风扇',style:'绿色',productInfo:'USB供电',description:'扇叶不转'};
const video={id:'v1',version:1,file:new Blob(['video']),url:'blob:test',duration:3,width:640,height:360};
const risk=(v=video,kind='ai')=>({videoId:v.id,version:v.version,kind,risk:'medium',coverage:'partial',scope:'0—2秒',summary:'需复核',segments:[{id:'s1',start:0.5,end:1.5,description:'异常过渡',type:'splice'}],frames:[{time:1,label:'异常位置'}]});
const comparison=(v=video)=>({videoId:v.id,version:v.version,kind:'comparison',coverage:'full',scope:'完整视频',summary:'核对问题',checks:['appearance','style','issue'].map(dimension=>({dimension,outcome:'match',observed:'可见外观',evidence:'第1秒画面',segments:[{id:dimension,start:0,end:1,description:'核对依据'}]}))});
test('视频结果严格匹配材料版本并拒绝越界/重复片段与画面时间',()=>{
  assert.equal(typeof detection.validateAftersalesVideoResult,'function');
  const validate=detection.validateAftersalesVideoResult;
  assert.equal(validate(risk(),video,'ai',fields).coverage,'partial');
  for(const change of [{videoId:'other'},{version:2},{segments:[{id:'s',start:2,end:4,description:'越界'}]},{frames:[{time:4,label:'越界'}]},{segments:[...risk().segments,...risk().segments]}]) assert.throws(()=>validate({...risk(),...change},video,'ai',fields));
  assert.equal(validate(comparison(),video,'comparison',fields).checks.length,3);
  assert.throws(()=>validate(comparison(),video,'comparison',{...fields,style:''}));
});
test('检测独立失败与单项重试不影响其他结果，未配置不伪造结果',async()=>{
  assert.equal(typeof detection.createAftersalesVideoDetection,'function');
  const service=detection.createAftersalesVideoDetection(),session=service.createSession();session.sync([video],fields);
  await assert.rejects(session.run(['ai']),/尚未接入/);assert.equal(session.entries[0].ai.status,'idle');
  service.configure({ai:async({video:v})=>risk(v),tamper:async()=>{throw Error('上游失败');},comparison:async({video:v})=>comparison(v)});
  await session.run(['ai','tamper','comparison']);
  assert.equal(session.entries[0].ai.status,'succeeded');assert.equal(session.entries[0].tamper.status,'failed');assert.equal(session.entries[0].comparison.status,'succeeded');
  const previous=session.entries[0].ai.result;
  service.configure({tamper:async({video:v})=>risk(v,'tamper')});await session.run(['tamper'],['v1']);
  assert.equal(session.entries[0].ai.result,previous);assert.equal(session.entries[0].tamper.status,'succeeded');
});
test('取消释放锁、迟到结果不覆盖新版，资料变化清除旧结论',async()=>{
  assert.equal(typeof detection.createAftersalesVideoDetection,'function');
  const service=detection.createAftersalesVideoDetection();let finish,signal;
  service.configure({ai:({video:v},{signal:s})=>{signal=s;return new Promise(resolve=>{finish=()=>resolve(risk(v));});}});
  const session=service.createSession();session.sync([video],fields);const old=session.run(['ai']);await Promise.resolve();
  session.cancel();assert.equal(signal.aborted,true);assert.equal(service.busy,false);
  session.sync([video],{...fields,description:'新的问题'});assert.equal(session.entries[0].ai.status,'idle');
  service.configure({ai:async({video:v})=>risk(v)});await session.run(['ai']);const version=session.entries[0].version;
  finish();await old;assert.equal(session.entries[0].ai.result.version,version);
  session.sync([{...video,file:new Blob(['replacement'])}],fields);assert.equal(session.entries[0].ai.status,'idle');session.dispose();
});
test('检测超时通知适配器并允许重试；相同输入同步不打断运行',async()=>{
  assert.equal(typeof detection.createAftersalesVideoDetection,'function');
  const service=detection.createAftersalesVideoDetection({timeoutMs:15});let signal;
  service.configure({ai:(_,{signal:s})=>{signal=s;return new Promise(()=>{});}});
  const session=service.createSession();session.sync([video],fields);const run=session.run(['ai']);session.sync([video],fields);await run;
  assert.equal(signal.aborted,true);assert.equal(session.entries[0].ai.status,'failed');assert.match(session.entries[0].ai.error,/超时/);assert.equal(service.busy,false);
});
const imageResult={imageId:'im1',version:'r1',kind:'ai',risk:'high',coverage:'full',scope:'整图',summary:'风险待核查'};
const casePayload=()=>({caseNumber:'AS-1',caseRef:'case-opaque-1',materials:[{caseRef:'case-opaque-1',materialRef:'im1',version:'r1',type:'image',name:'图片.jpg',url:'https://example.test/image.jpg',fields,results:{ai:{status:'succeeded',result:imageResult}}}]});
test('同案汇总拒绝错案、错材料版本、不安全URL和重复引用',()=>{
  assert.equal(typeof cases.validateAftersalesCaseEvidence,'function');
  const validate=cases.validateAftersalesCaseEvidence;
  assert.equal(validate(casePayload(),'AS-1').materials[0].results.ai.result.risk,'high');
  for(const mutate of [p=>p.caseNumber='wrong',p=>p.materials[0].caseRef='other',p=>p.materials[0].version='r2',p=>p.materials[0].url='javascript:alert(1)',p=>p.materials.push(p.materials[0])]){
    const payload=casePayload();mutate(payload);assert.throws(()=>validate(payload,'AS-1'));
  }
});
test('案件读取失败清空旧案，取消立即释放锁并忽略迟到数据',async()=>{
  assert.equal(typeof cases.createAftersalesCaseEvidence,'function');
  const service=cases.createAftersalesCaseEvidence();await assert.rejects(service.load('AS-1'),/尚未接入/);
  service.configure(async()=>casePayload());await service.load('AS-1');assert.equal(service.data.caseRef,'case-opaque-1');
  service.configure(async()=>{throw Error('没有访问权限');});await assert.rejects(service.load('AS-2'),/权限/);assert.equal(service.data,null);
  let finish,signal;service.configure((_,{signal:s})=>{signal=s;return new Promise(resolve=>{finish=resolve;});});
  const pending=service.load('AS-1');await Promise.resolve();service.cancel();assert.equal(service.busy,false);assert.equal(signal.aborted,true);
  finish(casePayload());await assert.rejects(pending,/取消/);assert.equal(service.data,null);
});

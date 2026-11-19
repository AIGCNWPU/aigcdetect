import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { scenarios } from '../src/catalog.js';
import { runTextScenario } from '../src/modules/text/service.js';
import { applyRewriteProposals, chapterTextDownload, createChapterVersion, createNovelRewriteStore, createRewriteDraftSession, hashNovelContent, inspectRewriteProposals, selectNovelChapterResult } from '../src/modules/text/novel-rewrite.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const novelScenario=scenarios.find(item=>item.id==='novel');
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const baseContent='她停在门边，认真地思考了一会儿。\n“我知道。”她轻声说道。😀';
const firstLineEnd=baseContent.indexOf('\n');
const fragment={fragmentId:'f1',start:0,end:firstLineEnd,text:baseContent.slice(0,firstLineEnd),label:'suspected-ai'};
const payload=overrides=>({action:'rewrite',work:{title:'测试作品'},chapters:[{localId:'c1',title:'第一章',version:1,content:baseContent,contentHash:sha(baseContent),fragments:[fragment],...overrides}]});

test('小说改写动作校验原文哈希、片段范围、重叠和可改写标签',async()=>{
  const modelClient={analyze:async({payload})=>({findings:[{fragmentId:payload.fragments[0].fragmentId,after:'她扶着门框，迟疑片刻。',reason:'压缩机械表述'}]})};
  const result=await runTextScenario(novelScenario,payload(),{modelClient});
  assert.equal(result.proposals[0].before,fragment.text);
  assert.equal(result.proposals[0].after,'她扶着门框，迟疑片刻。');
  await assert.rejects(()=>runTextScenario(novelScenario,payload({contentHash:'0'.repeat(64)}),{modelClient}),error=>error.code==='STALE_REWRITE_SOURCE');
  await assert.rejects(()=>runTextScenario(novelScenario,payload({fragments:[{...fragment,end:999}]}),{modelClient}),error=>error.code==='INVALID_REWRITE_FRAGMENTS');
  await assert.rejects(()=>runTextScenario(novelScenario,payload({fragments:[fragment,{...fragment,fragmentId:'f2',start:5,end:19,text:baseContent.slice(5,19)}]}),{modelClient}),error=>error.code==='INVALID_REWRITE_FRAGMENTS');
  await assert.rejects(()=>runTextScenario(novelScenario,payload({fragments:[]}),{modelClient}),error=>error.code==='NO_REWRITE_FRAGMENTS');
});

test('小说改写拒绝模型缺失、重复和未知片段结果',async()=>{
  await assert.rejects(()=>runTextScenario(novelScenario,payload(),{modelClient:{analyze:async()=>({findings:[]})}}),error=>error.code==='MODEL_RESPONSE_INVALID');
  const two=[fragment,{fragmentId:'f2',start:20,end:baseContent.length,text:baseContent.slice(20),label:'ai'}];
  await assert.rejects(()=>runTextScenario(novelScenario,payload({fragments:two}),{modelClient:{analyze:async({payload})=>({findings:[{fragmentId:payload.fragments[0].fragmentId,after:'甲'},{fragmentId:payload.fragments[0].fragmentId,after:'乙'}]})}}),error=>error.code==='MODEL_RESPONSE_INVALID');
  await assert.rejects(()=>runTextScenario(novelScenario,payload(),{modelClient:{analyze:async()=>({findings:[{fragmentId:'unknown',after:'无效'}]})}}),error=>error.code==='MODEL_RESPONSE_INVALID');
});

test('各章独立得分不回退为全文得分，旧单章结果保持兼容',()=>{
  const first={chapterId:'c1',documentScore:{score:.92}},second={chapterId:'c2',documentScore:{score:.62}};
  const risk={documentScore:{score:.30},chapterResults:[first,second]};
  assert.equal(selectNovelChapterResult(risk,'c1'),first);
  assert.equal(selectNovelChapterResult(risk,'c2'),second);
  assert.equal(selectNovelChapterResult(risk,'missing'),null);
  const legacy={documentScore:{score:.30}};
  assert.equal(selectNovelChapterResult(legacy,'c1'),null);
  assert.equal(selectNovelChapterResult(legacy,'c1',{allowSingleChapter:true}),legacy);
  assert.equal(selectNovelChapterResult({chapterResults:[]},'c1',{allowSingleChapter:true}),null);
});

test('多章同名片段使用唯一模型编号，乱序回包仍映射正确章节和原文',async()=>{
  const one=payload().chapters[0],otherContent='第二章的独立正文，只有本章的人物和情节，请勿与前一章相互替换。';
  const two={localId:'c2',title:'第二章',version:1,content:otherContent,contentHash:sha(otherContent),fragments:[{fragmentId:'f1',start:0,end:otherContent.length,text:otherContent,label:'ai'}]};
  let modelIds;
  const modelClient={analyze:async({payload})=>{modelIds=payload.fragments.map(item=>item.fragmentId);return{findings:[...payload.fragments].reverse().map(item=>({fragmentId:item.fragmentId,after:`${item.chapter}独立修改`,reason:'测试映射'}))};}};
  const result=await runTextScenario(novelScenario,{action:'rewrite',work:{title:'多章测试'},chapters:[one,two]},{modelClient});
  assert.equal(new Set(modelIds).size,2);
  assert.equal(new Set(result.proposals.map(item=>item.proposalId)).size,2);
  assert.ok(result.proposals.every(item=>item.fragmentId==='f1'));
  assert.equal(result.proposals.find(item=>item.chapterId==='c1').before,fragment.text);
  assert.equal(result.proposals.find(item=>item.chapterId==='c2').before,otherContent);
  assert.equal(result.proposals.find(item=>item.chapterId==='c2').after,'第二章独立修改');
  await assert.rejects(()=>runTextScenario(novelScenario,{action:'rewrite',work:{title:'重复章节'},chapters:[one,one]},{modelClient}),error=>error.code==='INVALID_REQUEST');
});

test('改写纯函数按UTF-16位置逆序替换并保留对白换行',async()=>{
  const emojiStart=baseContent.indexOf('😀');
  const proposals=[
    {proposalId:'p1',start:0,end:firstLineEnd,before:baseContent.slice(0,firstLineEnd),after:'她扶着门框，迟疑片刻。',accepted:true},
    {proposalId:'p2',start:emojiStart,end:emojiStart+2,before:'😀',after:'🙂',accepted:true},
  ];
  const inspected=inspectRewriteProposals(baseContent,proposals);
  assert.ok(inspected.every(item=>item.valid));
  const rewritten=applyRewriteProposals(baseContent,proposals);
  assert.equal(rewritten,'她扶着门框，迟疑片刻。\n“我知道。”她轻声说道。🙂');
  assert.ok(rewritten.includes('\n“我知道。”'));
  const version=await createChapterVersion({chapterId:'c1',title:'第一章',content:rewritten,parentVersionId:'c1-v1',versionNumber:2,acceptedProposalIds:['p1','p2']});
  assert.equal(version.contentHash,await hashNovelContent(rewritten));
  assert.deepEqual(version.acceptedProposalIds,['p1','p2']);
});

test('重叠或失效建议不能应用',()=>{
  const proposals=[
    {proposalId:'p1',start:0,end:8,before:baseContent.slice(0,8),after:'甲',accepted:true},
    {proposalId:'p2',start:5,end:12,before:baseContent.slice(5,12),after:'乙',accepted:true},
  ];
  assert.ok(inspectRewriteProposals(baseContent,proposals).every(item=>!item.valid));
  assert.throws(()=>applyRewriteProposals(baseContent,proposals),error=>error.code==='INVALID_REWRITE_PROPOSAL');
});

test('草稿接受与恢复只替换对应位置，重复句、变长建议和emoji不会串位',()=>{
  const source='😀相同句。中间。相同句。结尾。';
  const session=createRewriteDraftSession(source,[
    {proposalId:'a',start:2,end:6,before:'相同句。',after:'第一句修改。'},
    {proposalId:'b',start:9,end:13,before:'相同句。',after:'第二句。'},
  ]);
  assert.equal(session.decide(item=>item.proposalId==='b','accepted').content,'😀相同句。中间。第二句。结尾。');
  assert.equal(session.decide(()=>true,'accepted').content,'😀第一句修改。中间。第二句。结尾。');
  assert.equal(session.decide(()=>true,'accepted').content,'😀第一句修改。中间。第二句。结尾。');
  assert.equal(session.decide(item=>item.proposalId==='a','rejected').content,'😀相同句。中间。第二句。结尾。');
  assert.equal(session.values()[0].decision,'rejected');
  assert.equal(session.decide(()=>true,'pending').content,source);
  assert.deepEqual(session.acceptedIds(),[]);
});

test('恢复建议保留建议区间外的手工编辑，区间内改动只隔离冲突项',()=>{
  const source='前言。甲句。中间。乙句。结尾。';
  const session=createRewriteDraftSession(source,[
    {proposalId:'a',start:3,end:6,before:'甲句。',after:'甲改写。'},
    {proposalId:'b',start:9,end:12,before:'乙句。',after:'乙改写。'},
  ]);
  const accepted=session.decide(()=>true,'accepted').content;
  session.sync('用户补充😀'+accepted);
  session.sync('用户补充😀'+accepted+'作者补充。');
  assert.equal(session.decide(()=>true,'pending').content,'用户补充😀'+source+'作者补充。');
  const again=session.decide(()=>true,'accepted').content;
  session.sync(again.replace('甲改写。','甲手工重写。'));
  const restored=session.decide(()=>true,'pending');
  assert.deepEqual(restored.conflicts,['a']);
  assert.equal(restored.content,'用户补充😀前言。甲手工重写。中间。乙句。结尾。作者补充。');
  assert.deepEqual(session.acceptedIds(),[]);
  session.sync(source);
  assert.ok(session.values().every(item=>item.decision==='pending'&&!item.conflict));
  assert.equal(session.decide(()=>true,'accepted').content,accepted);
});

test('手工改过的待接受片段不会被旧建议覆盖，长度超限不产生半个章节替换',()=>{
  const proposal={proposalId:'a',start:0,end:3,before:'甲句。',after:'第一段很长的修改。'};
  const session=createRewriteDraftSession('甲句。末尾。',[proposal],{maxLength:10});
  assert.throws(()=>session.decide(()=>true,'accepted'),error=>error.code==='DRAFT_TOO_LONG');
  assert.deepEqual(session.acceptedIds(),[]);
  assert.equal(session.decide(()=>true,'pending').content,'甲句。末尾。');
  session.sync('手工修改。末尾。');
  assert.deepEqual(session.decide(()=>true,'accepted'),{content:'手工修改。末尾。',conflicts:['a']});
});

test('浏览器仓库跨实例恢复版本并拒绝损坏、超限和写入失败',async()=>{
  class MemoryStorage{constructor(){this.values=new Map();}getItem(k){return this.values.get(k)||null;}setItem(k,v){this.values.set(k,v);}removeItem(k){this.values.delete(k);}}
  const storage=new MemoryStorage(),store=createNovelRewriteStore({storage});
  const version=await createChapterVersion({chapterId:'c1',title:'第一章',content:baseContent,versionNumber:1});
  const saved=await store.save({works:[{workId:'work-1',workTitle:'测试作品',chapters:[{chapterId:'c1',title:'第一章',activeVersionId:version.versionId,versions:[version],batches:[]}]}]});
  assert.equal((await createNovelRewriteStore({storage}).load()).works[0].chapters[0].versions[0].content,baseContent);
  const raw=JSON.parse(storage.getItem('veritas_novel_rewrite_history_v1'));raw.works[0].chapters[0].versions[0].content+='损坏';storage.setItem('veritas_novel_rewrite_history_v1',JSON.stringify(raw));
  await assert.rejects(()=>store.load(),error=>error.code==='HISTORY_CORRUPT');
  await assert.rejects(()=>createNovelRewriteStore({storage:new MemoryStorage(),maxBytes:20}).save(saved),error=>error.code==='STORAGE_LIMIT');
  const failing={getItem(){return null;},setItem(){throw new Error('quota');},removeItem(){}};
  await assert.rejects(()=>createNovelRewriteStore({storage:failing}).save(saved),error=>error.code==='STORAGE_WRITE_FAILED');
});

test('默认改写记录仅属于当前页面实例，新的实例不恢复旧版本',async()=>{
  const store=createNovelRewriteStore();
  const version=await createChapterVersion({chapterId:'c1',title:'第一章',content:baseContent});
  await store.save({works:[{workId:'session-work',chapters:[{chapterId:'c1',versions:[version]}]}]});
  assert.equal((await store.load()).works.length,1);
  assert.deepEqual((await createNovelRewriteStore().load()).works,[]);
});

test('修改后章节下载只包含正文并生成可识别文件名',()=>{
  const file=chapterTextDownload({workTitle:'作品:名称',chapterTitle:'第一章/初遇',versionNumber:2,content:'第一段。\n“对白。”'});
  assert.equal(file.fileName,'作品-名称-第一章-初遇-改写版-v2.txt');
  assert.equal(file.content,'第一段。\n“对白。”');
  assert.ok(!file.content.includes('AI'));
});

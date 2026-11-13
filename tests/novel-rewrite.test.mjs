import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { scenarios } from '../src/catalog.js';
import { runTextScenario } from '../src/modules/text/service.js';
import { applyRewriteProposals, chapterTextDownload, createChapterVersion, createNovelRewriteStore, hashNovelContent, inspectRewriteProposals } from '../src/modules/text/novel-rewrite.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const novelScenario=scenarios.find(item=>item.id==='novel');
const sha=value=>createHash('sha256').update(value,'utf8').digest('hex');
const baseContent='她停在门边，认真地思考了一会儿。\n“我知道。”她轻声说道。😀';
const firstLineEnd=baseContent.indexOf('\n');
const fragment={fragmentId:'f1',start:0,end:firstLineEnd,text:baseContent.slice(0,firstLineEnd),label:'suspected-ai'};
const payload=overrides=>({action:'rewrite',work:{title:'测试作品'},chapters:[{localId:'c1',title:'第一章',version:1,content:baseContent,contentHash:sha(baseContent),fragments:[fragment],...overrides}]});

test('小说改写动作校验原文哈希、片段范围、重叠和可改写标签',async()=>{
  const modelClient={analyze:async()=>({findings:[{fragmentId:'f1',after:'她扶着门框，迟疑片刻。',reason:'压缩机械表述'}]})};
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
  await assert.rejects(()=>runTextScenario(novelScenario,payload({fragments:two}),{modelClient:{analyze:async()=>({findings:[{fragmentId:'f1',after:'甲'},{fragmentId:'f1',after:'乙'}]})}}),error=>error.code==='MODEL_RESPONSE_INVALID');
  await assert.rejects(()=>runTextScenario(novelScenario,payload(),{modelClient:{analyze:async()=>({findings:[{fragmentId:'unknown',after:'无效'}]})}}),error=>error.code==='MODEL_RESPONSE_INVALID');
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

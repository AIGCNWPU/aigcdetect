import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scenarios } from '../src/catalog.js';
import { pageRenderers } from '../src/modules/registry.js';
import { scenarioServices } from '../src/server/registry.js';
import { clientFiles } from '../scripts/source-files.mjs';
import { api } from '../src/api.js';
import { createConfirmedNewsImport, validateConfirmedNewsLink, validateNewsInput } from '../src/modules/text/pages/news.js';
import { createConfirmedNovelImport, createNovelDetectionPayload, resolveImportedWorkTitle, validateNovelChapter, validateNovelUrl } from '../src/modules/text/pages/novel.js';
import { matchNovelPlatformUrl, normalizeNovelPlatform, novelPlatformPolicies } from '../src/modules/text/novel-platforms.js';
import { mergeIndependentResultServices, runIndependentResultServices } from '../src/modules/text/result-render.js';

test('10个场景有独立渲染器，已实现页面已接入工作区',()=>{
  const pages=new Map(pageRenderers);
  assert.equal(pages.size,10);
  for(const scene of scenarios){
    assert.equal(typeof pages.get(scene.path),'function');
    if(!['/text/academic','/text/news','/text/novel','/image/refund','/video/aftersales','/video/general','/video/deepfake','/audio/forgery'].includes(scene.path)){
      const untouched={};
      assert.equal(pages.get(scene.path)(untouched,{scenario:scene}),undefined);
      assert.deepEqual(untouched,{});
    }
    assert.ok(clientFiles.includes(`src/modules/${scene.moduleId}/pages/${scene.id}.js`));
  }
});

test('新闻稿和小说章节在前端提交前校验必要材料',()=>{
  assert.equal(validateNewsInput({title:'',sourceType:'paste',content:'正文'}),'请填写稿件标题。');
  assert.equal(validateNewsInput({title:'稿件',sourceType:'paste',content:'  '}),'请粘贴需要检测的稿件正文。');
  assert.equal(validateNewsInput({title:'稿件',sourceType:'link',url:'javascript:alert(1)'}),'请输入有效的 http 或 https 新闻链接。');
  assert.equal(validateNewsInput({title:'稿件',sourceType:'link',url:'https://example.com/a'}),'');
  assert.equal(validateNovelChapter({workTitle:'作品',chapterTitle:'',content:'正文'}),'请填写章节名称。');
  assert.equal(validateNovelChapter({workTitle:'作品',chapterTitle:'第一章',content:'正文'}),'');
  assert.match(validateNovelUrl('file:///chapter/1'),/http 或 https/);
  assert.match(validateNovelUrl('https://user:pass@example.com/chapter/1'),/不含账号信息/);
  assert.equal(validateNovelUrl('https://mip.ciweimao.com/chapter/113775098'),'');
});

test('新闻与小说检测结果使用全宽服务页签并包含AI聚合图表',async()=>{
  const [news,novel,renderer,styles]=await Promise.all([
    readFile(new URL('../src/modules/text/pages/news.js',import.meta.url),'utf8'),
    readFile(new URL('../src/modules/text/pages/novel.js',import.meta.url),'utf8'),
    readFile(new URL('../src/modules/text/result-render.js',import.meta.url),'utf8'),
    readFile(new URL('../src/styles.css',import.meta.url),'utf8'),
  ]);
  for(const page of [news,novel]){
    assert.match(page,/data-result-service-tabs/);
    assert.match(page,/data-result-service-panel="ai-risk"/);
    assert.match(page,/data-ai-overview/);
    assert.match(page,/setupResultServiceTabs/);
  }
  assert.match(renderer,/export function renderAiOverview/);
  assert.match(renderer,/export function renderProofreadingStages/);
  assert.match(renderer,/export function renderNovelPlatformPolicies/);
  assert.match(news,/data-proof-stages/);
  assert.match(novel,/novel-platform-picker/);
  assert.match(novel,/data-platform-policies-ai/);
  assert.match(novel,/data-platform-policies-quality/);
  assert.match(renderer,/全文内容字数分布/);
  assert.match(renderer,/stage\.objective/);
  assert.match(renderer,/stage\.checks/);
  assert.match(renderer,/段落加权得分/);
  assert.match(news,/data-export-ai/);
  assert.match(news,/data-export-secondary/);
  assert.match(novel,/data-export-ai/);
  assert.match(novel,/data-export-secondary/);
  assert.match(news,/downloadTextPdfReport/);
  assert.match(novel,/downloadTextPdfReport/);
  assert.doesNotMatch(news,/openPdfPrintPreview|window\.print/);
  assert.doesNotMatch(novel,/openPdfPrintPreview|window\.print/);
  assert.doesNotMatch(news,/检测报告-v\$\{version\}\.json/);
  assert.doesNotMatch(novel,/检测报告\.json/);
  assert.match(styles,/\.text-result-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(styles,/\.proofreading-stages/);
  assert.match(styles,/\.novel-platform-picker/);
  assert.match(styles,/\.novel-platform-policies/);
  assert.match(styles,/\.result-service-progress\.is-running/);
  assert.match(styles,/@keyframes text-service-spin/);
});

test('四项文本功能按服务独立返回且单项失败不覆盖已完成结果',async()=>{
  let releaseQuality;
  const qualityGate=new Promise(resolve=>{releaseQuality=resolve;});
  const updates=[];
  const services=[
    {id:'ai-risk',label:'AI内容分析',resultKey:'aiRisk',run:async()=>({status:'completed',contentHash:'same',coverage:{paragraphs:1},aiRisk:{summary:'AI先返回'}})},
    {id:'quality',label:'重复与水稿检测',resultKey:'quality',run:async()=>{await qualityGate;throw new Error('水稿服务暂不可用');}},
  ];
  const pending=runIndependentResultServices(services,event=>updates.push(`${event.id}:${event.status}`));
  await new Promise(resolve=>setImmediate(resolve));
  assert.ok(updates.includes('ai-risk:completed'));
  assert.ok(!updates.includes('quality:failed'));
  releaseQuality();
  const outcomes=await pending;
  const merged=mergeIndependentResultServices(services,outcomes);
  assert.equal(merged.status,'partial');
  assert.equal(merged.aiRisk.summary,'AI先返回');
  assert.equal(merged.quality,undefined);
  assert.deepEqual(merged.incompleteServices,[{id:'quality',label:'重复与水稿检测',reason:'水稿服务暂不可用'}]);
});

test('小说平台可由章节链接自动匹配且未知平台不生成规则链接',()=>{
  assert.equal(matchNovelPlatformUrl('https://mip.ciweimao.com/chapter/1').id,'ciweimao');
  assert.equal(matchNovelPlatformUrl('https://b.faloo.com/1_1.html').id,'faloo');
  assert.equal(matchNovelPlatformUrl('https://read.zongheng.com/chapter/1/2.html').id,'zongheng');
  assert.equal(matchNovelPlatformUrl('https://fanqienovel.com/reader/1').id,'fanqie');
  assert.equal(matchNovelPlatformUrl('https://www.qidian.com/chapter/1/2/').id,'qidian');
  assert.equal(matchNovelPlatformUrl('https://m.qidian.com/book/1/2').id,'qidian');
  assert.equal(matchNovelPlatformUrl('https://example.com/chapter/1').id,'unknown');
  assert.equal(normalizeNovelPlatform('generic').id,'unknown');
  const policies=novelPlatformPolicies(['fanqie','unknown','fanqie']);
  assert.equal(policies.length,1);
  assert.equal(policies[0].platformName,'番茄小说');
  assert.equal(policies[0].aiSpecific,false);
  assert.equal(policies[0].title,'番茄平台内容发布规范');
  assert.match(policies[0].url,/\/writer\/zone\/article\/7237084151751376957$/);
  const aiPolicies=novelPlatformPolicies(['fanqie','qidian'],{context:'ai'});
  assert.equal(aiPolicies[0].platformName,'番茄小说');
  assert.equal(aiPolicies[0].aiSpecific,true);
  assert.match(aiPolicies[0].url,/\/writer\/zone\/article\/7642544663915675672$/);
  assert.equal(aiPolicies[1].platformName,'起点中文网');
  assert.equal(aiPolicies[1].aiSpecific,false);
  const qidianPolicy=novelPlatformPolicies(['qidian'])[0];
  assert.equal(qidianPolicy.platformName,'起点中文网');
  assert.equal(qidianPolicy.aiSpecific,false);
  assert.match(qidianPolicy.url,/^https:\/\/acts\.qidian\.com\//);
});

test('新闻链接导入必须确认且链接修改后需要重新提取',()=>{
  const extracted={sourceUrl:'https://news.example/a',finalUrl:'https://news.example/a',siteName:'示例新闻',title:'原始标题',author:'记者',publishedAt:'2026-10-24T08:00:00+08:00',content:'原始新闻正文',extractionStatus:'completed',completeness:'unknown',notice:'完整性待确认'};
  const confirmed=createConfirmedNewsImport(extracted,{title:'用户确认标题',content:'用户确认后的新闻正文'});
  assert.equal(confirmed.title,'用户确认标题');
  assert.equal(confirmed.content,'用户确认后的新闻正文');
  assert.equal(confirmed.source.url,extracted.sourceUrl);
  assert.equal(confirmed.source.userEdited,true);
  assert.equal(validateConfirmedNewsLink(extracted.sourceUrl,confirmed),'');
  assert.match(validateConfirmedNewsLink('https://news.example/b',confirmed),/重新提取/);
  assert.match(validateConfirmedNewsLink(extracted.sourceUrl,null),/先提取并确认/);
  assert.throws(()=>createConfirmedNewsImport(extracted,{content:' '}),/可读正文/);
});

test('小说网页导入必须经确认后生成章节来源信息',()=>{
  const extracted={sourceUrl:'https://example.com/chapter/1',finalUrl:'https://example.com/chapter/1',site:'generic',workTitle:'原作品名',title:'第一章',content:'原始正文',extractionStatus:'partial',completeness:'partial',notice:'仅提取可读部分'};
  const confirmed=createConfirmedNovelImport(extracted,{workTitle:'用户确认的作品名',title:'第一章 修订',content:'用户确认后的正文'});
  assert.equal(confirmed.workTitle,'用户确认的作品名');
  assert.equal(confirmed.title,'第一章 修订');
  assert.equal(confirmed.content,'用户确认后的正文');
  assert.deepEqual({...confirmed.source,confirmedAt:undefined},{url:extracted.sourceUrl,finalUrl:extracted.finalUrl,site:'generic',extractionStatus:'partial',completeness:'partial',notice:'仅提取可读部分',confirmedAt:undefined,userEdited:true});
  assert.match(confirmed.source.confirmedAt,/^\d{4}-\d{2}-\d{2}T/);
  assert.throws(()=>createConfirmedNovelImport(extracted,{content:' '}),/可读正文/);
  assert.equal(resolveImportedWorkTitle('原表单作品名','链接读取作品名'),'链接读取作品名');
  assert.equal(resolveImportedWorkTitle('原表单作品名','  '),'原表单作品名');
});

test('小说单章与多章检测请求使用用户确认后的正文和来源',()=>{
  const source={url:'https://example.com/chapter/1',finalUrl:'https://example.com/chapter/1',site:'generic',extractionStatus:'partial',completeness:'partial',notice:'仅可读部分',confirmedAt:'2026-10-23T00:00:00.000Z',userEdited:true};
  const chapters=[{id:'1',title:'第一章',version:2,content:'用户确认后的第一章',platform:'ciweimao',source},{id:'2',title:'第二章',version:1,content:'手动粘贴的第二章',platform:'unknown',source:null}];
  const single=createNovelDetectionPayload({workTitle:'作品',chapters:chapters.slice(0,1),checks:['ai-risk']});
  assert.equal(single.chapters[0].content,'用户确认后的第一章');
  assert.equal(single.chapters[0].source.completeness,'partial');
  assert.equal(single.chapters[0].platform,'ciweimao');
  assert.equal(single.chapters[0].aiSegments.length,1);
  assert.equal(single.chapters[0].content.slice(single.chapters[0].aiSegments[0].start,single.chapters[0].aiSegments[0].end),single.chapters[0].aiSegments[0].text);
  const multiple=createNovelDetectionPayload({workTitle:'作品',chapters,checks:['ai-risk','repetition','padding']});
  assert.equal(multiple.chapters.length,2);
  assert.equal(multiple.chapters[1].source,undefined);
  assert.equal(multiple.chapters[1].platform,'unknown');
  assert.deepEqual(multiple.checks,['ai-risk','repetition','padding']);
});

test('业务分发走各模块服务，只有尚未实现的场景抛出501',async()=>{
  for(const scene of scenarios.filter(item=>!item.api.implemented)){
    await assert.rejects(()=>scenarioServices[scene.moduleId](scene,{},{}),error=>error.status===501&&error.code==='NOT_IMPLEMENTED'&&error.operationId===scene.api.operationId);
  }
  for(const scene of scenarios.filter(item=>item.api.implemented&&item.moduleId==='text')) await assert.rejects(()=>scenarioServices[scene.moduleId](scene,{},{}),error=>error.status===400&&error.code==='INVALID_REQUEST');
  assert.ok(clientFiles.every(file=>!file.includes('/server/')&&!file.endsWith('/service.js')));
});

test('统一客户端只验证成功响应解包协议，不把协议样例当作真实检测',async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async()=>new Response(JSON.stringify({data:{status:'completed',protocolFixture:true},requestId:'fixture'}),{status:200,headers:{'Content-Type':'application/json'}});
  try{
    const result=await api.invoke('/text/novel',{action:'analyze'});
    assert.deepEqual(result,{status:'completed',protocolFixture:true});
  }finally{globalThis.fetch=originalFetch;api.configure();}
});

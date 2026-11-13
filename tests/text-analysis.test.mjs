import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../src/catalog.js';
import { createTextModelClient } from '../src/modules/text/model-client.js';
import { runTextScenario } from '../src/modules/text/service.js';
import { createParagraphWindows, segmentText } from '../src/modules/text/segmentation.js';
import { createAiScoringSegments, splitAiSentences } from '../src/modules/text/ai-segmentation.js';
import { EgteClient } from '../src/modules/text/egte-client.js';
import { sanitizeNewsNovelAiText } from '../src/modules/text/news-novel-ai-input.js';
import { buildAiPdfReport, buildSecondaryPdfReport, selectAiReportItems, textReportIdentity } from '../src/modules/text/pdf-report.js';
import { textReportFileName } from '../src/modules/text/pdf-download.js';
import { filterAiSentenceFindings, formatAiClassScore, resultCompletionDetails } from '../src/modules/text/result-render.js';

const newsScenario=scenarios.find(item=>item.id==='news');
const novelScenario=scenarios.find(item=>item.id==='novel');

test('自动分段保留原文偏移、句子位置并只在段落边界切窗',()=>{
  const content='  第一段第一句。第一段第二句！\n\n第二段只有一句。  ';
  const paragraphs=segmentText(content,{prefix:'test'});
  assert.equal(paragraphs.length,2);
  assert.equal(content.slice(paragraphs[0].start,paragraphs[0].end),paragraphs[0].text);
  assert.equal(paragraphs[0].sentences.length,2);
  assert.equal(paragraphs[0].sentences[1].text,'第一段第二句！');
  const windows=createParagraphWindows(paragraphs,{maxChars:15,maxParagraphs:2,overlap:1});
  assert.equal(windows.length,2);
  assert.equal(windows[1].paragraphs[0].paragraphId,paragraphs[1].paragraphId);
});

test('前端句级切分保留UTF-16原文区间且不误切小数和常见缩写',()=>{
  const content='  第一段是3.14，不应拆开。第二句很长但保持完整！\nDr. Smith arrived. 最后一段没有句号  ';
  const segments=splitAiSentences(content,{prefix:'case'});
  assert.deepEqual(segments.map(item=>item.text),['第一段是3.14，不应拆开。','第二句很长但保持完整！','Dr. Smith arrived.','最后一段没有句号']);
  assert.ok(segments.every(item=>content.slice(item.start,item.end)===item.text));
  assert.deepEqual(segments.map(item=>item.sentenceIndex),[1,2,3,4]);
});

test('超长句优先按软标点切分且每段满足20到100字符要求',()=>{
  const punctuated='甲'.repeat(55)+'，'+'乙'.repeat(55)+'；'+'丙'.repeat(55)+'。';
  const segments=splitAiSentences(punctuated,{prefix:'long'});
  assert.deepEqual(segments.map(item=>item.text.at(-1)),['，','；','。']);
  assert.ok(segments.every(item=>[...item.text.trim()].length>=20&&[...item.text.trim()].length<=100));
  assert.ok(segments.every(item=>punctuated.slice(item.start,item.end)===item.text));
  assert.deepEqual(segments.map(item=>item.sentenceIndex),[1,2,3]);

  const withoutPunctuation='😀'.repeat(105)+'。';
  const hardSplit=splitAiSentences(withoutPunctuation,{prefix:'hard'});
  assert.equal(hardSplit.length,2);
  assert.ok(hardSplit.every(item=>[...item.text].length>=20&&[...item.text].length<=100));
  assert.equal(hardSplit.map(item=>item.text).join(''),withoutPunctuation);
  assert.ok(hardSplit.every(item=>withoutPunctuation.slice(item.start,item.end)===item.text));
});

test('算法短句只与同段相邻句合并且单个片段最多两句',()=>{
  const content='太好了！这是一句长度足够用于算法评分并且应与前句合并的正文。\n另起一段。段内第二句用于合并。段内第三句不会被塞入同一片段。';
  const segments=createAiScoringSegments(content,{prefix:'merge'});
  assert.deepEqual(segments.map(item=>item.sentenceIndexes),[[1,2],[3,4],[5]]);
  assert.equal(segments[0].merged,true);
  assert.equal(segments[0].sentenceCount,2);
  assert.ok(segments.every(item=>content.slice(item.start,item.end)===item.text));
  assert.ok(segments.every(item=>item.sentenceIndexes.length<=2));
  assert.notEqual(segments[0].paragraphIndex,segments[1].paragraphIndex);
});

test('20至29字短句可与相邻单句短段合并且30字片段保持独立',()=>{
  const first='不如趁早放弃，也算是对自己的一种善良。”';
  const second='“竖子无礼，敢如此与我慕容家少主说话。”';
  const third='这一段正文已经达到三十个有效字符，因此不需要为了凑目标长度再和其他段落合并。';
  const content=`${first}\n${second}\n${third}`;
  const segments=createAiScoringSegments(content,{prefix:'short-dialogue',mergeSingleSentenceParagraphs:true});
  assert.deepEqual(segments.map(item=>item.sentenceIndexes),[[1,2],[3]]);
  assert.deepEqual(segments[0].paragraphIndexes,[1,2]);
  assert.equal(segments[0].text,`${first}\n${second}`);
  assert.deepEqual(segments[1].paragraphIndexes,[3]);
  assert.ok([...segments[1].text.replace(/\s/gu,'')].length>=30);
});

test('小说服务端接受相邻单句短段合并并保留两个段落编号',async()=>{
  const content='不如趁早放弃，也算是对自己的一种善良。”\n“竖子无礼，敢如此与我慕容家少主说话。”';
  const aiSegments=createAiScoringSegments(content,{prefix:'novel-short',mergeSingleSentenceParagraphs:true});
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:42,aiScore:0.21,predictedLabel:0}))};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'短段合并'},chapters:[{localId:'c1',title:'第一章',content,aiSegments}],checks:['ai-risk']},{egteClient});
  assert.equal(result.aiRisk.findings.length,1);
  assert.deepEqual(result.aiRisk.findings[0].paragraphIndexes,[1,2]);
  assert.deepEqual(result.aiRisk.paragraphScores[0].paragraphIndexes,[1,2]);
  assert.equal(result.aiRisk.paragraphScores[0].paragraphStart,1);
  assert.equal(result.aiRisk.paragraphScores[0].paragraphEnd,2);
  assert.equal(result.aiRisk.findings[0].text,content);
  assert.match(result.aiRisk.notice,/不能归因到其中某一句或某一段/);
});

test('合并片段得分保留两句范围且不冒充单句结论',async()=>{
  const content='短句。这是一句长度足够用于合并评分并验证整体片段语义的新闻文本。';
  const aiSegments=createAiScoringSegments(content,{prefix:'news-s'});
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:24,aiScore:0.72,predictedLabel:1}))};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'短句合并测试',content,aiSegments},checks:['ai-risk']},{egteClient});
  assert.deepEqual(result.aiRisk.findings[0].sentenceIndexes,[1,2]);
  assert.equal(result.aiRisk.findings[0].merged,true);
  assert.match(result.aiRisk.summary,/共 2 句，组成 1 个检测片段/);
  assert.match(result.aiRisk.notice,/得分属于整体片段/);
});

test('两句合并后仍过短时保持无法评分且服务端拒绝跨多句段落合并',async()=>{
  const content='短句。再短句。';
  const aiSegments=createAiScoringSegments(content,{prefix:'news-s'});
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'too-short',reason:'少于20个字符',documentTokens:null,aiScore:null,predictedLabel:null}))};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'仍然过短',content,aiSegments},checks:['ai-risk']},{egteClient});
  assert.equal(result.aiRisk.findings[0].labelZh,'无法评分');
  assert.match(result.aiRisk.findings[0].reason,/相邻两句合并后仍少于20个字符/);

  const paragraphs='第一段短句。\n第二段第一句内容足够长，但不能跨入这个含有多句的段落。第二段还有一句。';
  const source=splitAiSentences(paragraphs,{prefix:'raw'});
  const crossParagraph=[{segmentId:'bad-1',sentenceIndex:1,sentenceIndexes:[1,2],sentenceCount:2,merged:true,paragraphIndex:1,start:source[0].start,end:source[1].end,text:paragraphs.slice(source[0].start,source[1].end)}];
  await assert.rejects(()=>runTextScenario(novelScenario,{action:'analyze',work:{title:'跨段伪造'},chapters:[{localId:'bad-c1',title:'第一章',content:paragraphs,aiSegments:crossParagraph}],checks:['ai-risk']},{egteClient}),error=>error.code==='INVALID_AI_SEGMENTS'&&/单句短段/.test(error.message));
});

test('新闻句级AI检测校验原文位置并逐句返回真实算法结果',async()=>{
  const content='这是一句长度足够且需要执行AI检测的新闻文本。短句。';
  const aiSegments=splitAiSentences(content,{prefix:'news-s'});
  const egteClient={analyze:async({classifier,segments})=>{
    assert.equal(classifier,'cred');
    assert.equal(segments.length,2);
    return [
      {segmentId:segments[0].segmentId,status:'success',documentTokens:18,aiScore:0.81,predictedLabel:1},
      {segmentId:segments[1].segmentId,status:'too-short',reason:'少于20个字符',documentTokens:null,aiScore:null,predictedLabel:null},
    ];
  }};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'句级测试',content,language:'zh',source:{completeness:'partial'},aiSegments},checks:['ai-risk']},{egteClient});
  assert.equal(result.status,'completed');
  assert.deepEqual(result.incompleteServices,[]);
  assert.equal(result.aiRisk.status,'partial');
  assert.equal(result.coverage.complete,false);
  assert.match(result.aiRisk.summary,/无法评分 1 个/);
  assert.match(resultCompletionDetails(result),/检测已完成.*仅检测已导入内容/);
  assert.equal(result.aiRisk.findings[0].labelZh,'AI');
  assert.equal(result.aiRisk.findings[0].text,aiSegments[0].text);
  assert.equal(result.aiRisk.findings[1].labelZh,'无法评分');
  assert.match(result.aiRisk.notice,/不是确定概率/);
  const tampered=aiSegments.map(item=>({...item}));tampered[0].text='被篡改';
  await assert.rejects(()=>runTextScenario(newsScenario,{action:'analyze',material:{title:'句级测试',content,aiSegments:tampered},checks:['ai-risk']},{egteClient}),error=>error.code==='INVALID_AI_SEGMENTS');
});

test('新闻仅选择AI时可由服务端从正文生成缺失的句级片段',async()=>{
  const content='这是第一段用于验证服务端自动生成句级片段的新闻正文内容。\n这是第二段用于确认仅选择AI时不会因前端缺少派生字段而失败的正文。';
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:24,aiScore:0.12,predictedLabel:0}))};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'自动分段测试',content},checks:['ai-risk']},{egteClient});
  assert.equal(result.status,'completed');
  assert.equal(result.aiRisk.findings.length,2);
  assert.ok(result.aiRisk.findings.every(item=>item.paragraphIndexes.length===1));
  assert.equal(result.aiRisk.findings.every(item=>item.status==='success'),true);
});

test('AI类得分使用百分比展示但不冒充概率',()=>{
  assert.equal(formatAiClassScore(0.7135),'71.35%');
  assert.equal(formatAiClassScore(2),'100.00%');
  assert.equal(formatAiClassScore(undefined),'');
});

test('仅在服务确实未执行时标记部分完成并列出缺项原因',async()=>{
  const modelClient={analyze:async()=>({findings:[]})};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'状态测试',content:'这里是一段用于审校的新闻正文。'},checks:['proofreading','future-check']},{modelClient});
  assert.equal(result.status,'partial');
  assert.deepEqual(result.incompleteServices,[{id:'future-check',label:'future-check',reason:'当前版本不支持该检测项目，因此未执行。'}]);
  assert.match(resultCompletionDetails(result),/未完成：future-check.*当前版本不支持/);
});

test('句级结果可在全部与仅疑似AI之间筛选',()=>{
  const findings=[
    {segmentId:'s-1',status:'success',isAiGenerated:true,predictedLabel:1},
    {segmentId:'s-2',status:'success',isAiGenerated:false,predictedLabel:0},
    {segmentId:'s-3',status:'too-short',isAiGenerated:null,predictedLabel:null},
  ];
  assert.equal(filterAiSentenceFindings(findings,'all').length,3);
  assert.deepEqual(filterAiSentenceFindings(findings,'suspected').map(item=>item.segmentId),['s-1']);
  assert.equal(filterAiSentenceFindings(undefined,'suspected').length,0);
});

test('AI PDF报告使用全文多色构成条且展开全部关注片段',()=>{
  const fragments=Array.from({length:30},(_,index)=>({fragmentId:`f-${index}`,paragraphStart:index+1,paragraphEnd:index+1,start:index*10,end:index*10+8,text:index===0?'<script>不可执行</script>':`疑似片段${index+1}`,score:0.99-index/100,label:index<8?'ai':'suspected-ai',labelZh:index<8?'AI':'疑似AI'}));
  const findings=Array.from({length:100},(_,index)=>({status:'success',label:'human',text:`普通人工片段${index+1}`}));
  const aiRisk={fragments,findings,paragraphScores:fragments.map((item,index)=>({...item,paragraphIndex:index+1,characterCount:8})),documentScore:{score:0.73,modelVersions:['egte-test'],thresholds:{humanMax:0.5,aiMin:0.8,dominanceMin:0.6}},distribution:{characters:{human:700,suspectedAi:180,ai:90,unscored:30},ratios:{human:700/970,suspectedAi:180/970,ai:90/970},scoredCharacters:970,totalCharacters:1000,composition:'人工为主'},notice:'未校准分数'};
  assert.deepEqual(selectAiReportItems(aiRisk,24).items.length,24);
  assert.equal(selectAiReportItems(aiRisk,24).omitted,6);
  assert.equal(selectAiReportItems(aiRisk).items.length,30);
  assert.equal(selectAiReportItems(aiRisk).omitted,0);
  const html=buildAiPdfReport({scenario:'news',title:'<测试稿>',version:2,result:{status:'completed',contentHash:'0123456789abcdef0123456789abcdef',aiRisk,coverage:{paragraphs:30,windows:2,notice:'仅检测已导入内容。'}},generatedAt:new Date('2026-10-31T08:00:00Z')});
  assert.match(html,/AI内容分析报告/);
  assert.match(html,/报告编号/);
  assert.match(html,/NWS-20261031-0123456789/);
  assert.match(html,/AI相关字符占比/);
  assert.match(html,/可评分覆盖率/);
  assert.match(html,/模型、阈值与解读/);
  assert.match(html,/conic-gradient/);
  assert.match(html,/全文整体构成/);
  assert.match(html,/class="composition-bar"/);
  assert.match(html,/全部展开AI、疑似AI及无法评分片段/);
  assert.doesNotMatch(html,/高关注段落|另有 \d+ 个关注片段未展开|最多展示 12 项/);
  assert.match(html,/疑似片段30/);
  assert.doesNotMatch(html,/无法评分 · 0\.00%/);
  assert.match(html,/&lt;script&gt;不可执行&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>不可执行<\/script>/);
  assert.doesNotMatch(html,/普通人工片段100/);
});

test('另一功能PDF按新闻三审三校和小说水稿分别排版',()=>{
  const stages=['初审','复审','终审','一校','二校','三校'].map((name,index)=>({name,objective:`${name}目标`,checks:[`${name}检查项`],summary:`${name}已完成`,findingCount:index===0?1:0,issues:index===0?[{location:'第1段',type:'wording',severity:'warning',message:'表述需调整',suggestion:'修改表述',originalText:'问题原文'}]:[]}));
  const news=buildSecondaryPdfReport({scenario:'news',title:'新闻稿',result:{contentHash:'abcdef0123456789',proofreading:{summary:'六阶段完成',stages},coverage:{paragraphs:2,windows:1}},generatedAt:new Date('2026-10-31T08:00:00Z')});
  assert.match(news,/三审三校报告/);
  assert.match(news,/问题分类与处理优先级/);
  assert.match(news,/高优先级/);
  assert.match(news,/六阶段执行概览/);
  assert.match(news,/初审 · 做了什么与发现了什么/);
  assert.match(news,/问题原文/);
  const novel=buildSecondaryPdfReport({scenario:'novel',title:'小说',result:{contentHash:'1234567890abcdef',quality:{summary:'发现1条',findings:[{chapter:'第一章',location:'第2段',type:'padding',severity:'warning',message:'内容空泛',originalText:'水稿原文'}]},coverage:{chapters:1,paragraphs:3,windows:1,crossChapter:'not-available'}},generatedAt:new Date('2026-10-31T08:00:00Z')});
  assert.match(novel,/重复与水稿检测报告/);
  assert.match(novel,/内容空泛/);
  assert.match(novel,/跨章对照/);
  assert.match(novel,/水稿原文/);
  assert.doesNotMatch(novel,/\{"quality"/);
});

test('文本报告编号由场景、上海日期和内容指纹组成',()=>{
  assert.deepEqual(textReportIdentity({scenario:'novel',result:{contentHash:'aa11bb22cc33dd44ee55'},generatedAt:new Date('2026-11-07T01:00:00Z')}),{
    reportId:'NVL-20261107-AA11BB22CC',
    fingerprint:'AA11BB22CC33…DD44EE55',
  });
});

test('文本PDF直接下载文件名由标题和检测报告类型组成',()=>{
  assert.equal(textReportFileName({title:'新闻标题',kind:'ai',scenario:'news'}),'新闻标题-AI检测报告.pdf');
  assert.equal(textReportFileName({title:'作品/名称',kind:'secondary',scenario:'novel'}),'作品_名称-重复与水稿检测报告.pdf');
  assert.equal(textReportFileName({title:'稿件标题',kind:'secondary',scenario:'news'}),'稿件标题-三审三校检测报告.pdf');
});

test('小说句级AI检测保留章节归属且可与水稿检测同时执行',async()=>{
  const content='这是一句长度足够且需要执行AI检测的小说章节文本。';
  const aiSegments=splitAiSentences(content,{prefix:'c1-s'});
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:20,aiScore:0.2,predictedLabel:0}))};
  const modelClient={analyze:async()=>({findings:[]})};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[{localId:'c1',title:'第一章',content,platform:'fanqie',aiSegments}],checks:['ai-risk','padding']},{egteClient,modelClient});
  assert.equal(result.aiRisk.findings[0].chapterId,'c1');
  assert.equal(result.aiRisk.findings[0].labelZh,'人工');
  assert.equal(result.aiRisk.platformPolicies.length,1);
  assert.equal(result.aiRisk.chapterResults.length,1);
  assert.equal(result.aiRisk.chapterResults[0].chapterId,'c1');
  assert.equal(result.aiRisk.platformPolicies[0].platformId,'fanqie');
  assert.equal(result.aiRisk.platformPolicies[0].aiSpecific,true);
  assert.match(result.aiRisk.platformPolicies[0].url,/\/writer\/zone\/article\/7642544663915675672$/);
  assert.equal(result.quality.findings.length,0);
  assert.equal(result.quality.platformPolicies[0].aiSpecific,false);
  assert.match(result.quality.platformPolicies[0].url,/\/writer\/zone\/article\/7237084151751376957$/);
  assert.notDeepEqual(result.quality.platformPolicies,result.aiRisk.platformPolicies);
});

test('小说检测已执行完成时顶层状态为完成，覆盖不足保留在明细中',async()=>{
  const content='短句。';
  const aiSegments=createAiScoringSegments(content,{prefix:'c1-s'});
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'too-short',reason:'少于20个字符',documentTokens:null,aiScore:null,predictedLabel:null}))};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[{localId:'c1',title:'第一章',content,platform:'ciweimao',source:{completeness:'partial'},aiSegments}],checks:['ai-risk']},{egteClient});
  assert.equal(result.status,'completed');
  assert.equal(result.aiRisk.status,'partial');
  assert.equal(result.aiRisk.distribution.composition,'无法判定');
  assert.match(result.aiRisk.summary,/全文无法判定/);
  assert.equal(result.coverage.complete,false);
  assert.match(result.coverage.notice,/仅检测已导入内容/);
});

test('小说仅选择AI时可由服务端为各章节生成缺失的句级片段',async()=>{
  const chapters=[
    {localId:'c1',title:'第一章',content:'第一章正文用于确认小说仅AI检测能够由服务端自动生成句级片段并正常评分。'},
    {localId:'c2',title:'第二章',content:'第二章正文继续验证多个章节都不依赖浏览器提交派生的句级片段数组。'},
  ];
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:24,aiScore:0.18,predictedLabel:0}))};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'自动分段作品'},chapters,checks:['ai-risk']},{egteClient});
  assert.equal(result.status,'completed');
  assert.equal(result.aiRisk.findings.length,2);
  assert.deepEqual(result.aiRisk.findings.map(item=>item.chapter),['第一章','第二章']);
  assert.deepEqual(result.aiRisk.chapterResults.map(item=>item.chapterId),['c1','c2']);
  assert.ok(result.aiRisk.chapterResults.every(item=>item.findings.length===1));
});

test('句级结果按字数聚合片段、段落、全文分数和内容占比',async()=>{
  const content='第一句内容足够长，用于验证人工标签和加权统计。第二句内容同样足够长，用于验证疑似AI标签和统计。第三句内容也足够长，用于验证明确AI标签和统计。';
  const aiSegments=createAiScoringSegments(content,{prefix:'news-s',targetChars:20});
  const scores=[0.2,0.5,0.8];
  const egteClient={
    modelVersion:'egte-test-v2',
    thresholds:{humanMax:0.5,aiMin:0.8,dominanceMin:0.6},
    analyze:async({segments})=>segments.map((item,index)=>({segmentId:item.segmentId,status:'success',documentTokens:20,aiScore:scores[index],predictedLabel:scores[index]>=0.5?1:0})),
  };
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'聚合测试',content,aiSegments},checks:['ai-risk']},{egteClient});
  const risk=result.aiRisk;
  assert.deepEqual(risk.findings.map(item=>item.labelZh),['人工','疑似AI','AI']);
  const lengths=risk.findings.map(item=>item.characterCount);
  const expectedScore=scores.reduce((sum,score,index)=>sum+score*lengths[index],0)/lengths.reduce((sum,length)=>sum+length,0);
  assert.equal(risk.documentScore.score,expectedScore);
  assert.equal(risk.paragraphScores.length,1);
  assert.equal(risk.paragraphScores[0].score,expectedScore);
  assert.equal(risk.fragments.length,1);
  assert.deepEqual(risk.fragments[0].sentenceIndexes,[2,3]);
  assert.equal(risk.fragments[0].text,content.slice(risk.fragments[0].start,risk.fragments[0].end));
  assert.equal(risk.fragments[0].modelVersion,'egte-test-v2');
  assert.deepEqual(risk.fragments[0].thresholds,{humanMax:0.5,aiMin:0.8,dominanceMin:0.6});
  assert.equal(risk.distribution.characters.human,lengths[0]);
  assert.equal(risk.distribution.characters.suspectedAi,lengths[1]);
  assert.equal(risk.distribution.characters.ai,lengths[2]);
  assert.equal(risk.distribution.composition,'AI为主');
});

test('疑似片段不跨小说章节合并且保留各章原文位置',async()=>{
  const chapters=[
    {localId:'c1',title:'第一章',content:'第一章包含一条长度足够的疑似人工智能生成内容。'},
    {localId:'c2',title:'第二章',content:'第二章也包含一条长度足够的疑似人工智能生成内容。'},
  ].map(chapter=>({...chapter,aiSegments:createAiScoringSegments(chapter.content,{prefix:`${chapter.localId}-s`})}));
  const egteClient={modelVersion:'egte-test-v2',analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:20,aiScore:0.55,predictedLabel:1}))};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'分章聚合测试'},chapters,checks:['ai-risk']},{egteClient});
  assert.equal(result.aiRisk.fragments.length,2);
  assert.deepEqual(result.aiRisk.fragments.map(item=>item.chapterId),['c1','c2']);
  assert.ok(result.aiRisk.fragments.every(item=>item.start===0));
  assert.deepEqual(result.aiRisk.fragments.map(item=>item.text),chapters.map(item=>item.content));
});

test('EGTE客户端通过服务器本机8011端口提交批量检测请求',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url:String(url),options,request});
    return new Response(JSON.stringify({data:{results:request.segments.map(item=>({segment_id:item.segmentId,status:'success',ai_score:0.4,predicted_label:0,document_tokens:12}))}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8011',EGTE_API_KEY:'server-secret',EGTE_TIMEOUT_MS:'1000',EGTE_MODEL_VERSION:'egte-unit-v3',EGTE_HUMAN_MAX_SCORE:'0.25',EGTE_AI_MIN_SCORE:'0.75',EGTE_DOMINANCE_MIN_RATIO:'0.7'},fetchImpl});
  const first=await client.analyze({classifier:'cred',segments:[{segmentId:'s-1',text:'足够长的测试文本内容'}]});
  const second=await client.analyze({classifier:'cred',segments:[{segmentId:'s-2',text:'另一句足够长的测试文本'}]});
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,'http://127.0.0.1:8011/');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.headers.Authorization,'Bearer server-secret');
  assert.deepEqual(calls[0].request,{classifier:'cred',segments:[{segmentId:'s-1',text:'足够长的测试文本内容'}]});
  assert.equal(client.modelVersion,'egte-unit-v3');
  assert.deepEqual(client.thresholds,{humanMax:0.25,aiMin:0.75,dominanceMin:0.7});
  assert.equal(first[0].segmentId,'s-1');
  assert.equal(second[0].predictedLabel,0);
  client.close();
});

test('EGTE客户端适配8012文本批量接口并按顺序恢复片段ID',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const request=JSON.parse(options.body);calls.push({url:String(url),request});
    return new Response(JSON.stringify({data:{results:request.texts.map((text,index)=>({classifier:'cred',predicted_label:index,ai_score:index?0.82:0.18,document_tokens:text.length}))}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch'},fetchImpl});
  const segments=[{segmentId:'batch-1',text:'第一段用于批量推理并且字符数量已经超过二十个字符的测试文本。'},{segmentId:'batch-2',text:'第二段用于批量推理并且字符数量已经超过二十个字符的测试文本。'}];
  const results=await client.analyze({classifier:'cred',segments});
  assert.deepEqual(calls,[{url:'http://127.0.0.1:8012/api/v1/infer/batch',request:{classifier:'cred',texts:segments.map(item=>item.text)}}]);
  assert.deepEqual(results.map(item=>item.segmentId),['batch-1','batch-2']);
  assert.deepEqual(results.map(item=>item.predictedLabel),[0,1]);
});

test('EGTE客户端将超过8012上限的片段按顺序分批并合并结果',async()=>{
  const batches=[];
  const fetchImpl=async(_url,options)=>{
    const request=JSON.parse(options.body);batches.push(request.texts);
    return new Response(JSON.stringify({data:{results:request.texts.map((_text,index)=>({predicted_label:0,ai_score:0.1+index/1000,document_tokens:20}))}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch',EGTE_BATCH_SIZE:'2'},fetchImpl});
  const segments=Array.from({length:5},(_value,index)=>({segmentId:`batch-${index+1}`,text:`第${index+1}段用于批量推理并且字符数量已经超过二十个字符的测试文本。`}));
  const results=await client.analyze({classifier:'cred',segments});
  assert.deepEqual(batches.map(batch=>batch.length),[2,2,1]);
  assert.deepEqual(results.map(item=>item.segmentId),segments.map(item=>item.segmentId));
});

test('EGTE客户端不向8012发送过短片段且保留原始结果顺序',async()=>{
  const submitted=[];
  const fetchImpl=async(_url,options)=>{
    const request=JSON.parse(options.body);submitted.push(...request.texts);
    return new Response(JSON.stringify({data:{results:request.texts.map(()=>({predicted_label:0,ai_score:0.16,document_tokens:24}))}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch'},fetchImpl});
  const segments=[
    {segmentId:'short-1',text:'短句。'},
    {segmentId:'long-1',text:'这是一段字符数量已经超过二十个字符的中文检测文本。'},
    {segmentId:'short-2',text:'  仍然短。  '},
  ];
  const results=await client.analyze({classifier:'cred',segments});
  assert.deepEqual(submitted,[segments[1].text]);
  assert.deepEqual(results.map(item=>item.segmentId),['short-1','long-1','short-2']);
  assert.deepEqual(results.map(item=>item.status),['too-short','success','too-short']);
  assert.match(results[0].reason,/少于20个字符/);
});

test('EGTE客户端隔离被算法拒绝的异常片段并继续评分其余片段',async()=>{
  const batches=[];
  const fetchImpl=async(_url,options)=>{
    const request=JSON.parse(options.body);batches.push(request.texts);
    if(request.texts.some(text=>text.includes('异常片段')))return new Response('',{status:422});
    return new Response(JSON.stringify({data:{results:request.texts.map(text=>({predicted_label:0,ai_score:0.12,document_tokens:text.length}))}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch'},fetchImpl});
  const segments=[
    {segmentId:'safe-1',text:'第一段是能够被算法正常处理并返回结果的中文测试文本。'},
    {segmentId:'broken-1',text:'这一段包含异常片段标记并模拟算法内部拒绝该输入的情况。'},
    {segmentId:'safe-2',text:'第三段也能够被算法正常处理并保留原始结果顺序。'},
  ];
  const results=await client.analyze({classifier:'cred',segments});
  assert.deepEqual(results.map(item=>item.segmentId),segments.map(item=>item.segmentId));
  assert.deepEqual(results.map(item=>item.status),['success','failed','success']);
  assert.match(results[1].reason,/已隔离处理/);
  assert.ok(batches.length>1);
  assert.deepEqual(batches[0],segments.map(item=>item.text));
});

test('EGTE客户端不把服务不可用误判为单个异常片段',async()=>{
  let requests=0;
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch'},fetchImpl:async()=>{requests+=1;return new Response('',{status:503});}});
  await assert.rejects(()=>client.analyze({classifier:'cred',segments:[
    {segmentId:'service-1',text:'用于验证算法服务不可用时仍然明确失败的第一段测试文本。'},
    {segmentId:'service-2',text:'用于验证算法服务不可用时不会错误隔离的第二段测试文本。'},
  ]}),error=>error.code==='AI_DETECTOR_UNAVAILABLE');
  assert.equal(requests,1);
});

test('EGTE客户端限制跨批次持续422响应的异常片段隔离请求总数',async()=>{
  let requests=0;
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch',EGTE_ISOLATION_MAX_REQUESTS:'4',EGTE_BATCH_SIZE:'2'},fetchImpl:async()=>{requests+=1;return new Response('',{status:422});}});
  const segments=Array.from({length:6},(_value,index)=>({segmentId:`failed-${index+1}`,text:`第${index+1}段用于验证连续拒绝时停止递归隔离并报告服务异常。`}));
  await assert.rejects(()=>client.analyze({classifier:'cred',segments}),error=>error.code==='AI_DETECTOR_UNAVAILABLE'&&/停止异常片段隔离/.test(error.message));
  assert.equal(requests,4);
});

test('EGTE客户端隔离稳定触发500的单个片段并保留其余评分',async()=>{
  const fetchImpl=async(_url,options)=>{
    const request=JSON.parse(options.body);
    if(request.texts.some(text=>text.includes('内部异常')))return new Response('',{status:500});
    return new Response(JSON.stringify({data:{results:request.texts.map(text=>({predicted_label:0,ai_score:0.14,document_tokens:text.length}))}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch'},fetchImpl});
  const segments=[
    {segmentId:'safe-500-1',text:'第一段可以被算法正常评分并用于验证内部错误隔离。'},
    {segmentId:'broken-500',text:'这一段稳定触发算法内部异常但不应拖垮其他片段。'},
    {segmentId:'safe-500-2',text:'第三段也可以被算法正常评分并保持原始结果顺序。'},
  ];
  const results=await client.analyze({classifier:'cred',segments});
  assert.deepEqual(results.map(item=>item.status),['success','failed','success']);
  assert.match(results[1].reason,/内部错误.*隔离处理/);
});

test('EGTE客户端将持续全量500保持为整体服务失败',async()=>{
  let requests=0;
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch'},fetchImpl:async()=>{requests+=1;return new Response('',{status:500});}});
  await assert.rejects(()=>client.analyze({classifier:'cred',segments:[
    {segmentId:'server-1',text:'用于验证算法内部错误不会被伪装成单片段失败的测试文本。'},
    {segmentId:'server-2',text:'第二段同样应随整体服务失败返回而不是递归隔离。'},
  ]}),error=>error.code==='AI_DETECTOR_UNAVAILABLE');
  assert.equal(requests,3);
});

test('新闻和小说只在送入AI算法前统一清除危险字符且保留展示原文',async()=>{
  const risky='他看见门外站着一个陌生人\u0000，身影被雨幕遮住\u200B，衣角带着异常字形\uE521和损坏符号�，但手机里的表情😀仍然正常显示。';
  const direct=sanitizeNewsNovelAiText(`正常😀\uD800ＡＩ\uFE0F\u{E007F}${risky}`);
  assert.match(direct.text,/正常😀/u);
  assert.match(direct.text,/AI/u);
  assert.doesNotMatch(direct.text,/[\u0000\u200B\uE521\uFFFD\uD800\uFE0F\u{E007F}]/u);
  const submitted=[];
  const egteClient={analyze:async({segments})=>{submitted.push(...segments.map(item=>item.text));return segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:40,aiScore:0.2,predictedLabel:0}));}};
  const news=await runTextScenario(newsScenario,{action:'analyze',material:{title:'清洗测试',content:risky,aiSegments:createAiScoringSegments(risky,{prefix:'news-s'})},checks:['ai-risk']},{egteClient});
  const novel=await runTextScenario(novelScenario,{action:'analyze',work:{title:'清洗测试'},chapters:[{localId:'1',title:'第一章',content:risky,platform:'zongheng',aiSegments:createAiScoringSegments(risky,{prefix:'c1-s'})}],checks:['ai-risk']},{egteClient});
  assert.equal(submitted.length,2);
  assert.ok(submitted.every(text=>!/[\u0000\u200B\uE521\uFFFD]/u.test(text)));
  assert.ok(submitted.every(text=>text.includes('😀')));
  assert.equal(news.aiRisk.findings[0].text,risky);
  assert.equal(novel.aiRisk.findings[0].text,risky);
  assert.equal(news.aiRisk.findings[0].inputSanitization.removedCharacters,4);
  assert.equal(novel.aiRisk.findings[0].inputSanitization.categories['private-use'],1);
  assert.match(news.aiRisk.notice,/展示原文及位置未改变/);
});

test('EGTE客户端拒绝数量不一致的无ID批量结果',async()=>{
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8012/api/v1/infer/batch'},fetchImpl:async()=>new Response(JSON.stringify({data:{results:[]}}),{status:200,headers:{'Content-Type':'application/json'}})});
  await assert.rejects(()=>client.analyze({classifier:'cred',segments:[{segmentId:'batch-1',text:'这是一段用于验证返回数量并且字符数量已经超过二十个字符的测试文本。'}]}),error=>error.code==='AI_DETECTOR_UNAVAILABLE'&&/数量不一致/.test(error.message));
});

test('EGTE HTTP客户端拒绝不安全远程地址且不回显上游响应',async()=>{
  assert.throws(()=>new EgteClient({env:{EGTE_API_URL:'http://model.example/predict'}}),error=>error.code==='AI_DETECTOR_UNAVAILABLE');
  const client=new EgteClient({env:{EGTE_API_URL:'http://127.0.0.1:8011'},fetchImpl:async()=>new Response('secret upstream details',{status:500})});
  await assert.rejects(()=>client.analyze({classifier:'cred',segments:[{segmentId:'s-1',text:'测试文本'}]}),error=>error.code==='AI_DETECTOR_UNAVAILABLE'&&!error.message.includes('secret upstream details'));
});

test('新闻三审三校只接受能回指原文的段落级问题',async()=>{
  const audit=[];
  const stageCalls=[];
  const modelClient={analyze:async({payload})=>{stageCalls.push(payload.reviewStage);return({findings:[
    {paragraphId:payload.paragraphs[0].paragraphId,quote:'用词不当',type:'wording',severity:'warning',message:'表述不够准确。',suggestion:'改为准确表述。',confidence:0.9},
    {paragraphId:payload.paragraphs[0].paragraphId,quote:'原文不存在',type:'hallucination',message:'该条应被丢弃。'},
  ]})}};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'测试稿',content:'第一段存在用词不当的问题。\n第二段内容正常。'},checks:['proofreading']},{requestId:'test',modelClient,logger:{warn:value=>audit.push(JSON.parse(value))}});
  assert.equal(result.status,'completed');
  assert.equal(result.proofreading.issues.length,1);
  assert.equal(result.proofreading.summary,'三审三校 6 个阶段均已完成，共发现 1 条去重后的需复核问题。');
  assert.deepEqual(stageCalls.map(item=>item.name),['初审','复审','终审','一校','二校','三校']);
  assert.equal(result.proofreading.completedStages,6);
  assert.equal(result.proofreading.totalStages,6);
  assert.equal(result.proofreading.stages.length,6);
  assert.ok(result.proofreading.stages.every(stage=>stage.status==='completed'&&stage.findingCount===1&&stage.issues.length===1));
  assert.deepEqual(result.proofreading.issues[0].stages.map(item=>item.name),['初审','复审','终审','一校','二校','三校']);
  assert.equal('evidenceValidation' in result.proofreading,false);
  assert.doesNotMatch(JSON.stringify(result),/拒绝|无法准确回指|rejectedFindings/);
  assert.deepEqual(audit,[{event:'text_model_evidence_rejected',scenario:'news',requestId:'test',receivedFindings:12,acceptedFindings:6,rejectedFindings:6}]);
  assert.equal(result.proofreading.issues[0].position.paragraphId,'news-p-0001');
  assert.equal(result.proofreading.issues[0].position.quote,'用词不当');
  assert.equal(result.proofreading.issues[0].originalText,'用词不当');
  assert.equal(result.proofreading.issues[0].position.absoluteStart,5);
});

test('新闻模型问题全部无法定位时仅在服务端留痕',async()=>{
  const audit=[];
  const modelClient={analyze:async({payload})=>({findings:[
    {paragraphId:payload.paragraphs[0].paragraphId,quote:'模型改写后的引文',type:'wording',message:'模型认为这里存在问题。'},
  ]})};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'测试稿',content:'这里是待审校的原始新闻正文。'},checks:['proofreading']},{requestId:'news-all-rejected',modelClient,logger:{warn:value=>audit.push(JSON.parse(value))}});
  assert.equal(result.status,'completed');
  assert.equal(result.proofreading.issues.length,0);
  assert.equal(result.proofreading.summary,'三审三校 6 个阶段均已完成，未发现有明确原文证据的问题。');
  assert.equal(result.proofreading.stages.length,6);
  assert.ok(result.proofreading.stages.every(stage=>stage.findingCount===0&&stage.issues.length===0));
  assert.doesNotMatch(JSON.stringify(result),/拒绝|无法准确回指|rejectedFindings/);
  assert.deepEqual(audit,[{event:'text_model_evidence_rejected',scenario:'news',requestId:'news-all-rejected',receivedFindings:6,acceptedFindings:0,rejectedFindings:6}]);
});

test('小说水稿模型结果只展示有效原文并在服务端记录拒绝计数',async()=>{
  const audit=[];
  const content='他站在窗前，反复想着同一件没有推动情节也没有补充信息的事情，时间仿佛停住了。';
  const modelClient={analyze:async({payload})=>({findings:[
    {type:'padding',severity:'warning',message:'存在无效延宕。',evidence:[{paragraphId:payload.paragraphs[0].paragraphId,quote:'反复想着同一件没有推动情节也没有补充信息的事情'}]},
    {type:'padding',severity:'warning',message:'该条引文被模型改写。',evidence:[{paragraphId:payload.paragraphs[0].paragraphId,quote:'反复思考同一件没有推动情节的事情'}]},
  ]})};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[{localId:'1',title:'第一章',content}],checks:['padding']},{requestId:'novel-partial-evidence',modelClient,logger:{warn:value=>audit.push(JSON.parse(value))}});
  assert.equal(result.status,'completed');
  assert.equal(result.quality.findings.length,1);
  assert.equal(result.quality.findings[0].type,'padding');
  assert.equal(result.quality.summary,'发现 1 条重复或水稿线索。');
  assert.doesNotMatch(JSON.stringify(result),/拒绝|无法准确回指|rejectedFindings/);
  assert.deepEqual(audit,[{event:'text_model_evidence_rejected',scenario:'novel',requestId:'novel-partial-evidence',receivedFindings:2,acceptedFindings:1,rejectedFindings:1}]);
});

test('小说模型问题全部无法定位时仅在服务端留痕',async()=>{
  const audit=[];
  const modelClient={analyze:async({payload})=>({findings:[
    {type:'padding',message:'可能存在水稿。',evidence:[{paragraphId:payload.paragraphs[0].paragraphId,quote:'原文中不存在的引文'}]},
  ]})};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[{localId:'1',title:'第一章',content:'这一段正文足够长，用于检查水稿结果的原文证据是否能够正确回查。'}],checks:['padding']},{requestId:'novel-all-rejected',modelClient,logger:{warn:value=>audit.push(JSON.parse(value))}});
  assert.equal(result.status,'completed');
  assert.equal(result.quality.findings.length,0);
  assert.equal(result.quality.summary,'本次检测未发现达到报告阈值的重复或水稿线索。');
  assert.doesNotMatch(JSON.stringify(result),/拒绝|无法准确回指|rejectedFindings/);
  assert.deepEqual(audit,[{event:'text_model_evidence_rejected',scenario:'novel',requestId:'novel-all-rejected',receivedFindings:1,acceptedFindings:0,rejectedFindings:1}]);
});

test('小说同次提交多章可发现跨章完全重复，单章状态不冒充跨章记忆',async()=>{
  const repeated='他站在雨中回想过去，这段内容在两个章节中完全相同。';
  const payloads=[];
  const modelClient={analyze:async({payload})=>{payloads.push(payload);return {findings:[]};}};
  const multiple=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[
    {localId:'1',title:'第一章',content:repeated},
    {localId:'2',title:'第二章',content:repeated},
  ],checks:['repetition','padding']},{modelClient});
  assert.equal(multiple.coverage.crossChapter,'same-request');
  assert.equal(multiple.quality.findings.length,1);
  assert.equal(multiple.quality.findings[0].references.length,2);
  assert.deepEqual(multiple.quality.chapterResults.map(item=>item.chapterId),['1','2']);
  assert.ok(multiple.quality.chapterResults.every(item=>item.findings.length===1));
  assert.ok(payloads[0].paragraphs.some(item=>item.chapterId==='1'));
  assert.ok(payloads[0].paragraphs.some(item=>item.chapterId==='2'));
  assert.deepEqual(payloads[0].chapters.map(item=>item.chapterId),['1','2']);
  const single=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[{localId:'1',title:'第一章',content:repeated}],checks:['padding']},{modelClient});
  assert.equal(single.coverage.crossChapter,'not-available');
  assert.match(single.coverage.notice,/未执行跨章比较/);
});

test('模型密钥只进入服务端授权头，上游失败不回显密钥或响应正文',async()=>{
  let authorization='';
  const secret='server-only-secret';
  const client=createTextModelClient({env:{TEXT_MODEL_API_URL:'https://model.example/v1/chat/completions',TEXT_MODEL_API_KEY:secret,TEXT_MODEL_NAME:'model'},fetchImpl:async(_url,options)=>{authorization=options.headers.Authorization;return new Response(`upstream leaked ${secret}`,{status:401});}});
  await assert.rejects(()=>client.analyze({task:'news_review',payload:{paragraphs:[]}}),error=>error.code==='MODEL_UPSTREAM_ERROR'&&!error.message.includes(secret));
  assert.equal(authorization,`Bearer ${secret}`);
});

test('DeepSeek provider 默认调用官方 Chat Completions 和 V4 Pro',async()=>{
  let capturedUrl='',capturedBody;
  const client=createTextModelClient({env:{TEXT_MODEL_PROVIDER:'deepseek',TEXT_MODEL_API_KEY:'test-secret'},fetchImpl:async(url,options)=>{
    capturedUrl=String(url);capturedBody=JSON.parse(options.body);
    return new Response(JSON.stringify({choices:[{message:{content:'{"findings":[]}'}}]}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  const result=await client.analyze({task:'news_review',payload:{paragraphs:[]}});
  assert.deepEqual(result,{findings:[]});
  assert.equal(capturedUrl,'https://api.deepseek.com/chat/completions');
  assert.equal(capturedBody.model,'deepseek-v4-pro');
  assert.deepEqual(capturedBody.thinking,{type:'enabled'});
  assert.equal(capturedBody.reasoning_effort,'high');
  assert.equal(capturedBody.max_tokens,8192);
  assert.equal(capturedBody.response_format.type,'json_object');
  assert.equal(capturedBody.stream,false);
});

test('DeepSeek JSON空内容自动提高上限重试且保持推理强度',async()=>{
  const calls=[],logs=[];
  const client=createTextModelClient({env:{TEXT_MODEL_PROVIDER:'deepseek',TEXT_MODEL_API_KEY:'test-secret',TEXT_MODEL_REASONING_EFFORT:'high',TEXT_MODEL_MAX_OUTPUT_TOKENS:'8192'},logger:{warn:value=>logs.push(JSON.parse(value))},fetchImpl:async(_url,options)=>{
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify(calls.length===1
      ? {choices:[{finish_reason:'stop',message:{content:'   '}}],usage:{completion_tokens:8192}}
      : {choices:[{finish_reason:'stop',message:{content:'{"findings":[]}'}}],usage:{completion_tokens:12}}),{status:200,headers:{'Content-Type':'application/json'}});
  }});
  assert.deepEqual(await client.analyze({task:'news_review',payload:{paragraphs:[]},requestId:'json-retry'}),{findings:[]});
  assert.equal(calls.length,2);
  assert.equal(calls[0].max_tokens,8192);
  assert.equal(calls[1].max_tokens,65536);
  assert.equal(calls[0].reasoning_effort,'high');
  assert.equal(calls[1].reasoning_effort,'high');
  assert.deepEqual(calls[1].thinking,{type:'enabled'});
  assert.match(calls[1].messages[0].content,/完整、可解析的JSON对象/);
  assert.deepEqual(logs,[{event:'text_model_response_retry',requestId:'json-retry',task:'news_review',attempt:1,reason:'blank-content',finishReason:'stop',contentLength:3,trimmedContentLength:0,completionTokens:8192,maxTokens:8192,reasoningEffort:'high'}]);
});

test('DeepSeek截断JSON重试后仍失败时返回明确错误且日志不含原文',async()=>{
  const logs=[];
  const privateText='不可进入日志的新闻原文';
  const client=createTextModelClient({env:{TEXT_MODEL_PROVIDER:'deepseek',TEXT_MODEL_API_KEY:'test-secret',TEXT_MODEL_REASONING_EFFORT:'max',TEXT_MODEL_MAX_OUTPUT_TOKENS:'4096'},logger:{warn:value=>logs.push(value)},fetchImpl:async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"findings":['}}],usage:{completion_tokens:4096}}),{status:200,headers:{'Content-Type':'application/json'}})});
  await assert.rejects(()=>client.analyze({task:'news_review',payload:{paragraphs:[{text:privateText}]},requestId:'json-length'}),error=>error.code==='MODEL_RESPONSE_INVALID'&&/长度上限/.test(error.message));
  assert.equal(logs.length,2);
  assert.ok(logs.every(value=>!value.includes(privateText)&&!value.includes('test-secret')));
  const retry=JSON.parse(logs[1]);
  assert.equal(retry.event,'text_model_response_failed');
  assert.equal(retry.reason,'length');
  assert.equal(retry.reasoningEffort,'max');
  assert.equal(retry.maxTokens,65536);
});

test('模型返回合法JSON但缺少findings数组时明确失败',async()=>{
  const client=createTextModelClient({env:{TEXT_MODEL_PROVIDER:'deepseek',TEXT_MODEL_API_KEY:'test-secret'},logger:{warn(){}},fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"summary":"没有问题"}'}}]}),{status:200,headers:{'Content-Type':'application/json'}})});
  await assert.rejects(()=>client.analyze({task:'news_review',payload:{paragraphs:[]}}),error=>error.status===502&&error.code==='MODEL_RESPONSE_INVALID');
});

test('缺少服务端模型配置时明确失败且不生成结果',async()=>{
  const client=createTextModelClient({env:{}});
  await assert.rejects(()=>client.analyze({task:'news_review',payload:{}}),error=>error.status===503&&error.code==='MODEL_NOT_CONFIGURED');
});

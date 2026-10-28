import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { scenarios } from '../src/catalog.js';
import { createTextModelClient } from '../src/modules/text/model-client.js';
import { runTextScenario } from '../src/modules/text/service.js';
import { createParagraphWindows, segmentText } from '../src/modules/text/segmentation.js';
import { createAiScoringSegments, splitAiSentences } from '../src/modules/text/ai-segmentation.js';
import { EgteClient } from '../src/modules/text/egte-client.js';
import { filterAiSentenceFindings, formatAiClassScore } from '../src/modules/text/result-render.js';

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

test('两句合并后仍过短时保持无法评分且服务端拒绝跨段合并',async()=>{
  const content='短句。再短句。';
  const aiSegments=createAiScoringSegments(content,{prefix:'news-s'});
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'too-short',reason:'少于20个字符',documentTokens:null,aiScore:null,predictedLabel:null}))};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'仍然过短',content,aiSegments},checks:['ai-risk']},{egteClient});
  assert.equal(result.aiRisk.findings[0].labelZh,'无法评分');
  assert.match(result.aiRisk.findings[0].reason,/相邻两句合并后仍少于20个字符/);

  const paragraphs='第一段短句。\n第二段内容足够长，但绝对不能与上一段短句组成同一个评分片段。';
  const source=splitAiSentences(paragraphs,{prefix:'raw'});
  const crossParagraph=[{segmentId:'bad-1',sentenceIndex:1,sentenceIndexes:[1,2],sentenceCount:2,merged:true,paragraphIndex:1,start:source[0].start,end:source[1].end,text:paragraphs.slice(source[0].start,source[1].end)}];
  await assert.rejects(()=>runTextScenario(newsScenario,{action:'analyze',material:{title:'跨段伪造',content:paragraphs,aiSegments:crossParagraph},checks:['ai-risk']},{egteClient}),error=>error.code==='INVALID_AI_SEGMENTS'&&/同一段落/.test(error.message));
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
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'句级测试',content,language:'zh',aiSegments},checks:['ai-risk']},{egteClient});
  assert.equal(result.status,'partial');
  assert.equal(result.aiRisk.findings[0].labelZh,'疑似AI');
  assert.equal(result.aiRisk.findings[0].text,aiSegments[0].text);
  assert.equal(result.aiRisk.findings[1].labelZh,'无法评分');
  assert.match(result.aiRisk.notice,/不是确定概率/);
  const tampered=aiSegments.map(item=>({...item}));tampered[0].text='被篡改';
  await assert.rejects(()=>runTextScenario(newsScenario,{action:'analyze',material:{title:'句级测试',content,aiSegments:tampered},checks:['ai-risk']},{egteClient}),error=>error.code==='INVALID_AI_SEGMENTS');
});

test('AI类得分使用百分比展示但不冒充概率',()=>{
  assert.equal(formatAiClassScore(0.7135),'71.35%');
  assert.equal(formatAiClassScore(2),'100.00%');
  assert.equal(formatAiClassScore(undefined),'');
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

test('小说句级AI检测保留章节归属且可与水稿检测同时执行',async()=>{
  const content='这是一句长度足够且需要执行AI检测的小说章节文本。';
  const aiSegments=splitAiSentences(content,{prefix:'c1-s'});
  const egteClient={analyze:async({segments})=>segments.map(item=>({segmentId:item.segmentId,status:'success',documentTokens:20,aiScore:0.2,predictedLabel:0}))};
  const modelClient={analyze:async()=>({findings:[]})};
  const result=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[{localId:'c1',title:'第一章',content,aiSegments}],checks:['ai-risk','padding']},{egteClient,modelClient});
  assert.equal(result.aiRisk.findings[0].chapterId,'c1');
  assert.equal(result.aiRisk.findings[0].labelZh,'人工');
  assert.equal(result.quality.findings.length,0);
});

test('EGTE客户端复用同一个常驻Python进程并使用服务端路径配置',async()=>{
  let spawnCount=0,captured;
  const spawnImpl=(command,args,options)=>{
    spawnCount+=1;captured={command,args,options};
    const child=new EventEmitter();child.killed=false;child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.stdin={write(line,callback){const request=JSON.parse(line);queueMicrotask(()=>child.stdout.write(`${JSON.stringify({id:request.id,ok:true,results:request.segments.map(item=>({segmentId:item.segmentId,status:'success',aiScore:0.4,predictedLabel:0,documentTokens:12}))})}\n`));callback?.();}};
    child.kill=()=>{child.killed=true;};
    return child;
  };
  const client=new EgteClient({env:{EGTE_ROOT:'/models/egte',EGTE_PYTHON_BIN:'/env/bin/python',EGTE_WORKER_PATH:'/project/worker.py',EGTE_GPU:'2',EGTE_TIMEOUT_MS:'1000'},spawnImpl});
  const first=await client.analyze({classifier:'cred',segments:[{segmentId:'s-1',text:'足够长的测试文本内容'}]});
  const second=await client.analyze({classifier:'cred',segments:[{segmentId:'s-2',text:'另一句足够长的测试文本'}]});
  assert.equal(spawnCount,1);
  assert.equal(captured.command,'/env/bin/python');
  assert.deepEqual(captured.args,['/project/worker.py']);
  assert.equal(captured.options.env.EGTE_ROOT,'/models/egte');
  assert.equal(captured.options.env.EGTE_GPU,'2');
  assert.equal(first[0].segmentId,'s-1');
  assert.equal(second[0].predictedLabel,0);
  client.close();
});

test('新闻三审三校只接受能回指原文的段落级问题',async()=>{
  const audit=[];
  const modelClient={analyze:async({payload})=>({findings:[
    {paragraphId:payload.paragraphs[0].paragraphId,quote:'用词不当',type:'wording',severity:'warning',message:'表述不够准确。',suggestion:'改为准确表述。',confidence:0.9},
    {paragraphId:payload.paragraphs[0].paragraphId,quote:'原文不存在',type:'hallucination',message:'该条应被丢弃。'},
  ]})};
  const result=await runTextScenario(newsScenario,{action:'analyze',material:{title:'测试稿',content:'第一段存在用词不当的问题。\n第二段内容正常。'},checks:['proofreading']},{requestId:'test',modelClient,logger:{warn:value=>audit.push(JSON.parse(value))}});
  assert.equal(result.status,'completed');
  assert.equal(result.proofreading.issues.length,1);
  assert.equal(result.proofreading.summary,'发现 1 条需复核的审校问题。');
  assert.equal('evidenceValidation' in result.proofreading,false);
  assert.doesNotMatch(JSON.stringify(result),/拒绝|无法准确回指|rejectedFindings/);
  assert.deepEqual(audit,[{event:'text_model_evidence_rejected',scenario:'news',requestId:'test',receivedFindings:2,acceptedFindings:1,rejectedFindings:1}]);
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
  assert.equal(result.proofreading.summary,'本次模型审校未发现有明确原文证据的问题。');
  assert.doesNotMatch(JSON.stringify(result),/拒绝|无法准确回指|rejectedFindings/);
  assert.deepEqual(audit,[{event:'text_model_evidence_rejected',scenario:'news',requestId:'news-all-rejected',receivedFindings:1,acceptedFindings:0,rejectedFindings:1}]);
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
  const modelClient={analyze:async()=>({findings:[]})};
  const multiple=await runTextScenario(novelScenario,{action:'analyze',work:{title:'测试作品'},chapters:[
    {localId:'1',title:'第一章',content:repeated},
    {localId:'2',title:'第二章',content:repeated},
  ],checks:['repetition','padding']},{modelClient});
  assert.equal(multiple.coverage.crossChapter,'same-request');
  assert.equal(multiple.quality.findings.length,1);
  assert.equal(multiple.quality.findings[0].references.length,2);
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
  assert.equal(capturedBody.response_format.type,'json_object');
  assert.equal(capturedBody.stream,false);
});

test('模型返回合法JSON但缺少findings数组时明确失败',async()=>{
  const client=createTextModelClient({env:{TEXT_MODEL_PROVIDER:'deepseek',TEXT_MODEL_API_KEY:'test-secret'},fetchImpl:async()=>new Response(JSON.stringify({choices:[{message:{content:'{"summary":"没有问题"}'}}]}),{status:200,headers:{'Content-Type':'application/json'}})});
  await assert.rejects(()=>client.analyze({task:'news_review',payload:{paragraphs:[]}}),error=>error.status===502&&error.code==='MODEL_RESPONSE_INVALID');
});

test('缺少服务端模型配置时明确失败且不生成结果',async()=>{
  const client=createTextModelClient({env:{}});
  await assert.rejects(()=>client.analyze({task:'news_review',payload:{}}),error=>error.status===503&&error.code==='MODEL_NOT_CONFIGURED');
});

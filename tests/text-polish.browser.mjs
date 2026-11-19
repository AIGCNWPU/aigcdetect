import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdir} from 'node:fs/promises';
import {chromium} from '../tmp/browser-check/node_modules/playwright/index.mjs';
import {createServer} from '../scripts/serve.mjs';

const textModelClient={async analyze({task,payload}){
  if(task==='novel_rewrite')return{findings:payload.fragments.map(item=>({fragmentId:item.fragmentId,after:`${item.before}她核对记录后继续前行。`,reason:'保留情节。'}))};
  if(task==='news_review')return{findings:payload.paragraphs.slice(0,1).map(p=>({paragraphId:p.paragraphId,quote:p.text,type:'表达核查',severity:'warning',message:'请核对事实。',suggestion:'请按采访记录核实。',confidence:.8}))};
  return{findings:[]};
}};
const egteClient={modelVersion:'editor-fixture',thresholds:{humanMax:.5,aiMin:.8,dominanceMin:.6},async analyze({segments}){
  return segments.map(item=>({segmentId:item.segmentId,status:'success',aiScore:.88,predictedLabel:1,documentTokens:45}));
}};
const server=createServer({dist:process.argv.includes('--dist'),textModelClient,egteClient});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true}),page=await browser.newPage({viewport:{width:1550,height:1050}});
const base=`http://127.0.0.1:${server.address().port}`,errors=[],requests=[];let failNextAi=false;
page.setDefaultTimeout(10000);
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/api/v1/text/{news,novel}',async route=>{
  const payload=route.request().postDataJSON();requests.push(payload);
  if(failNextAi&&payload.action==='analyze'&&payload.checks.includes('ai-risk')){
    failNextAi=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'AI_DETECTOR_UNAVAILABLE',message:'测试单项失败'}})});
  }else await route.continue();
});
await mkdir('output/text-editor',{recursive:true});
const done=()=>page.locator('[data-result-status]').filter({hasText:/^(已完成|部分完成|检测失败)$/}).waitFor();
try{
  await page.goto(`${base}/#/text/news`);
  const initial='记者来到社区现场，核对阅读空间的开放时间，认真记录居民对新增设施和书架位置的意见，随后将采访结果整理为公开说明。';
  await page.getByLabel('稿件标题 *').fill('体验验收新闻');await page.getByLabel('稿件正文 *').fill(initial);
  failNextAi=true;
  await page.getByRole('button',{name:'保存并开始检测',exact:true}).click();await done();
  assert.equal(await page.locator('[data-result-status]').innerText(),'部分完成');
  const beforeRetry=requests.length;
  await page.locator('[data-retry-service="ai-risk"]').click();await done();
  assert.equal(await page.locator('[data-result-status]').innerText(),'已完成');
  assert.equal(requests.length,beforeRetry+1);assert.deepEqual(requests.at(-1).checks,['ai-risk']);
  const ai=page.locator('[data-result-service-panel="ai-risk"]');
  await ai.getByRole('button',{name:'编辑正文',exact:true}).click();
  await ai.getByLabel('编辑正文：体验验收新闻',{exact:true}).fill(initial+'编辑补充了这条事实。');
  await ai.getByRole('button',{name:'撤销上一步',exact:true}).click();
  assert.equal(await ai.getByLabel('编辑正文：体验验收新闻',{exact:true}).inputValue(),initial);
  await ai.getByLabel('编辑正文：体验验收新闻',{exact:true}).fill(initial+'这是第二稿新正文。');
  await ai.getByRole('button',{name:'开始检测',exact:true}).click();await done();
  await page.getByRole('tab',{name:'历史与报告',exact:true}).click();
  assert.equal(await page.locator('[data-news-run]').count(),2);
  await page.locator('[data-news-run="0"]').click();
  assert.equal(await ai.locator('.text-review-original').textContent(),initial);
  assert.match(await page.locator('[data-result-title]').innerText(),/v1/);
  await ai.getByRole('button',{name:'编辑正文',exact:true}).click();
  await ai.getByLabel('编辑正文：体验验收新闻',{exact:true}).fill(initial+'尚未复检的文字。');
  await page.getByRole('tab',{name:'历史与报告',exact:true}).click();await page.locator('[data-news-run="1"]').click();
  assert.match(await page.locator('[data-export-message]').innerText(),/未检测/);

  await page.goto(`${base}/#/text/novel`);
  for(const name of ['甲章','乙章']){
    await page.getByLabel('作品名称 *').fill('六项细节验收');await page.getByLabel('章节名称 *').fill(name);
    await page.getByLabel('章节正文',{exact:true}).fill(name+initial);await page.getByRole('button',{name:'添加章节',exact:true}).click();
  }
  await page.getByRole('tab',{name:'章节检测',exact:true}).click();failNextAi=true;
  await page.getByRole('button',{name:'检测已选章节',exact:true}).click();await done();
  const novelBefore=requests.length;
  await page.locator('[data-retry-service="ai-risk"]').click();await done();
  assert.equal(requests.length,novelBefore+1);assert.deepEqual(requests.at(-1).checks,['ai-risk']);
  assert.equal(requests.at(-1).chapters.length,2);
  const novelAi=page.locator('[data-result-service-panel="ai-risk"]');
  await page.getByRole('tab',{name:'修改建议',exact:true}).click();await page.getByRole('button',{name:'生成改写建议',exact:true}).click();
  await page.locator('.novel-rewrite-proposal').first().waitFor();
  assert.equal(await page.getByLabel('筛选修改建议',{exact:true}).inputValue(),'pending');
  const proposals=await page.locator('.novel-rewrite-proposal').count();
  await page.locator('.novel-rewrite-proposal').first().getByRole('button',{name:'接受',exact:true}).click();
  assert.equal(await page.getByRole('tab',{name:'甲章',exact:true}).getAttribute('aria-selected'),'true');
  assert.match(await page.getByRole('tab',{name:'甲章',exact:true}).innerText(),/已修改/);
  assert.match(await novelAi.locator('.text-review-draft-notice').innerText(),/已修改 1 章，本次联合检测 2 章/);
  const editor=novelAi.getByLabel('编辑正文：甲章',{exact:true});
  assert.match(await editor.inputValue(),/核对记录后继续前行/);
  assert.equal(await editor.evaluate(node=>node.value.slice(node.selectionStart,node.selectionEnd)),await page.getByLabel('筛选修改建议').selectOption('accepted').then(()=>page.locator('.novel-rewrite-compare>div').nth(1).locator('p').textContent()));
  await page.getByLabel('筛选修改建议').selectOption('pending');assert.equal(await page.locator('.novel-rewrite-proposal').count(),proposals-1);
  await novelAi.getByRole('button',{name:'撤销上一步',exact:true}).click();
  assert.equal(await editor.inputValue(),'甲章'+initial);assert.doesNotMatch(await page.getByRole('tab',{name:'甲章',exact:true}).innerText(),/已修改/);
  assert.equal(await page.locator('.novel-rewrite-proposal').count(),proposals);
  await page.getByRole('button',{name:'接受全部选中章节',exact:true}).click();
  await novelAi.getByRole('button',{name:'撤销上一步',exact:true}).click();
  await page.getByRole('tab',{name:'全文',exact:true}).click();
  assert.equal(await novelAi.getByLabel('编辑正文：乙章',{exact:true}).inputValue(),'乙章'+initial);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.screenshot({path:'output/text-editor/polish-mobile.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('Text polish passed: exact focus, chapter badges, undo decisions, filters, isolated retries, news history and mobile');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

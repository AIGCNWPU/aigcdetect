import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

let rewriteRound=0,originalFragments=[];
const textModelClient={async analyze({task,payload}){if(task==='novel_rewrite'){rewriteRound+=1;if(rewriteRound===1)originalFragments=payload.fragments.map(item=>item.before);return{findings:payload.fragments.map((item,index)=>({fragmentId:item.fragmentId,after:rewriteRound===2?originalFragments[index]:`${item.before} 她握紧了手。`,reason:'保留人物处境'}))};}return{findings:[]};}};
const egteClient={modelVersion:'browser-egte',thresholds:{humanMax:.5,aiMin:.8,dominanceMin:.6},async analyze({segments}){return segments.map(item=>({segmentId:item.segmentId,status:'success',aiScore:.88,predictedLabel:1,documentTokens:32}));}};
const server=createServer({textModelClient,egteClient});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],failedResponses=[];
page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&!message.text().startsWith('Failed to load resource:'))errors.push(message.text());});page.on('response',response=>{if(response.status()>=500)failedResponses.push(response.url());});

try{
  await page.goto(`${base}/#/text/novel`);await page.evaluate(()=>localStorage.clear());await page.reload();
  await page.getByLabel('作品名称 *').fill('浏览器改写测试');
  await page.getByLabel('章节名称 *').fill('第一章 夜门');
  await page.getByLabel('章节正文').fill('她停在门边，非常认真地思考着接下来应该怎么办，仿佛每一个选择都需要反复衡量。\n“我知道该怎么做了。”她终于开口。');
  await page.getByRole('button',{name:'添加章节'}).click();
  await page.getByRole('tab',{name:'章节检测'}).click();
  await page.getByRole('checkbox',{name:/重复与水稿线索/}).uncheck();
  await page.getByRole('button',{name:'检测已选章节'}).click();
  await page.locator('[data-result-status]').filter({hasText:'已完成'}).waitFor();
  await page.locator('[data-rewrite-panel]').waitFor({state:'visible'});
  await page.getByRole('button',{name:'生成改写建议'}).click();
  await page.locator('.novel-rewrite-proposal').first().waitFor();
  await page.getByRole('button',{name:'接受全部选中章节'}).click();
  assert.match(await page.locator('.novel-chapter-list').innerText(),/v1/);
  assert.match(await page.locator('.novel-rewrite-decision').first().innerText(),/已接受/);
  await page.getByRole('button',{name:'生成修改后版本'}).click();
  assert.match(await page.locator('.novel-chapter-list').innerText(),/v2/);
  assert.match(await page.locator('.novel-chapter-list').innerText(),/待检测/);
  assert.equal(await page.locator('.novel-version-chapter article').count(),2);
  assert.match(await page.locator('.novel-version-chapter article').first().innerText(),/待检测/);
  await page.getByRole('button',{name:'检测已选章节'}).click();
  await page.locator('[data-result-status]').filter({hasText:'已完成'}).waitFor();
  assert.match(await page.locator('.novel-version-chapter article').first().innerText(),/AI分 88%/);
  assert.equal(await page.getByRole('button',{name:'查看结果/报告'}).count(),2);
  assert.equal(await page.getByRole('button',{name:'生成修改后版本'}).isDisabled(),true);
  for(const version of [3,4]){
    await page.getByRole('button',{name:'生成改写建议'}).click();
    await page.waitForFunction(()=>document.querySelector('[data-rewrite-generate]').disabled===false);
    await page.getByRole('button',{name:'接受全部选中章节'}).click();
    await page.getByRole('button',{name:'生成修改后版本'}).click();
    await page.waitForFunction(value=>document.querySelector('.novel-chapter-list').textContent.includes(`v${value}`),version);
    assert.match(await page.locator('.novel-version-chapter article').first().innerText(),new RegExp(`v${version}.*修改版`));
    await page.getByRole('button',{name:'检测已选章节'}).click();
    await page.locator('[data-result-status]').filter({hasText:'已完成'}).waitFor();
    assert.match(await page.locator('.novel-version-chapter article').first().innerText(),/AI分 88%/);
    assert.equal(await page.locator('.novel-version-chapter article').count(),version);
  }
  await page.getByRole('button',{name:'查看结果/报告'}).last().click();
  assert.equal(await page.locator('[data-result-status]').innerText(),'已加载历史结果');
  assert.equal(await page.locator('[data-export-ai]').isEnabled(),true);
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-download-version]').first().click();const download=await downloadPromise;
  assert.equal(download.suggestedFilename(),'浏览器改写测试-第一章 夜门-改写版-v4.txt');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.locator('[data-rewrite-panel]').isVisible());
  assert.equal(await page.evaluate(()=>localStorage.getItem('veritas_novel_rewrite_history_v1')),null);
  await page.evaluate(()=>localStorage.setItem('veritas_novel_rewrite_history_v1','legacy-record'));
  await page.reload();await page.getByRole('tab',{name:'章节检测'}).click();
  assert.equal(await page.locator('.novel-chapter-list li').count(),0);
  assert.equal(await page.locator('[data-rewrite-panel]').isHidden(),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('veritas_novel_rewrite_history_v1')),null);
  assert.deepEqual(errors,[]);
  assert.deepEqual(failedResponses.filter(url=>url.includes('/api/v1/text')),[]);
  console.log('Novel rewrite browser test passed');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

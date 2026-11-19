import assert from 'node:assert/strict';
import {once} from 'node:events';
import {chromium} from '../tmp/browser-check/node_modules/playwright/index.mjs';
import {createServer} from '../scripts/serve.mjs';

let rewrites=0,modelIds=[];
const textModelClient={async analyze({task,payload}){
  if(task!=='novel_rewrite')return{findings:[]};
  rewrites++;modelIds=payload.fragments.map(item=>item.fragmentId);
  return{findings:[...payload.fragments].reverse().map(item=>({fragmentId:item.fragmentId,after:`${item.before}（这是仅属于${item.chapter}的修改。）`,reason:'逐章核对原意。'}))};
}};
const egteClient={modelVersion:'multi-rewrite-fixture',thresholds:{humanMax:.5,aiMin:.8,dominanceMin:.6},async analyze({segments}){
  return segments.map(item=>({segmentId:item.segmentId,status:'success',aiScore:item.text.includes('甲章')?.92:item.text.includes('乙章')?.62:.08,predictedLabel:item.text.includes('丙章')?0:1,documentTokens:45}));
}};
const server=createServer({dist:process.argv.includes('--dist'),textModelClient,egteClient});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`,browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(`${base}/#/text/novel`);
  for(const name of ['甲章','乙章','丙章']){
    await page.getByLabel('作品名称 *').fill('多章分数与改写测试');
    await page.getByLabel('章节名称 *').fill(name);
    await page.getByLabel('章节正文',{exact:true}).fill(`${name}的人物沿着山路前进，认真核对每一份记录后，终于在天黑之前抵达城门。
${name}的另一位人物随后走进院落，确认所有同行者安全返回，再将路上的经历完整告诉大家。`);
    await page.getByRole('button',{name:'添加章节',exact:true}).click();
  }
  await page.getByRole('tab',{name:'章节检测',exact:true}).click();
  await page.getByRole('checkbox',{name:/重复与水稿线索/}).uncheck();
  await page.getByRole('button',{name:'检测已选章节'}).click();
  await page.locator('[data-result-status]').filter({hasText:'已完成'}).waitFor();
  const history=page.locator('.novel-version-chapter');
  for(const [index,score]of [92,62,8].entries())assert.match(await history.nth(index).innerText(),new RegExp(`本章AI分 ${score}%`));
  await history.nth(1).getByRole('button',{name:'查看结果/报告'}).click();
  assert.equal(await page.getByRole('tab',{name:'乙章',exact:true}).getAttribute('aria-selected'),'true');
  assert.match(await page.locator('[data-ai-overview]').innerText(),/62\.00%/);
  assert.match(await page.locator('[data-ai-overview]').innerText(),/本章加权得分/);
  await page.getByRole('tab',{name:'修改建议',exact:true}).click();
  await page.getByRole('button',{name:'生成改写建议'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-rewrite-generate]').disabled===false);
  assert.equal(rewrites,1);assert.equal(modelIds.length,2);assert.equal(new Set(modelIds).size,2);
  await page.getByLabel('筛选修改建议',{exact:true}).selectOption('all');
  const groups=page.locator('.novel-rewrite-chapter');assert.equal(await groups.count(),2);
  const first=groups.filter({has:page.locator('header strong',{hasText:'甲章'})}),second=groups.filter({has:page.locator('header strong',{hasText:'乙章'})});
  await first.getByRole('button',{name:'接受本章全部'}).click();
  assert.match(await first.innerText(),/已接受/);assert.match(await second.locator('.novel-rewrite-decision').innerText(),/待处理/);
  assert.equal(await history.nth(0).locator('article').count(),1);
  await page.getByRole('tab',{name:'甲章',exact:true}).click();
  assert.match(await page.getByLabel('编辑正文：甲章',{exact:true}).inputValue(),/仅属于甲章/);
  await first.getByRole('button',{name:'撤回本章已接受建议'}).click();
  assert.doesNotMatch(await page.getByLabel('编辑正文：甲章',{exact:true}).inputValue(),/仅属于甲章/);
  await first.getByRole('button',{name:'接受本章全部'}).click();
  await page.locator('[data-result-service-panel="ai-risk"]').getByRole('button',{name:'开始检测',exact:true}).click();
  await page.locator('[data-result-status]').filter({hasText:'已完成'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.novel-version-chapter')[0].querySelectorAll('article').length===2);
  assert.equal(await history.nth(0).locator('article').count(),2);
  assert.equal(await history.nth(1).locator('article').count(),1);
  assert.equal(await history.nth(2).locator('article').count(),1);
  assert.match(await history.nth(0).locator('article').first().innerText(),/本章AI分 92%/);
  await page.getByRole('tab',{name:'修改建议',exact:true}).click();
  await page.getByRole('button',{name:'生成改写建议'}).click();
  await page.waitForFunction(()=>document.querySelector('[data-rewrite-generate]').disabled===false);
  await page.getByLabel('筛选修改建议',{exact:true}).selectOption('all');await page.getByRole('button',{name:'接受全部选中章节'}).click();
  await page.locator('[data-result-service-panel="ai-risk"]').getByRole('button',{name:'开始检测',exact:true}).click();
  await page.locator('[data-result-status]').filter({hasText:'已完成'}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.novel-version-chapter')[0].querySelectorAll('article').length===3);
  assert.match(await history.nth(0).locator('article').first().innerText(),/v3.*修改版/);
  assert.match(await history.nth(1).locator('article').first().innerText(),/v2.*修改版/);
  assert.equal(await history.nth(2).locator('article').count(),1);
  assert.deepEqual(errors,[]);
  console.log('Multi-chapter rewrite browser test passed: chapter scores, scoped history, duplicate source IDs, reversed responses and isolated acceptance');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

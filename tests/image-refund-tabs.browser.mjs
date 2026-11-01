import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(5000);const errors=[];
page.on('pageerror',e=>errors.push(e.message));
const tab=name=>page.getByRole('tab',{name,exact:true});
const checkPanel=async name=>{assert.equal(await tab(name).getAttribute('aria-selected'),'true');assert.equal(await page.locator('[data-workspace-panel]:visible').count(),1);};
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/#/image/refund`);
  await tab('案件与凭证').waitFor({timeout:2000});await checkPanel('案件与凭证');
  await tab('案件与凭证').focus();await page.keyboard.press('ArrowRight');await checkPanel('检测与核对');
  await page.keyboard.press('End');await checkPanel('案件汇总');await page.keyboard.press('Home');await checkPanel('案件与凭证');
  assert.equal(await tab('案件与凭证').evaluate(el=>el===document.activeElement),true);
  await page.getByLabel('案件编号',{exact:true}).fill('CASE-TABS');await page.getByLabel('商品名称',{exact:true}).fill('白色陶瓷杯');await page.getByLabel('问题描述',{exact:true}).fill('杯口破损');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#eeeae5';x.fillRect(0,0,800,600);x.fillStyle='white';x.fillRect(200,150,280,280);x.strokeStyle='white';x.lineWidth=25;x.beginPath();x.arc(485,285,70,-Math.PI/2,Math.PI/2);x.stroke();x.fillStyle='#6b6260';x.font='22px sans-serif';x.fillText('测试图片 · 非真实检测',30,550);return c.toDataURL().split(',')[1];});
  const fixture=name=>({name,mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.locator('input[type=file]').setInputFiles(fixture('凭证1.png'));await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===1);
  const imageUrl=await page.locator('.refund-thumbnail img').getAttribute('src');
  await tab('案件汇总').click();await tab('案件与凭证').click();assert.equal(await page.getByLabel('问题描述',{exact:true}).inputValue(),'杯口破损');assert.equal(await page.locator('.refund-thumbnail img').getAttribute('src'),imageUrl);
  // Submission continues across internal tabs; a real route departure still cancels it.
  await page.evaluate(()=>{window.submitCalls=0;window.Veritas.refund.configure((_,{signal})=>{window.submitCalls++;window.submitSignal=signal;return new Promise(resolve=>window.finishSubmit=resolve);});});
  await page.getByRole('button',{name:'提交材料',exact:true}).click();await page.waitForFunction(()=>window.submitSignal);
  await tab('案件汇总').click();await tab('检测与核对').click();assert.equal(await page.evaluate(()=>window.submitSignal.aborted),false);assert.equal(await page.evaluate(()=>window.submitCalls),1);
  await tab('案件与凭证').click();assert.equal(await page.getByLabel('案件编号',{exact:true}).isDisabled(),true);
  await page.evaluate(()=>window.finishSubmit({accepted:true,receiptId:'receipt-tabs'}));await page.getByRole('button',{name:'提交材料',exact:true}).waitFor();
  // A pending detection keeps one request; cancel remains reachable on another panel.
  await page.evaluate(()=>{window.detectCalls=0;window.Veritas.refundDetection.configure({ai:(_,{signal})=>{window.detectCalls++;window.detectSignal=signal;return new Promise(resolve=>window.finishDetect=resolve);}});});
  await tab('检测与核对').click();await page.getByRole('checkbox',{name:'局部篡改检测',exact:true}).uncheck();await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.waitForFunction(()=>window.detectSignal);
  await tab('案件汇总').click();await checkPanel('案件汇总');assert.equal(await page.evaluate(()=>window.detectSignal.aborted),false);assert.equal(await page.evaluate(()=>window.detectCalls),1);
  assert.match(await page.locator('[data-workspace-status]').innerText(),/检测中/);assert.equal(await tab('案件汇总').evaluate(el=>el===document.activeElement),true);
  await page.getByRole('button',{name:'取消检测',exact:true}).click();await page.waitForFunction(()=>!window.Veritas.refundDetection.busy);assert.equal(await page.evaluate(()=>window.detectSignal.aborted),true);
  await tab('案件与凭证').click();await page.locator('input[type=file]').setInputFiles(Array.from({length:9},(_,i)=>fixture(`凭证${i+2}.png`)));await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===10);
  // Real UI state is populated only through test adapters, never production samples.
  await page.evaluate(()=>window.Veritas.refundDetection.configure({
    ai:async({image})=>({imageId:image.id,kind:'ai',risk:'low',summary:'测试：整图来源风险较低',coverage:'full',scope:'整张图片'}),
    tamper:async({image})=>{if(image.file.name==='凭证2.png')throw Error('测试：检测暂时失败');return {imageId:image.id,kind:'tamper',risk:'high',summary:'测试：需核查杯口边缘',coverage:'partial',scope:'仅杯口区域',regions:[{id:'r1',type:'add',description:'测试：杯口纹理异常',box:{x:.25,y:.2,width:.3,height:.2}}]};},
    comparison:async({image})=>({imageId:image.id,kind:'comparison',summary:'测试：请复核商品与问题',coverage:'full',scope:'可见外观与问题部位',checks:['appearance','style','issue'].map(dimension=>({dimension,outcome:'unknown',observed:'当前图片信息不足',evidence:'测试：需要更多角度或参照资料'}))})
  }));
  await tab('检测与核对').click();await page.getByRole('checkbox',{name:'局部篡改检测',exact:true}).check();await page.getByRole('checkbox',{name:'商品与描述核对',exact:true}).check();await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.locator('[data-workspace-status]').filter({hasText:'已结束 30 / 30 项'}).waitFor();
  await tab('商品核对').click();await page.keyboard.press('Home');assert.equal(await tab('风险检测').getAttribute('aria-selected'),'true');await page.keyboard.press('End');assert.equal(await tab('商品核对').getAttribute('aria-selected'),'true');
  await tab('案件汇总').click();const summary=page.locator('.refund-case-summary');assert.equal(await summary.locator('[data-summary-row]').count(),10);assert.equal(await summary.locator('details[open]').count(),0);assert.match(await summary.innerText(),/部分覆盖/);assert.match(await summary.innerText(),/失败/);assert.match(await summary.innerText(),/无法判断/);
  const first=summary.locator('[data-summary-row]').first();await first.locator('summary').first().click();await tab('案件与凭证').click();await tab('案件汇总').click();assert.equal(await first.locator('details').first().getAttribute('open'),'');
  await first.locator('summary').filter({hasText:'可疑区域 1 处'}).click();await summary.getByRole('button',{name:'查看凭证1.png的区域1：添加',exact:true}).click();await checkPanel('检测与核对');assert.equal(await page.locator('[data-region-box=r1]').evaluate(el=>el===document.activeElement),true);
  await tab('商品核对').click();await page.locator('[data-region-box=r1]').click();assert.equal(await tab('风险检测').getAttribute('aria-selected'),'true');assert.equal(await page.locator('[data-region-detail]').isVisible(),true);
  await tab('案件汇总').click();await summary.getByLabel('筛选凭证',{exact:true}).selectOption('failed');await summary.getByRole('button',{name:'查看凭证2.png的核对详情',exact:true}).click();await checkPanel('检测与核对');assert.equal(await tab('商品核对').getAttribute('aria-selected'),'true');assert.equal(await page.locator('.refund-comparison').evaluate(el=>el===document.activeElement),true);
  await tab('案件汇总').click();assert.equal(await summary.getByLabel('筛选凭证',{exact:true}).inputValue(),'failed');await summary.getByLabel('筛选凭证',{exact:true}).selectOption('all');
  // Both viewports: compact summary and only one visible main panel; capture actual pages.
  for(const [name,width,height] of [['desktop',1440,1100],['mobile',390,844]]){
    await page.setViewportSize({width,height});
    for(const [label,file] of [['案件汇总','summary'],['检测与核对','review'],['案件与凭证','materials']]){
      await tab(label).click();await checkPanel(label);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:`docs/screenshots/image-refund-tabs-${file}-${name}.png`,fullPage:true});
    }
  }
  await page.getByLabel('问题描述',{exact:true}).fill('修改问题');await tab('案件汇总').click();assert.equal(await summary.locator('details[open]').count(),0);assert.match(await summary.innerText(),/未检测/);
  await tab('案件与凭证').click();await page.getByRole('button',{name:'提交材料',exact:true}).click();await page.waitForFunction(()=>window.Veritas.refund.busy);await tab('案件汇总').click();await page.getByRole('link',{name:'返回场景列表'}).click();await page.waitForFunction(()=>window.submitSignal.aborted&&!window.Veritas.refund.busy);
  assert.deepEqual(errors,[]);console.log('Tabs QA passed: keyboard, one/ten images, preserved inputs and jobs, compact status/expansion, cross-panel focus, cancellation and desktop/mobile.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

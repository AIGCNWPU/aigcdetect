import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[],posts=[];
page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});
try{
  await page.goto(`http://127.0.0.1:${server.address().port}/#/image/refund`);
  await page.getByRole('heading',{name:'案件风险汇总',exact:true}).waitFor({timeout:3000});
  await page.getByLabel('案件编号',{exact:true}).fill('CASE-03');await page.getByLabel('商品名称',{exact:true}).fill('白色陶瓷杯');await page.getByLabel('商品款式',{exact:true}).fill('白色 / 300ml');await page.getByLabel('商品资料',{exact:true}).fill('白色杯身、弧形手柄');await page.getByLabel('问题描述',{exact:true}).fill('杯口破损');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#eae7e1';x.fillRect(0,0,800,600);x.fillStyle='#fff';x.fillRect(200,160,260,280);x.strokeStyle='#fff';x.lineWidth=25;x.beginPath();x.arc(470,290,70,-Math.PI/2,Math.PI/2);x.stroke();x.fillStyle='#8c8478';x.font='22px sans-serif';x.fillText('测试图片 · 非真实核对',30,550);return c.toDataURL().split(',')[1];});
  const fixture=name=>({name,mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.locator('input[type=file]').setInputFiles(['杯口.png','杯身.png','杯底.png'].map(fixture));
  await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===3);
  const detection=page.locator('.refund-detection'),summary=page.locator('.refund-case-summary');
  await page.getByRole('checkbox',{name:'商品与描述核对',exact:true}).check();await detection.getByRole('button',{name:'开始检测',exact:true}).click();
  await detection.getByText(/服务尚未接入/).waitFor();assert.equal(posts.length,0);assert.equal(await summary.locator('[data-summary-row]').count(),3);assert.match(await summary.innerText(),/未检测/);
  // Test-only adapter results, never bundled into the app.
  await page.evaluate(()=>{
    window.reviewFail=true;window.reviewCalls=[];
    window.Veritas.refundDetection.configure({
      ai:async({image})=>({imageId:image.id,kind:'ai',risk:'low',summary:'测试：整图来源低风险',coverage:'full',scope:'整张图片'}),
      tamper:async({image})=>({imageId:image.id,kind:'tamper',risk:image.file.name==='杯口.png'?'high':'low',summary:'测试：局部纹理核查',coverage:image.file.name==='杯口.png'?'partial':'full',scope:image.file.name==='杯口.png'?'仅杯口区域':'整张图片',regions:image.file.name==='杯口.png'?[{id:'r1',type:'add',description:'测试：杯口纹理异常',box:{x:.25,y:.2,width:.3,height:.2}}]:[]}),
      comparison:async({image})=>{window.reviewCalls.push(image.id);if(image.file.name==='杯身.png'&&window.reviewFail)throw Error('测试核对失败');const suspicious=image.file.name==='杯口.png';return {imageId:image.id,kind:'comparison',summary:'测试：三项资料核对',coverage:'full',scope:'商品可见外观、款式和问题部位',checks:[{dimension:'appearance',outcome:'match',observed:'白色杯身与弧形手柄',evidence:'测试：可见特征符合商品资料'},{dimension:'style',outcome:suspicious?'mismatch':'match',observed:suspicious?'杯身标示500ml':'可见标示300ml',evidence:'测试：依据杯身容量标示'},{dimension:'issue',outcome:suspicious?'unknown':'match',observed:suspicious?'反光遮挡杯口':'杯口可见缺损',evidence:suspicious?'测试：当前角度无法确认':'测试：可见缺损位置与描述相符'}]};}
    });
  });
  await detection.getByRole('button',{name:'开始检测',exact:true}).click();await detection.getByText('已结束 9 / 9 项').waitFor();
  assert.match(await summary.locator('[data-summary-count]').innerText(),/三项完整处理 1 张/);
  const comparison=detection.locator('.refund-comparison');assert.match(await comparison.innerText(),/白色 \/ 300ml/);assert.match(await comparison.innerText(),/不一致/);assert.match(await comparison.innerText(),/无法判断/);
  await summary.getByLabel('筛选凭证',{exact:true}).selectOption('attention');assert.equal(await summary.locator('[data-summary-row]').count(),1);
  await detection.getByRole('checkbox',{name:'显示区域标注',exact:true}).uncheck();
  await summary.locator('summary').filter({hasText:'可疑区域 1 处'}).click();
  // Unchanged input synchronizes and renders without moving focus itself.
  const refresh=()=>page.getByLabel('问题描述',{exact:true}).dispatchEvent('input');
  const disclosure=summary.locator('summary').filter({hasText:'可疑区域 1 处'});
  await disclosure.focus();await refresh();assert.equal(await disclosure.evaluate(el=>el===document.activeElement),true);
  const regionLink=summary.getByRole('button',{name:'查看杯口.png的区域1：添加',exact:true});
  await regionLink.focus();await refresh();assert.equal(await regionLink.isVisible(),true);assert.equal(await regionLink.evaluate(el=>el===document.activeElement),true);
  await summary.getByRole('button',{name:'查看杯口.png的区域1：添加',exact:true}).click();assert.equal(await detection.locator('[data-region-box=r1]').isVisible(),true);assert.equal(await detection.locator('[data-region-box=r1]').evaluate(el=>el===document.activeElement),true);
  await summary.getByLabel('筛选凭证',{exact:true}).selectOption('incomplete');assert.equal(await summary.locator('[data-summary-row]').count(),2);
  await summary.getByLabel('筛选凭证',{exact:true}).selectOption('failed');assert.equal(await summary.locator('[data-summary-row]').count(),1);
  await summary.getByRole('button',{name:'查看杯身.png的核对详情',exact:true}).click();assert.equal(await comparison.evaluate(el=>el===document.activeElement),true);assert.match(await comparison.innerText(),/测试核对失败/);
  await refresh();assert.equal(await comparison.evaluate(el=>el===document.activeElement),true);
  await summary.getByRole('button',{name:'查看杯身.png的原图',exact:true}).click();await refresh();assert.equal(await detection.locator('.refund-inspect-heading h3').evaluate(el=>el===document.activeElement),true);
  await page.evaluate(()=>{window.reviewFail=false;});await detection.getByRole('button',{name:'重试商品与描述核对',exact:true}).click();
  await summary.getByText('没有符合当前筛选的凭证。',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.reviewCalls.length),4);
  await summary.getByLabel('筛选凭证',{exact:true}).selectOption('all');
  await summary.getByRole('button',{name:'查看杯口.png的核对详情',exact:true}).click();
  await page.evaluate(()=>document.activeElement?.blur());
  await detection.locator('.refund-detection-detail').screenshot({path:'docs/screenshots/image-refund-review-desktop.png',style:'.topbar,.skip-link{visibility:hidden!important}'});
  await summary.screenshot({path:'docs/screenshots/image-refund-summary-desktop.png',style:'.topbar,.skip-link{visibility:hidden!important}'});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>document.activeElement?.blur());
  await detection.locator('.refund-detection-detail').screenshot({path:'docs/screenshots/image-refund-review-mobile.png',style:'.topbar,.skip-link{visibility:hidden!important}'});
  await summary.screenshot({path:'docs/screenshots/image-refund-summary-mobile.png',style:'.topbar,.skip-link{visibility:hidden!important}'});
  // No result or summary may survive a changed reference or removed image.
  await page.getByLabel('问题描述',{exact:true}).fill('更改问题描述');assert.equal(await comparison.locator('[data-comparison-check]').count(),0);assert.match(await summary.locator('[data-summary-count]').innerText(),/三项完整处理 0 张/);
  await page.getByRole('button',{name:'移除 杯口.png',exact:true}).click();assert.equal(await summary.getByRole('button',{name:'查看杯口.png的核对详情',exact:true}).count(),0);
  await page.locator('input[type=file]').setInputFiles(fixture('新图.png'));await summary.getByRole('button',{name:'查看新图.png的原图',exact:true}).waitFor();assert.match(await summary.innerText(),/未检测/);
  await detection.getByRole('checkbox',{name:'AI生成凭证检测',exact:true}).uncheck();await detection.getByRole('checkbox',{name:'局部篡改检测',exact:true}).uncheck();
  await page.evaluate(()=>window.Veritas.refundDetection.configure({comparison:(_,options)=>{window.reviewSignal=options.signal;return new Promise(resolve=>{window.reviewLate=resolve;});}}));
  await detection.getByRole('button',{name:'开始检测',exact:true}).click();await page.waitForFunction(()=>window.reviewSignal);
  await page.getByRole('link',{name:'返回场景列表'}).click();await page.waitForFunction(()=>window.reviewSignal.aborted&&!window.Veritas.refundDetection.busy);
  await page.evaluate(()=>{window.reviewLate({});location.hash='/image/refund';});await page.getByRole('heading',{name:'案件风险汇总',exact:true}).waitFor();assert.equal(await summary.locator('[data-summary-row]').count(),0);
  assert.deepEqual(errors,[]);console.log('Review browser QA passed: comparison columns, independent outcomes, summary filters, partial/failure states, region/detail focus, retry, material lifecycle, cancellation, desktop/mobile.');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='POST')requests.push(request.url());});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#/image/refund`);
  await page.getByRole('heading',{name:'凭证检测',exact:true}).waitFor({timeout:3000});
  await page.getByLabel('案件编号',{exact:true}).fill('CASE-02');await page.getByLabel('商品名称',{exact:true}).fill('白色陶瓷杯');await page.getByLabel('问题描述',{exact:true}).fill('杯口破损');
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=600;const x=c.getContext('2d');x.fillStyle='#eae7e1';x.fillRect(0,0,800,600);x.fillStyle='#fff';x.fillRect(200,160,260,280);x.strokeStyle='#fff';x.lineWidth=25;x.beginPath();x.arc(470,290,70,-Math.PI/2,Math.PI/2);x.stroke();x.fillStyle='#8c8478';x.font='22px sans-serif';x.fillText('测试图片 · 非真实检测',30,550);return c.toDataURL().split(',')[1];});
  const image={name:'杯口.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
  await page.locator('input[type=file]').setInputFiles([image,{...image,name:'杯底.png'}]);
  await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===2);
  const section=page.locator('.refund-detection');
  await section.getByRole('button',{name:'开始检测',exact:true}).click();
  await section.getByText(/服务尚未接入/).waitFor();assert.equal(requests.length,0);
  assert.equal(await section.locator('.refund-risk').count(),0);
  // Fixtures live only in this test, injected through the documented adapter seam.
  await page.evaluate(()=>{
    window.qaFail=true;window.qaCalls=[];
    window.Veritas.refundDetection.configure({
      ai:async({image})=>{window.qaCalls.push(image.id+'ai');return {imageId:image.id,kind:'ai',risk:'low',summary:'测试返回：整图来源低风险',coverage:'full',scope:'整张图片'};},
      tamper:async({image})=>{window.qaCalls.push(image.id+'tamper');if(image.file.name==='杯底.png'&&window.qaFail)throw Error('测试服务暂时失败');return {imageId:image.id,kind:'tamper',risk:'high',summary:'测试返回：需核查杯口边缘',coverage:'partial',scope:'杯口和杯身可见区域',regions:[{id:'r1',type:'add',description:'测试：局部纹理不连续',box:{x:.25,y:.2,width:.3,height:.2}},{id:'r2',type:'remove',description:'测试：边缘消除痕迹',box:{x:.4,y:.5,width:.2,height:.15}}]};}
    });
  });
  await section.getByRole('button',{name:'开始检测',exact:true}).click();
  await section.getByText('已结束 4 / 4 项').waitFor();
  assert.equal(await section.locator('.refund-risk[data-risk=low]').count(),1);assert.equal(await section.locator('.refund-risk[data-risk=high]').count(),1);
  assert.match(await section.innerText(),/部分覆盖/);
  const frame=section.locator('.refund-inspect-frame'),box=section.locator('[data-region-box="r1"]');
  const assertPosition=async()=>{const f=await frame.boundingBox(),b=await box.boundingBox();assert.ok(Math.abs(b.x-f.x-f.width*.25)<2);assert.ok(Math.abs(b.y-f.y-f.height*.2)<2);assert.ok(Math.abs(b.width-f.width*.3)<2);};
  await assertPosition();
  await section.locator('[data-region-box="r2"]').click();
  assert.equal(await section.locator('[data-region-choice="r2"]').getAttribute('aria-pressed'),'true');
  assert.match(await section.locator('[data-region-detail]').innerText(),/消除/);
  await section.getByLabel('显示区域标注',{exact:true}).uncheck();assert.equal(await box.isVisible(),false);
  await section.getByLabel('显示区域标注',{exact:true}).check();
  await section.locator('[data-region-choice="r1"]').focus();await page.keyboard.press('Enter');
  assert.equal(await box.getAttribute('aria-pressed'),'true');
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:'docs/screenshots/image-refund-detection-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await assertPosition();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});await page.screenshot({path:'docs/screenshots/image-refund-detection-mobile.png',fullPage:true});
  await section.getByRole('button',{name:'查看检测 杯底.png',exact:true}).click();
  assert.equal(await section.locator('[data-region-box]').count(),0);
  await page.evaluate(()=>{window.qaFail=false;});
  await section.getByRole('button',{name:'重试局部篡改检测',exact:true}).click();
  await section.locator('.refund-risk[data-risk=high]').waitFor();assert.equal(await page.evaluate(()=>window.qaCalls.length),5);
  // A new file must not inherit results, and removing one must clear its association.
  await page.locator('input[type=file]').setInputFiles({...image,name:'新凭证.png'});
  await section.getByRole('button',{name:'查看检测 新凭证.png',exact:true}).click();assert.equal(await section.locator('.refund-risk').count(),0);
  await page.getByRole('button',{name:'移除 新凭证.png',exact:true}).click();assert.equal(await section.getByRole('button',{name:'查看检测 新凭证.png',exact:true}).count(),0);
  await page.getByLabel('问题描述',{exact:true}).fill('新问题');assert.equal(await section.locator('.refund-risk').count(),0);
  // Pending work locks edits, but navigation remains available and cancels its signal.
  await page.evaluate(()=>window.Veritas.refundDetection.configure({ai:(_,options)=>{window.qaSignal=options.signal;return new Promise(resolve=>{window.qaLate=resolve;});},tamper:async()=>{throw Error('should not run');}}));
  await section.getByRole('button',{name:'开始检测',exact:true}).click();
  await page.waitForFunction(()=>window.qaSignal);assert.equal(await page.getByLabel('案件编号',{exact:true}).isDisabled(),true);
  await section.getByRole('button',{name:'取消检测',exact:true}).click();
  await page.waitForFunction(()=>!window.Veritas.refundDetection.busy);assert.equal(await page.evaluate(()=>window.qaSignal.aborted),true);
  await section.getByRole('button',{name:'开始检测',exact:true}).click();
  await page.waitForFunction(()=>!window.qaSignal.aborted);
  await page.getByRole('link',{name:'返回场景列表'}).click();await page.waitForFunction(()=>window.qaSignal.aborted&&!window.Veritas.refundDetection.busy);
  await page.evaluate(()=>{window.qaLate({});location.hash='/image/refund';});await page.getByRole('heading',{name:'凭证检测',exact:true}).waitFor();
  assert.equal(await page.locator('.refund-risk').count(),0);assert.deepEqual(errors,[]);
  console.log('Detection browser QA passed: separate risks, partial scope, geometry, selection/keyboard, toggles, retry, image lifecycle, cancellation, desktop/mobile.');
} finally {await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

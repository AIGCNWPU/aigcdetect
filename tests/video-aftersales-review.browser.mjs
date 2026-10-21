import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';
const server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const base=`http://127.0.0.1:${server.address().port}`;
try{
  await page.goto(`${base}/#/video/aftersales`);
  assert.equal(await page.getByRole('tab',{name:'检测与核对',exact:true}).count(),1,'工作区应有检测页签');
  await page.getByRole('tab',{name:'案件与凭证',exact:true}).focus();await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:'图视频汇总',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');
  await page.getByLabel('案件编号',{exact:true}).fill('AS-1');await page.getByLabel('商品名称',{exact:true}).fill('便携风扇');await page.getByLabel('商品款式',{exact:true}).fill('绿色');await page.getByLabel('问题描述',{exact:true}).fill('扇叶无法转动');
  await page.locator('input[type=file]').setInputFiles({name:'故障展示.mp4',mimeType:'video/mp4',buffer:await readFile('tests/fixtures/aftersales.mp4')});
  await page.getByRole('button',{name:'查看 故障展示.mp4',exact:true}).waitFor();
  await page.getByRole('tab',{name:'检测与核对',exact:true}).click();
  assert.equal(await page.locator('[data-tab-panel=review] [data-result-kind=comparison]').isVisible(),false,'核对结果应分区显示，避免长页');
  await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.getByText(/所选检测服务尚未接入/).waitFor();
  await page.evaluate(()=>{
    window.testRisk=(video,kind)=>({videoId:video.id,version:video.version,kind,risk:kind==='ai'?'medium':'high',coverage:'partial',scope:'0—2秒，末段未覆盖',summary:'需人工复核',segments:[{id:'s1',start:0.5,end:1.5,description:'画面过渡异常',type:'splice'}],frames:[{time:1,label:'代表画面'}]});
    window.testComparison=video=>({videoId:video.id,version:video.version,kind:'comparison',coverage:'full',scope:'全片',summary:'存在待核对问题',checks:['appearance','style','issue'].map(dimension=>({dimension,outcome:dimension==='issue'?'mismatch':'match',observed:'可见商品与现象',evidence:'第1秒画面',segments:[{id:dimension,start:0.5,end:1.5,description:'对应画面'}]}))});
    window.Veritas.videoAftersalesDetection.configure({ai:async({video})=>window.testRisk(video,'ai'),tamper:async()=>{throw Error('修改服务暂时失败');},comparison:async({video})=>window.testComparison(video)});
  });
  await page.getByRole('button',{name:'开始检测',exact:true}).click();
  await page.locator('[data-tab-panel=review]').getByText('修改服务暂时失败',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'商品核对',exact:true}).click();await page.locator('[data-tab-panel=review]').getByText('存在待核对问题',{exact:true}).waitFor();
  await page.keyboard.press('ArrowLeft');assert.equal(await page.getByRole('tab',{name:'来源与修改',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'来源与修改',exact:true}).click();
  await page.evaluate(()=>window.Veritas.videoAftersalesDetection.configure({tamper:async({video})=>window.testRisk(video,'tamper')}));
  await page.getByRole('button',{name:'重试 视频修改线索',exact:true}).click();await page.locator('[data-tab-panel=review]').getByText('高风险',{exact:true}).waitFor();
  await page.getByRole('button',{name:'画面 0:01 · 代表画面',exact:true}).first().click();
  assert.equal(await page.evaluate(()=>document.activeElement?.textContent==='画面 0:01 · 代表画面'),true,'定位后保留操作焦点');
  await page.waitForFunction(()=>Math.abs(document.querySelector('video[aria-label="当前视频凭证"]').currentTime-1)<0.1);
  assert.equal(await page.locator('video[aria-label="当前视频凭证"]').evaluate(v=>v.paused),true);
  await page.getByRole('tab',{name:'图视频汇总',exact:true}).click();await page.getByText('本页视频（尚未关联已保存案件）',{exact:true}).waitFor();
  await page.getByLabel('汇总筛选',{exact:true}).selectOption('attention');assert.equal(await page.locator('[data-summary-row]').count(),1);
  await page.getByRole('button',{name:'加载案件凭证',exact:true}).click();await page.getByText(/案件读取服务尚未接入/).waitFor();
  await page.evaluate(base=>{
    window.Veritas.videoAftersalesCase.configure(async({caseNumber})=>({caseNumber,caseRef:'case-1',materials:[
      {caseRef:'case-1',materialRef:'image-1',version:'r1',type:'image',name:'商品图片.png',url:base+'/test-image.png',fields:{caseNumber,productName:'便携风扇',style:'绿色',productInfo:'',description:'扇叶无法转动'},results:{ai:{status:'succeeded',result:{imageId:'image-1',version:'r1',kind:'ai',risk:'high',summary:'图片来源待核查',coverage:'full',scope:'整图'}}}},
      {caseRef:'case-1',materialRef:'video-1',version:'r1',type:'video',name:'已存视频.mp4',url:base+'/test-video.mp4',duration:3,fields:{caseNumber,productName:'便携风扇',style:'绿色',productInfo:'',description:'扇叶无法转动'},results:{ai:{status:'succeeded',result:window.testRisk({id:'video-1',version:'r1'},'ai')}}}
    ]}));
  },base);
  await page.route('**/test-video.mp4',async route=>{
    const bytes=await readFile('tests/fixtures/aftersales.mp4'),range=route.request().headers().range?.match(/bytes=(\d+)-(\d*)/);
    if(!range)return route.fulfill({contentType:'video/mp4',headers:{'accept-ranges':'bytes'},body:bytes});
    const start=Number(range[1]),end=Math.min(range[2]?Number(range[2]):bytes.length-1,bytes.length-1);
    return route.fulfill({status:206,contentType:'video/mp4',headers:{'accept-ranges':'bytes','content-range':`bytes ${start}-${end}/${bytes.length}`},body:bytes.subarray(start,end+1)});
  });
  await page.route('**/nonseek-video.mp4',async route=>route.fulfill({contentType:'video/mp4',body:await readFile('tests/fixtures/aftersales.mp4')}));
  await page.route('**/test-image.png',async route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6X8AAAAASUVORK5CYII=','base64')}));
  await page.getByRole('button',{name:'加载案件凭证',exact:true}).click();await page.getByText('商品图片.png',{exact:true}).waitFor();
  assert.equal(await page.locator('[data-summary-row]').count(),3);
  await page.getByRole('button',{name:'预览 已存视频.mp4',exact:true}).click();
  await page.locator('dialog[open] video').evaluate(v=>v.play());
  await page.getByRole('button',{name:'关闭凭证预览',exact:true}).click();assert.equal(await page.locator('dialog video[src]').count(),0);
  await page.evaluate(()=>{
    window.savedCase=structuredClone(window.Veritas.videoAftersalesCase.data);const changed=structuredClone(window.savedCase),v=changed.materials.find(m=>m.type==='video');v.duration=4;v.results.ai.result.segments[0].start=2.5;v.results.ai.result.segments[0].end=3.5;
    window.Veritas.videoAftersalesCase.configure(async()=>changed);
  });
  await page.getByRole('button',{name:'加载案件凭证',exact:true}).click();await page.getByText('已加载案件凭证。',{exact:true}).waitFor();
  const linkedVideo=page.locator('[data-av-linked-summary] [data-summary-row]').filter({has:page.getByText('已存视频.mp4',{exact:true})});
  await linkedVideo.locator('summary').click();await linkedVideo.getByRole('button',{name:'片段 0:02.5—0:03.5 · 画面过渡异常',exact:true}).click();
  await page.getByText('原视频时长与片段信息不符，请重新加载案件。',{exact:true}).waitFor({timeout:3000});await page.getByRole('button',{name:'关闭凭证预览',exact:true}).click();
  await page.evaluate(()=>window.Veritas.videoAftersalesCase.configure(async()=>window.savedCase));await page.getByRole('button',{name:'加载案件凭证',exact:true}).click();await page.getByText('已加载案件凭证。',{exact:true}).waitFor();
  if(!await linkedVideo.locator('details').evaluate(e=>e.open))await linkedVideo.locator('summary').click();
  await linkedVideo.getByRole('button',{name:'画面 0:01 · 代表画面',exact:true}).click();
  await page.waitForFunction(()=>Math.abs(document.querySelector('dialog video').currentTime-1)<0.05);assert.equal(await page.locator('dialog video').evaluate(v=>v.paused),true);await page.getByRole('button',{name:'关闭凭证预览',exact:true}).click();
  await page.evaluate(()=>{const changed=structuredClone(window.savedCase);changed.materials.find(m=>m.type==='video').url=location.origin+'/nonseek-video.mp4';window.Veritas.videoAftersalesCase.configure(async()=>changed);});
  await page.getByRole('button',{name:'加载案件凭证',exact:true}).click();await page.getByText('已加载案件凭证。',{exact:true}).waitFor();
  if(!await linkedVideo.locator('details').evaluate(e=>e.open))await linkedVideo.locator('summary').click();
  await linkedVideo.getByRole('button',{name:'画面 0:01 · 代表画面',exact:true}).click();await page.getByText('未能定位到指定片段，请重新加载视频后重试。',{exact:true}).waitFor({timeout:5000});await page.getByRole('button',{name:'关闭凭证预览',exact:true}).click();
  await page.evaluate(()=>window.Veritas.videoAftersalesCase.configure(async()=>window.savedCase));await page.getByRole('button',{name:'加载案件凭证',exact:true}).click();await page.getByText('已加载案件凭证。',{exact:true}).waitFor();
  await page.getByRole('button',{name:'预览 商品图片.png',exact:true}).click();await page.keyboard.press('Escape');
  await mkdir('docs/screenshots',{recursive:true});await page.evaluate(()=>{document.activeElement?.blur();scrollTo(0,0);});await page.screenshot({path:'docs/screenshots/video-aftersales-summary-desktop.png',fullPage:true});
  await page.getByRole('tab',{name:'检测与核对',exact:true}).click();await page.screenshot({path:'docs/screenshots/video-aftersales-review-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'docs/screenshots/video-aftersales-review-mobile.png',fullPage:true});
  // Background progress must not close evidence a reviewer is currently reading.
  await page.evaluate(()=>window.Veritas.videoAftersalesDetection.configure({ai:async({video})=>window.testRisk(video,'ai'),tamper:()=>new Promise(resolve=>{window.finishTamper=resolve;}),comparison:async({video})=>window.testComparison(video)}));
  await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.waitForFunction(()=>typeof window.finishTamper==='function');
  await page.getByRole('tab',{name:'图视频汇总',exact:true}).click();
  const localDetails=page.locator('[data-av-local-summary] details').first();await localDetails.locator('summary').click();await localDetails.getByRole('button',{name:'画面 0:01 · 代表画面',exact:true}).focus();
  await page.getByRole('button',{name:'预览 商品图片.png',exact:true}).click();
  await page.evaluate(()=>window.finishTamper({}));await page.waitForFunction(()=>!window.Veritas.videoAftersalesDetection.busy);
  await page.getByRole('button',{name:'关闭凭证预览',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement?.textContent==='预览 商品图片.png'),true,'预览期间刷新后关闭仍返回当前入口');
  assert.equal(await localDetails.evaluate(e=>e.open),true,'后台更新保留展开');
  await localDetails.getByRole('button',{name:'画面 0:01 · 代表画面',exact:true}).focus();await page.evaluate(()=>window.Veritas.videoAftersalesCase.cancel());assert.equal(await page.evaluate(()=>document.activeElement?.textContent==='画面 0:01 · 代表画面'),true,'后台更新保留焦点');
  await page.getByRole('tab',{name:'案件与凭证',exact:true}).click();assert.equal(await page.getByLabel('商品名称',{exact:true}).inputValue(),'便携风扇');await page.getByLabel('问题描述',{exact:true}).fill('更换问题描述');
  await page.getByRole('tab',{name:'检测与核对',exact:true}).click();assert.equal(await page.locator('[data-tab-panel=review]').getByText('高风险',{exact:true}).count(),0);
  await page.evaluate(()=>window.Veritas.videoAftersalesDetection.configure({ai:({video},{signal})=>new Promise(resolve=>{window.pendingSignal=signal;window.resolveDetection=()=>resolve(window.testRisk(video,'ai'));}),tamper:async({video})=>window.testRisk(video,'tamper'),comparison:async({video})=>window.testComparison(video)}));
  await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.getByRole('button',{name:'取消检测',exact:true}).waitFor();await page.getByRole('tab',{name:'案件与凭证',exact:true}).click();assert.equal(await page.getByLabel('商品名称',{exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'取消检测',exact:true}).click();assert.equal(await page.getByLabel('商品名称',{exact:true}).isDisabled(),false);
  await page.evaluate(()=>window.resolveDetection());await page.getByRole('tab',{name:'检测与核对',exact:true}).click();await page.getByRole('button',{name:'开始检测',exact:true}).click();await page.waitForFunction(()=>window.pendingSignal&&!window.pendingSignal.aborted);
  await page.evaluate(()=>{location.hash='/image/refund';});await page.getByLabel('案件编号',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.pendingSignal.aborted),true);assert.equal(await page.evaluate(()=>window.Veritas.videoAftersalesDetection.busy),false);await page.evaluate(()=>window.resolveDetection());
  assert.deepEqual(errors,[]);console.log('PASS video review: separate results, seek, tabs, version invalidation, case image/video summary, preview, cancellation, mobile');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

let server,browser,page,base,bytes,pageErrors;
before(async()=>{
  server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  base=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
  bytes=await readFile(new URL('./fixtures/aftersales.mp4',import.meta.url));
});
beforeEach(async()=>{
  page=await browser.newPage({viewport:{width:1440,height:1100}});pageErrors=[];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(`${base}/#/video/aftersales`);
});
afterEach(async()=>{await page.close();assert.deepEqual(pageErrors,[]);});
after(async()=>{await browser?.close();server?.closeAllConnections();if(server?.listening)await new Promise(resolve=>server.close(resolve));});

test('后续帧损坏的播放错误在检测页签可见，切换视频后清除',async()=>{
  // Keep the MP4 metadata and first frames intact, but damage later media samples.
  const corrupt=Buffer.from(bytes);let damaged=false;
  for(let offset=0;offset<corrupt.length;){
    const size=corrupt.readUInt32BE(offset),type=corrupt.toString('ascii',offset+4,offset+8);
    if(type==='mdat'){const start=offset+8;corrupt.fill(0,Math.floor(start+(size-8)*0.25),offset+size);damaged=true;break;}
    if(!size)break;offset+=size;
  }
  assert.equal(damaged,true,'fixture should contain an mdat box');
  await page.locator('input[type=file]').setInputFiles([
    {name:'后段损坏.mp4',mimeType:'video/mp4',buffer:corrupt},
    {name:'完整视频.mp4',mimeType:'video/mp4',buffer:bytes},
  ]);
  await page.getByRole('button',{name:'查看 完整视频.mp4',exact:true}).waitFor();
  await page.getByRole('tab',{name:'检测与核对',exact:true}).click();
  const player=page.locator('video[aria-label="当前视频凭证"]');
  await page.waitForFunction(()=>document.querySelector('video[aria-label="当前视频凭证"]').readyState>=1);
  await player.evaluate(video=>{video.currentTime=2;video.play().catch(()=>{});});
  await page.waitForFunction(()=>document.querySelector('video[aria-label="当前视频凭证"]').error?.code===3);
  const playbackError=page.getByText('视频播放失败，请检查文件或选择浏览器支持的视频。',{exact:true});
  assert.equal(await playbackError.isVisible(),true,'真实解码失败说明应随检测播放器显示');
  await mkdir('docs/screenshots',{recursive:true});
  await page.screenshot({path:'docs/screenshots/video-aftersales-playback-error.png',fullPage:true});
  await page.getByRole('tab',{name:'案件与凭证',exact:true}).click();
  assert.equal(await playbackError.isVisible(),true,'返回材料页签仍应显示当前视频的错误');
  await page.getByRole('tab',{name:'检测与核对',exact:true}).click();
  await page.getByRole('button',{name:'查看检测 完整视频.mp4',exact:true}).click();
  assert.equal(await playbackError.isVisible(),false,'另一段视频不应显示上一段视频的错误');
  await player.evaluate(video=>video.play());await player.evaluate(video=>video.pause());
});

for(const tab of ['检测与核对','图视频汇总'])for(const outcome of ['failure','success']){
  test(`提交过程中切换到${tab}，${outcome==='failure'?'失败原因':'成功回执'}仍可见`,async()=>{
    await page.getByLabel('案件编号',{exact:true}).fill('AS-ASYNC');
    await page.getByLabel('商品名称',{exact:true}).fill('风扇');
    await page.getByLabel('问题描述',{exact:true}).fill('通电后无法转动');
    await page.locator('input[type=file]').setInputFiles({name:'完整视频.mp4',mimeType:'video/mp4',buffer:bytes});
    await page.getByRole('button',{name:'查看 完整视频.mp4',exact:true}).waitFor();
    await page.evaluate(()=>window.Veritas.videoAftersales.configure(()=>new Promise((resolve,reject)=>{window.finishSubmission={resolve,reject};})));
    await page.getByRole('button',{name:'提交材料',exact:true}).click();
    await page.waitForFunction(()=>Boolean(window.finishSubmission));
    await page.getByRole('tab',{name:tab,exact:true}).click();
    const pendingVisible=await page.getByText('正在提交材料，可以离开页面；未完成的提交会取消。',{exact:true}).isVisible();
    await page.evaluate(result=>{
      if(result==='failure')window.finishSubmission.reject(new Error('提交连接中断，请重试'));
      else window.finishSubmission.resolve({accepted:true,receiptId:'receipt-async'});
    },outcome);
    const message=outcome==='failure'?'提交连接中断，请重试':'材料已接收，回执：receipt-async';
    await page.waitForFunction(text=>document.querySelector('[data-video-status]').textContent===text,message);
    assert.equal(await page.getByText(message,{exact:true}).isVisible(),true,'异步提交结果应在当前页签显示');
    assert.equal(pendingVisible,true,'提交中的状态应在切换页签后继续显示');
    assert.equal(await page.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true','响应不应强制切换用户所在页签');
  });
}

async function prepareDetection(){
  await page.getByLabel('案件编号',{exact:true}).fill('AS-FOCUS');
  await page.getByLabel('商品名称',{exact:true}).fill('风扇');
  await page.getByLabel('问题描述',{exact:true}).fill('通电后无法转动');
  await page.locator('input[type=file]').setInputFiles({name:'完整视频.mp4',mimeType:'video/mp4',buffer:bytes});
  await page.getByRole('button',{name:'查看 完整视频.mp4',exact:true}).waitFor();
  await page.getByRole('tab',{name:'检测与核对',exact:true}).click();
  await page.getByRole('checkbox',{name:'视频修改线索',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'商品与问题核对',exact:true}).uncheck();
}

test('键盘重试后焦点保留在当前视频标题，后台完成不抢走其他控件焦点',async()=>{
  await prepareDetection();
  await page.evaluate(()=>window.Veritas.videoAftersalesDetection.configure({ai:async()=>{throw new Error('请稍后重试');}}));
  await page.getByRole('button',{name:'开始检测',exact:true}).click();
  const retry=page.getByRole('button',{name:'重试 AI生成视频检测',exact:true});await retry.waitFor();
  await page.evaluate(()=>window.Veritas.videoAftersalesDetection.configure({ai:({video})=>new Promise(resolve=>{
    window.finishRetry=()=>resolve({videoId:video.id,version:video.version,kind:'ai',coverage:'full',scope:'全片',summary:'检测完成',risk:'unknown',segments:[],frames:[]});
  })}));
  await retry.focus();await page.keyboard.press('Enter');
  await page.waitForFunction(()=>Boolean(window.finishRetry));
  assert.equal(await page.locator('[data-av-review-title]').evaluate(title=>document.activeElement===title),true,'重试按钮消失后不应丢失键盘位置');
  const checkbox=page.getByRole('checkbox',{name:'AI生成视频检测',exact:true});
  // The disabled checkbox cannot receive focus while detection is pending; a result tab can.
  const resultTab=page.getByRole('tab',{name:'商品核对',exact:true});await resultTab.focus();
  await page.evaluate(()=>window.finishRetry());
  await page.waitForFunction(()=>!window.Veritas.videoAftersalesDetection.busy);
  assert.equal(await resultTab.evaluate(tab=>document.activeElement===tab),true,'后台完成不能抢走仍存在控件的焦点');
  assert.equal(await checkbox.isDisabled(),false);
});

for(const tab of ['案件与凭证','检测与核对','图视频汇总']){
  test(`在${tab}键盘取消检测后焦点回到当前页签`,async()=>{
    await prepareDetection();
    await page.evaluate(()=>window.Veritas.videoAftersalesDetection.configure({ai:()=>new Promise(()=>{})}));
    await page.getByRole('button',{name:'开始检测',exact:true}).click();
    const activeTab=page.getByRole('tab',{name:tab,exact:true});await activeTab.click();
    const cancel=page.getByRole('button',{name:'取消检测',exact:true});await cancel.focus();await page.keyboard.press('Enter');
    assert.equal(await cancel.isVisible(),false);
    assert.equal(await activeTab.evaluate(element=>document.activeElement===element),true,'取消按钮隐藏后应保持键盘操作位置');
  });
}

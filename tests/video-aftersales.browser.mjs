import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';
const server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});
server.listen(0,'127.0.0.1'); await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL||'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[],requests=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('request',request=>{if(request.method()==='POST')requests.push(request.url());});
await page.addInitScript(()=>{
  window.videoTestURLs=new Set();window.videoTestUnloads=[];
  const create=URL.createObjectURL.bind(URL),revoke=URL.revokeObjectURL.bind(URL),load=HTMLMediaElement.prototype.load;
  URL.createObjectURL=blob=>{const url=create(blob);window.videoTestURLs.add(url);return url;};
  URL.revokeObjectURL=url=>{window.videoTestURLs.delete(url);revoke(url);};
  HTMLMediaElement.prototype.load=function(){if(this.controls&&!this.getAttribute('src'))window.videoTestUnloads.push(this.paused);return load.call(this);};
});
const base=`http://127.0.0.1:${server.address().port}/`;
const fill=async()=>{
  await page.getByLabel('案件编号',{exact:true}).fill('AS-20261021-003');
  await page.getByLabel('商品名称',{exact:true}).fill('便携电风扇');
  await page.getByLabel('商品款式',{exact:true}).fill('浅绿 / USB 充电款');
  await page.getByLabel('问题描述',{exact:true}).fill('开箱后接通电源，扇叶无法转动，视频记录了完整测试过程。');
};
try{
  await page.goto(`${base}#/video/aftersales`);
  assert.equal(await page.getByLabel('案件编号',{exact:true}).count(),1,'应提供案件资料表单');
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  await page.getByText('请填写案件编号。',{exact:true}).waitFor();
  await fill();
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  assert.match(await page.locator('[data-video-status]').innerText(),/至少/);
  const mp4={name:'开箱.mp4',mimeType:'video/mp4',buffer:await readFile('tests/fixtures/aftersales.mp4')};
  const webm={name:'故障.webm',mimeType:'video/webm',buffer:await readFile('tests/fixtures/aftersales.webm')};
  await page.locator('input[type=file]').setInputFiles([mp4,webm,{name:'损坏.mp4',mimeType:'video/mp4',buffer:Buffer.from('broken')},{name:'空.mp4',mimeType:'video/mp4',buffer:Buffer.alloc(0)},{name:'说明.txt',mimeType:'text/plain',buffer:Buffer.from('text')}]);
  await page.waitForFunction(()=>document.querySelectorAll('.aftersales-video-item').length===2);
  assert.match(await page.locator('[data-video-errors]').innerText(),/损坏/);
  assert.match(await page.locator('[data-video-errors]').innerText(),/文件为空/);
  const player=page.locator('video[aria-label="当前视频凭证"]');
  await player.evaluate(video=>video.play());
  await page.waitForFunction(()=>document.querySelector('video[aria-label="当前视频凭证"]').currentTime>0.1);
  await player.evaluate(video=>{video.pause();video.currentTime=1;});
  await page.waitForFunction(()=>Math.abs(document.querySelector('video[aria-label="当前视频凭证"]').currentTime-1)<0.1);
  await page.getByRole('button',{name:'查看 故障.webm',exact:true}).click();
  assert.equal(await player.evaluate(video=>video.paused),true);
  assert.equal(await page.locator('video[aria-label="当前视频凭证"]').count(),1);
  assert.ok((await page.evaluate(()=>window.videoTestUnloads)).every(Boolean));
  await player.evaluate(video=>video.play());await player.evaluate(video=>video.pause());
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  assert.match(await page.locator('[data-video-status]').innerText(),/尚未接入/);assert.equal(requests.length,0);
  await page.evaluate(()=>window.Veritas.videoAftersales.configure(async()=>{throw Error('网络中断，请重试');}));
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  await page.getByText('网络中断，请重试',{exact:true}).waitFor();
  assert.equal(await page.locator('.aftersales-video-item').count(),2);
  await page.evaluate(()=>window.Veritas.videoAftersales.configure(async()=>({accepted:true,receiptId:'receipt-003'})));
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  await page.getByText('材料已接收，回执：receipt-003',{exact:true}).waitFor();
  await mkdir('docs/screenshots',{recursive:true});
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await page.screenshot({path:'docs/screenshots/video-aftersales-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await page.screenshot({path:'docs/screenshots/video-aftersales-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'移除 故障.webm',exact:true}).click();
  assert.equal(await page.evaluate(()=>window.videoTestURLs.size),1);
  const transfer=await page.evaluateHandle(data=>{
    const dt=new DataTransfer();dt.items.add(new File([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],'<script>.webm',{type:'video/webm'}));return dt;
  },webm.buffer.toString('base64'));
  await page.locator('[data-video-drop]').dispatchEvent('drop',{dataTransfer:transfer});
  await page.getByRole('button',{name:'查看 <script>.webm',exact:true}).waitFor();
  await page.locator('input[type=file]').setInputFiles(Array.from({length:5},(_,i)=>({...mp4,name:`视频${i}.mp4`})));
  await page.waitForFunction(()=>document.querySelectorAll('.aftersales-video-item').length===5);
  assert.match(await page.locator('[data-video-errors]').innerText(),/最多添加 5/);
  await page.evaluate(()=>window.Veritas.videoAftersales.configure((snapshot,{signal})=>new Promise(resolve=>{window.videoSignal=signal;window.videoResolve=resolve;window.videoSnapshot=snapshot;})));
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  await page.getByRole('button',{name:'正在提交…',exact:true}).waitFor();
  assert.equal(await page.getByLabel('案件编号',{exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'查看 开箱.mp4',exact:true}).isDisabled(),false);
  await page.evaluate(()=>{location.hash='/image/refund';});
  await page.waitForFunction(()=>window.videoSignal.aborted&&!window.Veritas.videoAftersales.busy&&window.videoTestURLs.size===0);
  await page.evaluate(()=>{location.hash='/video/aftersales';});
  await page.getByLabel('案件编号',{exact:true}).waitFor();
  await page.evaluate(()=>window.videoResolve({accepted:true,receiptId:'late'}));
  assert.equal(await page.getByLabel('案件编号',{exact:true}).inputValue(),'');
  assert.equal(await page.locator('.aftersales-video-item').count(),0);
  assert.equal(await page.getByText(/late/).count(),0);
  // A legal MP4 free box before ftyp remains playable (adjust absolute chunk offsets).
  const leadingMp4=Buffer.from(mp4.buffer);
  for(let offset=4;offset<leadingMp4.length-12;offset++){
    if(leadingMp4.toString('ascii',offset,offset+4)!=='stco')continue;
    const count=leadingMp4.readUInt32BE(offset+8);
    for(let entry=0;entry<count;entry++){const position=offset+12+entry*4;leadingMp4.writeUInt32BE(leadingMp4.readUInt32BE(position)+8,position);}
  }
  await page.locator('input[type=file]').setInputFiles({name:'合法头部.mp4',mimeType:'video/mp4',buffer:Buffer.concat([Buffer.from([0,0,0,8,102,114,101,101]),leadingMp4])});
  await page.getByRole('button',{name:'查看 合法头部.mp4',exact:true}).waitFor({timeout:3000});
  await player.evaluate(video=>video.play());await player.evaluate(video=>video.pause());
  await page.getByRole('button',{name:'移除 合法头部.mp4',exact:true}).click();
  // Matroska shares EBML magic but must not pass as WebM merely by renaming.
  const docType=webm.buffer.indexOf(Buffer.from('webm'));
  const matroska=Buffer.concat([webm.buffer.subarray(0,docType),Buffer.from('matroska'),webm.buffer.subarray(docType+4)]);
  matroska[docType-1]+=4;matroska[4]+=4;
  await page.locator('input[type=file]').setInputFiles({name:'改名.webm',mimeType:'video/webm',buffer:matroska});
  await page.getByText(/改名.webm：文件内容/).waitFor({timeout:3000});
  assert.equal(await page.locator('.aftersales-video-item').count(),0);
  // A valid signature with no media streams must fail decoding, not enter the list.
  await page.locator('input[type=file]').setInputFiles({name:'截断.mp4',mimeType:'video/mp4',buffer:mp4.buffer.subarray(0,32)});
  await page.getByText(/截断.mp4：视频无法解码/).waitFor();
  assert.equal(await page.evaluate(()=>window.videoTestURLs.size),0);
  // Simulate a browser media loader that never fires, while exercising our real timeout/abort cleanup.
  await page.evaluate(()=>{
    const load=HTMLMediaElement.prototype.load;
    HTMLMediaElement.prototype.load=function(){if(!this.controls&&this.getAttribute('src')){this.removeAttribute('src');return;}return load.call(this);};
  });
  await page.locator('input[type=file]').setInputFiles(mp4);
  await page.getByText(/开箱.mp4：视频读取超时/).waitFor({timeout:20000});
  assert.equal(await page.evaluate(()=>window.videoTestURLs.size),0);
  await page.locator('input[type=file]').setInputFiles(mp4);
  await page.waitForFunction(()=>window.videoTestURLs.size===1);
  assert.equal(await page.getByRole('button',{name:'提交材料',exact:true}).isDisabled(),true);
  await page.evaluate(()=>{location.hash='/video';});
  await page.waitForFunction(()=>window.videoTestURLs.size===0);
  assert.deepEqual(errors,[]);assert.equal(requests.length,0);
  console.log('PASS video aftersales: real MP4/WebM playback, seek, validation, submission, navigation, desktop/mobile');
}finally{await browser.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

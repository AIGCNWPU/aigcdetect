// Optional browser QA: install playwright into tmp/browser-check; see integration guide.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const server=createServer({dist:process.env.REFUND_TEST_DIST==='1'});
server.listen(0,'127.0.0.1');
await once(server,'listening');
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1100}});
const errors=[], requests=[];
page.on('pageerror',e=>errors.push(e.message));
page.on('console',e=>{if(e.type()==='error') errors.push(e.text());});
page.on('request',r=>{if(r.url().includes('/api/v1/image/refund')) requests.push(r.url());});
await page.addInitScript(()=>{
  window.refundTestURLs=new Set();
  const create=URL.createObjectURL.bind(URL), revoke=URL.revokeObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=create(blob);window.refundTestURLs.add(url);return url;};
  URL.revokeObjectURL=url=>{window.refundTestURLs.delete(url);revoke(url);};
});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/#/image/refund`);
  await page.getByLabel('案件编号', {exact:true}).fill('AS-20261021-001');
  await page.getByLabel('商品名称', {exact:true}).fill('白色陶瓷马克杯');
  await page.getByLabel('商品款式', {exact:true}).fill('白色 / 300 mL');
  await page.getByLabel('商品资料', {exact:true}).fill('陶瓷材质，杯口圆润，带弧形手柄。');
  await page.getByLabel('问题描述', {exact:true}).fill('收到商品后发现杯口有缺损，请核对图片凭证。');
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  assert.match(await page.locator('[data-refund-status]').innerText(), /至少添加/);
  // Real PNG fixture generated locally; no image is sent to a backend.
  const png=await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
    const c=canvas.getContext('2d');c.fillStyle='#e9e7e2';c.fillRect(0,0,800,600);
    c.fillStyle='#d3cec5';c.fillRect(0,440,800,160);c.fillStyle='white';c.fillRect(230,155,270,290);
    c.strokeStyle='#fff';c.lineWidth=32;c.beginPath();c.arc(515,285,85,-Math.PI/2,Math.PI/2);c.stroke();
    c.fillStyle='#ece9e2';c.beginPath();c.ellipse(365,155,135,24,0,0,Math.PI*2);c.fill();
    c.fillStyle='#8a8176';c.font='20px sans-serif';c.fillText('本地测试图片 · 不用于检测',30,550);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const image={name:'杯口凭证.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')};
  await page.locator('input[type=file]').setInputFiles([image,{name:'坏图片.png',mimeType:'image/png',buffer:Buffer.from('broken')},{name:'资料.txt',mimeType:'text/plain',buffer:Buffer.from('hello')},{name:'空.png',mimeType:'image/png',buffer:Buffer.alloc(0)},{name:'超限.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1)}]);
  await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===1);
  await page.getByText('坏图片.png：', {exact:false}).waitFor();
  assert.match(await page.locator('[data-refund-errors]').innerText(), /资料.txt/);
  assert.match(await page.locator('[data-refund-errors]').innerText(), /文件为空/);
  assert.match(await page.locator('[data-refund-errors]').innerText(), /不能超过 5 MiB/);
  assert.equal(await page.getByLabel('商品名称',{exact:true}).inputValue(),'白色陶瓷马克杯');
  await page.getByRole('button',{name:'预览 杯口凭证.png',exact:true}).click();
  assert.equal(await page.locator('dialog').evaluate(d=>d.open),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').evaluate(d=>d.open),false);
  assert.equal(await page.getByRole('button',{name:'预览 杯口凭证.png',exact:true}).evaluate(e=>e===document.activeElement),true);
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  assert.match(await page.locator('[data-refund-status]').innerText(), /后端尚未接入/);
  assert.equal(requests.length,0);
  // Exercise the actual drop handler and safe filename rendering.
  const transfer=await page.evaluateHandle(data=>{
    const bytes=Uint8Array.from(atob(data),c=>c.charCodeAt(0));
    const dt=new DataTransfer();dt.items.add(new File([bytes],'<img onerror=alert(1)>.png',{type:'image/png'}));return dt;
  },png);
  await page.locator('[data-refund-drop]').dispatchEvent('drop',{dataTransfer:transfer});
  await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===2);
  assert.equal(await page.locator('.refund-image-item img').count(),2);
  await page.getByRole('button',{name:'移除 <img onerror=alert(1)>.png',exact:true}).click();
  assert.equal(await page.locator('.refund-image-item').count(),1);
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await mkdir('docs/screenshots',{recursive:true});
  await page.screenshot({path:'docs/screenshots/image-refund-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.getByRole('button',{name:'预览 杯口凭证.png',exact:true}).click();
  assert.equal(await page.locator('dialog').evaluate(d=>d.open),true);
  await page.getByRole('button',{name:'关闭预览',exact:true}).click();
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0);});
  await page.screenshot({path:'docs/screenshots/image-refund-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'移除 杯口凭证.png',exact:true}).click();
  assert.equal(await page.locator('.refund-image-item').count(),0);
  assert.equal(await page.getByLabel('案件编号',{exact:true}).inputValue(),'AS-20261021-001');
  assert.equal(await page.evaluate(()=>window.refundTestURLs.size),0);
  await page.locator('input[type=file]').setInputFiles(Array.from({length:12},(_,i)=>({...image,name:`凭证${i}.png`})));
  await page.waitForFunction(()=>document.querySelectorAll('.refund-image-item').length===10);
  assert.match(await page.locator('[data-refund-errors]').innerText(),/最多添加 10 张/);
  await page.evaluate(()=>{window.Veritas.refund.configure((snapshot,{signal})=>new Promise(resolve=>{window.refundTestSignal=signal;window.refundTestResolve=resolve;}));});
  await page.getByRole('button',{name:'提交材料',exact:true}).click();
  await page.getByRole('button',{name:'正在提交…',exact:true}).waitFor();
  assert.equal(await page.getByLabel('案件编号',{exact:true}).isDisabled(),true);
  assert.match(await page.locator('[data-refund-status]').innerText(),/可以离开页面/);
  await page.getByRole('link',{name:'返回场景列表'}).click();
  await page.waitForURL('**/#/image');
  await page.waitForFunction(()=>window.refundTestSignal.aborted && window.refundTestURLs.size===0 && !window.Veritas.refund.busy);
  await page.evaluate(()=>{window.refundTestResolve({accepted:true,receiptId:'late'});location.hash='/image/refund';});
  await page.getByLabel('案件编号',{exact:true}).waitFor();
  assert.equal(await page.locator('.refund-image-item').count(),0);
  assert.doesNotMatch(await page.locator('[data-refund-status]').innerText(),/late|已接收/);
  await page.reload();
  assert.equal(await page.getByLabel('案件编号',{exact:true}).inputValue(),'');
  assert.equal(await page.locator('.refund-image-item').count(),0);
  assert.deepEqual(errors,[]);
  console.log('Browser QA passed: form, mixed files, drag/drop, preview/focus, remove, backend boundary, refresh, desktop/mobile, no page errors.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
}

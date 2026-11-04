// Optional QA: PLAYWRIGHT_MODULE=file:///.../playwright-core/index.mjs BROWSER_EXECUTABLE=/.../chrome node tests/image-client-integration.browser.mjs
import assert from 'node:assert/strict';
import {zipSync} from 'fflate';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {generalShowcase} from '../src/modules/image/general/example.js';
import {createServer} from '../scripts/serve.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'../tmp/browser-check/node_modules/playwright/index.mjs');
const server=createServer({dist:true,proxy:false});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
 browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{}),args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),actions=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/v1/image/documents',async route=>{
  const payload=route.request().postDataJSON();actions.push(payload.action);
  const data=payload.action==='review'?{status:'queued',reviewId:'browser-test'}:{status:'completed',reviewId:'browser-test',materials:[]};
  await route.fulfill({status:payload.action==='review'?202:200,contentType:'application/json',body:JSON.stringify({data,requestId:'browser-test'})});
 });
 const generalActions=[];let uploadedId;
 await page.route('**/api/v1/image/general',async route=>{
  const payload=route.request().postDataJSON();generalActions.push(payload.action);
  if(payload.action==='detect')uploadedId=payload.id;
  const data=payload.action==='detect'?{status:'queued',jobId:'test-image',queuePosition:2,summary:'检测资源繁忙，正在排队等待，空闲后将自动开始。'}:{...generalShowcase,id:uploadedId,status:'completed'};
  await route.fulfill({status:payload.action==='detect'?202:200,contentType:'application/json',body:JSON.stringify({data,requestId:'browser-test'})});
 });
 await page.goto(base+'/#/image/general');await page.locator('.ig-benchmark').waitFor();
 assert.deepEqual(await page.locator('.ig-benchmark th[scope=col]').allTextContents(),['生成模型','智鉴','PGC · ICML 2026','PROBE · ICML 2026','SAFE · KDD 2025']);
 await page.locator('.ig-showcase .ig-diagnostic-tile').first().click();assert(await page.locator('.ig-diagnostic-modal').isVisible());await page.keyboard.press('Escape');await page.locator('.ig-diagnostic-modal').waitFor({state:'detached'});assert.equal(await page.locator('.ig-diagnostic-modal').count(),0);
 assert.equal(generalActions.length,0);assert.equal(await page.locator('.ig-showcase + .ig-benchmark').count(),1);
 await page.locator('#ig-files').setInputFiles(fileURLToPath(new URL('../public/image-examples/watch/original.png',import.meta.url)));
 await page.locator('.ig-file').first().waitFor();await page.locator('#ig-start').click();
 assert.match(await page.locator('.ig-progress').innerText(),/队列|等待/);
 await page.waitForFunction(()=>document.querySelector('.ig-result.likely_ai'));
 assert.deepEqual(generalActions,['detect','status']);assert.equal(await page.locator('.ig-showcase').count(),1);
 await page.locator('#ig-clear').click();assert.equal(await page.locator('.ig-file').count(),0);assert.equal(await page.locator('.ig-showcase').count(),1);
 const sample=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=','base64');
 const zipEntries={};for(let i=0;i<101;i++)zipEntries[`image-${i}.png`]=sample;
 await page.locator('#ig-files').setInputFiles({name:'batch.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync(zipEntries))});
 await page.waitForFunction(()=>document.querySelectorAll('.ig-file').length===100,{},{timeout:60000});
 assert.match(await page.locator('.ig-alert').innerText(),/100/);
 assert.match(await page.locator('.ig-browser-title').innerText(),/100 \/ 100/);
 assert(await page.locator('#ig-next').isDisabled());
 await page.locator('#ig-prev').click();assert.match(await page.locator('.ig-browser-title').innerText(),/99 \/ 100/);
 await page.keyboard.press('ArrowLeft');assert.match(await page.locator('.ig-browser-title').innerText(),/98 \/ 100/);
 await page.locator('.ig-filmstrip button').last().click();assert.match(await page.locator('.ig-browser-title').innerText(),/100 \/ 100/);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000});

 await page.locator('#ig-clear').click();
 await page.locator('#ig-showcase-marks').uncheck();assert(await page.locator('.ig-showcase-overlay').isHidden());
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.setViewportSize({width:1440,height:1000});
 await page.goto(base+'/#/image/documents');await page.locator('#doc-files').setInputFiles({name:'client-test.png',mimeType:'image/png',buffer:Buffer.from([1,2,3])});
 await page.locator('input[name="doc-core"]').first().check();await page.locator('#doc-start').click();
 await page.waitForFunction(()=>document.querySelector('#doc-start')&&!document.querySelector('#doc-start').disabled);
 assert(actions.includes('review'));assert(actions.includes('status'));assert.equal(await page.locator('.doc-error').count(),0);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
 console.log('Image client integration passed: product table, upload/poll envelopes and mobile layout; no real detection calls.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

// Optional QA: PLAYWRIGHT_MODULE=file:///.../playwright-core/index.mjs BROWSER_EXECUTABLE=/.../chrome node tests/image-client-integration.browser.mjs
import assert from 'node:assert/strict';
import {once} from 'node:events';
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
 await page.goto(base+'/#/image/general');await page.locator('.ig-benchmark').waitFor();
 assert.deepEqual(await page.locator('.ig-benchmark th[scope=col]').allTextContents(),['生成模型','智鉴','方法1','方法2','方法3']);
 await page.goto(base+'/#/image/documents');await page.locator('#doc-files').setInputFiles({name:'client-test.png',mimeType:'image/png',buffer:Buffer.from([1,2,3])});
 await page.locator('input[name="doc-core"]').first().check();await page.locator('#doc-start').click();
 await page.waitForFunction(()=>document.querySelector('#doc-start')&&!document.querySelector('#doc-start').disabled);
 assert(actions.includes('review'));assert(actions.includes('status'));assert.equal(await page.locator('.doc-error').count(),0);
 await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
 console.log('Image client integration passed: product table, upload/poll envelopes and mobile layout; no real detection calls.');
}finally{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}

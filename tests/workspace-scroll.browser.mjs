import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import {createServer} from '../scripts/serve.mjs';
import {once} from 'node:events';
import assert from 'node:assert/strict';
// Build dist before running; no model inference is triggered.
const server=createServer({dist:true});server.listen(0,'127.0.0.1');await once(server,'listening');
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'msedge',headless:true});
const routes=['/text/academic','/text/news','/text/novel','/image/general','/image/refund','/image/documents','/video/general','/video/deepfake','/video/aftersales','/audio/forgery'];
const results=[];const errors=[];
try{
 for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:1280,height:480}]){
 const page=await browser.newPage({viewport});page.on('pageerror',e=>errors.push(e.message));
 for(const route of routes){
 await page.goto(base+'/#'+route,{waitUntil:'domcontentloaded'});await page.locator('#scenario-workspace > *').first().waitFor({state:'attached'});await page.waitForTimeout(80);
 const initial=await page.evaluate(()=>{const main=document.querySelector('main'),w=document.querySelector('.feature-workspace'),c=getComputedStyle(main);return {overflowY:c.overflowY,mainHeight:main.clientHeight,scrollHeight:main.scrollHeight,workspaceHeight:w.clientHeight,workspaceScrollHeight:w.scrollHeight,mainBottom:main.getBoundingClientRect().bottom,viewportHeight:innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth+1};});
 const main=page.locator('main');await main.hover({position:{x:Math.min(100,viewport.width/4),y:70}});await page.mouse.wheel(0,800);await page.waitForTimeout(60);
 const moved=await main.evaluate(m=>m.scrollTop);
 const bottom=await main.evaluate(m=>{m.scrollTop=m.scrollHeight;const f=m.querySelector('footer');return {scrollTop:m.scrollTop,footerBottom:f.getBoundingClientRect().bottom,mainBottom:m.getBoundingClientRect().bottom};});
 const passed=['auto','scroll'].includes(initial.overflowY)&&initial.mainBottom<=viewport.height+1&&!initial.horizontalOverflow&&(initial.scrollHeight<=initial.mainHeight+2||moved>0)&&bottom.footerBottom<=Math.min(bottom.mainBottom,viewport.height)+2&&initial.workspaceScrollHeight<=initial.workspaceHeight+2;
 results.push({route,viewport,...initial,wheelMoved:moved>0,bottom,passed});console.log(JSON.stringify({route,viewport,passed,overflowY:initial.overflowY,wheelMoved:moved>0,clipped:initial.workspaceScrollHeight-initial.workspaceHeight}));
 }
 await page.close();
 }
 assert.deepEqual(errors,[],'unexpected browser exception');
 for(const result of results)assert.ok(result.passed,JSON.stringify(result));
 console.log(JSON.stringify({passed:results.filter(x=>x.passed).length,failed:results.filter(x=>!x.passed).length,errors}));
}finally{await browser.close();server.close();}



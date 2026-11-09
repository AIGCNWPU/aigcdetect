// Manual acceptance against real local model services; no API interception.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=process.env.AIGC_PLATFORM_ROOT;
const output=path.join(root,'runtime/replay/forensics-20261105/browser');
await mkdir(output,{recursive:true});
const faceRows=JSON.parse(await readFile(path.join(root,'runtime/replay/forensics-20261105/face-predictions.json')));
const face=faceRows.find(row=>row.manipulation==='face_swap'&&row.score>.5);
const sourceRows=JSON.parse(await readFile(path.join(root,'datasets/forensics-20261105/dragon/manifest.json')));
const source=sourceRows.find(row=>row.source==='SD_1.5');
const compressed=path.join(output,'source-quality95.jpg');
assert(face&&source,'Real evaluation fixtures are required');
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
const errors=[],reports=[],captures=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',error=>errors.push(error.message));
 page.on('response',response=>{
  if(response.url().endsWith('/api/v1/image/general')){
   captures.push(response.json().then(body=>{if(body.data?.status==='completed')reports.push(body.data);}).catch(()=>{}));
  }
 });
 await page.goto((process.env.FORENSICS_BASE_URL||'http://127.0.0.1:4186')+'/#/image/general');
 await page.locator('#ig-files').setInputFiles([face.path,source.path,compressed]);
 await page.locator('#ig-start').click();
 await page.waitForFunction(()=>document.querySelector('.ig-stats')&&[...document.querySelectorAll('.ig-stats')].some(n=>n.textContent==='已完成 3 / 3 张'),null,{timeout:240000});
 await Promise.all(captures);
 assert.equal(reports.length,3);
 for(const report of reports){
  assert.equal(report.status,'completed');assert.equal(report.forensics.face.status==='failed',false);
  assert.equal(report.forensics.source.status,'completed');assert.equal(report.forensics.source.sourceVerdict,null);
 }
 await page.locator('#ig-prev').click();
 await page.locator('#ig-prev').click();
 assert(await page.locator('.ig-companions').isVisible());
 assert(await page.locator('.ig-face-preview').isVisible());
 assert(await page.locator('.ig-face-box').count()>0);
 await page.locator('.ig-face-box').first().click();
 assert.equal(new URL(page.url()).hash,'#/image/general');
 await page.locator('.ig-companions').screenshot({path:path.join(output,'face-desktop.png')});
 await page.locator('#ig-next').click();
 assert(await page.locator('.ig-source-candidates').isVisible());
 assert.match(await page.locator('.ig-source-analysis').innerText(),/候选归因 · 尚未确认/);
 await page.screenshot({path:path.join(output,'source-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('.ig-companions').screenshot({path:path.join(output,'source-mobile.png')});
 await page.setViewportSize({width:1440,height:1100});
 await page.locator('#ig-next').click();
 assert.match(await page.locator('.ig-source-analysis').innerText(),/压缩图片 · 来源待核验/);
 assert(await page.locator('.ig-source-candidates').isHidden());
 await page.locator('.ig-source-reference summary').click();
 assert(await page.locator('.ig-source-candidates').isVisible());
 await page.locator('.ig-companions').screenshot({path:path.join(output,'compressed-reference.png')});
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'reports.json'),JSON.stringify(reports,null,2));
 await writeFile(path.join(output,'acceptance.json'),JSON.stringify({status:'passed',realUploads:3,apiIntercepted:false,desktop:[1440,1100],mobile:[390,844],pageErrors:errors,faceFixture:face.path,sourceFixture:source.path,compressedFixture:compressed},null,2));
 console.log('Real model browser acceptance passed: three uploads, primary result, face boxes, source candidates, compressed-image guard, desktop/mobile.');
}finally{await browser.close();}

// Real local backend acceptance. The unsigned fixture is deliberately synthetic metadata.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE);
const root=process.env.AIGC_PLATFORM_ROOT;
const output=path.join(root,'runtime/research/provenance-trufor-20261105/browser');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.BROWSER_EXECUTABLE,args:['--no-sandbox']});
const errors=[],reports=[],captures=[];
try{
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().endsWith('/api/v1/image/general'))captures.push(r.json().then(b=>{if(b.data?.status==='completed')reports.push(b.data);}).catch(()=>{}));});
 await page.goto((process.env.FORENSICS_BASE_URL||'http://127.0.0.1:4186')+'/#/image/general');
 await page.locator('#ig-files').setInputFiles([path.join(root,'datasets/provenance-20261105/unsigned-test.png'),path.join(root,'datasets/provenance-20261105/ChatGPT_Image.png'),path.join(root,'third_party/trufor/test_docker/images/tampered2.png')]);
 await page.locator('#ig-start').click();
 await page.waitForFunction(()=>[...document.querySelectorAll('.ig-stats')].some(n=>n.textContent==='已完成 3 / 3 张'),null,{timeout:240000});
 await Promise.all(captures);
 assert.equal(reports.length,3);
 for(const r of reports){assert.equal(r.diagnostics.providerChecks.checks.length,3);assert.equal(r.diagnostics.providerChecks.network,'disabled');assert.equal(r.forensics.tamper.status,'completed');assert(Number.isFinite(r.forensics.tamper.score));assert(r.forensics.tamper.anomalyMap.startsWith('data:image/png;base64,'));}
 assert.equal(reports[0].diagnostics.sourceDeclarations.status,'found');
 assert.equal(reports[0].diagnostics.sourceDeclarations.sourceVerdict,null);
 assert.equal(reports[1].diagnostics.credentials.signer,'OpenAI');
 await page.locator('#ig-prev').click();
 await page.locator('#ig-prev').click();
 assert.match(await page.locator('.ig-results-panel .ig-file-evidence').innerText(),/已读取来源声明/);
 await page.locator('.ig-results-panel [data-evidence-title="AI 来源声明"]').click();
 assert.match(await page.locator('dialog').innerText(),/测试生成平台/);
 await page.getByRole('button',{name:'关闭核查细节'}).click();
 assert.equal(await page.locator('.ig-results-panel .ig-evidence-grid [data-evidence-open]').count(),5);
 await page.locator('.ig-results-panel .ig-file-evidence').screenshot({path:path.join(output,'unsigned-desktop.png')});
 await page.locator('#ig-next').click();
 assert.match(await page.locator('.ig-results-panel .ig-file-evidence').innerText(),/OpenAI/);
 await page.locator('.ig-results-panel .ig-file-evidence').screenshot({path:path.join(output,'c2pa-desktop.png')});
 await page.setViewportSize({width:390,height:844});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('.ig-results-panel .ig-file-evidence').screenshot({path:path.join(output,'c2pa-mobile.png')});
 await page.locator('#ig-next').click();
 assert(await page.locator('.ig-results-panel .ig-tamper-evidence').isVisible());
 assert.equal(await page.locator('.ig-results-panel .ig-tamper-maps figure').count(),3);
 await page.locator('.ig-results-panel .ig-tamper-evidence').screenshot({path:path.join(output,'trufor-mobile.png')});
 await page.setViewportSize({width:1440,height:1100});
 await page.locator('.ig-results-panel .ig-tamper-evidence').screenshot({path:path.join(output,'trufor-desktop.png')});
 assert.deepEqual(errors,[]);
 await writeFile(path.join(output,'reports.json'),JSON.stringify(reports,null,2));
 await writeFile(path.join(output,'acceptance.json'),JSON.stringify({status:'passed',uploads:3,apiIntercepted:false,errors},null,2));
 console.log('File-source browser acceptance passed: real backend, unsigned fixture, public ChatGPT example and TruFor tampered image, desktop/mobile.');
}finally{await browser.close();}

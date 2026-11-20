// Browser regression only: all review responses below are synthetic fixtures; no inference or cloud calls.
// DOCUMENTS_TEST_URL=http://127.0.0.1:4190 PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node scripts/image-validation/check-documents-ux.mjs
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright-core');
const base=process.env.DOCUMENTS_TEST_URL||'http://127.0.0.1:4190';
const output=process.env.DOCUMENTS_TEST_OUTPUT;
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const material=(id,name)=>({id,name,type:'invoice',status:'completed',fields:[],checks:[],stages:{mirror:{status:'completed',score:.8},seed:{status:'completed',score:.9}},pages:[{page:1,status:'completed',rendered_size:[600,400],previewDataUrl:'data:image/png;base64,'+png,regions:[{box:[10,10,80,80]}],blur:{regions:[{left:100,top:20,width:40,height:30,severity:.8}]}}]});
function result(files=[{id:'a',name:'交互测试A.png'},{id:'b',name:'交互测试B.png'}]) {
 const materials=files.map(f=>material(f.id,f.name));
 return {status:'completed',reviewId:'browser-fixture',materials,presentation:{aiReview:{status:'completed',summary:'交互回归测试数据',findings:materials.map(m=>({id:m.id,materialIds:[m.id],verdict:'issues_found',warning:'测试核验内容展示',explanation:'仅测试布局与状态保持',evidence:['name','invoice_number','gross_amount','tax_amount','invoice_date','net_amount'].map((key,i)=>({materialId:m.id,fieldId:'f'+i,key,value:String(100+i),source:{page:1}}))}))}}};
}
const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--no-proxy-server']});
const checks=[],errors=[];
try {
 const page=await browser.newPage({viewport:{width:1600,height:1100}});page.on('pageerror',e=>errors.push(e.message));
 let active=result(),polls=0,complete=false,lastRequest;
 await page.route('**/api/v1/image/documents',async route=>{
  const req=route.request().postDataJSON();let data;
  if(req.action==='example')data=result();
  else if(req.action==='status'){polls++;data={...active,status:complete?'completed':'running'};}
  else {lastRequest=req;active=result(req.files);data={...active,status:'running'};}
  await route.fulfill({json:{data}});
 });
 await page.goto(base+'/#/image/documents');await page.locator('#doc-result-select').waitFor();
 assert.deepEqual(await page.locator('#doc-objective option').allTextContents(),['发票核验','证件核验','票据核验','其他核验']);
 for(const text of ['以上为材料建议','关闭中国票面格式规则','单材料独立核验 ·','任务级一次复核'])assert.ok(!(await page.locator('.doc-workspace').innerText()).includes(text));
 const preview=page.locator('.doc-visible-preview');
 for(const kind of ['tamper','blur'])await preview.locator(`[data-doc-layer-toggle="${kind}"]`).uncheck();
 await page.locator('#doc-result-select').selectOption('b');
 assert.equal(await preview.locator('[data-doc-layer-toggle="blur"]').isChecked(),true);
 await page.locator('#doc-result-select').selectOption('a');
 for(const kind of ['tamper','blur']){assert.equal(await preview.locator(`[data-doc-layer-toggle="${kind}"]`).isChecked(),false);assert.equal(await preview.locator(`[data-doc-layer="${kind}"]`).isVisible(),false);}
 await page.locator('[data-doc-view-locations]').first().click();
 const dialog=page.locator('[data-doc-location-viewer]');await dialog.waitFor({state:'visible'});
 await dialog.locator('[data-doc-layer-toggle="tamper"]').uncheck();
 await dialog.locator('[data-doc-close-viewer]').click();
 assert.equal(await preview.locator('[data-doc-layer-toggle="tamper"]').isChecked(),false);
 checks.push('图层按文件保存，切换文件/弹窗保持一致');
 // Expansion displays six fields in three columns, then two/one on smaller screens.
 const details=page.locator('[data-doc-section="local"] .doc-smart-finding details').first();
 await details.locator('summary').click();
 for(const [width,columns] of [[1600,3],[900,2],[390,1]]) {
  await page.setViewportSize({width,height:1100});
  const cards=await details.locator('.doc-evidence-item').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,y:n.getBoundingClientRect().y})));
  assert.equal(cards.filter(c=>Math.abs(c.y-cards[0].y)<2).length,columns);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(output){await mkdir(output,{recursive:true});await details.screenshot({path:`${output}/fields-${width}.png`});}
 }
 checks.push('核验字段桌面三列/平板两列/手机一列，无横向溢出');
 await page.setViewportSize({width:1600,height:1100});
 await page.locator('#doc-clear').click();assert.equal(await page.locator('[data-doc-result]').count(),0);
 const upload=name=>({name,mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await page.locator('#doc-files').setInputFiles([upload('第一份.png'),upload('第二份.png')]);
 assert.equal(await page.locator('[data-remove]').count(),2);
 const options=await page.locator('[data-type]').first().locator('option').allTextContents();
 assert.equal(options[0],'智能选择');
 for(const label of ['科研审批','项目审批','出差审批','验收记录','证明'])assert.ok(!options.includes(label));
 await page.locator('[data-remove]').first().click();assert.equal(await page.locator('[data-remove]').count(),1);
 await page.locator('#doc-clear').click();assert.equal(await page.locator('[data-remove]').count(),0);
 await page.locator('#doc-files').setInputFiles([upload('新材料A.png'),upload('新材料B.png')]);
 await page.locator('#doc-objective').selectOption('other_review');
 await page.locator('#doc-semantic').uncheck();
 await page.locator('#doc-start').click();await page.locator('#doc-result-select').waitFor();
 for(const kind of ['tamper','blur'])await preview.locator(`[data-doc-layer-toggle="${kind}"]`).uncheck();
 await page.waitForTimeout(3300);assert.ok(polls>=2);
 for(const kind of ['tamper','blur'])assert.equal(await preview.locator(`[data-doc-layer-toggle="${kind}"]`).isChecked(),false);
 complete=true;await page.waitForFunction(()=>!document.querySelector('#doc-clear').disabled);
 for(const kind of ['tamper','blur'])assert.equal(await preview.locator(`[data-doc-layer-toggle="${kind}"]`).isChecked(),false);
 assert.equal(lastRequest.objective,'other_review');assert.deepEqual(lastRequest.files.map(f=>f.name),['新材料A.png','新材料B.png']);
 assert.ok(lastRequest.files.every(f=>f.materialType==='unknown'));
 checks.push('轮询及完成重绘不重置图层；删除、清空后新请求无旧材料');
 assert.deepEqual(errors,[]);
} finally {
 await browser.close();
 if(output){await mkdir(output,{recursive:true});await writeFile(output+'/browser-results.json',JSON.stringify({synthetic:true,checks,errors},null,2));}
}
console.log(JSON.stringify({checks,errors},null,2));

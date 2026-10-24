import assert from 'node:assert/strict';
import { scenarios } from '../src/catalog.js';
const base=process.env.SMOKE_BASE_URL||`http://127.0.0.1:${process.env.PORT||4173}`;
const page=await fetch(base);
assert.equal(page.status,200);
const html=await page.text();
assert.match(html,/assets\/app.js/,'应检查构建后的版本，请先运行 npm run build 和 npm start');
assert.equal((await fetch(base+'/assets/app.js')).status,200);
assert.equal((await fetch(base+'/assets/styles.css')).status,200);
assert.equal((await (await fetch(base+'/api/v1/catalog')).json()).counts.scenarios,10);
for(const scene of scenarios){
  const response=await fetch(base+scene.api.path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  if(scene.api.implemented){
    assert.equal(response.status,400,scene.path); // 已接入业务：空 JSON 缺少视频字段
    assert.equal((await response.json()).error.code,'VALIDATION_ERROR');
  } else {
    assert.equal(response.status,501,scene.path);
    assert.equal((await response.json()).error.code,'NOT_IMPLEMENTED');
  }
}
console.log('Smoke passed: built HTML/JS/CSS, catalog, 1 implemented + 9 explicit 501 scene endpoints.');

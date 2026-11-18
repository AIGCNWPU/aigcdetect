import assert from 'node:assert/strict';
import { once } from 'node:events';
import { scenarios } from '../src/catalog.js';
import { createServer } from './serve.mjs';

let server;
let base=process.env.SMOKE_BASE_URL;
if(!base){
  server=createServer({dist:true,textModelClient:{analyze:async()=>({findings:[]})}});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  base=`http://127.0.0.1:${server.address().port}`;
}
try{
  const page=await fetch(base);
  assert.equal(page.status,200);
  const html=await page.text();
  const entry=/assets\/entry-[A-Z0-9]+\.js/.exec(html)?.[0];
  assert.ok(entry,'应检查构建后的版本，请先运行 npm run build');
  const entryResponse=await fetch(`${base}/${entry}`);
  assert.equal(entryResponse.status,200);
  assert.match(entryResponse.headers.get('cache-control'),/immutable/);
  assert.equal(page.headers.get('cache-control'),'no-store');
  const entrySource=await entryResponse.text();
  for(const asset of [/\.\/app-[A-Z0-9]+\.js/,/\.\/styles-[A-Z0-9]+\.css/]){
    const name=asset.exec(entrySource)?.[0];
    assert.ok(name,`构建入口缺少 ${asset}`);
    assert.equal((await fetch(new URL(name,`${base}/${entry}`))).status,200);
  }
  assert.equal((await (await fetch(base+'/api/v1/catalog')).json()).counts.scenarios,10);
  for(const scene of scenarios.filter(item=>!item.api.implemented)){
    const response=await fetch(base+scene.api.path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(response.status,501,scene.path);
    assert.equal((await response.json()).error.code,'NOT_IMPLEMENTED');
  }
  const news=await fetch(base+'/api/v1/text/news',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'analyze',material:{title:'冒烟新闻',content:'用于构建版冒烟测试的新闻正文。'},checks:['proofreading']})});
  assert.equal(news.status,200);
  const novel=await fetch(base+'/api/v1/text/novel',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'analyze',work:{title:'冒烟作品'},chapters:[{localId:'1',title:'第一章',content:'用于构建版冒烟测试的小说正文。'}],checks:['padding']})});
  assert.equal(novel.status,200);
  const invalidImport=await fetch(base+'/api/v1/text/novel/import',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(invalidImport.status,400);
  assert.equal((await invalidImport.json()).error.code,'INVALID_URL');
  const invalidNewsImport=await fetch(base+'/api/v1/text/news/import',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(invalidNewsImport.status,400);
  assert.equal((await invalidNewsImport.json()).error.code,'INVALID_URL');
  const materials=await fetch(base+'/api/v1/image/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'scenarios'})});
  assert.equal(materials.status,200);
  for(const name of ['src/modules/image/documents/server/review-agent.js','src/modules/image/general/analyze.py'])assert.equal((await fetch(base+'/'+name)).status,404);
  console.log('Smoke passed: built HTML/JS/CSS, catalog, news proofreading, novel quality detection, pending endpoints and import validation.');
}finally{
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}

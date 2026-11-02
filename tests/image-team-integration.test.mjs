import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../scripts/serve.mjs';
import {createOpenApi} from '../scripts/openapi.mjs';

test('图片核验接入总项目：路由、跨站检查、静态隔离与其他模块契约同时保留',async()=>{
 const spec=createOpenApi();
 for(const route of ['/api/v1/image/general','/api/v1/image/documents','/api/v1/image/refund','/api/v1/video/aftersales','/api/v1/text/news','/api/v1/text/novel','/api/v1/video/general','/api/v1/video/deepfake'])assert.ok(spec.paths[route].post['x-implemented'],route);
 for(const name of ['ReviewSubmit','ReviewJob','NewsAnalysisRequest','NovelAnalysisRequest'])assert.ok(spec.components.schemas[name]);
 const server=createServer({proxy:false});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 try {
  const directory=await fetch(base+'/api/v1/image/documents',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'scenarios'})});assert.equal(directory.status,200);
  for(const route of ['general','documents']) {
   const denied=await fetch(base+`/api/v1/image/${route}`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.invalid'},body:'{}'});assert.equal(denied.status,403);
  }
  for(const file of ['src/modules/image/general/analyze.py','src/modules/image/documents/server/review-agent.js','src/server/env.js','.env','package.json'])assert.equal((await fetch(base+'/'+file)).status,404,file);
  for(const file of ['src/modules/image/pages/general.js','src/modules/image/pages/documents.js','src/modules/image/pages/refund.js','src/modules/video/pages/general.js'])assert.equal((await fetch(base+'/'+file)).status,200,file);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

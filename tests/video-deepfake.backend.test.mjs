import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createServer} from '../scripts/serve.mjs';

async function listen(server) { server.listen(0,'127.0.0.1'); await once(server,'listening'); return `http://127.0.0.1:${server.address().port}`; }
async function close(server) { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }

test('换脸网关转发multipart和健康状态，保留失败语义并拒绝错误输入',async()=>{
  let upstreamCalls=0;
  const detector=http.createServer(async(req,res)=>{
    upstreamCalls++;
    if(req.url==='/health') { res.setHeader('Content-Type','application/json'); return res.end(JSON.stringify({ready:true,model:'test-detector'})); }
    let body='';for await(const chunk of req) body+=chunk;
    assert.match(req.headers['content-type'],/^multipart\/form-data/);
    assert.match(body,/name="video"/);
    assert.match(body,/fake-video-bytes/);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{risk:'unknown',persons:[]}}));
  });
  const upstream=await listen(detector);const gateway=createServer({deepfakeServiceUrl:upstream});const base=await listen(gateway);
  try {
    let response=await fetch(base+'/api/v1/video/deepfake/health');assert.equal(response.status,200);assert.equal((await response.json()).ready,true);
    const form=new FormData();form.set('video',new Blob(['fake-video-bytes'],{type:'video/mp4'}),'test.mp4');
    response=await fetch(base+'/api/v1/video/deepfake',{method:'POST',body:form});assert.equal(response.status,200);assert.equal((await response.json()).data.risk,'unknown');
    const before=upstreamCalls;
    response=await fetch(base+'/api/v1/video/deepfake',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,400);assert.equal(upstreamCalls,before);
    assert.equal((await fetch(base+'/api/v1/video/deepfake')).status,405);
    await close(detector);
    response=await fetch(base+'/api/v1/video/deepfake/health');assert.equal(response.status,503);assert.equal((await response.json()).error.code,'MODEL_UNAVAILABLE');
  } finally { await close(gateway); if(detector.listening)await close(detector); }
});

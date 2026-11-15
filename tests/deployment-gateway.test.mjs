import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../scripts/serve.mjs';
import { openDatabase } from '../src/server/db.js';

const listen=async server=>{await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${server.address().port}`;};
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

test('deployment forwards audio health/uploads and image submit/poll without changing the envelope',async()=>{
  const calls=[];
  const upstream=http.createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    calls.push({url:req.url,method:req.method,body});
    res.setHeader('Content-Type','application/json');
    if(req.url==='/api/v1/health')return res.end(JSON.stringify({status:'ok',modelLoaded:true}));
    const payload=JSON.parse(body);
    res.statusCode=payload.action==='detect'?202:200;
    res.end(JSON.stringify({data:{...payload,status:payload.action==='status'?'completed':'queued'},requestId:'upstream-id'}));
  });
  const url=await listen(upstream);
  const gateway=createServer({proxy:true,audioServiceUrl:url,imageServiceUrl:url});
  const base=await listen(gateway);
  try {
    const health=await fetch(base+'/api/v1/audio/health');assert.equal(health.status,200);assert.equal((await health.json()).modelLoaded,true);
    for(const [route,payload,expected] of [
      ['/api/v1/audio/forgery',{audioBase64:'dGVzdA==',fileName:'test.wav'},200],
      ['/api/v1/image/general',{action:'detect',id:'image-1'},202],
      ['/api/v1/image/general',{action:'status',jobId:'job-1'},200],
      ['/api/v1/image/documents',{action:'scenarios'},200],
    ]) {
      const response=await fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      assert.equal(response.status,expected);const body=await response.json();assert.equal(body.requestId,'upstream-id');assert.deepEqual(calls.at(-1),{url:route,method:'POST',body:JSON.stringify(payload)});
    }
    const count=calls.length;
    assert.equal((await fetch(base+'/api/v1/image/general',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'})).status,403);
    assert.equal((await fetch(base+'/api/v1/audio/forgery')).status,405);
    assert.equal(calls.length,count);
  } finally {await close(gateway);await close(upstream);}
});

test('existing SQLite account/session contract survives gateway integration',async()=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'veritas-auth-test-'));
  const db=openDatabase(path.join(dir,'app.db'));
  const gateway=createServer({proxy:false});const base=await listen(gateway);
  try {
    assert.deepEqual(await (await fetch(base+'/api/v1/auth/me',{headers:{Cookie:'broken=%ZZ'}})).json(),{user:null});
    const response=await fetch(base+'/api/v1/auth/register',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify({username:'deployment_test',password:'local-test-password'})});
    assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Lax;.*Secure/);
    const cookie=response.headers.get('set-cookie').split(';')[0];
    const user=(await response.json()).user;assert.equal(user.credits,100);
    const me=await (await fetch(base+'/api/v1/auth/me',{headers:{Cookie:cookie}})).json();assert.equal(me.user.id,user.id);
    const credits=await (await fetch(base+'/api/v1/me/credits',{headers:{Cookie:cookie}})).json();assert.equal(credits.credits,100);assert.equal(credits.ledger.length,1);
    assert.equal(db.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
    assert.equal((await fetch(base+'/api/v1/auth/logout',{method:'POST',headers:{Cookie:cookie}})).status,200);
    assert.deepEqual(await (await fetch(base+'/api/v1/auth/me',{headers:{Cookie:cookie}})).json(),{user:null});
    assert.equal((await fetch(base+'/api/v1/me/credits')).status,401);
  } finally {await close(gateway);db.close();await rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:50});}
});

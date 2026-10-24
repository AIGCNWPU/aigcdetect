import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { modules, scenarios } from '../src/catalog.js';
import { api } from '../src/api.js';
import { createOpenApi } from '../scripts/openapi.mjs';
import { createServer } from '../scripts/serve.mjs';

test('4 个模块、10 个独立场景，不包含子功能入口',async()=>{
  assert.equal(modules.length,4);
  assert.equal(scenarios.length,10);
  assert.deepEqual(scenarios.map(item=>item.title),[
    'AI论文与学术稿件检测','AI新闻稿与投稿内容检测','AI网文与小说内容检测',
    '通用AI生成图片检测','仅退款与售后AI凭证检测','AI证件与票据图片检测',
    '通用AI生成视频检测','人物换脸与深度伪造检测','售后与退货AI视频凭证检测','AI音频伪造检测',
  ]);
  assert.equal(new Set(scenarios.map(item=>item.path)).size,10);
  assert.ok(scenarios.every(item=>!('features' in item)));
  // 3.1 通用AI生成视频检测已接入业务，其余场景仍为占位
  assert.equal(scenarios.filter(item=>item.api.implemented).length,1);
  assert.equal(scenarios.find(item=>item.path==='/video/general').api.implemented,true);
  const app=await readFile(new URL('../src/app.js',import.meta.url),'utf8');
  assert.match(app,/id="scenario-workspace"[^>]*><\/section>/);
  assert.doesNotMatch(app,/subfeature-list|function featurePage/);
});

test('10 个场景接口与文档一一对应',()=>{
  const spec=createOpenApi();
  assert.equal(Object.keys(spec.paths).length,12);
  for(const scenario of scenarios) assert.equal(spec.paths[scenario.api.path].post['x-page-route'],scenario.path);
});

test('HTTP 集成：10 个业务接口返回 501，静态服务及错误方法行为正确',async()=>{
  // 检测服务探测指向不可达端口，保证断言不依赖外部推理服务是否在运行
  process.env.RESTRAV_SERVICE_URL='http://127.0.0.1:1';
  const server=createServer();
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base+'/')).status,200);
    assert.match(await (await fetch(base+'/src/app.js')).text(),/resolveRoute/);
    assert.equal((await fetch(base+'/src/styles.css')).headers.get('content-type'),'text/css; charset=utf-8');
    assert.deepEqual((await (await fetch(base+'/api/v1/catalog')).json()).counts,{modules:4,scenarios:10});
    assert.equal((await (await fetch(base+'/api/v1/health')).json()).businessImplemented,false);
    assert.equal((await (await fetch(base+'/docs/openapi.json')).json()).openapi,'3.1.0');
    for(const scenario of scenarios){
      const response=await fetch(base+scenario.api.path,{method:'POST'});
      if(scenario.api.implemented){
        // 已接入业务：未带内容类型的请求直接判定媒体类型不支持
        assert.equal(response.status,415,scenario.path);
        assert.equal((await response.json()).error.code,'UNSUPPORTED_MEDIA_TYPE');
        const jsonOnly=await fetch(base+scenario.api.path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        assert.equal(jsonOnly.status,400,scenario.path); // 缺少 multipart 视频字段
        assert.equal((await jsonOnly.json()).error.code,'VALIDATION_ERROR');
      } else {
        assert.equal(response.status,501,scenario.path);
        const data=await response.json();
        assert.equal(data.error.code,'NOT_IMPLEMENTED');
        assert.equal(data.endpoint.path,scenario.api.path);
        assert.ok(data.requestId);
      }
    }
    const wrongMethod=await fetch(base+'/api/v1/text/news');
    assert.equal(wrongMethod.status,405);
    assert.equal(wrongMethod.headers.get('allow'),'POST');
    assert.equal((await fetch(base+'/api/v1/unknown')).status,404);
    assert.equal((await fetch(base+'/README.md')).status,404);
    assert.equal((await fetch(base+'/src/%2e%2e%2fREADME.md')).status,404);
    api.configure({baseUrl:base});
    await assert.rejects(()=>api.invoke('/text/news',{}),error=>error.status===501&&error.code==='NOT_IMPLEMENTED');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));
    api.configure();
    delete process.env.RESTRAV_SERVICE_URL;
  }
});

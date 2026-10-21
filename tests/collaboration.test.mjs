import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../src/catalog.js';
import { pageRenderers } from '../src/modules/registry.js';
import { scenarioServices } from '../src/server/registry.js';
import { clientFiles } from '../scripts/source-files.mjs';

test('10个场景有独立渲染器，未实现场景默认不创建任何内容或业务请求',()=>{
  const pages=new Map(pageRenderers);
  const implemented=new Set(['/video/general']);
  assert.equal(pages.size,10);
  for(const scene of scenarios){
    assert.equal(typeof pages.get(scene.path),'function');
    if(!implemented.has(scene.path)){
      const untouched={};
      assert.equal(pages.get(scene.path)(untouched,{scenario:scene}),undefined);
      assert.deepEqual(untouched,{});
    }
    assert.ok(clientFiles.includes(`src/modules/${scene.moduleId}/pages/${scene.id}.js`));
  }
});

test('业务分发走各模块服务，均明确抛出501而非模拟结果',async()=>{
  for(const scene of scenarios){
    await assert.rejects(()=>scenarioServices[scene.moduleId](scene,{},{}),error=>error.status===501&&error.code==='NOT_IMPLEMENTED'&&error.operationId===scene.api.operationId);
  }
  assert.ok(clientFiles.every(file=>!file.includes('/server/')&&!file.endsWith('/service.js')));
});

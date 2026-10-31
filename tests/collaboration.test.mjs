import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../src/catalog.js';
import { pageRenderers } from '../src/modules/registry.js';
import { scenarioServices } from '../src/server/registry.js';
import { clientFiles } from '../scripts/source-files.mjs';

// 4.1 已接入演示页；其余 9 个场景保持空白，等待各自负责人实现。
const demoPages=new Map([['/audio/forgery',/af-grid/]]);

test('场景渲染器：已接入的场景有界面，其余保持空白且不发请求',()=>{
  const pages=new Map(pageRenderers);
  assert.equal(pages.size,10);
  for(const scene of scenarios){
    assert.equal(typeof pages.get(scene.path),'function');
    assert.ok(clientFiles.includes(`src/modules/${scene.moduleId}/pages/${scene.id}.js`));
    const demo=demoPages.get(scene.path);
    if(demo){
      assert.match(pages.get(scene.path).toString(),demo);
      continue;
    }
    const untouched={};
    assert.equal(pages.get(scene.path)(untouched,{scenario:scene}),undefined);
    assert.deepEqual(untouched,{});
  }
});

test('业务分发走各模块服务，均明确抛出501而非模拟结果',async()=>{
  for(const scene of scenarios){
    await assert.rejects(()=>scenarioServices[scene.moduleId](scene,{},{}),error=>error.status===501&&error.code==='NOT_IMPLEMENTED'&&error.operationId===scene.api.operationId);
  }
  assert.ok(clientFiles.every(file=>!file.includes('/server/')&&!file.endsWith('/service.js')));
});

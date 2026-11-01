import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios } from '../src/catalog.js';
import { pageRenderers } from '../src/modules/registry.js';
import { scenarioServices } from '../src/server/registry.js';
import { clientFiles } from '../scripts/source-files.mjs';
import { validateNewsInput } from '../src/modules/text/pages/news.js';
import { validateNovelChapter } from '../src/modules/text/pages/novel.js';

test('10个场景有独立渲染器，新闻和小说页面已接入工作区',()=>{
  const pages=new Map(pageRenderers);
  assert.equal(pages.size,10);
  for(const scene of scenarios){
    assert.equal(typeof pages.get(scene.path),'function');
    if(!['/text/news','/text/novel'].includes(scene.path)){
      const untouched={};
      assert.equal(pages.get(scene.path)(untouched,{scenario:scene}),undefined);
      assert.deepEqual(untouched,{});
    }
    assert.ok(clientFiles.includes(`src/modules/${scene.moduleId}/pages/${scene.id}.js`));
  }
});

test('新闻稿和小说章节在前端提交前校验必要材料',()=>{
  assert.equal(validateNewsInput({title:'',sourceType:'paste',content:'正文'}),'请填写稿件标题。');
  assert.equal(validateNewsInput({title:'稿件',sourceType:'paste',content:'  '}),'请粘贴需要检测的稿件正文。');
  assert.equal(validateNewsInput({title:'稿件',sourceType:'link',url:'javascript:alert(1)'}),'请输入有效的 http 或 https 新闻链接。');
  assert.equal(validateNewsInput({title:'稿件',sourceType:'link',url:'https://example.com/a'}),'');
  assert.equal(validateNovelChapter({workTitle:'作品',chapterTitle:'',content:'正文'}),'请填写章节名称。');
  assert.equal(validateNovelChapter({workTitle:'作品',chapterTitle:'第一章',content:'正文'}),'');
});

test('业务分发走各模块服务，均明确抛出501而非模拟结果',async()=>{
  for(const scene of scenarios){
    await assert.rejects(()=>scenarioServices[scene.moduleId](scene,{},{}),error=>error.status===501&&error.code==='NOT_IMPLEMENTED'&&error.operationId===scene.api.operationId);
  }
  assert.ok(clientFiles.every(file=>!file.includes('/server/')&&!file.endsWith('/service.js')));
});

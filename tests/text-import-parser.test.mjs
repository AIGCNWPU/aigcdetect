import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createParserServer, parseHtmlWithMineru, parseImageWithMineru } from '../services/text-import-parser/server.mjs';

test('独立代理按可配置MinerU参数写入临时HTML并读取Markdown结果', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'veritas-fake-mineru-'));
  const fake = path.join(temp, 'fake-mineru.mjs');
  await writeFile(fake, `
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import path from 'node:path';
    const args=process.argv.slice(2),input=args[args.indexOf('parse')+1],output=args[args.indexOf('-o')+1];
    const html=readFileSync(input,'utf8');
    const fence=String.fromCharCode(96).repeat(3);
    mkdirSync(path.dirname(output),{recursive:true});
    writeFileSync(output,'# 独立解析标题\\n\\n<a id="html-anchor"></a>\\n\\n'+fence+'javascript\\nwindow.__DATA__ = { code: true };\\n'+fence+'\\n\\n这是由伪MinerU命令生成的正文，用于验证静态HTML输入、参数占位符、Markdown输出读取和临时目录清理。\\n\\n'+html,'utf8');
  `, 'utf8');
  const previousCommand = process.env.MINERU_COMMAND_JSON;
  const previousArgs = process.env.MINERU_ARGS_JSON;
  process.env.MINERU_COMMAND_JSON = JSON.stringify([process.execPath, fake]);
  process.env.MINERU_ARGS_JSON = JSON.stringify(['parse', '{input}', '-o', '{output_file}']);
  try {
    const result = await parseHtmlWithMineru('<article>公开新闻正文</article>');
    assert.equal(result.parser, 'mineru-cli');
    assert.match(result.text, /^独立解析标题/m);
    assert.match(result.text, /公开新闻正文/);
    assert.doesNotMatch(result.text, /html-anchor|javascript|__DATA__|code/);
  } finally {
    if (previousCommand === undefined) delete process.env.MINERU_COMMAND_JSON;
    else process.env.MINERU_COMMAND_JSON = previousCommand;
    if (previousArgs === undefined) delete process.env.MINERU_ARGS_JSON;
    else process.env.MINERU_ARGS_JSON = previousArgs;
    await rm(temp, { recursive: true, force: true });
  }
});
test('独立代理可将公开页面截图交给同一MinerU命令解析', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'veritas-fake-mineru-image-'));
  const fake = path.join(temp, 'fake-mineru-image.mjs');
  await writeFile(fake, `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import path from 'node:path';
    const args=process.argv.slice(2),input=args[args.indexOf('parse')+1],output=args[args.indexOf('-o')+1];
    if(!input.endsWith('.png')) process.exit(2);
    mkdirSync(path.dirname(output),{recursive:true});
    writeFileSync(output,'# OCR标题\\n\\n这是从公开页面截图中识别出的实验正文，用于验证图片输入、Markdown输出和临时目录清理。'.repeat(3),'utf8');
  `, 'utf8');
  const previousCommand = process.env.MINERU_COMMAND_JSON;
  const previousArgs = process.env.MINERU_ARGS_JSON;
  process.env.MINERU_COMMAND_JSON = JSON.stringify([process.execPath, fake]);
  process.env.MINERU_ARGS_JSON = JSON.stringify(['parse', '{input}', '-o', '{output_file}']);
  try {
    const result = await parseImageWithMineru(Buffer.from('fake-png'));
    assert.equal(result.parser, 'mineru-cli');
    assert.match(result.text, /公开页面截图/);
    assert.match(result.markdown, /^# OCR标题/m);
  } finally {
    if (previousCommand === undefined) delete process.env.MINERU_COMMAND_JSON;
    else process.env.MINERU_COMMAND_JSON = previousCommand;
    if (previousArgs === undefined) delete process.env.MINERU_ARGS_JSON;
    else process.env.MINERU_ARGS_JSON = previousArgs;
    await rm(temp, { recursive: true, force: true });
  }
});
test('独立文本导入代理提供稳定健康检查和HTML解析协议', async () => {
  const previous = process.env.MINERU_COMMAND_JSON;
  process.env.MINERU_COMMAND_JSON = JSON.stringify([process.execPath]);
  const server = createParserServer({ parser: async (html, context) => ({ text: `已解析：${html}`, chapters: [], parser: 'test', sourceUrl: context.sourceUrl }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ready, true);

    const response = await fetch(`${base}/api/v1/html/parse`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: '<article>公开正文</article>', sourceUrl: 'https://news.example/item' }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, {
      text: '已解析：<article>公开正文</article>', chapters: [], parser: 'test', sourceUrl: 'https://news.example/item',
    });
  } finally {
    if (previous === undefined) delete process.env.MINERU_COMMAND_JSON;
    else process.env.MINERU_COMMAND_JSON = previous;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
test('独立文本导入代理拒绝错误媒体类型且不执行解析器', async () => {
  let calls = 0;
  const server = createParserServer({ parser: async () => { calls += 1; return { text: '不应执行' }; } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${base}/api/v1/html/parse`, { method: 'POST', body: 'html' });
    assert.equal(response.status, 415);
    assert.equal(calls, 0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

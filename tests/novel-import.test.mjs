import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { api } from '../src/api.js';
import { createServer } from '../scripts/serve.mjs';
import {
  NovelImportError,
  assertPublicUrl,
  extractNovelContent,
  fetchPublicPage,
  importNovelChapter,
  isPublicIp,
} from '../src/modules/text/novel-import.js';

test('章节导入只允许公网 IP，并拒绝DNS混合解析结果', async () => {
  for (const address of ['127.0.0.1', '10.0.0.8', '169.254.1.2', '192.168.1.2', '::1', 'fc00::1', 'fe80::1', '2001:db8::1', '::ffff:127.0.0.1']) {
    assert.equal(isPublicIp(address), false, address);
  }
  for (const address of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicIp(address), true, address);
  await assert.rejects(
    () => assertPublicUrl('https://example.com/chapter', { lookup: async () => [{ address: '93.184.216.34', family: 4 }, { address: '127.0.0.1', family: 4 }] }),
    error => error instanceof NovelImportError && error.code === 'PRIVATE_ADDRESS' && error.status === 403,
  );
  await assert.rejects(
    () => assertPublicUrl('file:///etc/passwd'),
    error => error.code === 'INVALID_URL' && error.status === 400,
  );
});

test('网页获取会在每次重定向前重新校验目标地址', async () => {
  const requested = [];
  await assert.rejects(
    () => fetchPublicPage('https://public.example/chapter', {
      lookup: async hostname => [{ address: hostname === 'public.example' ? '93.184.216.34' : '127.0.0.1', family: 4 }],
      request: async target => {
        requested.push(target.url.href);
        return { status: 302, headers: { location: 'http://localhost/private' }, body: null };
      },
    }),
    error => error.code === 'PRIVATE_ADDRESS',
  );
  assert.deepEqual(requested, ['https://public.example/chapter']);
});

const ciweimaoHtml = `<!doctype html><html><head><title>第三章：公开章节 - 示例作品 - 刺猬猫</title></head><body>
  <h1 class="read-hd">第三章：公开章节</h1>
  <div class="read-bd" id="J_BookRead">
    <p class="chapter">　　第一段公开正文。<span>17VpWM</span><a class="num-link"><i>8</i></a>
    <p class="chapter">　　第二段公开正文，用于验证段落提取和水印清理。</p>
  </div><div class="chapter-over">本章结束</div>
</body></html>`;

test('刺猬猫公开章节提取标题、段落并移除水印', () => {
  const result = extractNovelContent(ciweimaoHtml, {
    sourceUrl: 'https://mip.ciweimao.com/chapter/1',
    finalUrl: 'https://mip.ciweimao.com/chapter/1',
  });
  assert.equal(result.site, 'ciweimao');
  assert.equal(result.workTitle, '示例作品');
  assert.equal(result.title, '第三章：公开章节');
  assert.equal(result.extractionStatus, 'completed');
  assert.equal(result.completeness, 'complete');
  assert.match(result.content, /第一段公开正文。\n第二段公开正文/);
  assert.doesNotMatch(result.content, /17VpWM|num-link|8/);
});

test('作品目录页会明确提示改用单章节链接', () => {
  assert.throws(
    () => extractNovelContent('<html><title>作品目录 - 刺猬猫</title><body><h1>作品目录</h1></body></html>', {
      sourceUrl: 'https://mip.ciweimao.com/book/100449890',
      finalUrl: 'https://mip.ciweimao.com/book/100449890',
    }),
    error => error.code === 'UNSUPPORTED_PAGE_TYPE' && error.details.reason === 'DIRECTORY_PAGE',
  );
});

test('飞卢公开免费章节提取标题和正文', () => {
  const html = `<html><head><title>作品_第1章_免费小说阅读_飞卢小说网</title></head><body>
    <script>var is_vip=0;</script><h1>示例作品 第1章 成为炼卡师吧</h1>
    <a id="novelName">示例作品</a><div class="noveContent">
      <p>这是飞卢公开免费章节的第一段正文，用户无需登录即可在网页中直接阅读。</p>
      <p>这是第二段正文，用于确认站点适配器只提取章节段落，不混入导航、广告或推荐内容。</p>
    </div><a>下一章</a></body></html>`;
  const result = extractNovelContent(html, { sourceUrl: 'https://b.faloo.com/1_1.html', finalUrl: 'https://b.faloo.com/1_1.html' });
  assert.equal(result.site, 'faloo');
  assert.equal(result.workTitle, '示例作品');
  assert.equal(result.title, '第1章 成为炼卡师吧');
  assert.equal(result.completeness, 'complete');
  assert.match(result.content, /第一段正文[^\n]*\n这是第二段正文/);
  assert.doesNotMatch(result.content, /下一章/);
});

test('纵横公开免费章节提取作品名、标题和正文', () => {
  const html = `<html><head><meta property="og:novel:book_name" content="死神塔"></head><body><main data-vip="0"><div class="reader-content" id="Jcontent">
    <div class="title_txtbox">第一章：死神塔</div>
    <div class="content" data-prescription="0" data-decoder="">
      <p>这是纵横公开免费章节的第一段正文，服务端可以从页面中的正文容器直接读取。</p>
      <p>这是第二段正文，用于确认标题、自然段和免费章节完整性标记能够被可靠识别。</p>
    </div></div></main></body></html>`;
  const result = extractNovelContent(html, { sourceUrl: 'https://read.zongheng.com/chapter/1/2.html', finalUrl: 'https://read.zongheng.com/chapter/1/2.html' });
  assert.equal(result.site, 'zongheng');
  assert.equal(result.workTitle, '死神塔');
  assert.equal(result.title, '第一章：死神塔');
  assert.equal(result.completeness, 'complete');
  assert.match(result.content, /第一段正文[^\n]*\n这是第二段正文/);
});

test('飞卢和纵横的受限章节不会生成空正文', () => {
  assert.throws(
    () => extractNovelContent('<html><script>var is_vip=1;</script><h1>示例作品 第99章</h1><a id="novelName">示例作品</a><div class="noveContent"><p>订阅后阅读</p></div></html>', {
      sourceUrl: 'https://b.faloo.com/1_99.html', finalUrl: 'https://b.faloo.com/1_99.html',
    }),
    error => error.code === 'ACCESS_RESTRICTED' && error.details.reason === 'READING_RESTRICTED',
  );
  assert.throws(
    () => extractNovelContent('<html><main data-vip="1"><div class="title_txtbox">第九十九章</div><div class="content" data-prescription="1"></div></main><p>订阅VIP章节</p></html>', {
      sourceUrl: 'https://read.zongheng.com/chapter/1/99.html', finalUrl: 'https://read.zongheng.com/chapter/1/99.html',
    }),
    error => error.code === 'ACCESS_RESTRICTED' && error.details.reason === 'READING_RESTRICTED',
  );
});

test('通用章节有截断线索时只返回公开可读部分', () => {
  const html = `<html><head><title>第八章 - 示例站</title></head><body><article>
    <h1>第八章</h1><p>这是公开试读正文，包含足够的可读内容，供编辑确认后导入当前章节表单。</p>
    <p>这是第二段公开内容，用来验证正文不是导航或登录提示，并且能够保留自然段落。</p>
    <p>试读结束，剩余内容请订阅后阅读。</p></article></body></html>`;
  const result = extractNovelContent(html, { sourceUrl: 'https://example.com/chapter/8', finalUrl: 'https://example.com/chapter/8' });
  assert.equal(result.site, 'generic');
  assert.equal(result.workTitle, '示例站');
  assert.equal(result.extractionStatus, 'partial');
  assert.equal(result.completeness, 'partial');
  assert.match(result.notice, /仅提取/);
});

test('登录页、验证页和动态字体乱码不会被当作正文', () => {
  assert.throws(
    () => extractNovelContent('<html><title>登录-刺猬猫</title><body>请登录</body></html>', { sourceUrl: 'https://mip.ciweimao.com/chapter/2', finalUrl: 'https://wap.ciweimao.com/signup/login' }),
    error => error.code === 'ACCESS_RESTRICTED' && error.details.reason === 'LOGIN_REQUIRED',
  );
  assert.throws(
    () => extractNovelContent('<html><body>请完成人机验证码</body></html>', { sourceUrl: 'https://www.qidian.com/chapter/1/2', finalUrl: 'https://www.qidian.com/chapter/1/2' }),
    error => error.code === 'ACCESS_RESTRICTED' && error.details.reason === 'VERIFICATION_REQUIRED',
  );
  assert.throws(
    () => extractNovelContent(`<html><body><div class="font-Dynamic">${'\uE521'.repeat(30)}</div></body></html>`, { sourceUrl: 'https://fanqienovel.com/reader/1', finalUrl: 'https://fanqienovel.com/reader/1' }),
    error => error.code === 'CONTENT_OBFUSCATED' && error.details.reason === 'DYNAMIC_FONT',
  );
});

test('导入结果包含来源、最终地址和完整性状态', async () => {
  const genericHtml = `<html><head><title>第一章 - 示例作品</title></head><body><article>
    <h1>第一章</h1><p>公开正文第一段，包含可供编辑核对的章节内容，不依赖客户端脚本。</p>
    <p>公开正文第二段，继续提供足够内容来验证服务端提取、来源记录和完整性提示。</p>
  </article></body></html>`;
  const result = await importNovelChapter('https://public.example/chapter/1', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(genericHtml) }),
  });
  assert.equal(result.sourceUrl, 'https://public.example/chapter/1');
  assert.equal(result.finalUrl, 'https://public.example/chapter/1');
  assert.equal(result.site, 'generic');
  assert.equal(result.extractionStatus, 'completed');
  assert.equal(result.completeness, 'unknown');
  assert.equal(result.workTitle, '示例作品');
  assert.ok(result.content.length > 20);
});

test('常规章节规则未识别正文时可用MinerU解析已抓取的静态HTML', async () => {
  const html = '<html><head><title>第九章 意外来客</title></head><body><div data-reader-shell>正文由未知前端容器承载</div></body></html>';
  const result = await importNovelChapter('https://public.example/chapter/mineru', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html) }),
    textImportParserUrl: 'http://127.0.0.1:8013/api/v1/html/parse',
    mineruFetch: async () => new Response(JSON.stringify({ data: { text: '雨声敲打窗沿，走廊尽头忽然传来一阵缓慢而清晰的脚步声，屋内众人同时停下了交谈。\n门被推开后，一个陌生人站在昏暗灯光下，交出一封没有署名的信，并要求主角立刻离开这里。' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(result.title, '第九章 意外来客');
  assert.equal(result.extractionMethod, 'mineru-html');
  assert.equal(result.completeness, 'unknown');
  assert.match(result.content, /陌生人站在昏暗灯光下/);
  assert.match(result.notice, /MinerU/);
});

test('脚本空壳章节页可通过独立浏览器渲染后提取正文', async () => {
  const shell = '<html><head><title>小说阅读</title><script src="/reader.js"></script></head><body><div id="app"></div></body></html>';
  const result = await importNovelChapter('https://public.example/chapter/dynamic', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(shell) }),
    textImportBrowserUrl: 'http://127.0.0.1:8014/api/v1/render',
    browserFetch: async () => {
      const html = `<html><head><title>第十二章 重逢 - 示例作品</title></head><body><article><h1>第十二章 重逢</h1>
        <p>雨停以后，主角沿着河岸走进旧城，在已经关闭多年的车站前看见熟悉的身影。</p>
        <p>两人隔着昏黄路灯确认彼此身份，随后交换各自保管的信件，并约定天亮前离开。</p>
      </article></body></html>`;
      return new Response(JSON.stringify({ data: { finalUrl: 'https://public.example/chapter/dynamic', html } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(result.extractionMethod, 'browser-rendered');
  assert.equal(result.title, '第十二章 重逢');
  assert.equal(result.workTitle, '示例作品');
  assert.match(result.content, /已经关闭多年的车站/);
  assert.match(result.notice, /隔离浏览器/);
});

test('受限小说页面也会额外调用一次MinerU且失败时保留原错误', async () => {
  let mineruCalls = 0;
  await assert.rejects(
    importNovelChapter('https://public.example/chapter/restricted', {
      lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from('<html><body>请完成人机验证码</body></html>') }),
      textImportParserUrl: 'http://127.0.0.1:8013/api/v1/html/parse',
      mineruFetch: async () => { mineruCalls += 1; throw new Error('代理暂不可用'); },
    }),
    error => error.code === 'ACCESS_RESTRICTED',
  );
  assert.equal(mineruCalls, 1);
});

test('动态字体常规提取失败后可由MinerU可读结果接管', async () => {
  const html = `<html><head><title>第十章 雾中来信 - 示例作品</title></head><body><div class="font-Dynamic">${'\uE521'.repeat(30)}</div></body></html>`;
  const result = await importNovelChapter('https://fanqienovel.com/reader/123', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html) }),
    textImportParserUrl: 'http://127.0.0.1:8013/api/v1/html/parse',
    mineruFetch: async () => new Response(JSON.stringify({ data: { text: '雾气沿着山路缓慢散开，送信人终于在天亮之前抵达驿站，将密封完好的书信交给守夜人。\n守夜人核对印章之后推开木门，请他进入屋内等待，并派人立刻通知远处的主人。' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal(result.extractionMethod, 'mineru-html');
  assert.equal(result.title, '第十章 雾中来信 - 示例作品');
  assert.match(result.content, /送信人终于在天亮之前抵达驿站/);
});

test('独立HTTP接口返回导入结果，客户端解包data且检测入口校验正式请求', async () => {
  const imported = {
    sourceUrl: 'https://public.example/chapter/1', finalUrl: 'https://public.example/chapter/1', site: 'generic',
    workTitle: '示例作品', title: '第一章', content: '已确认的公开正文内容。'.repeat(8), extractionStatus: 'completed', completeness: 'unknown', notice: '完整性待确认。',
  };
  const server = createServer({ novelImporter: async url => {
    if(url.includes('/blocked'))throw new NovelImportError('ACCESS_RESTRICTED','页面需要登录。',{status:422,sourceUrl:url,finalUrl:url,reason:'LOGIN_REQUIRED'});
    return { ...imported, sourceUrl: url, finalUrl: url };
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  api.configure({ baseUrl: base });
  try {
    const result = await api.importNovelChapter(imported.sourceUrl);
    assert.deepEqual(result, imported);
    const invalid = await fetch(`${base}/api/v1/text/novel/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_URL');
    const blocked = await fetch(`${base}/api/v1/text/novel/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({url:'https://public.example/blocked'}) });
    assert.equal(blocked.status, 422);
    assert.equal((await blocked.json()).details.reason, 'LOGIN_REQUIRED');
    const oversized = await fetch(`${base}/api/v1/text/novel/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({url:`https://public.example/${'x'.repeat(17_000)}`}) });
    assert.equal(oversized.status, 413);
    assert.equal((await fetch(`${base}/api/v1/text/novel/import`)).status, 405);
    const detection = await fetch(`${base}/api/v1/text/novel`, { method: 'POST' });
    assert.equal(detection.status, 400);
    assert.equal((await detection.json()).error.code, 'INVALID_REQUEST');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    api.configure();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { api } from '../src/api.js';
import { createServer } from '../scripts/serve.mjs';
import { NewsImportError, extractNewsContent, importNewsArticle } from '../src/modules/text/news-import.js';

test('JSON-LD新闻页面提取标题、作者、时间与正文', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:site_name" content="示例通讯社">
    <script type="application/ld+json">{
      "@context":"https://schema.org","@type":"NewsArticle","headline":"校园科技节正式开幕",
      "author":{"@type":"Person","name":"张记者"},"datePublished":"2026-10-24T08:30:00+08:00",
      "articleBody":"校园科技节今天正式开幕，来自多个学院的师生展示了人工智能、机器人和绿色能源项目。活动还设置了成果交流与公众体验环节，为参观者提供持续、完整且公开可读的新闻内容。"
    }</script></head><body><nav>首页 新闻 推荐</nav></body></html>`;
  const result = extractNewsContent(html, { sourceUrl: 'https://news.example/a', finalUrl: 'https://news.example/a' });
  assert.equal(result.siteName, '示例通讯社');
  assert.equal(result.title, '校园科技节正式开幕');
  assert.equal(result.author, '张记者');
  assert.equal(result.publishedAt, '2026-10-24T08:30:00+08:00');
  assert.match(result.content, /人工智能、机器人和绿色能源/);
  assert.equal(result.extractionStatus, 'completed');
  assert.equal(result.completeness, 'unknown');
});

test('语义正文容器可提取公开内容并排除导航', () => {
  const html = `<!doctype html><html><head><meta property="og:title" content="公开新闻标题"><meta name="author" content="李编辑"></head><body>
    <nav>首页 国际 国内 推荐广告</nav><article><h1>公开新闻标题</h1>
      <p>这是公开新闻正文的第一段，服务端可以直接读取，不需要登录或执行浏览器脚本，并包含足够的信息用于用户预览核对。</p>
      <p>这是公开新闻正文的第二段，用于确认自然段能够保留，同时不会把页面导航、表单或页脚内容混入稿件。</p>
    </article><footer>版权与推荐</footer></body></html>`;
  const result = extractNewsContent(html, { sourceUrl: 'https://public.example/news/1', finalUrl: 'https://public.example/news/1' });
  assert.equal(result.title, '公开新闻标题');
  assert.equal(result.author, '李编辑');
  assert.match(result.content, /第一段[^\n]*\n这是公开新闻正文的第二段/);
  assert.doesNotMatch(result.content, /首页|推荐广告|版权/);
});

test('新华网常见articleEdit容器可由通用规则识别', () => {
  const html = `<html><head><meta name="source" content="新华网"><meta name="publishdate" content="2026-10-01"><title>公开报道标题-新华网</title></head><body>
    <div id="detail"><h1>公开报道标题</h1><span id="detailContent">
      <p>新华社北京十月一日电，这是新华网页面常见正文容器中的第一段公开报道内容，包含足够信息供导入预览。</p>
      <p>第二段继续说明事件背景与进展，用于验证标题后缀清理、来源和发布时间元数据以及正文段落提取。</p>
    </span><div id="articleEdit"><span class="editor">责任编辑</span></div></div></body></html>`;
  const result = extractNewsContent(html, { sourceUrl: 'https://www.news.cn/example/c.html', finalUrl: 'https://www.news.cn/example/c.html' });
  assert.equal(result.siteName, '新华网');
  assert.equal(result.title, '公开报道标题');
  assert.equal(result.publishedAt, '2026-10-01');
  assert.match(result.content, /新华社北京[^\n]*\n第二段/);
});

test('央视网、中新网和凤凰网公开正文容器可按域名适配', () => {
  const cases = [
    {
      url: 'https://news.cctv.com/2026/10/24/example.shtml',
      className: 'content_18313',
      siteName: '央视网',
      title: '央视公开新闻',
      body: '央视新闻公开正文使用&ldquo;重点内容&rdquo;说明事件背景，第一段包含足够信息供用户预览确认。',
      expected: '“重点内容”',
    },
    {
      url: 'https://www.chinanews.com.cn/jk/2026/10-23/example.shtml',
      className: 'content_maincontent_content',
      siteName: '中国新闻网',
      title: '中新网公开新闻',
      body: '中新网公开正文介绍事件发生时间、地点和参与者，第一段提供足够的信息用于新闻链接导入与核对。',
      expected: '事件发生时间、地点和参与者',
    },
    {
      url: 'https://news.ifeng.com/c/example',
      className: 'index_text_D0U1y',
      siteName: '凤凰网',
      title: '凤凰网公开新闻',
      body: '凤凰网公开正文第一段说明新闻事件与主要进展，并保留自然段内容用于用户确认后提交检测。',
      expected: '新闻事件与主要进展',
    },
  ];

  for (const item of cases) {
    const html = `<html><head><meta property="og:title" content="${item.title}"></head><body>
      <div class="${item.className}"><p>${item.body}</p><p>第二段补充公开背景材料，确保正文达到最低可读长度，并验证站点适配不会依赖检测服务。</p></div>
      <footer>推荐阅读和版权信息</footer></body></html>`;
    const result = extractNewsContent(html, { sourceUrl: item.url, finalUrl: item.url });
    assert.equal(result.siteName, item.siteName);
    assert.equal(result.title, item.title);
    assert.match(result.content, new RegExp(item.expected));
    assert.doesNotMatch(result.content, /推荐阅读和版权信息/);
  }
});

test('澎湃页面脚本中的captcha字样不触发误判并可提取公开正文', () => {
  const url = 'https://www.thepaper.cn/newsDetail_forward_34306727';
  const html = `<html><head><meta property="og:title" content="澎湃公开新闻">
    <script>window.telemetry = { event: 'captcha_loaded' };</script></head><body>
    <div class="leftcontent__XcRTe leftClass__m4gYo">
      <p>澎湃新闻公开正文第一段包含事件起因、采访对象与主要事实，可供用户直接预览并核对内容。</p>
      <p>第二段继续提供公开可读的背景信息，验证脚本中的技术关键词不会被当作页面正在要求验证码。</p>
    </div></body></html>`;
  const result = extractNewsContent(html, { sourceUrl: url, finalUrl: url });
  assert.equal(result.siteName, '澎湃新闻');
  assert.equal(result.title, '澎湃公开新闻');
  assert.match(result.content, /事件起因、采访对象与主要事实/);
  assert.equal(result.extractionStatus, 'completed');
});

test('存在截断线索时只返回公开可读部分', () => {
  const html = `<html><head><title>部分公开新闻</title></head><body><article><h1>部分公开新闻</h1>
    <p>这是页面当前公开展示的新闻第一段，包含事件背景、发生时间和主要参与者，可供用户预览确认后作为有限材料。</p>
    <p>这是第二段公开内容，用于保证不是把登录提示或导航误识别为正文，也明确表示当前只能读取页面展示的部分。</p>
    <p>展开全文需要登录后阅读</p></article></body></html>`;
  const result = extractNewsContent(html, { sourceUrl: 'https://public.example/news/partial', finalUrl: 'https://public.example/news/partial' });
  assert.equal(result.extractionStatus, 'partial');
  assert.equal(result.completeness, 'partial');
  assert.match(result.notice, /仅提取/);
  assert.doesNotMatch(result.content, /登录后阅读/);
});

test('验证页、完全受限页和无正文页不会生成空稿件', () => {
  assert.throws(
    () => extractNewsContent('<html><body>请完成人机验证码</body></html>', { sourceUrl: 'https://news.example/captcha', finalUrl: 'https://news.example/captcha' }),
    error => error.code === 'ACCESS_RESTRICTED' && error.details.reason === 'VERIFICATION_REQUIRED',
  );
  assert.throws(
    () => extractNewsContent('<html><h1>会员新闻</h1><p>登录后阅读剩余内容</p></html>', { sourceUrl: 'https://news.example/paid', finalUrl: 'https://news.example/paid' }),
    error => error.code === 'ACCESS_RESTRICTED' && error.details.reason === 'READING_RESTRICTED',
  );
  assert.throws(
    () => extractNewsContent('<html><head><title>新闻页</title></head><body><nav>只有导航和广告</nav></body></html>', { sourceUrl: 'https://news.example/empty', finalUrl: 'https://news.example/empty' }),
    error => error.code === 'CONTENT_NOT_FOUND',
  );
});

test('新闻导入结果包含来源与覆盖状态', async () => {
  const html = `<html><head><meta property="og:title" content="服务端公开新闻"><meta property="og:site_name" content="公开站点"></head><body><article>
    <p>新闻正文第一段包含足够的公开信息，用来验证安全网页获取、标题识别、来源记录和独立导入流程。</p>
    <p>新闻正文第二段继续提供可读材料，确认导入接口不依赖尚未接入的AI检测或三审三校服务。</p>
  </article></body></html>`;
  const result = await importNewsArticle('https://public.example/news/1', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html) }),
  });
  assert.equal(result.sourceUrl, 'https://public.example/news/1');
  assert.equal(result.finalUrl, 'https://public.example/news/1');
  assert.equal(result.siteName, '公开站点');
  assert.equal(result.title, '服务端公开新闻');
  assert.equal(result.completeness, 'unknown');
});

test('常规新闻规则未识别正文时可用MinerU解析已抓取的静态HTML', async () => {
  const html = '<html><head><title>隐藏容器中的公开报道</title></head><body><div data-page-shell>正文由未知前端容器承载</div></body></html>';
  let submittedPayload;
  const result = await importNewsArticle('https://public.example/news/mineru', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(html) }),
    textImportParserUrl: 'http://127.0.0.1:8013/api/v1/html/parse',
    mineruFetch: async (_url, init) => {
      submittedPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: { text: '这是MinerU从未知静态页面容器中识别出的新闻正文第一段，包含事件背景、时间和主要参与者。\n第二段继续补充公开报道的事实与进展，保证正文长度足够供用户预览和核对。' } }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.equal(submittedPayload.sourceUrl, 'https://public.example/news/mineru');
  assert.equal(submittedPayload.html, html);
  assert.equal(result.title, '隐藏容器中的公开报道');
  assert.equal(result.extractionMethod, 'mineru-html');
  assert.match(result.content, /事件背景、时间和主要参与者/);
  assert.match(result.notice, /MinerU/);
});

test('脚本空壳新闻页可通过独立浏览器渲染后提取正文', async () => {
  const shell = '<html><head><title>MSN</title><script src="/bundle.js"></script></head><body><div id="root"></div></body></html>';
  let rendererCalls = 0;
  const result = await importNewsArticle('https://public.example/news/dynamic', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: async () => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: Buffer.from(shell) }),
    textImportBrowserUrl: 'http://127.0.0.1:8014/api/v1/render',
    browserFetch: async () => {
      rendererCalls += 1;
      const html = `<html><head><meta property="og:title" content="浏览器渲染新闻"><meta property="og:site_name" content="示例新闻"></head><body><article>
        <p>浏览器执行公开脚本后得到新闻正文第一段，其中包含事件背景、时间和主要参与者，可供编辑核对。</p>
        <p>第二段继续说明事件进展，用来确认动态页面只回退一次，并保留可读自然段。</p>
      </article></body></html>`;
      return new Response(JSON.stringify({ data: { finalUrl: 'https://public.example/news/dynamic', html } }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(rendererCalls, 1);
  assert.equal(result.extractionMethod, 'browser-rendered');
  assert.equal(result.title, '浏览器渲染新闻');
  assert.match(result.content, /事件背景、时间和主要参与者/);
  assert.match(result.notice, /隔离浏览器/);
});

test('独立新闻HTTP接口返回导入结果且检测入口校验正式请求', async () => {
  const imported = {
    sourceUrl: 'https://public.example/news/1', finalUrl: 'https://public.example/news/1', siteName: '公开站点',
    title: '公开新闻', author: '编辑', publishedAt: '2026-10-24T08:00:00+08:00', content: '公开新闻正文。'.repeat(20),
    extractionStatus: 'completed', completeness: 'unknown', notice: '完整性待确认。',
  };
  const server = createServer({ newsImporter: async url => {
    if (url.includes('/blocked')) throw new NewsImportError('ACCESS_RESTRICTED', '页面需要登录。', { status: 422, sourceUrl: url, finalUrl: url, reason: 'LOGIN_REQUIRED' });
    return { ...imported, sourceUrl: url, finalUrl: url };
  } });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  api.configure({ baseUrl: base });
  try {
    assert.deepEqual(await api.importNewsArticle(imported.sourceUrl), imported);
    const invalid = await fetch(`${base}/api/v1/text/news/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_URL');
    const blocked = await fetch(`${base}/api/v1/text/news/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: 'https://public.example/blocked' }) });
    assert.equal(blocked.status, 422);
    assert.equal((await blocked.json()).details.reason, 'LOGIN_REQUIRED');
    assert.equal((await fetch(`${base}/api/v1/text/news/import`)).status, 405);
    const detection = await fetch(`${base}/api/v1/text/news`, { method: 'POST' });
    assert.equal(detection.status, 400);
    assert.equal((await detection.json()).error.code, 'INVALID_REQUEST');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    api.configure();
  }
});

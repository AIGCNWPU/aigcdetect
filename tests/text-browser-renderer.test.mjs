import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createBrowserRenderer, createRendererServer } from '../services/text-browser-renderer/server.mjs';
import { looksClientRendered, renderHtmlWithBrowser } from '../src/modules/text/browser-render-fallback.js';

test('动态空壳页面识别不会误判已有语义正文的页面', () => {
  assert.equal(looksClientRendered('<html><head><title>MSN</title><script src="app.js"></script></head><body><div id="root"></div></body></html>'), true);
  assert.equal(looksClientRendered('<html><body><article><p>公开正文</p></article><script src="app.js"></script></body></html>'), false);
});

test('浏览器渲染客户端按稳定协议返回渲染后页面', async () => {
  let submitted;
  const original = { sourceUrl: 'https://news.example/item', finalUrl: 'https://news.example/item', html: '<div id="root"></div>' };
  const page = await renderHtmlWithBrowser(original, {
    textImportBrowserUrl: 'http://127.0.0.1:8014/api/v1/render',
    browserRendererLogger: false,
    browserFetch: async (_url, init) => {
      submitted = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: { finalUrl: 'https://news.example/final', html: '<html><article>渲染正文</article></html>' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(submitted, { url: original.finalUrl });
  assert.equal(page.sourceUrl, original.sourceUrl);
  assert.equal(page.finalUrl, 'https://news.example/final');
  assert.match(page.html, /渲染正文/);
});

test('浏览器渲染HTTP服务提供健康检查、渲染接口和内容类型校验', async () => {
  const renderer = {
    async health() { return { engine: 'fake-chromium', version: '1.0' }; },
    async render(url) { return { sourceUrl: url, finalUrl: `${url}?rendered=1`, html: '<html><article>公开正文</article></html>', renderer: 'fake-chromium' }; },
  };
  const server = createRendererServer({ renderer });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const health = await fetch(`${base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ready, true);

    const response = await fetch(`${base}/api/v1/render`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: 'https://news.example/item' }),
    });
    assert.equal(response.status, 200);
    assert.match((await response.json()).data.html, /公开正文/);
    assert.equal((await fetch(`${base}/api/v1/render`, { method: 'POST', body: '{}' })).status, 415);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('浏览器渲染器不携带用户凭据并拦截大资源与内网子资源', async () => {
  let contextOptions;
  let routeHandler;
  const routed = [];
  const makeRoute = (url, resourceType = 'script') => ({
    request: () => ({ url: () => url, resourceType: () => resourceType }),
    continue: () => { routed.push(['continue', url]); },
    abort: reason => { routed.push(['abort', url, reason]); },
  });
  const context = {
    async route(_pattern, handler) { routeHandler = handler; },
    async newPage() {
      return {
        setDefaultTimeout() {},
        on() {},
        async goto(url) {
          await routeHandler(makeRoute(url, 'document'));
          await routeHandler(makeRoute('https://public.example/app.js'));
          await routeHandler(makeRoute('https://public.example/banner.jpg', 'image'));
          await routeHandler(makeRoute('http://private.example/secret.js'));
          return { status: () => 200 };
        },
        async waitForLoadState() {},
        async evaluate() {},
        async content() { return '<html><article>已渲染的公开正文</article></html>'; },
        async title() { return '公开页面'; },
        url() { return 'https://public.example/item'; },
      };
    },
    async close() {},
  };
  const browser = {
    async newContext(options) { contextOptions = options; return context; },
    version() { return 'fake'; },
    async close() {},
  };
  const renderer = createBrowserRenderer({
    chromiumLoader: async () => ({ launch: async () => browser }),
    lookup: async hostname => [{ address: hostname === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
  });
  try {
    const result = await renderer.render('https://public.example/item');
    assert.match(result.html, /公开正文/);
    assert.equal(contextOptions.serviceWorkers, 'block');
    assert.equal(contextOptions.acceptDownloads, false);
    assert.equal('storageState' in contextOptions, false);
    assert.deepEqual(routed, [
      ['continue', 'https://public.example/item'],
      ['continue', 'https://public.example/app.js'],
      ['abort', 'https://public.example/banner.jpg', 'blockedbyclient'],
      ['abort', 'http://private.example/secret.js', 'blockedbyclient'],
    ]);
  } finally {
    await renderer.close();
  }
});

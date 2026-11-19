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
      return new Response(JSON.stringify({ data: {
        finalUrl: 'https://news.example/final',
        html: '<html><article>渲染正文</article></html>',
        readable: { title: '渲染标题', text: '浏览器直接识别的正文内容。'.repeat(8), source: 'article' },
      } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  assert.deepEqual(submitted, { url: original.finalUrl });
  assert.equal(page.sourceUrl, original.sourceUrl);
  assert.equal(page.finalUrl, 'https://news.example/final');
  assert.match(page.html, /渲染正文/);
  assert.equal(page.readable.title, '渲染标题');
  assert.match(page.readable.text, /直接识别/);
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
  const previousSecret = process.env.TEXT_MODEL_API_KEY;
  process.env.TEXT_MODEL_API_KEY = 'must-not-enter-browser';
  let contextOptions;
  let launchOptions;
  let routeHandler;
  let evaluateCalls = 0;
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
        async evaluate() {
          evaluateCalls += 1;
          if (evaluateCalls === 2) {
            return {
              title: '浏览器可读标题',
              text: '这是浏览器从可见文章容器中读取的公开正文内容，包含足够长度用于验证稳定协议。'.repeat(3),
              source: 'article',
            };
          }
          return undefined;
        },
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
    chromiumLoader: async () => ({
      launch: async options => {
        launchOptions = options;
        return browser;
      },
    }),
    lookup: async hostname => [{ address: hostname === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 }],
  });
  try {
    const result = await renderer.render('https://public.example/item');
    assert.match(result.html, /公开正文/);
    assert.equal(result.readable.title, '浏览器可读标题');
    assert.match(result.readable.text, /可见文章容器/);
    assert.equal(contextOptions.serviceWorkers, 'block');
    assert.equal(contextOptions.acceptDownloads, false);
    assert.equal('storageState' in contextOptions, false);
    assert.equal(launchOptions.headless, true);
    assert.equal(typeof launchOptions.env, 'object');
    assert.equal(launchOptions.env.TEXT_MODEL_API_KEY, undefined);
    assert.deepEqual(routed, [
      ['continue', 'https://public.example/item'],
      ['continue', 'https://public.example/app.js'],
      ['abort', 'https://public.example/banner.jpg', 'blockedbyclient'],
      ['abort', 'http://private.example/secret.js', 'blockedbyclient'],
    ]);
  } finally {
    await renderer.close();
    if (previousSecret === undefined) delete process.env.TEXT_MODEL_API_KEY;
    else process.env.TEXT_MODEL_API_KEY = previousSecret;
  }
});

test('实验探测只截取可见Canvas并返回限制诊断', async () => {
  let evaluateCalls = 0;
  const capture = Buffer.from('canvas-png');
  const context = {
    async route() {},
    async newPage() {
      return {
        setDefaultTimeout() {}, on() {},
        async goto() { return { status: () => 200 }; },
        async waitForLoadState() {},
        async evaluate() {
          evaluateCalls += 1;
          if (evaluateCalls === 2) return null;
          if (evaluateCalls === 3) return {
            visibleText: '当前公开可见章节，登录会员后继续阅读。', canvasCount: 1,
            canvases: [{ index: 0, id: 'txtCanvas-0', className: '', width: 800, height: 1200, visible: true }],
            hasRestrictionSignal: true, hasLoadingSignal: false,
          };
          return undefined;
        },
        locator() { return { all: async () => [{ screenshot: async () => capture }] }; },
        async screenshot() { throw new Error('有Canvas时不应截取整个视口'); },
        async content() { return '<html><canvas id="txtCanvas-0"></canvas></html>'; },
        async title() { return '公开试读'; },
        url() { return 'https://public.example/chapter'; },
      };
    },
    async close() {},
  };
  const browser = { on() {}, async newContext() { return context; }, version() { return 'fake'; }, async close() {} };
  const renderer = createBrowserRenderer({
    chromiumLoader: async () => ({ launch: async () => browser }),
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
  });
  try {
    const result = await renderer.probe('https://public.example/chapter');
    assert.equal(result.probe.diagnostics.canvasCount, 1);
    assert.equal(result.probe.diagnostics.hasRestrictionSignal, true);
    assert.equal(result.probe.captures.length, 1);
    assert.deepEqual(result.probe.captures[0].data, capture);
  } finally {
    await renderer.close();
  }
});

test('浏览器实际连接到内网地址时拒绝返回页面',async()=>{
  const context={
    async route(){},
    async newPage(){return {setDefaultTimeout(){},on(){},async goto(){return {status:()=>200,serverAddr:async()=>({ipAddress:'127.0.0.1',port:443})};},async content(){return '<html></html>';},async close(){}};},
    async close(){},
  };
  const browser={on(){},async newContext(){return context;},version(){return 'fake';},async close(){}};
  const renderer=createBrowserRenderer({chromiumLoader:async()=>({launch:async()=>browser}),lookup:async()=>[{address:'93.184.216.34',family:4}]});
  try{await assert.rejects(()=>renderer.render('https://public.example/item'),error=>error.code==='PRIVATE_ADDRESS'&&error.status===403);}
  finally{await renderer.close();}
});

test('浏览器进程断开后下一次请求会重新启动',async()=>{
  let launches=0,disconnect;
  const createBrowser=()=>({
    on(event,handler){if(event==='disconnected')disconnect=handler;},
    async newContext(){return {async route(){},async newPage(){return {setDefaultTimeout(){},on(){},async goto(){return {status:()=>200};},async waitForLoadState(){},async evaluate(){return null;},async content(){return '<html><article>公开正文内容足够用于验证重新启动。</article></html>';},async title(){return '标题';},url(){return 'https://public.example/item';}};},async close(){}};},
    version(){return 'fake';},async close(){},
  });
  const renderer=createBrowserRenderer({chromiumLoader:async()=>({launch:async()=>{launches+=1;return createBrowser();}}),lookup:async()=>[{address:'93.184.216.34',family:4}]});
  try{await renderer.render('https://public.example/item');disconnect();await renderer.render('https://public.example/item');assert.equal(launches,2);}
  finally{await renderer.close();}
});

test('浏览器渲染队列超过上限时立即返回繁忙',async()=>{
  const previousConcurrency=process.env.TEXT_BROWSER_RENDERER_MAX_CONCURRENCY,previousQueue=process.env.TEXT_BROWSER_RENDERER_MAX_QUEUE;
  process.env.TEXT_BROWSER_RENDERER_MAX_CONCURRENCY='1';process.env.TEXT_BROWSER_RENDERER_MAX_QUEUE='1';
  let releaseFirst;const gate=new Promise(resolve=>{releaseFirst=resolve;});let navigations=0;
  const context={async route(){},async newPage(){return {setDefaultTimeout(){},on(){},async goto(){navigations+=1;if(navigations===1)await gate;return {status:()=>200};},async waitForLoadState(){},async evaluate(){return null;},async content(){return '<html><article>公开正文</article></html>';},async title(){return '标题';},url(){return 'https://public.example/item';}};},async close(){}};
  const browser={on(){},async newContext(){return context;},version(){return 'fake';},async close(){}};
  const renderer=createBrowserRenderer({chromiumLoader:async()=>({launch:async()=>browser}),lookup:async()=>[{address:'93.184.216.34',family:4}]});
  try{
    const first=renderer.render('https://public.example/one');
    await new Promise(resolve=>setImmediate(resolve));
    const second=renderer.render('https://public.example/two');
    await new Promise(resolve=>setImmediate(resolve));
    await assert.rejects(()=>renderer.render('https://public.example/three'),error=>error.code==='RENDERER_BUSY'&&error.status===429);
    releaseFirst();await Promise.all([first,second]);
  }finally{
    releaseFirst();await renderer.close();
    if(previousConcurrency===undefined)delete process.env.TEXT_BROWSER_RENDERER_MAX_CONCURRENCY;else process.env.TEXT_BROWSER_RENDERER_MAX_CONCURRENCY=previousConcurrency;
    if(previousQueue===undefined)delete process.env.TEXT_BROWSER_RENDERER_MAX_QUEUE;else process.env.TEXT_BROWSER_RENDERER_MAX_QUEUE=previousQueue;
  }
});

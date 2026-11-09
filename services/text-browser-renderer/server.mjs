import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicUrl } from '../../src/modules/text/novel-import.js';

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

function loadLocalEnv() {
  return readFile(path.join(serviceDir, '.env'), 'utf8').then(text => {
    for (const original of text.replace(/^\uFEFF/u, '').split(/\r?\n/u)) {
      const match = /^\s*(TEXT_BROWSER_RENDERER_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/u.exec(original);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
      process.env[match[1]] = value;
    }
  }).catch(error => { if (error?.code !== 'ENOENT') throw error; });
}

function json(response, status, body, extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw Object.assign(new Error('请求过大。'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw Object.assign(new Error('请求过大。'), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('请求必须是有效JSON。'), { code: 'INVALID_JSON', status: 400 }); }
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function createLimiter(maximum) {
  const limit = Math.max(1, Math.floor(maximum));
  const queue = [];
  let active = 0;
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return async task => {
    if (active >= limit) await new Promise(resolve => queue.push(resolve));
    active += 1;
    try { return await task(); }
    finally { release(); }
  };
}

function rendererError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

export function createBrowserRenderer({ chromiumLoader, lookup } = {}) {
  let browserPromise;
  const timeoutMs = positiveNumber(process.env.TEXT_BROWSER_RENDERER_TIMEOUT_MS, 60_000);
  const settleMs = positiveNumber(process.env.TEXT_BROWSER_RENDERER_SETTLE_MS, 3_000);
  const runLimited = createLimiter(positiveNumber(process.env.TEXT_BROWSER_RENDERER_MAX_CONCURRENCY, 2));

  const getBrowser = async () => {
    if (!browserPromise) browserPromise = (async () => {
      const chromium = chromiumLoader ? await chromiumLoader() : (await import('playwright')).chromium;
      const executablePath = String(process.env.TEXT_BROWSER_RENDERER_EXECUTABLE_PATH || '').trim();
      return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    })().catch(error => {
      browserPromise = undefined;
      throw rendererError('BROWSER_NOT_READY', error?.message || '无法启动浏览器渲染引擎。', 503);
    });
    return browserPromise;
  };

  const render = url => runLimited(async () => {
    const initial = await assertPublicUrl(url, { lookup });
    const browser = await getBrowser();
    const context = await browser.newContext({
      locale: 'zh-CN',
      javaScriptEnabled: true,
      acceptDownloads: false,
      serviceWorkers: 'block',
      ignoreHTTPSErrors: false,
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/153.0 Safari/537.36 VERITAS-Renderer/1.0',
    });
    const checked = new Map();
    try {
      await context.route('**/*', async route => {
        const request = route.request();
        if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return route.abort('blockedbyclient');
        let target;
        try { target = new URL(request.url()); }
        catch { return route.abort('blockedbyclient'); }
        if (['data:', 'blob:', 'about:'].includes(target.protocol)) return route.continue();
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return route.abort('blockedbyclient');
        const cacheKey = `${target.protocol}//${target.host}`;
        try {
          if (!checked.has(cacheKey)) checked.set(cacheKey, assertPublicUrl(target, { lookup }));
          await checked.get(cacheKey);
          return route.continue();
        } catch { return route.abort('blockedbyclient'); }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      const response = await page.goto(initial.url.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const status = response?.status() || 0;
      if ([202, 401, 403, 407, 429].includes(status)) throw rendererError('ACCESS_RESTRICTED', `目标页面返回 HTTP ${status}。`, 422);
      if (status < 200 || status >= 400) throw rendererError('UPSTREAM_ERROR', `目标页面返回 HTTP ${status || '未知'}。`);
      await page.waitForLoadState('networkidle', { timeout: settleMs }).catch(() => {});
      await page.evaluate(async delay => {
        const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        if (height > innerHeight) {
          scrollTo(0, Math.min(height, innerHeight * 2));
          await new Promise(resolve => setTimeout(resolve, delay));
          scrollTo(0, 0);
        }
      }, Math.min(settleMs, 1_500)).catch(() => {});
      const html = await page.content();
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) throw rendererError('RENDERED_PAGE_TOO_LARGE', '渲染后的页面超过4MiB。', 413);
      return { sourceUrl: initial.url.href, finalUrl: page.url(), title: await page.title(), html, renderer: 'playwright-chromium' };
    } finally {
      await context.close().catch(() => {});
    }
  });

  return {
    render,
    async health() {
      const browser = await getBrowser();
      return { engine: 'playwright-chromium', version: browser.version() };
    },
    async close() {
      const browser = await browserPromise?.catch(() => null);
      browserPromise = undefined;
      await browser?.close().catch(() => {});
    },
  };
}

export function createRendererServer({ renderer = createBrowserRenderer() } = {}) {
  return http.createServer(async (request, response) => {
    let pathname;
    try { pathname = new URL(request.url, 'http://localhost').pathname; }
    catch { return json(response, 400, { error: { code: 'INVALID_URL', message: '无效请求地址。' } }); }

    if (pathname === '/health') {
      if (request.method !== 'GET') return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请使用GET。' } }, { Allow: 'GET' });
      try {
        const engine = typeof renderer.health === 'function' ? await renderer.health() : { engine: 'injected-renderer' };
        return json(response, 200, { status: 'ok', ready: true, service: 'text-browser-renderer', ...engine });
      } catch (error) {
        return json(response, 503, { status: 'degraded', ready: false, service: 'text-browser-renderer', error: { code: error.code || 'BROWSER_NOT_READY', message: error.message } });
      }
    }

    if (pathname !== '/api/v1/render') return json(response, 404, { error: { code: 'NOT_FOUND', message: '接口不存在。' } });
    if (request.method !== 'POST') return json(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: '请使用POST。' } }, { Allow: 'POST' });
    if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      request.resume();
      return json(response, 415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: '请使用application/json。' } });
    }
    try {
      const payload = await readJsonBody(request);
      if (typeof payload?.url !== 'string' || !payload.url.trim()) throw rendererError('INVALID_URL', 'url不能为空。', 400);
      const data = await renderer.render(payload.url);
      return json(response, 200, { data });
    } catch (error) {
      return json(response, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : '浏览器渲染失败。' } });
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await loadLocalEnv();
  const renderer = createBrowserRenderer();
  const host = process.env.TEXT_BROWSER_RENDERER_HOST || '127.0.0.1';
  const port = Number(process.env.TEXT_BROWSER_RENDERER_PORT || 8014);
  const server = createRendererServer({ renderer });
  server.listen(port, host, () => console.log(`Text browser renderer: http://${host}:${port}`));
  const shutdown = () => server.close(async () => { await renderer.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPublicUrl, isPublicIp } from '../../src/modules/text/novel-import.js';

const serviceDir = path.dirname(fileURLToPath(import.meta.url));
const MAX_REQUEST_BYTES = 32 * 1024;
const MAX_HTML_BYTES = 4 * 1024 * 1024;
const MAX_READABLE_TEXT_CHARS = 200_000;
const MAX_PROBE_CAPTURES = 12;
const MAX_CAPTURE_PIXELS = 16_000_000;
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

export function loadBrowserRendererEnv() {
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

function browserLaunchEnvironment() {
  const environment = {};
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'XDG_RUNTIME_DIR', 'DISPLAY']) {
    if (process.env[key]) environment[key] = process.env[key];
  }
  const libraryPath = String(process.env.TEXT_BROWSER_RENDERER_LIBRARY_PATH || '').trim();
  const fontconfigFile = String(process.env.TEXT_BROWSER_RENDERER_FONTCONFIG_FILE || '').trim();
  if (libraryPath) {
    environment.LD_LIBRARY_PATH = [libraryPath, environment.LD_LIBRARY_PATH].filter(Boolean).join(path.delimiter);
  }
  if (fontconfigFile) environment.FONTCONFIG_FILE = fontconfigFile;
  return environment;
}

function createLimiter(maximum, maximumQueue) {
  const limit = Math.max(1, Math.floor(maximum));
  const queueLimit = Math.max(0, Math.floor(maximumQueue));
  const queue = [];
  let active = 0;
  const release = () => {
    active -= 1;
    queue.shift()?.();
  };
  return async task => {
    if (active >= limit) {
      if (queue.length >= queueLimit) throw rendererError('RENDERER_BUSY', '浏览器渲染任务过多，请稍后重试。', 429);
      await new Promise(resolve => queue.push(resolve));
    }
    active += 1;
    try { return await task(); }
    finally { release(); }
  };
}

function rendererError(code, message, status = 502) {
  return Object.assign(new Error(message), { code, status });
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/gu, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function readableDocument(readable) {
  const paragraphs = String(readable?.text || '').split(/\n+/u).map(line => line.trim()).filter(Boolean);
  return '<!doctype html><html><head><meta charset="utf-8"><title>'
    + escapeHtml(readable?.title || '') + '</title></head><body><article data-veritas-readable="true">'
    + paragraphs.map(paragraph => '<p>' + escapeHtml(paragraph) + '</p>').join('')
    + '</article></body></html>';
}

export function createBrowserRenderer({ chromiumLoader, lookup } = {}) {
  let browserPromise;
  const timeoutMs = positiveNumber(process.env.TEXT_BROWSER_RENDERER_TIMEOUT_MS, 60_000);
  const settleMs = positiveNumber(process.env.TEXT_BROWSER_RENDERER_SETTLE_MS, 3_000);
  const concurrency = positiveNumber(process.env.TEXT_BROWSER_RENDERER_MAX_CONCURRENCY, 2);
  const runLimited = createLimiter(concurrency, positiveNumber(process.env.TEXT_BROWSER_RENDERER_MAX_QUEUE, concurrency * 4));

  const getBrowser = async () => {
    if (!browserPromise) {
      const pending = (async () => {
        const chromium = chromiumLoader ? await chromiumLoader() : (await import('playwright')).chromium;
        const executablePath = String(process.env.TEXT_BROWSER_RENDERER_EXECUTABLE_PATH || '').trim();
        const browser = await chromium.launch({
          headless: true,
          env: browserLaunchEnvironment(),
          ...(executablePath ? { executablePath } : {}),
        });
        browser.on?.('disconnected', () => { if (browserPromise === pending) browserPromise = undefined; });
        return browser;
      })().catch(error => {
        if (browserPromise === pending) browserPromise = undefined;
        throw rendererError('BROWSER_NOT_READY', error?.message || '无法启动浏览器渲染引擎。', 503);
      });
      browserPromise = pending;
    }
    return browserPromise;
  };

  const renderPage = (url, { capture = false } = {}) => runLimited(async () => {
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
    try {
      await context.route('**/*', async route => {
        const request = route.request();
        if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return route.abort('blockedbyclient');
        let target;
        try { target = new URL(request.url()); }
        catch { return route.abort('blockedbyclient'); }
        if (['data:', 'blob:', 'about:'].includes(target.protocol)) return route.continue();
        if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password) return route.abort('blockedbyclient');
        try {
          await assertPublicUrl(target, { lookup });
          return route.continue();
        } catch { return route.abort('blockedbyclient'); }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(timeoutMs);
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      const peerChecks = new Set();
      let peerViolation;
      page.on('response', networkResponse => {
        if (typeof networkResponse?.serverAddr !== 'function') return;
        const check = networkResponse.serverAddr()
          .then(peer => { if (peer?.ipAddress && !isPublicIp(peer.ipAddress)) peerViolation ||= peer.ipAddress; })
          .catch(() => {})
          .finally(() => peerChecks.delete(check));
        peerChecks.add(check);
      });
      const response = await page.goto(initial.url.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
      const status = response?.status() || 0;
      const peer = await response?.serverAddr?.().catch(() => null);
      if (peer?.ipAddress && !isPublicIp(peer.ipAddress)) throw rendererError('PRIVATE_ADDRESS', '浏览器实际连接到了非公开网络地址，已停止渲染。', 403);
      if ([202, 401, 403, 407, 429].includes(status)) throw rendererError('ACCESS_RESTRICTED', `目标页面返回 HTTP ${status}。`, 422);
      if (status < 200 || status >= 400) throw rendererError('UPSTREAM_ERROR', `目标页面返回 HTTP ${status || '未知'}。`);
      await page.waitForLoadState('networkidle', { timeout: settleMs }).catch(() => {});
      await Promise.allSettled([...peerChecks]);
      if (peerViolation) throw rendererError('PRIVATE_ADDRESS', '页面子资源实际连接到了非公开网络地址，已停止渲染。', 403);
      await page.evaluate(async delay => {
        const height = Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0);
        if (height > innerHeight) {
          scrollTo(0, Math.min(height, innerHeight * 2));
          await new Promise(resolve => setTimeout(resolve, delay));
          scrollTo(0, 0);
        }
      }, Math.min(settleMs, 1_500)).catch(() => {});
      const readable = await page.evaluate(maximum => {
        const selector = [
          'article',
          '[itemprop="articleBody"]',
          '[role="article"]',
          '[data-testid*="article" i]',
          '[class*="article-body" i]',
          '[class*="article_content" i]',
          '[class*="article-content" i]',
          '[class*="articlecontent" i]',
          '[class*="story-body" i]',
          '[class*="entry-content" i]',
          '[class*="post-content" i]',
          '[class*="content-body" i]',
          'main',
        ].join(',');
        const privacyPatterns = [
          /微软重视您的隐私/iu,
          /我们和我们的合作伙伴处理数据/iu,
          /(?:使用|存储|访问).{0,20}Cookie/iu,
          /(?:接受|拒绝|管理).{0,12}(?:全部|首选项|Cookie)/iu,
          /个性化广告|隐私声明|第三方供应商/iu,
        ];
        const normalize = value => {
          const lines = String(value || '').replace(/\r/gu, '').split(/\n+/u)
            .map(line => line.replace(/[ \t\u00a0\u200b\ufeff]+/gu, ' ').trim())
            .filter(Boolean);
          return lines.filter((line, index) => index === 0 || line !== lines[index - 1]).join('\n').slice(0, maximum);
        };
        const roots = [document];
        for (let index = 0; index < roots.length; index += 1) {
          for (const element of roots[index].querySelectorAll('*')) {
            if (element.shadowRoot && !roots.includes(element.shadowRoot)) roots.push(element.shadowRoot);
          }
        }
        const candidates = [];
        const seen = new Set();
        for (const root of roots) {
          for (const element of root.querySelectorAll(selector)) {
            if (seen.has(element)) continue;
            seen.add(element);
            const style = getComputedStyle(element);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const identity = [element.tagName, element.id, element.className, element.getAttribute('role')]
              .map(value => String(value || '')).join(' ').toLowerCase();
            if (/(?:cookie|consent|privacy|modal|overlay|advert|footer|navigation|toolbar)/u.test(identity)) continue;
            const text = normalize(element.innerText || element.textContent);
            if (text.length < 80) continue;
            const privacyHits = privacyPatterns.reduce((count, pattern) => count + Number(pattern.test(text.slice(0, 4_000))), 0);
            if (privacyHits >= 2) continue;
            const linkText = [...element.querySelectorAll('a')].reduce((total, link) => total + normalize(link.innerText).length, 0);
            const linkDensity = linkText / Math.max(text.length, 1);
            const paragraphCount = element.querySelectorAll('p').length;
            const semanticBoost = element.matches('[itemprop="articleBody"],article,[role="article"]') ? 6_000
              : /article|story|entry|post|content-body/u.test(identity) ? 3_000
                : 0;
            const score = text.length + paragraphCount * 120 + semanticBoost - linkDensity * text.length * 1.5;
            const heading = normalize(element.querySelector('h1')?.innerText);
            candidates.push({ element, text, heading, score, source: identity.slice(0, 240) });
          }
        }
        candidates.sort((left, right) => right.score - left.score);
        const selected = candidates[0];
        if (!selected) return null;
        const documentHeading = normalize(document.querySelector('h1')?.innerText);
        const metadataTitle = document.querySelector('meta[property="og:title"],meta[name="twitter:title"]')?.content || '';
        const title = [selected.heading, normalize(metadataTitle), documentHeading, document.title]
          .map(normalize)
          .find(value => value && !privacyPatterns.some(pattern => pattern.test(value))) || '';
        return {
          title,
          text: selected.text,
          source: selected.source,
        };
      }, MAX_READABLE_TEXT_CHARS).catch(() => null);
      let html;
      try { html = await page.content(); }
      catch (error) {
        if (!readable?.text) throw error;
        html = readableDocument(readable);
      }
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        if (!readable?.text) throw rendererError('RENDERED_PAGE_TOO_LARGE', '渲染后的页面超过4MiB。', 413);
        html = readableDocument(readable);
      }
      const title = readable?.title || await page.title().catch(() => '');
      const finalUrl = page.url() || initial.url.href;
      let probe;
      if (capture) {
        const diagnostics = await page.evaluate(() => {
          const visibleText = String(document.body?.innerText || '').replace(/\s+/gu, ' ').trim();
          const canvases = [...document.querySelectorAll('canvas')].map((canvas, index) => {
            const rectangle = canvas.getBoundingClientRect();
            return {
              index,
              id: canvas.id || '',
              className: typeof canvas.className === 'string' ? canvas.className : '',
              width: Math.round(rectangle.width),
              height: Math.round(rectangle.height),
              visible: rectangle.width > 0 && rectangle.height > 0 && getComputedStyle(canvas).visibility !== 'hidden',
            };
          });
          return {
            visibleText: visibleText.slice(0, 4_000),
            canvasCount: canvases.length,
            canvases,
            hasRestrictionSignal: /登录|会员|订阅|付费|验证码|人机验证|下载.{0,12}(?:APP|客户端)|小程序/iu.test(visibleText),
            hasLoadingSignal: /(?:^|\s)加载中(?:\s|$)/u.test(visibleText),
          };
        }).catch(() => ({ visibleText: '', canvasCount: 0, canvases: [], hasRestrictionSignal: false, hasLoadingSignal: false }));
        const captures = [];
        const canvasLocators = await page.locator('canvas').all().catch(() => []);
        for (let index = 0; index < canvasLocators.length && captures.length < MAX_PROBE_CAPTURES; index += 1) {
          const locator = canvasLocators[index];
          const metadata = diagnostics.canvases?.[index] || {};
          if (!metadata.visible || metadata.width < 160 || metadata.height < 80) continue;
          if (metadata.width * metadata.height > MAX_CAPTURE_PIXELS) continue;
          const data = await locator.screenshot({ type: 'png', animations: 'disabled', timeout: timeoutMs }).catch(() => null);
          if (data?.length) captures.push({ kind: 'canvas', index, id: metadata.id || '', width: metadata.width, height: metadata.height, data });
        }
        if (!captures.length) {
          const data = await page.screenshot({ type: 'png', fullPage: false, animations: 'disabled', timeout: timeoutMs }).catch(() => null);
          if (data?.length) captures.push({ kind: 'viewport', index: 0, id: '', width: 0, height: 0, data });
        }
        probe = { diagnostics, captures };
      }
      return {
        sourceUrl: initial.url.href,
        finalUrl,
        title,
        html,
        readable,
        renderer: 'playwright-chromium',
        ...(probe ? { probe } : {}),
      };
    } finally {
      await context.close().catch(() => {});
    }
  });

  const render = url => renderPage(url);
  const probe = url => renderPage(url, { capture: true });

  return {
    render,
    probe,
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
  await loadBrowserRendererEnv();
  const renderer = createBrowserRenderer();
  const host = process.env.TEXT_BROWSER_RENDERER_HOST || '127.0.0.1';
  const port = Number(process.env.TEXT_BROWSER_RENDERER_PORT || 8014);
  const server = createRendererServer({ renderer });
  server.listen(port, host, () => console.log(`Text browser renderer: http://${host}:${port}`));
  const shutdown = () => server.close(async () => { await renderer.close(); process.exit(0); });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

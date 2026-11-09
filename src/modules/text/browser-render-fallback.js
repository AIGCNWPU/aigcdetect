const DEFAULT_TIMEOUT_MS = 60_000;

function envFlag(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(?:1|true|yes|on)$/iu.test(String(value));
}

function configuredEndpoint(options = {}) {
  if (options.textImportBrowserUrl === false) return '';
  if (typeof options.textImportBrowserUrl === 'string') return options.textImportBrowserUrl.trim();
  if (!envFlag(process.env.TEXT_IMPORT_BROWSER_ENABLED, false)) return '';
  return String(process.env.TEXT_IMPORT_BROWSER_URL || 'http://127.0.0.1:8014/api/v1/render').trim();
}

function reportFailure(options, reason, status) {
  if (options.browserRendererLogger === false) return;
  const logger = typeof options.browserRendererLogger === 'function' ? options.browserRendererLogger : console.warn;
  logger(JSON.stringify({ event: 'text_browser_renderer_failed', reason, ...(status ? { status } : {}) }));
}

function renderedPage(payload, originalPage) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const html = typeof data?.html === 'string' ? data.html : '';
  if (!html.trim()) return null;
  let finalUrl;
  try {
    finalUrl = new URL(String(data.finalUrl || originalPage.finalUrl || originalPage.sourceUrl)).href;
  } catch { return null; }
  if (!/^https?:/iu.test(finalUrl)) return null;
  return {
    sourceUrl: originalPage.sourceUrl,
    finalUrl,
    html,
    headers: {},
    rendered: true,
  };
}

export function looksClientRendered(html = '') {
  const source = String(html);
  if (!/<script\b/iu.test(source)) return false;
  if (/<article\b|articleBody|application\/ld\+json|itemprop=["']articleBody/iu.test(source)) return false;
  const visible = source
    .replace(/<(?:script|style|noscript|template)\b[^>]*>[\s\S]*?<\/(?:script|style|noscript|template)>/giu, ' ')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return visible.length < 2_000;
}

export async function renderHtmlWithBrowser(page, options = {}) {
  const endpoint = configuredEndpoint(options);
  if (!endpoint || !page?.finalUrl) return null;
  const timeoutMs = Number(options.textImportBrowserTimeoutMs || process.env.TEXT_IMPORT_BROWSER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
  try {
    const request = options.browserFetch || globalThis.fetch;
    const response = await request(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: page.finalUrl }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      reportFailure(options, 'renderer-rejected-url', response.status);
      return null;
    }
    const rendered = renderedPage(payload, page);
    if (!rendered) reportFailure(options, 'empty-rendered-page');
    return rendered;
  } catch (error) {
    reportFailure(options, error?.name === 'AbortError' ? 'timeout' : 'request-failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const DEFAULT_TIMEOUT_MS = 90_000;
const minimumDocumentLength = 60;

function envFlag(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return /^(?:1|true|yes|on)$/i.test(String(value));
}

function configuredEndpoint(options = {}) {
  if (options.textImportParserUrl === false || options.mineruHtmlApiUrl === false) return '';
  const explicit = options.textImportParserUrl || options.mineruHtmlApiUrl;
  if (typeof explicit === 'string') return explicit.trim();
  if (!envFlag(process.env.TEXT_IMPORT_PARSER_ENABLED, true)) return '';
  return String(process.env.TEXT_IMPORT_PARSER_URL || 'http://127.0.0.1:8013/api/v1/html/parse').trim();
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function flattenChapters(chapters, output = []) {
  for (const chapter of Array.isArray(chapters) ? chapters : []) {
    if (!chapter || typeof chapter !== 'object') continue;
    const title = normalizeText(chapter.raw || chapter.title);
    const text = normalizeText(chapter.text || chapter.content);
    if (title || text) output.push({ title, text });
    flattenChapters(chapter.children, output);
  }
  return output;
}

function responseDocument(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const sections = flattenChapters(data?.chapters || data?.sections);
  const candidates = [data?.text, data?.markdown, data?.content, ...sections.map(item => item.text)]
    .map(normalizeText)
    .filter(value => value.length >= minimumDocumentLength)
    .sort((left, right) => right.length - left.length);
  if (!candidates.length) return null;
  return { text: candidates[0], sections };
}

function reportFailure(options, reason, status) {
  if (options.mineruLogger === false) return;
  const logger = typeof options.mineruLogger === 'function' ? options.mineruLogger : console.warn;
  logger(JSON.stringify({ event: 'text_import_parser_failed', reason, ...(status ? { status } : {}) }));
}

export async function extractHtmlWithMineru(page, options = {}) {
  const endpoint = configuredEndpoint(options);
  if (!endpoint || !page?.html) return null;

  const timeoutMs = Number(options.textImportParserTimeoutMs || options.mineruHtmlTimeoutMs || process.env.TEXT_IMPORT_PARSER_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);

  try {
    const request = options.mineruFetch || globalThis.fetch;
    const response = await request(endpoint, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: page.html, sourceUrl: page.finalUrl || page.sourceUrl || '' }),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      reportFailure(options, 'parser-rejected-html', response.status);
      return null;
    }
    const document = responseDocument(payload);
    if (!document) reportFailure(options, 'empty-document');
    return document;
  } catch (error) {
    reportFailure(options, error?.name === 'AbortError' ? 'timeout' : 'request-failed');
    return null;
  } finally {
    clearTimeout(timer);
  }
}

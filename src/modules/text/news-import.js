import { NovelImportError, fetchPublicPage } from './novel-import.js';

export const NEWS_IMPORT_PATH = '/api/v1/text/news/import';

export class NewsImportError extends NovelImportError {
  constructor(code, message, options = {}) {
    super(code, message, options);
    this.name = 'NewsImportError';
  }
}

const entityMap = {
  amp: '&', apos: "'", bull: '•', copy: '©', emsp: ' ', ensp: ' ', gt: '>', hellip: '…',
  ldquo: '“', lsquo: '‘', lt: '<', mdash: '—', middot: '·', nbsp: ' ', ndash: '–',
  quot: '"', rdquo: '”', reg: '®', rsquo: '’', thinsp: ' ', times: '×', zwnj: '', zwj: '',
};
const minimumReadableLength = 80;
const verificationPattern = /(?:(?:请|需要|完成|输入|通过|正在进行|安全)[^。\n]{0,30}(?:captcha|验证码|人机验证)|(?:captcha|验证码|人机验证)[^。\n]{0,30}(?:继续访问|访问页面|安全检查))/i;
const restrictionPattern = /(?:登录后(?:查看|阅读)|订阅后(?:查看|阅读)|付费后(?:查看|阅读)|购买后阅读|会员专享|剩余内容|展开全文|继续阅读需|访问过于频繁)/i;

const siteAdapters = [
  {
    domains: ['cctv.com'],
    displayName: '央视网',
    patterns: [/<(div|section|main)\b[^>]*(?:id|class)=["'][^"']*\bcontent_18313\b[^"']*["'][^>]*>/i],
  },
  {
    domains: ['chinanews.com.cn'],
    displayName: '中国新闻网',
    patterns: [/<(div|section|main)\b[^>]*(?:id|class)=["'][^"']*\bcontent_maincontent_content\b[^"']*["'][^>]*>/i],
  },
  {
    domains: ['ifeng.com'],
    displayName: '凤凰网',
    patterns: [/<(div|section|main)\b[^>]*(?:id|class)=["'][^"']*\bindex_text_[\w-]+\b[^"']*["'][^>]*>/i],
  },
  {
    domains: ['thepaper.cn'],
    displayName: '澎湃新闻',
    patterns: [/<(div|section|main)\b[^>]*(?:id|class)=["'][^"']*\b(?:leftcontent__|index_leftContent_)[\w-]+\b[^"']*["'][^>]*>/i],
  },
];

function decodeEntities(value = '') {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (match, entity) => {
    if (entity[0] === '#') {
      const numeric = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : match;
    }
    return entityMap[entity.toLowerCase()] ?? match;
  });
}

function removeElements(html, names) {
  return names.reduce((value, name) => value.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, 'gi'), ''), html);
}

function plainText(html = '') {
  const withoutNoise = removeElements(html, ['script', 'style', 'noscript', 'svg', 'form', 'nav', 'aside', 'footer', 'button', 'template']);
  return decodeEntities(withoutNoise
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[\u00a0\u200b\ufeff]/g, ' ')
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .filter(line => !/^(?:责任编辑|相关阅读|相关推荐|返回首页|分享至|打开客户端|广告)$/.test(line))
    .filter(line => !restrictionPattern.test(line) || line.length > 80)
    .join('\n');
}

function visiblePageText(html = '') {
  const withoutHiddenContent = removeElements(html, ['script', 'style', 'noscript', 'svg', 'template']);
  return decodeEntities(withoutHiddenContent.replace(/<[^>]+>/g, ' '))
    .replace(/[\u00a0\u200b\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function bodyPatternsFor(finalUrl) {
  const hostname = new URL(finalUrl).hostname.toLowerCase();
  return siteAdapters
    .filter(adapter => adapter.domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))
    .flatMap(adapter => adapter.patterns);
}

function inferredSiteName(finalUrl) {
  const hostname = new URL(finalUrl).hostname.toLowerCase();
  return siteAdapters.find(adapter => adapter.domains.some(domain => hostname === domain || hostname.endsWith(`.${domain}`)))?.displayName
    || hostname;
}

function elementInner(html, openingPattern) {
  const match = openingPattern.exec(html);
  if (!match) return '';
  const tag = match[1].toLowerCase();
  const start = match.index + match[0].length;
  const tags = new RegExp(`<\/?${tag}\\b[^>]*>`, 'gi');
  tags.lastIndex = start;
  let depth = 1;
  let current;
  while ((current = tags.exec(html))) {
    if (current[0][1] === '/') depth -= 1;
    else if (!current[0].endsWith('/>')) depth += 1;
    if (depth === 0) return html.slice(start, current.index);
  }
  return '';
}

function firstText(html, patterns) {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    const value = plainText(match?.[1]);
    if (value) return value;
  }
  return '';
}

function metaContent(html, names) {
  const expected = new Set(names.map(name => name.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = new Map();
    for (const attribute of match[0].matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
      attributes.set(attribute[1].toLowerCase(), decodeEntities(attribute[3]).trim());
    }
    const key = (attributes.get('property') || attributes.get('name') || attributes.get('itemprop') || '').toLowerCase();
    if (expected.has(key) && attributes.get('content')) return attributes.get('content');
  }
  return '';
}

function jsonLdNodes(html) {
  const nodes = [];
  const visit = value => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object') return;
    nodes.push(value);
    if (value['@graph']) visit(value['@graph']);
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json[^"']*["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { visit(JSON.parse(decodeEntities(match[1]).trim())); } catch { /* Ignore malformed publisher metadata. */ }
  }
  return nodes;
}

function isArticleNode(node) {
  const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
  return types.some(type => /^(?:NewsArticle|Article|ReportageNewsArticle)$/i.test(String(type || '')));
}

function authorName(value) {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(authorName).filter(Boolean).join('、');
  return typeof value?.name === 'string' ? value.name.trim() : '';
}

function paragraphText(html) {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => plainText(match[1]))
    .filter(value => value.length > 1)
    .join('\n');
}

function cleanTitle(title, siteName) {
  let value = plainText(title);
  if (siteName) {
    const escaped = siteName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    value = value.replace(new RegExp(`\\s*[-_|·]\\s*${escaped}\\s*$`, 'i'), '');
  }
  return value.trim();
}

export function extractNewsContent(html, page) {
  const pageSignals = visiblePageText(html);
  if (verificationPattern.test(pageSignals) || /(?:访问过于频繁|x-waf)/i.test(pageSignals)) {
    throw new NewsImportError('ACCESS_RESTRICTED', '目标新闻网站要求验证码或人机验证，未提取正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'VERIFICATION_REQUIRED' });
  }

  const article = jsonLdNodes(html).find(isArticleNode) || {};
  const siteName = metaContent(html, ['og:site_name', 'application-name', 'source']) || inferredSiteName(page.finalUrl);
  const rawTitle = String(article.headline || metaContent(html, ['og:title', 'twitter:title']) || firstText(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]));
  const title = cleanTitle(rawTitle, siteName);
  const author = authorName(article.author) || metaContent(html, ['author', 'article:author', 'byl']);
  const publishedAt = String(article.datePublished || metaContent(html, ['article:published_time', 'datepublished', 'pubdate', 'publishdate']) || '').trim();

  const candidates = [];
  if (typeof article.articleBody === 'string') candidates.push(plainText(article.articleBody));
  for (const pattern of [
    ...bodyPatternsFor(page.finalUrl),
    /<(article)\b[^>]*>/i,
    /<(div|section|main|span)\b[^>]*itemprop=["']articleBody["'][^>]*>/i,
    /<(div|section|main|span)\b[^>]*(?:id|class)=["'][^"']*(?:article-content|article-body|articleEdit|post-content|news-content|detail-content|detailContent|正文)[^"']*["'][^>]*>/i,
  ]) {
    const bodyHtml = elementInner(html, pattern);
    if (bodyHtml) candidates.push(paragraphText(bodyHtml) || plainText(bodyHtml));
  }
  const content = candidates.map(value => value.trim()).filter(Boolean).sort((left, right) => right.length - left.length)[0] || '';
  const restricted = restrictionPattern.test(pageSignals);

  if (restricted && content.length < minimumReadableLength) {
    throw new NewsImportError('ACCESS_RESTRICTED', '该新闻页面需要登录、订阅或付费，未发现公开可读正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'READING_RESTRICTED' });
  }
  if (!title || content.length < minimumReadableLength) {
    throw new NewsImportError('CONTENT_NOT_FOUND', '未能可靠识别新闻标题和正文，请改用粘贴正文。', { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl });
  }

  return {
    siteName,
    title,
    author,
    publishedAt,
    content,
    extractionStatus: restricted ? 'partial' : 'completed',
    completeness: restricted ? 'partial' : 'unknown',
    notice: restricted
      ? '仅提取页面当前公开可读的部分，后续仅检测已导入内容。'
      : '已提取公开新闻正文，但无法仅凭页面确认是否完整，请在提交前核对。',
  };
}

export async function importNewsArticle(sourceUrl, options = {}) {
  const page = await fetchPublicPage(sourceUrl, options);
  return { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, ...extractNewsContent(page.html, page) };
}

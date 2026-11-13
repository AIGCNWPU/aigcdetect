import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { extractHtmlWithMineru } from './mineru-html-fallback.js';
import { looksClientRendered, renderHtmlWithBrowser } from './browser-render-fallback.js';

export const NOVEL_IMPORT_PATH = '/api/v1/text/novel/import';
export const NOVEL_IMPORT_LIMITS = Object.freeze({ maxRedirects: 5, timeoutMs: 10_000, maxBytes: 2 * 1024 * 1024 });

export class NovelImportError extends Error {
  constructor(code, message, { status = 422, sourceUrl, finalUrl, reason = code } = {}) {
    super(message);
    this.name = 'NovelImportError';
    this.code = code;
    this.status = status;
    this.details = {
      sourceUrl,
      finalUrl,
      extractionStatus: code === 'ACCESS_RESTRICTED' || code === 'CONTENT_OBFUSCATED' ? 'restricted' : 'failed',
      completeness: 'unavailable',
      reason,
    };
  }
}

function parseIpv4(address) {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map(part => Number(part));
  if (bytes.some((byte, index) => !Number.isInteger(byte) || byte < 0 || byte > 255 || String(byte) !== parts[index].replace(/^0+(?=\d)/, ''))) return null;
  return bytes;
}

function isPublicIpv4(address) {
  const bytes = parseIpv4(address);
  if (!bytes) return false;
  const [a, b, c] = bytes;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function ipv6ToBigInt(address) {
  let value = address.toLowerCase().split('%')[0];
  if (value.includes('.')) {
    const lastColon = value.lastIndexOf(':');
    const bytes = parseIpv4(value.slice(lastColon + 1));
    if (!bytes) return null;
    value = `${value.slice(0, lastColon)}:${((bytes[0] << 8) | bytes[1]).toString(16)}:${((bytes[2] << 8) | bytes[3]).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some(part => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  return parts.reduce((total, part) => (total << 16n) + BigInt(`0x${part}`), 0n);
}

function matchesIpv6Prefix(value, prefix, bits) {
  const shift = 128n - BigInt(bits);
  return value >> shift === prefix >> shift;
}

function isPublicIpv6(address) {
  const value = ipv6ToBigInt(address);
  if (value === null || value === 0n || value === 1n) return false;
  const prefixes = [
    ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['100::', 64], ['2001:db8::', 32],
    ['2001:2::', 48], ['2001:10::', 28], ['2002::', 16], ['64:ff9b:1::', 48],
  ];
  if (prefixes.some(([prefix, bits]) => matchesIpv6Prefix(value, ipv6ToBigInt(prefix), bits))) return false;
  const mappedPrefix = ipv6ToBigInt('::ffff:0:0');
  if (matchesIpv6Prefix(value, mappedPrefix, 96)) {
    const raw = Number(value & 0xffffffffn);
    return isPublicIpv4(`${raw >>> 24}.${raw >>> 16 & 255}.${raw >>> 8 & 255}.${raw & 255}`);
  }
  return matchesIpv6Prefix(value, ipv6ToBigInt('2000::'), 3);
}

export function isPublicIp(address) {
  const version = isIP(address);
  return version === 4 ? isPublicIpv4(address) : version === 6 ? isPublicIpv6(address) : false;
}

function parseSourceUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch { throw new NovelImportError('INVALID_URL', '请输入有效的 http 或 https 网页链接。', { status: 400, sourceUrl: String(input || '') }); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new NovelImportError('INVALID_URL', '只支持不含账号信息的 http 或 https 章节链接。', { status: 400, sourceUrl: url.href });
  }
  return url;
}

export async function assertPublicUrl(input, { lookup = dnsLookup } = {}) {
  const url = input instanceof URL ? input : parseSourceUrl(input);
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); }
  catch { throw new NovelImportError('DNS_FAILED', '无法解析目标网站地址，请检查链接或稍后重试。', { status: 502, sourceUrl: url.href }); }
  if (!Array.isArray(addresses) || !addresses.length) throw new NovelImportError('DNS_FAILED', '目标网站没有可用的公开地址。', { status: 502, sourceUrl: url.href });
  if (addresses.some(item => !isPublicIp(item.address))) {
    throw new NovelImportError('PRIVATE_ADDRESS', '为保护服务安全，不能访问本机、内网或其他非公开地址。', { status: 403, sourceUrl: url.href });
  }
  return { url, addresses, selected: addresses[0] };
}

function decoderFor(response) {
  const encoding = String(response.headers['content-encoding'] || '').toLowerCase();
  if (encoding === 'gzip') return response.pipe(createGunzip());
  if (encoding === 'deflate') return response.pipe(createInflate());
  if (encoding === 'br') return response.pipe(createBrotliDecompress());
  return response;
}

function readLimitedBody(response, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(response.headers['content-length']);
    if (Number.isFinite(declared) && declared > maxBytes) {
      response.destroy();
      reject(new NovelImportError('RESPONSE_TOO_LARGE', '目标网页超过允许的响应大小。', { status: 413 }));
      return;
    }
    const stream = decoderFor(response);
    const chunks = [];
    let size = 0;
    stream.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        stream.destroy(new NovelImportError('RESPONSE_TOO_LARGE', '目标网页超过允许的响应大小。', { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

function requestPinned(target, { timeoutMs, maxBytes }) {
  const { url, selected } = target;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const transport = url.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const request = transport({
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      servername: url.protocol === 'https:' ? hostname : undefined,
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Host: url.host,
        'User-Agent': 'VERITAS-WebImporter/1.0 (+public content import)',
      },
      lookup(_name, options, callback) {
        if (typeof options === 'object' && options.all) callback(null, [{ address: selected.address, family: selected.family }]);
        else callback(null, selected.address, selected.family);
      },
    }, async response => {
      try {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume();
          resolve({ status: response.statusCode, headers: response.headers, body: null });
          return;
        }
        const body = await readLimitedBody(response, maxBytes);
        resolve({ status: response.statusCode || 0, headers: response.headers, body });
      } catch (error) { reject(error); }
    });
    request.setTimeout(timeoutMs, () => request.destroy(new NovelImportError('FETCH_TIMEOUT', '获取网页超时，请稍后重试或改用粘贴正文。', { status: 504, sourceUrl: url.href })));
    request.on('error', error => reject(error instanceof NovelImportError ? error : new NovelImportError('FETCH_FAILED', '无法获取目标网页，请稍后重试或改用粘贴正文。', { status: 502, sourceUrl: url.href })));
    request.end();
  });
}

function decodeResponse(buffer, headers) {
  const contentType = String(headers['content-type'] || '');
  const head = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('ascii');
  const charset = contentType.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]
    || head.match(/<meta[^>]+charset\s*=\s*["']?([^\s"'/>]+)/i)?.[1]
    || head.match(/<meta[^>]+content=["'][^"']*charset=([^\s"';]+)/i)?.[1]
    || 'utf-8';
  const normalized = /^(?:gbk|gb2312)$/i.test(charset) ? 'gb18030' : charset;
  try { return new TextDecoder(normalized).decode(buffer); }
  catch { return new TextDecoder('utf-8').decode(buffer); }
}

export async function fetchPublicPage(input, options = {}) {
  const limits = { ...NOVEL_IMPORT_LIMITS, ...options };
  const source = parseSourceUrl(input);
  let current = source;
  for (let redirect = 0; redirect <= limits.maxRedirects; redirect += 1) {
    const target = await assertPublicUrl(current, { lookup: options.lookup || dnsLookup });
    let response;
    try { response = await (options.request || requestPinned)(target, limits); }
    catch (error) {
      if (error instanceof NovelImportError) {
        error.details.sourceUrl ||= source.href;
        error.details.finalUrl ||= current.href;
        throw error;
      }
      throw new NovelImportError('FETCH_FAILED', '无法获取目标网页，请稍后重试或改用粘贴正文。', { status: 502, sourceUrl: source.href, finalUrl: current.href });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.location;
      if (!location) throw new NovelImportError('INVALID_REDIRECT', '目标网站返回了无效重定向。', { status: 502, sourceUrl: source.href, finalUrl: current.href });
      if (redirect === limits.maxRedirects) throw new NovelImportError('TOO_MANY_REDIRECTS', '目标网页重定向次数过多。', { status: 508, sourceUrl: source.href, finalUrl: current.href });
      current = parseSourceUrl(new URL(location, current).href);
      continue;
    }
    if ([202, 401, 403, 406, 407, 429].includes(response.status)) {
      throw new NovelImportError('ACCESS_RESTRICTED', '目标网站要求登录、验证或限制了自动访问，未提取正文。', { status: 422, sourceUrl: source.href, finalUrl: current.href, reason: `HTTP_${response.status}` });
    }
    if (response.status === 404) throw new NovelImportError('PAGE_NOT_FOUND', '没有找到目标网页。', { status: 404, sourceUrl: source.href, finalUrl: current.href });
    if (response.status < 200 || response.status >= 300) throw new NovelImportError('UPSTREAM_ERROR', `目标网站返回 HTTP ${response.status}。`, { status: 502, sourceUrl: source.href, finalUrl: current.href });
    const contentType = String(response.headers['content-type'] || '').toLowerCase();
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml+xml') && !contentType.includes('text/plain')) {
      throw new NovelImportError('UNSUPPORTED_CONTENT', '目标地址不是可读取的网页正文。', { status: 415, sourceUrl: source.href, finalUrl: current.href });
    }
    return { sourceUrl: source.href, finalUrl: current.href, html: decodeResponse(response.body || Buffer.alloc(0), response.headers), headers: response.headers };
  }
  throw new NovelImportError('TOO_MANY_REDIRECTS', '目标网页重定向次数过多。', { status: 508, sourceUrl: source.href, finalUrl: current.href });
}

const entityMap = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
function decodeEntities(value) {
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/gi, (_match, entity) => {
    if (entity[0] === '#') {
      const numeric = entity[1].toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : _match;
    }
    return entityMap[entity.toLowerCase()] ?? _match;
  });
}

function removeElements(html, names) {
  return names.reduce((value, name) => value.replace(new RegExp(`<${name}\\b[^>]*>[\\s\\S]*?<\\/${name}>`, 'gi'), ''), html);
}

function plainText(html) {
  const withoutNoise = removeElements(html, ['script', 'style', 'noscript', 'svg', 'form', 'nav', 'aside', 'footer', 'button']);
  return decodeEntities(withoutNoise
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ''))
    .replace(/[\u00a0\u200b\ufeff]/g, ' ')
    .split(/\r?\n/)
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .filter(line => !/^(?:上一章|下一章|目录|加入书架|返回书页|下载客户端|夜间模式)$/.test(line))
    .join('\n');
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
    if (match) {
      const value = plainText(match[1]);
      if (value) return value;
    }
  }
  return '';
}

function cleanTitle(value) {
  return value.replace(/\s*[-_|]\s*(?:刺猬猫|番茄小说官网|起点中文网|飞卢小说网|晋江文学城(?:手机版)?|17K小说网).*$/i, '').trim();
}

function documentTitle(html) {
  return firstText(html, [/<title\b[^>]*>([\s\S]*?)<\/title>/i]);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function workTitleFromDocumentTitle(html, chapterTitle, siteSuffix = '') {
  let value = documentTitle(html);
  if (!value) return '';
  if (chapterTitle) value = value.replace(new RegExp(escapeRegExp(chapterTitle), 'i'), '');
  if (siteSuffix) value = value.replace(siteSuffix, '');
  value = value
    .replace(/(?:小说最新章节|最新章节|免费小说阅读|在线阅读).*$/i, '')
    .replace(/^[\s\-_|:：·]+|[\s\-_|:：·]+$/g, '')
    .trim();
  return value && value.length <= 120 ? value : '';
}

const restrictionPattern = /(?:试读结束|剩余内容|订阅后阅读|登录后阅读|付费后阅读|本章为\s*VIP|购买本章|解锁本章|验证码|访问过于频繁)/i;
const minimumReadableLength = 60;

function extractCiweimao(html, page) {
  if (/\/signup\/login/i.test(new URL(page.finalUrl).pathname) || /<title[^>]*>\s*登录\s*[-_|]/i.test(html)) {
    throw new NovelImportError('ACCESS_RESTRICTED', '该刺猬猫章节需要登录或付费，未提取正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'LOGIN_REQUIRED' });
  }
  const title = cleanTitle(firstText(html, [/<h1[^>]*class=["'][^"']*\bread-hd\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i, /<title[^>]*>([\s\S]*?)<\/title>/i]));
  let bodyHtml = elementInner(html, /<(div|section)\b[^>]*id=["']J_BookRead["'][^>]*>/i);
  bodyHtml = bodyHtml
    .replace(/<a\b[^>]*class=["'][^"']*\bnum-link\b[^"']*["'][^>]*>[\s\S]*?<\/a>/gi, '')
    .replace(/<span\b[^>]*>\s*[a-z0-9]{4,12}\s*<\/span>/gi, '');
  const paragraphs = [...bodyHtml.matchAll(/<p\b[^>]*class=["'][^"']*\bchapter\b[^"']*["'][^>]*>([\s\S]*?)(?=<p\b|$)/gi)]
    .map(match => plainText(match[1])).filter(Boolean);
  const content = paragraphs.join('\n') || plainText(bodyHtml);
  if (!title || !content) throw new NovelImportError('CONTENT_NOT_FOUND', '未能从该刺猬猫页面识别出可读章节正文。', { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl });
  const workTitle = workTitleFromDocumentTitle(html, title, /\s*[-_|]\s*刺猬猫.*$/i);
  const partial = restrictionPattern.test(bodyHtml);
  return {
    site: 'ciweimao', workTitle, title, content,
    extractionStatus: partial ? 'partial' : 'completed',
    completeness: partial ? 'partial' : /class=["'][^"']*chapter-over/i.test(html) ? 'complete' : 'unknown',
    notice: partial ? '仅提取页面当前公开可读的部分，请确认覆盖范围。' : '已提取公开章节正文，请在添加前核对标题、正文和完整性。',
  };
}

function paragraphText(html) {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(match => plainText(match[1]))
    .filter(Boolean)
    .join('\n');
}

function stripLeadingOrdinal(content) {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length > 1 && /^\d{1,6}$/.test(lines[0])) lines.shift();
  return lines.join('\n');
}

function falooDocumentTitles(html) {
  const parts = documentTitle(html).split('_').map(part => part.trim()).filter(Boolean);
  const boundary = parts.findIndex(part => /(?:免费小说阅读|飞卢小说网)/i.test(part));
  const chapterParts = parts.slice(1, boundary > 1 ? boundary : parts.length);
  return {
    workTitle: parts[0] && !/(?:免费小说阅读|飞卢小说网)/i.test(parts[0]) ? cleanTitle(parts[0]) : '',
    chapterTitle: cleanTitle(chapterParts.join(' ')),
  };
}

function stripFalooFooter(content) {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  const footerStart = lines.findIndex(line => {
    const compact = line.replace(/\s+/gu, '');
    const solicitations = ['求收藏', '求鲜花', '求票票', '求订阅', '求打赏']
      .filter(value => compact.includes(value)).length;
    return solicitations >= 2
      || /^(?:国庆读书[!！]|(?:立即|点击)抢充|(?:飞卢小说网|本站)提醒您)/u.test(compact)
      || /(?:充\d+赠\d+VIP点券|月票、鲜花和打赏)/iu.test(compact);
  });
  return (footerStart < 0 ? lines : lines.slice(0, footerStart)).join('\n').trim();
}

function extractFaloo(html, page) {
  const heading = firstText(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i]);
  const documentTitles = falooDocumentTitles(html);
  const workName = firstText(html, [/<a\b[^>]*id=["']novelName["'][^>]*>([\s\S]*?)<\/a>/i]) || documentTitles.workTitle;
  const headingTitle = cleanTitle(workName && heading.startsWith(workName) ? heading.slice(workName.length).trim() : heading);
  const title = headingTitle && headingTitle !== workName ? headingTitle : documentTitles.chapterTitle;
  const bodyHtml = elementInner(html, /<(div|section)\b[^>]*class=["'][^"']*\b(?:noveContent|nodeContent)\b[^"']*["'][^>]*>/i);
  const content = stripFalooFooter(paragraphText(bodyHtml) || plainText(bodyHtml));
  const freeChapter = /\b(?:is_)?vip\s*=\s*["']?0\b/i.test(html);
  const restricted = /\b(?:is_)?vip\s*=\s*["']?1\b/i.test(html) || restrictionPattern.test(bodyHtml);
  if (restricted && content.length < minimumReadableLength) {
    throw new NovelImportError('ACCESS_RESTRICTED', '该飞卢章节需要订阅或登录，未发现公开可读正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'READING_RESTRICTED' });
  }
  if (!title || content.length < minimumReadableLength) {
    throw new NovelImportError('CONTENT_NOT_FOUND', '未能从该飞卢页面识别出可读章节正文。', { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl });
  }
  const partial = restricted;
  return {
    site: 'faloo', workTitle: workName, title, content,
    extractionStatus: partial ? 'partial' : 'completed',
    completeness: partial ? 'partial' : freeChapter ? 'complete' : 'unknown',
    notice: partial
      ? '仅提取该飞卢页面当前公开可读的部分，请确认覆盖范围。'
      : freeChapter
        ? '已提取飞卢公开免费章节正文，请在添加前核对标题和正文。'
        : '已提取飞卢页面正文，但未找到明确的免费章节标记，完整性待人工确认。',
  };
}

function extractJjwxc(html, page) {
  const finalUrl = new URL(page.finalUrl);
  if (/^\/book2\/\d+\/?$/i.test(finalUrl.pathname)) {
    throw new NovelImportError('UNSUPPORTED_PAGE_TYPE', '该链接是晋江作品页；当前只支持单章节正文页，请从目录中选择具体章节。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'DIRECTORY_PAGE' });
  }
  const documentHeading = documentTitle(html);
  const workTitle = firstText(html, [/<meta\b[^>]*(?:property|name)=["'](?:og:novel:book_name|novel:book_name)["'][^>]*content=["']([^"']+)["'][^>]*>/i])
    || (documentHeading.match(/^《([^》]+)》/)?.[1] || '').trim();
  const title = cleanTitle(firstText(html, [
    /<h2\b[^>]*>([\s\S]*?)<\/h2>/i,
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    /<(?:div|p)\b[^>]*class=["'][^"']*(?:chapter[_-]?title|novel[_-]?title)[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|p)>/i,
  ]).replace(/^\s*\d+\s*[、.]\s*/, '')) || cleanTitle(documentHeading.match(/\^([^\^]+)\^/)?.[1] || '');
  const bodyHtml = elementInner(html, /<(ul)\b[^>]*class=["'][^"']*\bcontent_ul\b[^"']*["'][^>]*>/i);
  const content = stripLeadingOrdinal(paragraphText(bodyHtml) || plainText(bodyHtml));
  const restricted = restrictionPattern.test(bodyHtml);
  if (restricted && content.length < minimumReadableLength) {
    throw new NovelImportError('ACCESS_RESTRICTED', '该晋江章节需要订阅或登录，未发现公开可读正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'READING_RESTRICTED' });
  }
  if (!title || content.length < minimumReadableLength) {
    throw new NovelImportError('CONTENT_NOT_FOUND', '未能从该晋江页面识别出可读章节正文。', { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl });
  }
  return {
    site: 'jjwxc', workTitle, title, content,
    extractionStatus: restricted ? 'partial' : 'completed',
    completeness: restricted ? 'partial' : 'unknown',
    notice: restricted
      ? '仅提取该晋江页面当前公开可读的部分，请确认覆盖范围。'
      : '已提取晋江公开章节正文，但页面未提供可靠的完整性标记，请人工核对。',
  };
}

function extract17k(html, page) {
  const finalUrl = new URL(page.finalUrl);
  if (!/^\/chapter\/\d+\/\d+\.html$/i.test(finalUrl.pathname)) {
    throw new NovelImportError('UNSUPPORTED_PAGE_TYPE', '该链接不是17K单章节正文页；请从目录中选择具体章节。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'DIRECTORY_PAGE' });
  }
  const documentHeading = documentTitle(html);
  const title = cleanTitle(firstText(html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i]) || documentHeading.split('_')[0] || '');
  const workTitle = firstText(html, [/<a\b[^>]*href=["'][^"']*\/book\/\d+\.html[^"']*["'][^>]*>([\s\S]*?)<\/a>/i])
    || documentHeading.split('_')[1]?.trim()
    || (metaContent(html, ['og:title']).match(/《([^》]+)》/)?.[1] || '').trim();
  const bodyHtml = elementInner(html, /<(div|section)\b[^>]*class=["'][^"']*\breadAreaBox\b[^"']*\bcontent\b[^"']*["'][^>]*>/i)
    || elementInner(html, /<(div|section)\b[^>]*class=["'][^"']*\bcontent\b[^"']*\breadAreaBox\b[^"']*["'][^>]*>/i);
  const rawContent = paragraphText(bodyHtml) || plainText(bodyHtml);
  const content = rawContent.split(/\n(?:本书首发来自|作者寄语[:：])/i)[0].trim();
  const restricted = restrictionPattern.test(bodyHtml) || (!bodyHtml && /(?:VIP章节|订阅本章|购买后阅读)/i.test(html));
  if (restricted && content.length < minimumReadableLength) {
    throw new NovelImportError('ACCESS_RESTRICTED', '该17K章节需要订阅或登录，未发现公开可读正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'READING_RESTRICTED' });
  }
  if (!title || content.length < minimumReadableLength) {
    throw new NovelImportError('CONTENT_NOT_FOUND', '未能从该17K页面识别出可读章节正文。', { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl });
  }
  return {
    site: '17k', workTitle, title, content,
    extractionStatus: restricted ? 'partial' : 'completed',
    completeness: restricted ? 'partial' : 'unknown',
    notice: restricted
      ? '仅提取该17K页面当前公开可读的部分，请确认覆盖范围。'
      : '已提取17K公开章节正文，但页面未提供可靠的完整性标记，请人工核对。',
  };
}

function extractZongheng(html, page) {
  const title = cleanTitle(firstText(html, [/<div\b[^>]*class=["'][^"']*\btitle_txtbox\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i]));
  const workTitle = metaContent(html, ['og:novel:book_name', 'og:title']) || workTitleFromDocumentTitle(html, title, /\s*[,，_\-|]\s*纵横小说.*$/i);
  const contentPattern = /<(div|section)\b(?=[^>]*class=["'][^"']*\bcontent\b[^"']*["'])(?=[^>]*data-prescription=["'][^"']*["'])[^>]*>/i;
  const contentContainer = contentPattern.exec(html);
  const bodyHtml = contentContainer ? elementInner(html, contentPattern) : '';
  const content = paragraphText(bodyHtml) || plainText(bodyHtml);
  const freeChapter = /data-prescription=["']0["']/i.test(contentContainer?.[0] || '') && /data-vip=["']0["']/i.test(html);
  const restricted = restrictionPattern.test(bodyHtml) || (!freeChapter && /订阅VIP章节|购买本章/i.test(html));
  const privateUseCount = [...content].filter(char => /[\uE000-\uF8FF]/u.test(char)).length;
  if (privateUseCount > 10) {
    throw new NovelImportError('CONTENT_OBFUSCATED', '纵横页面正文存在无法可靠还原的字体混淆，未导入乱码。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'DYNAMIC_FONT' });
  }
  if (restricted && content.length < minimumReadableLength) {
    throw new NovelImportError('ACCESS_RESTRICTED', '该纵横章节需要订阅或登录，未发现公开可读正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'READING_RESTRICTED' });
  }
  if (!title || content.length < minimumReadableLength) {
    throw new NovelImportError('CONTENT_NOT_FOUND', '未能从该纵横页面识别出可读章节正文。', { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl });
  }
  const partial = restricted;
  return {
    site: 'zongheng', workTitle, title, content,
    extractionStatus: partial ? 'partial' : 'completed',
    completeness: partial ? 'partial' : freeChapter ? 'complete' : 'unknown',
    notice: partial
      ? '仅提取该纵横页面当前公开可读的部分，请确认覆盖范围。'
      : freeChapter
        ? '已提取纵横公开免费章节正文，请在添加前核对标题和正文。'
        : '已提取纵横页面正文，但未找到明确的免费章节标记，完整性待人工确认。',
  };
}

function extractGeneric(html, page) {
  const title = cleanTitle(firstText(html, [
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    /<meta\b[^>]*(?:property|name)=["']og:title["'][^>]*content=["']([^"']+)["'][^>]*>/i,
    /<title\b[^>]*>([\s\S]*?)<\/title>/i,
  ]));
  const candidates = [
    /<(article)\b[^>]*>/i,
    /<(div|section|main)\b[^>]*(?:itemprop=["']articleBody["']|(?:id|class)=["'][^"']*(?:chapter-content|read-content|article-content|entry-content|content-body)[^"']*["'])[^>]*>/i,
  ].map(pattern => elementInner(html, pattern)).filter(Boolean);
  const content = candidates.map(plainText).sort((a, b) => b.length - a.length)[0] || '';
  if (restrictionPattern.test(html) && content.length < minimumReadableLength) {
    throw new NovelImportError('ACCESS_RESTRICTED', '页面要求登录、订阅、付费或验证，未发现可读正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'READING_RESTRICTED' });
  }
  if (!title || content.length < minimumReadableLength) throw new NovelImportError('CONTENT_NOT_FOUND', '未能可靠识别单章节标题和正文，请改用粘贴正文。', { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl });
  const workTitle = metaContent(html, ['og:novel:book_name', 'novel:book_name', 'book_name', 'og:book_name'])
    || workTitleFromDocumentTitle(html, title);
  const partial = restrictionPattern.test(html);
  return {
    site: 'generic', workTitle, title, content,
    extractionStatus: partial ? 'partial' : 'completed',
    completeness: partial ? 'partial' : 'unknown',
    notice: partial ? '仅提取页面当前公开可读的部分，请确认覆盖范围。' : '正文已提取，但页面未提供足够线索确认是否完整，请人工核对。',
  };
}

export function extractNovelContent(html, page) {
  const finalUrl = new URL(page.finalUrl);
  const host = finalUrl.hostname.toLowerCase();
  if (host === 'ciweimao.com' || host.endsWith('.ciweimao.com')) {
    if (/^\/book\//i.test(finalUrl.pathname)) {
      throw new NovelImportError('UNSUPPORTED_PAGE_TYPE', '该链接是作品目录页；当前只支持单章节正文页，请从目录中选择具体章节。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'DIRECTORY_PAGE' });
    }
    return extractCiweimao(html, page);
  }
  if (host === 'faloo.com' || host.endsWith('.faloo.com')) return extractFaloo(html, page);
  if (host === 'zongheng.com' || host.endsWith('.zongheng.com')) return extractZongheng(html, page);
  if (host === 'jjwxc.net' || host.endsWith('.jjwxc.net')) return extractJjwxc(html, page);
  if (host === '17k.com' || host.endsWith('.17k.com')) return extract17k(html, page);
  if (host === 'qimao.com' || host.endsWith('.qimao.com') || host === 'shuqi.com' || host.endsWith('.shuqi.com')) {
    throw new NovelImportError('UNSUPPORTED_SITE', '当前未提供该小说平台的链接导入，请粘贴免费章节正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'UNSUPPORTED_SITE' });
  }
  if (host === 'fanqienovel.com' || host.endsWith('.fanqienovel.com')) {
    const privateUseCount = [...html].filter(char => /[\uE000-\uF8FF]/u.test(char)).length;
    if (/font-[a-z0-9]+/i.test(html) && privateUseCount > 10) {
      throw new NovelImportError('CONTENT_OBFUSCATED', '番茄页面正文使用动态字体混淆，后端无法可靠还原，未导入乱码。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'DYNAMIC_FONT' });
    }
  }
  if (/(?:captcha|人机验证|安全验证|访问过于频繁)/i.test(plainText(html)) || /x-waf/i.test(html)) {
    throw new NovelImportError('ACCESS_RESTRICTED', '目标网站要求验证码或人机验证，未提取正文。', { status: 422, sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, reason: 'VERIFICATION_REQUIRED' });
  }
  return extractGeneric(html, page);
}

async function extractNovelWithMineru(page, options, extractionMethod = 'mineru-html') {
  const parsed = await extractHtmlWithMineru(page, options);
  if (!parsed) return null;

  const documentHeading = cleanTitle(firstText(page.html, [/<h1\b[^>]*>([\s\S]*?)<\/h1>/i, /<title\b[^>]*>([\s\S]*?)<\/title>/i]));
  const title = documentHeading || parsed.sections.find(item => item.title)?.title || parsed.text.split('\n')[0];
  const content = parsed.text.split('\n').filter((line, index) => index > 0 || line !== title).join('\n').trim();
  if (!title || content.length < minimumReadableLength) return null;

  const browserRendered = extractionMethod === 'browser-rendered-mineru';
  return {
    sourceUrl: page.sourceUrl,
    finalUrl: page.finalUrl,
    site: 'generic',
    workTitle: workTitleFromDocumentTitle(page.html, title),
    title,
    content,
    extractionStatus: 'completed',
    completeness: 'unknown',
    extractionMethod,
    notice: browserRendered
      ? '常规规则未能识别正文，已在隔离浏览器中渲染公开页面并使用 MinerU 解析；请重点核对章节标题、正文边界和完整性。'
      : '常规章节规则未能顺利提取，已使用 MinerU 重新解析静态 HTML；请重点核对章节标题、正文边界和完整性。',
  };
}

async function extractRenderedNovel(page, options) {
  const rendered = await renderHtmlWithBrowser(page, options);
  if (!rendered) return undefined;
  try {
    const extracted = extractNovelContent(rendered.html, rendered);
    return {
      sourceUrl: rendered.sourceUrl,
      finalUrl: rendered.finalUrl,
      ...extracted,
      extractionMethod: 'browser-rendered',
      notice: `页面需执行公开脚本后才能读取；已通过隔离浏览器渲染。${extracted.notice}`,
    };
  } catch (error) {
    if (!(error instanceof NovelImportError)) throw error;
    return extractNovelWithMineru(rendered, options, 'browser-rendered-mineru');
  }
}

export async function importNovelChapter(sourceUrl, options = {}) {
  const page = await fetchPublicPage(sourceUrl, options);
  try {
    const extracted = extractNovelContent(page.html, page);
    return { sourceUrl: page.sourceUrl, finalUrl: page.finalUrl, ...extracted };
  } catch (error) {
    if (!(error instanceof NovelImportError)) throw error;
    if (looksClientRendered(page.html)) {
      const rendered = await extractRenderedNovel(page, options);
      if (rendered) return rendered;
      if (rendered === undefined) {
        const staticParsed = await extractNovelWithMineru(page, options);
        if (staticParsed) return staticParsed;
      }
    } else {
      const staticParsed = await extractNovelWithMineru(page, options);
      if (staticParsed) return staticParsed;
      const rendered = await extractRenderedNovel(page, options);
      if (rendered) return rendered;
    }
    throw error;
  }
}

import { modules, scenarios } from './catalog.js';
import { icon } from './icons.js';
import { api } from './api.js';
import { pageRenderers } from './modules/registry.js';
import { textLang, countUnits, unitLabel, detectTextLanguage } from './lib/text-units.js';
import { saveHumanizeHistory } from './lib/report-history.js';
import { initAuth, paintAuth, renderMePage } from './lib/auth-client.js';
import { BRAND_SLOGAN, renderBrandWordmark } from './lib/brand-wordmark.js';

const app = document.querySelector('#app');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const href = path => `#${path}`;

// 允许用独立组件填充场景页。未注册时，工作区域保持空白。
export const pageRegistry = new Map(pageRenderers);
export function registerPage(path, render) {
  if (!scenarios.some(scenario => scenario.path === path)) throw new Error(`Unknown scenario: ${path}`);
  pageRegistry.set(path, render);
  if (app.querySelector('.app-layout') && readPath() === path) renderApp();
}

export function resolveRoute(path) {
  if (path === '/') return { type: 'overview' };
  if (path === '/me') return { type: 'me', title: '个人中心' };
  if (path === '/text/academic/ai-reduction') return { type: 'guide', title: 'AI降重指南', module: modules.find(item => item.id === 'text') };
  const module = modules.find(item => path === item.path || path.startsWith(`${item.path}/`));
  if (!module) return { type: 'not-found' };
  if (path === module.path) return { type: 'module', module };
  const scenario = module.scenarios.find(item => path === item.path);
  if (!scenario) return { type: 'not-found' };
  if (path === scenario.path) return { type: 'scenario', module, scenario };
  return { type: 'not-found' };
}

function readPath() {
  try {
    const raw = decodeURIComponent(location.hash.slice(1) || '/');
    return raw.replace(/\/+$/, '') || '/';
  } catch { return '/invalid-route'; }
}

function breadcrumbs(route) {
  let result = '<a href="#/">模块总览</a>';
  if (route.module && route.scenario) {
    result += `${icon('chevron')}<a href="${href(route.module.path)}">${route.module.title}</a>`;
    result += `${icon('chevron')}<span aria-current="page">${route.scenario.title}</span>`;
  } else if (route.module) {
    result += `${icon('chevron')}<span aria-current="page">${route.module.title}</span>`;
  }
  return `<nav class="breadcrumbs" aria-label="面包屑">${result}</nav>`;
}

function overview() {
  return `<header class="page-heading"><div><h1>选择你的检测模块</h1><p class="heading-description">支持文本、图片、视频与音频四类内容的真伪核验与风险定位。</p></div><span class="count-pill">4 大模块 <i></i> 10 个场景</span></header>
    <div class="theme-grid">${modules.map(module => {
      const bottomHref = module.scenarios.length === 1 ? href(module.scenarios[0].path) : href(module.path);
      const bottomLabel = module.scenarios.length > 1 ? `查看 ${module.scenarios.length} 个检测场景` : '进入检测场景';
      return `<article class="theme-card tone-${module.id}">
      <div class="theme-card-top"><a class="theme-symbol" href="${href(module.path)}" aria-label="${escapeHtml(module.title)}">${icon(module.id)}</a></div>
      <a class="theme-title" href="${href(module.path)}"><h2>${module.title}</h2></a>
      <p class="theme-description">${module.description}</p>
      <div class="theme-functions">${module.scenarios.map(scenario => `<a href="${href(scenario.path)}"><span>${scenario.title}</span>${icon('chevron')}</a>`).join('')}</div>
      <a class="theme-bottom" href="${bottomHref}"><span>${bottomLabel}</span><span class="circle-arrow">${icon('arrow')}</span></a>
    </article>`;
    }).join('')}</div>`;
}

function modulePage(route) {
  const module = route.module;
  return `${breadcrumbs(route)}<header class="domain-heading tone-${module.id}"><span class="theme-symbol">${icon(module.id)}</span><div><h1>${module.title}</h1><p class="domain-description">${module.description}</p></div></header>
    <div class="section-heading"><h2>全部场景 <span>${module.scenarios.length}</span></h2></div>
    <div class="feature-grid">${module.scenarios.map(scenario => `<a class="feature-card tone-${module.id}" href="${href(scenario.path)}"><div class="feature-top"><span class="feature-symbol">${icon(module.id)}</span>${icon('arrow','feature-arrow')}</div><h2>${scenario.title}</h2><div class="audience-tags">${scenario.audience.map(user => `<span>${user}</span>`).join('')}</div></a>`).join('')}</div>`;
}

function scenarioPage(route) {
  const { module, scenario } = route;
  return `${breadcrumbs(route)}<header class="detail-heading tone-${module.id}"><span class="feature-symbol">${icon(module.id)}</span><div><h1>${scenario.title}</h1></div><a class="quiet-back" href="${href(module.path)}">${icon('arrow')}<span>返回场景列表</span></a></header>
    <section id="scenario-workspace" class="feature-workspace" aria-label="${escapeHtml(scenario.title)}工作区域"></section>`;
}

const ADVICE_MAP = [
  ['句子较长', '拆分长句', '将过长句子拆成“观点—依据—结论”两到三句，并补充自然的逻辑关系。'],
  ['模板化连接词', '减少模板化衔接', '把“此外、因此、综上所述”等泛化连接词替换为具体的因果、转折或证据关系。'],
  ['高频学术表达', '增加具体表达', '明确研究对象、数据来源和判断条件，避免只使用抽象、通用的学术套话。'],
  ['重复表达', '清理重复内容', '合并重复观点，保留信息量更高的表述，避免同一结论在相邻句子中反复出现。'],
];
const EMPTY_CTX = { hasResult: false, score: 0, highChars: 0, highShare: 0, unit: '字', scope: '', sentences: [], advice: [['补充研究细节', '结合真实实验过程、数据依据和个人判断进行改写。']], text: '', fileName: '' };

function reductionContext() {
  try {
    const stored = JSON.parse(sessionStorage.getItem('academicReductionInput') || 'null');
    const result = stored?.result || {};
    const sentences = result.sentences || [];
    const clues = new Set(sentences.flatMap(item => String(item.clues || '').split(/[、,，]/).filter(Boolean)));
    const advice = ADVICE_MAP.filter(([k]) => clues.has(k)).map(([, t, d]) => [t, d]);
    if (!advice.length) advice.push(EMPTY_CTX.advice[0]);
    const text = stored?.text || '';
    const lang = textLang(text);
    const highChars = sentences.reduce((n, item) => n + (Number(item.ai_score || 0) >= 0.62 ? countUnits(item.text, lang) : 0), 0);
    const total = Math.max(countUnits(text, lang), 1);
    return {
      hasResult: Boolean(stored?.result),
      score: Math.round(Number(result.ai_score || 0) * 100),
      highChars,
      highShare: Math.round(highChars / total * 1000) / 10,
      unit: unitLabel(lang),
      scope: typeof stored?.scope === 'string' ? stored.scope : (stored?.scope?.line || ''),
      sentences, advice, text, fileName: stored?.fileName || '',
    };
  } catch {
    return { ...EMPTY_CTX };
  }
}

function downloadBlob(name, content, type = 'application/octet-stream') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(blob),
    download: name,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

function fileNameFromDisposition(header, fallback) {
  if (!header) return fallback;
  const star = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^["']|["']$/g, '')); } catch { /* keep */ }
  }
  const plain = /filename="([^"]+)"/i.exec(header) || /filename=([^;]+)/i.exec(header);
  return plain ? plain[1].trim().replace(/^["']|["']$/g, '') : fallback;
}

async function downloadHumanizeReport(payload, format, fallbackName) {
  const accept = format === 'html' ? 'text/html' : format === 'md' ? 'text/markdown' : 'application/pdf';
  const res = await fetch(`${api.baseUrl}/api/v1/reports/humanize?format=${encodeURIComponent(format)}&rescore=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: accept },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = await res.text();
    try { detail = JSON.parse(detail).detail || detail; } catch { /* keep */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  downloadBlob(fileNameFromDisposition(res.headers.get('Content-Disposition'), fallbackName), blob, blob.type || accept);
}

const strategyName = s => (!s ? '学术润色' : typeof s === 'string' ? s : String(s.name || s.id || '学术润色'));
const briefText = (t, max = 220) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
};
/** 粗分句：用于润色报告统计改写句数 */
const splitGuideSentences = (text) => String(text || '')
  .replace(/\s+/g, ' ')
  .split(/(?<=[。！？!?…])|(?<=[.])(?=\s|[A-Z"“]|$)/)
  .map(s => s.trim())
  .filter(s => s.length > 1);

/** 统计润色改动：改写句数、改写字/词数 */
const measureGuideRewrite = (before, after, replacements = []) => {
  const lang = detectTextLanguage(before || after);
  const unit = unitLabel(lang);
  const beforeSents = splitGuideSentences(before);
  const totalSent = Math.max(beforeSents.length, 1);
  const totalUnits = Math.max(countUnits(before, lang), 1);
  const changedRows = (replacements || []).filter(r => r && r.changed !== false && String(r.after || '') !== String(r.before || ''));
  let changedSent = 0;
  let changedUnits = 0;
  if (changedRows.length) {
    const touched = new Set();
    for (const row of changedRows) {
      const frag = String(row.before || '').trim();
      if (frag) {
        const hit = beforeSents.findIndex(s => s.includes(frag) || frag.includes(s));
        if (hit >= 0) touched.add(hit);
        else touched.add(`frag:${frag.slice(0, 40)}`);
      }
      changedUnits += Math.max(countUnits(row.before || '', lang), countUnits(row.after || '', lang));
    }
    changedSent = touched.size || changedRows.length;
  } else {
    const afterNorm = String(after || '');
    const changedList = beforeSents.filter(s => s && !afterNorm.includes(s));
    changedSent = changedList.length;
    changedUnits = changedList.reduce((n, s) => n + countUnits(s, lang), 0);
  }
  return {
    unit,
    changedSent: Math.min(changedSent, totalSent),
    totalSent,
    changedUnits: Math.min(changedUnits, totalUnits),
    totalUnits,
  };
};

/** 对照展示用：收起 PDF 软换行、过碎短段，避免左侧显得很「散」 */
const normalizeGuideProse = (text) => {
  let s = String(text || '').replace(/\r\n/g, '\n');
  // 单换行视为软换行；保留空行作为段落
  s = s.replace(/([^\n])\n(?!\n)/g, '$1 ');
  s = s.replace(/[ \t]+/g, ' ');
  const blocks = s.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) return '';
  const isShort = b => b.length < 380 && (b.match(/[.!?。！？]/g) || []).length <= 2;
  const shortRatio = blocks.filter(isShort).length / blocks.length;
  if (blocks.length >= 4 && shortRatio >= 0.7) {
    const merged = [];
    let buf = [];
    const flush = () => {
      if (!buf.length) return;
      merged.push(buf.join(' '));
      buf = [];
    };
    for (const b of blocks) {
      if (isShort(b)) buf.push(b);
      else {
        flush();
        merged.push(b);
      }
    }
    flush();
    return merged.join('\n\n').trim();
  }
  return blocks.join('\n\n').trim();
};
const scoreToneGuide = score => {
  const n = Number(score || 0);
  const pct = n <= 1 ? Math.round(n * 100) : Math.round(n);
  if (pct >= 62) return 'high';
  if (pct >= 42) return 'medium';
  return 'low';
};
const isGuideWordChar = (ch) => /[A-Za-z0-9\u4e00-\u9fff]/.test(ch || '');
const isGuideWholeSpan = (fullText, start, end) => {
  if (!(start >= 0 && end > start && end <= fullText.length)) return false;
  if (start > 0 && isGuideWordChar(fullText[start - 1])) return false;
  if (end < fullText.length && isGuideWordChar(fullText[end])) return false;
  return true;
};
const findGuideSpan = (fullText, needle, from = 0, { wholeWord = false } = {}) => {
  const raw = String(needle || '');
  if (!raw || !fullText) return null;
  const accept = (start, end) => {
    if (!wholeWord || raw.length >= 24) return { start, end };
    return isGuideWholeSpan(fullText, start, end) ? { start, end } : null;
  };
  let idx = fullText.indexOf(raw, from);
  if (idx < 0 && from) idx = fullText.indexOf(raw);
  if (idx >= 0) {
    const hit = accept(idx, idx + raw.length);
    if (hit) return hit;
    // 短词命中单词内部时继续往后找
    if (wholeWord && raw.length < 24) {
      let next = idx + 1;
      while (next <= fullText.length - raw.length) {
        const at = fullText.indexOf(raw, next);
        if (at < 0) break;
        const ok = accept(at, at + raw.length);
        if (ok) return ok;
        next = at + 1;
      }
    }
  }
  const target = raw.replace(/\s+/g, ' ').trim();
  if (!target) return null;
  const map = [];
  let collapsed = '';
  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    if (/\s/.test(ch)) {
      if (collapsed.length && collapsed[collapsed.length - 1] !== ' ') {
        map.push(i);
        collapsed += ' ';
      }
    } else {
      map.push(i);
      collapsed += ch;
    }
  }
  const fromN = from > 0 ? fullText.slice(0, from).replace(/\s+/g, ' ').trim().length : 0;
  let at = collapsed.indexOf(target, fromN);
  if (at < 0) at = collapsed.indexOf(target);
  if (at < 0) return null;
  const start = map[at];
  const end = (map[at + target.length - 1] ?? start) + 1;
  return accept(start, end);
};
/** 为风险句在全文中挂上 start/end，供后端精确回填 */
const locateRiskItems = (fullText, riskItems) => {
  const text = String(fullText || '');
  const located = [];
  const used = [];
  (riskItems || []).forEach((item, i) => {
    const raw = String(item?.text || '').trim();
    if (!raw) return;
    let hit = null;
    let from = 0;
    while (from <= text.length) {
      const cand = findGuideSpan(text, raw, from);
      if (!cand) break;
      const overlap = used.some(u => !(cand.end <= u.start || cand.start >= u.end));
      if (!overlap) {
        hit = cand;
        break;
      }
      from = cand.start + 1;
    }
    if (!hit) return;
    used.push(hit);
    located.push({
      ...item,
      text: text.slice(hit.start, hit.end),
      start: hit.start,
      end: hit.end,
      _i: i,
    });
  });
  return located.sort((a, b) => a.start - b.start || a._i - b._i);
};

/** 原文：段落保留，仅风险句着色 */
const renderGuideBeforeHtml = (fullText, riskItems) => {
  const text = String(fullText || '');
  if (!text) return '';
  const spans = locateRiskItems(text, riskItems).map((item, i) => ({
    start: item.start,
    end: item.end,
    i,
    tone: scoreToneGuide(item.ai_score),
  }));
  let html = '';
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start < cursor) continue;
    if (sp.start > cursor) html += escapeHtml(text.slice(cursor, sp.start));
    html += `<mark class="guide-hl guide-hl-risk guide-hl-${sp.tone}">${escapeHtml(text.slice(sp.start, sp.end))}</mark>`;
    cursor = sp.end;
  }
  if (cursor < text.length) html += escapeHtml(text.slice(cursor));
  return html;
};

/** 按空白切词并保留原文坐标，供前后文真实差分高亮 */
const guideWordTokens = (text) => {
  const s = String(text || '');
  const out = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(s))) {
    out.push({ t: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
};

const mergeGuideSpans = (spans, text, maxGap = 2) => {
  if (!spans.length) return [];
  const sorted = spans.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [{ start: sorted[0].start, end: sorted[0].end }];
  for (let i = 1; i < sorted.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = sorted[i];
    const gap = String(text || '').slice(prev.end, cur.start);
    if (cur.start <= prev.end + maxGap || /^[\s.,;:，。；：]*$/.test(gap)) {
      prev.end = Math.max(prev.end, cur.end);
    } else {
      merged.push({ start: cur.start, end: cur.end });
    }
  }
  return merged;
};

/** 词级 LCS：只标真正增删改的词，避免 replacements 误匹配未改动短语 */
const diffGuideTokenSpans = (beforeText, afterText) => {
  const bt = guideWordTokens(beforeText);
  const at = guideWordTokens(afterText);
  const n = bt.length;
  const m = at.length;
  if (!n && !m) return { beforeSpans: [], afterSpans: [] };
  if (!n) {
    return {
      beforeSpans: [],
      afterSpans: at.length ? mergeGuideSpans([{ start: at[0].start, end: at[m - 1].end }], afterText) : [],
    };
  }
  if (!m) {
    return {
      beforeSpans: mergeGuideSpans([{ start: bt[0].start, end: bt[n - 1].end }], beforeText),
      afterSpans: [],
    };
  }
  // 过长则退回整段对比，避免 O(nm) 卡死
  if (n * m > 2_500_000) {
    const bn = String(beforeText || '').replace(/\s+/g, ' ').trim();
    const an = String(afterText || '').replace(/\s+/g, ' ').trim();
    if (bn === an) return { beforeSpans: [], afterSpans: [] };
    return {
      beforeSpans: bt.length ? mergeGuideSpans([{ start: bt[0].start, end: bt[n - 1].end }], beforeText) : [],
      afterSpans: at.length ? mergeGuideSpans([{ start: at[0].start, end: at[m - 1].end }], afterText) : [],
    };
  }
  const norm = (t) => String(t || '').toLowerCase();
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = norm(bt[i].t) === norm(at[j].t)
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const beforeHits = [];
  const afterHits = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(bt[i].t) === norm(at[j].t)) {
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      beforeHits.push(bt[i]);
      i += 1;
    } else {
      afterHits.push(at[j]);
      j += 1;
    }
  }
  while (i < n) {
    beforeHits.push(bt[i]);
    i += 1;
  }
  while (j < m) {
    afterHits.push(at[j]);
    j += 1;
  }
  return {
    beforeSpans: mergeGuideSpans(beforeHits.map(t => ({ start: t.start, end: t.end })), beforeText),
    afterSpans: mergeGuideSpans(afterHits.map(t => ({ start: t.start, end: t.end })), afterText),
  };
};

/** 按段落对齐后再做词级差分，得到前后两侧真实改动坐标 */
const buildGuideDiffSpans = (beforeText, afterText) => {
  const before = String(beforeText || '');
  const after = String(afterText || '');
  if (!after || before === after) return { beforeSpans: [], afterSpans: [] };
  const splitParas = (text) => {
    const s = String(text || '');
    const parts = [];
    const re = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
    let m;
    while ((m = re.exec(s))) {
      if (m[0].trim()) parts.push({ text: m[0], start: m.index, end: m.index + m[0].length });
    }
    if (!parts.length && s.trim()) parts.push({ text: s, start: 0, end: s.length });
    return parts;
  };
  const bp = splitParas(before);
  const ap = splitParas(after);
  const beforeSpans = [];
  const afterSpans = [];
  const n = Math.max(bp.length, ap.length);
  for (let i = 0; i < n; i++) {
    const b = bp[i];
    const a = ap[i];
    if (b && a) {
      if (b.text === a.text) continue;
      const local = diffGuideTokenSpans(b.text, a.text);
      for (const sp of local.beforeSpans) {
        beforeSpans.push({ start: b.start + sp.start, end: b.start + sp.end });
      }
      for (const sp of local.afterSpans) {
        afterSpans.push({ start: a.start + sp.start, end: a.start + sp.end });
      }
      continue;
    }
    if (b) beforeSpans.push({ start: b.start, end: b.end });
    if (a) afterSpans.push({ start: a.start, end: a.end });
  }
  return {
    beforeSpans: mergeGuideSpans(beforeSpans, before, 8),
    afterSpans: mergeGuideSpans(afterSpans, after, 8),
  };
};

const paintGuideSpans = (text, spans, className) => {
  const source = String(text || '');
  if (!source) return '';
  if (!spans.length) return escapeHtml(source);
  const sorted = spans.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  let html = '';
  let cursor = 0;
  for (const sp of sorted) {
    const start = Math.max(0, Math.min(source.length, sp.start));
    const end = Math.max(start, Math.min(source.length, sp.end));
    if (end <= cursor) continue;
    if (start > cursor) html += escapeHtml(source.slice(cursor, start));
    html += `<mark class="guide-hl ${className}">${escapeHtml(source.slice(start, end))}</mark>`;
    cursor = end;
  }
  if (cursor < source.length) html += escapeHtml(source.slice(cursor));
  return html;
};

/** 润色后：优先按真实差分着色；若无差分再回退 replacements（并跳过原文仍存在的未改动短语） */
const renderGuideAfterHtml = (afterText, replacements, originalText = '') => {
  const text = String(afterText || '');
  if (!text) return escapeHtml(String(originalText || ''));
  const diff = buildGuideDiffSpans(originalText, text);
  if (diff.afterSpans.length) return paintGuideSpans(text, diff.afterSpans, 'guide-hl-new');

  const spans = [];
  let searchFrom = 0;
  for (const row of replacements || []) {
    if (row && row.changed === false) continue;
    const needle = String(row.after || '').trim();
    const beforeNeedle = String(row.before || '').trim();
    if (!needle || needle.length < 12) continue;
    if (beforeNeedle === needle) continue;
    // 该短语在原文里原样存在 → 不是改动，跳过（修复误高亮）
    if (originalText && findGuideSpan(String(originalText), needle, 0, { wholeWord: needle.length < 48 })) continue;
    const hit = findGuideSpan(text, needle, searchFrom, { wholeWord: needle.length < 48 });
    if (!hit) continue;
    if (!isGuideWholeSpan(text, hit.start, hit.end) && needle.length < 48) continue;
    const overlap = spans.some(s => !(hit.end <= s.start || hit.start >= s.end));
    if (overlap) continue;
    spans.push({ start: hit.start, end: hit.end });
    searchFrom = hit.end;
  }
  if (spans.length) return paintGuideSpans(text, spans, 'guide-hl-new');
  return escapeHtml(text);
};

/** 全文润色无 replacements 时：按句对齐生成前后差分，供统计/明细 */
const buildGuideDiffReplacements = (beforeText, afterText) => {
  const beforeSents = splitGuideSentences(beforeText);
  const afterSents = splitGuideSentences(afterText);
  if (!beforeSents.length || !afterSents.length) return [];
  const rows = [];
  const n = Math.min(beforeSents.length, afterSents.length);
  for (let i = 0; i < n; i++) {
    if (beforeSents[i] !== afterSents[i]) {
      rows.push({ before: beforeSents[i], after: afterSents[i], changed: true });
    }
  }
  for (let i = n; i < afterSents.length; i++) {
    rows.push({ before: '', after: afterSents[i], changed: true });
  }
  for (let i = n; i < beforeSents.length; i++) {
    rows.push({ before: beforeSents[i], after: '', changed: true });
  }
  return rows;
};

/** 原文侧：优先真实差分琥珀色；风险模式仍用风险句着色 */
const renderGuideChangedBeforeHtml = (beforeText, afterText, replacements = []) => {
  const text = String(beforeText || '');
  if (!text) return '';
  const diff = buildGuideDiffSpans(text, afterText);
  if (diff.beforeSpans.length) return paintGuideSpans(text, diff.beforeSpans, 'guide-hl-old');

  const spans = [];
  let searchFrom = 0;
  for (const row of replacements || []) {
    if (row && row.changed === false) continue;
    const needle = String(row.before || '').trim();
    const afterNeedle = String(row.after || '').trim();
    if (!needle || needle.length < 12) continue;
    if (afterNeedle === needle) continue;
    if (afterText && findGuideSpan(String(afterText), needle, 0, { wholeWord: needle.length < 48 })) continue;
    const hit = findGuideSpan(text, needle, searchFrom, { wholeWord: needle.length < 48 });
    if (!hit) continue;
    if (!isGuideWholeSpan(text, hit.start, hit.end) && needle.length < 48) continue;
    const overlap = spans.some(s => !(hit.end <= s.start || hit.start >= s.end));
    if (overlap) continue;
    spans.push({ start: hit.start, end: hit.end });
    searchFrom = hit.end;
  }
  if (!spans.length) return escapeHtml(text);
  return paintGuideSpans(text, spans, 'guide-hl-old');
};

const keyPoints = (text, riskItems) => {
  const risks = (riskItems || []).map(i => String(i.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
  return risks.length ? risks.map((line, i) => `${i + 1}. ${briefText(line, 100)}`).join('\n') : briefText(text, 220);
};
/** 去掉「原文 → 改写」残留箭头与首尾空白 */
function cleanGuidePairText(value) {
  return String(value || '')
    .replace(/\s*[→⇒➝➞]\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** 把「原文：… 改写：…」拆成分行 HTML；兼容旧数据挤在一行的情况 */
function formatGuideSuggestion(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return '';
  const pairs = [];
  // 按「原文：」切开，再在块内找「改写：」
  const chunks = text.split(/(?=原文\s*[:：])/);
  for (const chunk of chunks) {
    const block = chunk.trim();
    if (!block) continue;
    const m = block.match(/^原文\s*[:：]\s*([\s\S]*?)\s*改写\s*[:：]\s*([\s\S]*)$/);
    if (m) {
      pairs.push({ before: cleanGuidePairText(m[1]), after: cleanGuidePairText(m[2]) });
      continue;
    }
    // 同行挤在一起：原文：A 改写：B 原文：C 改写：D
    const inline = [...block.matchAll(/原文\s*[:：]\s*(.*?)\s*改写\s*[:：]\s*(.*?)(?=\s*原文\s*[:：]|$)/gs)];
    if (inline.length) {
      for (const hit of inline) {
        const before = cleanGuidePairText(hit[1]);
        const after = cleanGuidePairText(hit[2]);
        if (before || after) pairs.push({ before, after });
      }
      continue;
    }
    pairs.push({ before: '', after: '', plain: cleanGuidePairText(block) });
  }
  if (!pairs.length) {
    return `<p class="guide-suggestion-plain">${escapeHtml(cleanGuidePairText(text))}</p>`;
  }
  return pairs.map(pair => {
    if (pair.plain) {
      return `<p class="guide-suggestion-plain">${escapeHtml(pair.plain)}</p>`;
    }
    return `<div class="guide-rewrite-pair">
      <p><em class="pair-label-before">原文</em><span>${escapeHtml(pair.before)}</span></p>
      <p><em class="pair-label-after">改写</em><span>${escapeHtml(pair.after)}</span></p>
    </div>`;
  }).join('');
}

function renderGuideAdvice(items) {
  return (items || []).map((item, index) => {
    const title = item.title || item.risk || '针对性修改';
    const description = item.description || item.strategy || '';
    const suggestion = item.suggestion || item.rewrite || '';
    const suggestionHtml = suggestion
      ? `<div class="guide-card-suggestion"><strong>修改建议</strong>${formatGuideSuggestion(suggestion)}</div>`
      : '';
    return `<article class="guide-card"><span class="guide-card-index">${index + 1}</span><div class="guide-card-body"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${suggestionHtml}</div></article>`;
  }).join('');
}

function guideBlock(_index, title, bodyHtml, extraClass = '', subtitle = '', actionsHtml = '') {
  const cls = extraClass ? ` guide-block ${extraClass}` : ' guide-block';
  const titleHtml = subtitle
    ? `<div class="guide-block-title"><h2>${escapeHtml(title)}</h2><p class="guide-block-sub">${escapeHtml(subtitle)}</p></div>`
    : `<h2>${escapeHtml(title)}</h2>`;
  const actions = actionsHtml ? `<div class="guide-block-actions">${actionsHtml}</div>` : '';
  return `<section class="${cls.trim()}"><header class="guide-block-head">${titleHtml}${actions}</header><div class="guide-block-body">${bodyHtml}</div></section>`;
}

async function postJson(path, body, { signal } = {}) {
  const response = await fetch(`${api.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error?.message || `HTTP ${response.status}`);
  return payload.data || payload;
}

function guidePage() {
  const ctx = reductionContext();
  const riskAll = ctx.sentences.filter(item => Number(item.ai_score || 0) >= 0.42);
  const riskItems = riskAll.slice(0, 8);
  const scoreTone = ctx.score >= 62 ? 'high' : (ctx.score >= 42 ? 'medium' : 'low');
  const scopeHint = ctx.scope ? `检测范围：${ctx.scope}` : '来自上次论文检测';
  const contextSummary = ctx.hasResult
    ? `<div class="guide-context guide-context-metrics">
        <div class="guide-metric">
          <em>综合 AI 风险率</em>
          <b class="guide-metric-score meta-tone-${scoreTone}">${ctx.score}%</b>
          <small>篇章整体评估</small>
        </div>
        <div class="guide-metric">
          <em>高风险${ctx.unit} · 占全文</em>
          <b>${ctx.highChars.toLocaleString()} <span>${ctx.unit}</span> <span class="guide-metric-sep">/</span> <span>${ctx.highShare}%</span></b>
          <small>AI 率 ≥ 62% 片段统计</small>
        </div>
        <div class="guide-metric">
          <em>待处理片段</em>
          <b>${riskAll.length} 个</b>
          <small>${escapeHtml(scopeHint)}</small>
        </div>
      </div>`
    : '<div class="guide-context guide-context-empty">尚未读取到检测结果，请先返回论文检测完成一次分析，或在下方直接粘贴待润色段落。</div>';
  const adviceHtml = ctx.hasResult
    ? '<p class="guide-advice-loading" role="status"><i></i>正在分析改写方向…</p>'
    : renderGuideAdvice(ctx.advice.map(item => ({ title: item[0], description: item[1] })));
  const adviceBlock = guideBlock(
    '',
    '针对性修改建议',
    `<div class="guide-grid" id="guide-advice-grid">${adviceHtml}</div>`,
  );
  const riskNote = riskAll.length > riskItems.length
    ? `共 ${riskAll.length} 句中高风险片段，优先展示前 ${riskItems.length} 句`
    : '';
  const riskBlock = riskItems.length
    ? guideBlock(
      '',
      '建议优先改写片段',
      riskItems.map(item => `<article class="guide-risk-item"><strong>${Math.round(Number(item.ai_score || 0) * 100)}%</strong><div><p>${escapeHtml(item.text || '')}</p></div></article>`).join(''),
      'guide-block-risk',
      riskNote,
    )
    : '';
  const editorBody = `<div class="guide-editor-controls"><div class="guide-strategy-options" role="radiogroup" aria-label="降重方案"><label class="guide-scope-option"><input type="radio" name="guide-strategy" value="auto" checked><span>方案一 · 温和降重（AI 降得少，保留语义）</span></label><label class="guide-scope-option"><input type="radio" name="guide-strategy" value="egte-adversarial"><span>方案二 · 暴力降重（可能损失语义）</span></label></div></div>
        <textarea id="guide-input" placeholder="完成上一页检测后，检测文本会自动带入这里；也可以手动粘贴需要润色的段落。"></textarea>
        <div class="guide-editor-actions"><div class="guide-editor-actions-left"><div class="guide-scope-options" role="radiogroup" aria-label="润色范围"><label class="guide-scope-option"><input type="radio" name="guide-scope" value="full" checked><span>整段润色</span></label><label class="guide-scope-option"><input type="radio" name="guide-scope" value="risk"><span>仅风险片段</span></label></div><div id="guide-result" class="guide-result" aria-live="polite"></div></div><div class="guide-editor-actions-right"><button class="academic-button academic-button-secondary" id="guide-cancel-button" type="button" hidden>取消</button><button class="academic-button academic-button-primary" id="guide-reduce-button" type="button">开始学术润色</button></div></div>`;
  const editorBlock = guideBlock('', '学术润色与改写', editorBody, 'guide-block-editor');
  const reportBlock = guideBlock(
    '',
    'AI 降重对照报告',
    `<div id="guide-report" class="guide-report is-empty"><p class="guide-report-placeholder">完成上方学术润色后，将在此展示 AI 率变化与改写前后对照。</p></div>`,
    'guide-block-report',
    '',
    `<button class="academic-button academic-button-secondary academic-download-button" type="button" id="guide-dl-pdf" hidden>下载 PDF</button>`,
  );
  return `<nav class="breadcrumbs" aria-label="面包屑"><a href="#/">模块总览</a>${icon('chevron')}<a href="#/text">AI文本检测</a>${icon('chevron')}<a href="#/text/academic">AI论文与学术稿件检测</a>${icon('chevron')}<span aria-current="page">AI降重指南</span></nav>
    <header class="detail-heading tone-text"><span class="feature-symbol">${icon('text')}</span><div><h1>AI降重指南</h1></div><a class="quiet-back" href="#/text/academic">${icon('arrow')}<span>返回论文检测</span></a></header>
    <section class="feature-workspace" aria-label="AI降重指南工作区域">
      <div class="guide-workspace">
        <p class="guide-lead">结合实验细节、论证逻辑与规范引用优化学术表达，在保持原意准确的前提下降低模板化生成痕迹。</p>
        ${contextSummary}
        ${adviceBlock}
        ${riskBlock}
        ${editorBlock}
        ${reportBlock}
      </div>
    </section>`;
}

function guideLoadingHtml(msg) {
  return `<p class="guide-result-loading" role="status"><i aria-hidden="true"></i><span>${escapeHtml(msg)}</span></p>`;
}

function setupGuidePage() {
  const input = document.querySelector('#guide-input');
  const button = document.querySelector('#guide-reduce-button');
  const cancelBtn = document.querySelector('#guide-cancel-button');
  const result = document.querySelector('#guide-result');
  const report = document.querySelector('#guide-report');
  if (!input || !button || !result) return;
  const showResultMsg = (msg, kind = 'error') => {
    if (kind === 'error') {
      result.innerHTML = `<p class="guide-result-error">${escapeHtml(msg)}</p>`;
      return;
    }
    result.innerHTML = guideLoadingHtml(msg);
  };

  let storedInput = null;
  let latestAdvice = [];
  let polishAbort = null;
  let idleLabel = button.textContent || '开始学术润色';
  const setPolishing = (busy) => {
    button.disabled = busy;
    button.innerHTML = busy
      ? '<i class="academic-button-spinner" aria-hidden="true"></i>正在润色中…'
      : idleLabel;
    document.querySelectorAll('input[name="guide-scope"], input[name="guide-strategy"]').forEach(el => {
      el.disabled = busy;
    });
    if (cancelBtn) cancelBtn.hidden = !busy;
  };
  cancelBtn?.addEventListener('click', () => {
    polishAbort?.abort();
  });
  try {
    storedInput = JSON.parse(sessionStorage.getItem('academicReductionInput') || 'null');
    if (storedInput?.text) input.value = storedInput.text;
  } catch { /* ignore */ }

  if (storedInput?.result) {
    const sourceText = storedInput.text || input.value;
    const grid = document.querySelector('#guide-advice-grid');
    const showAdviceError = () => {
      if (grid) {
        grid.innerHTML = '<p class="guide-advice-loading is-error" role="alert">建议生成失败，请稍后刷新重试</p>';
      }
    };
    postJson('/api/v1/text/humanize/advice', {
      content: sourceText, language: detectTextLanguage(sourceText), style: 'academic',
      risk_sentences: storedInput.result.sentences || [],
    }).then(data => {
      const advice = data.advice || [];
      latestAdvice = advice;
      if (advice.length && grid) grid.innerHTML = renderGuideAdvice(advice);
      else showAdviceError();
    }).catch(() => showAdviceError());
  }

  button.addEventListener('click', async () => {
    const fullText = input.value.trim();
    if (!fullText) { showResultMsg('请先输入需要润色的文本'); return; }
    const riskItemsRaw = (storedInput?.result?.sentences || []).filter(item => Number(item.ai_score || 0) >= 0.42);
    const scopeMode = document.querySelector('input[name="guide-scope"]:checked')?.value || 'full';
    const strategyMode = document.querySelector('input[name="guide-strategy"]:checked')?.value || 'auto';
    const polishRiskOnly = scopeMode === 'risk';
    const useEgteAdv = strategyMode === 'egte-adversarial';
    if (polishRiskOnly && !riskItemsRaw.length) {
      showResultMsg('暂无风险片段，请改用整段润色或先完成检测');
      return;
    }
    // 整段/风险对照都先规范化换行，避免原文「一句一段」显得很散
    const source = normalizeGuideProse(fullText);
    const riskItems = polishRiskOnly ? locateRiskItems(source, riskItemsRaw) : riskItemsRaw;
    if (polishRiskOnly && !riskItems.length) {
      showResultMsg('风险句未能在正文中定位，请检查文本是否与检测时一致');
      return;
    }

    polishAbort?.abort();
    polishAbort = new AbortController();
    const { signal } = polishAbort;
    setPolishing(true);
    result.innerHTML = guideLoadingHtml(
      useEgteAdv ? '正在生成多组改写候选并筛选低风险表达，请稍候…' : '正在润色中，请稍候…'
    );
    try {
      const payload = {
        content: source,
        language: detectTextLanguage(source),
        style: 'academic',
        scope: polishRiskOnly ? 'risk' : 'full',
        risk_sentences: riskItems,
      };
      if (useEgteAdv) payload.strategy = 'egte-adversarial';
      const data = await postJson('/api/v1/text/humanize', payload, { signal });
      const rawRewritten = data.text || data.rewritten_text || '';
      // 风险模式 / EGTE 替换保留坐标，不能再改 after 文本；整段 DeepSeek 可再收一下换行
      const rewritten = (polishRiskOnly || useEgteAdv) ? rawRewritten : normalizeGuideProse(rawRewritten);
      const replacements = Array.isArray(data.replacements) ? data.replacements : [];
      const egteMeta = data.egte && typeof data.egte === 'object' ? data.egte : null;
      const ctx = reductionContext();
      const strategy = strategyName(data.strategy || data.strategy_name);
      const windows = data.window_count || data.windows || 1;
      const scope = ctx.scope || '未记录';
      const modeLabel = polishRiskOnly ? '仅风险片段' : '整段润色';
      let afterScorePct = egteMeta && Number.isFinite(Number(egteMeta.after_ai_score))
        ? Math.round(Number(egteMeta.after_ai_score) * 100)
        : null;
      const beforeScorePct = egteMeta && Number.isFinite(Number(egteMeta.before_ai_score))
        ? Math.round(Number(egteMeta.before_ai_score) * 100)
        : ctx.score;
      // 方案一没有 EGTE 元数据：润色后立刻复核一次，页面直接展示前后分
      if (afterScorePct == null && rewritten.trim()) {
        result.innerHTML = guideLoadingHtml('正在复核润色后 AI 率…');
        try {
          const scored = await postJson('/api/v1/text/academic', {
            content: rewritten,
            language: detectTextLanguage(rewritten),
          }, { signal });
          if (Number.isFinite(Number(scored.ai_score))) {
            afterScorePct = Math.round(Number(scored.ai_score) * 100);
          }
        } catch (scoreErr) {
          if (scoreErr?.name === 'AbortError') throw scoreErr;
          /* 复核失败仍展示润色结果，分数留空 */
        }
      }
      const reportPayload = {
        before: source,
        after: rewritten,
        before_result: storedInput?.result || null,
        before_ai_score: (beforeScorePct ?? ctx.score) / 100,
        after_ai_score: afterScorePct != null ? afterScorePct / 100 : undefined,
        strategy: data.strategy || { name: strategy },
        window_count: windows,
        risk_sentences: riskItems,
        advice: latestAdvice,
        language: detectTextLanguage(source),
        mode: modeLabel,
        scope,
        file_name: ctx.fileName || 'academic',
        egte: egteMeta || undefined,
      };
      saveHumanizeHistory({
        originalText: source,
        humanisedText: rewritten,
        originalScore: beforeScorePct ?? ctx.score,
        humanisedScore: afterScorePct ?? 0,
        mode: modeLabel,
        strategy,
        scope,
        fileName: ctx.fileName || '',
      });
      result.innerHTML = '';
      idleLabel = '重新学术润色';
      if (!report) return;
      const displayScore = afterScorePct != null ? afterScorePct : (beforeScorePct ?? ctx.score);
      const scoreTone = displayScore >= 62 ? 'high' : (displayScore >= 42 ? 'medium' : 'low');
      const stem = String(ctx.fileName || 'academic').replace(/\.[^.]+$/, '').trim() || 'academic';
      const highlightRows = (replacements.length
        ? replacements
        : buildGuideDiffReplacements(source, rewritten)
      ).filter(r => r && r.changed !== false && String(r.before || '').trim() !== String(r.after || '').trim());
      const diffSpans = buildGuideDiffSpans(source, rewritten);
      const beforeHtml = polishRiskOnly
        ? renderGuideBeforeHtml(source, riskItems)
        : (diffSpans.beforeSpans.length
          ? paintGuideSpans(source, diffSpans.beforeSpans, 'guide-hl-old')
          : renderGuideChangedBeforeHtml(source, rewritten, highlightRows));
      const afterHtml = diffSpans.afterSpans.length
        ? paintGuideSpans(rewritten, diffSpans.afterSpans, 'guide-hl-new')
        : renderGuideAfterHtml(rewritten, highlightRows, source);
      const replacedN = highlightRows.length;
      const changedN = highlightRows.filter(r => r.changed !== false && String(r.after || '') !== String(r.before || '')).length;
      const rewriteStats = measureGuideRewrite(source, rewritten, highlightRows);
      const hint = useEgteAdv
        ? `暴力降重接受 ${changedN} 处替换` + (afterScorePct != null ? ` · AI 率 ${beforeScorePct}% → ${afterScorePct}%` : '')
        : (polishRiskOnly
          ? `左侧红色为风险句；右侧绿色为已处理 ${replacedN}/${riskItems.length} 处（其中改写 ${changedN} 处）`
          : (changedN
            ? `左侧琥珀色为改前词句，右侧绿色为改后词句（共 ${changedN} 处）`
            : '左右文本一致，无改动高亮'));
      const scoreDelta = afterScorePct != null ? afterScorePct - beforeScorePct : null;
      const deltaAbs = scoreDelta == null ? null : Math.abs(scoreDelta);
      const deltaHtml = scoreDelta == null
        ? `<div><em>检测时高风险${ctx.unit}占比</em><span class="fact-val">${ctx.highShare}%</span></div>`
        : `<div><em>AI 率变化</em><span class="fact-val fact-delta ${scoreDelta < 0 ? 'is-down' : (scoreDelta > 0 ? 'is-up' : 'is-flat')}">${
            scoreDelta < 0 ? `<i aria-hidden="true">↓</i>${deltaAbs}%` : (scoreDelta > 0 ? `<i aria-hidden="true">↑</i>${deltaAbs}%` : '0%')
          }</span></div>`;
      const scoreFacts = `${deltaHtml}
        <div><em>改写句数 / 总句数</em><span class="fact-val">${rewriteStats.changedSent} / ${rewriteStats.totalSent}</span></div>
        <div><em>改写${rewriteStats.unit}数 / 总${rewriteStats.unit}数</em><span class="fact-val">${rewriteStats.changedUnits.toLocaleString()} / ${rewriteStats.totalUnits.toLocaleString()}</span></div>`;
      const scoreLabel = afterScorePct != null ? '降重后 AI 率' : '检测 AI 率';
      const statusLine = afterScorePct != null
        ? `已按「${modeLabel} · ${strategy}」完成改写 · AI 率 ${beforeScorePct}% → ${afterScorePct}% · 可下载 PDF 查看句级变化`
        : `已按「${modeLabel} · ${strategy}」完成改写 · 可下载 PDF 查看复核分数与句级变化`;
      report.className = 'guide-report is-fluid';
      report.innerHTML = `<p class="guide-report-scope">${escapeHtml(statusLine)}</p>
        <div class="guide-report-summary">
          <div class="guide-summary-score meta-tone-${scoreTone}"><strong>${displayScore}%</strong><span>${scoreLabel}</span></div>
          <div class="guide-summary-facts guide-summary-facts-3">
            ${scoreFacts}
          </div>
        </div>
        <div class="guide-report-toolbar" role="toolbar" aria-label="对照视图">
          <div class="report-seg" role="group">
            <button type="button" class="report-seg-btn is-active" data-guide-view="side">左右对照</button>
            <button type="button" class="report-seg-btn" data-guide-view="stack">上下阅读</button>
          </div>
          <span class="guide-report-hint-inline">${escapeHtml(hint)}</span>
        </div>
        <div class="guide-report-columns" data-guide-layout="side">
          <article class="guide-col-before">
            <header><em>原文</em><h3>润色前</h3></header>
            <div class="guide-prose is-collapsed" data-guide-prose>${beforeHtml}</div>
            <button type="button" class="guide-prose-toggle" data-guide-toggle>展开全文</button>
          </article>
          <article class="guide-col-after">
            <header><em>改写稿</em><h3>润色后</h3></header>
            <div class="guide-prose is-collapsed" data-guide-prose>${afterHtml}</div>
            <button type="button" class="guide-prose-toggle" data-guide-toggle>展开全文</button>
          </article>
        </div>`;
      report.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      report.querySelectorAll('[data-guide-view]').forEach(btn => {
        btn.addEventListener('click', () => {
          const layout = btn.getAttribute('data-guide-view') || 'side';
          report.querySelectorAll('[data-guide-view]').forEach(b => b.classList.toggle('is-active', b === btn));
          const cols = report.querySelector('.guide-report-columns');
          if (cols) cols.dataset.guideLayout = layout;
        });
      });
      report.querySelectorAll('[data-guide-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
          const cols = report.querySelector('.guide-report-columns');
          if (cols && cols.dataset.guideLayout !== 'stack') {
            const firstProse = cols.querySelector('[data-guide-prose]');
            const nextCollapsed = !firstProse?.classList.contains('is-collapsed');
            cols.querySelectorAll('[data-guide-prose]').forEach(el => el.classList.toggle('is-collapsed', nextCollapsed));
            cols.querySelectorAll('[data-guide-toggle]').forEach(b => { b.textContent = nextCollapsed ? '展开全文' : '收起'; });
            return;
          }
          const prose = btn.parentElement?.querySelector('[data-guide-prose]');
          if (!prose) return;
          prose.classList.toggle('is-collapsed');
          btn.textContent = prose.classList.contains('is-collapsed') ? '展开全文' : '收起';
        });
      });
      const dlBtn = document.querySelector('#guide-dl-pdf');
      if (dlBtn) {
        dlBtn.hidden = false;
        dlBtn.onclick = async () => {
          const prev = dlBtn.textContent;
          dlBtn.disabled = true;
          dlBtn.textContent = '生成中…';
          try {
            await downloadHumanizeReport(reportPayload, 'pdf', `${stem}-AI降重报告.pdf`);
          } catch (error) {
            showResultMsg(`下载失败：${error.message}`);
          } finally {
            dlBtn.disabled = false;
            dlBtn.textContent = prev;
          }
        };
      }
      report.closest('.guide-block')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (error?.name === 'AbortError') {
        result.innerHTML = '';
      } else {
        showResultMsg(`润色失败：${error.message}`);
      }
    } finally {
      setPolishing(false);
      polishAbort = null;
    }
  });
}

const SIDEBAR_PREF_KEY = 'veritas.sidebar.collapsed';
function isSidebarCollapsed() {
  try { return globalThis.localStorage?.getItem(SIDEBAR_PREF_KEY) === '1'; } catch { return false; }
}
function setSidebarCollapsed(collapsed) {
  try {
    if (collapsed) globalThis.localStorage?.setItem(SIDEBAR_PREF_KEY, '1');
    else globalThis.localStorage?.removeItem(SIDEBAR_PREF_KEY);
  } catch { /* ignore */ }
}

let activePageCleanup = null;

export function unmountWorkspace() {
  if (typeof activePageCleanup === 'function') activePageCleanup();
  else activePageCleanup?.dispose?.();
  activePageCleanup = null;
}

function renderApp() {
  unmountWorkspace();
  const route = resolveRoute(readPath());
  const title = route.scenario?.title || route.module?.title || route.title || 'AI检测平台';
  document.title = `${title} · VERITAS 智鉴`;
  const collapsed = isSidebarCollapsed();
  const views = { me: () => '<section data-me-page></section>', overview, module: modulePage, scenario: scenarioPage, guide: guidePage };
  const content = views[route.type]?.(route) || `<section class="not-found"><p class="eyebrow">404</p><h1>页面未找到</h1><a class="back-link" href="#/">${icon('arrow')}<span>返回模块总览</span></a></section>`;
  app.innerHTML = `<a class="skip-link" href="#main-content">跳转到主要内容</a><header class="topbar"><a class="brand" href="./" aria-label="VERITAS 智鉴首页"><span class="brand-mark"><img src="./public/brand-logo.png?v=5" alt="" width="35" height="35" decoding="async"></span><span class="brand-copy"><span class="brand-title-row"><span class="brand-en">VERITAS</span><span class="brand-divider" aria-hidden="true"></span><span class="brand-cn">${renderBrandWordmark('topbar')}<span class="sr-only">智鉴</span></span></span><span class="brand-slogan">${BRAND_SLOGAN}</span></span></a><div class="workspace-topbar-actions"><a class="workspace-home-link" href="./">${icon('arrow')}<span>返回首页</span></a><button type="button" class="topbar-user" data-topbar-user aria-label="账号与个人中心"><span class="topbar-user-avatar" aria-hidden="true">${icon('user')}</span><span data-topbar-user-label>登录</span></button></div></header>
    <div class="app-layout${collapsed ? ' is-sidebar-collapsed' : ''}"><aside class="sidebar">
      <a href="#/" class="nav-item overview-link ${route.type==='overview'?'active':''}" title="模块总览" ${route.type==='overview'?'aria-current="page"':''}>${icon('overview')}<span>模块总览</span></a>
      <p class="nav-label">检测模块</p><nav aria-label="检测模块">${modules.map(module => `<a href="${href(module.path)}" class="nav-item ${route.module?.id===module.id?'active':''}" title="${escapeHtml(module.title)}" ${route.module?.id===module.id?'aria-current="page"':''}>${icon(module.id)}<span>${module.title}</span><span class="nav-count">${module.scenarios.length}</span></a>`).join('')}</nav>
      <button type="button" class="sidebar-toggle" data-sidebar-toggle aria-label="${collapsed ? '展开侧边栏' : '收起侧边栏'}" aria-expanded="${!collapsed}" title="${collapsed ? '展开侧边栏' : '收起侧边栏'}">${icon(collapsed ? 'sidebarExpand' : 'sidebarCollapse')}</button>
      <div class="sidebar-footer" title="账号与个人中心"><span class="user-avatar" aria-hidden="true">${icon('user')}</span><div class="sidebar-user"><strong>游客</strong><span>登录 / 注册</span></div></div></aside><main id="main-content" class="main-content" tabindex="-1">${content}<footer class="workspace-footer"><span>VERITAS 智鉴</span><span>让真实，有据可循。</span></footer></main></div>`;
  app.querySelector('[data-sidebar-toggle]')?.addEventListener('click', event => {
    const btn = event.currentTarget;
    const layout = app.querySelector('.app-layout');
    if (!layout) return;
    const nextCollapsed = !layout.classList.contains('is-sidebar-collapsed');
    layout.classList.toggle('is-sidebar-collapsed', nextCollapsed);
    setSidebarCollapsed(nextCollapsed);
    const label = nextCollapsed ? '展开侧边栏' : '收起侧边栏';
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
    btn.setAttribute('aria-expanded', String(!nextCollapsed));
    btn.innerHTML = icon(nextCollapsed ? 'sidebarExpand' : 'sidebarCollapse');
    const resizeWorkspace = () => window.dispatchEvent(new Event('resize'));
    const widthTransition = layout.getAnimations().find(animation => animation.transitionProperty === 'grid-template-columns');
    if (widthTransition) void widthTransition.finished.then(resizeWorkspace, () => {});
    else resizeWorkspace();
  });
  if (route.type === 'scenario') {
    const renderer = pageRegistry.get(route.scenario.path);
    if (renderer) activePageCleanup = renderer(document.querySelector('#scenario-workspace'), route) || null;
  }
  if (route.type === 'guide') setupGuidePage();
  paintAuth();
  const mePage = app.querySelector('[data-me-page]');
  void initAuth().then(() => { if (mePage?.isConnected) renderMePage(mePage); });
}

export function mountWorkspace() {
  renderApp();
  window.scrollTo(0, 0);
  document.querySelector('#main-content')?.scrollTo(0, 0);
}
// 跳转到主要内容是文档锚点，不应触发业务路由。
app.addEventListener('click', event => {
  const link = event.target.closest('.skip-link');
  if (link) { event.preventDefault(); document.querySelector('#main-content')?.focus(); }
});
window.Veritas = { modules, scenarios, registerPage, resolveRoute, api };

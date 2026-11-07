import { modules, scenarios } from './catalog.js';
import { icon } from './icons.js';
import { api } from './api.js';
import { pageRenderers } from './modules/registry.js';
import { textLang, countUnits, unitLabel, detectTextLanguage } from './lib/text-units.js';
import { saveHumanizeHistory } from './lib/report-history.js';

const app = document.querySelector('#app');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const href = path => `#${path}`;

// 允许用独立组件填充场景页。未注册时，工作区域保持空白。
export const pageRegistry = new Map(pageRenderers);
export function registerPage(path, render) {
  if (!scenarios.some(scenario => scenario.path === path)) throw new Error(`Unknown scenario: ${path}`);
  pageRegistry.set(path, render);
  if (readPath() === path) renderApp();
}

export function resolveRoute(path) {
  if (path === '/') return { type: 'overview' };
  if (path === '/text/academic/ai-reduction') return { type: 'guide', title: 'AI降重指南' };
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
  if (route.module) result += `${icon('chevron')}<a href="${href(route.module.path)}">${route.module.title}</a>`;
  if (route.scenario) result += `${icon('chevron')}<a href="${href(route.scenario.path)}">${route.scenario.title}</a>`;
  return `<nav class="breadcrumbs" aria-label="面包屑">${result}</nav>`;
}

function overview() {
  return `<header class="page-heading"><div><p class="eyebrow">VERITAS WORKSPACE</p><h1>选择你的检测模块</h1><p class="heading-description">从文本到音视频，一站进入内容真实性检测工作空间。</p></div><span class="count-pill">4 大模块 <i></i> 10 个场景</span></header>
    <div class="theme-grid">${modules.map(module => `<article class="theme-card tone-${module.id}">
      <div class="theme-card-top"><span class="theme-symbol">${icon(module.id)}</span><span class="theme-number">${module.index}</span></div>
      <a class="theme-title" href="${href(module.path)}"><h2>${module.title}</h2></a>
      <p class="theme-description">${module.description}</p>
      <div class="theme-functions">${module.scenarios.map(scenario => `<a href="${href(scenario.path)}"><span>${scenario.title}</span>${icon('chevron')}</a>`).join('')}</div>
      <a class="theme-bottom" href="${href(module.path)}"><span>全部 ${module.scenarios.length} 个场景</span><span class="circle-arrow">${icon('arrow')}</span></a>
    </article>`).join('')}</div>
    <div class="workspace-note">${icon('shield')}<div><strong>多模态内容真实性检测</strong><p>选择检测模块，进入对应业务场景。</p></div><span>TEXT · IMAGE · VIDEO · AUDIO</span></div>`;
}

function modulePage(route) {
  const module = route.module;
  return `${breadcrumbs(route)}<header class="domain-heading tone-${module.id}"><span class="theme-symbol">${icon(module.id)}</span><div><p class="eyebrow">${module.kicker}</p><h1>${module.title}</h1><p class="domain-description">${module.description}</p></div><span class="domain-index">${module.index}</span></header>
    <div class="section-heading"><h2>全部场景 <span>${module.scenarios.length}</span></h2><span class="section-meta">选择业务场景</span></div>
    <div class="feature-grid">${module.scenarios.map(scenario => `<a class="feature-card tone-${module.id}" href="${href(scenario.path)}"><div class="feature-top"><span class="feature-symbol">${icon(module.id)}</span><span class="feature-code">${scenario.code}</span>${icon('arrow','feature-arrow')}</div><h2>${scenario.title}</h2><div class="audience-tags">${scenario.audience.map(user => `<span>${user}</span>`).join('')}</div></a>`).join('')}</div>`;
}

function scenarioPage(route) {
  const { module, scenario } = route;
  return `${breadcrumbs(route)}<header class="detail-heading tone-${module.id}"><span class="feature-symbol">${icon(module.id)}</span><div><p class="eyebrow">${module.kicker} / ${scenario.code}</p><h1>${scenario.title}</h1></div><a class="quiet-back" href="${href(module.path)}">返回场景列表 ${icon('arrow')}</a></header>
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
const findGuideSpan = (fullText, needle, from = 0) => {
  const raw = String(needle || '');
  if (!raw || !fullText) return null;
  let idx = fullText.indexOf(raw, from);
  if (idx < 0 && from) idx = fullText.indexOf(raw);
  if (idx >= 0) return { start: idx, end: idx + raw.length };
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
  return { start, end };
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

/** 润色后：同结构，仅替换片段绿色高亮（含未改动但已处理的句） */
const renderGuideAfterHtml = (afterText, replacements, originalText = '') => {
  const text = String(afterText || '');
  const rows = (replacements || [])
    .map((row, i) => {
      const start = Number(row.after_start);
      const end = Number(row.after_end);
      if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
        return { start, end, i, after: row.after };
      }
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.i - b.i);

  const paint = (source, spans) => {
    let html = '';
    let cursor = 0;
    for (const sp of spans) {
      if (sp.start < cursor) continue;
      if (sp.start > cursor) html += escapeHtml(source.slice(cursor, sp.start));
      const body = sp.after != null ? String(sp.after) : source.slice(sp.start, sp.end);
      html += `<mark class="guide-hl guide-hl-new">${escapeHtml(body)}</mark>`;
      cursor = sp.end;
    }
    if (cursor < source.length) html += escapeHtml(source.slice(cursor));
    return html;
  };

  if (rows.length) return paint(text, rows);

  // 无坐标：按原文 before 位置拼 after，保证每处都有绿色
  const source = String(originalText || '');
  const spans = [];
  let searchFrom = 0;
  let cursor = 0;
  for (const row of replacements || []) {
    const hit = findGuideSpan(source, row.before || '', searchFrom);
    if (!hit || hit.start < cursor) continue;
    spans.push({ start: hit.start, end: hit.end, after: row.after || '' });
    cursor = hit.end;
    searchFrom = hit.end;
  }
  if (!spans.length) return escapeHtml(text || source);

  let html = '';
  cursor = 0;
  for (const sp of spans) {
    html += escapeHtml(source.slice(cursor, sp.start));
    html += `<mark class="guide-hl guide-hl-new">${escapeHtml(sp.after)}</mark>`;
    cursor = sp.end;
  }
  html += escapeHtml(source.slice(cursor));
  return html;
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

function guideBlock(index, title, bodyHtml, extraClass = '', subtitle = '', actionsHtml = '') {
  const cls = extraClass ? ` guide-block ${extraClass}` : ' guide-block';
  const titleHtml = subtitle
    ? `<div class="guide-block-title"><h2>${escapeHtml(title)}</h2><p class="guide-block-sub">${escapeHtml(subtitle)}</p></div>`
    : `<h2>${escapeHtml(title)}</h2>`;
  const actions = actionsHtml ? `<div class="guide-block-actions">${actionsHtml}</div>` : '';
  return `<section class="${cls.trim()}"><header class="guide-block-head"><span class="guide-block-index">${index}</span>${titleHtml}${actions}</header><div class="guide-block-body">${bodyHtml}</div></section>`;
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
  const riskItems = ctx.sentences.filter(item => Number(item.ai_score || 0) >= 0.42).slice(0, 8);
  const scoreTone = ctx.score >= 62 ? 'high' : (ctx.score >= 42 ? 'medium' : 'low');
  const contextSummary = ctx.hasResult
    ? `<div class="guide-context guide-context-metrics">
        <div class="guide-metric">
          <em>模型 AI 率</em>
          <b class="guide-metric-score meta-tone-${scoreTone}">${ctx.score}%</b>
          <small>模型综合判断</small>
        </div>
        <div class="guide-metric">
          <em>高风险${ctx.unit} · 占全文</em>
          <b>${ctx.highChars.toLocaleString()} <span>${ctx.unit}</span> <span class="guide-metric-sep">/</span> <span>${ctx.highShare}%</span></b>
          <small>AI 率≥62% 句子的${ctx.unit}数合计 / 占全文比例</small>
        </div>
        <div class="guide-metric">
          <em>待处理片段</em>
          <b>${riskItems.length} 个</b>
          <small>${escapeHtml(ctx.scope || '来自上次检测')}</small>
        </div>
      </div>`
    : '<div class="guide-context guide-context-empty">尚未读取到检测结果，请先返回论文检测并完成一次检测。</div>';
  const adviceHtml = ctx.hasResult
    ? '<p class="guide-advice-loading" role="status"><i></i>正在分析中…</p>'
    : renderGuideAdvice(ctx.advice.map(item => ({ title: item[0], description: item[1] })));
  // 四大板块：01 建议 → 02 优先处理 → 03 学术润色 → 04 降重报告
  const adviceBlock = guideBlock(
    '01',
    '针对性修改建议',
    `<div class="guide-grid" id="guide-advice-grid">${adviceHtml}</div>`,
  );
  const riskBlock = riskItems.length
    ? guideBlock(
      '02',
      '本次检测建议优先处理',
      riskItems.map(item => `<article class="guide-risk-item"><strong>${Math.round(Number(item.ai_score || 0) * 100)}%</strong><div><p>${escapeHtml(item.text || '')}</p></div></article>`).join(''),
      'guide-block-risk',
      '红色数字为该句 AI 率，越高越可疑',
    )
    : '';
  const editorBody = `<div class="guide-editor-controls"><div class="guide-strategy-options" role="radiogroup" aria-label="降重方案"><label class="guide-scope-option"><input type="radio" name="guide-strategy" value="auto" checked><span>方案一 · DeepSeek 学术润色</span></label><label class="guide-scope-option"><input type="radio" name="guide-strategy" value="egte-adversarial"><span>方案二 · EGTE 对抗改写</span></label></div></div>
        <textarea id="guide-input" placeholder="完成上一页检测后，检测文本会自动带入这里；也可以手动粘贴需要润色的段落。"></textarea>
        <div class="guide-editor-actions"><div class="guide-editor-actions-left"><div class="guide-scope-options" role="radiogroup" aria-label="润色范围"><label class="guide-scope-option"><input type="radio" name="guide-scope" value="full" checked><span>整段润色</span></label><label class="guide-scope-option"><input type="radio" name="guide-scope" value="risk"><span>仅风险片段</span></label></div><div id="guide-result" class="guide-result" aria-live="polite"></div></div><div class="guide-editor-actions-right"><button class="academic-button academic-button-secondary" id="guide-cancel-button" type="button" hidden>取消</button><button class="academic-button academic-button-primary" id="guide-reduce-button" type="button">开始学术润色</button></div></div>`;
  const editorBlock = guideBlock('03', '根据本次检测结果进行学术润色', editorBody, 'guide-block-editor');
  const reportBlock = guideBlock(
    '04',
    'AI 降重报告',
    `<div id="guide-report" class="guide-report is-empty"><p class="guide-report-placeholder">完成「03 学术润色」后，将在此展示 AI 率变化与润色前后对照。</p></div>`,
    'guide-block-report',
    '',
    `<button class="academic-button academic-button-secondary academic-download-button" type="button" id="guide-dl-pdf" hidden>下载 PDF</button>`,
  );
  return `<nav class="breadcrumbs" aria-label="面包屑"><a href="#/">模块总览</a><span>›</span><a href="#/text">AI文本检测</a><span>›</span><a href="#/text/academic">AI论文与学术稿件检测</a><span>›</span><span>AI降重指南</span></nav>
    <section class="feature-workspace" aria-label="AI降重指南工作区域">
      <div class="guide-workspace">
        <header class="guide-heading"><p class="eyebrow">ACADEMIC WRITING GUIDE</p><h1>AI降重指南</h1><p>通过补充真实观点、调整表达结构和完善引用，让论文更自然、更符合学术写作规范。</p></header>
        ${contextSummary}
        ${adviceBlock}
        ${riskBlock}
        ${editorBlock}
        ${reportBlock}
        <section class="guide-note"><h2>建议</h2><p>模型分、高风险字数占比与可读性是不同指标；请结合原文核对，保证内容真实与引用规范。</p><a class="academic-button academic-button-secondary" href="#/text/academic">返回论文检测</a></section>
      </div>
    </section>`;
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
    result.innerHTML = `<p class="guide-result-loading" role="status"><i></i>${escapeHtml(msg)}</p>`;
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
    result.innerHTML = `<p class="guide-result-loading" role="status"><i></i>${
      useEgteAdv ? '正在生成候选并用 EGTE 筛选，请稍候…' : '正在润色中，请稍候…'
    }</p>`;
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
        result.innerHTML = '<p class="guide-result-loading" role="status"><i></i>正在复核润色后 AI 率…</p>';
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
      const beforeHtml = polishRiskOnly
        ? renderGuideBeforeHtml(source, riskItems)
        : escapeHtml(source);
      const afterHtml = (polishRiskOnly || useEgteAdv)
        ? renderGuideAfterHtml(rewritten, replacements, source)
        : escapeHtml(rewritten);
      const replacedN = replacements.length;
      const changedN = replacements.filter(r => r.changed !== false && r.after !== r.before).length;
      const rewriteStats = measureGuideRewrite(source, rewritten, replacements);
      const hint = useEgteAdv
        ? `EGTE 方案接受 ${changedN} 处替换` + (afterScorePct != null ? ` · AI 率 ${beforeScorePct}% → ${afterScorePct}%` : '')
        : (polishRiskOnly
          ? `左侧红色为风险句；右侧绿色为已处理 ${replacedN}/${riskItems.length} 处（其中改写 ${changedN} 处）`
          : '可展开全文后对照阅读');
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
            <header><em>BEFORE</em><h3>润色前</h3></header>
            <div class="guide-prose is-collapsed" data-guide-prose>${beforeHtml}</div>
            <button type="button" class="guide-prose-toggle" data-guide-toggle>展开全文</button>
          </article>
          <article class="guide-col-after">
            <header><em>AFTER</em><h3>润色后</h3></header>
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

function renderApp() {
  const route = resolveRoute(readPath());
  const title = route.scenario?.title || route.module?.title || route.title || 'AI检测平台';
  document.title = `${title} · VERITAS 智鉴`;
  const views = { overview, module: modulePage, scenario: scenarioPage, guide: guidePage };
  const content = views[route.type]?.(route) || '<section class="not-found"><p class="eyebrow">404</p><h1>页面未找到</h1><a class="back-link" href="#/">返回模块总览</a></section>';
  app.innerHTML = `<a class="skip-link" href="#main-content">跳转到主要内容</a><header class="topbar"><a class="brand" href="#/" aria-label="VERITAS 智鉴首页"><span class="brand-mark">${icon('shield')}</span><span>VERITAS</span><span class="brand-divider"></span><span class="brand-cn">智鉴</span></a><span class="top-status"><span></span>功能预览版</span></header>
    <div class="app-layout"><aside class="sidebar"><a href="#/" class="nav-item overview-link ${route.type==='overview'?'active':''}" ${route.type==='overview'?'aria-current="page"':''}>${icon('overview')}<span>模块总览</span></a><p class="nav-label">检测模块</p><nav aria-label="检测模块">${modules.map(module => `<a href="${href(module.path)}" class="nav-item ${route.module?.id===module.id?'active':''}" ${route.module?.id===module.id?'aria-current="page"':''}>${icon(module.id)}<span>${module.title}</span><span class="nav-count">${module.scenarios.length}</span></a>`).join('')}</nav><div class="sidebar-footer"><span class="mini-mark">V</span><div><span>智鉴工作空间</span><small>AI DETECTION PLATFORM</small></div></div></aside><main id="main-content" class="main-content" tabindex="-1">${content}<footer class="workspace-footer"><span>VERITAS 智鉴</span><span>让真实，有据可循。</span></footer></main></div>`;
  if (route.type === 'scenario') {
    const renderer = pageRegistry.get(route.scenario.path);
    if (renderer) renderer(document.querySelector('#scenario-workspace'), route);
  }
  if (route.type === 'guide') setupGuidePage();
}

window.addEventListener('hashchange', () => {
  renderApp();
  window.scrollTo(0, 0);
  document.querySelector('#main-content')?.focus({ preventScroll: true });
});
// 跳转到主要内容是文档锚点，不应触发业务路由。
app.addEventListener('click', event => {
  const link = event.target.closest('.skip-link');
  if (link) { event.preventDefault(); document.querySelector('#main-content')?.focus(); }
});
window.Veritas = { modules, scenarios, registerPage, resolveRoute, api };
renderApp();

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

async function fetchHumanizeReportPdf(payload) {
  const res = await fetch(`${api.baseUrl}/api/v1/reports/humanize?format=pdf&rescore=true`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/pdf' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = await res.text();
    try { detail = JSON.parse(detail).detail || detail; } catch { /* keep */ }
    throw new Error(detail || `HTTP ${res.status}`);
  }
  return res.blob();
}

const strategyName = s => (!s ? '学术润色' : typeof s === 'string' ? s : String(s.name || s.id || '学术润色'));
const briefText = (t, max = 220) => {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : `${s.slice(0, max)}…`;
};
const keyPoints = (text, riskItems) => {
  const risks = (riskItems || []).map(i => String(i.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 3);
  return risks.length ? risks.map((line, i) => `${i + 1}. ${briefText(line, 100)}`).join('\n') : briefText(text, 220);
};
function renderGuideAdvice(items) {
  return (items || []).map((item, index) => {
    const title = item.title || item.risk || '针对性修改';
    const description = item.description || item.strategy || '';
    const suggestion = item.suggestion || item.rewrite || '';
    return `<article class="guide-card"><span class="guide-card-index">${String(index + 1).padStart(2, '0')}</span><div class="guide-card-body"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p>${suggestion ? `<div class="guide-card-suggestion"><strong>修改建议</strong><p>${escapeHtml(suggestion)}</p></div>` : ''}</div></article>`;
  }).join('');
}

async function postJson(path, body) {
  const response = await fetch(`${api.baseUrl}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error?.message || `HTTP ${response.status}`);
  return payload.data || payload;
}

function guidePage() {
  const ctx = reductionContext();
  const riskItems = ctx.sentences.filter(item => Number(item.ai_score || 0) >= 0.42).slice(0, 8);
  const contextSummary = ctx.hasResult
    ? `<div class="guide-context guide-context-metrics">
        <div><strong>模型 AI 风险分 ${ctx.score}%</strong><small>模型综合判断，≠ ${ctx.unit}数占比</small></div>
        <div><strong>高风险${ctx.unit}数 ${ctx.highChars.toLocaleString()} / ${ctx.highShare}%</strong><small>逐句 ≥62% 合计（不计标点）</small></div>
        <div><strong>${riskItems.length} 个待处理片段</strong><small>${escapeHtml(ctx.scope || '来自上次检测')}</small></div>
      </div>`
    : '<div class="guide-context guide-context-empty">尚未读取到检测结果，请先返回论文检测并完成一次检测。</div>';
  const adviceHtml = ctx.hasResult
    ? '<p class="guide-advice-loading" role="status"><i></i>正在分析中…</p>'
    : renderGuideAdvice(ctx.advice.map(item => ({ title: item[0], description: item[1] })));
  return `<nav class="breadcrumbs" aria-label="面包屑"><a href="#/">模块总览</a><span>›</span><a href="#/text">AI文本检测</a><span>›</span><a href="#/text/academic">AI论文与学术稿件检测</a><span>›</span><span>AI降重指南</span></nav>
    <header class="guide-heading"><p class="eyebrow">ACADEMIC WRITING GUIDE</p><h1>AI降重指南</h1><p>通过补充真实观点、调整表达结构和完善引用，让论文更自然、更符合学术写作规范。</p></header>
    ${contextSummary}<section class="guide-grid" id="guide-advice-grid">${adviceHtml}</section>${riskItems.length ? `<section class="guide-risk-list"><h2>本次检测建议优先处理</h2>${riskItems.map(item => `<article><strong>${Math.round(Number(item.ai_score || 0) * 100)}%</strong><p>${escapeHtml(item.text || '')}</p><small>${escapeHtml(item.clues || '模型标记的风险片段')}</small></article>`).join('')}</section>` : ''}
    <section class="guide-editor"><div class="guide-editor-heading"><div><h2>根据本次检测结果进行学术润色</h2><p>可整段改写，或只改风险句；保留原意、事实和引用。</p></div><span class="guide-editor-status" id="guide-editor-status">等待输入</span></div><textarea id="guide-input" placeholder="完成上一页检测后，检测文本会自动带入这里；也可以手动粘贴需要润色的段落。"></textarea><div class="guide-editor-actions"><div class="guide-scope-options" role="radiogroup" aria-label="润色范围"><label class="guide-scope-option"><input type="radio" name="guide-scope" value="full" checked><span>整段润色</span></label><label class="guide-scope-option"><input type="radio" name="guide-scope" value="risk"><span>仅风险片段</span></label></div><button class="academic-button academic-button-primary" id="guide-reduce-button" type="button">开始学术润色</button></div><div id="guide-result" class="guide-result" aria-live="polite"></div></section>
    <section id="guide-report" class="guide-report" hidden></section>
    <section class="guide-note"><h2>建议</h2><p>模型分、高风险字数占比与可读性是不同指标；请结合原文核对，保证内容真实与引用规范。</p><a class="academic-button academic-button-secondary" href="#/text/academic">返回论文检测</a></section>`;
}

function setupGuidePage() {
  const input = document.querySelector('#guide-input');
  const button = document.querySelector('#guide-reduce-button');
  const result = document.querySelector('#guide-result');
  const status = document.querySelector('#guide-editor-status');
  const report = document.querySelector('#guide-report');
  if (!input || !button || !result || !status) return;

  let storedInput = null;
  try {
    storedInput = JSON.parse(sessionStorage.getItem('academicReductionInput') || 'null');
    if (storedInput?.text) { input.value = storedInput.text; status.textContent = '已带入上次检测文本'; }
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
      if (advice.length && grid) grid.innerHTML = renderGuideAdvice(advice);
      else showAdviceError();
    }).catch(() => showAdviceError());
  }

  button.addEventListener('click', async () => {
    const fullText = input.value.trim();
    if (!fullText) { status.textContent = '请先输入需要润色的文本'; return; }
    const riskItems = (storedInput?.result?.sentences || []).filter(item => Number(item.ai_score || 0) >= 0.42);
    const scopeMode = document.querySelector('input[name="guide-scope"]:checked')?.value || 'full';
    const polishRiskOnly = scopeMode === 'risk';
    if (polishRiskOnly && !riskItems.length) {
      status.textContent = '暂无风险片段，请改用整段润色或先完成检测';
      return;
    }
    const source = polishRiskOnly
      ? riskItems.map(item => String(item.text || '').trim()).filter(Boolean).join('\n\n')
      : fullText;
    const beforeBrief = polishRiskOnly
      ? riskItems.slice(0, 3).map((item, i) => `${i + 1}. ${briefText(item.text, 100)}`).join('\n')
      : keyPoints(fullText, riskItems);

    button.disabled = true;
    status.textContent = polishRiskOnly ? '正在润色风险片段…' : '正在润色整段…';
    result.innerHTML = '<p class="guide-result-loading">正在润色中，请稍候…</p>';
    try {
      const data = await postJson('/api/v1/text/humanize', {
        content: source,
        language: detectTextLanguage(source),
        style: 'academic',
        risk_sentences: riskItems,
      });
      const rewritten = data.text || data.rewritten_text || '';
      const ctx = reductionContext();
      const strategy = strategyName(data.strategy || data.strategy_name);
      const windows = data.window_count || data.windows || 1;
      const scope = ctx.scope || '未记录';
      const modeLabel = polishRiskOnly ? '仅风险片段' : '整段润色';
      const reportPayload = {
        before: source,
        after: rewritten,
        before_result: storedInput?.result || null,
        before_ai_score: ctx.hasResult ? ctx.score / 100 : undefined,
        strategy: data.strategy || { name: strategy },
        window_count: windows,
        risk_sentences: riskItems,
        language: detectTextLanguage(source),
        mode: modeLabel,
        scope,
        file_name: ctx.fileName || 'academic',
      };
      saveHumanizeHistory({
        originalText: source,
        humanisedText: rewritten,
        originalScore: ctx.score,
        humanisedScore: 0,
        mode: modeLabel,
        strategy,
      });
      result.innerHTML = '';
      button.textContent = '重新学术润色';
      if (!report) { status.textContent = '润色完成'; return; }
      const scoreTone = ctx.score >= 62 ? 'high' : (ctx.score >= 42 ? 'medium' : 'low');
      report.hidden = false;
      report.className = 'guide-report is-fluid';
      report.innerHTML = `<div class="guide-report-heading"><div><h2>AI 降重报告</h2><p>已按「${escapeHtml(modeLabel)}」完成改写 · 请人工核对事实与引用</p></div><button class="academic-button academic-button-secondary academic-download-button" id="guide-report-download" type="button">下载润色对比</button></div>
        <div class="guide-report-summary">
          <div class="guide-summary-score meta-tone-${scoreTone}"><strong>${ctx.score}%</strong><span>检测风险分</span></div>
          <div class="guide-summary-facts">
            <div><em>高风险${ctx.unit}占比</em><b>${ctx.highShare}%</b></div>
            <div><em>风险句</em><b>${riskItems.length}</b></div>
            <div><em>策略</em><b>${escapeHtml(strategy)}</b></div>
            <div><em>模式</em><b>${escapeHtml(modeLabel)}</b></div>
          </div>
        </div>
        <p class="guide-report-scope">${escapeHtml(scope)}</p>
        <div class="guide-report-toolbar" role="toolbar" aria-label="对照视图">
          <div class="report-seg" role="group">
            <button type="button" class="report-seg-btn is-active" data-guide-view="side">左右对照</button>
            <button type="button" class="report-seg-btn" data-guide-view="stack">上下阅读</button>
          </div>
          <span class="guide-report-hint-inline">可展开全文；完整排版请下载 PDF</span>
        </div>
        <div class="guide-report-columns" data-guide-layout="side">
          <article class="guide-col-before">
            <header><em>BEFORE</em><h3>润色前</h3></header>
            <div class="guide-prose is-collapsed" data-guide-prose>${escapeHtml(source)}</div>
            <button type="button" class="guide-prose-toggle" data-guide-toggle>展开全文</button>
          </article>
          <article class="guide-col-after">
            <header><em>AFTER</em><h3>润色后</h3></header>
            <div class="guide-prose is-collapsed" data-guide-prose>${escapeHtml(rewritten)}</div>
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
      report.querySelector('#guide-report-download')?.addEventListener('click', async () => {
        const dl = report.querySelector('#guide-report-download');
        const prev = dl?.textContent;
        if (dl) { dl.disabled = true; dl.textContent = '生成报告中…'; }
        try {
          const pdf = await fetchHumanizeReportPdf(reportPayload);
          const stem = String(ctx.fileName || 'academic').replace(/\.[^.]+$/, '').trim() || 'academic';
          downloadBlob(`${stem}-AI降重报告.pdf`, pdf, 'application/pdf');
          status.textContent = '报告已下载';
        } catch (error) {
          status.textContent = `下载失败：${error.message}`;
        } finally {
          if (dl) { dl.disabled = false; dl.textContent = prev || '下载润色对比'; }
        }
      });
      status.textContent = '润色完成，完整对照请下载';
    } catch (error) {
      result.innerHTML = `<p class="guide-result-error">润色失败：${escapeHtml(error.message)}</p>`;
      status.textContent = '请求失败';
    } finally {
      button.disabled = false;
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

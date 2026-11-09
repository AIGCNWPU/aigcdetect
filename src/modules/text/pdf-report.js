function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : '';
  } catch { return ''; }
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value, digits = 1) {
  return `${(Math.max(0, Math.min(1, number(value))) * 100).toFixed(digits)}%`;
}

function formatDate(value = new Date()) {
  try { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long', timeStyle: 'short' }).format(value); }
  catch { return new Date(value).toLocaleString('zh-CN'); }
}

const SEVERITY_LABELS = Object.freeze({ error: '高优先级', warning: '中优先级', info: '提示' });
const TYPE_LABELS = Object.freeze({ repetition: '重复叙述', padding: '内容空泛' });

function reportDateKey(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'UNKNOWN';
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const get = type => parts.find(item => item.type === type)?.value || '00';
  return `${get('year')}${get('month')}${get('day')}`;
}

export function textReportIdentity({ scenario = 'news', result, generatedAt = new Date() } = {}) {
  const hash = String(result?.contentHash || '').replace(/[^a-f0-9]/giu, '').toUpperCase();
  const prefix = scenario === 'novel' ? 'NVL' : 'NWS';
  return {
    reportId: `${prefix}-${reportDateKey(generatedAt)}-${hash.slice(0, 10) || 'SESSION'}`,
    fingerprint: hash ? `${hash.slice(0, 12)}…${hash.slice(-8)}` : '当前会话未提供',
  };
}

export function collectNewsReportIssues(proofreading = {}) {
  const source = Array.isArray(proofreading.issues) && proofreading.issues.length
    ? proofreading.issues
    : (Array.isArray(proofreading.stages) ? proofreading.stages : []).flatMap(stage => (stage.issues || []).map(issue => ({ ...issue, stageName: issue.stageName || stage.name })));
  const seen = new Set();
  return source.filter(item => {
    const key = [item.location, item.type, item.originalText, item.message].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function summarizeReportIssues(issues = []) {
  const severity = { error: 0, warning: 0, info: 0 };
  const types = new Map();
  for (const item of Array.isArray(issues) ? issues : []) {
    const level = Object.hasOwn(severity, item?.severity) ? item.severity : 'warning';
    severity[level] += 1;
    const key = String(item?.type || '其他问题');
    types.set(key, (types.get(key) || 0) + 1);
  }
  return {
    total: Object.values(severity).reduce((sum, value) => sum + value, 0),
    severity,
    types: [...types.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN')),
  };
}

export function summarizeUnscoredReasons(aiRisk = {}) {
  const reasons = new Map();
  for (const item of Array.isArray(aiRisk.findings) ? aiRisk.findings : []) {
    if (item?.status === 'success') continue;
    const reason = String(item?.reason || '未提供原因');
    reasons.set(reason, (reasons.get(reason) || 0) + 1);
  }
  return [...reasons.entries()].sort((left, right) => right[1] - left[1]);
}

function metadataBlock({ scenario, result, generatedAt, scope }) {
  const identity = textReportIdentity({ scenario, result, generatedAt });
  const coverage = result?.coverage || {};
  const coverageText = scenario === 'novel'
    ? `${number(coverage.chapters)}章 · ${number(coverage.paragraphs)}段 · ${number(coverage.windows)}窗口`
    : `${number(coverage.paragraphs)}段 · ${number(coverage.windows)}窗口`;
  return `<section class="section card report-meta"><div><span>报告编号</span><strong>${escapeHtml(identity.reportId)}</strong></div><div><span>内容指纹</span><strong>${escapeHtml(identity.fingerprint)}</strong></div><div><span>检测时间</span><strong>${escapeHtml(formatDate(generatedAt))}</strong></div><div><span>检测范围</span><strong>${escapeHtml(scope || coverageText)}</strong></div></section>`;
}

function positionDistribution(aiRisk = {}) {
  const items = Array.isArray(aiRisk.paragraphScores) ? aiRisk.paragraphScores : [];
  if (!items.length) return '';
  const counts = items.reduce((value, item) => {
    const label = ['human', 'suspected-ai', 'ai'].includes(item.label) ? item.label : 'unscored';
    value[label] += 1;
    return value;
  }, { human: 0, 'suspected-ai': 0, ai: 0, unscored: 0 });
  return `<section class="section"><div class="section-title"><h2>全文位置分布</h2><span>每格代表一个已聚合段落，按原文顺序排列</span></div><div class="card"><div class="position-strip">${items.map(item => `<i class="${escapeHtml(item.label || 'unscored')}" title="${escapeHtml([item.chapter, `第${item.paragraphIndex}段`, item.labelZh].filter(Boolean).join(' · '))}"></i>`).join('')}</div><p class="meta">人工 ${counts.human} 段 · 疑似AI ${counts['suspected-ai']} 段 · AI ${counts.ai} 段 · 无法评分 ${counts.unscored} 段</p></div></section>`;
}

function pageShell({ documentTitle, eyebrow, title, subtitle, body, generatedAt, footer }) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(documentTitle)}</title><style>
  :root{color-scheme:light;--blue:#0875e8;--ink:#172033;--muted:#6f7d90;--line:#dfe7f1;--paper:#fff;--soft:#f5f8fc;--human:#42b883;--suspected:#f2b63f;--ai:#e45f61;--unscored:#aab3c0}*{box-sizing:border-box}html{background:#eaf0f7}body{margin:0;color:var(--ink);background:#eaf0f7;font-family:"Microsoft YaHei","Noto Sans CJK SC","PingFang SC",Arial,sans-serif;font-size:11px;line-height:1.65;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar{position:sticky;top:0;z-index:3;display:flex;align-items:center;justify-content:space-between;padding:10px 18px;background:#172033;color:#fff}.toolbar button{padding:8px 14px;border:0;border-radius:8px;background:var(--blue);color:#fff;font:inherit;font-weight:700;cursor:pointer}.sheet{width:210mm;min-height:297mm;margin:18px auto;padding:15mm 15mm 17mm;background:var(--paper);box-shadow:0 12px 40px #14233c26}.mast{display:flex;align-items:flex-start;justify-content:space-between;gap:22px;padding-bottom:13px;border-bottom:2px solid #dce9f8}.brand{color:var(--blue);font-size:10px;font-weight:800;letter-spacing:.16em}.eyebrow{margin:13px 0 3px;color:var(--blue);font-size:10px;font-weight:700}.mast h1{max-width:132mm;margin:0;font-size:24px;line-height:1.25}.subtitle{margin-top:7px;color:var(--muted);font-size:10px}.status{flex:none;padding:6px 11px;border-radius:16px;background:#e6f7ee;color:#197c58;font-weight:700}.section{margin-top:17px}.section-title{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:9px;break-after:avoid;page-break-after:avoid}.section-title h2{margin:0;font-size:15px}.section-title span{color:var(--muted);font-size:9px}.card{padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:#fff;break-inside:avoid;page-break-inside:avoid}.soft{background:var(--soft)}.grid{display:grid;gap:10px}.metrics{grid-template-columns:repeat(4,1fr)}.metric span,.report-meta span{display:block;color:var(--muted);font-size:9px}.metric strong{display:block;margin-top:4px;font-size:17px;line-height:1.25}.metric small{color:var(--muted)}.report-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:8px 18px;background:var(--soft)}.report-meta strong{display:block;margin-top:2px;font-size:9.5px;overflow-wrap:anywhere}.visuals{grid-template-columns:44mm 1fr;align-items:center}.rings{display:flex;align-items:center;justify-content:center}.ring{position:relative;display:grid;place-items:center;width:37mm;height:37mm;flex:none;border-radius:50%;background:var(--ring)}.ring:after{position:absolute;inset:7mm;border-radius:50%;background:#fff;content:""}.ring-center{position:relative;z-index:1;text-align:center}.ring-center strong{display:block;font-size:14px}.ring-center span{color:var(--muted);font-size:8px}.legend{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.legend-item{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:7px;padding:8px;border-radius:9px;background:var(--soft)}.dot{width:8px;height:8px;border-radius:50%}.legend-item small{color:var(--muted)}.composition-wrap{grid-column:1/-1;margin-top:4px}.composition-label{display:flex;justify-content:space-between;gap:10px;margin-bottom:6px;color:var(--muted);font-size:9px}.composition-bar,.position-strip{display:flex;width:100%;height:13px;overflow:hidden;border-radius:8px;background:#e8edf3}.composition-bar i{display:block;height:100%}.position-strip i{display:block;min-width:2px;flex:1;height:100%;border-right:1px solid #fff}.composition-bar .human,.position-strip .human{background:var(--human)}.composition-bar .suspected,.position-strip .suspected-ai{background:var(--suspected)}.composition-bar .ai,.position-strip .ai{background:var(--ai)}.composition-bar .unscored,.position-strip .unscored{background:var(--unscored)}.notice{margin-top:10px;padding:9px 11px;border-left:3px solid #8ebff3;border-radius:5px;background:#f1f7fe;color:#56677d}.focus-list,.issue-list{display:grid;gap:8px}.focus-item,.issue{padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;break-inside:avoid;page-break-inside:avoid}.focus-head,.issue-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.focus-head strong,.issue-head strong{font-size:11px}.pill{flex:none;padding:3px 7px;border-radius:12px;font-size:8px;font-weight:700}.pill.ai{background:#fde9e9;color:#a63f41}.pill.suspected{background:#fff1d5;color:#95640c}.pill.unscored{background:#eceff3;color:#687483}.quote{margin:7px 0 0;padding:7px 9px;border-left:3px solid #b9d8fa;border-radius:5px;background:var(--soft);white-space:pre-wrap;overflow-wrap:anywhere}.meta{margin-top:5px;color:var(--muted);font-size:9px}.stage-grid{grid-template-columns:repeat(3,1fr)}.stage{position:relative;padding-top:15px}.stage-index{position:absolute;top:9px;right:10px;color:#d5e3f4;font-size:24px;font-weight:800}.stage h3{margin:0;font-size:12px}.stage p{margin:5px 0 0;color:var(--muted);font-size:9px}.check-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:7px}.check-tags span{padding:2px 5px;border-radius:5px;background:#edf2f7;color:#667386;font-size:8px}.stage-findings{margin-top:8px;font-weight:700}.issue p{margin:5px 0 0}.issue .suggestion{color:#53657b}.policies{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.policy a{color:var(--blue);text-decoration:none;font-weight:700}.empty{padding:20px;text-align:center;color:var(--muted)}.footer{margin-top:18px;padding-top:9px;border-top:1px solid var(--line);color:var(--muted);font-size:8px}.only-print{display:none}@page{size:A4;margin:0}@media print{html,body{background:#fff}.toolbar{display:none}.sheet{width:auto;min-height:0;margin:0;padding:13mm 14mm 15mm;box-shadow:none}.only-print{display:block}.card,.focus-item,.issue{break-inside:avoid;page-break-inside:avoid}.section{break-inside:auto}}
  </style></head><body><div class="toolbar"><span>报告预览 - 请在打印窗口中选择“另存为 PDF”</span><button type="button" onclick="window.print()">打印 / 保存 PDF</button></div><main class="sheet"><header class="mast"><div><div class="brand">VERITAS 智鉴</div><p class="eyebrow">${escapeHtml(eyebrow)}</p><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(subtitle)}</p></div><span class="status">已完成</span></header>${body}<footer class="footer">${escapeHtml(footer || '本报告仅汇总实际返回的检测结果，所有线索均需结合原文人工复核。')}</footer></main></body></html>`;
}

function policyCards(values) {
  const items = (Array.isArray(values) ? values : []).map(item => ({ ...item, safe: safeUrl(item?.url) })).filter(item => item.safe && item.platformName);
  if (!items.length) return '';
  return `<section class="section"><div class="section-title"><h2>对应平台创作者规则</h2><span>请以平台最新页面为准</span></div><div class="policies">${items.map(item => `<article class="card policy"><strong>${escapeHtml(item.platformName)}</strong><p>${escapeHtml(item.summary || '')}</p><a href="${escapeHtml(item.safe)}">${escapeHtml(item.title || '查看官方规则')}</a></article>`).join('')}</div></section>`;
}

function aiFocusItems(aiRisk) {
  const fragments = (Array.isArray(aiRisk?.fragments) ? aiRisk.fragments : []).map(item => ({
    location: [item.chapter, item.paragraphStart === item.paragraphEnd ? `第${item.paragraphStart}段` : `第${item.paragraphStart}-${item.paragraphEnd}段`].filter(Boolean).join(' · '),
    label: item.label,
    labelZh: item.labelZh,
    score: item.score,
    text: item.text,
    reason: '',
    start: item.start,
  }));
  const unscored = (Array.isArray(aiRisk?.findings) ? aiRisk.findings : []).filter(item => item.status !== 'success').map(item => ({
    location: [item.chapter, `第${(item.sentenceIndexes || [item.sentenceIndex]).join('-')}句`].filter(Boolean).join(' · '),
    label: 'unscored', labelZh: '无法评分', score: null, text: item.text, reason: item.reason, start: item.start,
  }));
  const priority = { ai: 0, 'suspected-ai': 1, unscored: 2 };
  return [...fragments, ...unscored].sort((left, right) => (priority[left.label] ?? 9) - (priority[right.label] ?? 9) || number(right.score) - number(left.score) || number(left.start) - number(right.start));
}

export function selectAiReportItems(aiRisk, limit = Number.POSITIVE_INFINITY) {
  const items = aiFocusItems(aiRisk);
  const maximum = Number.isFinite(limit) ? Math.max(0, limit) : items.length;
  return { items: items.slice(0, maximum), omitted: Math.max(0, items.length - maximum), total: items.length };
}

export function buildAiPdfReport({ scenario = 'news', title, version, result, scope = '', generatedAt = new Date() }) {
  const risk = result?.aiRisk || {};
  const distribution = risk.distribution || {};
  const characters = distribution.characters || {};
  const total = Math.max(1, number(distribution.totalCharacters));
  const human = number(characters.human) / total;
  const suspected = number(characters.suspectedAi) / total;
  const ai = number(characters.ai) / total;
  const unscored = Math.max(0, 1 - human - suspected - ai);
  const score = Number.isFinite(Number(risk.documentScore?.score)) ? Number(risk.documentScore.score) : 0;
  const focus = selectAiReportItems(risk);
  const modelVersions = risk.documentScore?.modelVersions || [];
  const thresholds = risk.documentScore?.thresholds;
  const aiRelated = (number(characters.suspectedAi) + number(characters.ai)) / total;
  const scoredRatio = number(distribution.scoredCharacters) / total;
  const unscoredReasons = summarizeUnscoredReasons(risk);
  const body = `${metadataBlock({ scenario, result, generatedAt, scope })}<section class="section grid metrics"><article class="card metric"><span>模型加权得分</span><strong>${percent(score, 2)}</strong><small>未校准，非概率</small></article><article class="card metric"><span>AI相关字符占比</span><strong>${percent(aiRelated)}</strong><small>AI与疑似AI标签字符</small></article><article class="card metric"><span>可评分覆盖率</span><strong>${percent(scoredRatio)}</strong><small>${number(distribution.scoredCharacters).toLocaleString()} / ${number(distribution.totalCharacters).toLocaleString()} 字</small></article><article class="card metric"><span>关注片段</span><strong>${focus.total}</strong><small>AI、疑似AI或无法评分</small></article></section>
  <section class="section card soft grid visuals"><div class="rings"><div class="ring" style="--ring:conic-gradient(var(--blue) 0 ${percent(score)},#dfe7f1 ${percent(score)} 100%)"><div class="ring-center"><strong>${percent(score, 2)}</strong><span>全文加权得分</span></div></div></div><div class="legend"><div class="legend-item"><i class="dot" style="background:var(--human)"></i><span>人工</span><strong>${number(characters.human).toLocaleString()}字</strong></div><div class="legend-item"><i class="dot" style="background:var(--suspected)"></i><span>疑似AI</span><strong>${number(characters.suspectedAi).toLocaleString()}字</strong></div><div class="legend-item"><i class="dot" style="background:var(--ai)"></i><span>AI</span><strong>${number(characters.ai).toLocaleString()}字</strong></div><div class="legend-item"><i class="dot" style="background:var(--unscored)"></i><span>无法评分</span><strong>${number(characters.unscored).toLocaleString()}字</strong></div></div><div class="composition-wrap"><div class="composition-label"><strong>全文整体构成</strong><span>人工 ${percent(human)} · 疑似AI ${percent(suspected)} · AI ${percent(ai)} · 无法评分 ${percent(unscored)}</span></div><div class="composition-bar" role="img" aria-label="全文整体构成：人工${percent(human)}，疑似AI${percent(suspected)}，AI${percent(ai)}，无法评分${percent(unscored)}"><i class="human" style="width:${percent(human)}"></i><i class="suspected" style="width:${percent(suspected)}"></i><i class="ai" style="width:${percent(ai)}"></i><i class="unscored" style="width:${percent(unscored)}"></i></div></div></section>
  ${result?.coverage?.notice ? `<p class="notice">覆盖说明：${escapeHtml(result.coverage.notice)}</p>` : ''}
  ${unscoredReasons.length ? `<section class="section card soft"><strong>无法评分原因</strong><p class="meta">${unscoredReasons.map(([reason, count]) => `${escapeHtml(reason)}：${count} 个片段`).join(' · ')}</p></section>` : ''}
  <section class="section"><div class="section-title"><h2>需关注的原文片段</h2><span>全部展开AI、疑似AI及无法评分片段；普通人工片段不逐条展开</span></div><div class="focus-list">${focus.items.length ? focus.items.map(item => `<article class="focus-item"><div class="focus-head"><strong>${escapeHtml(item.location || '原文片段')}</strong><span class="pill ${item.label === 'suspected-ai' ? 'suspected' : item.label === 'ai' ? 'ai' : 'unscored'}">${escapeHtml(item.labelZh || '需关注')}${item.score != null && Number.isFinite(Number(item.score)) ? ` · ${percent(item.score, 2)}` : ''}</span></div>${item.reason ? `<p class="meta">${escapeHtml(item.reason)}</p>` : ''}<blockquote class="quote">${escapeHtml(item.text || '')}</blockquote></article>`).join('') : '<div class="card empty">本次没有AI、疑似AI或无法评分片段。</div>'}</div></section>
  ${positionDistribution(risk)}
  <section class="section card soft"><strong>模型、阈值与解读</strong><p class="meta">模型：${escapeHtml(modelVersions.join('、') || risk.findings?.[0]?.modelVersion || '未提供')} · 人工 &lt; ${thresholds ? percent(thresholds.humanMax, 0) : '50%'} · 疑似AI ${thresholds ? percent(thresholds.humanMax, 0) : '50%'}-${thresholds ? percent(thresholds.aiMin, 0) : '80%'} · AI ≥ ${thresholds ? percent(thresholds.aiMin, 0) : '80%'}</p><p class="meta">“模型加权得分”是未校准分类分数；“AI相关字符占比”是被标为AI或疑似AI的字符占检测字符的比例，二者均不能单独证明文本来源。${escapeHtml(risk.notice || '')}</p></section>
  ${policyCards(risk.platformPolicies)}`;
  const suffix = version ? ` · v${version}` : '';
  return pageShell({ documentTitle: `${title}-AI内容分析报告`, eyebrow: scenario === 'novel' ? '小说内容检测' : '新闻稿检测', title: `${title}${suffix}`, subtitle: `AI内容分析报告${scope ? ` · ${scope}` : ''}`, body, generatedAt, footer: '本报告仅汇总实际返回的检测结果；模型得分未经校准，AI相关字符占比也不等同于确定概率，结论需结合原文人工复核。' });
}

function issueCards(issues) {
  if (!issues.length) return '<div class="card empty">本阶段未发现有明确原文证据的问题。</div>';
  return `<div class="issue-list">${issues.map(item => {
    const references = Array.isArray(item.references) ? item.references : item.originalText ? [{ quote: item.originalText }] : [];
    const stageNames = (item.stages || []).map(stage => stage.name).filter(Boolean).join('、') || item.stageName || '';
    return `<article class="issue"><div class="issue-head"><strong>${escapeHtml([item.chapter, item.location, TYPE_LABELS[item.type] || item.type].filter(Boolean).join(' · ') || '审校问题')}</strong><span class="pill suspected">${escapeHtml(SEVERITY_LABELS[item.severity] || SEVERITY_LABELS.warning)}</span></div>${stageNames ? `<p class="meta">发现阶段：${escapeHtml(stageNames)}</p>` : ''}<p>${escapeHtml(item.message || item.summary || '')}</p>${item.suggestion ? `<p class="suggestion">建议：${escapeHtml(item.suggestion)}</p>` : ''}${references.slice(0, 3).map((reference, index) => `<div class="meta">${escapeHtml([`证据${index + 1}`, reference.chapter, reference.paragraphIndex ? `第${reference.paragraphIndex}段` : ''].filter(Boolean).join(' · '))}</div><blockquote class="quote">${escapeHtml(reference.quote || '')}</blockquote>`).join('')}</article>`;
  }).join('')}</div>`;
}

function issueSummaryBlock(issues, title = '问题分类与优先级') {
  const summary = summarizeReportIssues(issues);
  const types = summary.types.slice(0, 8).map(([type, count]) => `${TYPE_LABELS[type] || type} ${count}条`).join(' · ') || '无问题线索';
  return `<section class="section"><div class="section-title"><h2>${escapeHtml(title)}</h2><span>按去重后的问题统计</span></div><section class="grid metrics"><article class="card metric"><span>问题总数</span><strong>${summary.total}</strong><small>具有原文证据</small></article><article class="card metric"><span>高优先级</span><strong>${summary.severity.error}</strong><small>建议发布前处理</small></article><article class="card metric"><span>中优先级</span><strong>${summary.severity.warning}</strong><small>建议人工复核</small></article><article class="card metric"><span>提示</span><strong>${summary.severity.info}</strong><small>可结合语境处理</small></article></section><p class="notice">类型分布：${escapeHtml(types)}</p></section>`;
}

function newsReviewBody(result) {
  const proofreading = result?.proofreading || {};
  const stages = Array.isArray(proofreading.stages) ? proofreading.stages : [];
  const issues = collectNewsReportIssues(proofreading);
  return `${issueSummaryBlock(issues, '问题分类与处理优先级')}<section class="section card soft"><strong>${escapeHtml(proofreading.summary || '本次未执行三审三校')}</strong>${result?.coverage?.notice ? `<p class="meta">覆盖说明：${escapeHtml(result.coverage.notice)}</p>` : ''}</section><section class="section"><div class="section-title"><h2>六阶段执行概览</h2><span>每一审、每一校独立展示</span></div><div class="grid stage-grid">${stages.map((stage, index) => `<article class="card stage"><span class="stage-index">${String(index + 1).padStart(2, '0')}</span><h3>${escapeHtml(stage.name || `阶段${index + 1}`)}</h3><p>${escapeHtml(stage.objective || '')}</p><div class="check-tags">${(stage.checks || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div><div class="stage-findings">${number(stage.findingCount)} 条发现</div></article>`).join('')}</div></section>${stages.map((stage, index) => `<section class="section"><div class="section-title"><h2>${escapeHtml(stage.name || `阶段${index + 1}`)} · 做了什么与发现了什么</h2><span>${escapeHtml(stage.summary || '')}</span></div><div class="card soft"><strong>检查目标</strong><p>${escapeHtml(stage.objective || '')}</p><div class="check-tags">${(stage.checks || []).map(item => `<span>${escapeHtml(item)}</span>`).join('')}</div></div><div style="height:8px"></div>${issueCards(Array.isArray(stage.issues) ? stage.issues : [])}</section>`).join('')}`;
}

function novelQualityBody(result) {
  const quality = result?.quality || {};
  const findings = Array.isArray(quality.findings) ? quality.findings : [];
  const counts = findings.reduce((value, item) => { value[item.type === 'repetition' ? 'repetition' : 'padding'] += 1; return value; }, { repetition: 0, padding: 0 });
  const crossChapter = findings.filter(item => new Set((item.references || []).map(reference => reference.chapterId || reference.chapter).filter(Boolean)).size > 1).length;
  return `<section class="section grid metrics"><article class="card metric"><span>重复叙述</span><strong>${counts.repetition}</strong><small>含完全重复与模型线索</small></article><article class="card metric"><span>内容空泛</span><strong>${counts.padding}</strong><small>疑似水稿线索</small></article><article class="card metric"><span>跨章对照</span><strong>${crossChapter}</strong><small>${escapeHtml(result?.coverage?.crossChapter === 'same-request' ? '已比较同次送检章节' : '本次未执行跨章比较')}</small></article><article class="card metric"><span>覆盖范围</span><strong>${number(result?.coverage?.chapters)}章</strong><small>${number(result?.coverage?.paragraphs)} 段 · ${number(result?.coverage?.windows)} 窗口</small></article></section>${issueSummaryBlock(findings, '线索分类与处理优先级')}${result?.coverage?.notice ? `<p class="notice">覆盖说明：${escapeHtml(result.coverage.notice)}</p>` : ''}<section class="section"><div class="section-title"><h2>重复与水稿线索</h2><span>${escapeHtml(quality.summary || '')}</span></div>${issueCards(findings)}</section>${policyCards(quality.platformPolicies)}`;
}

export function buildSecondaryPdfReport({ scenario = 'news', title, version, result, scope = '', generatedAt = new Date() }) {
  const isNovel = scenario === 'novel';
  const reportName = isNovel ? '重复与水稿检测报告' : '三审三校报告';
  const suffix = version ? ` · v${version}` : '';
  const body = `${metadataBlock({ scenario, result, generatedAt, scope })}${isNovel ? novelQualityBody(result) : newsReviewBody(result)}`;
  return pageShell({ documentTitle: `${title}-${reportName}`, eyebrow: isNovel ? '小说内容检测' : '新闻稿检测', title: `${title}${suffix}`, subtitle: `${reportName}${scope ? ` · ${scope}` : ''}`, body, generatedAt, footer: '本报告中的问题与修改建议均为辅助审校线索，已附可回查原文；是否采纳须由编辑结合上下文人工判断。' });
}

export function openPdfPrintPreview(html) {
  const preview = globalThis.open?.('', '_blank');
  if (!preview) return false;
  try { preview.opener = null; } catch {}
  preview.document.open();
  preview.document.write(html);
  preview.document.close();
  const print = () => globalThis.setTimeout(() => { try { preview.focus(); preview.print(); } catch {} }, 250);
  if (preview.document.readyState === 'complete') print();
  else preview.addEventListener('load', print, { once: true });
  return true;
}

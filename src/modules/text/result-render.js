function textElement(tag, className, value) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  node.textContent = value;
  return node;
}

export function formatAiClassScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return '';
  return `${(Math.max(0, Math.min(1, score)) * 100).toFixed(2)}%`;
}

function percentage(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `${(Math.max(0, Math.min(1, number)) * 100).toFixed(1)}%` : '0.0%';
}

export function resultCompletionDetails(value) {
  if (value?.status === 'partial') {
    const items = Array.isArray(value.incompleteServices) ? value.incompleteServices : [];
    if (items.length) return `未完成：${items.map(item => `${item?.label || item?.id || '未知服务'}（${item?.reason || '未返回完成结果'}）`).join('；')}`;
    return '部分检测服务未完成，但服务端没有返回具体缺项。';
  }
  return value?.coverage?.notice ? `检测已完成。覆盖说明：${value.coverage.notice}` : '';
}

export function renderResultCompletion(node, value) {
  const details = resultCompletionDetails(value);
  node.textContent = details;
  node.hidden = !details;
  node.className = `text-result-completion ${value?.status === 'partial' ? 'is-warning' : 'is-info'}`;
}

export function setupResultServiceTabs(container) {
  const tabs = container.querySelector('[data-result-service-tabs]');
  const buttons = [...container.querySelectorAll('[data-result-service-tab]')];
  const panels = [...container.querySelectorAll('[data-result-service-panel]')];
  let enabled = [], active = '';
  const select = value => {
    if (!enabled.includes(value)) return;
    active = value;
    for (const button of buttons) {
      const selected = button.dataset.resultServiceTab === active;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of panels) panel.hidden = panel.dataset.resultServicePanel !== active;
  };
  tabs.addEventListener('click', event => {
    const button = event.target.closest('[data-result-service-tab]');
    if (button && tabs.contains(button)) select(button.dataset.resultServiceTab);
  });
  tabs.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight'].includes(event.key) || enabled.length < 2) return;
    event.preventDefault();
    const offset = event.key === 'ArrowRight' ? 1 : -1;
    const next = enabled[(enabled.indexOf(active) + offset + enabled.length) % enabled.length];
    select(next);
    buttons.find(button => button.dataset.resultServiceTab === next)?.focus();
  });
  return {
    show(values) {
      enabled = [...new Set((Array.isArray(values) ? values : []).filter(Boolean))];
      tabs.hidden = enabled.length < 2;
      for (const button of buttons) button.hidden = !enabled.includes(button.dataset.resultServiceTab);
      select(enabled.includes(active) ? active : enabled[0]);
    },
  };
}

export function renderAiOverview(node, value) {
  node.replaceChildren();
  const distribution = value?.distribution;
  const documentScore = value?.documentScore;
  if (!distribution || !documentScore || !Number.isFinite(Number(documentScore.score))) {
    node.hidden = true;
    return;
  }
  node.hidden = false;
  const metrics = document.createElement('div');
  metrics.className = 'ai-overview-metrics';
  const metricValues = [
    ['全文加权得分', formatAiClassScore(documentScore.score)],
    ['内容构成', distribution.composition || '待判断'],
    ['有效覆盖', `${Number(distribution.scoredCharacters || 0).toLocaleString()} / ${Number(distribution.totalCharacters || 0).toLocaleString()} 字`],
  ];
  for (const [label, result] of metricValues) {
    const item = document.createElement('div');
    item.append(textElement('span', '', label), textElement('strong', '', result));
    metrics.append(item);
  }

  const figure = document.createElement('figure');
  figure.className = 'ai-distribution-chart';
  figure.append(textElement('figcaption', '', '全文内容字数分布'));
  const bar = document.createElement('div');
  bar.className = 'ai-distribution-bar';
  const groups = [
    ['human', '人工', distribution.characters?.human, distribution.ratios?.human],
    ['suspected', '疑似AI', distribution.characters?.suspectedAi, distribution.ratios?.suspectedAi],
    ['ai', 'AI', distribution.characters?.ai, distribution.ratios?.ai],
  ];
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', groups.map(([, label, count, ratio]) => `${label}${Number(count || 0).toLocaleString()}字，占${percentage(ratio)}`).join('；'));
  for (const [kind, label, count, ratio] of groups) {
    const segment = document.createElement('span');
    segment.className = `is-${kind}`;
    segment.style.width = percentage(ratio);
    segment.title = `${label} ${Number(count || 0).toLocaleString()} 字（${percentage(ratio)}）`;
    bar.append(segment);
  }
  const legend = document.createElement('div');
  legend.className = 'ai-distribution-legend';
  for (const [kind, label, count, ratio] of groups) {
    const item = document.createElement('div');
    const name = textElement('span', `is-${kind}`, label);
    item.append(name, textElement('strong', '', `${Number(count || 0).toLocaleString()} 字`), textElement('small', '', percentage(ratio)));
    legend.append(item);
  }
  figure.append(bar, legend);
  node.append(metrics, figure);

  const paragraphs = Array.isArray(value.paragraphScores) ? value.paragraphScores : [];
  if (paragraphs.length) {
    const chart = document.createElement('section');
    chart.className = 'ai-paragraph-chart';
    chart.append(textElement('h4', '', '段落加权得分'));
    const list = document.createElement('div');
    list.className = 'ai-paragraph-bars';
    for (const paragraph of paragraphs) {
      const row = document.createElement('div');
      const label = [paragraph.chapter, `第${paragraph.paragraphIndex}段`].filter(Boolean).join(' · ');
      const track = document.createElement('span');
      const fill = document.createElement('i');
      fill.className = `is-${paragraph.label === 'suspected-ai' ? 'suspected' : paragraph.label || 'unscored'}`;
      fill.style.width = percentage(paragraph.score);
      track.append(fill);
      row.append(textElement('span', '', label), track, textElement('strong', '', formatAiClassScore(paragraph.score)));
      list.append(row);
    }
    chart.append(list);
    node.append(chart);
  }
}

export function renderNovelPlatformPolicies(node, values) {
  const items = (Array.isArray(values) ? values : []).filter(item => {
    try { return new URL(item?.url).protocol === 'https:' && item?.platformName && item?.title; } catch { return false; }
  });
  node.replaceChildren();
  node.hidden = !items.length;
  if (!items.length) return;
  const head = document.createElement('div');
  head.append(textElement('strong', '', '对应平台创作者规则'), textElement('span', '', '请以打开后的平台最新页面为准'));
  const list = document.createElement('ul');
  for (const item of items) {
    const li = document.createElement('li');
    const body = document.createElement('div');
    body.append(
      textElement('strong', '', item.platformName),
      textElement('p', '', item.summary || '查看该平台官方创作者规则。'),
      item.aiSpecific ? textElement('span', 'is-ai-specific', '涉及AI内容治理') : textElement('span', '', '创作者规则'),
    );
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `查看${item.title}`;
    li.append(body, link);
    list.append(li);
  }
  node.append(head, list);
}

export function filterAiSentenceFindings(values, filter = 'all') {
  const items = Array.isArray(values) ? values : [];
  if (filter !== 'suspected') return items;
  return items.filter(value => value?.status === 'success' && (value.isAiGenerated === true || value.predictedLabel === 1));
}

export function renderAiSentenceFindings(node, values, emptyMessage = '') {
  const items = Array.isArray(values) ? values : [];
  node.className = 'ai-sentence-list';
  if (!items.length && emptyMessage) {
    node.replaceChildren(textElement('li', 'ai-sentence-empty', emptyMessage));
    return;
  }
  node.replaceChildren(...items.map(value => {
    const li = document.createElement('li');
    li.className = 'ai-sentence-item';
    const head = document.createElement('div');
    const sentenceIndexes = Array.isArray(value.sentenceIndexes) && value.sentenceIndexes.length ? value.sentenceIndexes : [value.sentenceIndex];
    const sentenceLocation = sentenceIndexes.length > 1 ? `第${sentenceIndexes[0]}–${sentenceIndexes.at(-1)}句（合并评分）` : `第${sentenceIndexes[0] || '?'}句`;
    const location = [value.chapter, sentenceLocation].filter(Boolean).join(' · ');
    const labelKind = value.status !== 'success' ? 'unscored' : value.label === 'suspected-ai' ? 'suspected' : value.label === 'ai' ? 'ai' : 'human';
    head.append(textElement('strong', '', location), textElement('span', `ai-label is-${labelKind}`, value.labelZh || '无法评分'));
    const meta = value.status === 'success'
      ? `AI类得分：${formatAiClassScore(value.aiScore)}（未校准，非概率）${Number.isInteger(value.documentTokens) ? ` · ${value.documentTokens} tokens` : ''}`
      : value.reason || '该句无法评分。';
    li.append(head, textElement('p', 'ai-sentence-meta', meta), textElement('blockquote', 'issue-original-text', value.text || ''));
    return li;
  }));
}

export function setupAiSentenceFilter(container) {
  const controls = container.querySelector('[data-ai-filter]');
  const list = container.querySelector('[data-ai-findings]');
  const count = container.querySelector('[data-ai-filter-count]');
  let values = [];
  let filter = 'all';

  const update = () => {
    const visible = filterAiSentenceFindings(values, filter);
    renderAiSentenceFindings(list, visible, filter === 'suspected' ? '当前没有判定为疑似AI的句子。' : '暂无句级检测结果。');
    count.textContent = `显示 ${visible.length} / ${values.length} 个片段`;
    for (const button of controls.querySelectorAll('[data-ai-filter-value]')) {
      button.setAttribute('aria-pressed', String(button.dataset.aiFilterValue === filter));
    }
    list.scrollTop = 0;
  };

  controls.addEventListener('click', event => {
    const button = event.target.closest('[data-ai-filter-value]');
    if (!button || !controls.contains(button)) return;
    filter = button.dataset.aiFilterValue === 'suspected' ? 'suspected' : 'all';
    update();
  });
  update();
  return { render(nextValues) { values = Array.isArray(nextValues) ? nextValues : []; update(); } };
}

export function renderIssueFindings(node, values, emptyMessage = '') {
  const items = Array.isArray(values) ? values : [];
  node.className = 'issue-finding-list';
  if (!items.length && emptyMessage) {
    node.replaceChildren(textElement('li', 'issue-finding-empty', emptyMessage));
    return;
  }
  node.replaceChildren(...items.map(value => {
    const li = document.createElement('li');
    const title = [value.chapter, value.location, value.type, value.message || value.summary].filter(Boolean).join(' · ');
    li.append(textElement('p', 'issue-finding-title', title));
    if (value.suggestion) li.append(textElement('p', 'issue-suggestion', `建议：${value.suggestion}`));
    const quotes = Array.isArray(value.references)
      ? value.references.map(reference => ({ label: [reference.chapter, `第${reference.paragraphIndex}段`].filter(Boolean).join(' · '), text: reference.quote })).filter(item => item.text)
      : value.originalText ? [{ label: '问题原文', text: value.originalText }] : [];
    for (const quote of quotes) {
      const wrapper = document.createElement('div');
      wrapper.className = 'issue-original';
      wrapper.append(textElement('span', '', quote.label || '问题原文'), textElement('blockquote', 'issue-original-text', quote.text));
      li.append(wrapper);
    }
    return li;
  }));
}

export function renderProofreadingStages(node, value) {
  const stages = Array.isArray(value?.stages) ? value.stages : [];
  node.className = 'proofreading-stages';
  if (!stages.length) {
    const fallback = document.createElement('ul');
    renderIssueFindings(fallback, value?.issues, '本次没有可展示的三审三校阶段结果。');
    node.replaceChildren(fallback);
    return;
  }
  node.replaceChildren(...stages.map((stage, index) => {
    const section = document.createElement('section');
    section.className = `proofreading-stage is-${stage.category === 'review' ? 'review' : 'proof'}`;
    const head = document.createElement('header');
    const identity = document.createElement('div');
    identity.append(
      textElement('span', 'proofreading-stage-order', String(index + 1).padStart(2, '0')),
      textElement('strong', '', stage.name || `第${index + 1}阶段`),
      textElement('small', '', stage.category === 'review' ? '审核' : '校对'),
    );
    const status = textElement('span', `proofreading-stage-status is-${stage.status || 'completed'}`, stage.status === 'failed' ? '未完成' : `发现 ${Number(stage.findingCount || 0)} 条`);
    head.append(identity, status);
    const objective = textElement('p', 'proofreading-stage-objective', stage.objective || '按阶段执行稿件审校。');
    const checks = document.createElement('div');
    checks.className = 'proofreading-stage-checks';
    checks.setAttribute('aria-label', `${stage.name || '本阶段'}检查项目`);
    for (const item of Array.isArray(stage.checks) ? stage.checks : []) checks.append(textElement('span', '', item));
    const summary = textElement('p', 'proofreading-stage-summary', stage.summary || '阶段已完成。');
    const list = document.createElement('ul');
    renderIssueFindings(list, stage.issues, `${stage.name || '本阶段'}已完成，未发现有明确原文证据的问题。`);
    section.append(head, objective, checks, summary, list);
    return section;
  }));
}

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
    head.append(textElement('strong', '', location), textElement('span', `ai-label is-${value.status === 'success' ? (value.isAiGenerated ? 'ai' : 'human') : 'unscored'}`, value.labelZh || '无法评分'));
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

export function renderIssueFindings(node, values) {
  const items = Array.isArray(values) ? values : [];
  node.className = 'issue-finding-list';
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

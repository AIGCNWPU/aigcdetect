import { api } from '../../../api.js';

const MAX_TEXT_LENGTH = 200_000;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
const createId = () => `section-${Math.random().toString(36).slice(2, 9)}`;

function splitDocument(text) {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  if (!normalized) return [];
  const sections = [];
  const lines = normalized.split('\n');
  const headingPattern = /^(?:#{1,6}\s+|第[一二三四五六七八九十百千0-9]+[章节篇部]\s*|[一二三四五六七八九十百千0-9]+[、.]\s*)/;
  let current = { id: createId(), title: '正文', content: [] };
  for (const line of lines) {
    const cleanLine = line.trim();
    if (cleanLine && headingPattern.test(cleanLine) && current.content.join('\n').trim()) {
      sections.push({ ...current, content: current.content.join('\n').trim() });
      current = { id: createId(), title: cleanLine.replace(/^#{1,6}\s+/, ''), content: [] };
    } else current.content.push(line);
  }
  if (current.content.join('\n').trim()) sections.push({ ...current, content: current.content.join('\n').trim() });
  return sections;
}

function renderSections(sections, selectedId) {
  if (!sections.length) return '<p class="academic-empty-hint">解析正文后，可在这里选择整篇论文或指定章节。</p>';
  return sections.map(section => `<label class="academic-section-option"><input type="radio" name="academic-section" value="${escapeHtml(section.id)}" ${section.id === selectedId ? 'checked' : ''}><span><strong>${escapeHtml(section.title)}</strong><small>${section.content.length.toLocaleString()} 字</small></span></label>`).join('');
}

function sentencePreview(text) {
  return text.replace(/\s+/g, ' ').match(/[^。！？!?；;]+[。！？!?；;]?/g)?.map(item => item.trim()).filter(item => item.length > 3).map((sentence, index) => {
    let score = 22;
    const clues = [];
    if (sentence.length > 75) { score += 16; clues.push('句子较长'); }
    if (/(综上所述|因此|此外|值得注意的是|需要指出的是|总而言之|in conclusion|moreover)/i.test(sentence)) { score += 15; clues.push('模板化连接词'); }
    if (/(能够有效|具有重要|显著提升|进一步促进|深入探讨|实现\S+目标)/.test(sentence)) { score += 12; clues.push('高频学术表达'); }
    if (/(的的|了了|研究研究|可以可以)/.test(sentence)) { score += 14; clues.push('重复表达'); }
    score = Math.min(score, 96);
    const level = score >= 62 ? '疑似较高' : score >= 42 ? '需要复核' : '较低';
    const tone = score >= 62 ? 'high' : score >= 42 ? 'medium' : 'low';
    return { index: index + 1, sentence, score, level, tone, clues: clues.length ? clues.join('、') : '未发现明显规则线索' };
  }) || [];
}

function renderSentencePreview(text) {
  const items = sentencePreview(text);
  if (!items.length) return '<p class="academic-empty-hint">提交正文并解析后，这里将显示逐句预览。</p>';
  return `<div class="academic-sentence-toolbar"><span>共 ${items.length} 句</span><span class="academic-preview-note">本地规则预检 · 仅供辅助判断</span></div><div class="academic-sentence-list">${items.map(item => `<article class="academic-sentence academic-sentence-${item.tone}"><div class="academic-sentence-marker"><span>${item.index}</span><strong>${item.score}%</strong></div><div class="academic-sentence-body"><p>${escapeHtml(item.sentence)}</p><small>${escapeHtml(item.level)} · ${escapeHtml(item.clues)}</small></div></article>`).join('')}</div>`;
}

function renderWorkspace(container, state) {
  const selectedSection = state.sections.find(section => section.id === state.selectedId);
  const selectedText = selectedSection ? selectedSection.content : state.text;
  const status = state.status === 'error'
    ? `<div class="academic-alert academic-alert-error" role="alert">${escapeHtml(state.message)}</div>`
    : state.status === 'not-implemented'
      ? `<div class="academic-alert academic-alert-warning" role="status"><strong>检测服务暂未接入</strong><span>${escapeHtml(state.message)}</span></div>`
      : state.status === 'ready'
        ? `<div class="academic-alert academic-alert-success" role="status">已解析 ${state.sections.length || 1} 个内容区块，可选择检测范围。</div>` : '';
  container.innerHTML = `<div class="academic-workspace">
    <div class="academic-intro"><div><p class="academic-kicker">PAPER WORKSPACE / 1.1</p><h2>提交论文并设置检测范围</h2><p>粘贴正文或上传文件，识别章节后选择整篇论文或指定章节进行检测。</p></div><span class="academic-state">${state.status === 'not-implemented' ? '检测服务待接入' : '尚未检测'}</span></div>
    ${status}
    <div class="academic-grid">
      <section class="academic-panel academic-input-panel"><div class="academic-panel-heading"><div><span class="academic-step">01</span><h3>提交论文</h3></div><span class="academic-muted">支持 13 种文本格式</span></div>
        <label class="academic-upload"><input id="academic-file" type="file" accept=".txt,.md,.markdown,.html,.htm,.csv,.json,.xml,.tex,.bib,.rst,.log,.srt,.vtt,.rtf,text/plain,text/markdown,text/html,application/json,application/xml"><span class="academic-upload-icon">↑</span><span><strong>上传论文文件</strong><small>TXT、MD、HTML、CSV、JSON、XML、TEX、RTF 等</small></span></label>
        <div class="academic-divider"><span>或直接粘贴正文</span></div><label class="academic-text-label" for="academic-text">正文内容</label>
        <textarea id="academic-text" maxlength="${MAX_TEXT_LENGTH}" placeholder="请粘贴论文正文，建议保留章节标题和段落结构。">${escapeHtml(state.text)}</textarea>
        <div class="academic-input-footer"><span>${state.text.length.toLocaleString()} / ${MAX_TEXT_LENGTH.toLocaleString()} 字</span><button class="academic-button academic-button-secondary" data-action="parse">解析并识别章节</button></div>
        <p class="academic-help">支持直接读取的文本格式；PDF、DOC、DOCX 将在文档解析服务接入后支持。</p>
      </section>
      <section class="academic-panel academic-selection-panel"><div class="academic-panel-heading"><div><span class="academic-step">02</span><h3>设置检测范围</h3></div></div>
        <div class="academic-section-list">${renderSections(state.sections, state.selectedId)}</div>
        <label class="academic-check"><input id="academic-exclude" type="checkbox" ${state.excludeReferences ? 'checked' : ''}><span><strong>检测时排除参考文献与引用</strong><small>勾选后，检测将忽略“参考文献”或“References”章节及相关引用内容。</small></span></label>
        <button class="academic-button academic-button-primary" data-action="submit" ${selectedText.trim() && !state.loading ? '' : 'disabled'}>${state.loading ? '正在提交检测…' : '提交检测'}</button><p class="academic-disclaimer">检测结果由服务返回；服务未接入时仅展示辅助预览，不生成正式结论。</p>
      </section>
    </div>
    <section class="academic-sentence-preview"><div class="academic-report-heading"><div><span class="academic-step">03</span><div><h3>细粒度风险预览</h3><p>细分文本片段风险线索，辅助定位需要人工复核的内容。</p></div></div><div class="academic-legend"><span class="legend-low">较低</span><span class="legend-medium">需复核</span><span class="legend-high">较高</span></div></div>${renderSentencePreview(selectedText)}</section>
    <section class="academic-report-placeholder"><div class="academic-report-icon">✓</div><div><h3>正式检测报告</h3><p>完成正式检测后，这里将汇总全文及各章节风险、可疑段落和检测范围，并支持保存与导出。</p></div><span class="academic-badge">等待正式检测</span></section>
  </div>`;

  container.querySelector('#academic-text').addEventListener('input', event => { state.text = event.target.value; state.status = 'idle'; state.sections = []; state.selectedId = ''; });
  container.querySelector('#academic-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!/\.(txt|md|markdown|html|htm|csv|json|xml|tex|bib|rst|log|srt|vtt|rtf)$/i.test(file.name)) { state.status = 'error'; state.message = '当前支持 TXT、MD、HTML、CSV、JSON、XML、TEX、BIB、RST、LOG、SRT、VTT、RTF；PDF、DOC/DOCX 需要文档解析服务。'; renderWorkspace(container, state); return; }
    state.text = await file.text(); state.fileName = file.name; state.status = 'idle'; renderWorkspace(container, state);
  });
  container.querySelector('[data-action="parse"]').addEventListener('click', () => { state.sections = splitDocument(state.text); state.selectedId = state.sections[0]?.id || ''; state.status = state.sections.length ? 'ready' : 'error'; state.message = state.sections.length ? '' : '请先粘贴或上传论文正文。'; renderWorkspace(container, state); });
  container.querySelectorAll('input[name="academic-section"]').forEach(input => input.addEventListener('change', event => { state.selectedId = event.target.value; }));
  container.querySelector('#academic-exclude').addEventListener('change', event => { state.excludeReferences = event.target.checked; });
  container.querySelector('[data-action="submit"]').addEventListener('click', async () => {
    const section = state.sections.find(item => item.id === state.selectedId);
    const content = section?.content || state.text;
    if (!content.trim()) return;
    state.loading = true; state.status = 'idle'; renderWorkspace(container, state);
    try { await api.invoke('/text/academic', { content, scope: section ? { type: 'section', id: section.id, title: section.title } : { type: 'document' }, excludeReferences: state.excludeReferences }); state.status = 'ready'; state.message = '检测已完成。'; }
    catch (error) { state.status = error.status === 501 ? 'not-implemented' : 'error'; state.message = error.status === 501 ? '当前项目的论文检测服务尚未实现，请勿将当前页面视为检测报告。' : `检测失败：${error.message}`; }
    finally { state.loading = false; renderWorkspace(container, state); }
  });
}

/** AI论文与学术稿件检测：提交、章节选择与真实服务状态展示。 */
export function renderTextAcademic(container, route) {
  void route;
  // 保持框架级渲染器契约：非浏览器检查只传入占位对象，不执行 DOM 操作。
  if (!container || typeof container.querySelector !== 'function') return;
  renderWorkspace(container, { text: '', fileName: '', sections: [], selectedId: '', excludeReferences: false, loading: false, status: 'idle', message: '' });
}

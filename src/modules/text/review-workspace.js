import { REVIEW_STATES, reviewDocuments, buildReviewEntries, partitionReviewHighlights, commonEvidenceText } from './review-model.js';
import { installReviewStyles } from './review-style.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function button(text, label = text) {
  const node = element('button', '', text);
  node.type = 'button'; node.setAttribute('aria-label', label);
  return node;
}

function stateSelect(label, includeAll = false) {
  const node = element('select'); node.setAttribute('aria-label', label);
  if (includeAll) node.append(new Option('全部问题', 'all'));
  for (const [value, text] of Object.entries(REVIEW_STATES)) node.append(new Option(text, value));
  return node;
}

function highlightCommon(node, text, common) {
  const offset = common ? text.indexOf(common) : -1;
  if (offset < 0) { node.textContent = text; return; }
  node.append(document.createTextNode(text.slice(0, offset)), element('mark', '', common), document.createTextNode(text.slice(offset + common.length)));
}

function scrollInside(container, target) {
  const box = container.getBoundingClientRect(), item = target.getBoundingClientRect();
  const inset = Math.max(0, (container.clientHeight - item.height) / 2);
  container.scrollTop += item.top - box.top - container.clientTop - inset;
}

export function createReviewWorkspace({ list, kind, paragraphChars = 700, onSelectChapter = () => {}, drafts, onDetect }) {
  installReviewStyles();
  const workspace = element('section', 'text-review-workspace'); workspace.hidden = true;
  const source = element('section', 'text-review-source'), sourceHead = element('header');
  const previous = button('上一个', '上一个问题'), next = button('下一个', '下一个问题');
  const navigation = element('output', 'text-review-count'); navigation.setAttribute('aria-live', 'polite');
  const documentSelect = element('select'); documentSelect.setAttribute('aria-label', '原文章节');
  const sourceBody = element('div', 'text-review-source-body'); sourceBody.setAttribute('aria-label', '本次检测原文');
  const announcement = element('p', 'text-review-announcement'); announcement.setAttribute('role', 'status');
  const edit = button('编辑正文'), detect = button('开始检测'), revert = button('撤销编辑');
  const draftNotice = element('small', 'text-review-draft-notice'); draftNotice.setAttribute('role', 'status');
  const editActions = element('div', 'text-review-edit-actions');
  if (drafts) { editActions.append(edit, detect, revert, draftNotice); sourceHead.append(editActions); }
  const help = kind === 'ai' ? '人工为绿、疑似AI为黄、AI为红、无法评分为灰。'
    : '点击高亮查看对应问题；点击问题的定位按钮返回原文。';
  sourceHead.prepend(element('h4', '', '本次检测原文'), documentSelect, previous, next, navigation, element('small', '', help));
  source.append(sourceHead, sourceBody, announcement);
  const results = element('section', 'text-review-results'), resultHead = element('header');
  const count = element('output', 'text-review-count'); count.setAttribute('aria-live', 'polite');
  const filter = kind === 'proofreading' ? stateSelect('按处理状态筛选', true) : null;
  resultHead.append(count);
  if (filter) resultHead.append(filter, element('small', '', '处理状态为人工标记，不代表正文已自动修改或复检通过；仅保留在当前页面。'));
  const problems = element('div', 'text-review-problems'), empty = element('p', 'text-review-empty', '当前筛选下没有问题。'); empty.hidden = true;
  list.before(workspace); problems.append(list, empty); results.append(resultHead, problems); workspace.append(source, results);
  let documents = [], entries = [], cards = [], chapterId = 'all', selectedKey = null, serial = 0, editing = false, refreshPanel = () => {};
  const states = new Map(), identifiers = new Map(), views = new Map(), anchorViews = new Map();
  const idFor = key => { if (!identifiers.has(key)) identifiers.set(key, `review-${kind}-${serial++}`); return identifiers.get(key); };
  const visible = () => entries.filter(entry => !filter || filter.value === 'all' || (states.get(entry.key) || 'pending') === filter.value);

  function updateState() {
    const totals = Object.fromEntries(Object.keys(REVIEW_STATES).map(key => [key, 0]));
    for (const entry of entries) {
      const state = states.get(entry.key) || 'pending'; totals[state]++;
      for (const card of views.get(entry.key) || []) {
        card.hidden = Boolean(filter && filter.value !== 'all' && filter.value !== state);
        const select = card.querySelector('[data-review-state]'); if (select) select.value = state;
      }
    }
    count.textContent = filter
      ? `去重 ${entries.length} 条 · ${Object.entries(REVIEW_STATES).map(([key, label]) => `${label} ${totals[key]}`).join(' · ')}`
      : `可定位 ${entries.filter(entry => entry.anchors.some(Boolean)).length} / ${entries.length} 项`;
    const available = visible(), index = available.findIndex(entry => entry.key === selectedKey);
    navigation.textContent = `${index >= 0 ? index + 1 : 0} / ${available.length}`;
    previous.disabled = next.disabled = !available.length || editing || Boolean(drafts?.changed());
    empty.hidden = !entries.length || Boolean(available.length);
    refreshPanel();
  }

  function paintSelection() {
    for (const entry of entries) for (const card of views.get(entry.key) || []) card.classList.toggle('is-review-active', entry.key === selectedKey);
    for (const mark of sourceBody.querySelectorAll('[data-review-anchors]')) {
      const active = JSON.parse(mark.dataset.reviewAnchors).some(value => value.key === selectedKey);
      mark.classList.toggle('is-active', active);
    }
    updateState();
  }

  function navigate(key, anchorIndex = 0, side = 'source') {
    if (drafts?.changed()) { announcement.textContent = '正文已修改，请重新检测后定位；右侧仍为上次检测结果。'; return; }
    if (editing) { editing = false; renderSource(); }
    let entry = entries.find(item => item.key === key); if (!entry) return;
    const anchor = entry.anchors[anchorIndex] || entry.anchors.find(Boolean);
    if (filter && filter.value !== 'all' && (states.get(key) || 'pending') !== filter.value) filter.value = 'all';
    if (anchor && chapterId !== 'all' && chapterId !== anchor.documentId) {
      chapterId = anchor.documentId;
      onSelectChapter(chapterId);
      entry = entries.find(item => item.key === key) || entry;
      renderSource();
    }
    selectedKey = key; paintSelection();
    announcement.textContent = anchor
      ? `${anchor.title}${anchor.paragraphIndex ? ` · 第${anchor.paragraphIndex}段` : ''} · ${entry.label}${entry.anchors.filter(Boolean).length > 1 ? ' · 可逐侧定位证据' : ''}`
      : '该条结果与送检原文的位置无法核对，未进行猜测定位。';
    const target = side === 'problem' ? views.get(key)?.find(card => !card.hidden)
      : anchorViews.get(`${key}:${anchorIndex}`) || (anchor && anchorViews.get(`${key}:${entry.anchors.indexOf(anchor)}`));
    if (target) {
      target.focus({ preventScroll: true });
      scrollInside(side === 'problem' ? problems : sourceBody, target);
      // 只在工具栏本身离开屏幕时展示工具栏，绝不把长高亮滚到整页中央。
      const toolbar = sourceHead.getBoundingClientRect();
      if (toolbar.top < 0 || toolbar.bottom > innerHeight) sourceHead.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function renderSource() {
    sourceBody.replaceChildren(); anchorViews.clear();
    documentSelect.replaceChildren(new Option('全文原文', 'all'), ...documents.map(doc => new Option(doc.title, doc.id)));
    documentSelect.hidden = documents.length < 2; documentSelect.value = chapterId;
    const shown = chapterId === 'all' ? documents : documents.filter(doc => doc.id === chapterId);
    if (!shown.length || !shown.some(doc => doc.content)) { sourceBody.append(element('p', 'text-review-empty', '该结果没有保留可核对的原文，请重新检测。')); return; }
    for (const doc of shown) {
      const section = element('section', 'text-review-document'); section.dataset.reviewDocument = doc.id;
      section.append(element('h5', '', doc.title));
      if (drafts && editing) {
        const editor = element('textarea', 'text-review-editor');
        editor.setAttribute('aria-label', `编辑正文：${doc.title}`); editor.dataset.editDocument = doc.id;
        editor.maxLength = drafts.maxLength;
        editor.value = drafts.content(doc.id) ?? doc.content; editor.disabled = drafts.busy();
        editor.addEventListener('input', () => { try { drafts.set(doc.id, editor.value); } catch (error) { editor.value = drafts.content(doc.id) ?? doc.content; announcement.textContent = error.message; } });
        section.append(editor); sourceBody.append(section); continue;
      }
      const original = element('div', 'text-review-original');
      if (drafts?.changed(doc.id)) { original.textContent = drafts.content(doc.id); section.append(original); sourceBody.append(section); continue; }
      const anchors = new Map(), ranges = [];
      for (const entry of visible()) for (const [index, anchor] of entry.anchors.entries()) if (anchor?.documentId === doc.id) {
        const id = `${idFor(entry.key)}-a${index}`; anchors.set(id, { key: entry.key, index, entry }); ranges.push({ start: anchor.start, end: anchor.end, id });
      }
      for (const slice of partitionReviewHighlights(doc.content, ranges)) {
        if (!slice.ids.length) { original.append(document.createTextNode(slice.text)); continue; }
        const targets = slice.ids.map(id => anchors.get(id)), primary = targets[0];
        const mark = button(slice.text, `查看${primary.entry.label}对应问题`);
        mark.className = `text-review-mark is-${primary.entry.color}`;
        mark.dataset.reviewAnchors = JSON.stringify(targets.map(({ key, index }) => ({ key, index })));
        mark.title = targets.length > 1 ? `此处关联 ${targets.length} 项；再次点击可切换问题` : '点击查看对应问题';
        mark.addEventListener('click', () => {
          const index = targets.findIndex(item => item.key === selectedKey), target = targets[(index + 1) % targets.length];
          navigate(target.key, target.index, 'problem');
        });
        for (const target of targets) if (!anchorViews.has(`${target.key}:${target.index}`)) anchorViews.set(`${target.key}:${target.index}`, mark);
        original.append(mark);
      }
      section.append(original); sourceBody.append(section);
    }
    paintSelection();
  }

  function appendEvidence(card, entry) {
    const refs = entry.value.references || [];
    if (entry.value.type !== 'repetition' || refs.length < 2) return;
    for (const old of card.querySelectorAll('.issue-original')) old.remove();
    const comparison = element('section', 'text-review-evidence');
    const crossChapter = new Set(refs.map(ref => String(ref.chapterId ?? ref.chapter ?? ''))).size > 1;
    comparison.append(element('strong', '', crossChapter ? '跨章重复证据对照' : '重复证据对照'));
    const common = commonEvidenceText(refs[0].quote, refs[1].quote);
    comparison.append(element('p', '', common ? '黄色仅标示字面相同的连续部分，请结合上下文复核。' : '未突出短小的共用词，请结合两侧上下文复核语义线索。'));
    const grid = element('div', 'text-review-evidence-grid');
    refs.forEach((ref, index) => {
      const anchor = entry.anchors[index], figure = element('figure');
      figure.append(element('figcaption', '', `${ref.chapter || anchor?.title || '章节未标明'} · 第${ref.paragraphIndex || '?'}段`));
      const quote = element('blockquote'); highlightCommon(quote, String(ref.quote || ''), common); figure.append(quote);
      const locate = button('定位本侧原文', `定位第${index + 1}侧原文`); locate.disabled = !anchor;
      locate.addEventListener('click', () => navigate(entry.key, index)); figure.append(locate);
      if (anchor) {
        const doc = documents.find(item => item.id === anchor.documentId), details = element('details');
        details.append(element('summary', '', '展开本段上下文'), element('p', '', doc.content.slice(anchor.contextStart, anchor.contextEnd))); figure.append(details);
      } else figure.append(element('p', '', '该证据位置无法与原文核对。'));
      grid.append(figure);
    });
    comparison.append(grid); card.append(comparison);
  }

  function render({ values = [], documents: nextDocuments, chapterId: nextChapter = chapterId } = {}) {
    if (nextDocuments) documents = reviewDocuments(nextDocuments, { virtualParagraphChars: paragraphChars });
    chapterId = nextChapter;
    if (chapterId !== 'all' && !documents.some(doc => doc.id === chapterId)) chapterId = 'all';
    entries = buildReviewEntries(kind, values, documents); views.clear();
    cards = [...list.querySelectorAll(kind === 'ai' ? '.ai-sentence-item' : '.issue-finding-list > li:not(.issue-finding-empty)')];
    if (kind === 'quality') cards = [...list.children].filter(card => !card.classList.contains('issue-finding-empty'));
    for (const old of list.querySelectorAll('.text-review-actions,.text-review-evidence')) old.remove();
    for (const entry of entries) {
      const entryCards = entry.occurrences.map(index => cards[index]).filter(Boolean); views.set(entry.key, entryCards);
      for (const card of entryCards) {
        card.dataset.reviewEntry = idFor(entry.key); card.tabIndex = -1;
        const actions = element('div', 'text-review-actions'), locate = button('定位原文'); locate.disabled = !entry.anchors.some(Boolean);
        locate.addEventListener('click', () => navigate(entry.key)); actions.append(locate);
        if (!entry.anchors.some(Boolean)) actions.append(element('output', '', '原文位置不可核对'));
        if (filter) {
          const label = element('label', '', '处理状态'), select = stateSelect('问题处理状态'); select.dataset.reviewState = '';
          select.value = states.get(entry.key) || 'pending'; select.addEventListener('change', () => { states.set(entry.key, select.value); if (filter.value === 'all') updateState(); else renderSource(); });
          label.append(select); actions.append(label);
          if (entry.stageNames.length > 1) actions.append(element('small', '', `共同发现：${entry.stageNames.join('、')}（处理状态同步）`));
        }
        card.append(actions); if (kind === 'quality') appendEvidence(card, entry);
      }
    }
    workspace.hidden = false; renderSource(); updateState(); syncDraft();
  }

  function syncDraft() {
    if (!drafts) return;
    edit.textContent = editing ? '查看标注' : '编辑正文';
    edit.disabled = drafts.busy() || !documents.some(doc => doc.content);
    detect.disabled = drafts.busy() || !documents.length;
    detect.textContent = drafts.busy() ? '正在检测…' : '开始检测';
    revert.disabled = drafts.busy() || !drafts.changed();
    draftNotice.textContent = drafts.changed() ? '正文已修改，右侧是上次检测结果；点击开始检测更新。' : '可编辑正文后重新检测，分数以重新检测结果为准。';
    results.classList.toggle('is-review-stale', drafts.changed());
    for (const editor of sourceBody.querySelectorAll('[data-edit-document]')) {
      const content = drafts.content(editor.dataset.editDocument);
      if (editor.value !== content && content != null) editor.value = content;
      editor.disabled = drafts.busy();
    }
    if (!editing && !workspace.hidden) renderSource();
    updateState();
  }
  drafts?.subscribe(syncDraft);
  edit.addEventListener('click', () => { editing = !editing; renderSource(); syncDraft(); });
  revert.addEventListener('click', () => { drafts.revert(); renderSource(); });
  detect.addEventListener('click', async () => {
    if (drafts.busy()) return;
    announcement.textContent = '';
    try { await onDetect?.(drafts.documents()); } catch (error) { announcement.textContent = error.message || '检测失败，编辑稿已保留。'; }
  });

  previous.addEventListener('click', () => { const list = visible(), current = list.findIndex(item => item.key === selectedKey); if (list.length) navigate(list[(current > 0 ? current : list.length) - 1].key); });
  next.addEventListener('click', () => { const list = visible(), current = list.findIndex(item => item.key === selectedKey); if (list.length) navigate(list[(current + 1) % list.length].key); });
  documentSelect.addEventListener('change', () => { chapterId = documentSelect.value; onSelectChapter(chapterId); renderSource(); });
  filter?.addEventListener('change', () => { announcement.textContent = ''; renderSource(); });
  return {
    render,
    edit() { if (!editing) { editing = true; renderSource(); } syncDraft(); },
    mergePanel(panel) {
      const tabs = element('div', 'text-review-result-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', '检测与改写');
      const findings = button('检测片段'), suggestions = button('修改建议');
      findings.setAttribute('role', 'tab'); suggestions.setAttribute('role', 'tab'); tabs.append(findings, suggestions); resultHead.append(tabs); problems.append(panel);
      let showing = false;
      const show = value => { showing = value; list.hidden = value; panel.hidden = !value; empty.hidden = value || Boolean(visible().length); findings.setAttribute('aria-selected', String(!value)); suggestions.setAttribute('aria-selected', String(value)); };
      refreshPanel = () => show(showing); panel.dataset.merged = '';
      findings.addEventListener('click', () => show(false)); suggestions.addEventListener('click', () => show(true)); show(false);
      return { show, refresh: () => show(showing) };
    },
    reset(values = []) { documents = reviewDocuments(values, { virtualParagraphChars: paragraphChars }); entries = []; selectedKey = null; editing = false; states.clear(); identifiers.clear(); serial = 0; views.clear(); anchorViews.clear(); announcement.textContent = ''; if (filter) filter.value = 'all'; workspace.hidden = true; },
  };
}

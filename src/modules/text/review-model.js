import { segmentText } from './segmentation.js';

export const REVIEW_STATES = Object.freeze({ pending: '待处理', modified: '已修改', retained: '保留原文', verify: '待人工核实' });

// 只保存当前页面的编辑草稿；送检快照由调用页面持有，草稿永不修改旧回执。
export function createReviewDrafts({ maxLength = 100000 } = {}) {
  let documents = [], busy = false;
  const listeners = new Set();
  const notify = () => listeners.forEach(listener => listener());
  return {
    maxLength,
    reset(values = []) { documents = structuredClone(values).map(value => ({ ...value, id: String(value.id), original: value.content || '', content: value.content || '' })); notify(); },
    documents: () => structuredClone(documents),
    content: id => documents.find(doc => doc.id === String(id))?.content,
    changed: id => documents.some(doc => (id == null || doc.id === String(id)) && doc.content !== doc.original),
    set(id, content) {
      if (busy) throw new Error('正在检测，请等待本次检测结束后编辑。');
      const doc = documents.find(value => value.id === String(id));
      if (!doc) throw new Error('找不到对应章节，请重新打开当前结果。');
      if (typeof content !== 'string' || content.length > maxLength) throw new Error(`正文不能超过 ${maxLength.toLocaleString()} 字。`);
      doc.content = content; notify();
    },
    revert() { if (busy) return; documents.forEach(doc => { doc.content = doc.original; }); notify(); },
    busy: () => busy,
    setBusy(value) { busy = Boolean(value); notify(); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
}

export function reviewDocuments(values, { virtualParagraphChars = 700 } = {}) {
  return (Array.isArray(values) ? values : []).map(value => ({
    id: String(value.id ?? value.chapterId ?? 'news'),
    title: String(value.title ?? value.chapter ?? '本次检测原文'),
    content: typeof value.content === 'string' ? value.content : '',
  })).map(value => ({ ...value, paragraphs: segmentText(value.content, { virtualParagraphChars }) }));
}

function boundary(text, index) {
  return !(index > 0 && index < text.length && /[\uD800-\uDBFF]/u.test(text[index - 1]) && /[\uDC00-\uDFFF]/u.test(text[index]));
}

export function resolveReviewAnchor(documents, reference, { absolute = false } = {}) {
  const ref = reference || {};
  const candidates = ref.chapterId != null
    ? documents.filter(item => item.id === String(ref.chapterId))
    : ref.chapter ? documents.filter(item => item.title === ref.chapter) : documents;
  if (candidates.length !== 1) return null;
  const doc = candidates[0], quote = String(ref.quote ?? ref.text ?? '');
  let start, end, paragraph;
  if (Number.isInteger(ref.absoluteStart) && Number.isInteger(ref.absoluteEnd)) {
    start = ref.absoluteStart; end = ref.absoluteEnd;
  } else if (absolute) {
    start = ref.start; end = ref.end;
  } else {
    paragraph = doc.paragraphs.find(item => item.paragraphIndex === ref.paragraphIndex);
    if (!paragraph || !Number.isInteger(ref.start) || !Number.isInteger(ref.end) || ref.start < 0 || ref.end > paragraph.text.length) return null;
    start = paragraph.start + ref.start; end = paragraph.start + ref.end;
  }
  if (!quote || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > doc.content.length
    || !boundary(doc.content, start) || !boundary(doc.content, end) || doc.content.slice(start, end) !== quote) return null;
  paragraph ||= doc.paragraphs.find(item => item.start <= start && item.end >= end);
  const paragraphOffset = doc.paragraphs.indexOf(paragraph);
  return {
    documentId: doc.id, title: doc.title, start, end, quote,
    paragraphIndex: paragraph?.paragraphIndex,
    contextStart: paragraph ? doc.paragraphs[Math.max(0, paragraphOffset - 1)].start : start,
    contextEnd: paragraph ? doc.paragraphs[Math.min(doc.paragraphs.length - 1, paragraphOffset + 1)].end : end,
  };
}

export function proofreadingRecords(value) {
  return Array.isArray(value?.stages) && value.stages.length
    ? value.stages.flatMap(stage => (Array.isArray(stage.issues) ? stage.issues : []).map(issue => ({ ...issue, reviewStageName: stage.name })))
    : Array.isArray(value?.issues) ? value.issues : [];
}

export function buildReviewEntries(kind, values, documents) {
  const groups = new Map();
  for (const [index, value] of (values || []).entries()) {
    const refs = kind === 'ai' ? [value] : kind === 'proofreading' ? [value.position || {}] : value.references || [];
    const anchors = refs.map(ref => resolveReviewAnchor(documents, ref, { absolute: kind === 'ai' }));
    const locationKey = refs.map(ref => [
      ref.chapterId ?? '', ref.paragraphId ?? '', ref.absoluteStart ?? ref.start, ref.absoluteEnd ?? ref.end, ref.quote ?? ref.text,
    ]);
    // 与现有新闻服务的跨阶段去重键一致，不因同一问题引用长短不同而拆开处理状态。
    const key = JSON.stringify(kind === 'proofreading' && value.position
      ? [kind, value.type || '', value.position.paragraphId || '', value.position.start ?? value.position.absoluteStart, value.message || '']
      : [kind, value.type || '', value.message || '', locationKey]);
    if (!groups.has(key)) groups.set(key, {
      key, kind, value, anchors, occurrences: [], stageNames: [],
      color: kind === 'ai' ? (value.status !== 'success' ? 'unscored' : value.label || (value.predictedLabel === 1 ? 'suspected-ai' : 'human')) : 'issue',
      label: kind === 'ai' ? value.labelZh || (value.status === 'success' ? 'AI检测片段' : '无法评分') : value.type || '问题',
    });
    const entry = groups.get(key);
    entry.occurrences.push(index);
    if (value.reviewStageName && !entry.stageNames.includes(value.reviewStageName)) entry.stageNames.push(value.reviewStageName);
  }
  return [...groups.values()];
}

// 展示用区间分割：保留全部原文，重叠区间不嵌套，也不遗漏任一关联问题。
export function partitionReviewHighlights(text, ranges) {
  const events = new Map([[0, { starts: [], ends: [] }], [text.length, { starts: [], ends: [] }]]);
  for (const range of ranges) {
    if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < 0 || range.end > text.length || range.end <= range.start
      || !boundary(text, range.start) || !boundary(text, range.end)) continue;
    for (const [offset, type] of [[range.start, 'starts'], [range.end, 'ends']]) {
      if (!events.has(offset)) events.set(offset, { starts: [], ends: [] });
      events.get(offset)[type].push(range.id);
    }
  }
  const offsets = [...events.keys()].sort((a, b) => a - b), active = new Map(), slices = [];
  for (let i = 0; i < offsets.length - 1; i++) {
    const start = offsets[i], event = events.get(start), end = offsets[i + 1];
    for (const id of event.ends) { const count = (active.get(id) || 0) - 1; if (count > 0) active.set(id, count); else active.delete(id); }
    for (const id of event.starts) active.set(id, (active.get(id) || 0) + 1);
    if (end > start) slices.push({ start, end, text: text.slice(start, end), ids: [...active.keys()] });
  }
  return slices;
}

// 仅突出字面相同的连续部分，不新增或改变重复/水稿判断。
export function commonEvidenceText(left, right) {
  const a = Array.from(String(left || '')).slice(0, 500), b = Array.from(String(right || '')).slice(0, 500);
  let previous = new Uint16Array(b.length + 1), best = 0, end = 0;
  for (let i = 1; i <= a.length; i++) {
    const current = new Uint16Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) if (a[i - 1] === b[j - 1]) {
      current[j] = previous[j - 1] + 1;
      if (current[j] > best) { best = current[j]; end = i; }
    }
    previous = current;
  }
  return best >= 6 ? a.slice(end - best, end).join('') : '';
}

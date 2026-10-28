const SENTENCE_END = new Set(['。', '！', '？', '!', '?']);
const CLOSING_MARKS = new Set(['”', '’', '」', '』', '】', '》', '）', ')', ']', '}', '"', "'"]);

function trimRange(text, start, end) {
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return { start, end };
}

function isDecimalPoint(text, index) {
  return /\d/u.test(text[index - 1] || '') && /\d/u.test(text[index + 1] || '');
}

function isAbbreviationPoint(text, index) {
  const before = text.slice(Math.max(0, index - 8), index + 1);
  const after = text.slice(index + 1).match(/\S/u)?.[0] || '';
  return /(?:\b[A-Za-z]|(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc))\.$/u.test(before) && /[A-Za-z]/u.test(after);
}

function punctuationEnd(text, index) {
  const current = text[index];
  if (SENTENCE_END.has(current)) return index + 1;
  if (current === '.' && !isDecimalPoint(text, index) && !isAbbreviationPoint(text, index)) {
    let end = index + 1;
    while (text[end] === '.') end += 1;
    return end;
  }
  if (current === '…' && text[index + 1] === '…') {
    let end = index + 2;
    while (text[end] === '…') end += 1;
    return end;
  }
  return 0;
}

/**
 * 浏览器端句级切分。start/end 使用 JavaScript UTF-16 索引，保证
 * content.slice(start, end) === text，可直接用于页面高亮和服务端校验。
 * 长句保持完整，不按固定字数硬切。
 */
export function splitAiSentences(content, { prefix = 's' } = {}) {
  if (typeof content !== 'string' || !content.trim()) return [];
  const ranges = [];
  let start = 0;
  let paragraphIndex = 1;
  const push = end => {
    const range = trimRange(content, start, end);
    if (range.end > range.start) ranges.push({ ...range, paragraphIndex });
    start = end;
  };

  for (let index = 0; index < content.length; index += 1) {
    if (content[index] === '\r' || content[index] === '\n') {
      push(index);
      while (index + 1 < content.length && /[\r\n]/u.test(content[index + 1])) index += 1;
      start = index + 1;
      paragraphIndex += 1;
      continue;
    }
    const punctuation = punctuationEnd(content, index);
    if (!punctuation) continue;
    let end = punctuation;
    while (end < content.length && CLOSING_MARKS.has(content[end])) end += 1;
    push(end);
    index = end - 1;
  }
  push(content.length);

  return ranges.map((range, offset) => ({
    segmentId: `${prefix}-${String(offset + 1).padStart(5, '0')}`,
    sentenceIndex: offset + 1,
    paragraphIndex: range.paragraphIndex,
    start: range.start,
    end: range.end,
    text: content.slice(range.start, range.end),
  }));
}

function createScoringSegment(content, sentences, prefix, offset) {
  const first = sentences[0];
  const last = sentences[sentences.length - 1];
  const sentenceIndexes = sentences.map(item => item.sentenceIndex);
  return {
    segmentId: `${prefix}-${String(offset + 1).padStart(5, '0')}`,
    sentenceIndex: first.sentenceIndex,
    sentenceIndexes,
    sentenceCount: sentenceIndexes.length,
    merged: sentenceIndexes.length > 1,
    paragraphIndex: first.paragraphIndex,
    start: first.start,
    end: last.end,
    text: content.slice(first.start, last.end),
  };
}

/**
 * 将不足算法20字符门槛的句子与同段相邻句合并，单个评分片段最多两句。
 * 返回值仍保留每个原始句号，合并得分只属于整体片段。
 */
export function createAiScoringSegments(content, { prefix = 's', minChars = 20 } = {}) {
  const sentences = splitAiSentences(content, { prefix: `${prefix}-raw` });
  const groups = [];
  for (let index = 0; index < sentences.length;) {
    const current = sentences[index];
    if (current.text.trim().length < minChars && sentences[index + 1]?.paragraphIndex === current.paragraphIndex) {
      groups.push([current, sentences[index + 1]]);
      index += 2;
      continue;
    }
    if (current.text.trim().length < minChars) {
      const previous = groups.at(-1);
      if (previous?.length === 1 && previous[0].paragraphIndex === current.paragraphIndex) {
        previous.push(current);
        index += 1;
        continue;
      }
    }
    groups.push([current]);
    index += 1;
  }
  return groups.map((group, offset) => createScoringSegment(content, group, prefix, offset));
}

const SENTENCE_END = new Set(['。', '！', '？', '!', '?']);
const CLOSING_MARKS = new Set(['”', '’', '」', '』', '】', '》', '）', ')', ']', '}', '"', "'"]);
const SOFT_SPLIT_MARKS = new Set(['，', ',', '；', ';', '：', ':', '、']);
export const AI_SEGMENT_MIN_CHARS = 20;
export const AI_SENTENCE_MAX_CHARS = 100;

function characterCount(value) {
  return [...value].length;
}

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

function codePointBoundaries(text, start, end) {
  const boundaries = [start];
  for (let index = start; index < end;) {
    const point = text.codePointAt(index);
    index += point > 0xFFFF ? 2 : 1;
    boundaries.push(index);
  }
  return boundaries;
}

function closestBoundary(content, boundaries, minimum, maximum, target, accept) {
  let selected = 0, distance = Infinity;
  for (let offset = minimum; offset <= maximum; offset += 1) {
    const start = boundaries[offset - 1], end = boundaries[offset];
    if (!accept(content.slice(start, end))) continue;
    let adjusted = offset;
    while (adjusted < maximum && CLOSING_MARKS.has(content.slice(boundaries[adjusted], boundaries[adjusted + 1]))) adjusted += 1;
    const nextDistance = Math.abs(adjusted - target);
    if (nextDistance < distance || (nextDistance === distance && adjusted > selected)) {
      selected = adjusted;
      distance = nextDistance;
    }
  }
  return selected;
}

function splitLongRange(content, range, { minChars, maxChars }) {
  const output = [];
  let start = range.start;
  while (start < range.end) {
    const trimmed = trimRange(content, start, range.end);
    start = trimmed.start;
    if (start >= trimmed.end) break;
    const boundaries = codePointBoundaries(content, start, trimmed.end);
    const remaining = boundaries.length - 1;
    if (remaining <= maxChars) {
      output.push({ start, end: trimmed.end, paragraphIndex: range.paragraphIndex });
      break;
    }
    const pieceCount = Math.ceil(remaining / maxChars);
    const target = Math.ceil(remaining / pieceCount);
    const maximum = Math.min(maxChars, remaining - minChars * (pieceCount - 1));
    let offset = closestBoundary(content, boundaries, minChars, maximum, target, value => SOFT_SPLIT_MARKS.has(value));
    if (!offset) offset = closestBoundary(content, boundaries, minChars, maximum, target, value => /\s/u.test(value));
    if (!offset) offset = Math.max(minChars, Math.min(target, maximum));
    const end = boundaries[offset];
    output.push({ start, end, paragraphIndex: range.paragraphIndex });
    start = end;
  }
  return output;
}

/**
 * 浏览器端句级切分。start/end 使用 JavaScript UTF-16 索引，保证
 * content.slice(start, end) === text，可直接用于页面高亮和服务端校验。
 * 超过maxChars的长句优先按逗号、分号、冒号、顿号等软标点切分；
 * 没有合适标点时才按字符边界切分，并保证切分后的片段不少于minChars。
 */
export function splitAiSentences(content, { prefix = 's', minChars = AI_SEGMENT_MIN_CHARS, maxChars = AI_SENTENCE_MAX_CHARS } = {}) {
  if (typeof content !== 'string' || !content.trim()) return [];
  const ranges = [], safeMinChars = Number.isInteger(minChars) && minChars > 0 ? minChars : AI_SEGMENT_MIN_CHARS;
  const safeMaxChars = Math.max(safeMinChars * 2, Number.isInteger(maxChars) && maxChars > 0 ? maxChars : AI_SENTENCE_MAX_CHARS);
  let start = 0;
  let paragraphIndex = 1;
  const push = end => {
    const range = trimRange(content, start, end);
    if (range.end > range.start) ranges.push(...splitLongRange(content, { ...range, paragraphIndex }, { minChars: safeMinChars, maxChars: safeMaxChars }));
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
export function createAiScoringSegments(content, { prefix = 's', minChars = AI_SEGMENT_MIN_CHARS, maxChars = AI_SENTENCE_MAX_CHARS } = {}) {
  const sentences = splitAiSentences(content, { prefix: `${prefix}-raw`, minChars, maxChars });
  const groups = [];
  for (let index = 0; index < sentences.length;) {
    const current = sentences[index];
    if (characterCount(current.text.trim()) < minChars && sentences[index + 1]?.paragraphIndex === current.paragraphIndex) {
      groups.push([current, sentences[index + 1]]);
      index += 2;
      continue;
    }
    if (characterCount(current.text.trim()) < minChars) {
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

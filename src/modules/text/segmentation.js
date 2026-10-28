const SENTENCE_END = new Set(['。', '！', '？', '!', '?', '；', ';']);
const CLOSING_MARKS = new Set(['”', '’', '」', '』', '】', '》', '）', ')', '"', "'"]);

function trimRange(text, start, end) {
  while (start < end && /\s/u.test(text[start])) start += 1;
  while (end > start && /\s/u.test(text[end - 1])) end -= 1;
  return { start, end };
}

function sentenceRanges(text) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!SENTENCE_END.has(text[index])) continue;
    let end = index + 1;
    while (end < text.length && CLOSING_MARKS.has(text[end])) end += 1;
    const range = trimRange(text, start, end);
    if (range.end > range.start) ranges.push(range);
    start = end;
    index = end - 1;
  }
  const tail = trimRange(text, start, text.length);
  if (tail.end > tail.start) ranges.push(tail);
  return ranges;
}

function paragraphRanges(content, virtualParagraphChars) {
  const lines = [...content.matchAll(/[^\r\n]+/gu)].map(match => trimRange(content, match.index, match.index + match[0].length)).filter(range => range.end > range.start);
  if (lines.length !== 1 || lines[0].end - lines[0].start <= virtualParagraphChars * 2) return lines;

  const source = lines[0];
  const sentences = sentenceRanges(content.slice(source.start, source.end));
  const ranges = [];
  let groupStart = null;
  let groupEnd = null;
  for (const sentence of sentences) {
    const start = source.start + sentence.start;
    const end = source.start + sentence.end;
    if (groupStart === null) groupStart = start;
    if (groupEnd !== null && end - groupStart > virtualParagraphChars) {
      ranges.push({ start: groupStart, end: groupEnd });
      groupStart = start;
    }
    groupEnd = end;
  }
  if (groupStart !== null) ranges.push({ start: groupStart, end: groupEnd });
  return ranges.length ? ranges : lines;
}

export function segmentText(content, { prefix = 'p', virtualParagraphChars = 700 } = {}) {
  if (typeof content !== 'string') return [];
  return paragraphRanges(content, virtualParagraphChars).map((range, paragraphOffset) => {
    const text = content.slice(range.start, range.end);
    const paragraphIndex = paragraphOffset + 1;
    const paragraphId = `${prefix}-${String(paragraphIndex).padStart(4, '0')}`;
    const sentences = sentenceRanges(text).map((sentence, sentenceOffset) => ({
      sentenceId: `${paragraphId}-s${String(sentenceOffset + 1).padStart(2, '0')}`,
      sentenceIndex: sentenceOffset + 1,
      start: sentence.start,
      end: sentence.end,
      text: text.slice(sentence.start, sentence.end),
    }));
    return { paragraphId, paragraphIndex, start: range.start, end: range.end, text, sentences };
  });
}

export function createParagraphWindows(paragraphs, { maxChars, maxParagraphs, overlap = 0 } = {}) {
  if (!paragraphs.length) return [];
  const windows = [];
  let start = 0;
  while (start < paragraphs.length) {
    let end = start;
    let chars = 0;
    while (end < paragraphs.length) {
      const nextChars = chars + paragraphs[end].text.length;
      if (end > start && (end - start >= maxParagraphs || nextChars > maxChars)) break;
      chars = nextChars;
      end += 1;
    }
    windows.push({ index: windows.length + 1, paragraphs: paragraphs.slice(start, end) });
    if (end >= paragraphs.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return windows;
}

export function modelParagraph(paragraph) {
  return {
    paragraphId: paragraph.paragraphId,
    paragraphIndex: paragraph.paragraphIndex,
    text: paragraph.text,
    sentences: paragraph.sentences.map(({ sentenceId, sentenceIndex, start, end, text }) => ({ sentenceId, sentenceIndex, start, end, text })),
  };
}

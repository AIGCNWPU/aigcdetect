import { createHash } from 'node:crypto';
import { NotImplementedError } from '../../server/errors.js';
import { createTextModelClient } from './model-client.js';
import { createEgteClient } from './egte-client.js';
import { aggregateAiFindings, classifyAiScore, contentCharacterCount, normalizeAiThresholds } from './ai-aggregation.js';
import { createAiScoringSegments, splitAiSentences } from './ai-segmentation.js';
import { sanitizeNewsNovelAiText } from './news-novel-ai-input.js';
import { matchNovelPlatformUrl, normalizeNovelPlatform, novelPlatformPolicies } from './novel-platforms.js';
import { TextAnalysisError } from './text-analysis-error.js';
import { createParagraphWindows, modelParagraph, segmentText } from './segmentation.js';

const NEWS_CHECKS = new Set(['proofreading', 'ai-risk']);
const NOVEL_CHECKS = new Set(['repetition', 'padding', 'ai-risk']);
const SEVERITIES = new Set(['info', 'warning', 'error']);
const MAX_NEWS_CHARS = 50_000;
const MAX_CHAPTER_CHARS = 100_000;
const MAX_NOVEL_CHARS = 300_000;
const MAX_CHAPTERS = 20;
const MAX_AI_SEGMENTS = 10_000;
const MAX_REWRITE_FRAGMENTS = 200;
const MAX_REWRITE_OUTPUT_CHARS = 12_000;
const CHECK_LABELS = Object.freeze({
  proofreading: '三审三校',
  'ai-risk': '疑似AI风险检测',
  repetition: '重复检测',
  padding: '水稿检测',
});
const NEWS_PROOFREADING_STAGES = Object.freeze([
  {
    id: 'initial-review',
    name: '初审',
    category: 'review',
    objective: '核查稿件选题、基本新闻要素、表述边界与明显内容风险。',
    checks: ['主题与标题是否相符', '基本新闻要素是否完整', '是否存在明显事实内在矛盾', '是否存在不当或缺乏依据的表述'],
  },
  {
    id: 'secondary-review',
    name: '复审',
    category: 'review',
    objective: '复核稿件结构、论述逻辑、上下文衔接与全文一致性。',
    checks: ['标题、导语与正文是否一致', '段落结构与信息层次', '时间、人物、机构和事件是否前后一致', '论述是否存在跳跃或歧义'],
  },
  {
    id: 'final-review',
    name: '终审',
    category: 'review',
    objective: '从发布前把关角度检查残余内容风险和结论表达是否审慎。',
    checks: ['关键结论是否有原文支撑', '措辞是否客观审慎', '是否仍有影响发布的明显遗漏', '稿件整体是否存在残余冲突'],
  },
  {
    id: 'first-proof',
    name: '一校',
    category: 'proofreading',
    objective: '逐段检查基础文字质量，发现错别字、病句、搭配和用词问题。',
    checks: ['错别字和漏字赘字', '语法与句式', '词语搭配', '表达是否通顺准确'],
  },
  {
    id: 'second-proof',
    name: '二校',
    category: 'proofreading',
    objective: '复核专名、数字、时间、单位和术语的规范性与一致性。',
    checks: ['人物与机构名称', '数字、日期和时间', '计量单位与专有名词', '同一术语前后写法'],
  },
  {
    id: 'third-proof',
    name: '三校',
    category: 'proofreading',
    objective: '进行发布前文字清样检查，清除标点、格式和残余文字错误。',
    checks: ['标点符号', '引号、括号和书名号配对', '段落及格式一致性', '前两校可能遗漏的文字问题'],
  },
]);

function analysisError(condition, code, message, status = 400) {
  if (!condition) throw new TextAnalysisError(code, message, status);
}

function cleanString(value, maxLength = 500) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function selectedChecks(payload) {
  analysisError(Array.isArray(payload?.checks), 'INVALID_REQUEST', 'checks 必须是数组。');
  return [...new Set(payload.checks.filter(value => typeof value === 'string'))];
}

function splitChecks(checks, supported) {
  return { supported: checks.filter(check => supported.has(check)), unsupported: checks.filter(check => !supported.has(check)) };
}

function completionForChecks(checks) {
  const incompleteServices = checks.unsupported.map(check => ({
    id: cleanString(check, 80) || 'unknown',
    label: CHECK_LABELS[check] || cleanString(check, 80) || '未知检测项目',
    reason: '当前版本不支持该检测项目，因此未执行。',
  }));
  return { status: incompleteServices.length ? 'partial' : 'completed', incompleteServices };
}

function contentHash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function validateRewriteFragments(chapter, rawFragments) {
  analysisError(Array.isArray(rawFragments) && rawFragments.length, 'NO_REWRITE_FRAGMENTS', `章节“${chapter.title}”没有可改写的AI风险片段。`, 422);
  analysisError(rawFragments.length <= MAX_REWRITE_FRAGMENTS, 'TOO_MANY_REWRITE_FRAGMENTS', `单章最多提交 ${MAX_REWRITE_FRAGMENTS} 个改写片段。`, 413);
  const ids = new Set();
  let previousEnd = -1;
  return rawFragments.map((item, offset) => {
    const fragmentId = cleanString(item?.fragmentId, 120) || `${chapter.chapterId}-fragment-${offset + 1}`;
    const start = Number(item?.start), end = Number(item?.end);
    const before = typeof item?.text === 'string' ? item.text : '';
    const label = cleanString(item?.label, 40);
    analysisError(!ids.has(fragmentId), 'INVALID_REWRITE_FRAGMENTS', '改写片段编号不能重复。', 422);
    analysisError(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= chapter.content.length, 'INVALID_REWRITE_FRAGMENTS', '改写片段位置超出章节原文范围。', 422);
    analysisError(start >= previousEnd, 'INVALID_REWRITE_FRAGMENTS', '改写片段必须按原文顺序且不能重叠。', 422);
    analysisError(chapter.content.slice(start, end) === before, 'STALE_REWRITE_SOURCE', '改写片段与当前章节原文不一致，请重新检测。', 409);
    analysisError(['ai', 'suspected-ai'].includes(label), 'INVALID_REWRITE_FRAGMENTS', '仅AI或疑似AI片段可生成改写建议。', 422);
    ids.add(fragmentId);
    previousEnd = end;
    return {
      fragmentId,
      chapterId: chapter.chapterId,
      chapter: chapter.title,
      start,
      end,
      before,
      label,
      contextBefore: chapter.content.slice(Math.max(0, start - 300), start),
      contextAfter: chapter.content.slice(end, Math.min(chapter.content.length, end + 300)),
    };
  });
}

function normalizeRewriteFindings(output, fragments) {
  const values = Array.isArray(output?.findings) ? output.findings : [];
  analysisError(values.length === fragments.length, 'MODEL_RESPONSE_INVALID', '模型返回的改写建议数量与请求片段不一致。', 502);
  const byId = new Map(fragments.map(item => [item.fragmentId, item]));
  const seen = new Set();
  return values.map(item => {
    const fragmentId = cleanString(item?.fragmentId, 120);
    const source = byId.get(fragmentId);
    const after = typeof item?.after === 'string' ? item.after.trim() : '';
    analysisError(source && !seen.has(fragmentId), 'MODEL_RESPONSE_INVALID', '模型返回了未知或重复的改写片段。', 502);
    analysisError(after && after.length <= MAX_REWRITE_OUTPUT_CHARS, 'MODEL_RESPONSE_INVALID', '模型返回的改写文本为空或过长。', 502);
    seen.add(fragmentId);
    return {
      proposalId: `rewrite-${fragmentId}`,
      fragmentId,
      chapterId: source.chapterId,
      chapter: source.chapter,
      start: source.start,
      end: source.end,
      before: source.before,
      after,
      reason: cleanString(item?.reason, 300) || '调整机械表达并保留原意与叙事关系。',
      label: source.label,
    };
  });
}

async function rewriteNovel(payload, context) {
  const workTitle = cleanString(payload?.work?.title, 120);
  analysisError(workTitle, 'INVALID_REQUEST', '请提供作品名称。');
  analysisError(Array.isArray(payload?.chapters) && payload.chapters.length > 0, 'INVALID_REQUEST', '请至少提交一个章节。');
  analysisError(payload.chapters.length <= MAX_CHAPTERS, 'TOO_MANY_CHAPTERS', `一次最多改写 ${MAX_CHAPTERS} 个章节。`, 413);
  let totalChars = 0;
  const chapters = payload.chapters.map((item, offset) => {
    const chapterId = cleanString(item?.localId, 80) || `chapter-${offset + 1}`;
    const title = cleanString(item?.title, 120);
    const content = typeof item?.content === 'string' ? item.content : '';
    analysisError(title && content.trim(), 'INVALID_REQUEST', `第 ${offset + 1} 个章节缺少标题或正文。`);
    analysisError(content.length <= MAX_CHAPTER_CHARS, 'CONTENT_TOO_LARGE', `章节“${title}”不能超过 ${MAX_CHAPTER_CHARS} 字。`, 413);
    analysisError(cleanString(item?.contentHash, 80) === contentHash(content), 'STALE_REWRITE_SOURCE', `章节“${title}”已修改，请重新检测后再生成建议。`, 409);
    totalChars += content.length;
    return { chapterId, title, content, version: Number(item?.version) || 1, rawFragments: item?.fragments };
  });
  analysisError(totalChars <= MAX_NOVEL_CHARS, 'CONTENT_TOO_LARGE', `单次小说改写正文总量不能超过 ${MAX_NOVEL_CHARS} 字。`, 413);
  const fragments = chapters.flatMap(chapter => validateRewriteFragments(chapter, chapter.rawFragments));
  analysisError(fragments.length, 'NO_REWRITE_FRAGMENTS', '没有可改写的AI风险片段。', 422);
  const modelClient = context.modelClient || createTextModelClient();
  const output = await modelClient.analyze({
    task: 'novel_rewrite',
    requestId: context.requestId,
    payload: {
      workTitle,
      chapters: chapters.map(({ chapterId, title, version }) => ({ chapterId, title, version })),
      fragments: fragments.map(({ fragmentId, chapterId, chapter, before, label, contextBefore, contextAfter }) => ({ fragmentId, chapterId, chapter, before, label, contextBefore, contextAfter })),
    },
  });
  return {
    status: 'completed',
    workTitle,
    chapters: chapters.map(chapter => ({ chapterId: chapter.chapterId, chapter: chapter.title, version: chapter.version, contentHash: contentHash(chapter.content) })),
    proposals: normalizeRewriteFindings(output, fragments),
    notice: '改写建议需人工核对；系统不保证修改后检测分数下降。',
  };
}

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : undefined;
}

function classifierFor(language) {
  return language === 'en' ? 'raid' : 'cred';
}

function validateAiSegments(content, rawSegments, prefix, { mergeSingleSentenceParagraphs = false } = {}) {
  const submittedSegments = Array.isArray(rawSegments) && rawSegments.length
    ? rawSegments
    : createAiScoringSegments(content, { prefix, mergeSingleSentenceParagraphs });
  analysisError(submittedSegments.length, 'INVALID_AI_SEGMENTS', '正文没有可用于疑似AI检测的句级片段。', 422);
  analysisError(submittedSegments.length <= MAX_AI_SEGMENTS, 'TOO_MANY_AI_SEGMENTS', `单次最多提交 ${MAX_AI_SEGMENTS} 个句级片段。`, 413);
  const sourceSentences = splitAiSentences(content, { prefix: `${prefix}-verify` });
  let previousEnd = -1;
  let previousSentenceIndex = 0;
  const ids = new Set();
  const segments = submittedSegments.map((item, offset) => {
    const segmentId = cleanString(item?.segmentId, 100) || `${prefix}-${offset + 1}`;
    const sentenceIndex = Number(item?.sentenceIndex);
    const sentenceIndexes = Array.isArray(item?.sentenceIndexes) ? item.sentenceIndexes.map(Number) : [sentenceIndex];
    const start = Number(item?.start), end = Number(item?.end);
    const text = typeof item?.text === 'string' ? item.text : '';
    const expectedSentences = sentenceIndexes.map(index => sourceSentences[index - 1]);
    analysisError(!ids.has(segmentId), 'INVALID_AI_SEGMENTS', '句级片段编号不能重复。', 422);
    analysisError(sentenceIndexes.length >= 1 && sentenceIndexes.length <= 2, 'INVALID_AI_SEGMENTS', '每个评分片段只能包含一至两句。', 422);
    analysisError(sentenceIndexes.every((index, position) => Number.isInteger(index) && index === previousSentenceIndex + position + 1), 'INVALID_AI_SEGMENTS', '句子编号必须按原文连续排列且不能遗漏。', 422);
    analysisError(sentenceIndex === sentenceIndexes[0], 'INVALID_AI_SEGMENTS', '片段首句编号与句子范围不一致。', 422);
    analysisError(expectedSentences.every(Boolean), 'INVALID_AI_SEGMENTS', '句子编号超出原文范围。', 422);
    const paragraphIndexes = [...new Set(expectedSentences.map(value => value.paragraphIndex))];
    const crossesAdjacentParagraphs = paragraphIndexes.length === 2
      && paragraphIndexes[1] === paragraphIndexes[0] + 1
      && expectedSentences.length === 2
      && sourceSentences.filter(value => paragraphIndexes.includes(value.paragraphIndex)).length === 2
      && !/\S/u.test(content.slice(expectedSentences[0].end, expectedSentences[1].start));
    analysisError(paragraphIndexes.length === 1 || (mergeSingleSentenceParagraphs && crossesAdjacentParagraphs), 'INVALID_AI_SEGMENTS', mergeSingleSentenceParagraphs ? '短句只能与同段相邻句或相邻的两个单句短段合并。' : '短句只能与同一段落内的相邻句合并。', 422);
    analysisError(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= content.length, 'INVALID_AI_SEGMENTS', '句级片段位置超出原文范围。', 422);
    analysisError(start >= previousEnd, 'INVALID_AI_SEGMENTS', '句级片段必须按原文顺序且不能重叠。', 422);
    analysisError(start === expectedSentences[0].start && end === expectedSentences.at(-1).end, 'INVALID_AI_SEGMENTS', '句级片段位置与原文分句不一致。', 422);
    analysisError(content.slice(start, end) === text, 'INVALID_AI_SEGMENTS', '句级片段原文与位置不一致。', 422);
    ids.add(segmentId);
    previousEnd = end;
    previousSentenceIndex = sentenceIndexes.at(-1);
    return { segmentId, sentenceIndex, sentenceIndexes, sentenceCount: sentenceIndexes.length, merged: sentenceIndexes.length > 1, paragraphIndex: expectedSentences[0].paragraphIndex, paragraphIndexes, start, end, text };
  });
  analysisError(previousSentenceIndex === sourceSentences.length, 'INVALID_AI_SEGMENTS', '句级片段必须覆盖全部原文句子。', 422);
  return segments;
}

async function analyzeAiSegments({ content, rawSegments, prefix, language, chapterId, chapter }, context) {
  const segments = validateAiSegments(content, rawSegments, prefix, { mergeSingleSentenceParagraphs: Boolean(chapterId) });
  const classifier = classifierFor(language);
  const detector = context.egteClient || createEgteClient();
  const modelVersion = cleanString(detector.modelVersion, 160) || 'EGTE_CRED_RAID_20261023';
  const thresholds = normalizeAiThresholds(detector.thresholds);
  const prepared = segments.map(segment => ({ segment, sanitization: sanitizeNewsNovelAiText(segment.text) }));
  const scoreable = prepared.filter(item => !item.sanitization.changed || item.sanitization.sanitizedCharacters >= 20);
  const rawResults = scoreable.length
    ? await detector.analyze({ classifier, segments: scoreable.map(({ segment, sanitization }) => ({ segmentId: segment.segmentId, text: sanitization.text })) })
    : [];
  const byId = new Map((Array.isArray(rawResults) ? rawResults : []).map(item => [item?.segmentId, item]));
  const sanitizationById = new Map(prepared.map(item => [item.segment.segmentId, item.sanitization]));
  const findings = segments.map(segment => {
    const sanitization = sanitizationById.get(segment.segmentId);
    const result = byId.get(segment.segmentId) || (sanitization.changed && sanitization.sanitizedCharacters < 20 ? {
      status: 'too-short',
      reason: sanitization.changed ? '移除异常或不可见字符后少于20个字符，无法可靠评分。' : '去除首尾空白后少于20个字符，无法可靠评分。',
    } : {});
    const score = Number(result.aiScore);
    const label = Number(result.predictedLabel);
    const success = result.status === 'success' && Number.isFinite(score) && (label === 0 || label === 1);
    const reason = !success && result.status === 'too-short' && sanitization.changed
      ? cleanString(result.reason, 300) || '移除异常或不可见字符后少于20个字符，无法可靠评分。'
      : !success && result.status === 'too-short' && segment.sentenceCount > 1
      ? '相邻两句合并后仍少于20个字符，无法评分。'
      : cleanString(result.reason, 300) || '该片段未返回有效评分。';
    const aiScore = success ? Math.max(0, Math.min(1, score)) : null;
    const classified = classifyAiScore(aiScore, thresholds);
    return {
      ...segment,
      ...(chapterId ? { chapterId, chapter } : {}),
      classifier,
      status: success ? 'success' : cleanString(result.status, 40) || 'failed',
      reason: success ? '' : reason,
      documentTokens: Number.isInteger(result.documentTokens) ? result.documentTokens : null,
      aiScore,
      predictedLabel: success ? label : null,
      isAiGenerated: success ? classified.label !== 'human' : null,
      label: classified.label,
      labelZh: classified.labelZh,
      characterCount: contentCharacterCount(segment.text),
      ...(sanitization.changed ? { inputSanitization: {
        removedCharacters: sanitization.removedCharacters,
        originalCharacters: sanitization.originalCharacters,
        sanitizedCharacters: sanitization.sanitizedCharacters,
        categories: sanitization.categories,
      } } : {}),
      modelVersion,
      thresholds,
    };
  });
  const scored = findings.filter(item => item.status === 'success');
  return { classifier, content, chapterId, chapter, findings, scored: scored.length, partial: scored.length !== findings.length };
}

function aiRiskResult(parts, { includeChapterResults = true } = {}) {
  const findings = parts.flatMap(item => item.findings);
  const sentenceCount = findings.reduce((sum, item) => sum + item.sentenceCount, 0);
  const scored = parts.reduce((sum, item) => sum + item.scored, 0);
  const unscored = findings.length - scored;
  const partial = parts.some(item => item.partial);
  const aggregation = aggregateAiFindings(parts);
  const sanitized = findings.filter(item => item.inputSanitization);
  const removedCharacters = sanitized.reduce((sum, item) => sum + item.inputSanitization.removedCharacters, 0);
  const labelCounts = findings.reduce((counts, item) => {
    if (item.label === 'human') counts.human += 1;
    else if (item.label === 'suspected-ai') counts.suspectedAi += 1;
    else if (item.label === 'ai') counts.ai += 1;
    return counts;
  }, { human: 0, suspectedAi: 0, ai: 0 });
  const units = sentenceCount === findings.length ? `${sentenceCount} 句` : `${sentenceCount} 句，组成 ${findings.length} 个检测片段`;
  const result = {
    status: partial ? 'partial' : 'completed',
    summary: `共 ${units}，成功评分 ${scored} 个${unscored ? `，无法评分 ${unscored} 个` : ''}；人工 ${labelCounts.human} 个、疑似AI ${labelCounts.suspectedAi} 个、AI ${labelCounts.ai} 个，${scored ? `全文判定为“${aggregation.distribution.composition}”` : '全文无法判定'}。`,
    notice: `AI类得分是随机森林的未校准分数，不是确定概率，也不表示句中AI内容占比；两句或相邻单句短段合并时，得分属于整体片段，不能归因到其中某一句或某一段。${sanitized.length ? ` 检测前已对 ${sanitized.length} 个片段的算法输入副本进行异常字符清理或Unicode规范化${removedCharacters ? `，移除 ${removedCharacters} 个风险字符` : ''}；展示原文及位置未改变。` : ''}`,
    findings,
    ...aggregation,
  };
  if (includeChapterResults && parts.some(part => part.chapterId)) {
    result.chapterResults = parts.map(part => ({
      chapterId: part.chapterId,
      chapter: part.chapter,
      ...aiRiskResult([part], { includeChapterResults: false }),
    }));
  }
  return result;
}

function locateQuote(paragraph, finding) {
  const quote = cleanString(finding?.quote, 500);
  if (quote) {
    const suggested = Number(finding?.start);
    const start = Number.isInteger(suggested) && paragraph.text.slice(suggested, suggested + quote.length) === quote ? suggested : paragraph.text.indexOf(quote);
    if (start >= 0) return { start, end: start + quote.length, quote };
  }
  const start = Number(finding?.start), end = Number(finding?.end);
  if (Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= paragraph.text.length) return { start, end, quote: paragraph.text.slice(start, end) };
  return null;
}

function sentenceAt(paragraph, start, end) {
  return paragraph.sentences.find(sentence => sentence.start <= start && sentence.end >= end)?.sentenceId;
}

function normalizeNewsFinding(finding, paragraphs) {
  const paragraph = paragraphs.get(finding?.paragraphId);
  if (!paragraph) return null;
  const range = locateQuote(paragraph, finding);
  const message = cleanString(finding?.message, 600);
  if (!range || !message) return null;
  return {
    type: cleanString(finding?.type, 80) || 'proofreading',
    severity: SEVERITIES.has(finding?.severity) ? finding.severity : 'warning',
    message,
    suggestion: cleanString(finding?.suggestion, 600),
    confidence: confidence(finding?.confidence),
    location: `第${paragraph.paragraphIndex}段`,
    position: {
      paragraphId: paragraph.paragraphId,
      paragraphIndex: paragraph.paragraphIndex,
      sentenceId: sentenceAt(paragraph, range.start, range.end),
      start: range.start,
      end: range.end,
      absoluteStart: paragraph.start + range.start,
      absoluteEnd: paragraph.start + range.end,
      quote: range.quote,
    },
    originalText: range.quote,
  };
}

function normalizeNovelFinding(finding, paragraphs) {
  if (!Array.isArray(finding?.evidence) || !finding.evidence.length) return null;
  const references = finding.evidence.map(item => {
    const paragraph = paragraphs.get(item?.paragraphId);
    if (!paragraph) return null;
    const range = locateQuote(paragraph, item);
    if (!range) return null;
    return { chapterId: paragraph.chapterId, chapter: paragraph.chapter, paragraphId: paragraph.paragraphId, paragraphIndex: paragraph.paragraphIndex, start: range.start, end: range.end, quote: range.quote };
  }).filter(Boolean);
  const message = cleanString(finding?.message, 600);
  if (!references.length || !message) return null;
  const primary = references[0];
  return {
    type: ['repetition', 'padding'].includes(finding?.type) ? finding.type : 'padding',
    severity: SEVERITIES.has(finding?.severity) ? finding.severity : 'warning',
    message,
    suggestion: cleanString(finding?.suggestion, 600),
    confidence: confidence(finding?.confidence),
    chapter: primary.chapter,
    location: `第${primary.paragraphIndex}段`,
    references,
    originalText: primary.quote,
  };
}

function deduplicate(findings, keyOf) {
  const seen = new Set();
  return findings.filter(finding => {
    const key = keyOf(finding);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function newsIssueKey(item) {
  return `${item.type}:${item.position.paragraphId}:${item.position.start}:${item.message}`;
}

function mergeProofreadingIssues(stages) {
  const merged = new Map();
  for (const stage of stages) {
    for (const issue of stage.issues) {
      const key = newsIssueKey(issue);
      const stageReference = { id: stage.id, name: stage.name };
      const existing = merged.get(key);
      if (existing) existing.stages.push(stageReference);
      else merged.set(key, { ...issue, stages: [stageReference] });
    }
  }
  return [...merged.values()];
}

function validateModelFindings(outputs, normalize, accept = () => true) {
  const received = outputs.flatMap(output => Array.isArray(output?.findings) ? output.findings : []);
  const normalized = received.map(normalize);
  const valid = normalized.filter(Boolean);
  const findings = valid.filter(accept);
  const rejectedFindings = received.length - valid.length;
  return {
    findings,
    evidenceValidation: {
      receivedFindings: received.length,
      acceptedFindings: findings.length,
      rejectedFindings,
      status: rejectedFindings ? 'partial' : 'completed',
    },
  };
}

function recordEvidenceAudit(context, scenario, evidenceValidation) {
  if (!evidenceValidation.rejectedFindings) return;
  const event = {
    event: 'text_model_evidence_rejected',
    scenario,
    requestId: cleanString(context?.requestId, 120) || 'unknown',
    receivedFindings: evidenceValidation.receivedFindings,
    acceptedFindings: evidenceValidation.acceptedFindings,
    rejectedFindings: evidenceValidation.rejectedFindings,
  };
  const logger = context?.logger || console;
  if (typeof logger.warn === 'function') logger.warn(JSON.stringify(event));
}

async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

function exactNovelRepetitions(paragraphs) {
  const firstByText = new Map();
  const findings = [];
  for (const paragraph of paragraphs.values()) {
    const normalized = paragraph.text.replace(/[\s\p{P}\p{S}]/gu, '').toLocaleLowerCase('zh-CN');
    if (normalized.length < 20) continue;
    const first = firstByText.get(normalized);
    if (!first) { firstByText.set(normalized, paragraph); continue; }
    findings.push({
      type: 'repetition',
      severity: 'warning',
      confidence: 1,
      message: first.chapterId === paragraph.chapterId ? '该段与本章前文完全重复。' : '该段与已同时送检的其他章节内容完全重复。',
      suggestion: '核对是否为必要回顾；若没有新增信息，建议删除或压缩。',
      chapter: paragraph.chapter,
      location: `第${paragraph.paragraphIndex}段`,
      originalText: paragraph.text.slice(0, 160),
      references: [first, paragraph].map(item => ({ chapterId: item.chapterId, chapter: item.chapter, paragraphId: item.paragraphId, paragraphIndex: item.paragraphIndex, start: 0, end: Math.min(160, item.text.length), quote: item.text.slice(0, 160) })),
    });
  }
  return findings;
}

async function analyzeNews(payload, context) {
  analysisError(payload?.action === 'analyze', 'INVALID_REQUEST', 'action 必须为 analyze。');
  const title = cleanString(payload?.material?.title, 120);
  const content = typeof payload?.material?.content === 'string' ? payload.material.content : '';
  analysisError(title, 'INVALID_REQUEST', '请提供稿件标题。');
  analysisError(content.trim(), 'INVALID_REQUEST', '当前版本仅支持直接提交正文；文档解析尚未接入。');
  analysisError(content.length <= MAX_NEWS_CHARS, 'CONTENT_TOO_LARGE', `新闻正文不能超过 ${MAX_NEWS_CHARS} 字。`, 413);
  const checks = splitChecks(selectedChecks(payload), NEWS_CHECKS);
  analysisError(checks.supported.length, 'UNSUPPORTED_CHECK', '当前仅支持三审三校与句级疑似AI检测。', 422);

  const paragraphs = segmentText(content, { prefix: 'news-p', virtualParagraphChars: 700 });
  analysisError(paragraphs.length, 'INVALID_REQUEST', '正文没有可分析的段落。');
  const paragraphMap = new Map(paragraphs.map(item => [item.paragraphId, item]));
  const windows = createParagraphWindows(paragraphs, { maxChars: 6_000, maxParagraphs: 20, overlap: 1 });
  const aiTask = checks.supported.includes('ai-risk')
    ? analyzeAiSegments({ content, rawSegments: payload?.material?.aiSegments, prefix: 'news-s', language: payload?.material?.language }, context)
      .then(value => ({ value }), error => ({ error }))
    : Promise.resolve({ value: undefined });
  let proofreading;
  if (checks.supported.includes('proofreading')) {
    const modelClient = context.modelClient || createTextModelClient();
    const calls = NEWS_PROOFREADING_STAGES.flatMap(stage => windows.map(window => ({ stage, window })));
    const outputs = await mapWithConcurrency(calls, 2, ({ stage, window }) => modelClient.analyze({
      task: 'news_review',
      requestId: context.requestId,
      payload: {
        title,
        window: window.index,
        reviewStage: { id: stage.id, name: stage.name, category: stage.category, objective: stage.objective, checks: stage.checks },
        paragraphs: window.paragraphs.map(modelParagraph),
      },
    }));
    const stages = NEWS_PROOFREADING_STAGES.map(stage => {
      const stageOutputs = outputs.filter((_output, index) => calls[index].stage.id === stage.id);
      const validated = validateModelFindings(stageOutputs, item => normalizeNewsFinding(item, paragraphMap));
      const issues = deduplicate(validated.findings, newsIssueKey).map(item => ({ ...item, stageId: stage.id, stageName: stage.name }));
      return {
        id: stage.id,
        name: stage.name,
        category: stage.category,
        status: 'completed',
        objective: stage.objective,
        checks: stage.checks,
        summary: issues.length ? `完成 ${windows.length} 个检测窗口，发现 ${issues.length} 条需复核问题。` : `完成 ${windows.length} 个检测窗口，未发现有明确原文证据的问题。`,
        findingCount: issues.length,
        coverage: { paragraphs: paragraphs.length, windows: windows.length },
        issues,
        evidenceValidation: validated.evidenceValidation,
      };
    });
    const evidenceValidation = stages.reduce((total, stage) => ({
      receivedFindings: total.receivedFindings + stage.evidenceValidation.receivedFindings,
      acceptedFindings: total.acceptedFindings + stage.evidenceValidation.acceptedFindings,
      rejectedFindings: total.rejectedFindings + stage.evidenceValidation.rejectedFindings,
    }), { receivedFindings: 0, acceptedFindings: 0, rejectedFindings: 0 });
    recordEvidenceAudit(context, 'news', evidenceValidation);
    const publicStages = stages.map(({ evidenceValidation: _internal, ...stage }) => stage);
    const issues = mergeProofreadingIssues(publicStages);
    proofreading = {
      summary: issues.length
        ? `三审三校 6 个阶段均已完成，共发现 ${issues.length} 条去重后的需复核问题。`
        : '三审三校 6 个阶段均已完成，未发现有明确原文证据的问题。',
      completedStages: publicStages.length,
      totalStages: NEWS_PROOFREADING_STAGES.length,
      stages: publicStages,
      issues,
    };
  }
  const aiOutcome = await aiTask;
  if (aiOutcome.error) throw aiOutcome.error;
  const aiRisk = aiOutcome.value ? aiRiskResult([aiOutcome.value]) : undefined;
  const limitedSource = payload?.material?.source?.completeness === 'partial';
  return {
    ...completionForChecks(checks),
    contentHash: contentHash(`${title}\n${content}`),
    coverage: { paragraphs: paragraphs.length, windows: windows.length, complete: !limitedSource, notice: limitedSource ? '仅检测已导入内容，不代表原网页全文。' : '' },
    notRunChecks: checks.unsupported,
    ...(aiRisk ? { aiRisk } : {}),
    ...(proofreading ? { proofreading } : {}),
  };
}

async function analyzeNovel(payload, context) {
  analysisError(payload?.action === 'analyze', 'INVALID_REQUEST', 'action 必须为 analyze。');
  const workTitle = cleanString(payload?.work?.title, 120);
  analysisError(workTitle, 'INVALID_REQUEST', '请提供作品名称。');
  analysisError(Array.isArray(payload?.chapters) && payload.chapters.length > 0, 'INVALID_REQUEST', '请至少提交一个章节。');
  analysisError(payload.chapters.length <= MAX_CHAPTERS, 'TOO_MANY_CHAPTERS', `一次最多检测 ${MAX_CHAPTERS} 个章节。`, 413);
  const checks = splitChecks(selectedChecks(payload), NOVEL_CHECKS);
  analysisError(checks.supported.length, 'UNSUPPORTED_CHECK', '当前仅支持重复/水稿与句级疑似AI检测。', 422);

  let totalChars = 0;
  const chapters = payload.chapters.map((chapter, chapterOffset) => {
    const chapterId = cleanString(chapter?.localId, 80) || `chapter-${chapterOffset + 1}`;
    const title = cleanString(chapter?.title, 120);
    const content = typeof chapter?.content === 'string' ? chapter.content : '';
    analysisError(title && content.trim(), 'INVALID_REQUEST', `第 ${chapterOffset + 1} 个章节缺少标题或正文。`);
    analysisError(content.length <= MAX_CHAPTER_CHARS, 'CONTENT_TOO_LARGE', `章节“${title}”不能超过 ${MAX_CHAPTER_CHARS} 字。`, 413);
    totalChars += content.length;
    const paragraphs = segmentText(content, { prefix: `c${chapterOffset + 1}-p`, virtualParagraphChars: 900 }).map(paragraph => ({ ...paragraph, chapterId, chapter: title }));
    const declaredPlatform = normalizeNovelPlatform(chapter?.platform || chapter?.source?.site);
    const platform = declaredPlatform.id === 'unknown' ? matchNovelPlatformUrl(chapter?.source?.finalUrl || chapter?.source?.url).id : declaredPlatform.id;
    return { chapterId, title, content, platform, source: chapter.source, language: chapter.language || payload?.work?.language, aiSegments: chapter.aiSegments, paragraphs };
  });
  analysisError(totalChars <= MAX_NOVEL_CHARS, 'CONTENT_TOO_LARGE', `单次小说检测正文总量不能超过 ${MAX_NOVEL_CHARS} 字。`, 413);

  const allParagraphs = chapters.flatMap(chapter => chapter.paragraphs);
  const paragraphMap = new Map(allParagraphs.map(item => [item.paragraphId, item]));
  const calls = createParagraphWindows(allParagraphs, { maxChars: 8_000, maxParagraphs: 40, overlap: 2 });
  const aiTask = checks.supported.includes('ai-risk')
    ? mapWithConcurrency(chapters, 1, chapter => analyzeAiSegments({ content: chapter.content, rawSegments: chapter.aiSegments, prefix: `${chapter.chapterId}-s`, language: chapter.language, chapterId: chapter.chapterId, chapter: chapter.title }, context))
      .then(value => ({ value }), error => ({ error }))
    : Promise.resolve({ value: undefined });
  const qualityChecks = checks.supported.filter(check => check !== 'ai-risk');
  const outputs = [];
  if (qualityChecks.length) {
    const modelClient = context.modelClient || createTextModelClient();
    outputs.push(...await mapWithConcurrency(calls, 2, window => {
      const windowChapters = [...new Map(window.paragraphs.map(paragraph => [paragraph.chapterId, { chapterId: paragraph.chapterId, chapter: paragraph.chapter }])).values()];
      return modelClient.analyze({
        task: 'novel_quality',
        requestId: context.requestId,
        payload: {
          workTitle,
          window: window.index,
          chapters: windowChapters,
          paragraphs: window.paragraphs.map(paragraph => ({ ...modelParagraph(paragraph), chapterId: paragraph.chapterId, chapter: paragraph.chapter })),
        },
      });
    }));
  }
  const validated = validateModelFindings(outputs, item => normalizeNovelFinding(item, paragraphMap), item => checks.supported.includes(item.type));
  recordEvidenceAudit(context, 'novel', validated.evidenceValidation);
  const modelFindings = validated.findings;
  const exactFindings = checks.supported.includes('repetition') ? exactNovelRepetitions(paragraphMap) : [];
  const findings = deduplicate([...exactFindings, ...modelFindings], item => `${item.type}:${item.references.map(ref => ref.paragraphId).join(',')}:${item.message}`);
  const aiOutcome = await aiTask;
  if (aiOutcome.error) throw aiOutcome.error;
  const aiRisk = aiOutcome.value ? aiRiskResult(aiOutcome.value) : undefined;
  const platforms = chapters.map(chapter => chapter.platform);
  const aiPlatformPolicies = novelPlatformPolicies(platforms, { context: 'ai' });
  const qualityPlatformPolicies = novelPlatformPolicies(platforms, { context: 'quality' });
  if (aiRisk) {
    aiRisk.platformPolicies = aiPlatformPolicies;
    for (const chapterResult of aiRisk.chapterResults || []) {
      const platform = chapters.find(chapter => chapter.chapterId === chapterResult.chapterId)?.platform;
      chapterResult.platformPolicies = novelPlatformPolicies([platform], { context: 'ai' });
    }
  }
  const quality = qualityChecks.length ? {
    summary: findings.length ? `发现 ${findings.length} 条重复或水稿线索。` : '本次检测未发现达到报告阈值的重复或水稿线索。',
    findings,
    platformPolicies: qualityPlatformPolicies,
    chapterResults: chapters.map(chapter => {
      const chapterFindings = findings.filter(finding => (finding.references || []).some(reference => reference.chapterId === chapter.chapterId));
      return {
        chapterId: chapter.chapterId,
        chapter: chapter.title,
        summary: chapterFindings.length ? `本章关联 ${chapterFindings.length} 条重复或水稿线索。` : '本章未发现达到报告阈值的重复或水稿线索。',
        findings: chapterFindings,
        platformPolicies: novelPlatformPolicies([chapter.platform], { context: 'quality' }),
      };
    }),
  } : undefined;
  const limited = chapters.some(chapter => chapter.source && chapter.source.completeness !== 'complete');
  return {
    ...completionForChecks(checks),
    contentHash: contentHash(chapters.map(chapter => `${chapter.chapterId}:${chapter.title}\n${chapter.content}`).join('\n\n')),
    coverage: { chapters: chapters.length, paragraphs: allParagraphs.length, windows: calls.length, complete: !limited, crossChapter: chapters.length > 1 ? 'same-request' : 'not-available', notice: limited ? '仅检测已导入内容，不代表整章或整本。' : chapters.length === 1 ? '本次只提交一章，未执行跨章比较。' : '' },
    notRunChecks: checks.unsupported,
    ...(aiRisk ? { aiRisk } : {}),
    ...(quality ? { quality } : {}),
  };
}

/** 新闻三审三校与小说重复/水稿检测接入点。密钥只由服务端模型客户端读取。 */
export async function runTextScenario(scenario, payload, context = {}) {
  if (scenario.id === 'news') return analyzeNews(payload, context);
  if (scenario.id === 'novel') return payload?.action === 'rewrite' ? rewriteNovel(payload, context) : analyzeNovel(payload, context);
  throw new NotImplementedError(scenario.api.operationId);
}

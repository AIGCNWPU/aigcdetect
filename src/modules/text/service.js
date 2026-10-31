import { createHash } from 'node:crypto';
import { NotImplementedError } from '../../server/errors.js';
import { createTextModelClient } from './model-client.js';
import { createEgteClient } from './egte-client.js';
import { aggregateAiFindings, classifyAiScore, contentCharacterCount, normalizeAiThresholds } from './ai-aggregation.js';
import { splitAiSentences } from './ai-segmentation.js';
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

function confidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : undefined;
}

function classifierFor(language) {
  return language === 'en' ? 'raid' : 'cred';
}

function validateAiSegments(content, rawSegments, prefix) {
  analysisError(Array.isArray(rawSegments) && rawSegments.length, 'INVALID_AI_SEGMENTS', '疑似AI检测需要前端提交句级片段。', 422);
  analysisError(rawSegments.length <= MAX_AI_SEGMENTS, 'TOO_MANY_AI_SEGMENTS', `单次最多提交 ${MAX_AI_SEGMENTS} 个句级片段。`, 413);
  const sourceSentences = splitAiSentences(content, { prefix: `${prefix}-verify` });
  let previousEnd = -1;
  let previousSentenceIndex = 0;
  const ids = new Set();
  const segments = rawSegments.map((item, offset) => {
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
    analysisError(expectedSentences.every(value => value.paragraphIndex === expectedSentences[0].paragraphIndex), 'INVALID_AI_SEGMENTS', '短句只能与同一段落内的相邻句合并。', 422);
    analysisError(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= content.length, 'INVALID_AI_SEGMENTS', '句级片段位置超出原文范围。', 422);
    analysisError(start >= previousEnd, 'INVALID_AI_SEGMENTS', '句级片段必须按原文顺序且不能重叠。', 422);
    analysisError(start === expectedSentences[0].start && end === expectedSentences.at(-1).end, 'INVALID_AI_SEGMENTS', '句级片段位置与原文分句不一致。', 422);
    analysisError(content.slice(start, end) === text, 'INVALID_AI_SEGMENTS', '句级片段原文与位置不一致。', 422);
    ids.add(segmentId);
    previousEnd = end;
    previousSentenceIndex = sentenceIndexes.at(-1);
    return { segmentId, sentenceIndex, sentenceIndexes, sentenceCount: sentenceIndexes.length, merged: sentenceIndexes.length > 1, paragraphIndex: expectedSentences[0].paragraphIndex, start, end, text };
  });
  analysisError(previousSentenceIndex === sourceSentences.length, 'INVALID_AI_SEGMENTS', '句级片段必须覆盖全部原文句子。', 422);
  return segments;
}

async function analyzeAiSegments({ content, rawSegments, prefix, language, chapterId, chapter }, context) {
  const segments = validateAiSegments(content, rawSegments, prefix);
  const classifier = classifierFor(language);
  const detector = context.egteClient || createEgteClient();
  const modelVersion = cleanString(detector.modelVersion, 160) || 'EGTE_CRED_RAID_20261023';
  const thresholds = normalizeAiThresholds(detector.thresholds);
  const rawResults = await detector.analyze({ classifier, segments: segments.map(({ segmentId, text }) => ({ segmentId, text })) });
  const byId = new Map((Array.isArray(rawResults) ? rawResults : []).map(item => [item?.segmentId, item]));
  const findings = segments.map(segment => {
    const result = byId.get(segment.segmentId) || {};
    const score = Number(result.aiScore);
    const label = Number(result.predictedLabel);
    const success = result.status === 'success' && Number.isFinite(score) && (label === 0 || label === 1);
    const reason = !success && result.status === 'too-short' && segment.sentenceCount > 1
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
      modelVersion,
      thresholds,
    };
  });
  const scored = findings.filter(item => item.status === 'success');
  return { classifier, content, findings, scored: scored.length, partial: scored.length !== findings.length };
}

function aiRiskResult(parts) {
  const findings = parts.flatMap(item => item.findings);
  const sentenceCount = findings.reduce((sum, item) => sum + item.sentenceCount, 0);
  const scored = parts.reduce((sum, item) => sum + item.scored, 0);
  const unscored = findings.length - scored;
  const partial = parts.some(item => item.partial);
  const aggregation = aggregateAiFindings(parts);
  const labelCounts = findings.reduce((counts, item) => {
    if (item.label === 'human') counts.human += 1;
    else if (item.label === 'suspected-ai') counts.suspectedAi += 1;
    else if (item.label === 'ai') counts.ai += 1;
    return counts;
  }, { human: 0, suspectedAi: 0, ai: 0 });
  const units = sentenceCount === findings.length ? `${sentenceCount} 句` : `${sentenceCount} 句，组成 ${findings.length} 个检测片段`;
  return {
    status: partial ? 'partial' : 'completed',
    summary: `共 ${units}，成功评分 ${scored} 个${unscored ? `，无法评分 ${unscored} 个` : ''}；人工 ${labelCounts.human} 个、疑似AI ${labelCounts.suspectedAi} 个、AI ${labelCounts.ai} 个，全文判定为“${aggregation.distribution.composition}”。`,
    notice: 'AI类得分是随机森林的未校准分数，不是确定概率，也不表示句中AI内容占比；两句合并时，得分属于整体片段，不能归因到其中某一句。',
    findings,
    ...aggregation,
  };
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
  const aiRisk = checks.supported.includes('ai-risk') ? aiRiskResult([await analyzeAiSegments({ content, rawSegments: payload?.material?.aiSegments, prefix: 'news-s', language: payload?.material?.language }, context)]) : undefined;
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
  const calls = chapters.flatMap(chapter => createParagraphWindows(chapter.paragraphs, { maxChars: 8_000, maxParagraphs: 40, overlap: 2 }).map(window => ({ chapter, window })));
  const qualityChecks = checks.supported.filter(check => check !== 'ai-risk');
  const outputs = [];
  if (qualityChecks.length) {
    const modelClient = context.modelClient || createTextModelClient();
    outputs.push(...await mapWithConcurrency(calls, 2, ({ chapter, window }) => modelClient.analyze({ task: 'novel_quality', requestId: context.requestId, payload: { workTitle, chapterId: chapter.chapterId, chapter: chapter.title, window: window.index, paragraphs: window.paragraphs.map(modelParagraph) } })));
  }
  const validated = validateModelFindings(outputs, item => normalizeNovelFinding(item, paragraphMap), item => checks.supported.includes(item.type));
  recordEvidenceAudit(context, 'novel', validated.evidenceValidation);
  const modelFindings = validated.findings;
  const exactFindings = checks.supported.includes('repetition') ? exactNovelRepetitions(paragraphMap) : [];
  const findings = deduplicate([...exactFindings, ...modelFindings], item => `${item.type}:${item.references.map(ref => ref.paragraphId).join(',')}:${item.message}`);
  const aiRisk = checks.supported.includes('ai-risk') ? aiRiskResult(await mapWithConcurrency(chapters, 1, chapter => analyzeAiSegments({ content: chapter.content, rawSegments: chapter.aiSegments, prefix: `${chapter.chapterId}-s`, language: chapter.language, chapterId: chapter.chapterId, chapter: chapter.title }, context))) : undefined;
  const platforms = chapters.map(chapter => chapter.platform);
  const aiPlatformPolicies = novelPlatformPolicies(platforms, { context: 'ai' });
  const qualityPlatformPolicies = novelPlatformPolicies(platforms, { context: 'quality' });
  if (aiRisk) aiRisk.platformPolicies = aiPlatformPolicies;
  const quality = qualityChecks.length ? {
    summary: findings.length ? `发现 ${findings.length} 条重复或水稿线索。` : '本次检测未发现达到报告阈值的重复或水稿线索。',
    findings,
    platformPolicies: qualityPlatformPolicies,
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
  if (scenario.id === 'novel') return analyzeNovel(payload, context);
  throw new NotImplementedError(scenario.api.operationId);
}

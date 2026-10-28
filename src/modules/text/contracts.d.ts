import type { ScenarioRequest } from '../../contracts.js';

/** AI文本检测场景请求草案；具体字段由工作包实现时补齐。 */
export type TextScenarioId = 'academic' | 'news' | 'novel';
export type TextRequest = ScenarioRequest;

export type NewsExtractionStatus = 'completed' | 'partial';
export type NewsCompleteness = 'partial' | 'unknown';

export interface NewsArticleImportRequest { url: string }

export interface NewsArticleImportResult {
  sourceUrl: string;
  finalUrl: string;
  siteName: string;
  title: string;
  author: string;
  publishedAt: string;
  content: string;
  extractionStatus: NewsExtractionStatus;
  completeness: NewsCompleteness;
  notice: string;
}

export interface NewsArticleSource {
  url: string;
  finalUrl: string;
  siteName: string;
  author: string;
  publishedAt: string;
  extractionStatus: NewsExtractionStatus;
  completeness: NewsCompleteness;
  notice: string;
  confirmedAt: string;
  userEdited: boolean;
}

export type NovelExtractionStatus = 'completed' | 'partial';
export type NovelCompleteness = 'complete' | 'partial' | 'unknown';

export interface NovelChapterImportRequest { url: string }

export interface NovelChapterImportResult {
  sourceUrl: string;
  finalUrl: string;
  site: 'ciweimao' | 'faloo' | 'zongheng' | 'generic';
  workTitle: string;
  title: string;
  content: string;
  extractionStatus: NovelExtractionStatus;
  completeness: NovelCompleteness;
  notice: string;
}

export interface NovelChapterSource {
  url: string;
  finalUrl: string;
  site: string;
  extractionStatus: NovelExtractionStatus;
  completeness: NovelCompleteness;
  notice: string;
  confirmedAt: string;
  userEdited: boolean;
}

export interface TextPosition {
  paragraphId: string;
  paragraphIndex: number;
  sentenceId?: string;
  start: number;
  end: number;
  absoluteStart?: number;
  absoluteEnd?: number;
  quote: string;
}

export interface AiSentenceSegment {
  segmentId: string;
  sentenceIndex: number;
  sentenceIndexes: number[];
  sentenceCount: 1 | 2;
  merged: boolean;
  paragraphIndex: number;
  start: number;
  end: number;
  text: string;
}

export interface AiSentenceResult extends AiSentenceSegment {
  chapterId?: string;
  chapter?: string;
  classifier: 'cred' | 'raid';
  status: 'success' | 'too-short' | 'unscored' | 'failed';
  reason: string;
  documentTokens: number | null;
  aiScore: number | null;
  predictedLabel: 0 | 1 | null;
  isAiGenerated: boolean | null;
  labelZh: '人工' | '疑似AI' | '无法评分';
}

export interface ProofreadingIssue {
  type: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  suggestion: string;
  confidence?: number;
  location: string;
  position: TextPosition;
  originalText: string;
}

export interface ProofreadingResult {
  summary: string;
  issues: ProofreadingIssue[];
}

export interface NovelQualityResult {
  summary: string;
  findings: Array<Record<string, unknown>>;
}

export interface NewsAnalysisRequest {
  action: 'analyze';
  material: { title: string; content: string; language?: 'zh' | 'en'; aiSegments?: AiSentenceSegment[]; sourceType?: string; source?: NewsArticleSource };
  checks: Array<'proofreading' | 'ai-risk'>;
  revisionNote?: string;
  previousVersion?: number;
}

export interface NovelAnalysisRequest {
  action: 'analyze';
  work: { title: string; language?: 'zh' | 'en' };
  chapters: Array<{ localId: string; title: string; version?: number; content: string; language?: 'zh' | 'en'; aiSegments?: AiSentenceSegment[]; source?: NovelChapterSource }>;
  checks: Array<'repetition' | 'padding' | 'ai-risk'>;
}

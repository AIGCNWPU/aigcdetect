import type { ScenarioRequest } from '../../contracts.js';

/** AI文本检测场景请求草案；具体字段由工作包实现时补齐。 */
export type TextScenarioId = 'academic' | 'news' | 'novel';
export type TextRequest = ScenarioRequest;

export type NewsExtractionStatus = 'completed' | 'partial';
export type NewsCompleteness = 'partial' | 'unknown';
export type HtmlExtractionMethod = 'rules' | 'mineru-html' | 'browser-rendered' | 'browser-rendered-mineru';

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
  extractionMethod?: HtmlExtractionMethod;
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
  extractionMethod?: HtmlExtractionMethod;
  notice: string;
  confirmedAt: string;
  userEdited: boolean;
}

export type NovelExtractionStatus = 'completed' | 'partial';
export type NovelCompleteness = 'complete' | 'partial' | 'unknown';
export type NovelPlatformId = 'ciweimao' | 'faloo' | 'zongheng' | 'fanqie' | 'qidian' | 'qimao' | 'jjwxc' | 'shuqi' | '17k' | 'migu' | 'unknown';

export interface NovelPlatformPolicy {
  platformId: Exclude<NovelPlatformId, 'unknown'>;
  platformName: string;
  title: string;
  url: string;
  summary: string;
  aiSpecific: boolean;
  verifiedOn: string;
}

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
  extractionMethod?: HtmlExtractionMethod;
  notice: string;
}

export interface NovelChapterSource {
  url: string;
  finalUrl: string;
  site: string;
  extractionStatus: NovelExtractionStatus;
  completeness: NovelCompleteness;
  extractionMethod?: HtmlExtractionMethod;
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
  label: 'human' | 'suspected-ai' | 'ai' | 'unscored';
  labelZh: '人工' | '疑似AI' | 'AI' | '无法评分';
  characterCount: number;
  modelVersion: string;
  thresholds: AiAggregationThresholds;
}

export interface AiAggregationThresholds {
  humanMax: number;
  aiMin: number;
  dominanceMin: number;
}

export interface AiAggregatedScore {
  score: number | null;
  characterCount: number;
  label: 'human' | 'suspected-ai' | 'ai' | 'unscored';
  labelZh: '人工' | '疑似AI' | 'AI' | '无法评分';
  modelVersion?: string;
  modelVersions: string[];
  thresholds?: AiAggregationThresholds;
}

export interface AiSuspiciousFragment extends AiAggregatedScore {
  fragmentId: string;
  chapterId?: string;
  chapter?: string;
  paragraphStart: number;
  paragraphEnd: number;
  sentenceIndexes: number[];
  start: number;
  end: number;
  text: string;
}

export interface AiParagraphScore extends AiAggregatedScore {
  chapterId?: string;
  chapter?: string;
  paragraphIndex: number;
  start: number;
  end: number;
}

export interface AiRiskResult {
  status: 'completed' | 'partial';
  summary: string;
  notice: string;
  findings: AiSentenceResult[];
  fragments: AiSuspiciousFragment[];
  paragraphScores: AiParagraphScore[];
  documentScore: AiAggregatedScore;
  distribution: {
    characters: { human: number; ai: number; suspectedAi: number; unscored: number };
    ratios: { human: number; ai: number; suspectedAi: number };
    scoredCharacters: number;
    totalCharacters: number;
    composition: '人工为主' | 'AI为主' | '人机混写';
  };
  platformPolicies?: NovelPlatformPolicy[];
}

export interface IncompleteService {
  id: string;
  label: string;
  reason: string;
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
  stageId?: ProofreadingStageId;
  stageName?: string;
  stages?: Array<{ id: ProofreadingStageId; name: string }>;
}

export type ProofreadingStageId = 'initial-review' | 'secondary-review' | 'final-review' | 'first-proof' | 'second-proof' | 'third-proof';

export interface ProofreadingStage {
  id: ProofreadingStageId;
  name: '初审' | '复审' | '终审' | '一校' | '二校' | '三校';
  category: 'review' | 'proofreading';
  status: 'completed' | 'failed';
  objective: string;
  checks: string[];
  summary: string;
  findingCount: number;
  coverage: { paragraphs: number; windows: number };
  issues: ProofreadingIssue[];
}

export interface ProofreadingResult {
  summary: string;
  completedStages: number;
  totalStages: 6;
  stages: ProofreadingStage[];
  issues: ProofreadingIssue[];
}

export interface NovelQualityResult {
  summary: string;
  findings: Array<Record<string, unknown>>;
  platformPolicies?: NovelPlatformPolicy[];
}

export interface NewsAnalysisRequest {
  action: 'analyze';
  material: { title: string; content: string; language?: 'zh' | 'en'; aiSegments?: AiSentenceSegment[]; sourceType?: string; source?: NewsArticleSource };
  checks: Array<'proofreading' | 'ai-risk'>;
  previousVersion?: number;
}

export interface NovelAnalysisRequest {
  action: 'analyze';
  work: { title: string; language?: 'zh' | 'en' };
  chapters: Array<{ localId: string; title: string; version?: number; content: string; platform?: NovelPlatformId; language?: 'zh' | 'en'; aiSegments?: AiSentenceSegment[]; source?: NovelChapterSource }>;
  checks: Array<'repetition' | 'padding' | 'ai-risk'>;
}

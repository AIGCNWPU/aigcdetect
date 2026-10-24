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

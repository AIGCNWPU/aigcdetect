import type { ScenarioRequest } from '../../contracts.js';

/** AI文本检测场景请求草案；具体字段由工作包实现时补齐。 */
export type TextScenarioId = 'academic' | 'news' | 'novel';
export type TextRequest = ScenarioRequest;

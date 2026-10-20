import type { ScenarioRequest } from '../../contracts.js';

/** AI图片检测场景请求草案；具体字段由工作包实现时补齐。 */
export type ImageScenarioId = 'general' | 'refund' | 'documents';
export type ImageRequest = ScenarioRequest;

import type { ScenarioRequest } from '../../contracts.js';

/** AI视频检测场景请求草案；具体字段由工作包实现时补齐。 */
export type VideoScenarioId = 'general' | 'deepfake' | 'aftersales';
export type VideoRequest = ScenarioRequest;

import type { ScenarioRequest } from '../../contracts.js';

/** AI视频检测场景请求草案；具体字段由工作包实现时补齐。 */
export type VideoScenarioId = 'general' | 'deepfake' | 'aftersales';
export type VideoRequest = ScenarioRequest;

export type VideoRisk = 'low' | 'medium' | 'high' | 'unknown';
export type VideoCoverage = 'full' | 'partial';

/** 3.1 前端适配入口的输入；真实上传、任务和存储由适配器实现。 */
export interface VideoGeneralInput {
  file: File;
  metadata: { name: string; size: number; type: string; duration: number; width: number; height: number };
}

export interface VideoGeneralProgress {
  stage: string;
  percent: number | null;
}

export interface VideoGeneralFrame {
  id: string;
  time: number;
  risk: VideoRisk;
  caption: string;
  image?: string;
}

export interface VideoGeneralSegment {
  id: string;
  start: number;
  end: number;
  risk: VideoRisk;
  summary: string;
  frameId?: string;
}

/** 适配器必须返回并与原视频时长、片段和代表画面一致的结果。 */
export interface VideoGeneralResult {
  risk: VideoRisk;
  summary: string;
  coverage: VideoCoverage;
  scope: string;
  duration: number;
  sampledFrames: number;
  findings?: string[];
  segments?: VideoGeneralSegment[];
  frames?: VideoGeneralFrame[];
}

export type VideoGeneralHandler = (
  input: VideoGeneralInput,
  options: { signal?: AbortSignal; onProgress?: (progress: VideoGeneralProgress) => void },
) => Promise<VideoGeneralResult>;

/** 3.1 服务端接口：multipart 上传 → Native-Scale 推理 → 前端契约结果。 */
export interface VideoGeneralDetectSuccess {
  data: VideoGeneralResult & { meta?: Record<string, unknown> };
  requestId: string;
}

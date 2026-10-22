import type { ScenarioRequest } from '../../contracts.js';

/** AI视频检测场景请求草案；具体字段由工作包实现时补齐。 */
export type VideoScenarioId = 'general' | 'deepfake' | 'aftersales';
export type VideoRequest = ScenarioRequest;

export type VideoDeepfakeRisk = 'low' | 'medium' | 'high' | 'unknown';
export type VideoDeepfakeCoverage = 'full' | 'partial';

/** 3.2 前端适配入口的输入；真实上传、人脸识别与换脸检测由适配器实现。 */
export interface VideoDeepfakeInput {
  file: File;
  metadata: {
    name: string;
    size: number;
    type: string;
    duration: number;
    width: number;
    height: number;
    materialVersion?: string;
  };
}

export interface VideoDeepfakeProgress {
  stage: string;
  percent: number | null;
}

export interface VideoDeepfakeFrame {
  id: string;
  time: number;
  risk: VideoDeepfakeRisk;
  caption: string;
  quality?: number;
  image?: string;
}

export interface VideoDeepfakeSegment {
  id: string;
  start: number;
  end: number;
  risk: VideoDeepfakeRisk;
  summary: string;
  signals?: string[];
  frameId?: string;
}

export interface VideoDeepfakePerson {
  id: string;
  label: string;
  risk: VideoDeepfakeRisk;
  coverage: VideoDeepfakeCoverage;
  summary: string;
  firstSeen: number;
  lastSeen: number;
  faceFrames: number;
  findings?: string[];
  segments?: VideoDeepfakeSegment[];
  frames?: VideoDeepfakeFrame[];
}

/** 适配器必须返回与原视频时长、人物、片段和人脸画面一致的结果。 */
export interface VideoDeepfakeResult {
  risk: VideoDeepfakeRisk;
  summary: string;
  coverage: VideoDeepfakeCoverage;
  scope: string;
  duration: number;
  sampledFrames: number;
  faceFrames: number;
  findings?: string[];
  persons: VideoDeepfakePerson[];
}

export type VideoDeepfakeHandler = (
  input: VideoDeepfakeInput,
  options: { signal?: AbortSignal; onProgress?: (progress: VideoDeepfakeProgress) => void },
) => Promise<VideoDeepfakeResult>;

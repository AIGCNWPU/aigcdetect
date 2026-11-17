import { normalizeDeepfakeResult } from './model.js';

const listeners = new Set();

// 前端检测适配器：页面只负责交互，真实上传、人物识别与换脸检测由外部配置的处理函数接入。
export const videoDeepfakeDetection = {
  handler: null,
  get configured() {
    return typeof this.handler === 'function';
  },
  configure(handler) {
    this.handler = typeof handler === 'function' ? handler : null;
    for (const listener of Array.from(listeners)) {
      try { listener(this.configured); } catch { /* 单个订阅失败不影响配置 */ }
    }
  },
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async run(input, { signal, onProgress } = {}) {
    const handler = this.handler;
    if (!handler) {
      const error = new Error('检测服务尚未接入，视频未提交。');
      error.code = 'NOT_CONFIGURED';
      throw error;
    }
    if (!input || !input.file) throw new Error('缺少待检测的视频文件。');
    const data = await handler(input, { signal, onProgress: progressReporter(onProgress) });
    return normalizeDeepfakeResult(data, { expectedDuration: input.metadata?.duration });
  },
};

function progressReporter(callback) {
  if (typeof callback !== 'function') return undefined;
  return progress => {
    if (!progress || typeof progress !== 'object') return;
    const stage = typeof progress.stage === 'string' ? progress.stage.trim().slice(0, 100) : '';
    let percent = progress.percent;
    if (percent === null || percent === undefined) {
      percent = null;
    } else {
      percent = Number(percent);
      percent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : null;
    }
    callback({ stage: stage || '正在检测', percent });
  };
}

// 仅在进入人物换脸页面时按需探测算法健康状态，避免在其他路由产生后台请求。
let localProbeTimer = null;
async function connectLocalBackend() {
  if (videoDeepfakeDetection.configured) return;
  try {
    const response = await fetch('/api/v1/video/deepfake/health');
    if (!response.ok) return;
    const health = await response.json();
    if (!health.ready) return;
    videoDeepfakeDetection.configure(async ({file}, {signal,onProgress}) => {
      const form = new FormData(); form.set('video',file,file.name);
      onProgress?.({stage:'正在识别人脸与分析画面',percent:null});
      const res = await fetch('/api/v1/video/deepfake',{method:'POST',body:form,signal});
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail || body.error?.message || '检测服务处理失败');
      return body.data;
    });
    if (localProbeTimer) { clearInterval(localProbeTimer); localProbeTimer = null; }
  } catch { /* 服务未启动时保持未接入 */ }
}

export function startVideoDeepfakeProbe() {
  if (typeof window === 'undefined' || videoDeepfakeDetection.configured) return () => {};
  void connectLocalBackend();
  if (!localProbeTimer) localProbeTimer = setInterval(connectLocalBackend, 8000);
  return () => {
    if (localProbeTimer) {
      clearInterval(localProbeTimer);
      localProbeTimer = null;
    }
  };
}

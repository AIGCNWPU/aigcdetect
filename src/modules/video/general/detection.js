import { normalizeDetectionResult } from './model.js';

const listeners = new Set();

// 前端检测适配器：页面只负责交互，真实上传/任务/算法由外部配置的处理函数接入。
export const videoGeneralDetection = {
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
    return normalizeDetectionResult(data, { expectedDuration: input.metadata?.duration });
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

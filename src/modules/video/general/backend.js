// 3.1 通用视频检测的真实服务适配器：探测网关健康状态，可用时把上传/检测
// 接到 POST /api/v1/video/general（网关再转发给 ReStraV 推理服务），
// 并把响应映射为前端契约结构。检测服务未启动时保持“未接入”状态，
// 页面继续用本地预览与样例任务，不发出请求。

import { videoGeneralDetection } from './detection.js';

const HEALTH_ENDPOINT = '/api/v1/health';
const DETECT_ENDPOINT = '/api/v1/video/general';

async function readError(response) {
  const body = await response.json().catch(() => null);
  return body?.error?.message || `检测服务处理失败（HTTP ${response.status}）。`;
}

async function uploadAndDetect({ file, metadata }, { signal, onProgress }) {
  const body = new FormData();
  body.set('video', file, metadata?.name || file.name || 'video.mp4');
  onProgress?.({ stage: '上传视频', percent: 8 });
  const response = await fetch(DETECT_ENDPOINT, {
    method: 'POST',
    body,
    signal,
    credentials: 'same-origin',
  });
  if (!response.ok) throw new Error(await readError(response));
  onProgress?.({ stage: '分析视频时间轨迹', percent: null });
  const payload = await response.json();
  onProgress?.({ stage: '整理检测结果', percent: 96 });
  if (!payload?.data) throw new Error('检测服务未返回有效结果。');
  return payload.data;
}

let probing = false;

/** 页面渲染时调用；服务可用且适配器未被外部占用时接入，否则保持未接入。 */
export async function initVideoGeneralBackend() {
  if (probing || videoGeneralDetection.configured) return Promise.resolve();
  probing = true;
  try {
    const response = await fetch(HEALTH_ENDPOINT, { credentials: 'same-origin' });
    const body = await response.json();
    // 不覆盖外部（如联调测试）已注册的适配器
    if (body?.services?.videoGeneral?.available && !videoGeneralDetection.configured) {
      videoGeneralDetection.configure(uploadAndDetect);
    }
  } catch {
    // 网关不可达时保持默认未配置状态
  } finally {
    probing = false;
  }
}

// Native-Scale 检测服务（services/video-general/app.py）的 Node 侧客户端。
// 网关地址由环境变量 VIDEO_GENERAL_SERVICE_URL 配置，默认本机 8600 端口。

const DEFAULT_URL = 'http://127.0.0.1:8600';
const HEALTH_TTL_MS = 5000; // 健康状态短缓存，避免每次页面刷新都打到检测服务

let healthCache = { at: 0, value: null };
const inFlight = new Set();

function serviceUrl(path) {
  const base = (process.env.VIDEO_GENERAL_SERVICE_URL || process.env.RESTRAV_SERVICE_URL || DEFAULT_URL).replace(/\/$/, '');
  return `${base}${path}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function detectorHealth({ refresh = false } = {}) {
  if (!refresh && healthCache.value && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.value;
  const previous = inFlight.has('health');
  if (previous) return healthCache.value;
  inFlight.add('health');
  try {
    const response = await fetchWithTimeout(serviceUrl('/health'), {}, 2000);
    const body = await response.json().catch(() => null);
    healthCache = { at: Date.now(), value: Boolean(response.ok && body?.modelReady) };
  } catch {
    healthCache = { at: Date.now(), value: false };
  } finally {
    inFlight.delete('health');
  }
  return healthCache.value;
}

/** 转发视频文件并返回前端契约结构的检测结果。 */
export async function detectVideo(file, { filename } = {}) {
  const form = new FormData();
  form.set('video', new Blob([file]), filename || 'video.mp4');
  let response;
  try {
    response = await fetchWithTimeout(serviceUrl('/detect'), { method: 'POST', body: form }, 10 * 60 * 1000);
  } catch (error) {
    throw Object.assign(new Error('检测服务无法连接，请确认推理服务已启动。'), { code: 'DETECTOR_UNAVAILABLE', status: 503 });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body?.detail || `检测服务返回 HTTP ${response.status}。`;
    const code = response.status === 413 ? 'PAYLOAD_TOO_LARGE'
      : response.status === 422 ? 'UNSUPPORTED_VIDEO'
      : response.status === 503 ? 'DETECTOR_NOT_READY'
      : 'DETECTOR_FAILED';
    throw Object.assign(new Error(message), { code, status: response.status === 503 ? 503 : 502 });
  }
  return body;
}

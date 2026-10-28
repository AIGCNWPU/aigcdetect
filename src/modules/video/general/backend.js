// 3.1 通用视频检测的真实服务适配器：探测网关健康状态，可用时把上传/检测
// 接到 POST /api/v1/video/general（网关再转发给 Native-Scale 推理服务），
// 并把响应映射为前端契约结构。检测服务未启动时保持“未接入”状态，
// 页面继续用本地预览与样例任务，不发出请求。

import { videoGeneralDetection } from './detection.js';

const HEALTH_ENDPOINT = '/api/v1/health';
const DETECT_ENDPOINT = '/api/v1/video/general';
// 上传进度映射到 8%–70%，70%–96% 为服务端分析阶段，96% 后整理结果
const UPLOAD_PERCENT_BASE = 8;
const UPLOAD_PERCENT_SPAN = 62;
// 上传阶段超过该时长没有任何字节进展，视为隧道断开并主动报错
const UPLOAD_STALL_MS = 30 * 1000;
// 响应阶段超过该时长未返回结果：多窗口串行推理可能需要一分钟以上，超时视为回程链路中断
const RESPONSE_TIMEOUT_MS = 180 * 1000;

function errorMessage(body, status) {
  return body?.error?.message || `检测服务处理失败（HTTP ${status}）。`;
}

async function uploadAndDetect({ file, metadata }, { signal, onProgress }) {
  const body = new FormData();
  body.set('video', file, metadata?.name || file.name || 'video.mp4');
  // fetch 拿不到上传进度，改用 XHR：进度条反映真实传输状态，停滞时给出明确错误
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stalled = null; // 'upload' | 'response'：哪个阶段判定的链路中断
    let lastActivity = Date.now();
    let watchdog = null;
    let responseTimer = null;

    const startWatchdog = () => {
      watchdog = setInterval(() => {
        if (Date.now() - lastActivity < UPLOAD_STALL_MS) return;
        stalled = 'upload';
        xhr.abort();
      }, 1000);
    };
    const stopWatchdog = () => {
      if (watchdog) { clearInterval(watchdog); watchdog = null; }
    };
    const stopResponseTimer = () => {
      if (responseTimer) { clearTimeout(responseTimer); responseTimer = null; }
    };

    xhr.open('POST', DETECT_ENDPOINT);
    xhr.responseType = 'json';
    xhr.withCredentials = true;

    xhr.upload.onprogress = event => {
      lastActivity = Date.now();
      if (!event.lengthComputable) return;
      const sent = Math.round((event.loaded / event.total) * 100);
      const percent = UPLOAD_PERCENT_BASE + Math.round((event.loaded / event.total) * UPLOAD_PERCENT_SPAN);
      onProgress?.({ stage: `上传视频 ${sent}%`, percent: Math.min(70, percent) });
    };
    xhr.upload.onload = () => {
      stopWatchdog();
      onProgress?.({ stage: '分析视频画面', percent: null });
      // 响应看门狗：上传完成后服务端只需数秒即返回；超时说明结果在回程链路被丢弃
      responseTimer = setTimeout(() => {
        stalled = 'response';
        xhr.abort();
      }, RESPONSE_TIMEOUT_MS);
    };
    xhr.upload.onerror = () => {
      stopWatchdog();
      stopResponseTimer();
      reject(new Error('上传失败：网络连接中断，请检查网络或 SSH 隧道后重试。'));
    };
    xhr.onabort = () => {
      stopWatchdog();
      stopResponseTimer();
      if (stalled === 'upload') {
        reject(new Error(`上传停滞超过 ${Math.round(UPLOAD_STALL_MS / 1000)} 秒：与服务器之间的连接（SSH 隧道）可能已断开，请重连后重试。`));
      } else if (stalled === 'response') {
        reject(new Error(`服务响应超时：请求已提交但 ${Math.round(RESPONSE_TIMEOUT_MS / 1000)} 秒内未返回结果，返回链路可能已中断，请重试。`));
      } else {
        reject(new DOMException('上传已取消', 'AbortError'));
      }
    };
    xhr.onerror = () => {
      stopWatchdog();
      stopResponseTimer();
      reject(new Error('无法连接检测服务：网络或 SSH 隧道不可达。'));
    };
    xhr.onload = () => {
      stopWatchdog();
      stopResponseTimer();
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(errorMessage(xhr.response, xhr.status)));
        return;
      }
      onProgress?.({ stage: '整理检测结果', percent: 96 });
      if (!xhr.response?.data) {
        reject(new Error('检测服务未返回有效结果。'));
        return;
      }
      resolve(xhr.response.data);
    };

    if (signal) {
      if (signal.aborted) { reject(new DOMException('上传已取消', 'AbortError')); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }
    startWatchdog();
    xhr.send(body);
  });
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

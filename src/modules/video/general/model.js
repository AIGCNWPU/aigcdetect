// 通用视频检测的展示模型：文件校验、格式化与检测结果归一化。
export const VIDEO_EXTENSIONS = ['mp4', 'webm'];
export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
export const RISK_LABELS = Object.freeze({ low: '低风险', medium: '中风险', high: '高风险', unknown: '无法判断' });
export const STATUS_LABELS = Object.freeze({ idle: '未检测', queued: '排队中', running: '检测中', succeeded: '已完成', failed: '失败', cancelled: '已取消' });
const RISK_LEVELS = { low: 1, medium: 2, high: 3, unknown: 0 };

export function riskLevel(risk) {
  return RISK_LEVELS[risk] || 0;
}

export function formatDuration(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatTimecode(value) {
  const totalTenths = Math.round(Math.max(0, Number(value) || 0) * 10);
  const whole = Math.floor(totalTenths / 10);
  const tenths = totalTenths % 10;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const seconds = whole % 60;
  const prefix = hours ? `${hours}:` : '';
  return `${prefix}${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${tenths}`;
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function escapeText(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function validateVideoFile(file) {
  if (!file || typeof file !== 'object' || typeof file.name !== 'string') {
    return { ok: false, message: '请选择视频文件。' };
  }
  const name = file.name.trim();
  const extension = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  if (!VIDEO_EXTENSIONS.includes(extension)) {
    return { ok: false, message: '请选择 MP4 或 WebM 格式的视频。' };
  }
  const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (type && !type.startsWith('video/')) {
    return { ok: false, message: '所选文件不是视频，请重新选择。' };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, message: '视频文件为空，请重新选择。' };
  }
  if (file.size > MAX_VIDEO_BYTES) {
    return { ok: false, message: `视频不能超过 ${formatBytes(MAX_VIDEO_BYTES)}。` };
  }
  return { ok: true, message: '' };
}

function requiredText(value, label, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`${label}缺失。`);
  if (text.length > maxLength) throw new Error(`${label}过长。`);
  return text;
}

function optionalText(value, label, maxLength) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new Error(`${label}格式无效。`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${label}过长。`);
  return text;
}

function isRisk(value) {
  return Object.hasOwn(RISK_LABELS, value);
}

function safeImageUrl(value) {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  if (!source || source.length > 2 * 1024 * 1024) return '';
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/.test(source)) return source;
  if (/^(?:https?:\/\/|blob:|\/|\.\.?\/)/i.test(source)) return source;
  return '';
}

function normalizeFindings(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('检测线索格式无效。');
  if (value.length > 12) throw new Error('检测线索数量超出展示范围。');
  return value.map((item, index) => requiredText(item, `第 ${index + 1} 条检测线索`, 500));
}

function normalizeFrames(value, duration) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('代表画面格式无效。');
  if (value.length > 200) throw new Error('代表画面数量超出展示范围。');
  const ids = new Set();
  const frames = value.map((frame, index) => {
    if (!frame || typeof frame !== 'object') throw new Error(`第 ${index + 1} 张代表画面格式无效。`);
    const id = requiredText(frame.id, `第 ${index + 1} 张代表画面的标识`, 100);
    if (ids.has(id)) throw new Error('代表画面标识重复。');
    ids.add(id);
    const time = Number(frame.time);
    if (!Number.isFinite(time) || time < 0 || time > duration + 0.5) throw new Error('代表画面时间超出视频范围。');
    if (!isRisk(frame.risk)) throw new Error('代表画面的风险等级无效。');
    const caption = requiredText(frame.caption, `第 ${index + 1} 张代表画面的说明`, 500);
    return { id, time: Math.min(time, duration), risk: frame.risk, caption, image: safeImageUrl(frame.image) };
  });
  return frames.sort((left, right) => left.time - right.time);
}

function normalizeSegments(value, duration, frameIds) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error('可疑时间段格式无效。');
  if (value.length > 100) throw new Error('可疑时间段数量超出展示范围。');
  const ids = new Set();
  const segments = value.map((segment, index) => {
    if (!segment || typeof segment !== 'object') throw new Error(`第 ${index + 1} 个可疑时间段格式无效。`);
    const id = requiredText(segment.id, `第 ${index + 1} 个可疑时间段的标识`, 100);
    if (ids.has(id)) throw new Error('可疑时间段标识重复。');
    ids.add(id);
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= duration || end <= start || end > duration + 0.25) {
      throw new Error('可疑时间段的起止时间无效。');
    }
    if (!isRisk(segment.risk)) throw new Error('可疑时间段的风险等级无效。');
    const summary = requiredText(segment.summary, `第 ${index + 1} 个可疑时间段的说明`, 2000);
    const frameId = optionalText(segment.frameId, '代表画面关联标识', 100);
    if (frameId && !frameIds.has(frameId)) throw new Error('可疑时间段关联了不存在的代表画面。');
    return { id, start, end: Math.min(end, duration), risk: segment.risk, summary, frameId };
  });
  return segments.sort((left, right) => left.start - right.start);
}

export function normalizeDetectionResult(input, { expectedDuration } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('检测服务未返回有效结果。');
  if (!isRisk(input.risk)) throw new Error('检测结果的风险等级无效。');
  const summary = requiredText(input.summary, '检测结论', 4000);
  if (input.coverage !== 'full' && input.coverage !== 'partial') throw new Error('检测结果的覆盖范围无效。');
  const scope = requiredText(input.scope, '检测范围说明', 2000);
  let duration = Number(input.duration);
  if (expectedDuration !== undefined && expectedDuration !== null) {
    const expected = Number(expectedDuration);
    if (!Number.isFinite(expected) || expected <= 0) throw new Error('视频时长无效，无法核对检测结果。');
    if (!Number.isFinite(duration) || duration <= 0) duration = expected;
    else if (Math.abs(duration - expected) > 2) throw new Error('检测结果时长与视频不一致。');
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('检测结果缺少有效时长。');
  const sampledFrames = Number(input.sampledFrames);
  if (!Number.isInteger(sampledFrames) || sampledFrames < 0 || sampledFrames > 100000) throw new Error('采样画面数量无效。');
  const findings = normalizeFindings(input.findings);
  const frames = normalizeFrames(input.frames, duration);
  const segments = normalizeSegments(input.segments, duration, new Set(frames.map(frame => frame.id)));
  const meta = input.meta && typeof input.meta === 'object' ? {
    method: optionalText(input.meta.method, '模型名称', 200),
    checkpoint: optionalText(input.meta.checkpoint, '模型版本', 200),
    thresholdsCalibrated: input.meta.thresholdsCalibrated === true ? true : input.meta.thresholdsCalibrated === false ? false : undefined,
  } : undefined;
  return { risk: input.risk, summary, coverage: input.coverage, scope, duration, sampledFrames, findings, segments, frames, ...(meta ? { meta } : {}) };
}

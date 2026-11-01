// 人物换脸与深度伪造检测的展示模型：文件校验、材料版本、格式化与结果归一化。
export const VIDEO_EXTENSIONS = ['mp4', 'webm'];
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const RISK_LABELS = Object.freeze({ low: '低风险', medium: '中风险', high: '高风险', unknown: '无法判断' });
export const COVERAGE_LABELS = Object.freeze({ full: '完整覆盖', partial: '部分覆盖' });
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

// 材料版本只由浏览器可读的文件属性派生，用于把结果绑定到提交时的文件，不替代服务端内容哈希。
export function materialVersion(file) {
  const name = typeof file?.name === 'string' ? file.name : '';
  const size = Number(file?.size) || 0;
  const modified = Number(file?.lastModified) || 0;
  let hash = 2166136261;
  for (const character of `${name}:${size}:${modified}`) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `v${(hash >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(-7)}`;
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

function isCoverage(value) {
  return value === 'full' || value === 'partial';
}

function safeImageUrl(value) {
  if (typeof value !== 'string') return '';
  const source = value.trim();
  if (!source || source.length > 2 * 1024 * 1024) return '';
  if (/^data:image\/(?:png|jpe?g|webp|gif|svg\+xml)[;,]/.test(source)) return source;
  if (/^(?:https?:\/\/|blob:|\/|\.\.?\/)/i.test(source)) return source;
  return '';
}

function normalizeFindings(value, label, { maxItems, maxLength }) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label}格式无效。`);
  if (value.length > maxItems) throw new Error(`${label}数量超出展示范围。`);
  return value.map((item, index) => requiredText(item, `第 ${index + 1} 条${label}`, maxLength));
}

function normalizeFrame(frame, index, duration, ids) {
  if (!frame || typeof frame !== 'object') throw new Error(`第 ${index + 1} 张人脸画面格式无效。`);
  const id = requiredText(frame.id, `第 ${index + 1} 张人脸画面的标识`, 100);
  if (ids.has(id)) throw new Error('人脸画面标识重复。');
  ids.add(id);
  const time = Number(frame.time);
  if (!Number.isFinite(time) || time < 0 || time > duration + 0.5) throw new Error('人脸画面时间超出视频范围。');
  if (!isRisk(frame.risk)) throw new Error('人脸画面的风险等级无效。');
  const caption = requiredText(frame.caption, `第 ${index + 1} 张人脸画面的说明`, 500);
  let quality = null;
  if (frame.quality !== undefined && frame.quality !== null) {
    quality = Number(frame.quality);
    if (!Number.isFinite(quality) || quality < 0 || quality > 100) throw new Error('人脸画面的清晰度无效。');
    quality = Math.round(quality);
  }
  return { id, time: Math.min(time, duration), risk: frame.risk, caption, image: safeImageUrl(frame.image), quality };
}

function normalizeSignals(value, label) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new Error(`${label}格式无效。`);
  if (value.length > 8) throw new Error(`${label}数量超出展示范围。`);
  return value.map((item, index) => requiredText(item, `第 ${index + 1} 条${label}`, 200));
}

function normalizeSegment(segment, index, duration, segmentIds, frameIds) {
  if (!segment || typeof segment !== 'object') throw new Error(`第 ${index + 1} 个可疑时间段格式无效。`);
  const id = requiredText(segment.id, `第 ${index + 1} 个可疑时间段的标识`, 100);
  if (segmentIds.has(id)) throw new Error('可疑时间段标识重复。');
  segmentIds.add(id);
  const start = Number(segment.start);
  const end = Number(segment.end);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= duration || end <= start || end > duration + 0.25) {
    throw new Error('可疑时间段的起止时间无效。');
  }
  if (!isRisk(segment.risk)) throw new Error('可疑时间段的风险等级无效。');
  const summary = requiredText(segment.summary, `第 ${index + 1} 个可疑时间段的说明`, 2000);
  const frameId = optionalText(segment.frameId, '代表画面关联标识', 100);
  if (frameId && !frameIds.has(frameId)) throw new Error('可疑时间段关联了其他人物或不存在的画面。');
  return {
    id,
    start,
    end: Math.min(end, duration),
    risk: segment.risk,
    summary,
    frameId,
    signals: normalizeSignals(segment.signals, '面部合成线索'),
  };
}

function normalizePerson(person, index, duration, personIds, frameIds, segmentIds) {
  if (!person || typeof person !== 'object') throw new Error(`第 ${index + 1} 位人物的检测结果格式无效。`);
  const id = requiredText(person.id, `第 ${index + 1} 位人物的标识`, 100);
  if (personIds.has(id)) throw new Error('人物标识重复。');
  personIds.add(id);
  const label = requiredText(person.label, `第 ${index + 1} 位人物的名称`, 60);
  if (!isRisk(person.risk)) throw new Error('人物的风险等级无效。');
  if (!isCoverage(person.coverage)) throw new Error('人物的覆盖范围无效。');
  const summary = requiredText(person.summary, `第 ${index + 1} 位人物的检测结论`, 2000);
  const firstSeen = Number(person.firstSeen);
  const lastSeen = Number(person.lastSeen);
  if (!Number.isFinite(firstSeen) || !Number.isFinite(lastSeen) || firstSeen < 0 || lastSeen < firstSeen || lastSeen > duration + 0.5) {
    throw new Error('人物的出现时间无效。');
  }
  const faceFrames = Number(person.faceFrames);
  if (!Number.isInteger(faceFrames) || faceFrames < 0 || faceFrames > 100000) throw new Error('人物可用人脸画面数量无效。');
  const framesInput = person.frames === undefined || person.frames === null ? [] : person.frames;
  if (!Array.isArray(framesInput)) throw new Error('人物人脸画面格式无效。');
  if (framesInput.length > 30) throw new Error('人物人脸画面数量超出展示范围。');
  const frames = framesInput
    .map((frame, frameIndex) => normalizeFrame(frame, frameIndex, duration, frameIds))
    .sort((left, right) => left.time - right.time);
  const framesById = new Set(frames.map(frame => frame.id));
  const segmentsInput = person.segments === undefined || person.segments === null ? [] : person.segments;
  if (!Array.isArray(segmentsInput)) throw new Error('人物可疑时间段格式无效。');
  if (segmentsInput.length > 30) throw new Error('人物可疑时间段数量超出展示范围。');
  const segments = segmentsInput
    .map((segment, segmentIndex) => normalizeSegment(segment, segmentIndex, duration, segmentIds, framesById))
    .sort((left, right) => left.start - right.start);
  return {
    id,
    label,
    risk: person.risk,
    coverage: person.coverage,
    summary,
    firstSeen: Math.min(firstSeen, duration),
    lastSeen: Math.min(lastSeen, duration),
    faceFrames,
    findings: normalizeFindings(person.findings, '人物检测线索', { maxItems: 8, maxLength: 300 }),
    segments,
    frames,
  };
}

export function normalizeDeepfakeResult(input, { expectedDuration } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('检测服务未返回有效结果。');
  if (!isRisk(input.risk)) throw new Error('检测结果的风险等级无效。');
  const summary = requiredText(input.summary, '检测结论', 4000);
  if (!isCoverage(input.coverage)) throw new Error('检测结果的覆盖范围无效。');
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
  const faceFrames = Number(input.faceFrames);
  if (!Number.isInteger(faceFrames) || faceFrames < 0 || faceFrames > 100000) throw new Error('可用人脸画面数量无效。');
  const personsInput = input.persons === undefined || input.persons === null ? [] : input.persons;
  if (!Array.isArray(personsInput)) throw new Error('人物检测结果格式无效。');
  if (personsInput.length > 20) throw new Error('人物数量超出展示范围。');
  const personIds = new Set();
  const frameIds = new Set();
  const segmentIds = new Set();
  const persons = personsInput.map((person, index) => normalizePerson(person, index, duration, personIds, frameIds, segmentIds));
  if (!persons.length && input.risk !== 'unknown') throw new Error('未识别到人物画面时不能给出确定风险等级。');
  const personRisk = persons.reduce((level, person) => Math.max(level, riskLevel(person.risk)), 0);
  if (persons.length && input.risk !== 'unknown' && riskLevel(input.risk) < personRisk) throw new Error('综合风险不能低于已识别出的人物风险。');
  return {
    risk: input.risk,
    summary,
    coverage: input.coverage,
    scope,
    duration,
    sampledFrames,
    faceFrames,
    findings: normalizeFindings(input.findings, '检测线索', { maxItems: 12, maxLength: 500 }),
    persons,
  };
}

export function resultStats(result) {
  const persons = result?.persons || [];
  return {
    persons: persons.length,
    segments: persons.reduce((total, person) => total + person.segments.length, 0),
    frames: persons.reduce((total, person) => total + person.frames.length, 0),
    suspiciousPersons: persons.filter(person => person.segments.length > 0).length,
  };
}

export function defaultPerson(result) {
  if (!result?.persons?.length) return null;
  return [...result.persons].sort((left, right) => (
    riskLevel(right.risk) - riskLevel(left.risk)
    || right.segments.length - left.segments.length
    || left.firstSeen - right.firstSeen
  ))[0];
}

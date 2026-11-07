/** 检测 / 降重报告历史，持久化到 localStorage（借鉴 humaniser history.js）。 */

const HUMANIZE_KEY = 'academic_humanize_history';
const DETECTION_KEY = 'academic_detection_history';
const MAX_ENTRIES = 20;

function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries.sort((a, b) => b.timestamp - a.timestamp) : [];
  } catch {
    return [];
  }
}

function writeList(key, entries) {
  try {
    localStorage.setItem(key, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota / private mode */
  }
}

function newId(prefix) {
  return crypto.randomUUID?.() || `${prefix}-${Date.now()}`;
}

export function saveHumanizeHistory(entry) {
  const entries = getHumanizeHistory();
  entries.unshift({
    id: newId('h'),
    timestamp: Date.now(),
    originalText: entry.originalText || '',
    humanisedText: entry.humanisedText || '',
    originalScore: Number(entry.originalScore || 0),
    humanisedScore: Number(entry.humanisedScore || 0),
    mode: entry.mode || '',
    strategy: entry.strategy || '',
    scope: entry.scope || '',
    fileName: entry.fileName || '',
  });
  writeList(HUMANIZE_KEY, entries);
}

export function getHumanizeHistory() {
  return readList(HUMANIZE_KEY);
}

export function saveDetectionHistory(entry) {
  const text = String(entry.text || '');
  const entries = getDetectionHistory();
  entries.unshift({
    id: newId('d'),
    timestamp: Date.now(),
    text,
    preview: text.replace(/\s+/g, ' ').trim().slice(0, 160),
    aiScore: Number(entry.aiScore || 0),
    label: entry.label || '',
    sentenceCount: Number(entry.sentenceCount || 0),
    riskCount: Number(entry.riskCount || 0),
    scope: entry.scope || '',
    fileName: entry.fileName || '',
  });
  writeList(DETECTION_KEY, entries);
}

export function getDetectionHistory() {
  return readList(DETECTION_KEY);
}

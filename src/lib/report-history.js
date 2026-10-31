/** 降重报告历史，持久化到 localStorage（借鉴 humaniser history.js）。 */

const STORAGE_KEY = 'academic_humanize_history';
const MAX_ENTRIES = 20;

export function saveHumanizeHistory(entry) {
  try {
    const entries = getHumanizeHistory();
    entries.unshift({
      id: crypto.randomUUID?.() || `h-${Date.now()}`,
      timestamp: Date.now(),
      originalText: entry.originalText || '',
      humanisedText: entry.humanisedText || '',
      originalScore: Number(entry.originalScore || 0),
      humanisedScore: Number(entry.humanisedScore || 0),
      mode: entry.mode || '',
      strategy: entry.strategy || '',
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* ignore quota / private mode */
  }
}

export function getHumanizeHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const entries = JSON.parse(raw);
    return Array.isArray(entries) ? entries.sort((a, b) => b.timestamp - a.timestamp) : [];
  } catch {
    return [];
  }
}

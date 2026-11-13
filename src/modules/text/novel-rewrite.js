const STORAGE_KEY = 'veritas_novel_rewrite_history_v1';
const SCHEMA_VERSION = 1;
const MAX_STORAGE_BYTES = 4_500_000;
const MAX_VERSIONS_PER_CHAPTER = 20;

function rewriteError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}

function safeName(value, fallback) {
  const cleaned = String(value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '-').replace(/\s+/gu, ' ').slice(0, 80);
  return cleaned || fallback;
}

export async function hashNovelContent(content) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw rewriteError('CRYPTO_UNAVAILABLE', '当前环境不支持内容完整性校验。');
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(String(content ?? '')));
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export function inspectRewriteProposals(content, proposals) {
  const source = String(content ?? '');
  const values = Array.isArray(proposals) ? proposals : [];
  const sorted = values.map((item, index) => ({ ...item, _index: index })).sort((a, b) => Number(a.start) - Number(b.start));
  const invalid = new Map();
  let previous = null;
  const ids = new Set();
  for (const item of sorted) {
    const start = Number(item.start), end = Number(item.end);
    const id = String(item.proposalId || item.fragmentId || '');
    let reason = '';
    if (!id || ids.has(id)) reason = '建议编号缺失或重复';
    else if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.length) reason = '原文位置无效';
    else if (source.slice(start, end) !== String(item.before ?? '')) reason = '建议对应的原文已经变化';
    else if (!String(item.after ?? '').trim()) reason = '修改后文本为空';
    else if (previous && start < Number(previous.end)) {
      reason = '建议位置与其他建议重叠';
      if (!invalid.has(previous._index)) invalid.set(previous._index, '建议位置与其他建议重叠');
    }
    ids.add(id);
    if (reason) invalid.set(item._index, reason);
    previous = item;
  }
  return values.map((item, index) => ({ ...item, valid: !invalid.has(index), invalidReason: invalid.get(index) || '' }));
}

export function applyRewriteProposals(content, proposals) {
  const inspected = inspectRewriteProposals(content, proposals);
  const accepted = inspected.filter(item => item.accepted === true);
  if (!accepted.length) throw rewriteError('NO_ACCEPTED_PROPOSALS', '请先接受至少一条有效改写建议。');
  const invalid = accepted.find(item => !item.valid);
  if (invalid) throw rewriteError('INVALID_REWRITE_PROPOSAL', invalid.invalidReason || '改写建议已失效。');
  return accepted.sort((a, b) => Number(b.start) - Number(a.start)).reduce((text, item) => (
    `${text.slice(0, item.start)}${String(item.after)}${text.slice(item.end)}`
  ), String(content ?? ''));
}

export async function createChapterVersion({ chapterId, title, content, parentVersionId = null, versionNumber = 1, acceptedProposalIds = [], detectionSnapshot = null, createdAt = new Date().toISOString() }) {
  const text = String(content ?? '');
  return Object.freeze({
    versionId: `${String(chapterId)}-v${Number(versionNumber)}-${Date.parse(createdAt) || Date.now()}`,
    chapterId: String(chapterId),
    title: String(title || ''),
    versionNumber: Number(versionNumber),
    parentVersionId: parentVersionId ? String(parentVersionId) : null,
    content: text,
    contentHash: await hashNovelContent(text),
    acceptedProposalIds: [...new Set(acceptedProposalIds.map(String))],
    detectionSnapshot: detectionSnapshot ? structuredClone(detectionSnapshot) : null,
    createdAt,
  });
}

export function chapterTextDownload({ workTitle, chapterTitle, versionNumber, content }) {
  return {
    fileName: `${safeName(workTitle, '未命名作品')}-${safeName(chapterTitle, '未命名章节')}-改写版-v${Number(versionNumber) || 1}.txt`,
    content: String(content ?? ''),
    type: 'text/plain;charset=utf-8',
  };
}

async function validateHistory(value) {
  if (!value || value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.works)) throw rewriteError('HISTORY_CORRUPT', '本地小说改写历史格式无效。');
  for (const work of value.works) {
    if (!work || typeof work.workId !== 'string' || !Array.isArray(work.chapters)) throw rewriteError('HISTORY_CORRUPT', '本地作品历史结构无效。');
    for (const chapter of work.chapters) {
      if (!chapter || typeof chapter.chapterId !== 'string' || !Array.isArray(chapter.versions) || chapter.versions.length > MAX_VERSIONS_PER_CHAPTER) throw rewriteError('HISTORY_CORRUPT', '本地章节历史结构无效。');
      for (const version of chapter.versions) {
        if (!version || typeof version.content !== 'string' || typeof version.contentHash !== 'string' || await hashNovelContent(version.content) !== version.contentHash) throw rewriteError('HISTORY_CORRUPT', '本地章节版本完整性校验失败。');
      }
    }
  }
  return value;
}

export function createNovelRewriteStore({ storage, key = STORAGE_KEY, maxBytes = MAX_STORAGE_BYTES } = {}) {
  // 默认记录仅属于本次页面实例；刷新或重新进入页面后自然释放。
  if (!storage) {
    const values = new Map();
    storage = { getItem: name => values.get(name) || null, setItem: (name, value) => values.set(name, value), removeItem: name => values.delete(name) };
  }
  return {
    async load() {
      if (!storage) return { schemaVersion: SCHEMA_VERSION, works: [], updatedAt: null };
      let raw;
      try { raw = storage.getItem(key); } catch { throw rewriteError('STORAGE_UNAVAILABLE', '浏览器本地存储不可用。'); }
      if (!raw) return { schemaVersion: SCHEMA_VERSION, works: [], updatedAt: null };
      let parsed;
      try { parsed = JSON.parse(raw); } catch { throw rewriteError('HISTORY_CORRUPT', '本地小说改写历史无法解析。'); }
      return structuredClone(await validateHistory(parsed));
    },
    async save(state) {
      if (!storage) throw rewriteError('STORAGE_UNAVAILABLE', '浏览器本地存储不可用。');
      const candidate = structuredClone({ ...state, schemaVersion: SCHEMA_VERSION, updatedAt: new Date().toISOString() });
      await validateHistory(candidate);
      const raw = JSON.stringify(candidate);
      if (byteLength(raw) > maxBytes) throw rewriteError('STORAGE_LIMIT', '小说版本历史超过当前浏览器可用容量，请先下载或删除旧版本。');
      try { storage.setItem(key, raw); } catch { throw rewriteError('STORAGE_WRITE_FAILED', '小说版本仍保留在当前页面，但未能写入浏览器本地存储。'); }
      return structuredClone(candidate);
    },
    clear() {
      try { storage?.removeItem(key); } catch { /* best effort */ }
    },
  };
}

export const NOVEL_REWRITE_STORAGE = Object.freeze({ key: STORAGE_KEY, schemaVersion: SCHEMA_VERSION, maxVersionsPerChapter: MAX_VERSIONS_PER_CHAPTER });

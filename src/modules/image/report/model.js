// Shared report model contract for image scenario reports.
// One model, two renderers (PDF via pdf-lib, Word via HTML .doc):
// sections appear in reading order; the first block is always the verdict banner.

export function reportBlockTypes() {
  return ['banner', 'kv', 'table', 'list', 'images', 'paragraph'];
}

const toneOf = (tone) => (['ok', 'warn', 'danger', 'neutral'].includes(tone) ? tone : 'neutral');

export function banner({ title, detail = '', scoreText = '', tone = 'neutral' } = {}) {
  return { type: 'banner', title: String(title ?? ''), detail: String(detail ?? ''), scoreText: String(scoreText ?? ''), tone: toneOf(tone) };
}

export function kv(rows) {
  return { type: 'kv', rows: (rows || []).filter((row) => Array.isArray(row) && row.length >= 2).map(([key, value]) => [String(key ?? ''), String(value ?? '')]) };
}

export function table(columns, rows, { kind = 'table' } = {}) {
  return {
    type: 'table',
    kind,
    columns: (columns || []).map((col) => ({ title: String(col?.title ?? ''), width: Number(col?.width) || 0 })).filter((col) => col.width > 0),
    rows: (rows || []).map((row) => ({ id: String(row?.id ?? ''), cells: (row?.cells || []).map((cell) => String(cell ?? '')), tone: toneOf(row?.tone), repeatLabel: row?.repeatLabel ? String(row.repeatLabel) : '' })),
  };
}

export function list(items) {
  return {
    type: 'list',
    items: (items || [])
      .filter((item) => item && (item.title || item.detail))
      .map((item) => ({ title: String(item.title ?? ''), detail: String(item.detail ?? ''), tone: toneOf(item.tone) })),
  };
}

export function images(items, { layout = 'pair' } = {}) {
  return {
    type: 'images',
    layout: layout === 'single' ? 'single' : 'pair',
    items: (items || [])
      .filter((item) => item && item.src)
      .map((item) => ({
        src: String(item.src),
        caption: String(item.caption ?? ''),
        regions: (item.regions || [])
          .filter((region) => [region?.x, region?.y, region?.width, region?.height].every((value) => Number.isFinite(value) && value >= 0 && value <= 1))
          .map((region) => ({ x: region.x, y: region.y, width: region.width, height: region.height })),
      })),
  };
}

export function paragraph(text) {
  return { type: 'paragraph', text: String(text ?? '') };
}

export function section(title, blocks, note = '') {
  const ordered = (blocks || []).filter((block) => block && reportBlockTypes().includes(block.type));
  return { title: String(title ?? ''), note: String(note ?? ''), blocks: ordered };
}

export function createReport({ title, subtitle, verdict, generatedAt = new Date().toISOString(), sections, footerNotes = [] }) {
  const model = {
    title: String(title ?? '检测报告'),
    subtitle: String(subtitle ?? ''),
    verdict: banner(verdict || {}),
    generatedAt,
    sections: (sections || []).filter((sectionItem) => sectionItem && sectionItem.title && sectionItem.blocks.length),
    footerNotes: (footerNotes || []).map((note) => String(note ?? '')).filter(Boolean),
  };
  return model;
}

export function collectReportImages(model) {
  const found = [];
  for (const block of [model.verdict, ...model.sections.flatMap((sectionItem) => sectionItem.blocks)]) {
    if (block?.type === 'images') for (const item of block.items) found.push({ block, item });
  }
  return found;
}

export function countReportFindings(model) {
  const stats = { banners: 1, tables: 0, listItems: 0, images: 0, paragraphs: 0 };
  for (const block of model.sections.flatMap((sectionItem) => sectionItem.blocks)) {
    if (block.type === 'table') stats.tables += block.rows.length;
    else if (block.type === 'list') stats.listItems += block.items.length;
    else if (block.type === 'images') stats.images += block.items.length;
    else if (block.type === 'paragraph') stats.paragraphs += 1;
  }
  return stats;
}

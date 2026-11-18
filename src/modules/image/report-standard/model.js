// 标准报告模型（StdReport）：只描述内容，不含任何版式信息。
// 版式（字体、字号、编号、页眉页脚）由 render/render_report.py 按 spec.md 统一施加。
// 2.1 / 2.3 的映射器产出本模型；渲染器与校验器只认本模型。

const BLOCK_TYPES = ['p', 'h2', 'h3', 'h4', 'table', 'list', 'image'];

const cleanText = (value) =>
  String(value ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/\r\n?|\u2028|\u2029/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/([。；])\1+/g, '$1') // 拼接产生的重复句读
    .trim();

/** 正文段落。noIndent：不首行缩进（如接续说明）。 */
export function p(text, { noIndent = false } = {}) {
  const value = cleanText(text);
  return value ? { type: 'p', text: value, noIndent } : null;
}

export function h2(title) { return title ? { type: 'h2', title: cleanText(title) } : null; }
export function h3(title) { return title ? { type: 'h3', title: cleanText(title) } : null; }
export function h4(title) { return title ? { type: 'h4', title: cleanText(title) } : null; }

/** 表格。columns: [{title, width?}]（width 为百分比数值，可不填由渲染器均分）。 */
export function table(columns, rows, { caption = '' } = {}) {
  const cols = (columns || [])
    .map((col) => ({ title: cleanText(col?.title ?? ''), width: Number(col?.width) || 0 }))
    .filter((col) => col.title);
  const body = (rows || [])
    .map((row) => (Array.isArray(row) ? row.map((cell) => cleanText(cell)) : null))
    .filter((row) => row && row.some((cell) => cell !== ''));
  return cols.length ? { type: 'table', caption: cleanText(caption), columns: cols, rows: body } : null;
}

/** 编号列表（渲染为 1. 2. 3. 段落）。 */
export function list(items) {
  const body = (items || []).map(cleanText).filter(Boolean);
  return body.length ? { type: 'list', items: body } : null;
}

/** 图片。src 为 dataURL（data:image/...;base64,...）或服务器可解析的路径（/、./、http(s)、file:、盘符）；regions 为 0..1 相对框。 */
export function image(src, caption, { regions = [], widthCm } = {}) {
  const usable = typeof src === 'string' && (
    /^data:image\/(?:png|jpeg|webp);base64,/.test(src)
    || /^(https?:)?\//.test(src)
    || /^\.\//.test(src)
    || /^file:/.test(src)
    || /^[a-zA-Z]:[\\/]/.test(src)
  );
  if (!usable) return null;
  const boxes = (regions || [])
    .filter((r) => [r?.x, r?.y, r?.width, r?.height].every((v) => Number.isFinite(v) && v >= 0 && v <= 1))
    .map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height }));
  return { type: 'image', src, caption: cleanText(caption), regions: boxes, widthCm: Number.isFinite(widthCm) ? widthCm : undefined };
}

export function chapter(title, blocks, { appendix = false } = {}) {
  const ordered = (blocks || []).filter((block) => block && BLOCK_TYPES.includes(block.type));
  const heading = cleanText(title);
  return heading && ordered.length ? { title: heading, blocks: ordered, appendix: Boolean(appendix) } : null;
}

export function createStdReport({ docTitle, subtitle = '', scenario, generatedAt = new Date().toISOString(), reportNo, meta = [], chapters = [] }) {
  const title = cleanText(docTitle);
  if (!title) throw new Error('报告主标题不能为空。');
  const metaRows = (meta || [])
    .map(([key, value]) => [cleanText(key), cleanText(value)])
    .filter(([key, value]) => key && value);
  const validChapters = (chapters || []).filter((chapterItem) => chapterItem && chapterItem.title && chapterItem.blocks.length);
  return {
    version: 1,
    docTitle: title,
    subtitle: cleanText(subtitle),
    scenario: String(scenario || ''),
    generatedAt,
    reportNo: cleanText(reportNo),
    meta: metaRows,
    chapters: validChapters,
  };
}

/** 时间格式化为北京时间字符串；filename=true 时输出 YYYYMMDD-HHMMSS。 */
export function formatStdTime(value, { filename = false } = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return filename ? 'current' : '未记录';
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (part) => String(part).padStart(2, '0');
  const parts = {
    year: shifted.getUTCFullYear(), month: pad(shifted.getUTCMonth() + 1), day: pad(shifted.getUTCDate()),
    hour: pad(shifted.getUTCHours()), minute: pad(shifted.getUTCMinutes()), second: pad(shifted.getUTCSeconds()),
  };
  return filename
    ? `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`
    : `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

/** 模型级校验：渲染前的结构性检查（内容完整性；版式合规由 validate_report.py 负责）。 */
export function validateStdReport(report) {
  const problems = [];
  const push = (message) => problems.push(message);
  if (!report || report.version !== 1) push('报告模型版本不受支持。');
  if (!report.docTitle) push('缺少报告主标题。');
  if (!report.chapters.length) push('报告没有任何章节。');
  const chapterTitles = new Set();
  for (const chapterItem of report.chapters || []) {
    if (chapterTitles.has(chapterItem.title)) push(`章节「${chapterItem.title}」重复。`);
    chapterTitles.add(chapterItem.title);
  }
  const conclusion = (report.chapters || []).some((c) => /结论/.test(c.title));
  const notes = (report.chapters || []).some((c) => /说明与限制/.test(c.title));
  if (!conclusion) push('缺少「检测结论/核验结论」章节。');
  if (!notes) push('缺少「说明与限制」章节。');
  if (!/报告信息/.test((report.chapters || []).map((c) => c.title).join())) {
    // 表1 报告信息由渲染器从 meta 生成；meta 为空时提醒。
    if (!report.meta?.length) push('报告信息（meta）为空。');
  }
  let images = 0, tables = 0;
  for (const chapterItem of report.chapters || []) {
    for (const block of chapterItem.blocks) {
      if (block.type === 'image') {
        images += 1;
        if (!/^data:image\/(?:png|jpeg|webp);base64,/.test(block.src) && !/^(https?:)?\//.test(block.src) && !/^[a-zA-Z]:[\\/]/.test(block.src) && !block.src.startsWith('file:')) {
          push(`图片 src 无法解析：${block.src.slice(0, 40)}`);
        }
      } else if (block.type === 'table') {
        tables += 1;
        if (block.columns.some((col) => !col.title)) push(`表「${block.caption}」存在空表头。`);
      }
    }
  }
  return { ok: problems.length === 0, problems, stats: { chapters: (report.chapters || []).length, images, tables } };
}

/** 汇总模型统计信息（供测试记录）。 */
export function stdReportStats(report) {
  return validateStdReport(report).stats;
}

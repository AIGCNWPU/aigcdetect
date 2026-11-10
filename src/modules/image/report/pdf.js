// Model -> PDF renderer built on the vendored pdf-lib runtime (see runtime.js).
// Layout follows the refund report conventions: A4, mixed CJK/Latin runs, tables
// split across pages with repeated headers, images embedded with optional
// tamper-region rectangles.

import { collectReportImages } from './model.js';

const TONES = {
  ok: { ink: [0.16, 0.43, 0.32], fill: [0.94, 0.975, 0.95] },
  warn: { ink: [0.6, 0.36, 0.11], fill: [1, 0.97, 0.92] },
  danger: { ink: [0.67, 0.24, 0.25], fill: [1, 0.95, 0.95] },
  neutral: { ink: [0.32, 0.39, 0.5], fill: [0.96, 0.97, 0.985] },
};

export function wrapReportText(text, font, size, width) {
  const lines = [];
  const clean = String(text ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\r\n?|\u2028|\u2029/g, '\n').replace(/\t/g, '    ');
  for (const paragraphText of clean.split('\n')) {
    let line = '';
    for (const token of paragraphText.match(/[A-Za-z0-9][A-Za-z0-9._%/@+/-]*|\s+|[^\s]/gu) || ['']) {
      if (font.widthOfTextAtSize(line + token, size) <= width) { line += token; continue; }
      if (/^[，。！？、；：）】》」』〕％%]$/.test(token) && line) {
        const chars = Array.from(line); const last = chars.pop();
        if (chars.length) lines.push(chars.join('').trimEnd());
        line = last + token; continue;
      }
      let opening = '';
      if (/^[（【《「『〔]$/.test(line)) { opening = Array.from(line).pop(); line = Array.from(line).slice(0, -1).join(''); }
      if (line.trim()) { lines.push(line.trimEnd()); line = ''; }
      const next = opening + token.trimStart();
      if (font.widthOfTextAtSize(next, size) <= width) { line = next; continue; }
      for (const ch of next) {
        if (font.widthOfTextAtSize(line + ch, size) > width && line) { lines.push(line); line = ''; }
        line += ch;
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

export function formatReportTime(value, { filename = false } = {}) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return filename ? 'current' : '未记录';
  // Manual UTC+8 formatting: Intl locale data varies across engines and systems.
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (part) => String(part).padStart(2, '0');
  const parts = { year: shifted.getUTCFullYear(), month: pad(shifted.getUTCMonth() + 1), day: pad(shifted.getUTCDate()), hour: pad(shifted.getUTCHours()), minute: pad(shifted.getUTCMinutes()), second: pad(shifted.getUTCSeconds()) };
  return filename ? `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}` : `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

export async function renderReportPdf(model, { PDFLib, fontkit, fontBytes, decodeImage, signal, onProgress = () => {} } = {}) {
  const check = () => signal?.throwIfAborted();
  check();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const cjk = await doc.embedFont(fontBytes, { subset: false });
  const latin = await doc.embedFont(StandardFonts.Helvetica);
  const latinBold = await doc.embedFont(StandardFonts.HelveticaBold);
  check();
  doc.setTitle(model.title); doc.setAuthor('VERITAS 智鉴'); doc.setCreator('VERITAS'); doc.setProducer('VERITAS'); doc.setLanguage('zh-CN');
  const created = new Date(model.generatedAt);
  if (Number.isFinite(created.getTime())) { doc.setCreationDate(created); doc.setModificationDate(created); }

  const W = 595.28, H = 841.89, M = 42, CW = W - 2 * M, BOTTOM = 56, TOP = H - 60;
  const colors = { ink: rgb(.13, .18, .28), muted: rgb(.44, .5, .57), accent: rgb(.42, .33, .65), line: rgb(.86, .88, .91), wash: rgb(.96, .97, .985), white: rgb(1, 1, 1), orange: rgb(.93, .53, .16) };
  const tone = (name) => { const value = TONES[name] || TONES.neutral; return { ink: rgb(...value.ink), fill: rgb(...value.fill) }; };
  let page, y;

  const runs = (text, strong = false) => {
    const result = [];
    for (const ch of String(text)) {
      const useFont = /^[\x20-\x7e]$/.test(ch) ? (strong ? latinBold : latin) : cjk;
      const last = result.at(-1);
      if (last?.font === useFont) last.text += ch; else result.push({ font: useFont, text: ch });
    }
    return result;
  };
  const measure = (text, size, strong = false) => runs(text, strong).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0);
  const metric = { widthOfTextAtSize: (text, size) => measure(text, size) };
  const wrap = (text, size, width) => wrapReportText(text, metric, size, width);

  function draw(value, x, top, { size = 10, color = colors.ink, strong = false } = {}) {
    let cursor = x;
    for (const run of runs(value, strong)) { page.drawText(run.text, { x: cursor, y: top - size, font: run.font, size, color }); cursor += run.font.widthOfTextAtSize(run.text, size); }
  }
  function center(value, x, top, options = {}) { draw(value, x - measure(value, options.size || 10, options.strong) / 2, top, options); }
  function rect(x, top, width, height, { fill = colors.white, border = colors.line, lineWidth = .5 } = {}) { page.drawRectangle({ x, y: top - height, width, height, color: fill, borderColor: border, borderWidth: lineWidth }); }
  function rounded(x, top, width, height, { fill = colors.wash, border = fill, radius = 6 } = {}) {
    const r = Math.min(radius, height / 2, width / 2);
    page.drawSvgPath(`M${r} 0H${width - r}Q${width} 0 ${width} ${r}V${height - r}Q${width} ${height} ${width - r} ${height}H${r}Q0 ${height} 0 ${height - r}V${r}Q0 0 ${r} 0Z`, { x, y: top - height, color: fill, borderColor: border, borderWidth: .5 });
  }
  function newPage() {
    page = doc.addPage([W, H]);
    y = TOP;
    draw('VERITAS', M, H - 26, { size: 9.5, strong: true, color: colors.accent });
    draw(`智鉴 · ${model.title}`, M + 96, H - 27, { size: 8, color: colors.muted });
    rounded(W - M - 30, H - 27, 30, 3, { fill: colors.accent, radius: 1.5 });
    page.drawLine({ start: { x: M, y: H - 44 }, end: { x: W - M, y: H - 44 }, thickness: .55, color: colors.line });
  }
  const ensure = (height) => { if (y - height < BOTTOM) newPage(); };
  function paragraphBlock(block) {
    for (const line of wrap(block.text, 9.6, CW)) { check(); ensure(15); draw(line, M, y, { size: 9.6 }); y -= 14.5; }
    y -= 6;
  }
  function sectionHeader(title, note) {
    ensure(40);
    rect(M, y - 2, 2, 11, { fill: colors.accent, border: colors.accent, lineWidth: 0 });
    draw(title, M + 9, y, { size: 11.5 });
    if (note) draw(note, W - M - measure(note, 8), y - 1, { size: 8, color: colors.muted });
    y -= 22;
  }
  function bannerBlock(block) {
    const style = tone(block.tone); const height = block.detail ? 58 : 44; ensure(height + 10);
    rounded(M, y, CW, height, { fill: style.fill });
    draw('核验结论', M + 14, y - 8, { size: 8.5, color: colors.muted });
    draw(block.title, M + 14, y - (block.detail ? 24 : 22), { size: 13.5, strong: true, color: style.ink });
    if (block.scoreText) draw(block.scoreText, W - M - 14 - measure(block.scoreText, 15, true), y - (block.detail ? 24 : 22), { size: 15, strong: true, color: style.ink });
    if (block.detail) {
      const lines = wrap(block.detail, 9, CW - 28).slice(0, 2);
      for (let i = 0; i < lines.length; i++) draw(lines[i], M + 14, y - 38 - i * 12, { size: 9, color: style.ink });
    }
    y -= height + 10;
  }
  function kvBlock(block) {
    const columnKey = 96, columnValue = CW - columnKey, size = 9.2, leading = 13.5, pad = 6;
    for (const [key, value] of block.rows) {
      const lines = wrap(value, size, columnValue - pad * 2);
      const height = Math.max(lines.length, 1) * leading + pad * 2 - 4;
      check(); ensure(height + 2);
      rect(M, y, CW, height);
      draw(key, M + pad, y - pad - 1, { size, color: colors.muted });
      for (let i = 0; i < lines.length; i++) draw(lines[i], M + columnKey + pad, y - pad - 1 - i * leading, { size });
      page.drawLine({ start: { x: M + columnKey, y: y }, end: { x: M + columnKey, y: y - height }, thickness: .4, color: colors.line });
      y -= height + 2;
    }
    y -= 8;
  }
  function tableBlock(block) {
    const size = 9, leading = 13, pad = 6;
    const headerHeight = 22;
    let headerShown = false;
    const header = () => { ensure(headerHeight + leading + pad); rect(M, y, CW, headerHeight, { fill: colors.wash }); let x = M; for (const col of block.columns) { draw(col.title, x + pad, y - 5, { size: 8.5, color: colors.muted, strong: true }); x += col.width; } y -= headerHeight; headerShown = true; };
    for (const row of block.rows) {
      const cells = row.cells.map((cell, index) => wrap(cell, size, block.columns[index].width - pad * 2));
      const total = Math.max(...cells.map((cellLines) => cellLines.length), 1);
      let offset = 0;
      while (offset < total) {
        check();
        if (!headerShown) header();
        const available = y - BOTTOM;
        const count = Math.min(total - offset, Math.floor((available - pad * 2) / leading));
        if (count < 1) { newPage(); headerShown = false; continue; }
        const height = count * leading + pad * 2 - 4;
        const style = tone(row.tone);
        rect(M, y, CW, height, { fill: row.tone ? style.fill : colors.white });
        let x = M;
        for (let col = 0; col < block.columns.length; col++) {
          if (col) page.drawLine({ start: { x, y }, end: { x, y: y - height }, thickness: .4, color: colors.line });
          const cellLines = cells[col].slice(offset, offset + count);
          if (col === 0 && offset > 0 && row.repeatLabel) { const repeated = wrap(`${row.repeatLabel}（续）`, size, block.columns[col].width - pad * 2).slice(0, count); for (let n = 0; n < repeated.length; n++) draw(repeated[n], x + pad, y - pad - 1 - n * leading, { size }); }
          else for (let n = 0; n < cellLines.length; n++) draw(cellLines[n], x + pad, y - pad - 1 - n * leading, { size, color: col === 0 && row.tone ? style.ink : colors.ink });
          x += block.columns[col].width;
        }
        y -= height + 2; offset += count;
        if (offset < total) { newPage(); headerShown = false; }
      }
    }
    y -= 8;
  }
  function listBlock(block) {
    for (const item of block.items) {
      const style = tone(item.tone);
      const detailLines = item.detail ? wrap(item.detail, 8.8, CW - 58) : [];
      const height = 14 + detailLines.length * 12 + 8;
      check(); ensure(height + 6);
      rounded(M, y, CW, height, { fill: colors.white });
      rect(M, y - 4, 3, height - 8, { fill: style.ink, border: style.ink, lineWidth: 0 });
      draw(item.title, M + 14, y - 7, { size: 9.6, strong: true, color: style.ink });
      for (let i = 0; i < detailLines.length; i++) draw(detailLines[i], M + 14, y - 20 - i * 12, { size: 8.8, color: colors.muted });
      y -= height + 6;
    }
    y -= 4;
  }
  async function imageItem(item, x, top, width) {
    const decoded = await decodeImage(item.src, { signal });
    check();
    if (!decoded) {
      rect(x, top - 60, width, 60);
      center('图片不可用', x + width / 2, top - 32, { size: 9, color: colors.muted });
      return;
    }
    const embedded = decoded.type === 'image/jpeg' ? await doc.embedJpg(decoded.bytes) : await doc.embedPng(decoded.bytes);
    const height = width * (embedded.height / embedded.width);
    page.drawImage(embedded, { x, y: top - height, width, height });
    page.drawRectangle({ x, y: top - height, width, height, borderColor: colors.line, borderWidth: .6 });
    for (const region of item.regions) {
      page.drawRectangle({
        x: x + region.x * width, y: top - height + region.y * height,
        width: Math.max(2, region.width * width), height: Math.max(2, region.height * height),
        borderColor: colors.orange, borderWidth: 1.4,
      });
    }
    if (item.caption) {
      const lines = wrap(item.caption, 8.2, width).slice(0, 2);
      for (let i = 0; i < lines.length; i++) draw(lines[i], x, top - height - 8 - i * 10, { size: 8.2, color: colors.muted });
    }
  }
  async function imagesBlock(block, progressBase) {
    const step = block.layout === 'pair' ? 2 : 1;
    const slotWidth = block.layout === 'pair' ? (CW - 12) / 2 : Math.min(CW, 400);
    const maxBody = 600;
    for (let index = 0; index < block.items.length; index += step) {
      const group = block.items.slice(index, index + step);
      check();
      const prepared = [];
      for (const item of group) {
        const decoded = await decodeImage(item.src, { signal });
        check();
        if (!decoded) { prepared.push({ item, width: slotWidth, height: 60, captionLines: 0, embedded: null }); continue; }
        const embedded = decoded.type === 'image/jpeg' ? await doc.embedJpg(decoded.bytes) : await doc.embedPng(decoded.bytes);
        let width = slotWidth, height = width * (embedded.height / embedded.width);
        if (height > maxBody) { height = maxBody; width = height * (embedded.width / embedded.height); }
        const captionLines = item.caption ? wrap(item.caption, 8.2, slotWidth).slice(0, 2).length : 0;
        prepared.push({ item, width, height, captionLines, embedded });
      }
      const groupHeight = Math.max(...prepared.map((prep) => prep.height + 12 + prep.captionLines * 10));
      ensure(Math.min(groupHeight + 8, maxBody + 80));
      const top = y;
      let maxDrop = 0;
      for (let slot = 0; slot < prepared.length; slot++) {
        const prep = prepared[slot];
        const x = M + slot * (slotWidth + 12) + (slotWidth - prep.width) / 2;
        if (prep.embedded) {
          page.drawImage(prep.embedded, { x, y: top - prep.height, width: prep.width, height: prep.height });
          page.drawRectangle({ x, y: top - prep.height, width: prep.width, height: prep.height, borderColor: colors.line, borderWidth: .6 });
          for (const region of prep.item.regions) {
            page.drawRectangle({
              x: x + region.x * prep.width, y: top - prep.height + region.y * prep.height,
              width: Math.max(2, region.width * prep.width), height: Math.max(2, region.height * prep.height),
              borderColor: colors.orange, borderWidth: 1.4,
            });
          }
        } else {
          rect(x, top - 60, prep.width, 60);
          center('图片不可用', x + prep.width / 2, top - 32, { size: 9, color: colors.muted });
        }
        if (prep.item.caption) {
          const lines = wrap(prep.item.caption, 8.2, slotWidth).slice(0, 2);
          for (let i = 0; i < lines.length; i++) draw(lines[i], M + slot * (slotWidth + 12), top - prep.height - 8 - i * 10, { size: 8.2, color: colors.muted });
        }
        maxDrop = Math.max(maxDrop, prep.height + 12 + prep.captionLines * 10);
      }
      y = top - maxDrop;
      onProgress({ phase: 'images', completed: progressBase + index + group.length, total: block.items.length + progressBase });
      y -= 14;
    }
    y -= 4;
  }

  newPage();
  draw('VERITAS 智鉴 · 检测报告', M, y, { size: 9, color: colors.accent, strong: true });
  y -= 22;
  draw(model.title, M, y, { size: 19, strong: true });
  y -= 18;
  if (model.subtitle) { draw(model.subtitle, M, y, { size: 9.5, color: colors.muted }); y -= 14; }
  draw(`生成时间：${formatReportTime(model.generatedAt)}`, M, y, { size: 8.5, color: colors.muted });
  y -= 16;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .6, color: colors.line });
  y -= 16;
  bannerBlock(model.verdict);

  let imagesDone = 0;
  for (const sectionItem of model.sections) {
    sectionHeader(sectionItem.title, sectionItem.note);
    for (const block of sectionItem.blocks) {
      check();
      if (block.type === 'paragraph') paragraphBlock(block);
      else if (block.type === 'kv') kvBlock(block);
      else if (block.type === 'table') tableBlock(block);
      else if (block.type === 'list') listBlock(block);
      else if (block.type === 'banner') bannerBlock(block);
      else if (block.type === 'images') { await imagesBlock(block, imagesDone); imagesDone += block.items.length; }
    }
    y -= 6;
  }

  ensure(50);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: .5, color: colors.line });
  y -= 14;
  for (const note of model.footerNotes) {
    for (const line of wrap(note, 7.8, CW)) { ensure(11); draw(line, M, y, { size: 7.8, color: colors.muted }); y -= 10.5; }
  }
  return doc.save();
}

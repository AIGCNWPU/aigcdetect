// Model -> Word document (.doc). Word opens HTML saved with an .doc extension;
// images are embedded as data URLs so the file stays self-contained.

const toneColors = { ok: '#1e6e52', warn: '#995c1c', danger: '#aa3d3f', neutral: '#52648a' };
const toneFills = { ok: '#f0f9f4', warn: '#fff8ec', danger: '#fdf0f0', neutral: '#f4f6fa' };

function escapeReportHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function reportTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未记录';
  const shifted = new Date(date.getTime() + 8 * 3600 * 1000);
  const pad = (part) => String(part).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`;
}

export function renderReportWordHtml(model) {
  const blocks = (sectionItem) => sectionItem.blocks.map((block) => {
    if (block.type === 'banner') {
      return `<table border="0" cellpadding="10" cellspacing="0" width="100%" style="background:${toneFills[block.tone]};border:1px solid ${toneColors[block.tone]}"><tr><td><p style="margin:0;color:#8a94a6;font-size:9pt">核验结论</p><p style="margin:4pt 0 0"><b style="font-size:14pt;color:${toneColors[block.tone]}">${escapeReportHtml(block.title)}</b>${block.scoreText ? `<b style="font-size:14pt;color:${toneColors[block.tone]}">　${escapeReportHtml(block.scoreText)}</b>` : ''}</p>${block.detail ? `<p style="margin:6pt 0 0;font-size:10pt;color:${toneColors[block.tone]}">${escapeReportHtml(block.detail)}</p>` : ''}</td></tr></table><br>`;
    }
    if (block.type === 'kv') {
      return `<table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:10pt">${block.rows.map(([key, value]) => `<tr><td width="24%" style="background:#f5f6f8;color:#6b7688">${escapeReportHtml(key)}</td><td>${escapeReportHtml(value)}</td></tr>`).join('')}</table><br>`;
    }
    if (block.type === 'table') {
      return `<table border="1" cellpadding="6" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:10pt"><tr>${block.columns.map((col) => `<th style="background:#f5f6f8;color:#6b7688;text-align:left">${escapeReportHtml(col.title)}</th>`).join('')}</tr>${block.rows.map((row) => `<tr${row.tone ? ` style="background:${toneFills[row.tone]}"` : ''}>${row.cells.map((cell, index) => `<td${index === 0 && row.tone ? ` style="color:${toneColors[row.tone]}"` : ''}>${escapeReportHtml(cell)}</td>`).join('')}</tr>`).join('')}</table><br>`;
    }
    if (block.type === 'list') {
      return block.items.map((item) => `<table border="0" cellpadding="8" cellspacing="0" width="100%" style="border:1px solid #e3e6ec;border-left:4px solid ${toneColors[item.tone]}"><tr><td><b style="color:${toneColors[item.tone]};font-size:10.5pt">${escapeReportHtml(item.title)}</b>${item.detail ? `<p style="margin:4pt 0 0;font-size:9.5pt;color:#6b7688">${escapeReportHtml(item.detail)}</p>` : ''}</td></tr></table><div style="font-size:4pt"><br></div>`).join('');
    }
    if (block.type === 'images') {
      const width = block.layout === 'pair' ? '48%' : '82%';
      return `<table border="0" cellpadding="0" cellspacing="0" width="100%"><tr>${block.items.map((item) => `<td width="${width}" style="vertical-align:top;padding:4pt">${item.src.startsWith('data:') ? `<img src="${escapeReportHtml(item.src)}" width="${block.layout === 'pair' ? 300 : 460}" style="border:1px solid #dfe3ea">` : `<p style="font-size:9pt;color:#8a94a6">[图片未嵌入]</p>`}${item.caption ? `<p style="margin:4pt 0 0;font-size:9pt;color:#8a94a6">${escapeReportHtml(item.caption)}</p>` : ''}${item.regions.length ? `<p style="margin:2pt 0 0;font-size:8.5pt;color:#b06a1f">图中含 ${item.regions.length} 处疑似修改位置标记（见前端大图查看）</p>` : ''}</td>`).join('')}</tr></table><br>`;
    }
    if (block.type === 'paragraph') return `<p style="font-size:10pt;line-height:1.7">${escapeReportHtml(block.text)}</p><br>`;
    return '';
  }).join('');

  return `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${escapeReportHtml(model.title)}</title></head><body style="font-family:'Microsoft YaHei','PingFang SC',Arial,sans-serif;color:#22293a">
<p style="margin:0;color:#6b55a8;font-size:9pt"><b>VERITAS 智鉴 · 检测报告</b></p>
<h1 style="font-size:20pt;margin:8pt 0">${escapeReportHtml(model.title)}</h1>
${model.subtitle ? `<p style="margin:0 0 6pt;color:#6b7688;font-size:10pt">${escapeReportHtml(model.subtitle)}</p>` : ''}
<p style="margin:0;color:#8a94a6;font-size:9pt">生成时间：${escapeReportHtml(reportTime(model.generatedAt))}</p>
<hr>
${blocks({ blocks: [model.verdict] })}
${model.sections.map((sectionItem) => `<h2 style="font-size:13.5pt;border-left:4px solid #6b55a8;padding-left:8pt;margin:18pt 0 8pt">${escapeReportHtml(sectionItem.title)}${sectionItem.note ? `<span style="font-size:9pt;color:#8a94a6;font-weight:normal">　${escapeReportHtml(sectionItem.note)}</span>` : ''}</h2>${blocks(sectionItem)}`).join('')}
<hr>
${model.footerNotes.map((note) => `<p style="font-size:8.5pt;color:#8a94a6;margin:3pt 0">${escapeReportHtml(note)}</p>`).join('')}
</body></html>`;
}

export function downloadReportWord(model, filename) {
  const html = renderReportWordHtml(model);
  const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.doc') ? filename : `${filename}.doc`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

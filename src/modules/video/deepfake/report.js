import { RISK_LABELS, escapeText, formatBytes, formatDateTime, formatDuration, formatProbability, formatTimecode } from './model.js';

const RISK_CLASS = { low: 'low', medium: 'medium', high: 'high', unknown: 'unknown' };

function riskBadge(risk) {
  return `<span class="risk ${RISK_CLASS[risk]}">${RISK_LABELS[risk]}</span>`;
}

function probabilityChartMarkup(result) {
  const raw = result.aiProbability;
  if (raw === null || raw === undefined) return '';
  const value = Number(raw);
  if (!Number.isFinite(value)) return '';
  const percent = Math.max(0, Math.min(1, value));
  const aiPercent = Number((percent * 100).toFixed(1));
  const otherPercent = Number(Math.max(0, 100 - aiPercent).toFixed(1));
  const aiText = formatProbability(percent);
  const otherText = `${otherPercent.toFixed(1)}%`;
  const radius = 16;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * percent;
  const fill = percent > 0
    ? `<circle class="probability-ring-fill" cx="21" cy="21" r="${radius}" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 21 21)"></circle>`
    : '';
  return `<div class="probability-chart" data-risk="${escapeText(result.risk)}" role="group" aria-label="AI概率构成">
    <div class="probability-donut">
      <svg viewBox="0 0 42 42" aria-hidden="true" focusable="false">
        <circle class="probability-ring-track" cx="21" cy="21" r="${radius}"></circle>
        ${fill}
      </svg>
      <span class="probability-center"><strong>${aiText}</strong><small>AI概率</small></span>
    </div>
    <div class="probability-legend">
      <p><i class="probability-swatch ai"></i><span>AI生成</span><strong>${aiText}</strong></p>
      <p><i class="probability-swatch rest"></i><span>非AI / 其他</span><strong>${otherText}</strong></p>
    </div>
  </div>`;
}

function allSegments(result) {
  return (result.persons || [])
    .flatMap(person => person.segments.map(segment => ({ ...segment, personLabel: person.label })))
    .sort((left, right) => left.start - right.start || left.end - right.end);
}

function allFrames(result) {
  return (result.persons || [])
    .flatMap(person => person.frames.map(frame => ({ ...frame, personLabel: person.label })))
    .sort((left, right) => left.time - right.time);
}

function frameFigure(frame, sample) {
  const imageLabel = sample ? '样例人脸画面' : '人脸画面';
  const image = frame.image
    ? `<img src="${escapeText(frame.image)}" alt="${escapeText(`${imageLabel}：${frame.caption}`)}">`
    : '<div class="no-image">未提供画面</div>';
  return `<figure class="frame">
    <div class="frame-media">${image}<span class="frame-time">${formatTimecode(frame.time)}</span></div>
    <figcaption><span class="risk ${RISK_CLASS[frame.risk]}">${RISK_LABELS[frame.risk]}</span><span class="frame-person">${escapeText(frame.personLabel)}</span><p>${escapeText(frame.caption)}</p></figcaption>
  </figure>`;
}

function segmentsTable(segments) {
  if (!segments.length) {
    return '<p class="empty">未发现可定位的可疑时间段。该结论不代表视频中其他人物或未处理部分安全。</p>';
  }
  return `<table>
    <thead><tr><th>#</th><th>人物</th><th>时间段</th><th>风险</th><th>线索说明</th></tr></thead>
    <tbody>${segments.map((segment, index) => {
      const clue = segment.explanation
        ? `视觉复核：${segment.explanation}`
        : [segment.signals.length ? segment.signals.join('、') : '', segment.summary].filter(Boolean).join('；');
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeText(segment.personLabel)}</td>
        <td class="mono">${formatTimecode(segment.start)} – ${formatTimecode(segment.end)}</td>
        <td>${riskBadge(segment.risk)}</td>
        <td>${escapeText(clue)}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

function personsTable(persons) {
  if (!persons.length) return '';
  return `<section><h2>人物汇总（${persons.length} 人）</h2><table>
    <thead><tr><th>人物</th><th>风险</th><th>出现时间</th></tr></thead>
    <tbody>${persons.map(person => `<tr>
      <td>${escapeText(person.label)}</td>
      <td>${riskBadge(person.risk)}</td>
      <td class="mono">${formatTimecode(person.firstSeen)} – ${formatTimecode(person.lastSeen)}</td>
    </tr>`).join('')}</tbody>
  </table></section>`;
}

export function buildReportHtml({ task, result, generatedAt = new Date() }) {
  const sampled = Boolean(task.sample);
  const taskName = escapeText(task.name);
  const riskLabel = RISK_LABELS[result.risk];
  const marker = result.aiGeneratedMarker?.detected ? result.aiGeneratedMarker : null;
  const visualMarker = result.visualAiMarker?.detected ? result.visualAiMarker : null;
  const markerMarkers = marker && Array.isArray(marker.markers) ? marker.markers : [];
  const markerEvidence = marker
    ? [
        marker.source ? `来源：${escapeText(marker.source)}` : '',
        marker.value
          ? `内容：${escapeText(marker.value)}`
          : markerMarkers.length
            ? `匹配标识：${escapeText(markerMarkers.join('、'))}`
            : '',
      ].filter(Boolean).join('<br>')
    : '';
  const metadataSection = marker
    ? `<section><h2>元数据标识</h2><p class="summary">${markerEvidence || '文件元数据包含AI生成标识。'}</p></section>`
    : '';
  const visualEvidence = visualMarker
    ? [
        visualMarker.time !== undefined ? `画面时间：${formatTimecode(visualMarker.time)}` : '',
        visualMarker.text ? `标识文字：${escapeText(visualMarker.text)}` : '',
        visualMarker.location ? `位置：${escapeText(visualMarker.location)}` : '',
        Number.isFinite(visualMarker.confidence)
          ? `置信度：${Math.round(visualMarker.confidence * 100)}%`
          : '',
      ].filter(Boolean).join('<br>')
    : '';
  const visualSection = visualMarker
    ? `<section><h2>画面标识</h2><p class="summary">${visualEvidence || '画面中出现AI生成标识。'}</p></section>`
    : '';
  const resolution = task.meta?.width && task.meta?.height ? `${task.meta.width} × ${task.meta.height}` : '未记录';
  const size = Number(task.meta?.size) > 0 ? formatBytes(task.meta.size) : '未记录';
  const detectionTime = task.completedAt || task.createdAt || '未记录';
  const segments = allSegments(result);
  const frames = allFrames(result);
  const findings = result.findings.length
    ? `<section><h2>主要线索</h2><ul class="findings">${result.findings.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul></section>`
    : '';
  const hasReview = result.findings.some(item => item.startsWith('视觉复核'))
    || result.persons.some(person => person.segments.some(segment => segment.explanation));
  const reviewNote = hasReview
    ? '<section><h2>画面复核说明</h2><p class="summary">可疑时间段的“视觉复核”说明由视觉模型基于人脸画面生成，仅作辅助线索，需结合原视频和人工核查。</p></section>'
    : '';
  const personTable = personsTable(result.persons);
  const noPersons = result.persons.length
    ? ''
    : marker
      ? `<section><h2>文件元数据已标记为AI生成</h2>
        <p class="summary">模型检测未识别到可用于分析的人脸画面，但文件元数据包含AI生成标识，综合风险直接判定为高风险。</p></section>`
      : visualMarker
        ? `<section><h2>画面中出现AI生成标识</h2>
          <p class="summary">模型检测未识别到可用于分析的人脸画面，但画面已出现AI生成标识，综合风险直接判定为高风险。</p></section>`
        : `<section><h2>未识别到可用于检测的人物画面</h2>
          <p class="summary">本次处理未识别到可用于换脸与面部合成检测的人脸画面。系统不会据此输出低风险结论；请更换更清晰、人物正面可见的视频后重新检测。</p>
          <p class="caution">结论状态：无法判断。未检测到人脸不等于视频真实，也不等于其他画面安全。</p></section>`;
  const coverageCaution = result.coverage === 'partial'
    ? '<p class="caution">本次检测仅覆盖已分析的人脸画面；未覆盖部分不代表安全。</p>'
    : '';
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>人物换脸与深度伪造检测报告 · ${taskName}</title>
<style>
  :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#1f2b31;background:#f3f6f7}
  *{box-sizing:border-box}body{margin:0;padding:32px 18px;background:#f3f6f7;line-height:1.65}
  .page{max-width:1020px;margin:auto;background:#fff;border-radius:20px;padding:40px 44px;box-shadow:0 18px 60px #20343b12}
  .toolbar{max-width:1020px;margin:0 auto 14px;display:flex;justify-content:flex-end}
  .toolbar button{font:inherit;font-size:13px;border:1px solid #cbdcdd;background:#fff;color:#315a5a;padding:9px 15px;border-radius:8px;cursor:pointer}
  .brand{display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid #e4ecee;padding-bottom:20px}
  .brand strong{font-size:17px;letter-spacing:.06em}.brand span{font-size:12px;color:#78868d}
  h1{font-size:27px;letter-spacing:-.02em;margin:26px 0 7px}.file{font-size:13px;color:#728087;overflow-wrap:anywhere}
  .sample{margin-top:20px;padding:12px 15px;border:1px solid #eedfba;background:#fdf7e8;border-radius:9px;color:#7d6428;font-size:12px}
  .sample strong{display:block;font-size:12px;margin-bottom:2px}
  .overview{display:grid;grid-template-columns:1.2fr 1fr;gap:18px;margin:24px 0}
  .risk-card{border:1px solid #e4ecee;border-radius:14px;padding:20px;background:#f9fcfc}
  .risk-card small,.meta-grid small{font-size:11px;color:#7c8a91;letter-spacing:.04em}
  .risk-badge{display:inline-block;margin-top:9px;padding:6px 12px;border-radius:999px;font-size:13px;font-weight:650}
  .risk-badge.high{background:#fbeceb;color:#a74439}.risk-badge.medium{background:#fdf3df;color:#9a6a20}.risk-badge.low{background:#e8f5ee;color:#2d7053}.risk-badge.unknown{background:#eef1f3;color:#68747b}
  .marker-tag{display:inline-block;margin:9px 0 0 8px;padding:3px 8px;border-radius:999px;background:#e8f1fb;color:#315a9a;font-size:11px}
  .marker-tag.visual{background:#f3ecfb;color:#6a4a9a}
  .probability-chart{--prob-color:#278a86;display:flex;align-items:center;gap:16px;margin-top:14px;padding:11px 13px;background:#f7fbfb;border:1px solid #e8f0f0;border-radius:12px}
  .probability-chart[data-risk="high"]{--prob-color:#d35a4f}
  .probability-chart[data-risk="medium"]{--prob-color:#d09a40}
  .probability-chart[data-risk="low"]{--prob-color:#5b9b7d}
  .probability-donut{position:relative;width:88px;height:88px;flex:none}
  .probability-donut svg{display:block;width:100%;height:100%}
  .probability-ring-track{fill:none;stroke:#e2ebec;stroke-width:7}
  .probability-ring-fill{fill:none;stroke:var(--prob-color);stroke-width:7}
  .probability-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;text-align:center}
  .probability-center strong{font-size:19px;font-weight:650;letter-spacing:-.02em;color:#233c3d;font-variant-numeric:tabular-nums}
  .probability-center small{font-size:9px;color:#7a898f;letter-spacing:.04em}
  .probability-legend{flex:1;display:flex;flex-direction:column;gap:7px;min-width:0}
  .probability-legend p{display:flex;align-items:center;gap:7px;margin:0;font-size:11.5px;color:#5d6d74}
  .probability-legend strong{margin-left:auto;font-size:13px;color:#2e4649;font-variant-numeric:tabular-nums}
  .probability-swatch{width:8px;height:8px;border-radius:50%;flex:none}
  .probability-swatch.ai{background:var(--prob-color)}
  .probability-swatch.rest{background:#e2ebec}
  .summary{font-size:13px;line-height:1.85;margin-top:12px}
  .risk{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;white-space:nowrap}
  .risk.high{background:#fbeceb;color:#a74439}.risk.medium{background:#fdf3df;color:#9a6a20}.risk.low{background:#e8f5ee;color:#2d7053}.risk.unknown{background:#eef1f3;color:#68747b}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;border:1px solid #e4ecee;border-radius:14px;padding:20px}
  .meta-grid div{min-width:0}.meta-grid span{display:block;font-size:12.5px;margin-top:3px;overflow-wrap:anywhere}
  section{margin-top:26px}h2{font-size:15px;margin:0 0 12px;letter-spacing:.01em}
  .findings{list-style:none;padding:0;margin:0;display:grid;gap:7px}.findings li{position:relative;padding-left:16px;font-size:12.5px;color:#4e5d64}.findings li::before{content:"";position:absolute;left:2px;top:8px;width:5px;height:5px;border-radius:50%;background:#278a86}
  table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;padding:10px 9px;border-bottom:1px solid #e8eff0}th{color:#7a888f;font-weight:550;font-size:11px;letter-spacing:.03em}td.mono{font-variant-numeric:tabular-nums;white-space:nowrap;color:#3a4c53}
  .frames{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.frame{margin:0;border:1px solid #e4ecee;border-radius:10px;overflow:hidden}
  .frame-media{position:relative;aspect-ratio:4/3;background:#eef3f4}.frame-media img{width:100%;height:100%;object-fit:cover;display:block}.no-image{display:grid;place-items:center;height:100%;font-size:11px;color:#8b999f}
  .frame-time{position:absolute;left:7px;bottom:7px;background:#081417b8;color:#fff;font-size:10px;border-radius:4px;padding:2px 5px;font-variant-numeric:tabular-nums}
  figcaption{padding:9px 10px;font-size:11px;line-height:1.6;color:#5d6b72}figcaption p{margin:6px 0 0}.frame-person{font-size:10px;color:#7b898f;margin-left:6px}
  .empty{font-size:12.5px;color:#75838a;background:#f7fafb;border:1px dashed #dbe5e7;border-radius:10px;padding:18px}
  .caution{margin-top:10px;font-size:11.5px;line-height:1.65;color:#8a6b20;background:#fdf7e8;border:1px solid #f0e3c3;border-radius:7px;padding:8px 10px}
  footer{margin-top:32px;padding-top:16px;border-top:1px solid #e4ecee;display:flex;justify-content:space-between;gap:16px;font-size:11px;color:#8a979d}
  @media(max-width:760px){.page{padding:26px 20px;border-radius:14px}.overview{grid-template-columns:1fr}.meta-grid{grid-template-columns:1fr}.frames{grid-template-columns:repeat(2,minmax(0,1fr))}body{padding:16px 10px}.brand{align-items:flex-start;flex-direction:column;gap:6px}h1{font-size:23px}.probability-chart{gap:12px;padding:10px}.probability-donut{width:76px;height:76px}.probability-center strong{font-size:17px}}
  @media print{body{padding:0;background:#fff}.page{box-shadow:none;border-radius:0;padding:24px;max-width:none}.toolbar{display:none}.frame,tr{break-inside:avoid}}
</style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">打印 / 另存为 PDF</button></div>
  <main class="page">
    <header class="brand"><strong>VERITAS 智鉴</strong><span>AI 视频检测 · 人物换脸与深度伪造检测</span></header>
    <h1>人物换脸与深度伪造检测报告</h1>
    <p class="file">${taskName} · ${escapeText(detectionTime)}</p>
    ${sampled ? '<div class="sample"><strong>样例数据</strong>本报告中的画面与检测结论均为界面演示用虚构样例，不代表真实检测结果。</div>' : ''}
    <div class="overview">
      <section class="risk-card">
        <small>综合风险</small>
        <div class="risk-badge ${RISK_CLASS[result.risk]}">${riskLabel}</div>
        ${marker ? '<span class="marker-tag">元数据标记AI生成</span>' : ''}
        ${visualMarker ? '<span class="marker-tag visual">画面标识AI生成</span>' : ''}
        ${probabilityChartMarkup(result)}
        <p class="summary">${escapeText(result.summary)}</p>
        ${coverageCaution}
      </section>
      <div class="meta-grid">
        <div><small>视频时长</small><span>${formatDuration(result.duration)}</span></div>
        <div><small>视频大小</small><span>${size}</span></div>
        <div><small>画面尺寸</small><span>${resolution}</span></div>
        <div><small>结果来源</small><span>${sampled ? '样例数据（虚构）' : '检测服务返回'}</span></div>
      </div>
    </div>
    ${metadataSection}
    ${visualSection}
    ${reviewNote}
    ${findings}
    ${personTable}
    ${noPersons}
    <section><h2>可疑时间段（${segments.length}）</h2>${segmentsTable(segments)}</section>
    <section><h2>代表画面（${frames.length}）</h2>${frames.length ? `<div class="frames">${frames.map(frame => frameFigure(frame, sampled)).join('')}</div>` : '<p class="empty">检测结果未提供代表画面。</p>'}</section>
    <footer><span>VERITAS 智鉴 · 让真实，有据可循。</span><span>导出时间：${escapeText(formatDateTime(generatedAt))}</span></footer>
  </main>
</body>
</html>`;
}

export function reportFileName(task, date = new Date()) {
  const base = String(task?.name || 'video')
    .replace(/\.(?:mp4|webm)$/i, '')
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'video';
  const pad = number => String(number).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  return `VERITAS-深度伪造检测报告-${base}-${stamp}.html`;
}

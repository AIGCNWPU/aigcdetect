import { COVERAGE_LABELS, RISK_LABELS, escapeText, formatBytes, formatDateTime, formatDuration, formatTimecode, resultStats } from './model.js';

const RISK_CLASS = { low: 'low', medium: 'medium', high: 'high', unknown: 'unknown' };

function riskBadge(risk) {
  return `<span class="risk ${RISK_CLASS[risk]}">${RISK_LABELS[risk]}</span>`;
}

function frameFigure(frame, sample) {
  const imageLabel = sample ? '样例人脸画面' : '人脸画面';
  const image = frame.image
    ? `<img src="${escapeText(frame.image)}" alt="${escapeText(`${imageLabel}：${frame.caption}`)}">`
    : '<div class="no-image">未提供画面</div>';
  const quality = frame.quality === null || frame.quality === undefined ? '' : `<span class="quality">清晰度 ${frame.quality}</span>`;
  return `<figure class="frame">
    <div class="frame-media">${image}<span class="frame-time">${formatTimecode(frame.time)}</span></div>
    <figcaption><span class="risk ${RISK_CLASS[frame.risk]}">${RISK_LABELS[frame.risk]}</span>${quality}<p>${escapeText(frame.caption)}</p></figcaption>
  </figure>`;
}

function segmentsTable(person) {
  if (!person.segments.length) {
    return '<p class="empty">该人物未发现可定位的可疑时间段。该结论仅覆盖上方检测范围，不代表视频中其他人物或未处理部分安全。</p>';
  }
  return `<table>
    <thead><tr><th>#</th><th>时间段</th><th>风险</th><th>面部合成线索</th><th>说明</th></tr></thead>
    <tbody>${person.segments.map((segment, index) => `<tr>
      <td>${index + 1}</td>
      <td class="mono">${formatTimecode(segment.start)} – ${formatTimecode(segment.end)}</td>
      <td>${riskBadge(segment.risk)}</td>
      <td>${segment.signals.length ? escapeText(segment.signals.join('、')) : '未提供'}</td>
      <td>${escapeText(segment.summary)}</td>
    </tr>`).join('')}</tbody>
  </table>`;
}

function personSection(person, sample) {
  const coverage = COVERAGE_LABELS[person.coverage] || '未说明';
  const findings = person.findings.length
    ? `<ul class="findings">${person.findings.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul>`
    : '<p class="empty">该人物未提供补充线索。</p>';
  return `<section class="person">
    <div class="person-head">
      <h2>${escapeText(person.label)}</h2>
      <span class="person-tags">${riskBadge(person.risk)}<span class="coverage">${coverage}</span></span>
    </div>
    <p class="summary">${escapeText(person.summary)}</p>
    <div class="person-meta">
      <span>出现时间：${formatTimecode(person.firstSeen)} – ${formatTimecode(person.lastSeen)}</span>
      <span>可用人脸画面：${person.faceFrames} 帧</span>
      <span>代表画面：${person.frames.length} 张</span>
      <span>可疑片段：${person.segments.length} 段</span>
    </div>
    ${person.coverage === 'partial' ? '<p class="caution">该人物仅有部分出现区间完成检测，未检测部分不代表安全。</p>' : ''}
    <h3>检测线索</h3>
    ${findings}
    <h3>可疑时间段（${person.segments.length}）</h3>
    ${segmentsTable(person)}
    <h3>人脸画面（${person.frames.length}）</h3>
    ${person.frames.length ? `<div class="frames">${person.frames.map(frame => frameFigure(frame, sample)).join('')}</div>` : '<p class="empty">未提供该人物的人脸画面。</p>'}
  </section>`;
}

function personsTable(persons) {
  if (!persons.length) return '';
  return `<section><h2>人物汇总</h2><table>
    <thead><tr><th>人物</th><th>风险</th><th>覆盖</th><th>出现时间</th><th>可用人脸</th><th>可疑片段</th></tr></thead>
    <tbody>${persons.map(person => `<tr>
      <td>${escapeText(person.label)}</td>
      <td>${riskBadge(person.risk)}</td>
      <td>${COVERAGE_LABELS[person.coverage] || '未说明'}</td>
      <td class="mono">${formatTimecode(person.firstSeen)} – ${formatTimecode(person.lastSeen)}</td>
      <td>${person.faceFrames} 帧</td>
      <td>${person.segments.length} 段</td>
    </tr>`).join('')}</tbody>
  </table></section>`;
}

export function buildReportHtml({ task, result, generatedAt = new Date() }) {
  const sampled = Boolean(task.sample);
  const taskName = escapeText(task.name);
  const stats = resultStats(result);
  const coverageLabel = result.coverage === 'full' ? '全片' : '部分覆盖';
  const resolution = task.meta?.width && task.meta?.height ? `${task.meta.width} × ${task.meta.height}` : '未记录';
  const size = Number(task.meta?.size) > 0 ? formatBytes(task.meta.size) : '未记录';
  const materialVersion = escapeText(task.material?.version || '未记录');
  const detectionTime = task.completedAt || task.createdAt || '未记录';
  const findings = result.findings.length
    ? `<section><h2>综合线索</h2><ul class="findings">${result.findings.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul></section>`
    : '';
  const personSections = result.persons.length
    ? result.persons.map(person => personSection(person, sampled)).join('')
    : `<section class="person"><h2>未识别到可用于检测的人物画面</h2>
      <p class="summary">本次处理未识别到可用于换脸与面部合成检测的人脸画面。系统不会据此输出低风险结论；请更换更清晰、人物正面可见的视频后重新检测。</p>
      <p class="caution">结论状态：无法判断。未检测到人脸不等于视频真实，也不等于其他画面安全。</p></section>`;
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
  .summary{font-size:13px;line-height:1.85;margin-top:12px}
  .risk{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;white-space:nowrap}
  .risk.high{background:#fbeceb;color:#a74439}.risk.medium{background:#fdf3df;color:#9a6a20}.risk.low{background:#e8f5ee;color:#2d7053}.risk.unknown{background:#eef1f3;color:#68747b}
  .meta-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;border:1px solid #e4ecee;border-radius:14px;padding:20px}
  .meta-grid div{min-width:0}.meta-grid span{display:block;font-size:12.5px;margin-top:3px;overflow-wrap:anywhere}
  section{margin-top:26px}h2{font-size:16px;margin:0 0 12px;letter-spacing:.01em}h3{font-size:13px;margin:20px 0 9px;color:#4a5a61}
  .findings{list-style:none;padding:0;margin:0;display:grid;gap:7px}.findings li{position:relative;padding-left:16px;font-size:12.5px;color:#4e5d64}.findings li::before{content:"";position:absolute;left:2px;top:8px;width:5px;height:5px;border-radius:50%;background:#278a86}
  table{width:100%;border-collapse:collapse;font-size:12px}th,td{text-align:left;vertical-align:top;padding:10px 9px;border-bottom:1px solid #e8eff0}th{color:#7a888f;font-weight:550;font-size:11px;letter-spacing:.03em}td.mono{font-variant-numeric:tabular-nums;white-space:nowrap;color:#3a4c53}
  .person{border-top:1px solid #e4ecee;padding-top:22px}
  .person:first-of-type{border-top:0;padding-top:0}
  .person-head{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
  .person-head h2{margin:0}.person-tags{display:flex;align-items:center;gap:7px}.coverage{font-size:11px;color:#5f6e76;background:#f3f7f8;border:1px solid #e3ebec;border-radius:999px;padding:2px 8px}
  .person-meta{display:flex;flex-wrap:wrap;gap:5px 16px;margin-top:9px;font-size:11.5px;color:#6f7d84}
  .caution{margin-top:10px;font-size:11.5px;line-height:1.65;color:#8a6b20;background:#fdf7e8;border:1px solid #f0e3c3;border-radius:7px;padding:8px 10px}
  .frames{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.frame{margin:0;border:1px solid #e4ecee;border-radius:10px;overflow:hidden}
  .frame-media{position:relative;aspect-ratio:4/3;background:#eef3f4}.frame-media img{width:100%;height:100%;object-fit:cover;display:block}.no-image{display:grid;place-items:center;height:100%;font-size:11px;color:#8b999f}
  .frame-time{position:absolute;left:7px;bottom:7px;background:#081417b8;color:#fff;font-size:10px;border-radius:4px;padding:2px 5px;font-variant-numeric:tabular-nums}
  figcaption{padding:9px 10px;font-size:11px;line-height:1.6;color:#5d6b72}figcaption p{margin:6px 0 0}.quality{font-size:10px;color:#7b898f;margin-left:6px}
  .empty{font-size:12.5px;color:#75838a;background:#f7fafb;border:1px dashed #dbe5e7;border-radius:10px;padding:18px}
  footer{margin-top:32px;padding-top:16px;border-top:1px solid #e4ecee;display:flex;justify-content:space-between;gap:16px;font-size:11px;color:#8a979d}
  @media(max-width:760px){.page{padding:26px 20px;border-radius:14px}.overview{grid-template-columns:1fr}.meta-grid{grid-template-columns:1fr}.frames{grid-template-columns:repeat(2,minmax(0,1fr))}body{padding:16px 10px}.brand{align-items:flex-start;flex-direction:column;gap:6px}h1{font-size:23px}}
  @media print{body{padding:0;background:#fff}.page{box-shadow:none;border-radius:0;padding:24px;max-width:none}.toolbar{display:none}.frame,tr,.person{break-inside:avoid}}
</style>
</head>
<body>
  <div class="toolbar"><button type="button" onclick="window.print()">打印 / 另存为 PDF</button></div>
  <main class="page">
    <header class="brand"><strong>VERITAS 智鉴</strong><span>AI 视频检测 · 人物换脸与深度伪造检测</span></header>
    <h1>人物换脸与深度伪造检测报告</h1>
    <p class="file">${taskName} · ${escapeText(detectionTime)} · 材料版本 ${materialVersion}</p>
    ${sampled ? '<div class="sample"><strong>样例数据</strong>本报告中的画面与检测结论均为界面演示用虚构样例，不代表真实检测结果。</div>' : ''}
    <div class="overview">
      <section class="risk-card">
        <small>综合风险</small>
        <div class="risk-badge ${RISK_CLASS[result.risk]}">${RISK_LABELS[result.risk]}</div>
        <p class="summary">${escapeText(result.summary)}</p>
      </section>
      <div class="meta-grid">
        <div><small>检测覆盖</small><span>${coverageLabel}</span></div>
        <div><small>视频时长</small><span>${formatDuration(result.duration)}</span></div>
        <div><small>视频大小</small><span>${size}</span></div>
        <div><small>画面尺寸</small><span>${resolution}</span></div>
        <div><small>采样画面</small><span>${result.sampledFrames} 帧</span></div>
        <div><small>可用人脸画面</small><span>${result.faceFrames} 帧</span></div>
        <div><small>识别人物</small><span>${stats.persons} 人</span></div>
        <div><small>可疑片段</small><span>${stats.segments} 段</span></div>
        <div><small>结果来源</small><span>${sampled ? '样例数据（虚构）' : '检测服务返回'}</span></div>
      </div>
    </div>
    <section><h2>检测范围</h2><p class="summary">${escapeText(result.scope)}</p></section>
    ${findings}
    ${personsTable(result.persons)}
    ${personSections}
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

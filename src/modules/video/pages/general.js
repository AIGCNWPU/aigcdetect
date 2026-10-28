import { icon } from '../../../icons.js';
import { RISK_LABELS, STATUS_LABELS, escapeText, formatBytes, formatDateTime, formatDuration, formatTimecode, riskLevel, validateVideoFile } from '../general/model.js';
import { videoGeneralDetection } from '../general/detection.js';
import { initVideoGeneralBackend } from '../general/backend.js';
import { createVideoGeneralSamples } from '../general/sample.js';
import { buildReportHtml, reportFileName } from '../general/report.js';

const REPORT_STORAGE_KEY = 'veritas.video.general.reports.v1';

const glyph = {
  upload: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M5 15v4h14v-4"/></svg>',
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>',
  pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  film: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/></svg>',
  save: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>',
  alert: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19z"/><path d="M12 9v5m0 3v.01"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 5v6h-6"/></svg>',
  volume: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  muted: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 4 6m0-6-4 6"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.7 12a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7"/><path d="M10 11v6M14 11v6"/></svg>',
};

function shell() {
  return `<div class="vg" data-vg>
    <header class="vg-lead">
      <div class="vg-lead-copy">
        <div class="vg-lead-title"><h2>视频检测工作台</h2><span class="vg-kicker">3.1 · VIDEO INTELLIGENCE</span></div>
        <p>上传视频后采样画面、汇总来源风险，并把可疑线索定位到具体时间段。</p>
      </div>
      <div class="vg-lead-actions">
        <button type="button" class="vg-btn vg-btn-quiet vg-jump" data-jump-result>查看检测结果 ${icon('arrow')}</button>
        <div class="vg-service-state" data-service-state></div>
      </div>
    </header>
    <div class="vg-demo-note" data-demo-note role="note"></div>
    <div class="vg-entry">
      <section class="vg-card vg-upload-card" aria-labelledby="vg-upload-title">
        <div class="vg-card-head">
          <div><p class="vg-step">01 · 视频材料</p><h3 id="vg-upload-title">上传待检测视频</h3></div>
          <span class="vg-limit">MP4 / WebM · ≤ 500 MiB</span>
        </div>
        <div data-upload-empty>
          <div class="vg-dropzone" data-drop>
            <span class="vg-drop-icon">${glyph.upload}</span>
            <strong>将视频拖到这里</strong>
            <span>或从本机选择视频文件</span>
            <button type="button" class="vg-btn vg-btn-secondary" data-choose>选择视频</button>
            <small>一次检测一个视频，提交本机部署的检测服务分析。</small>
          </div>
        </div>
        <input type="file" accept="video/mp4,video/webm,.mp4,.webm" data-file-input hidden aria-label="选择待检测视频">
        <div class="vg-reading" data-upload-busy hidden>
          <span class="vg-spinner" aria-hidden="true"></span>
          <div><strong>正在读取视频信息</strong><p>读取时长、画面尺寸并生成封面预览…</p></div>
        </div>
        <div class="vg-file" data-file hidden>
          <div class="vg-file-preview">
            <img data-file-poster alt="视频封面预览" hidden>
            <span class="vg-poster-fallback" data-file-fallback>${glyph.film}</span>
            <span class="vg-file-duration" data-file-duration></span>
          </div>
          <div class="vg-file-info">
            <strong data-file-name></strong>
            <p data-file-meta></p>
            <div class="vg-file-actions">
              <button type="button" class="vg-btn vg-btn-quiet" data-choose>更换视频</button>
              <button type="button" class="vg-btn vg-btn-quiet" data-remove>移除</button>
            </div>
          </div>
          <button type="button" class="vg-btn vg-btn-primary vg-detect" data-detect>开始检测</button>
          <div class="vg-file-facts">
            <div><span>视频时长</span><strong data-file-fact-duration></strong></div>
            <div><span>画面尺寸</span><strong data-file-fact-size></strong></div>
            <div><span>文件大小</span><strong data-file-fact-bytes></strong></div>
          </div>
        </div>
        <p class="vg-notice" data-upload-notice role="status" aria-live="polite" hidden></p>
        <p class="vg-local-note">${icon('shield')}<span>选择后在浏览器预览；开始检测后提交本机服务处理。</span></p>
      </section>
      <aside class="vg-card vg-history-card" aria-labelledby="vg-history-title">
        <div class="vg-card-head">
          <div><p class="vg-step">02 · 任务</p><h3 id="vg-history-title">检测任务</h3></div>
          <span class="vg-history-count" data-history-count></span>
        </div>
        <div class="vg-history" data-history role="group" aria-label="检测任务列表"></div>
        <p class="vg-history-note">样例任务用于界面预览；本页新发起的任务保存在当前会话。</p>
        <div class="vg-process" aria-label="检测流程">
          <span>上传视频</span><i></i><span>采样画面</span><i></i><span>定位片段</span><i></i><span>导出报告</span>
        </div>
      </aside>
    </div>
    <section class="vg-card vg-result-card" data-result-card aria-labelledby="vg-result-title">
      <div class="vg-result-head">
        <div>
          <p class="vg-step">03 · 检测结果</p>
          <h3 id="vg-result-title">检测概览</h3>
          <p class="vg-result-file" data-result-file></p>
        </div>
        <div class="vg-result-tags" data-result-tags></div>
      </div>
      <div data-result></div>
    </section>
  </div>`;
}

export function renderVideoGeneral(container) {
  container.classList.add('video-general-page');
  document.body.classList.add('video-general-route');
  container.innerHTML = shell();
  void initVideoGeneralBackend();
  const root = container.querySelector('[data-vg]');
  const resultHost = root.querySelector('[data-result]');
  const historyHost = root.querySelector('[data-history]');
  const samples = createVideoGeneralSamples();
  const state = {
    tasks: [...samples],
    selectedId: samples[0]?.id || null,
    upload: null,
    uploadBusy: false,
    currentTime: samples[0]?.sample ? (samples[0].result?.frames?.[0]?.time || 0) : 0,
    playing: false,
    filterSuspicious: false,
    timer: null,
    video: null,
    disposed: false,
  };
  let unsubscribe = () => {};
  let observer = null;

  if (globalThis.Veritas) globalThis.Veritas.videoGeneralDetection = videoGeneralDetection;

  function initialPlaybackTime(task) {
    return task?.sample ? (task.result?.frames?.[0]?.time || 0) : 0;
  }

  const selectedTask = () => state.tasks.find(task => task.id === state.selectedId) || null;
  const busyRunning = () => state.tasks.some(task => task.status === 'running');
  const riskBadge = risk => `<span class="vg-risk-badge" data-risk="${risk}">${RISK_LABELS[risk]}</span>`;

  function renderServiceState() {
    const configured = videoGeneralDetection.configured;
    const pill = root.querySelector('[data-service-state]');
    pill.dataset.configured = String(configured);
    pill.innerHTML = `<span class="vg-service-dot"></span><span>${configured ? '本地检测服务已连接' : '检测服务未接入'}</span>`;
    const note = root.querySelector('[data-demo-note]');
    note.innerHTML = `<span class="vg-flag vg-flag-sample">样例演示</span><p><span class="vg-demo-long">${configured
      ? '已连接本机检测服务，结果中的「检测模型」会标明实际使用的模型。选择视频并开始检测；下方历史样例仅供预览。'
      : '页面包含虚构样例任务（画面与结论仅用于界面预览）；检测服务尚未接入，上传的视频不会被发送或分析。'}</span><span class="vg-demo-short">${configured
      ? '本地检测服务已连接；可提交视频检测，样例仅供预览。'
      : '虚构样例仅用于界面预览；检测服务未接入。'}</span></p>`;
  }

  function renderUpload() {
    const empty = root.querySelector('[data-upload-empty]');
    const busy = root.querySelector('[data-upload-busy]');
    const fileBox = root.querySelector('[data-file]');
    const running = busyRunning();
    empty.hidden = Boolean(state.upload) || state.uploadBusy;
    fileBox.hidden = !state.upload || state.uploadBusy;
    busy.hidden = !state.uploadBusy;
    for (const button of root.querySelectorAll('[data-choose]')) button.disabled = running || state.uploadBusy;
    const remove = root.querySelector('[data-remove]');
    if (remove) remove.disabled = running || state.uploadBusy;
    if (state.upload) {
      const image = root.querySelector('[data-file-poster]');
      const fallback = root.querySelector('[data-file-fallback]');
      if (state.upload.poster) {
        image.src = state.upload.poster;
        image.hidden = false;
        fallback.hidden = true;
      } else {
        image.removeAttribute('src');
        image.hidden = true;
        fallback.hidden = false;
      }
      root.querySelector('[data-file-duration]').textContent = formatDuration(state.upload.duration);
      const name = root.querySelector('[data-file-name]');
      name.textContent = state.upload.file.name;
      name.title = state.upload.file.name;
      const dimensions = state.upload.width && state.upload.height ? `${state.upload.width}×${state.upload.height}` : '尺寸未知';
      root.querySelector('[data-file-meta]').textContent = `${state.upload.file.name.split('.').pop().toUpperCase()} · 本地预览已就绪`;
      root.querySelector('[data-file-fact-duration]').textContent = formatDuration(state.upload.duration);
      root.querySelector('[data-file-fact-size]').textContent = dimensions;
      root.querySelector('[data-file-fact-bytes]').textContent = formatBytes(state.upload.size);
    }
    const detect = root.querySelector('[data-detect]');
    if (detect) {
      detect.disabled = running || state.uploadBusy;
      detect.textContent = running ? '检测进行中…' : '开始检测';
    }
  }

  function statusLine(task) {
    if (task.status === 'running') {
      const percent = task.progress?.percent;
      return percent === null || percent === undefined ? '检测中' : `检测中 · ${Math.round(percent)}%`;
    }
    if (task.status === 'failed') return '检测失败 · 查看原因';
    if (task.status === 'cancelled') return '已取消 · 可重试';
    return STATUS_LABELS[task.status] || '未检测';
  }

  function renderHistory() {
    const focusedId = document.activeElement?.closest?.('.vg-task')?.dataset.task;
    const running = state.tasks.filter(task => task.status === 'running').length;
    root.querySelector('[data-history-count]').textContent = `${state.tasks.length} 个任务${running ? ` · ${running} 个进行中` : ''}`;
    historyHost.innerHTML = state.tasks.map(task => {
      const selected = task.id === state.selectedId;
      const result = task.result;
      const poster = task.media?.poster || result?.frames?.[0]?.image || '';
      const risk = task.status === 'succeeded' && result ? riskBadge(result.risk) : '';
      const progress = task.status === 'running'
        ? `<span class="vg-task-progress" aria-hidden="true"><span data-task-fill="${escapeText(task.id)}" style="width:${task.progress?.percent ?? 8}%"></span></span>`
        : '';
      return `<div class="vg-task" role="button" tabindex="0" data-task="${escapeText(task.id)}" aria-pressed="${selected}">
        <span class="vg-task-thumb">${poster ? `<img src="${escapeText(poster)}" alt="">` : glyph.film}</span>
        <span class="vg-task-body">
          <strong title="${escapeText(task.name)}">${escapeText(task.name)}</strong>
          <span class="vg-task-meta">${escapeText(task.createdAt)} · ${formatDuration(task.meta?.duration)}</span>
          <span class="vg-task-state" data-state="${task.status}" data-task-state="${escapeText(task.id)}">${escapeText(statusLine(task))}</span>
          ${progress}
        </span>
        <span class="vg-task-side">${task.sample ? '<span class="vg-task-tag">样例</span>' : ''}${risk}
          <button type="button" class="vg-task-del" data-delete="${escapeText(task.id)}" aria-label="删除任务：${escapeText(task.name)}" title="删除任务">${glyph.trash}</button>
        </span>
      </div>`;
    }).join('');
    if (focusedId) {
      const target = Array.from(historyHost.querySelectorAll('[data-task]')).find(item => item.dataset.task === focusedId);
      target?.focus({ preventScroll: true });
    }
  }

  function jumpLabel(task) {
    if (task?.status === 'succeeded' && task.result) {
      const count = task.result.segments.length ? `${task.result.segments.length} 段` : '暂无片段';
      const prefix = task.sample ? '查看样例结果' : '查看结果';
      return `${prefix} · ${RISK_LABELS[task.result.risk]} · ${count} ${icon('arrow')}`;
    }
    if (task?.status === 'running') {
      const percent = task.progress?.percent;
      return `查看进度${percent === null || percent === undefined ? '' : ` · ${Math.round(percent)}%`} ${icon('arrow')}`;
    }
    if (task?.status === 'failed') return `查看失败原因 ${icon('arrow')}`;
    if (task) return `查看任务状态 ${icon('arrow')}`;
    return `查看检测结果 ${icon('arrow')}`;
  }

  function renderResultHeader(task) {
    const file = root.querySelector('[data-result-file]');
    file.textContent = task ? `${task.name} · ${task.createdAt}` : '选择一个检测任务查看结果';
    root.querySelector('[data-jump-result]').innerHTML = jumpLabel(task);
    const tags = [];
    if (task?.sample) tags.push('<span class="vg-flag vg-flag-sample">样例数据</span>');
    if (task?.status === 'running') tags.push('<span class="vg-flag" data-state="running">检测中</span>');
    if (task?.status === 'failed') tags.push('<span class="vg-flag" data-state="failed">检测失败</span>');
    if (task?.status === 'cancelled') tags.push('<span class="vg-flag" data-state="cancelled">已取消</span>');
    if (task?.status === 'succeeded' && task.result) tags.push(riskBadge(task.result.risk));
    root.querySelector('[data-result-tags]').innerHTML = tags.join('');
  }

  function nearestFrame(result, time) {
    let nearest = null;
    let distance = Infinity;
    for (const frame of result.frames) {
      const current = Math.abs(frame.time - time);
      if (current < distance) {
        distance = current;
        nearest = frame;
      }
    }
    return nearest;
  }

  function frameImage(frame, task) {
    if (!frame?.image) return '';
    return `<img src="${escapeText(frame.image)}" alt="${escapeText(`${task.sample ? '样例' : ''}代表画面：${frame.caption}`)}">`;
  }

  function sampleStrip() {
    return `<div class="vg-sample-strip" role="note"><span class="vg-flag vg-flag-sample">样例数据</span><p>该任务使用虚构画面与结论展示界面流程，不代表真实检测结果。</p></div>`;
  }

  function metric(label, value) {
    return `<div class="vg-metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function playerMarkup(task, result) {
    const initialFrame = nearestFrame(result, 0);
    const ratio = Number(task.meta?.width) > 0 && Number(task.meta?.height) > 0 ? `${Number(task.meta.width)} / ${Number(task.meta.height)}` : '16 / 9';
    const video = task.media?.objectUrl
      ? `<video data-video src="${escapeText(task.media.objectUrl)}"${task.media.poster ? ` poster="${escapeText(task.media.poster)}"` : ''} preload="metadata" playsinline></video>`
      : initialFrame?.image
        ? `<img data-stage-image src="${escapeText(initialFrame.image)}" alt="${escapeText(`样例代表画面：${initialFrame.caption}`)}">`
        : `<div class="vg-stage-placeholder">${glyph.film}<span>暂无代表画面</span></div>`;
    const bands = result.segments.map(segment => {
      const left = Math.max(0, Math.min(100, segment.start / result.duration * 100));
      const width = Math.max(0.5, Math.min(100 - left, (segment.end - segment.start) / result.duration * 100));
      const title = `${formatTimecode(segment.start)}–${formatTimecode(segment.end)} · ${RISK_LABELS[segment.risk]}`;
      return `<span class="vg-risk-band" data-band="${escapeText(segment.id)}" data-risk="${segment.risk}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${escapeText(title)}"></span>`;
    }).join('');
    return `<div class="vg-player" data-player>
      <div class="vg-stage" data-stage style="aspect-ratio:${ratio}">
        ${video}
        <span class="vg-stage-tag">${task.sample ? '样例画面 · 非原始视频' : '原视频'}</span>
        <button type="button" class="vg-stage-toggle" data-stage-toggle aria-label="播放视频">${glyph.play}</button>
        <span class="vg-stage-time" data-stage-time>00:00.0</span>
      </div>
      <div class="vg-controls">
        <button type="button" class="vg-icon-button" data-play-toggle aria-label="播放视频" aria-pressed="false">${glyph.play}</button>
        <div class="vg-timeline" data-timeline role="slider" tabindex="0" aria-label="视频时间轴，按左右方向键调整" aria-valuemin="0" aria-valuemax="${result.duration}" aria-valuenow="0" aria-valuetext="00:00.0">
          <div class="vg-timeline-track">
            ${bands}
            <span class="vg-timeline-fill" data-progress-fill></span>
            <span class="vg-playhead" data-playhead></span>
          </div>
        </div>
        <span class="vg-time"><span data-current-time>00:00.0</span> / ${formatTimecode(result.duration)}</span>
        ${task.media?.objectUrl ? `<button type="button" class="vg-icon-button" data-mute aria-label="静音" aria-pressed="false">${glyph.volume}</button>` : ''}
      </div>
      <p class="vg-player-note" data-player-note>${task.sample
        ? '样例任务没有原始视频，播放器按代表画面模拟时间轴，用于演示定位交互。'
        : '点击时间段或代表画面，可跳转到原视频对应位置核查。'}</p>
    </div>`;
  }

  function summaryMarkup(result) {
    const findings = result.findings.length ? result.findings : result.segments.slice(0, 3).map(segment => segment.summary);
    return `<aside class="vg-summary-panel" aria-label="检测结论">
      <div class="vg-summary-main">
        <div class="vg-summary-top"><span>综合风险</span>${riskBadge(result.risk)}</div>
        <div class="vg-risk-scale" data-level="${riskLevel(result.risk)}" aria-hidden="true"><i></i><i></i><i></i></div>
        <p class="vg-summary-text">${escapeText(result.summary)}</p>
        ${findings.length ? `<div class="vg-findings"><h4>主要线索</h4><ul>${findings.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul></div>` : ''}
      </div>
      <div class="vg-summary-side">
        <p class="vg-side-title">检测范围与覆盖</p>
        <dl class="vg-scope">
          <div><dt>检测覆盖</dt><dd>${result.coverage === 'full' ? '全片' : '部分覆盖'}</dd></div>
          <div><dt>实际处理范围</dt><dd>${escapeText(result.scope)}</dd></div>
          <div><dt>采样画面</dt><dd>${result.sampledFrames} 帧</dd></div>
          ${result.meta?.method ? `<div><dt>检测模型</dt><dd>${escapeText(result.meta.method)}</dd></div>` : ''}
          ${result.meta?.thresholdsCalibrated === false ? '<div><dt>分数说明</dt><dd>阈值尚未校准，模型得分不等于真实概率。</dd></div>' : ''}
        </dl>
        ${result.coverage === 'partial' ? '<p class="vg-caution">仅覆盖上述范围；未处理部分不代表安全。</p>' : ''}
      </div>
    </aside>`;
  }

  function segmentsMarkup(task, result) {
    const frameMap = new Map(result.frames.map(frame => [frame.id, frame]));
    const cards = result.segments.map(segment => {
      const frame = frameMap.get(segment.frameId) || nearestFrame(result, (segment.start + segment.end) / 2);
      return `<article class="vg-segment-card" data-segment-card data-segment-id="${escapeText(segment.id)}" data-risk="${segment.risk}" data-start="${segment.start}" data-end="${segment.end}">
        <button type="button" class="vg-segment-button" data-seek="${segment.start}" aria-label="${escapeText(`定位到 ${formatTimecode(segment.start)} 到 ${formatTimecode(segment.end)} 的${RISK_LABELS[segment.risk]}片段`)}">
          <span class="vg-segment-media">
            ${frameImage(frame, task) || `<span class="vg-frame-fallback">${glyph.film}</span>`}
            <span class="vg-frame-time">${formatTimecode(segment.start)}</span>
            <span class="vg-segment-risk">${riskBadge(segment.risk)}</span>
          </span>
          <span class="vg-segment-body">
            <span class="vg-segment-range">${formatTimecode(segment.start)} – ${formatTimecode(segment.end)}</span>
            <span class="vg-segment-summary">${escapeText(segment.summary)}</span>
            <span class="vg-segment-link">定位播放 ${icon('arrow')}</span>
          </span>
        </button>
      </article>`;
    }).join('');
    return `<section class="vg-section vg-segments" aria-labelledby="vg-segments-title">
      <div class="vg-section-head">
        <div><h4 id="vg-segments-title">可疑时间段</h4><p>将风险线索关联到视频时间段，点击即可定位播放。</p></div>
        <span class="vg-section-count">${result.segments.length} 段</span>
      </div>
      ${result.segments.length ? `<div class="vg-segment-grid">${cards}</div>` : `<div class="vg-empty-state">${icon('check')}<div><strong>未发现可定位的可疑时间段</strong><p>这不等于确认视频完全真实，请结合检测范围与代表画面复核。</p></div></div>`}
    </section>`;
  }

  function framesMarkup(task, result) {
    if (!result.frames.length) {
      return `<section class="vg-section vg-frames" aria-labelledby="vg-frames-title">
        <div class="vg-section-head"><div><h4 id="vg-frames-title">关键画面对照</h4><p>检测结果未提供代表画面。</p></div></div>
        <div class="vg-empty-state">${glyph.film}<div><strong>暂无可对照画面</strong><p>请以检测范围和风险说明为准。</p></div></div>
      </section>`;
    }
    const cards = result.frames.map(frame => `<button type="button" class="vg-frame-card" data-frame-card data-frame-id="${escapeText(frame.id)}" data-risk="${frame.risk}" data-seek="${frame.time}" aria-pressed="false" aria-label="${escapeText(`定位到 ${formatTimecode(frame.time)}，${RISK_LABELS[frame.risk]}代表画面：${frame.caption}`)}">
      <span class="vg-frame-media">
        ${frameImage(frame, task) || `<span class="vg-frame-fallback">${glyph.film}</span>`}
        <span class="vg-frame-time">${formatTimecode(frame.time)}</span>
        <span class="vg-frame-risk">${riskBadge(frame.risk)}</span>
      </span>
      <span class="vg-frame-caption">${escapeText(frame.caption)}</span>
    </button>`).join('');
    return `<section class="vg-section vg-frames" aria-labelledby="vg-frames-title">
      <div class="vg-section-head">
        <div><h4 id="vg-frames-title">关键画面对照</h4><p>从 ${result.sampledFrames} 个采样帧中抽取 ${result.frames.length} 张代表画面，点击可定位核查。</p></div>
        <label class="vg-filter"><input type="checkbox" data-filter ${state.filterSuspicious ? 'checked' : ''}> 仅看可疑画面</label>
      </div>
      <div class="vg-frame-grid">${cards}</div>
      <p class="vg-frames-empty" data-frames-empty hidden>当前筛选下没有可疑代表画面。</p>
    </section>`;
  }

  function reportMarkup(task, result) {
    const saved = task.savedAt ? `已于 ${formatDateTime(task.savedAt)} 保存到本机。` : '';
    return `<section class="vg-report" aria-labelledby="vg-report-title">
      <div class="vg-report-copy">
        <p class="vg-step">报告</p>
        <h4 id="vg-report-title">检测报告</h4>
        <p>汇总检测范围、${result.segments.length} 个可疑片段与 ${result.frames.length} 张代表画面。可保存到本机浏览器，或导出为独立 HTML 报告。</p>
        <div class="vg-report-facts">
          <span>检测覆盖：${result.coverage === 'full' ? '全片' : '部分覆盖'}</span>
          <span>采样画面：${result.sampledFrames} 帧</span>
          <span>结果来源：${task.sample ? '样例数据' : '检测服务'}</span>
        </div>
      </div>
      <div class="vg-report-actions">
        <button type="button" class="vg-btn vg-btn-secondary" data-save-report>${glyph.save} 保存记录</button>
        <button type="button" class="vg-btn vg-btn-primary" data-export-report>${glyph.download} 导出报告</button>
        <p class="vg-report-status" data-report-status role="status" aria-live="polite"${saved ? '' : ' hidden'}>${escapeText(saved)}</p>
      </div>
    </section>`;
  }

  function runningMarkup(task) {
    const percent = task.progress?.percent;
    const stage = task.progress?.stage || '正在准备检测';
    return `<div class="vg-state vg-running" aria-live="polite">
      <div class="vg-state-icon">${glyph.film}</div>
      <p class="vg-step">检测进行中</p>
      <h4 data-progress-stage>${escapeText(stage)}</h4>
      <p>${escapeText(task.name)} 已提交。请保持页面打开，检测完成后会自动更新。</p>
      <div class="vg-progress" data-indeterminate="${percent === null || percent === undefined}" data-progress-track>
        <span data-progress-fill style="width:${percent === null || percent === undefined ? 100 : Math.round(percent)}%"></span>
      </div>
      <div class="vg-progress-meta">
        <span data-progress-percent>${percent === null || percent === undefined ? '等待服务返回进度…' : `${Math.round(percent)}%`}</span>
        <button type="button" class="vg-btn vg-btn-quiet" data-cancel>取消检测</button>
      </div>
    </div>`;
  }

  function failedMarkup(task) {
    const cancelled = task.status === 'cancelled';
    return `<div class="vg-state vg-failed">
      <div class="vg-state-icon">${cancelled ? glyph.film : glyph.alert}</div>
      <p class="vg-step">${cancelled ? '已取消' : '检测未完成'}</p>
      <h4>${cancelled ? '本次检测已取消' : '检测服务未能完成处理'}</h4>
      <p>${escapeText(task.error || (cancelled ? '本次检测已取消，可重新发起检测。' : '检测服务未返回结果，请稍后重试。'))}</p>
      ${task.media?.file ? `<button type="button" class="vg-btn vg-btn-primary" data-retry>${glyph.refresh} 重新检测</button>` : ''}
    </div>`;
  }

  function renderResult() {
    const task = selectedTask();
    stopPlayer();
    renderResultHeader(task);
    if (!task) {
      resultHost.innerHTML = `<div class="vg-state"><div class="vg-state-icon">${glyph.film}</div><h4>选择一个检测任务</h4><p>从上方任务列表选择任务，查看检测范围、可疑时间段和代表画面。</p></div>`;
      return;
    }
    if (task.status === 'running') {
      resultHost.innerHTML = runningMarkup(task);
      return;
    }
    if (task.status === 'failed' || task.status === 'cancelled') {
      resultHost.innerHTML = failedMarkup(task);
      return;
    }
    if (!task.result) {
      resultHost.innerHTML = `<div class="vg-state"><div class="vg-state-icon">${glyph.film}</div><h4>该任务暂无检测结果</h4><p>检测完成后会在这里显示结果。</p></div>`;
      return;
    }
    const result = task.result;
    resultHost.innerHTML = `${task.sample ? sampleStrip() : ''}
      <div class="vg-metrics">
        ${metric('综合风险', riskBadge(result.risk))}
        ${metric('可疑片段', `${result.segments.length} 段`)}
        ${metric('检测覆盖', result.coverage === 'full' ? '全片' : '部分覆盖')}
        ${metric('采样画面', `${result.sampledFrames} 帧`)}
      </div>
      <div class="vg-result-grid">
        <section class="vg-player-panel" aria-label="视频与时间轴">${playerMarkup(task, result)}</section>
        ${summaryMarkup(result)}
      </div>
      ${segmentsMarkup(task, result)}
      ${framesMarkup(task, result)}
      ${reportMarkup(task, result)}`;
    setupPlayer();
    bindStage();
    bindTimeline(resultHost.querySelector('[data-timeline]'));
    applyFrameFilter();
    updatePlaybackUi();
  }

  function setupPlayer() {
    const video = resultHost.querySelector('[data-video]');
    state.video = video;
    if (!video) return;
    const alignStage = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        root.querySelector('[data-stage]').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
      }
    };
    video.addEventListener('loadedmetadata', alignStage);
    if (video.readyState >= 1) alignStage();
    video.addEventListener('play', () => { state.playing = true; updatePlaybackUi(); });
    video.addEventListener('pause', () => { state.playing = false; updatePlaybackUi(); });
    video.addEventListener('timeupdate', () => {
      if (!state.video) return;
      state.currentTime = video.currentTime;
      updatePlaybackUi();
    });
    video.addEventListener('ended', () => { state.playing = false; updatePlaybackUi(); });
    video.addEventListener('error', () => {
      const note = resultHost.querySelector('[data-player-note]');
      if (note) note.textContent = '浏览器无法播放该视频，但仍可查看检测结果和代表画面。';
    });
  }

  function bindStage() {
    const stage = resultHost.querySelector('[data-stage]');
    if (!stage) return;
    stage.addEventListener('click', event => {
      if (event.target.closest('button')) return;
      togglePlay();
    });
  }

  function bindTimeline(timeline) {
    if (!timeline) return;
    let dragging = false;
    const seekFromPointer = event => {
      const task = selectedTask();
      if (!task?.result) return;
      const rect = timeline.getBoundingClientRect();
      if (!rect.width) return;
      const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      seekTo(ratio * task.result.duration);
    };
    timeline.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      dragging = true;
      timeline.focus({ preventScroll: true });
      try { timeline.setPointerCapture(event.pointerId); } catch { /* 指针捕获不可用 */ }
      seekFromPointer(event);
      event.preventDefault();
    });
    timeline.addEventListener('pointermove', event => { if (dragging) seekFromPointer(event); });
    const end = event => {
      if (!dragging) return;
      dragging = false;
      try { if (timeline.hasPointerCapture(event.pointerId)) timeline.releasePointerCapture(event.pointerId); } catch { /* 已释放 */ }
    };
    timeline.addEventListener('pointerup', end);
    timeline.addEventListener('pointercancel', end);
    timeline.addEventListener('keydown', event => {
      const task = selectedTask();
      if (!task?.result) return;
      const step = event.shiftKey ? 10 : 2;
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); seekTo(state.currentTime + step); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); seekTo(state.currentTime - step); }
      else if (event.key === 'Home') { event.preventDefault(); seekTo(0); }
      else if (event.key === 'End') { event.preventDefault(); seekTo(task.result.duration); }
    });
  }

  function updatePlaybackUi() {
    const task = selectedTask();
    const result = task?.result;
    if (!task || task.status !== 'succeeded' || !result) return;
    const player = resultHost.querySelector('[data-player]');
    if (!player) return;
    const duration = Math.max(0.1, Number(result.duration) || 0.1);
    const time = Math.min(duration, Math.max(0, state.currentTime));
    const ratio = time / duration;
    const fill = player.querySelector('[data-progress-fill]');
    if (fill) fill.style.width = `${ratio * 100}%`;
    const playhead = player.querySelector('[data-playhead]');
    if (playhead) playhead.style.left = `${ratio * 100}%`;
    const current = player.querySelector('[data-current-time]');
    if (current) current.textContent = formatTimecode(time);
    const stageTime = player.querySelector('[data-stage-time]');
    if (stageTime) stageTime.textContent = formatTimecode(time);
    const timeline = player.querySelector('[data-timeline]');
    if (timeline) {
      timeline.setAttribute('aria-valuenow', String(time));
      timeline.setAttribute('aria-valuetext', formatTimecode(time));
    }
    for (const button of [player.querySelector('[data-play-toggle]'), player.querySelector('[data-stage-toggle]')].filter(Boolean)) {
      button.innerHTML = state.playing ? glyph.pause : glyph.play;
      button.setAttribute('aria-label', state.playing ? '暂停视频' : '播放视频');
    }
    const playButton = player.querySelector('[data-play-toggle]');
    if (playButton) playButton.setAttribute('aria-pressed', String(state.playing));
    player.dataset.playing = String(state.playing);
    const stageImage = player.querySelector('[data-stage-image]');
    if (stageImage && result.frames.length) {
      const frame = nearestFrame(result, time);
      if (frame?.image && stageImage.getAttribute('src') !== frame.image) stageImage.src = frame.image;
      if (frame) stageImage.alt = `样例代表画面：${frame.caption}`;
    }
    const nearest = nearestFrame(result, time);
    for (const card of resultHost.querySelectorAll('[data-frame-card]')) {
      card.setAttribute('aria-pressed', String(nearest?.id === card.dataset.frameId));
    }
    for (const card of resultHost.querySelectorAll('[data-segment-card]')) {
      const start = Number(card.dataset.start);
      const end = Number(card.dataset.end);
      card.dataset.active = String(time >= start && time < end);
    }
    for (const band of resultHost.querySelectorAll('[data-band]')) {
      const segment = result.segments.find(item => item.id === band.dataset.band);
      band.dataset.active = String(Boolean(segment && time >= segment.start && time < segment.end));
    }
  }

  function stopTicker() {
    if (state.timer) {
      clearInterval(state.timer);
      state.timer = null;
    }
  }

  function startTicker() {
    stopTicker();
    let last = performance.now();
    state.timer = setInterval(() => {
      if (state.disposed || !state.playing) return;
      const now = performance.now();
      const delta = (now - last) / 1000;
      last = now;
      const duration = selectedTask()?.result?.duration || 0;
      state.currentTime = Math.min(duration, state.currentTime + delta);
      if (state.currentTime >= duration) {
        state.playing = false;
        stopTicker();
      }
      updatePlaybackUi();
    }, 100);
  }

  function stopPlayer() {
    stopTicker();
    if (state.video) {
      try { state.video.pause(); } catch { /* 视频尚未就绪 */ }
    }
    state.video = null;
    state.playing = false;
  }

  function togglePlay() {
    const task = selectedTask();
    if (!task?.result || task.status !== 'succeeded') return;
    if (state.video) {
      if (state.video.paused) {
        const promise = state.video.play();
        if (promise?.catch) promise.catch(() => notice('浏览器无法播放该视频，请检查文件编码。', 'warning'));
      } else {
        state.video.pause();
      }
      return;
    }
    if (state.playing) {
      state.playing = false;
      stopTicker();
      updatePlaybackUi();
      return;
    }
    if (state.currentTime >= task.result.duration - 0.05) state.currentTime = task.sample ? (task.result.frames[0]?.time || 0) : 0;
    state.playing = true;
    startTicker();
    updatePlaybackUi();
  }

  function seekTo(value) {
    const task = selectedTask();
    if (!task?.result) return;
    state.currentTime = Math.min(task.result.duration, Math.max(0, Number(value) || 0));
    if (state.video) {
      try { state.video.currentTime = state.currentTime; } catch { /* 视频尚未就绪 */ }
    }
    updatePlaybackUi();
  }

  function selectTask(id, { scroll = false } = {}) {
    const task = state.tasks.find(item => item.id === id);
    if (!task) return;
    if (state.selectedId === id) {
      if (scroll) revealResult();
      return;
    }
    stopPlayer();
    state.selectedId = id;
    state.currentTime = initialPlaybackTime(task);
    state.filterSuspicious = false;
    renderHistory();
    scrollTaskIntoView(id);
    renderResult();
    if (scroll) revealResult();
  }

  // 任务列表是可滚动区域：选中/新建的任务滚动到可视范围（block:nearest 不推动页面）
  function scrollTaskIntoView(id) {
    const item = Array.from(historyHost.querySelectorAll('[data-task]')).find(node => node.dataset.task === id);
    item?.scrollIntoView({ block: 'nearest' });
  }

  function applyFrameFilter() {
    const frameCards = Array.from(resultHost.querySelectorAll('[data-frame-card]'));
    let visible = 0;
    for (const card of frameCards) {
      const suspicious = card.dataset.risk === 'medium' || card.dataset.risk === 'high';
      const show = !state.filterSuspicious || suspicious;
      card.hidden = !show;
      if (show) visible += 1;
    }
    const empty = resultHost.querySelector('[data-frames-empty]');
    if (empty) empty.hidden = visible > 0;
  }

  function updateTaskProgress(task) {
    const status = Array.from(historyHost.querySelectorAll('[data-task-state]')).find(element => element.dataset.taskState === task.id);
    if (status) {
      status.textContent = statusLine(task);
      status.dataset.state = task.status;
    }
    const fill = Array.from(historyHost.querySelectorAll('[data-task-fill]')).find(element => element.dataset.taskFill === task.id);
    if (fill && task.progress?.percent !== null && task.progress?.percent !== undefined) fill.style.width = `${Math.round(task.progress.percent)}%`;
    if (state.selectedId === task.id) {
      const jump = root.querySelector('[data-jump-result]');
      if (jump) jump.innerHTML = jumpLabel(task);
      updateRunningPanel(task);
    }
  }

  function updateRunningPanel(task) {
    if (state.selectedId !== task.id || task.status !== 'running') return;
    const stage = resultHost.querySelector('[data-progress-stage]');
    if (!stage) return;
    const percent = task.progress?.percent;
    stage.textContent = task.progress?.stage || '正在准备检测';
    const track = resultHost.querySelector('[data-progress-track]');
    if (track) track.dataset.indeterminate = String(percent === null || percent === undefined);
    const fill = resultHost.querySelector('[data-progress-fill]');
    if (fill) fill.style.width = `${percent === null || percent === undefined ? 100 : Math.round(percent)}%`;
    const text = resultHost.querySelector('[data-progress-percent]');
    if (text) text.textContent = percent === null || percent === undefined ? '等待服务返回进度…' : `${Math.round(percent)}%`;
  }

  async function runTask(task, { reveal = false } = {}) {
    if (!task.media?.file || task.status === 'running') return;
    const controller = new AbortController();
    task.controller = controller;
    task.status = 'running';
    task.progress = { stage: '准备采样画面', percent: null };
    task.error = null;
    renderUpload();
    renderHistory();
    scrollTaskIntoView(task.id);
    if (state.selectedId === task.id) {
      renderResultHeader(task);
      resultHost.innerHTML = runningMarkup(task);
      if (reveal) revealResult();
    }
    try {
      const result = await videoGeneralDetection.run(
        {
          file: task.media.file,
          metadata: {
            name: task.name,
            size: task.meta.size,
            type: task.media.file.type,
            duration: task.meta.duration,
            width: task.meta.width,
            height: task.meta.height,
          },
        },
        {
          signal: controller.signal,
          onProgress: progress => {
            if (task.controller !== controller || task.status !== 'running') return;
            task.progress = progress;
            updateTaskProgress(task);
          },
        },
      );
      if (task.controller !== controller) return;
      if (controller.signal.aborted) {
        task.status = 'cancelled';
      } else {
        task.result = result;
        task.status = 'succeeded';
        task.completedAt = formatDateTime(new Date());
      }
    } catch (error) {
      if (task.controller !== controller) return;
      if (controller.signal.aborted) {
        task.status = 'cancelled';
      } else {
        task.status = 'failed';
        const message = error instanceof Error ? error.message : '检测服务处理失败。';
        task.error = message.slice(0, 500);
      }
    } finally {
      if (task.controller !== controller) return;
      task.controller = null;
      task.progress = null;
      if (!state.disposed) {
        renderUpload();
        renderHistory();
        if (state.selectedId === task.id) renderResult();
      }
    }
  }

  function createTask(media) {
    return {
      id: `vg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sample: false,
      name: media.file.name,
      createdAt: formatDateTime(new Date()),
      completedAt: '',
      status: 'idle',
      meta: { size: media.size, duration: media.duration, width: media.width, height: media.height, type: media.file.type },
      media: { file: media.file, objectUrl: media.objectUrl, poster: media.poster },
      result: null,
      progress: null,
      error: null,
      controller: null,
      savedAt: null,
    };
  }

  async function beginDetection() {
    if (state.uploadBusy) return;
    if (busyRunning()) {
      notice('已有检测正在进行，请等待完成后再提交。', 'warning');
      return;
    }
    if (!state.upload) {
      notice('请先选择待检测视频。', 'error');
      return;
    }
    if (!videoGeneralDetection.configured) await initVideoGeneralBackend();
    if (!videoGeneralDetection.configured) {
      notice('检测服务尚未接入，视频未提交。下方的样例结果仅用于界面预览，不代表真实检测。', 'warning');
      return;
    }
    if (busyRunning() || !state.upload) return;
    const task = createTask(state.upload);
    state.tasks.unshift(task);
    state.selectedId = task.id;
    state.upload = null;
    state.currentTime = 0;
    state.playing = false;
    state.filterSuspicious = false;
    notice('视频已提交检测，任务已加入列表。', 'info');
    void runTask(task, { reveal: true });
  }

  function cancelTask(task) {
    if (!task || task.status !== 'running') return;
    try { task.controller?.abort(); } catch { /* 忽略取消异常 */ }
    task.status = 'cancelled';
    task.progress = null;
    renderUpload();
    renderHistory();
    if (state.selectedId === task.id) renderResult();
    notice('本次检测已取消，可在任务中重新发起。', 'info');
  }

  function deleteTask(task) {
    if (!task) return;
    const name = task.name;
    if (task.status === 'running') {
      try { task.controller?.abort(); } catch { /* 忽略取消异常 */ }
      task.status = 'cancelled';
      task.controller = null;
      task.progress = null;
    }
    const index = state.tasks.indexOf(task);
    state.tasks = state.tasks.filter(item => item !== task);
    if (task.media?.objectUrl) {
      try { URL.revokeObjectURL(task.media.objectUrl); } catch { /* 地址可能已释放 */ }
      task.media.objectUrl = null;
    }
    if (state.selectedId === task.id) {
      const next = state.tasks[Math.min(Math.max(index, 0), state.tasks.length - 1)] || null;
      state.selectedId = next?.id || null;
      state.currentTime = next ? initialPlaybackTime(next) : 0;
      state.playing = false;
      state.filterSuspicious = false;
    }
    renderUpload();
    renderHistory();
    renderResult();
    notice(state.tasks.length ? `已删除任务「${name}」。` : `已删除任务「${name}」，任务列表为空。`, 'info');
  }

  function retrySelected() {
    const task = selectedTask();
    if (!task?.media?.file) return;
    if (!videoGeneralDetection.configured) {
      notice('检测服务尚未接入，无法重新检测。', 'warning');
      return;
    }
    void runTask(task, { reveal: true });
  }

  function notice(message, kind = 'info') {
    const element = root.querySelector('[data-upload-notice]');
    if (!message) {
      element.hidden = true;
      element.textContent = '';
      return;
    }
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = false;
  }

  function setReportStatus(message, kind = 'info') {
    const element = resultHost.querySelector('[data-report-status]');
    if (!element) return;
    element.textContent = message;
    element.dataset.kind = kind;
    element.hidden = false;
  }

  function saveReport() {
    const task = selectedTask();
    if (!task?.result) return;
    try {
      const savedAt = new Date().toISOString();
      const existing = JSON.parse(localStorage.getItem(REPORT_STORAGE_KEY) || '[]');
      const reports = Array.isArray(existing) ? existing : [];
      const snapshot = {
        version: 1,
        savedAt,
        task: { id: task.id, name: task.name, sample: task.sample, createdAt: task.createdAt, completedAt: task.completedAt, meta: task.meta },
        result: task.result,
      };
      const next = [snapshot, ...reports.filter(item => item?.task?.id !== task.id)].slice(0, 20);
      localStorage.setItem(REPORT_STORAGE_KEY, JSON.stringify(next));
      task.savedAt = savedAt;
      setReportStatus('报告记录已保存到本机浏览器。', 'success');
    } catch {
      setReportStatus('保存失败：当前浏览器存储不可用或空间不足，请改用导出报告。', 'error');
    }
  }

  function exportReport() {
    const task = selectedTask();
    if (!task?.result) return;
    try {
      const html = buildReportHtml({ task, result: task.result, generatedAt: new Date() });
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = reportFileName(task, new Date());
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setReportStatus('报告已导出为 HTML 文件。', 'success');
    } catch {
      setReportStatus('导出失败，请稍后重试。', 'error');
    }
  }

  function revealResult() {
    const card = root.querySelector('[data-result-card]');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    if (rect.top >= 80 && rect.top <= 160) return;
    card.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }

  function revealPlayer() {
    const player = resultHost.querySelector('[data-player]');
    if (!player) return;
    const rect = player.getBoundingClientRect();
    if (rect.top >= 76 && rect.bottom <= innerHeight - 20) return;
    player.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
  }

  function prefersReducedMotion() {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  }

  function releaseUploadObject() {
    const upload = state.upload;
    if (!upload?.objectUrl) return;
    const usedByTask = state.tasks.some(task => task.media?.objectUrl === upload.objectUrl);
    if (!usedByTask) URL.revokeObjectURL(upload.objectUrl);
    state.upload = null;
  }

  async function pickFile(fileList) {
    if (state.uploadBusy) return;
    if (busyRunning()) {
      notice('检测进行中，请等待完成后再更换视频。', 'warning');
      return;
    }
    const files = Array.from(fileList || []);
    if (!files.length) return;
    const file = files[0];
    const validation = validateVideoFile(file);
    if (!validation.ok) {
      notice(validation.message, 'error');
      return;
    }
    if (files.length > 1) notice('一次只检测一个视频，已选择第一个文件。', 'info');
    else notice('', 'info');
    state.uploadBusy = true;
    renderUpload();
    try {
      const inspected = await inspectVideo(file);
      if (state.disposed) {
        URL.revokeObjectURL(inspected.objectUrl);
        return;
      }
      releaseUploadObject();
      state.upload = {
        file,
        objectUrl: inspected.objectUrl,
        poster: inspected.poster,
        duration: inspected.duration,
        width: inspected.width,
        height: inspected.height,
        size: file.size,
      };
      notice('视频已准备好，可以开始检测。', 'success');
    } catch (error) {
      notice(error instanceof Error ? error.message : '无法读取该视频，请更换文件。', 'error');
    } finally {
      state.uploadBusy = false;
      if (!state.disposed) renderUpload();
    }
  }

  function inspectVideo(file) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(file);
      const video = document.createElement('video');
      let settled = false;
      let fallbackTimer = null;
      let timeout = null;
      const release = () => {
        clearTimeout(timeout);
        if (fallbackTimer) clearTimeout(fallbackTimer);
        video.removeAttribute('src');
        try { video.load(); } catch { /* 释放解码器 */ }
      };
      const finish = result => {
        if (settled) return;
        settled = true;
        release();
        resolve(result);
      };
      const fail = message => {
        if (settled) return;
        settled = true;
        release();
        URL.revokeObjectURL(objectUrl);
        reject(new Error(message));
      };
      timeout = setTimeout(() => fail('读取视频信息超时，请更换视频后重试。'), 20000);
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.addEventListener('error', () => fail('浏览器无法读取该视频，请尝试 H.264 编码的 MP4 或 WebM 文件。'), { once: true });
      video.addEventListener('loadedmetadata', () => {
        const duration = Number(video.duration);
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (!Number.isFinite(duration) || duration <= 0 || !width || !height) {
          fail('未能读取视频时长或画面尺寸，请更换文件。');
          return;
        }
        const capture = () => {
          let poster = '';
          try {
            const canvas = document.createElement('canvas');
            const canvasWidth = Math.min(640, width);
            canvas.width = canvasWidth;
            canvas.height = Math.max(1, Math.round(canvasWidth * height / width));
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            poster = canvas.toDataURL('image/jpeg', 0.74);
          } catch { poster = ''; }
          finish({ objectUrl, poster, duration, width, height });
        };
        video.addEventListener('seeked', capture, { once: true });
        try { video.currentTime = Math.min(Math.max(duration * 0.08, 0.1), Math.max(duration - 0.05, 0)); } catch { capture(); }
        fallbackTimer = setTimeout(capture, 1500);
      }, { once: true });
      video.src = objectUrl;
      try { video.load(); } catch { fail('无法读取该视频，请更换文件。'); }
    });
  }

  function dispose() {
    if (state.disposed) return;
    state.disposed = true;
    stopTicker();
    try { state.video?.pause(); } catch { /* 视频尚未就绪 */ }
    for (const task of state.tasks) {
      try { task.controller?.abort(); } catch { /* 忽略取消异常 */ }
    }
    const urls = new Set();
    if (state.upload?.objectUrl) urls.add(state.upload.objectUrl);
    for (const task of state.tasks) if (task.media?.objectUrl) urls.add(task.media.objectUrl);
    for (const url of urls) URL.revokeObjectURL(url);
    unsubscribe();
    observer?.disconnect();
    if (!document.querySelector('.video-general-page')) document.body.classList.remove('video-general-route');
  }

  renderServiceState();
  renderUpload();
  renderHistory();
  renderResult();
  if (globalThis.matchMedia?.('(max-width:760px)').matches) {
    requestAnimationFrame(() => {
      if (container.isConnected) document.querySelector('.sidebar .nav-item.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
  }

  root.addEventListener('click', event => {
    const del = event.target.closest('[data-delete]');
    if (del && root.contains(del)) {
      deleteTask(state.tasks.find(item => item.id === del.dataset.delete));
      return;
    }
    const button = event.target.closest('button');
    const taskItem = event.target.closest('.vg-task');
    if ((!button || !root.contains(button)) && taskItem && root.contains(taskItem)) {
      selectTask(taskItem.dataset.task, { scroll: true });
      return;
    }
    if (!button || !root.contains(button)) return;
    const data = button.dataset;
    if (data.task) { selectTask(data.task, { scroll: true }); return; }
    if (Object.hasOwn(data, 'jumpResult')) { revealResult(); return; }
    if (Object.hasOwn(data, 'choose')) { root.querySelector('[data-file-input]')?.click(); return; }
    if (Object.hasOwn(data, 'remove')) {
      if (busyRunning()) { notice('检测进行中，暂时不能移除视频。', 'warning'); return; }
      releaseUploadObject();
      notice('已移除当前视频。', 'info');
      renderUpload();
      return;
    }
    if (Object.hasOwn(data, 'detect')) { beginDetection(); return; }
    if (Object.hasOwn(data, 'playToggle') || Object.hasOwn(data, 'stageToggle')) { togglePlay(); return; }
    if (Object.hasOwn(data, 'mute')) {
      if (!state.video) return;
      state.video.muted = !state.video.muted;
      button.innerHTML = state.video.muted ? glyph.muted : glyph.volume;
      button.setAttribute('aria-label', state.video.muted ? '取消静音' : '静音');
      button.setAttribute('aria-pressed', String(state.video.muted));
      return;
    }
    if (Object.hasOwn(data, 'seek')) {
      seekTo(Number(data.seek));
      revealPlayer();
      return;
    }
    if (Object.hasOwn(data, 'cancel')) { cancelTask(selectedTask()); return; }
    if (Object.hasOwn(data, 'retry')) { retrySelected(); return; }
    if (Object.hasOwn(data, 'saveReport')) { saveReport(); return; }
    if (Object.hasOwn(data, 'exportReport')) { exportReport(); return; }
  });

  // 任务项是 role=button 的 div（内部含删除按钮），Enter/空格补齐键盘选中
  root.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const taskItem = event.target.closest?.('.vg-task');
    if (taskItem && root.contains(taskItem) && !event.target.closest('button')) {
      event.preventDefault();
      selectTask(taskItem.dataset.task, { scroll: true });
    }
  });

  root.addEventListener('change', event => {
    if (event.target.matches('[data-file-input]')) {
      const files = Array.from(event.target.files || []);
      event.target.value = '';
      void pickFile(files);
      return;
    }
    if (event.target.matches('[data-filter]')) {
      state.filterSuspicious = event.target.checked;
      applyFrameFilter();
    }
  });

  root.addEventListener('dragover', event => {
    const zone = event.target.closest('[data-drop]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.add('is-dragging');
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  root.addEventListener('dragleave', event => {
    const zone = event.target.closest('[data-drop]');
    if (!zone) return;
    if (!zone.contains(event.relatedTarget)) zone.classList.remove('is-dragging');
  });
  root.addEventListener('drop', event => {
    const zone = event.target.closest('[data-drop]');
    if (!zone) return;
    event.preventDefault();
    zone.classList.remove('is-dragging');
    void pickFile(event.dataTransfer?.files);
  });

  unsubscribe = videoGeneralDetection.subscribe(() => {
    if (state.disposed) return;
    renderServiceState();
    renderUpload();
  });
  observer = new MutationObserver(() => {
    if (!container.isConnected) dispose();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

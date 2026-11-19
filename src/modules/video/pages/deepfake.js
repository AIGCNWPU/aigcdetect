import { icon } from '../../../icons.js';
import { renderCreditButtonHtml, setCreditButtonContent } from '../../../lib/credit-badge.js';
import { ensureDetectionAllowed } from '../../../lib/auth-client.js';
import { COVERAGE_LABELS, RISK_LABELS, STATUS_LABELS, defaultPerson, escapeText, formatBytes, formatDateTime, formatDuration, formatProbability, formatTimecode, materialVersion, resultStats, riskLevel, validateVideoFile } from '../deepfake/model.js';
import { videoDeepfakeDetection, startVideoDeepfakeProbe } from '../deepfake/detection.js';
import { createVideoDeepfakeSamples } from '../deepfake/sample.js';
import { buildReportHtml, reportFileName } from '../deepfake/report.js';

const REPORT_STORAGE_KEY = 'veritas.video.deepfake.reports.v1';

const glyph = {
  upload: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4m0 0-4 4m4-4 4 4"/><path d="M5 15v4h14v-4"/></svg>',
  play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>',
  pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M8 5v14M16 5v14"/></svg>',
  film: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M8 4v16M16 4v16M3 9h5M3 15h5M16 9h5M16 15h5"/></svg>',
  face: '<svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M9 10h.01M15 10h.01M9.5 14.5c1.6 1.2 3.4 1.2 5 0"/></svg>',
  users: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.2"/><path d="M2.8 19c.6-3.2 3.1-5 6.2-5s5.6 1.8 6.2 5"/><path d="M16 5.5a3 3 0 0 1 0 5.6M17.5 14c2.1.5 3.5 2.2 3.7 4.6"/></svg>',
  save: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>',
  alert: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 20h19z"/><path d="M12 9v5m0 3v.01"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6"/><path d="M20 5v6h-6"/></svg>',
  volume: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9a4 4 0 0 1 0 6"/></svg>',
  muted: '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 4 6m0-6-4 6"/></svg>',
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-.7 12a2 2 0 0 1-2 1.9H8.7a2 2 0 0 1-2-1.9L6 7"/><path d="M10 11v6M14 11v6"/></svg>',
};

const VIDEO_DEEPFAKE_SAMPLES = [
  { id: 'vd-sample-1', label: '人像样本 01 · 多人同框片段', meta: 'MP4 · 含多个人物面部画面', url: './public/video-demos/portrait-sample-01.mp4', fileName: '多人对话片段.mp4' },
  { id: 'vd-sample-2', label: '人像样本 02 · 人物近景片段', meta: 'MP4 · 动态面部画面核查', url: './public/video-demos/portrait-sample-02.mp4', fileName: '人物近景片段.mp4' },
];

function shell() {
  return `<div class="vd" data-vd>
    <header class="vd-lead">
      <div class="vd-lead-copy">
        <div class="vd-lead-title"><h2>深度伪造检测工作台</h2></div>
        <p>上传人物视频，识别人脸画面，逐人检查换脸与面部合成线索，并定位到可疑时间段。</p>
      </div>
      <div class="vd-lead-actions">
        <button type="button" class="vd-btn vd-btn-quiet vd-jump" data-jump-result hidden>查看检测结果 ${icon('arrow')}</button>
        <div class="vd-service-state" data-service-state></div>
      </div>
    </header>
    <div class="vd-entry">
      <section class="vd-card vd-upload-card" aria-labelledby="vd-upload-title">
        <div class="vd-card-head">
          <div><h3 id="vd-upload-title">上传人物视频</h3></div>
          <span class="vd-limit">MP4 / WebM · ≤ 100 MiB · ≤ 120秒</span>
        </div>
        <div class="veritas-sample-bar" role="group" aria-label="示例人像视频">
          <span class="veritas-sample-label">示例视频 · 点击自动填入</span>
          <div class="veritas-sample-grid">${VIDEO_DEEPFAKE_SAMPLES.map(s => `<button type="button" class="veritas-sample-btn" data-vd-sample="${s.id}" aria-pressed="false"><strong>${s.label}</strong><small>${s.meta}</small></button>`).join('')}</div>
        </div>
        <div data-upload-empty>
          <div class="vd-dropzone" data-drop>
            <span class="vd-drop-icon">${glyph.upload}</span>
            <strong>将人物视频拖到这里</strong>
            <span>或点击选择本机视频文件（建议使用正面清晰人物片段）</span>
            <button type="button" class="vd-btn vd-btn-secondary" data-choose>选择视频</button>
          </div>
        </div>
        <input type="file" accept="video/mp4,video/webm,.mp4,.webm" data-file-input hidden aria-label="选择待检测人物视频">
        <div class="vd-reading" data-upload-busy hidden>
          <span class="vd-spinner" aria-hidden="true"></span>
          <div><strong>正在读取视频信息</strong><p>读取时长、画面尺寸并生成封面预览…</p></div>
        </div>
        <div class="vd-file" data-file hidden>
          <div class="vd-file-preview">
            <img data-file-poster alt="视频封面预览" hidden>
            <span class="vd-poster-fallback" data-file-fallback>${glyph.film}</span>
            <span class="vd-file-duration" data-file-duration></span>
          </div>
          <div class="vd-file-info">
            <strong data-file-name></strong>
            <p data-file-meta></p>
            <div class="vd-file-actions">
              <button type="button" class="vd-btn vd-btn-quiet" data-choose>更换视频</button>
              <button type="button" class="vd-btn vd-btn-quiet" data-remove>移除</button>
            </div>
          </div>
          <div class="vd-file-facts">
            <div><span>视频时长</span><strong data-file-fact-duration></strong></div>
            <div><span>画面尺寸</span><strong data-file-fact-size></strong></div>
            <div><span>文件大小</span><strong data-file-fact-bytes></strong></div>
          </div>
        </div>
        <div class="vd-upload-foot">
          <span class="vd-upload-ready" data-upload-ready>选择本机人物视频后开始检测</span>
          <button type="button" class="vd-btn vd-btn-primary vd-detect" data-detect disabled>${renderCreditButtonHtml('开始检测')}</button>
        </div>
        <p class="vd-notice" data-upload-notice role="status" aria-live="polite" hidden></p>
      </section>
      <aside class="vd-card vd-history-card" aria-labelledby="vd-history-title">
        <div class="vd-card-head">
          <div><h3 id="vd-history-title">检测任务</h3></div>
          <span class="vd-history-count" data-history-count></span>
        </div>
        <div class="vd-history" data-history role="group" aria-label="检测任务列表"></div>
      </aside>
    </div>
    <section class="vd-card vd-result-card" data-result-card aria-labelledby="vd-result-title">
      <div class="vd-result-head">
        <div>
          <h3 id="vd-result-title">人物检测概览</h3>
          <p class="vd-result-file" data-result-file></p>
        </div>
        <div class="vd-result-tags" data-result-tags></div>
      </div>
      <p class="vd-version-note" data-version-note role="status" hidden></p>
      <div data-result></div>
    </section>
  </div>`;
}

export function renderVideoDeepfake(container) {
  container.classList.add('video-deepfake-page');
  document.body.classList.add('video-deepfake-route');
  container.innerHTML = shell();
  const root = container.querySelector('[data-vd]');
  const resultHost = root.querySelector('[data-result]');
  const historyHost = root.querySelector('[data-history]');
  const state = {
    tasks: [],
    selectedId: null,
    selectedPersonId: null,
    upload: null,
    uploadBusy: false,
    activeSample: '',
    currentTime: 0,
    playing: false,
    filterSuspicious: false,
    timer: null,
    video: null,
    disposed: false,
  };
  let stopProbe = startVideoDeepfakeProbe();
  let unsubscribe = () => {};
  let observer = null;

  if (globalThis.Veritas) globalThis.Veritas.videoDeepfakeDetection = videoDeepfakeDetection;

  const selectedTask = () => state.tasks.find(task => task.id === state.selectedId) || null;
  const currentResult = () => selectedTask()?.result || null;
  const busyRunning = () => state.tasks.some(task => task.status === 'running');
  const selectedPerson = () => {
    const result = currentResult();
    return result?.persons.find(person => person.id === state.selectedPersonId) || null;
  };
  const riskBadge = risk => `<span class="vd-risk-badge" data-risk="${risk}">${RISK_LABELS[risk]}</span>`;
  const coverageChip = coverage => `<span class="vd-coverage" data-coverage="${coverage}">${COVERAGE_LABELS[coverage]}</span>`;

  function ensurePersonSelection(result) {
    if (!result?.persons.length) {
      state.selectedPersonId = null;
      return;
    }
    if (!result.persons.some(person => person.id === state.selectedPersonId)) {
      state.selectedPersonId = defaultPerson(result)?.id || result.persons[0].id;
    }
  }

  function initialPlaybackTime(task) {
    if (!task?.sample) return 0;
    const person = defaultPerson(task.result);
    return person?.segments?.[0]?.start ?? person?.frames?.[0]?.time ?? task.result?.persons?.[0]?.frames?.[0]?.time ?? 0;
  }

  function allFrames(result) {
    return (result?.persons || []).flatMap(person => person.frames);
  }

  function nearestFrame(frames, time) {
    let nearest = null;
    let distance = Infinity;
    for (const frame of frames || []) {
      const current = Math.abs(frame.time - time);
      if (current < distance) {
        distance = current;
        nearest = frame;
      }
    }
    return nearest;
  }

  function personPoster(person) {
    const preferred = person.frames.find(frame => frame.risk === 'high')
      || person.frames.find(frame => frame.risk === 'medium')
      || person.frames[0];
    return preferred?.image || '';
  }

  function taskPoster(task) {
    if (task.media?.poster) return task.media.poster;
    const frames = allFrames(task.result);
    const preferred = frames.find(frame => frame.risk === 'high')
      || frames.find(frame => frame.risk === 'medium')
      || frames[0];
    return preferred?.image || '';
  }

  function frameImage(frame, task) {
    if (!frame?.image) return '';
    const label = task?.sample ? '样例人脸画面' : '人脸画面';
    return `<img src="${escapeText(frame.image)}" alt="${escapeText(`${label}：${frame.caption}`)}">`;
  }

  function renderServiceState() {
    const configured = videoDeepfakeDetection.configured;
    const pill = root.querySelector('[data-service-state]');
    pill.dataset.configured = String(configured);
    pill.innerHTML = `<span class="vd-service-dot"></span><span>${configured ? '检测服务已连接' : '检测服务未接入'}</span>`;
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
    for (const sampleBtn of root.querySelectorAll('[data-vd-sample]')) {
      sampleBtn.disabled = running || state.uploadBusy;
      const active = sampleBtn.dataset.vdSample === state.activeSample && Boolean(state.upload);
      sampleBtn.classList.toggle('is-active', active);
      sampleBtn.setAttribute('aria-pressed', String(active));
    }
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
      root.querySelector('[data-file-meta]').textContent = `${state.upload.file.name.split('.').pop().toUpperCase()} · 本地预览已就绪 · 材料版本 ${state.upload.version}`;
      root.querySelector('[data-file-fact-duration]').textContent = formatDuration(state.upload.duration);
      root.querySelector('[data-file-fact-size]').textContent = dimensions;
      root.querySelector('[data-file-fact-bytes]').textContent = formatBytes(state.upload.size);
    }
    const detect = root.querySelector('[data-detect]');
    if (detect) {
      detect.disabled = !state.upload || running || state.uploadBusy;
      setCreditButtonContent(detect, running ? '检测进行中…' : '开始检测', { showCost: !running });
    }
    const readyHint = root.querySelector('[data-upload-ready]');
    if (readyHint) {
      readyHint.textContent = state.uploadBusy
        ? '正在解析视频信息…'
        : state.upload
          ? `已就绪：${state.upload.file.name}`
          : '选择本机人物视频后开始检测';
    }
    renderVersionNote();
  }

  function renderVersionNote() {
    const note = root.querySelector('[data-version-note]');
    if (!note) return;
    const task = selectedTask();
    const upload = state.upload;
    let message = '';
    if (task?.result && upload && task.material?.version !== upload.version) {
      message = task.sample
        ? `当前已选择新视频「${upload.file.name}」；下方样例结果不对应此文件，请通过检测服务重新检测。`
        : `当前已选择新视频「${upload.file.name}」（材料版本 ${upload.version}）；下方历史结果仍对应材料版本 ${task.material?.version || '未记录'}，请重新检测后再查看新材料结论。`;
    }
    note.hidden = !message;
    note.textContent = message;
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
    const focusedId = document.activeElement?.closest?.('.vd-task')?.dataset.task;
    const running = state.tasks.filter(task => task.status === 'running').length;
    root.querySelector('[data-history-count]').textContent = `${state.tasks.length} 个任务${running ? ` · ${running} 个进行中` : ''}`;
    if (!state.tasks.length) {
      historyHost.innerHTML = `<div class="vd-history-empty"><span>${glyph.face}</span><strong>暂无检测任务</strong><p>选择左侧示例视频或上传本机人物视频后，点击「开始检测」发起检测。</p></div>`;
      return;
    }
    historyHost.innerHTML = state.tasks.map(task => {
      const selected = task.id === state.selectedId;
      const result = task.result;
      const poster = taskPoster(task);
      const risk = task.status === 'succeeded' && result ? riskBadge(result.risk) : '';
      const progress = task.status === 'running'
        ? `<span class="vd-task-progress" aria-hidden="true"><span data-task-fill="${escapeText(task.id)}" style="width:${task.progress?.percent ?? 8}%"></span></span>`
        : '';
      return `<div class="vd-task" role="button" tabindex="0" data-task="${escapeText(task.id)}" aria-pressed="${selected}">
        <span class="vd-task-thumb">${poster ? `<img src="${escapeText(poster)}" alt="">` : glyph.face}</span>
        <span class="vd-task-body">
          <strong title="${escapeText(task.name)}">${escapeText(task.name)}</strong>
          <span class="vd-task-meta">${escapeText(task.createdAt)} · ${formatDuration(task.meta?.duration)}</span>
          <span class="vd-task-state" data-state="${task.status}" data-task-state="${escapeText(task.id)}">${escapeText(statusLine(task))}</span>
          ${progress}
        </span>
        <span class="vd-task-side">${task.sample ? '<span class="vd-task-tag">样例</span>' : ''}${risk}
          <button type="button" class="vd-task-del" data-delete="${escapeText(task.id)}" aria-label="删除任务：${escapeText(task.name)}" title="删除任务">${glyph.trash}</button>
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
      const stats = resultStats(task.result);
      const prefix = task.sample ? '查看样例结果' : '查看结果';
      return `${prefix} · ${RISK_LABELS[task.result.risk]} · ${stats.persons} 人 / ${stats.segments} 段 ${icon('arrow')}`;
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
    const material = task?.material?.version ? ` · 材料版本 ${task.material.version}` : '';
    file.textContent = task ? `${task.name} · ${task.createdAt}${material}` : '选择上方示例视频或上传本地人物视频，点击「开始检测」生成结果';
    const jumpBtn = root.querySelector('[data-jump-result]');
    jumpBtn.hidden = !task;
    jumpBtn.innerHTML = jumpLabel(task);
    const tags = [];
    if (task?.status === 'running') tags.push('<span class="vd-flag" data-state="running">检测中</span>');
    if (task?.status === 'failed') tags.push('<span class="vd-flag" data-state="failed">检测失败</span>');
    if (task?.status === 'cancelled') tags.push('<span class="vd-flag" data-state="cancelled">已取消</span>');
    if (task?.status === 'succeeded' && task.result?.aiGeneratedMarker?.detected) tags.push('<span class="vd-flag" data-state="metadata">元数据标记AI生成</span>');
    if (task?.status === 'succeeded' && task.result?.visualAiMarker?.detected) tags.push('<span class="vd-flag" data-state="visual">画面标识AI生成</span>');
    if (task?.status === 'succeeded' && task.result) tags.push(riskBadge(task.result.risk));
    root.querySelector('[data-result-tags]').innerHTML = tags.join('');
  }

  function sampleStrip() {
    return `<div class="vd-sample-strip" role="note"><span class="vd-flag vd-flag-sample">样例数据</span><p>该任务使用虚构人物画面与结论展示界面流程，不代表真实检测结果。</p></div>`;
  }

  function metric(label, value, hint = '') {
    return `<div class="vd-metric"${hint ? ` title="${escapeText(hint)}"` : ''}><span>${label}</span><strong>${value}</strong></div>`;
  }

  function riskAnalysis(result, stats) {
    if (result.aiGeneratedMarker?.detected) {
      if (!result.persons.length) return '文件元数据包含AI生成标识，已直接判定为AI生成；未识别到可用人脸，模型结果仅作补充。';
      const clue = stats.segments ? `，模型检测发现 ${stats.segments} 个可疑片段` : '';
      return `文件元数据包含AI生成标识，已直接判定为AI生成${clue}；建议结合原视频复核。`;
    }
    if (result.visualAiMarker?.detected) {
      const marker = result.visualAiMarker;
      const time = formatTimecode(marker.time);
      const text = marker.text ? `「${marker.text}」` : '';
      if (!result.persons.length) return `画面 ${time} 出现AI生成标识${text}，已直接判定为AI生成；未识别到可用人脸，模型结果仅作补充。`;
      return `画面 ${time} 出现AI生成标识${text}，已直接判定为AI生成；建议结合原视频复核。`;
    }
    if (!result.persons.length) return '未识别到可用人脸，暂时无法判断风险；请更换更清晰的人物视频后重试。';
    if (result.risk === 'high') {
      const clue = stats.segments ? `发现 ${stats.segments} 个可疑片段` : '检测到可疑线索';
      return `已检查 ${stats.persons} 位人物，${clue}；建议优先复核标记片段。`;
    }
    if (result.risk === 'medium') {
      const clue = stats.segments ? `发现 ${stats.segments} 个可疑片段` : '检测到可疑线索';
      return `已检查 ${stats.persons} 位人物，${clue}；建议结合原视频进一步核查。`;
    }
    if (result.risk === 'low') {
      return `已检查 ${stats.persons} 位人物，未发现可定位的可疑片段；未覆盖部分仍需谨慎对待。`;
    }
    return '风险暂无法判断，建议结合原视频和人工复核确认。';
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
      ? `<circle class="vd-probability-ring-fill" cx="21" cy="21" r="${radius}" stroke-dasharray="${dash.toFixed(2)} ${circumference.toFixed(2)}" transform="rotate(-90 21 21)"></circle>`
      : '';
    return `<div class="vd-probability-chart" data-risk="${escapeText(result.risk)}" role="group" aria-label="AI概率构成">
      <div class="vd-probability-donut">
        <svg viewBox="0 0 42 42" aria-hidden="true" focusable="false">
          <circle class="vd-probability-ring-track" cx="21" cy="21" r="${radius}"></circle>
          ${fill}
        </svg>
        <span class="vd-probability-center"><strong>${aiText}</strong><small>AI概率</small></span>
      </div>
      <div class="vd-probability-legend">
        <p><i class="vd-probability-swatch ai"></i><span>AI生成</span><strong>${aiText}</strong></p>
        <p><i class="vd-probability-swatch rest"></i><span>非AI / 其他</span><strong>${otherText}</strong></p>
      </div>
    </div>`;
  }

  function playerMarkup(task, result) {
    const person = selectedPerson() || defaultPerson(result);
    const frames = person?.frames?.length ? person.frames : allFrames(result);
    const initialFrame = nearestFrame(frames, state.currentTime);
    const video = task.media?.objectUrl
      ? `<video data-video src="${escapeText(task.media.objectUrl)}"${task.media.poster ? ` poster="${escapeText(task.media.poster)}"` : ''} preload="metadata" playsinline></video>`
      : initialFrame?.image
        ? `<img data-stage-image src="${escapeText(initialFrame.image)}" alt="${escapeText(`${task.sample ? '样例' : ''}人脸画面：${initialFrame.caption}`)}">`
        : `<div class="vd-stage-placeholder">${glyph.face}<span>${result.persons.length ? '暂无人脸画面' : '未识别到人物画面'}</span></div>`;
    const bands = result.persons.flatMap(owner => owner.segments.map(segment => {
      const left = Math.max(0, Math.min(100, segment.start / result.duration * 100));
      const width = Math.max(0.5, Math.min(100 - left, (segment.end - segment.start) / result.duration * 100));
      const title = `${owner.label} · ${formatTimecode(segment.start)}–${formatTimecode(segment.end)} · ${RISK_LABELS[segment.risk]}`;
      return `<span class="vd-risk-band" data-band="${escapeText(segment.id)}" data-person="${escapeText(owner.id)}" data-risk="${segment.risk}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%" title="${escapeText(title)}"></span>`;
    })).join('');
    const legend = result.persons.length
      ? `<div class="vd-person-legend" aria-label="时间轴人物筛选">${result.persons.map(owner => `<button type="button" class="vd-legend-person" data-legend-person="${escapeText(owner.id)}" aria-pressed="${owner.id === person?.id}"><i data-risk="${owner.risk}"></i><span>${escapeText(owner.label)}</span></button>`).join('')}</div>`
      : '';
    return `<div class="vd-player" data-player>
      <div class="vd-stage" data-stage>
        ${video}
        <span class="vd-stage-tag">${task.sample ? '样例人脸画面 · 非原始视频' : '原视频'}</span>
        <span class="vd-stage-person" data-stage-person>${escapeText(person?.label || '未识别到人物画面')}</span>
        <button type="button" class="vd-stage-toggle" data-stage-toggle aria-label="播放视频">${glyph.play}</button>
        <span class="vd-stage-time" data-stage-time>${formatTimecode(state.currentTime)}</span>
      </div>
      <div class="vd-controls">
        <button type="button" class="vd-icon-button" data-play-toggle aria-label="播放视频" aria-pressed="false">${glyph.play}</button>
        <div class="vd-timeline" data-timeline role="slider" tabindex="0" aria-label="视频时间轴，按左右方向键调整" aria-valuemin="0" aria-valuemax="${result.duration}" aria-valuenow="${state.currentTime}" aria-valuetext="${formatTimecode(state.currentTime)}">
          <div class="vd-timeline-track">
            ${bands}
            <span class="vd-timeline-fill" data-progress-fill></span>
            <span class="vd-playhead" data-playhead></span>
          </div>
        </div>
        <span class="vd-time"><span data-current-time>${formatTimecode(state.currentTime)}</span> / ${formatTimecode(result.duration)}</span>
        ${task.media?.objectUrl ? `<button type="button" class="vd-icon-button" data-mute aria-label="静音" aria-pressed="false">${glyph.volume}</button>` : ''}
      </div>
      ${legend}
      <p class="vd-player-note" data-player-note>${task.sample
        ? '样例任务没有原始视频，播放器按所选人物的代表人脸画面模拟时间轴，用于演示定位交互。'
        : '点击时间轴、可疑片段或人脸画面，可跳转到原视频对应位置核查。'}</p>
    </div>`;
  }

  function summaryMarkup(task, result) {
    const stats = resultStats(result);
    const findings = result.findings.length ? result.findings : [];
    const marker = result.aiGeneratedMarker?.detected;
    const visualMarker = result.visualAiMarker?.detected;
    const unknowns = result.persons.length
      ? ''
      : marker
        ? '<p class="vd-caution">未识别到可用人脸，但文件元数据已包含AI生成标识，综合风险仍判定为高风险。</p>'
        : visualMarker
          ? '<p class="vd-caution">未识别到可用人脸，但画面中出现AI生成标识，综合风险仍判定为高风险。</p>'
          : '<p class="vd-caution">未识别到可用于检测的人物画面，综合风险无法判断；未检测到人脸不等于视频真实或其他画面安全。</p>';
    return `<aside class="vd-summary-panel" aria-label="检测结论">
      <div class="vd-summary-main">
        <div class="vd-summary-top"><span>综合风险</span>${riskBadge(result.risk)}</div>
        <div class="vd-risk-scale" data-level="${riskLevel(result.risk)}" aria-hidden="true"><i></i><i></i><i></i></div>
        <p class="vd-risk-analysis">${escapeText(riskAnalysis(result, stats))}</p>
        ${probabilityChartMarkup(result)}
        ${findings.length ? `<div class="vd-findings"><h4>主要线索</h4><ul>${findings.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul></div>` : ''}
        ${unknowns}
      </div>
      <div class="vd-summary-side">
        <p class="vd-side-title">检测范围与覆盖</p>
        <dl class="vd-scope">
          <div><dt>识别人物</dt><dd>${stats.persons} 人${stats.suspiciousPersons ? ` · ${stats.suspiciousPersons} 人存在可疑片段` : ''}</dd></div>
          <div><dt>检测覆盖</dt><dd>${coverageChip(result.coverage)} ${escapeText(result.scope || '')}</dd></div>
        </dl>
      </div>
    </aside>`;
  }

  function segmentCards(person, task) {
    if (!person.segments.length) {
      return `<div class="vd-empty-state">${icon('check')}<div><strong>该人物未发现可定位的可疑片段</strong><p>结合代表人脸画面与出现区间综合查看。</p></div></div>`;
    }
    return `<div class="vd-segment-grid">${person.segments.map((segment) => {
      const frame = person.frames.find(item => item.id === segment.frameId) || nearestFrame(person.frames, (segment.start + segment.end) / 2);
      return `<article class="vd-segment-card" data-segment-card data-segment-id="${escapeText(segment.id)}" data-risk="${segment.risk}" data-start="${segment.start}" data-end="${segment.end}">
        <button type="button" class="vd-segment-button" data-seek="${segment.start}" aria-label="${escapeText(`定位到 ${formatTimecode(segment.start)} 到 ${formatTimecode(segment.end)} 的${RISK_LABELS[segment.risk]}片段`)}">
          <span class="vd-segment-media">
            ${frameImage(frame, task) || `<span class="vd-frame-fallback">${glyph.face}</span>`}
            <span class="vd-frame-time">${formatTimecode(segment.start)}</span>
            <span class="vd-segment-risk">${riskBadge(segment.risk)}</span>
          </span>
          <span class="vd-segment-body">
            <span class="vd-segment-range">${formatTimecode(segment.start)} – ${formatTimecode(segment.end)}</span>
            <span class="vd-segment-summary">${escapeText(segment.explanation ? `视觉复核：${segment.explanation}` : segment.summary)}</span>
            ${segment.signals.length && !segment.explanation ? `<span class="vd-signal-list">${segment.signals.map(signal => `<span>${escapeText(signal)}</span>`).join('')}</span>` : ''}
            <span class="vd-segment-link">定位播放 ${icon('arrow')}</span>
          </span>
        </button>
      </article>`;
    }).join('')}</div>`;
  }

  function faceCards(person, task) {
    if (!person.frames.length) {
      return `<div class="vd-empty-state">${glyph.face}<div><strong>未提供该人物的人脸画面</strong><p>请以检测范围、风险说明和原视频为准。</p></div></div>`;
    }
    const cards = person.frames.map(frame => `<button type="button" class="vd-face-card" data-face-card data-frame-id="${escapeText(frame.id)}" data-risk="${frame.risk}" data-seek="${frame.time}" aria-pressed="false" aria-label="${escapeText(`定位到 ${formatTimecode(frame.time)}，${RISK_LABELS[frame.risk]}人脸画面：${frame.caption}`)}">
      <span class="vd-face-media">
        ${frameImage(frame, task) || `<span class="vd-frame-fallback">${glyph.face}</span>`}
        <span class="vd-frame-time">${formatTimecode(frame.time)}</span>
        <span class="vd-face-risk">${riskBadge(frame.risk)}</span>
        ${frame.quality === null || frame.quality === undefined ? '' : `<span class="vd-face-quality">清晰度 ${frame.quality}</span>`}
      </span>
      <span class="vd-face-caption">${escapeText(frame.caption)}</span>
    </button>`).join('');
    return `<div class="vd-face-grid">${cards}</div>
      <p class="vd-frames-empty" data-frames-empty hidden>当前筛选下没有可疑人脸画面。</p>`;
  }

  function personDetailMarkup(person, task) {
    return `<article class="vd-person-detail" data-person-detail="${escapeText(person.id)}">
      <header class="vd-person-detail-head">
        <div>
          <h5>${escapeText(person.label)}</h5>
          <p class="vd-person-presence">出现时间 ${formatTimecode(person.firstSeen)} – ${formatTimecode(person.lastSeen)} · 可用人脸 ${person.faceFrames} 帧 · 代表画面 ${person.frames.length} 张 · 可疑 ${person.segments.length} 段</p>
        </div>
        <div class="vd-person-tags">${riskBadge(person.risk)}${coverageChip(person.coverage)}</div>
      </header>
      <p class="vd-person-summary">${escapeText(person.summary)}</p>
      ${person.findings.length ? `<div class="vd-person-findings"><h6>人物线索</h6><ul>${person.findings.map(item => `<li>${escapeText(item)}</li>`).join('')}</ul></div>` : ''}
      <section class="vd-subsection" aria-label="${escapeText(person.label)}的可疑时间段">
        <div class="vd-subhead"><h6>可疑时间段</h6><span>${person.segments.length} 段</span></div>
        ${segmentCards(person, task)}
      </section>
      <section class="vd-subsection" aria-label="${escapeText(person.label)}的人脸画面">
        <div class="vd-subhead">
          <h6>人脸画面</h6>
          <div class="vd-subhead-actions">
            <span data-face-count>${person.frames.length} 张</span>
            <label class="vd-filter"><input type="checkbox" data-filter ${state.filterSuspicious ? 'checked' : ''}> 仅看可疑画面</label>
          </div>
        </div>
        ${faceCards(person, task)}
      </section>
    </article>`;
  }

  function noPersonsMarkup(result) {
    if (result.aiGeneratedMarker?.detected) {
      const marker = result.aiGeneratedMarker;
      const evidence = [marker.source, marker.value].filter(Boolean).join('；');
      return `<div class="vd-empty-state vd-no-persons">${glyph.face}<div><strong>文件元数据已标记为AI生成</strong>
        <p>模型检测未识别到可用于逐人分析的人脸画面，但文件元数据包含AI生成标识，综合风险直接判定为高风险。</p>
        ${evidence ? `<p class="vd-no-persons-note">标识依据：${escapeText(evidence)}</p>` : ''}
        <p class="vd-no-persons-note">未识别到人脸不代表其他画面安全；建议结合原视频复核。</p></div></div>`;
    }
    if (result.visualAiMarker?.detected) {
      const marker = result.visualAiMarker;
      const evidence = [
        `画面 ${formatTimecode(marker.time)}`,
        marker.text,
        marker.location,
        marker.confidence === null || marker.confidence === undefined ? '' : `置信度 ${Math.round(marker.confidence * 100)}%`,
      ].filter(Boolean).join('；');
      return `<div class="vd-empty-state vd-no-persons">${glyph.face}<div><strong>画面中出现AI生成标识</strong>
        <p>模型检测未识别到可用于逐人分析的人脸画面，但画面已出现AI生成标识，综合风险直接判定为高风险。</p>
        ${evidence ? `<p class="vd-no-persons-note">标识依据：${escapeText(evidence)}</p>` : ''}
        <p class="vd-no-persons-note">未识别到人脸不代表其他画面安全；建议结合原视频复核。</p></div></div>`;
    }
    return `<div class="vd-empty-state vd-no-persons">${glyph.face}<div><strong>未识别到可用于检测的人物画面</strong>
      <p>本次处理没有识别人脸，无法完成换脸与面部合成判断，因此不输出低风险结论。请更换人物正面清晰可见、时长更完整的视频后重新检测。</p>
      <p class="vd-no-persons-note">状态：无法判断 · 未检测到人脸不等于视频真实，也不等于其他画面安全。</p></div></div>`;
  }

  function personsMarkup(task, result) {
    const stats = resultStats(result);
    return `<section class="vd-section vd-persons" aria-labelledby="vd-persons-title">
      <div class="vd-section-head">
        <div><h4 id="vd-persons-title">按人物分别查看</h4><p>视频出现多个人物时，分别展示每人的风险、可疑时间段与人脸画面。</p></div>
        <span class="vd-section-count">${stats.persons} 人 · ${stats.suspiciousPersons} 人需关注 · ${result.faceFrames} 帧人脸</span>
      </div>
      <div data-person-roster></div>
      <div data-person-detail-host></div>
    </section>`;
  }

  function reportMarkup(task, result) {
    const stats = resultStats(result);
    const saved = task.savedAt ? `已于 ${formatDateTime(task.savedAt)} 保存到本机。` : '';
    return `<section class="vd-report" aria-labelledby="vd-report-title">
      <div class="vd-report-copy">
        <h4 id="vd-report-title">人物换脸与深度伪造检测报告</h4>
        <p>汇总 ${stats.persons} 位人物、${stats.segments} 个可疑片段与 ${stats.frames} 张代表人脸画面，支持保存到浏览器或导出独立 HTML 报告。</p>
        <div class="vd-report-facts">
          ${result.aiGeneratedMarker?.detected ? '<span>元数据标识：AI生成</span>' : ''}
          ${result.visualAiMarker?.detected ? '<span>画面标识：AI生成</span>' : ''}
          <span>结果来源：${task.sample ? '样例数据' : '检测服务'}</span>
        </div>
      </div>
      <div class="vd-report-actions">
        <button type="button" class="vd-btn vd-btn-secondary" data-save-report>${glyph.save} 保存记录</button>
        <button type="button" class="vd-btn vd-btn-primary" data-export-report>${glyph.download} 导出报告</button>
        <p class="vd-report-status" data-report-status role="status" aria-live="polite"${saved ? '' : ' hidden'}>${escapeText(saved)}</p>
      </div>
    </section>`;
  }

  function runningMarkup(task) {
    const percent = task.progress?.percent;
    const stage = task.progress?.stage || '正在准备检测';
    return `<div class="vd-state vd-running" aria-live="polite">
      <div class="vd-state-icon">${glyph.face}</div>
      <p class="vd-step">检测进行中</p>
      <h4 data-progress-stage>${escapeText(stage)}</h4>
      <p>${escapeText(task.name)} 已提交。人物识别与逐人换脸检测完成后会自动更新结果。</p>
      <div class="vd-progress" data-indeterminate="${percent === null || percent === undefined}" data-progress-track>
        <span data-progress-fill style="width:${percent === null || percent === undefined ? 100 : Math.round(percent)}%"></span>
      </div>
      <div class="vd-progress-meta">
        <span data-progress-percent>${percent === null || percent === undefined ? '等待服务返回进度…' : `${Math.round(percent)}%`}</span>
        <button type="button" class="vd-btn vd-btn-quiet" data-cancel>取消检测</button>
      </div>
    </div>`;
  }

  function failedMarkup(task) {
    const cancelled = task.status === 'cancelled';
    return `<div class="vd-state vd-failed">
      <div class="vd-state-icon">${cancelled ? glyph.face : glyph.alert}</div>
      <p class="vd-step">${cancelled ? '已取消' : '检测未完成'}</p>
      <h4>${cancelled ? '本次检测已取消' : '检测服务未能完成处理'}</h4>
      <p>${escapeText(task.error || (cancelled ? '本次检测已取消，可重新发起检测。' : '检测服务未返回结果，请稍后重试。'))}</p>
      ${task.media?.file ? `<button type="button" class="vd-btn vd-btn-primary" data-retry>${glyph.refresh} ${renderCreditButtonHtml('重新检测')}</button>` : ''}
    </div>`;
  }

  function renderPersons() {
    const rosterHost = resultHost.querySelector('[data-person-roster]');
    const detailHost = resultHost.querySelector('[data-person-detail-host]');
    if (!rosterHost || !detailHost) return;
    const task = selectedTask();
    const result = currentResult();
    if (!task || !result) return;
    ensurePersonSelection(result);
    if (!result.persons.length) {
      rosterHost.innerHTML = '';
      detailHost.innerHTML = noPersonsMarkup(result);
      return;
    }
    const focusedId = document.activeElement?.closest?.('[data-person-card]')?.dataset.personCard;
    rosterHost.innerHTML = `<div class="vd-person-grid">${result.persons.map(person => {
      const selected = person.id === state.selectedPersonId;
      const poster = personPoster(person);
      return `<button type="button" class="vd-person-card" data-person-card="${escapeText(person.id)}" aria-pressed="${selected}">
        <span class="vd-person-thumb">${poster ? `<img src="${escapeText(poster)}" alt="">` : glyph.face}</span>
        <span class="vd-person-body">
          <span class="vd-person-name">${escapeText(person.label)}</span>
          <span class="vd-person-meta">人脸 ${person.faceFrames} 帧 · ${formatTimecode(person.firstSeen)}–${formatTimecode(person.lastSeen)}</span>
          <span class="vd-person-badges">${person.coverage === 'partial' ? coverageChip('partial') : ''}<span class="vd-person-signal" data-tone="${person.segments.length ? 'warn' : 'clear'}">${person.segments.length} 段可疑</span></span>
        </span>
        <span class="vd-person-side">${riskBadge(person.risk)}<span class="vd-person-enter">${selected ? '正在查看' : '查看'} ${icon('chevron')}</span></span>
      </button>`;
    }).join('')}</div>`;
    const person = selectedPerson();
    detailHost.innerHTML = person ? personDetailMarkup(person, task) : '';
    applyFrameFilter();
    if (focusedId) {
      const target = Array.from(rosterHost.querySelectorAll('[data-person-card]')).find(item => item.dataset.personCard === focusedId);
      target?.focus({ preventScroll: true });
    }
    updatePlaybackUi();
  }

  function renderResult() {
    const task = selectedTask();
    stopPlayer();
    renderResultHeader(task);
    renderVersionNote();
    if (!task) {
      resultHost.innerHTML = `<div class="vd-state"><div class="vd-state-icon">${glyph.face}</div><h4>选择一个检测任务</h4><p>从上方任务列表选择任务，查看人物识别、逐人风险、可疑时间段和人脸画面。</p></div>`;
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
      resultHost.innerHTML = `<div class="vd-state"><div class="vd-state-icon">${glyph.face}</div><h4>该任务暂无检测结果</h4><p>检测完成后会在这里显示逐人物结果。</p></div>`;
      return;
    }
    const result = task.result;
    ensurePersonSelection(result);
    const stats = resultStats(result);
    const aiProbabilityText = result.persons.length || result.aiGeneratedMarker?.detected || result.visualAiMarker?.detected
      ? formatProbability(result.aiProbability)
      : '无法判断';
    resultHost.innerHTML = `${task.sample ? sampleStrip() : ''}
      <div class="vd-metrics">
        ${metric('综合风险', riskBadge(result.risk))}
        ${metric('AI概率', aiProbabilityText, '人物画面综合伪造评估得分')}
        ${metric('识别人物', `${stats.persons} 人`)}
      </div>
      <div class="vd-result-grid">
        <section class="vd-player-panel" aria-label="视频与时间轴">${playerMarkup(task, result)}</section>
        ${summaryMarkup(task, result)}
      </div>
      ${personsMarkup(task, result)}
      ${reportMarkup(task, result)}`;
    setupPlayer();
    bindStage();
    bindTimeline(resultHost.querySelector('[data-timeline]'));
    renderPersons();
    updatePlaybackUi();
  }

  function setupPlayer() {
    const video = resultHost.querySelector('[data-video]');
    state.video = video;
    if (!video) return;
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
      if (note) note.textContent = '浏览器无法播放该视频，但仍可查看人物检测结果和人脸画面。';
    });
    if (video.readyState >= 1 && state.currentTime > 0) {
      try { video.currentTime = Math.min(state.currentTime, video.duration || state.currentTime); } catch { /* 视频尚未就绪 */ }
    }
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

    const person = selectedPerson() || defaultPerson(result);
    const selectedFrames = person?.frames?.length ? person.frames : allFrames(result);
    const stageImage = player.querySelector('[data-stage-image]');
    if (stageImage && selectedFrames.length) {
      const frame = nearestFrame(selectedFrames, time);
      if (frame?.image && stageImage.getAttribute('src') !== frame.image) stageImage.src = frame.image;
      if (frame) stageImage.alt = `${task.sample ? '样例' : ''}人脸画面：${frame.caption}`;
    }
    const stagePerson = player.querySelector('[data-stage-person]');
    if (stagePerson) stagePerson.textContent = person?.label || '未识别到人物画面';

    const nearest = nearestFrame(selectedFrames, time);
    for (const card of resultHost.querySelectorAll('[data-face-card]')) {
      card.setAttribute('aria-pressed', String(nearest?.id === card.dataset.frameId));
    }
    for (const card of resultHost.querySelectorAll('[data-segment-card]')) {
      const start = Number(card.dataset.start);
      const end = Number(card.dataset.end);
      card.dataset.active = String(time >= start && time < end);
    }
    for (const band of resultHost.querySelectorAll('[data-band]')) {
      const segment = result.persons.flatMap(owner => owner.segments).find(item => item.id === band.dataset.band);
      band.dataset.active = String(Boolean(segment && time >= segment.start && time < segment.end));
      band.dataset.dim = String(Boolean(person && band.dataset.person !== person.id));
    }
    for (const button of player.querySelectorAll('[data-legend-person]')) {
      button.setAttribute('aria-pressed', String(button.dataset.legendPerson === person?.id));
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
    if (state.currentTime >= task.result.duration - 0.05) state.currentTime = initialPlaybackTime(task);
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
    state.selectedPersonId = null;
    state.currentTime = initialPlaybackTime(task);
    state.filterSuspicious = false;
    ensurePersonSelection(task.result);
    renderHistory();
    renderResult();
    if (scroll) revealResult();
  }

  function selectPerson(id) {
    const result = currentResult();
    if (!result?.persons.some(person => person.id === id)) return;
    if (state.selectedPersonId === id) return;
    state.selectedPersonId = id;
    state.filterSuspicious = false;
    renderPersons();
    updatePlaybackUi();
  }

  function applyFrameFilter() {
    const cards = Array.from(resultHost.querySelectorAll('[data-face-card]'));
    let visible = 0;
    for (const card of cards) {
      const suspicious = card.dataset.risk === 'medium' || card.dataset.risk === 'high';
      const show = !state.filterSuspicious || suspicious;
      card.hidden = !show;
      if (show) visible += 1;
    }
    const empty = resultHost.querySelector('[data-frames-empty]');
    if (empty) empty.hidden = visible > 0 || !cards.length;
    const count = resultHost.querySelector('[data-face-count]');
    if (count) count.textContent = state.filterSuspicious ? `${visible} / ${cards.length} 张` : `${cards.length} 张`;
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
    task.progress = { stage: '准备识别人脸画面', percent: null };
    task.error = null;
    renderUpload();
    renderHistory();
    if (state.selectedId === task.id) {
      renderResultHeader(task);
      resultHost.innerHTML = runningMarkup(task);
      if (reveal) revealResult();
    }
    try {
      const result = await videoDeepfakeDetection.run(
        {
          file: task.media.file,
          metadata: {
            name: task.name,
            size: task.meta.size,
            type: task.media.file.type,
            duration: task.meta.duration,
            width: task.meta.width,
            height: task.meta.height,
            materialVersion: task.material.version,
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
        if (state.selectedId === task.id) {
          state.selectedPersonId = null;
          state.currentTime = initialPlaybackTime(task);
          ensurePersonSelection(result);
        }
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
      id: `vd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sample: false,
      name: media.file.name,
      createdAt: formatDateTime(new Date()),
      completedAt: '',
      status: 'idle',
      meta: { size: media.size, duration: media.duration, width: media.width, height: media.height, type: media.file.type },
      material: {
        name: media.file.name,
        size: media.size,
        lastModified: Number(media.file.lastModified) || 0,
        version: media.version,
      },
      media: { file: media.file, objectUrl: media.objectUrl, poster: media.poster },
      result: null,
      progress: null,
      error: null,
      controller: null,
      savedAt: null,
    };
  }

  function beginDetection() {
    if (state.uploadBusy) return;
    if (busyRunning()) {
      notice('已有检测正在进行，请等待完成后再提交。', 'warning');
      return;
    }
    if (!state.upload) {
      notice('请先选择待检测人物视频。', 'error');
      return;
    }
    if (!videoDeepfakeDetection.configured) {
      notice('检测服务尚未接入，视频未提交。样例结果仅用于界面预览，不代表真实检测。', 'warning');
      return;
    }
    try {
      if (!ensureDetectionAllowed(1)) return;
    } catch (error) {
      notice(error.message, 'warning');
      return;
    }
    const task = createTask(state.upload);
    state.tasks.unshift(task);
    state.selectedId = task.id;
    state.selectedPersonId = null;
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
    const wasSelected = state.selectedId === task.id;
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
    if (wasSelected) {
      const next = state.tasks[Math.min(Math.max(index, 0), state.tasks.length - 1)] || null;
      state.selectedId = next?.id || null;
      state.selectedPersonId = null;
      state.currentTime = next ? initialPlaybackTime(next) : 0;
      state.playing = false;
      state.filterSuspicious = false;
    }
    renderUpload();
    renderHistory();
    if (wasSelected) renderResult();
    notice(state.tasks.length ? `已删除任务「${name}」。` : `已删除任务「${name}」，任务列表为空。`, 'info');
  }

  function retrySelected() {
    const task = selectedTask();
    if (!task?.media?.file) return;
    if (!videoDeepfakeDetection.configured) {
      notice('检测服务尚未接入，无法重新检测。', 'warning');
      return;
    }
    try {
      if (!ensureDetectionAllowed(1)) return;
    } catch (error) {
      notice(error.message, 'warning');
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
        task: {
          id: task.id,
          name: task.name,
          sample: task.sample,
          createdAt: task.createdAt,
          completedAt: task.completedAt,
          meta: task.meta,
          material: task.material,
        },
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
        version: materialVersion(file),
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
    stopProbe?.();
    unsubscribe();
    observer?.disconnect();
    if (!document.querySelector('.video-deepfake-page')) document.body.classList.remove('video-deepfake-route');
  }

  renderServiceState();
  renderUpload();
  renderHistory();
  state.currentTime = initialPlaybackTime(selectedTask());
  ensurePersonSelection(currentResult());
  renderResult();
  if (globalThis.matchMedia?.('(max-width:760px)').matches) {
    requestAnimationFrame(() => {
      if (container.isConnected) document.querySelector('.sidebar .nav-item.active')?.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
  }

  root.addEventListener('click', event => {
    const zone = event.target.closest('[data-drop]');
    if (zone && !event.target.closest('button') && !busyRunning() && !state.uploadBusy) {
      root.querySelector('[data-file-input]')?.click();
      return;
    }
    const del = event.target.closest('[data-delete]');
    if (del && root.contains(del)) {
      deleteTask(state.tasks.find(item => item.id === del.dataset.delete));
      return;
    }
    const button = event.target.closest('button');
    const taskItem = event.target.closest('.vd-task');
    if ((!button || !root.contains(button)) && taskItem && root.contains(taskItem)) {
      selectTask(taskItem.dataset.task, { scroll: true });
      return;
    }
    if (!button || !root.contains(button)) return;
    const data = button.dataset;
    if (data.vdSample) {
      void (async () => {
        if (busyRunning() || state.uploadBusy) return;
        const sample = VIDEO_DEEPFAKE_SAMPLES.find(item => item.id === data.vdSample);
        if (!sample) return;
        state.activeSample = sample.id;
        state.uploadBusy = true;
        renderUpload();
        try {
          const res = await fetch(sample.url);
          if (!res.ok) throw new Error('示例视频读取失败');
          const blob = await res.blob();
          state.uploadBusy = false;
          if (!state.disposed) await pickFile([new File([blob], sample.fileName, { type: 'video/mp4' })]);
        } catch {
          state.uploadBusy = false;
          if (!state.disposed) {
            notice('示例视频加载失败，请稍后重试。', 'error');
            renderUpload();
          }
        }
      })();
      return;
    }
    if (data.personCard) { selectPerson(data.personCard); return; }
    if (data.legendPerson) { selectPerson(data.legendPerson); return; }
    if (Object.hasOwn(data, 'jumpResult')) { revealResult(); return; }
    if (Object.hasOwn(data, 'choose')) { state.activeSample = ''; root.querySelector('[data-file-input]')?.click(); return; }
    if (Object.hasOwn(data, 'remove')) {
      if (busyRunning()) { notice('检测进行中，暂时不能移除视频。', 'warning'); return; }
      state.activeSample = '';
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
    const taskItem = event.target.closest?.('.vd-task');
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

  unsubscribe = videoDeepfakeDetection.subscribe(() => {
    if (state.disposed) return;
    renderServiceState();
    renderUpload();
  });
  observer = new MutationObserver(() => {
    if (!container.isConnected) dispose();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

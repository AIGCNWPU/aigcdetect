/** AI 音频伪造检测（4.1） */
import { renderCreditButtonHtml, setCreditButtonContent } from '../../../lib/credit-badge.js';
import { ensureDetectionAllowed, consumeClientDetectionCredit } from '../../../lib/auth-client.js';

const AF_EXPLICIT_API = new URLSearchParams(
  (typeof window !== 'undefined' && window.location.search) || '',
).get('api') || '';

const AF_LOCAL_API = 'http://127.0.0.1:8000';

// 兼容旧版深链参数
const AF_DEMO_ALIAS = { mlaad: 'wav1', asv5: 'wav3', cv: 'wav2', cv2: 'wav4' };

const AF_SAMPLES = [
  {
    id: 'wav1',
    title: '语音样本 01',
    file: 'wav1.wav',
    src: './public/demo/wav1.wav',
    meta: 'wav1.wav · 4.0 s · 16 kHz',
    kind: 'fake',
    pFake: 0.999,
    latency: '3.2 s',
    methodLabel: '语音合成（TTS）',
    regionLabel: '0.00 – 4.00 s（全段）',
    durationSec: 4,
    detectedRegion: [[0, 4]],
    note: '整段呈现一致的合成特征：基频曲线过于平滑，呼吸声与环境反射缺失，句间缺少自然停顿变化。',
  },
  {
    id: 'wav2',
    title: '语音样本 02',
    file: 'wav2.wav',
    src: './public/demo/wav2.wav',
    meta: 'wav2.wav · 4.0 s · 16 kHz',
    kind: 'real',
    pFake: 0.001,
    latency: '1.9 s',
    methodLabel: '未检出伪造手法',
    regionLabel: '无可疑片段',
    durationSec: 4,
    note: '底噪、换气与句间停顿自然连贯，未见声学合成断点或拼接痕迹。',
  },
  {
    id: 'wav3',
    title: '语音样本 03',
    file: 'wav3.wav',
    src: './public/demo/wav3.wav',
    meta: 'wav3.wav · 4.0 s · 16 kHz',
    kind: 'fake',
    pFake: 1.0,
    latency: '3.2 s',
    methodLabel: '语音合成（TTS）',
    regionLabel: '0.00 – 4.00 s（全段）',
    durationSec: 4,
    detectedRegion: [[0, 4]],
    note: '音素边界过于规整，尾音衰减幅度一致，缺少真实说话人应有的细微声带抖动。',
  },
  {
    id: 'wav4',
    title: '语音样本 04',
    file: 'wav4.wav',
    src: './public/demo/wav4.wav',
    meta: 'wav4.wav · 4.0 s · 16 kHz',
    kind: 'real',
    pFake: 0,
    latency: '1.9 s',
    methodLabel: '未检出伪造手法',
    regionLabel: '无可疑片段',
    durationSec: 4,
    note: '气息与环境底噪随语句自然起伏，停顿位置合理，未见合成或剪辑痕迹。',
  },
  {
    id: 'long60',
    title: '长音频局部拼接样本（60 秒分段滑窗）',
    file: 'long60.wav',
    src: './public/demo/long60.wav',
    meta: 'long60.wav · 60.0 s · 11 个滑窗分段定位',
    kind: 'fake',
    wide: true,
    pFake: 1,
    latency: '30.7 s',
    methodLabel: '局部语音合成插入（TTS）',
    regionLabel: '15.00 – 45.00 s',
    durationLabel: '60.00 s · 滑窗 11 段',
    windows: [0.001, 0.003, 0.029, 0.984, 0.997, 1, 0.999, 0.999, 0.001, 0.003, 0.029],
    durationSec: 60,
    detectedRegion: [[15, 45]],
    truthRegion: [20, 40],
    note: '按 10 秒窗口、5 秒步长逐段检测：前段与末段为自然人声，中段（15–45 秒）检出明显合成语音插入特征，点击上方评分曲线圆点可直接跳转试听对应位置。',
  },
];

const afEscape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

function afPad(value) {
  return String(Math.floor(value)).padStart(2, '0');
}

function afClock(seconds) {
  const total = Math.max(0, seconds || 0);
  return `${afPad(total / 60)}:${afPad(total % 60)}`;
}

const afIcons = {
  upload: '<path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  wave: '<path d="M3 12h2m3-5v10m4-13v16m4-13v10m4-7v4"/>',
  spark: '<path d="M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2m0-12-2 2M8 16l-2 2"/><circle cx="12" cy="12" r="2.5"/>',
  alert: '<path d="M12 4 3 20h18L12 4Z"/><path d="M12 10v4m0 3v.5"/>',
};

function afIcon(name, className = '') {
  return `<svg class="${className}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${afIcons[name] || ''}</svg>`;
}

function afSampleButton(sample) {
  return `<button type="button" class="af-chip${sample.wide ? ' af-chip-wide' : ''}" data-sample="${sample.id}" aria-pressed="false">
    <span class="af-chip-dot"></span>
    <span class="af-chip-body"><strong>${afEscape(sample.title || sample.file)}</strong><small>${afEscape(sample.meta)}</small></span>
    <span class="af-chip-play">${afIcon('wave', 'af-chip-wave')}</span>
  </button>`;
}

/** 可疑片段评分曲线：在有 ≥2 个滑窗时渲染，支持点击数据点定位试听。 */
function afChart(sample, { interactive = true } = {}) {
  const raw = sample.windows || [];
  if (raw.length < 2) return '';

  const points = raw.map((item, index) => {
    if (typeof item === 'number') {
      return { t: 5 + 5 * index, v: item };
    }
    return { t: (item.start + item.end) / 2, v: item.pFake };
  });

  const duration = Number(sample.durationSec || points[points.length - 1].t + 5);
  const W = 560;
  const H = 176;
  const L = 44;
  const R = 16;
  const T = 18;
  const B = 28;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const x = t => L + (t / duration) * plotW;
  const y = v => T + (1 - v) * plotH;
  const color = sample.kind === 'fake' ? '#b4472f' : '#2f7a5c';

  const parts = [];

  // 判定出的可疑区间高亮底色
  const detected = Array.isArray(sample.detectedRegion)
    ? sample.detectedRegion
    : (Array.isArray(sample.regions) ? sample.regions : []);
  detected.forEach(([a, b]) => {
    const rx = x(a);
    const rw = Math.max(2, x(b) - rx);
    parts.push(`<rect x="${rx.toFixed(1)}" y="${T}" width="${rw.toFixed(1)}" height="${plotH}" rx="4" fill="rgba(180,71,47,.10)"/>`);
    parts.push(`<text x="${(rx + rw / 2).toFixed(1)}" y="${(T + plotH * 0.36).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="600" fill="#a8432c">可疑区间 ${a}–${b}s</text>`);
  });

  // 水平网格与百分比刻度
  [
    { v: 0, label: '0%' },
    { v: 0.5, label: '50%' },
    { v: 1, label: '100%' },
  ].forEach(({ v, label }) => {
    parts.push(`<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="#eceef2"/>`);
    parts.push(`<text x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#7d8794">${label}</text>`);
  });

  // 阈值参考线
  parts.push(`<line x1="${L}" y1="${y(0.5).toFixed(1)}" x2="${W - R}" y2="${y(0.5).toFixed(1)}" stroke="#c9962b" stroke-width="1.2" stroke-dasharray="5 4"/>`);

  // 面积渐变填充 + 折线
  const lineCoords = points.map(p => `${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  const areaPath = `M${x(points[0].t).toFixed(1)},${(T + plotH).toFixed(1)} L${lineCoords.join(' L')} L${x(points[points.length - 1].t).toFixed(1)},${(T + plotH).toFixed(1)} Z`;
  parts.push(`<path d="${areaPath}" fill="${sample.kind === 'fake' ? 'rgba(180,71,47,.06)' : 'rgba(47,122,92,.06)'}"/>`);

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`);

  points.forEach(p => {
    const cx = x(p.t).toFixed(1);
    const cy = y(p.v).toFixed(1);
    const pct = `${(p.v * 100).toFixed(1)}%`;
    if (interactive) {
      parts.push(`<g class="af-chart-point" data-seek-time="${p.t}" role="button" tabindex="0" aria-label="跳转至 ${p.t} 秒（伪造风险 ${pct}）"><circle cx="${cx}" cy="${cy}" r="8" fill="transparent"/><circle cx="${cx}" cy="${cy}" r="3.8" fill="#fff" stroke="${color}" stroke-width="2"/><title>${p.t}s · 风险评分 ${pct}（点击试听）</title></g>`);
    } else {
      parts.push(`<circle cx="${cx}" cy="${cy}" r="3.5" fill="#fff" stroke="${color}" stroke-width="1.8"/>`);
    }
  });

  // 横轴时间刻度
  const ticks = duration >= 60 ? [0, 15, 30, 45, 60] : [0, Math.round(duration / 2), Math.round(duration)];
  ticks.forEach((sec, idx) => {
    const anchor = idx === 0 ? 'start' : idx === ticks.length - 1 ? 'end' : 'middle';
    parts.push(`<text x="${x(sec).toFixed(1)}" y="${H - 7}" text-anchor="${anchor}" font-size="11" fill="#7d8794">${sec}s</text>`);
  });

  return `<div class="af-chart">
    <div class="af-chart-head">
      <strong>分段伪造风险曲线</strong>
      <span>参考阈值 50% · 共 ${points.length} 个检测窗口</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="分段伪造风险评分曲线">${parts.join('')}</svg>
    ${interactive ? '<p class="af-chart-cap">10 秒滑窗 / 5 秒步长逐段评估 · 点击曲线上的圆点可直接定位到对应时间试听</p>' : ''}
  </div>`;
}

export function createAudioApi(platformApi, baseUrl = platformApi.baseUrl) {
  const client = { ...platformApi };
  client.configure({ baseUrl });
  return client;
}

export function renderAudioForgery(container) {
  container.classList.add('audio-forgery-page');
  const audioApi = createAudioApi(window.Veritas.api);
  container.innerHTML = `
    <div class="af">
      <div class="af-top">
        <p class="af-sub">上传待检测音频或视频，快速识别 AI 语音合成、声音克隆与局部拼接片段。</p>
        <span class="af-engine"><i></i><span>音频鉴伪引擎<small id="af-engine-mode">${AF_EXPLICIT_API ? '在线检测已就绪' : '样例体验模式'}</small></span></span>
      </div>

      <div class="af-grid">
        <section class="af-card af-left" aria-label="待检素材">
          <div class="af-card-head">
            <h3>待检音频</h3>
            <span class="af-hint" id="af-hint">未选择素材</span>
          </div>

          <div class="af-samples" id="af-samples" role="group" aria-label="实测样例音频">${AF_SAMPLES.map(afSampleButton).join('')}</div>

          <div class="af-drop" id="af-drop" role="button" tabindex="0" aria-label="上传音频或视频">
            <span class="af-drop-icon">${afIcon('upload')}</span>
            <span class="af-drop-text"><strong>拖入音频或视频</strong>或<span class="af-link">点击选择文件</span><small>支持 WAV / MP3 / M4A / FLAC / MP4 / MOV / WebM · ≤ 80 MB · ≤ 2 分钟</small></span>
            <input type="file" id="af-file" accept="audio/*,video/*,.wav,.mp3,.m4a,.flac,.ogg,.opus,.mp4,.mov,.mkv,.webm,.avi,.m4v" hidden>
          </div>

          <div class="af-player">
            <div class="af-wave-head">
              <span>声学波形与可疑区间预览</span>
              <span id="af-clock" class="af-clock">00:00 / 00:00</span>
            </div>
            <canvas id="af-wave" class="af-wave" height="92" aria-label="音频波形时间轴，点击可定位播放进度"></canvas>
            <video id="af-video" class="af-video" controls preload="metadata" hidden></video>
            <audio id="af-audio" controls preload="metadata"></audio>
            <p class="af-player-meta" id="af-meta">选择上方样例音频或上传本地文件后即可试听</p>
          </div>

          <div class="af-submit-bar">
            <span class="af-submit-hint" id="af-submit-hint">选择上方样本或上传文件后开始检测</span>
            <button type="button" class="af-start-btn" id="af-start" disabled>${renderCreditButtonHtml('开始检测')}</button>
          </div>
        </section>

        <section class="af-card af-right" aria-label="检测结论">
          <div class="af-card-head">
            <h3>检测结论</h3>
            <span class="af-hint" id="af-state">待检测</span>
          </div>
          <div id="af-verdict" class="af-verdict">
            <div class="af-empty">
              <span class="af-empty-icon">${afIcon('spark')}</span>
              <strong>尚未开始检测</strong>
              <p>选择左侧语音样本或上传本地音视频文件，点击「开始检测」查看声学鉴伪结论与分段风险曲线。</p>
            </div>
          </div>
        </section>
      </div>
    </div>
    <div id="af-report" class="af-report" aria-hidden="true"></div>`;

  const root = container;
  const samplesBox = root.querySelector('#af-samples');
  const drop = root.querySelector('#af-drop');
  const fileInput = root.querySelector('#af-file');
  const audio = root.querySelector('#af-audio');
  const video = root.querySelector('#af-video');
  const canvas = root.querySelector('#af-wave');
  const clockEl = root.querySelector('#af-clock');
  const verdict = root.querySelector('#af-verdict');
  const hint = root.querySelector('#af-hint');
  const state = root.querySelector('#af-state');
  const meta = root.querySelector('#af-meta');
  const startBtn = root.querySelector('#af-start');
  const submitHint = root.querySelector('#af-submit-hint');
  const reportRoot = root.querySelector('#af-report');

  let disposed = false;
  let analyzing = false;
  let objectUrl = null;
  let runId = 0;
  let current = null;
  let selectedTarget = null;
  let lastResult = null;
  let lastMeta = { source: '演示样例' };
  let waveState = { peaks: null, tone: 'real', regions: null, durationSec: 0 };

  const syncStartButton = () => {
    if (!startBtn) return;
    startBtn.disabled = analyzing || !selectedTarget;
    setCreditButtonContent(startBtn, analyzing ? '正在检测…' : '开始检测', { showCost: !analyzing });
  };

  let liveEnabled = Boolean(AF_EXPLICIT_API);
  const applyLive = base => {
    if (disposed) return;
    liveEnabled = true;
    audioApi.configure({ baseUrl: base });
    const mode = root.querySelector('#af-engine-mode');
    if (mode) mode.textContent = '在线检测已就绪';
    if (!current) meta.textContent = '在线检测服务已就绪，可直接上传音频或视频';
  };

  const probeController = new AbortController();
  if (AF_EXPLICIT_API) {
    applyLive(AF_EXPLICIT_API);
  } else if (['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    // 仅在显式配置或同源存在时启用；本地无 8000 服务时不输出控制台噪音
    const timer = window.setTimeout(() => probeController.abort(), 1200);
    fetch('/api/v1/audio/health', { signal: probeController.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data && data.status === 'ok' && data.modelLoaded) applyLive(''); })
      .catch(() => {})
      .finally(() => window.clearTimeout(timer));
  } else {
    const timer = window.setTimeout(() => probeController.abort(), 2500);
    fetch('/api/v1/audio/health', { signal: probeController.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data && data.status === 'ok' && data.modelLoaded) applyLive(''); })
      .catch(() => {})
      .finally(() => window.clearTimeout(timer));
  }

  const setActive = id => {
    samplesBox.querySelectorAll('[data-sample]').forEach(button => {
      const active = button.dataset.sample === id;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  };

  const CANVAS_H = 92;

  const sizeCanvas = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 520;
    canvas.width = Math.round(width * ratio);
    canvas.height = CANVAS_H * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, CANVAS_H);
    return { ctx, width };
  };

  const drawPlaceholder = () => {
    waveState = { peaks: null, tone: 'real', regions: null, durationSec: 0 };
    const { ctx, width } = sizeCanvas();
    ctx.fillStyle = 'rgba(29,35,46,.09)';
    for (let x = 0; x < width; x += 5) {
      const height = 6 + ((x * 37) % 12);
      ctx.beginPath();
      ctx.roundRect(x, (CANVAS_H - height) / 2, 3, height, 2);
      ctx.fill();
    }
    if (clockEl) clockEl.textContent = '00:00 / 00:00';
  };

  const getPlaybackProgress = () => {
    const dur = (Number.isFinite(audio.duration) && audio.duration > 0)
      ? audio.duration
      : (waveState.durationSec || 0);
    const cur = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    return {
      current: cur,
      duration: dur,
      ratio: dur > 0 ? Math.min(1, Math.max(0, cur / dur)) : 0,
    };
  };

  const renderWaveform = () => {
    if (!waveState.peaks) {
      drawPlaceholder();
      return;
    }
    const { peaks, tone, regions } = waveState;
    const { ctx, width } = sizeCanvas();
    const { current: curSec, duration: durSec, ratio: progress } = getPlaybackProgress();

    // 1. 可疑片段高亮背景带
    if (Array.isArray(regions) && durSec > 0) {
      ctx.fillStyle = 'rgba(180, 71, 47, 0.10)';
      regions.forEach(([start, end]) => {
        const x0 = Math.max(0, (start / durSec) * width);
        const x1 = Math.min(width, (end / durSec) * width);
        if (x1 > x0) {
          ctx.beginPath();
          ctx.roundRect(x0, 4, x1 - x0, CANVAS_H - 8, 6);
          ctx.fill();
        }
      });
    }

    // 2. 波形柱（已播放部分加深高亮）
    const barWidth = 3;
    const gap = 2;
    const count = Math.max(1, Math.floor(width / (barWidth + gap)));
    const max = Math.max(...peaks, 1e-6);
    const playX = progress * width;
    const baseFill = tone === 'fake' ? 'rgba(180,71,47,.42)' : 'rgba(191,122,41,.40)';
    const playedFill = tone === 'fake' ? 'rgba(180,71,47,.92)' : 'rgba(166,101,24,.92)';

    for (let index = 0; index < count; index += 1) {
      const peak = (peaks[Math.floor((index * peaks.length) / count)] || 0) / max;
      const height = Math.max(4, Math.min(1, peak) * 66);
      const x = index * (barWidth + gap);
      ctx.fillStyle = x <= playX && progress > 0 ? playedFill : baseFill;
      ctx.beginPath();
      ctx.roundRect(x, (CANVAS_H - height) / 2, barWidth, height, 2);
      ctx.fill();
    }

    // 3. 播放进度竖向游标线
    if (durSec > 0 && progress > 0) {
      const cx = Math.min(width - 2, Math.max(2, playX));
      ctx.strokeStyle = tone === 'fake' ? '#9f3620' : '#8a5a1f';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, 6);
      ctx.lineTo(cx, CANVAS_H - 6);
      ctx.stroke();

      ctx.fillStyle = tone === 'fake' ? '#9f3620' : '#8a5a1f';
      ctx.beginPath();
      ctx.arc(cx, 7, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (clockEl) {
      clockEl.textContent = `${afClock(curSec)} / ${afClock(durSec)}`;
    }
  };

  const drawWave = async (src, tone = 'real', { regions = null, durationSec = 0 } = {}) => {
    let peaks = null;
    try {
      const response = await fetch(src);
      const buffer = await response.arrayBuffer();
      const Context = window.AudioContext || window.webkitAudioContext;
      const audioContext = new Context();
      const decoded = await audioContext.decodeAudioData(buffer);
      if (!durationSec && Number.isFinite(decoded.duration)) durationSec = decoded.duration;
      const channel = decoded.getChannelData(0);
      const buckets = 220;
      const step = Math.floor(channel.length / buckets) || 1;
      peaks = [];
      for (let index = 0; index < buckets; index += 1) {
        let peak = 0;
        const start = index * step;
        for (let cursor = start; cursor < start + step && cursor < channel.length; cursor += 1) {
          const value = Math.abs(channel[cursor]);
          if (value > peak) peak = value;
        }
        peaks.push(peak);
      }
      audioContext.close?.();
    } catch {
      peaks = Array.from({ length: 220 }, (unused, index) => 0.28 + Math.abs(Math.sin(index / 7)) * 0.42);
    }
    if (disposed) return;
    waveState = { peaks, tone, regions, durationSec };
    renderWaveform();
  };

  const setPending = reason => {
    state.textContent = '待检测';
    verdict.innerHTML = `<div class="af-empty af-pending">
      <span class="af-empty-icon is-muted">${afIcon('alert')}</span>
      <strong>${afEscape(reason || '音频已就绪')}</strong>
      <p>当前环境未连接在线音频推理服务，暂无法对新上传文件执行实时分析。您可以直接在左侧试听文件，或点击上方语音样本查看完整检测报告示例。</p>
    </div>`;
  };

  const gauge = pFake => {
    const clamped = Math.min(1, Math.max(0, Number(pFake) || 0));
    const radius = 50;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - clamped);
    const pctText = `${(clamped * 100).toFixed(1)}%`;
    return `<svg class="af-gauge" viewBox="0 0 120 120" role="img" aria-label="伪造风险 ${pctText}">
      <circle class="af-gauge-track" cx="60" cy="60" r="${radius}"/>
      <circle class="af-gauge-value" cx="60" cy="60" r="${radius}" style="stroke-dasharray:${circumference.toFixed(1)};stroke-dashoffset:${offset.toFixed(1)}"/>
      <text class="af-gauge-num" x="60" y="57" text-anchor="middle">${pctText}</text>
      <text class="af-gauge-cap" x="60" y="76" text-anchor="middle">伪造风险</text>
    </svg>`;
  };

  const closeReportView = () => {
    document.body.classList.remove('af-printing');
    reportRoot.setAttribute('aria-hidden', 'true');
  };

  /** 把当前结果渲染成一页 A4 报告；preview=true 时只展示不调用打印。 */
  const exportReport = preview => {
    const r = lastResult;
    if (!r) return;
    const isFake = r.kind === 'fake';
    const windows = Array.isArray(r.windows) ? r.windows : [];
    const now = new Date();
    const pad = value => String(value).padStart(2, '0');
    const serial = `AF-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const when = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    const isVideo = r.media === 'video' || lastMeta.media === 'video';
    const hasChart = windows.length >= 2;
    const pctText = `${(Math.min(1, Math.max(0, Number(r.pFake) || 0)) * 100).toFixed(1)}%`;

    reportRoot.innerHTML = `
      <div class="af-rp-toolbar">
        <button type="button" class="af-rp-back" id="af-rp-back">← 返回检测工作台</button>
        <div class="af-rp-toolbar-actions">
          <span>报告预览（支持浏览器打印或另存为 PDF）</span>
          <button type="button" class="af-export" id="af-rp-print">打印 / 保存 PDF</button>
        </div>
      </div>

      <header class="af-rp-head">
        <div>
          <p class="af-rp-eyebrow">VERITAS 智鉴 · AI 音频伪造检测</p>
          <h1>音频真实性检测报告</h1>
        </div>
        <div class="af-rp-serial">
          <div>报告编号 <b>${serial}</b></div>
          <div>生成时间 <b>${when}</b></div>
        </div>
      </header>

      <section class="af-rp-sec">
        <h2>一、检测对象</h2>
        <table>
          <tr>
            <th>文件名称</th><td>${afEscape(r.file || lastMeta.fileName || '—')}</td>
            <th>媒体类型</th><td>${isVideo ? '视频（自动提取音轨）' : '音频'}</td>
          </tr>
          <tr>
            <th>音频规格</th><td>${afEscape(r.durationLabel || '4.00 s · 16 kHz 单声道')}</td>
            <th>材料来源</th><td>${afEscape(lastMeta.source || '样本音频')}</td>
          </tr>
        </table>
      </section>

      <section class="af-rp-sec">
        <h2>二、检测结论</h2>
        <table>
          <tr>
            <th>鉴定结论</th>
            <td colspan="3"><b class="${isFake ? 'af-rp-fake' : 'af-rp-real'}">${isFake ? '检测到 AI 伪造痕迹' : '未发现合成痕迹（真实录音）'}</b></td>
          </tr>
          <tr>
            <th>伪造风险评分</th><td>${pctText}（判定参考阈值 50.0%）</td>
            <th>识别类型</th><td>${afEscape(r.methodLabel || '—')}</td>
          </tr>
          <tr>
            <th>可疑时间区间</th><td>${afEscape(r.regionLabel || '—')}</td>
            <th>分析耗时</th><td>${afEscape(r.latency || '—')}</td>
          </tr>
          <tr>
            <th>特征分析说明</th>
            <td colspan="3">${afEscape(r.note || '—')}</td>
          </tr>
        </table>
      </section>

      ${hasChart ? `<section class="af-rp-sec">
        <h2>三、分段风险评分曲线</h2>
        ${afChart(r, { interactive: false })}
        <p class="af-rp-note">共划分 ${windows.length} 个检测窗口（窗宽 10 秒、步长 5 秒），横轴为各窗口中心时刻，纵轴为对应片段的伪造风险评分。</p>
      </section>` : ''}

      <section class="af-rp-sec">
        <h2>${hasChart ? '四' : '三'}、复核说明</h2>
        <ol class="af-rp-note">
          <li>当片段伪造风险评分高于 50% 参考阈值时标记为可疑，临近阈值的边界样本建议结合原始录音环境人工复核。</li>
          <li>长音频可疑区间由连续超阈值滑窗合并得出，时间定位精度约为单个步长（5–10 秒）。</li>
          <li>本报告结果仅对应本次送检文件版本。</li>
        </ol>
      </section>

      <footer class="af-rp-foot">VERITAS 智鉴 · 音频真实性检测报告</footer>`;

    reportRoot.setAttribute('aria-hidden', 'false');
    document.body.classList.add('af-printing');
    window.scrollTo(0, 0);
    document.querySelector('#main-content')?.scrollTo(0, 0);
    reportRoot.querySelector('#af-rp-back')?.addEventListener('click', closeReportView);
    reportRoot.querySelector('#af-rp-print')?.addEventListener('click', () => window.print());
    if (!preview) window.setTimeout(() => window.print(), 80);
  };

  const onAfterPrint = () => closeReportView();
  const onKeyDown = event => {
    if (event.key === 'Escape' && document.body.classList.contains('af-printing')) {
      closeReportView();
    }
  };
  window.addEventListener('afterprint', onAfterPrint);
  window.addEventListener('keydown', onKeyDown);

  const seekAudioTo = seconds => {
    if (!audio.src || !Number.isFinite(seconds)) return;
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (waveState.durationSec || 0);
    const clamped = dur > 0 ? Math.min(dur, Math.max(0, seconds)) : Math.max(0, seconds);
    try {
      audio.currentTime = clamped;
    } catch {}
    renderWaveform();
  };

  const renderResult = sample => {
    const isFake = sample.kind === 'fake';
    const pctText = `${(Math.min(1, Math.max(0, Number(sample.pFake) || 0)) * 100).toFixed(1)}%`;
    state.textContent = isFake ? '检出伪造风险' : '未见异常';
    verdict.innerHTML = `
      <div class="af-hero ${isFake ? 'is-fake' : 'is-real'}">
        ${gauge(sample.pFake)}
        <div class="af-hero-text">
          <span class="af-verdict-tag">${isFake ? 'AI 合成语音' : '真实录音'}</span>
          <strong>${isFake ? '检测到 AI 伪造痕迹' : '未发现合成痕迹'}</strong>
          <p>伪造风险评分 ${pctText}（参考阈值 50%）· ${sample.pFake >= 0.5 ? '高于阈值，建议重点核查' : '低于阈值，声学特征自然'}</p>
        </div>
      </div>

      <dl class="af-facts">
        <div><dt>识别类型</dt><dd class="${isFake ? 'is-warn' : 'is-ok'}">${afEscape(sample.methodLabel)}</dd></div>
        <div><dt>可疑区间</dt><dd class="${isFake ? 'is-warn' : ''}">${afEscape(sample.regionLabel)}</dd></div>
        <div><dt>分析耗时</dt><dd>${afEscape(sample.latency)}</dd></div>
        <div><dt>音频规格</dt><dd>${afEscape(sample.durationLabel || '4.00 s · 16 kHz 单声道')}</dd></div>
      </dl>

      ${afChart(sample, { interactive: true })}

      <p class="af-note">${afEscape(sample.note)}</p>

      <div class="af-actions">
        <button type="button" class="af-ghost" id="af-preview-report">预览报告</button>
        <button type="button" class="af-export" id="af-export">导出检测报告（PDF）</button>
      </div>`;

    lastResult = sample;
    verdict.querySelector('#af-preview-report')?.addEventListener('click', () => exportReport(true));
    verdict.querySelector('#af-export')?.addEventListener('click', () => exportReport(false));
    verdict.querySelectorAll('[data-seek-time]').forEach(point => {
      const triggerSeek = () => {
        const sec = Number(point.dataset.seekTime);
        if (Number.isFinite(sec)) {
          seekAudioTo(sec);
          audio.play?.().catch(() => {});
        }
      };
      point.addEventListener('click', triggerSeek);
      point.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          triggerSeek();
        }
      });
    });
  };

  const runAnalysis = sample => {
    const token = ++runId;
    analyzing = true;
    syncStartButton();
    lastMeta = { source: '样本音频', media: 'audio' };
    setActive(sample.id);
    hint.textContent = sample.meta;
    showAudioPreview(sample.src);
    drawWave(sample.src, sample.kind, {
      regions: sample.detectedRegion || null,
      durationSec: sample.durationSec || 4,
    });
    meta.textContent = `${sample.title || sample.file}（${sample.file}）· 点击波形或播放控件可试听`;
    if (submitHint) submitHint.textContent = `正在检测：${sample.title || sample.file}`;

    const steps = ['读取音频流', '重采样与声学特征提取', '逐段鉴伪评分', '生成可疑区间结论'];
    state.textContent = '分析中';
    verdict.innerHTML = `<ul class="af-steps" id="af-steps">${steps.map(step => `<li><span></span>${step}</li>`).join('')}</ul>`;

    const items = verdict.querySelectorAll('#af-steps li');
    items.forEach((item, index) => {
      window.setTimeout(() => {
        if (disposed || token !== runId) return;
        item.classList.add('is-done');
        if (index === items.length - 1) {
          window.setTimeout(() => {
            if (disposed || token !== runId) return;
            analyzing = false;
            syncStartButton();
            if (submitHint) submitHint.textContent = `已完成检测：${sample.title || sample.file}`;
            renderResult(sample);
          }, 220);
        }
      }, 180 * (index + 1));
    });
  };

  const fileToBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const renderApiResult = (payload, fileName) => {
    const d = (payload && payload.data) || payload || {};
    const isVideo = d.media === 'video';
    lastMeta = { fileName, source: '上传文件', media: d.media || 'audio' };
    const regionText = d.fakeRegion === 'all'
      ? `0.00 – ${Number(d.durationSec || 0).toFixed(2)} s（全段）`
      : Array.isArray(d.fakeRegion) && d.fakeRegion.length
        ? d.fakeRegion.map(pair => `${Number(pair[0]).toFixed(2)} – ${Number(pair[1]).toFixed(2)} s`).join('、')
        : '无可疑片段';
    const audioSeconds = Number(d.audioDurationSec || d.durationSec || 0);
    const detectedRegions = Array.isArray(d.fakeRegion) ? d.fakeRegion : (d.fakeRegion === 'all' && audioSeconds > 0 ? [[0, audioSeconds]] : null);
    renderResult({
      file: fileName,
      media: d.media || 'audio',
      kind: d.verdict === 'fake' ? 'fake' : 'real',
      pFake: Number(d.pFake || 0),
      methodLabel: d.spoofMethodLabel || '未检出伪造手法',
      regionLabel: regionText,
      latency: `${(Number(d.latencyMs || 0) / 1000).toFixed(1)} s`,
      durationLabel: isVideo
        ? `${audioSeconds.toFixed(2)} s · 视频音轨`
        : `${Number(d.durationSec || 0).toFixed(2)} s · 上传音频`,
      note: isVideo
        ? `已自动提取视频音轨（${audioSeconds.toFixed(2)} s）并完成声学鉴伪分析。`
        : `已完成上传音频声学特征与合成痕迹检测（耗时 ${((Number(d.latencyMs || 0)) / 1000).toFixed(1)} s）。`,
      windows: Array.isArray(d.windows) ? d.windows : [],
      durationSec: Number(d.durationSec || audioSeconds || 0),
      detectedRegion: detectedRegions,
    });
    hint.textContent = `${fileName} · 检测完成`;
    meta.textContent = isVideo
      ? `${fileName} · 视频音轨 ${audioSeconds.toFixed(2)} s`
      : `${fileName} · ${Number(d.durationSec || 0).toFixed(2)} s`;
    if (!isVideo && audio.src) {
      drawWave(audio.src, d.verdict === 'fake' ? 'fake' : 'real', {
        regions: detectedRegions,
        durationSec: Number(d.durationSec || audioSeconds || 0),
      });
    }
  };

  const renderApiError = (error, fileName) => {
    state.textContent = '检测未完成';
    verdict.innerHTML = `<div class="af-empty af-pending">
      <span class="af-empty-icon is-muted">${afIcon('alert')}</span>
      <strong>暂时无法完成检测</strong>
      <p>${afEscape(error.message || '音频检测服务暂时不可用，请稍后重试。')}</p>
    </div>`;
    meta.textContent = `${fileName} · 检测未完成`;
  };

  const AF_VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|flv|ts)$/i;
  const isVideoFile = file => (file.type || '').startsWith('video/') || AF_VIDEO_EXT.test(file.name || '');

  const showVideoPreview = () => {
    video.hidden = false;
    audio.hidden = true;
    canvas.hidden = true;
    root.querySelector('.af-wave-head')?.setAttribute('hidden', '');
    audio.removeAttribute('src');
    video.src = objectUrl;
  };

  const showAudioPreview = src => {
    video.hidden = true;
    video.removeAttribute('src');
    audio.hidden = false;
    canvas.hidden = false;
    root.querySelector('.af-wave-head')?.removeAttribute('hidden');
    audio.src = src;
    audio.disabled = false;
  };

  const runRemote = async (file, token, asVideo) => {
    analyzing = true;
    syncStartButton();
    if (submitHint) submitHint.textContent = `正在检测：${file.name}`;
    state.textContent = '分析中';
    const steps = asVideo
      ? ['上传视频文件', '提取音轨流', '声学特征提取', '逐段鉴伪评分', '生成检测结论']
      : ['上传音频文件', '声学特征提取', '逐段鉴伪评分', '生成检测结论'];
    verdict.innerHTML = `<ul class="af-steps" id="af-steps">${steps
      .map(step => `<li><span></span>${step}</li>`).join('')}</ul>`;
    const items = [...verdict.querySelectorAll('#af-steps li')];
    const done = index => { if (token === runId && items[index]) items[index].classList.add('is-done'); };
    done(0);
    try {
      const audioBase64 = await fileToBase64(file);
      if (disposed || token !== runId) return;
      done(1);
      const payload = await audioApi.invoke('/audio/forgery', { audioBase64, fileName: file.name });
      if (disposed || token !== runId) return;
      items.forEach((unused, index) => done(index));
      renderApiResult(payload, file.name);
      if (submitHint) submitHint.textContent = `已完成检测：${file.name}`;
    } catch (error) {
      if (disposed || token !== runId) return;
      renderApiError(error, file.name);
      if (submitHint) submitHint.textContent = `检测未完成：${file.name}`;
    } finally {
      if (!disposed && token === runId) {
        analyzing = false;
        syncStartButton();
      }
    }
  };

  const MAX_MEDIA_SECONDS = 120;

  const waitDuration = element => new Promise(resolve => {
    if (Number.isFinite(element.duration) && element.duration > 0) {
      resolve(element.duration);
      return;
    }
    const handler = () => {
      element.removeEventListener('loadedmetadata', handler);
      resolve(element.duration);
    };
    element.addEventListener('loadedmetadata', handler, { once: true });
    window.setTimeout(() => resolve(NaN), 2500);
  });

  const selectSample = sample => {
    ++runId;
    analyzing = false;
    selectedTarget = { type: 'sample', sample };
    current = { name: sample.file };
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    setActive(sample.id);
    hint.textContent = sample.meta;
    showAudioPreview(sample.src);
    drawWave(sample.src, 'real', { durationSec: sample.durationSec || 4 });
    meta.textContent = `${sample.title || sample.file}（${sample.file}）· 已就绪，可先试听或点击下方「开始检测」`;
    if (submitHint) submitHint.textContent = `已选择：${sample.title || sample.file}`;
    state.textContent = '待检测';
    verdict.innerHTML = `<div class="af-empty">
      <span class="af-empty-icon">${afIcon('spark')}</span>
      <strong>已选择「${afEscape(sample.title || sample.file)}」</strong>
      <p>可在左侧试听原音频，点击「开始检测」生成声学鉴伪结论与分段风险曲线。</p>
    </div>`;
    syncStartButton();
  };

  const loadFile = async file => {
    ++runId;
    analyzing = false;
    const asVideo = isVideoFile(file);
    setActive(null);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    current = { name: file.name };
    selectedTarget = { type: 'file', file, asVideo };
    hint.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

    if (asVideo) {
      showVideoPreview();
    } else {
      showAudioPreview(objectUrl);
      drawWave(objectUrl, 'real');
    }

    meta.textContent = `${file.name} · 已载入，点击下方「开始检测」开始分析`;
    if (submitHint) submitHint.textContent = `已载入：${file.name}`;
    state.textContent = '待检测';
    verdict.innerHTML = `<div class="af-empty">
      <span class="af-empty-icon">${afIcon('spark')}</span>
      <strong>已载入「${afEscape(file.name)}」</strong>
      <p>确认试听无误后，点击左侧「开始检测」查看该文件的音频鉴伪分析结果。</p>
    </div>`;
    syncStartButton();
  };

  const startSelectedDetection = async () => {
    if (analyzing || !selectedTarget) return;
    if (selectedTarget.type === 'sample') {
      try {
        const allowed = await consumeClientDetectionCredit('audio-forgery', selectedTarget.sample.title || selectedTarget.sample.file);
        if (!allowed) return;
      } catch (error) {
        renderApiError(error, selectedTarget.sample.file);
        return;
      }
      runAnalysis(selectedTarget.sample);
      return;
    }
    const { file, asVideo } = selectedTarget;
    const token = ++runId;
    if (liveEnabled && file.size > 80 * 1024 * 1024) {
      renderApiError({ code: 'AUDIO_TOO_LARGE', message: '文件超过 80 MB 上限，请裁剪后再试。' }, file.name);
      return;
    }
    if (liveEnabled) {
      try {
        if (!ensureDetectionAllowed(1)) return;
      } catch (error) {
        renderApiError(error, file.name);
        return;
      }
      analyzing = true;
      syncStartButton();
      meta.textContent = `${file.name} · ${asVideo ? '正在提取视频音轨并提交检测…' : '正在提交在线检测…'}`;
      const duration = await waitDuration(asVideo ? video : audio);
      if (disposed || token !== runId) return;
      if (Number.isFinite(duration) && duration > MAX_MEDIA_SECONDS) {
        analyzing = false;
        syncStartButton();
        renderApiError({
          code: 'MEDIA_TOO_LONG',
          message: `媒体时长 ${duration.toFixed(0)} 秒，超过 2 分钟上限，请裁剪后再试。`,
        }, file.name);
        return;
      }
      await runRemote(file, token, asVideo);
      return;
    }
    meta.textContent = `${file.name} · 本地试听已就绪`;
    if (submitHint) submitHint.textContent = `离线模式：${file.name}`;
    setPending(`已载入 ${file.name}${asVideo ? '（视频文件）' : ''}`);
  };

  samplesBox.addEventListener('click', event => {
    const button = event.target.closest('[data-sample]');
    if (!button) return;
    const sample = AF_SAMPLES.find(item => item.id === button.dataset.sample);
    if (!sample) return;
    selectSample(sample);
  });

  startBtn?.addEventListener('click', () => {
    void startSelectedDetection();
  });

  drop.addEventListener('click', () => fileInput.click());
  drop.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', event => {
    const [file] = event.target.files || [];
    if (file) loadFile(file);
    fileInput.value = '';
  });
  ['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => {
    event.preventDefault();
    drop.classList.add('is-over');
  }));
  ['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => {
    event.preventDefault();
    drop.classList.remove('is-over');
  }));
  drop.addEventListener('drop', event => {
    const [file] = event.dataTransfer?.files || [];
    if (file) loadFile(file);
  });

  canvas.addEventListener('click', event => {
    if (!audio.src) return;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width));
    const dur = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (waveState.durationSec || 0);
    if (dur > 0) seekAudioTo(ratio * dur);
  });

  ['timeupdate', 'seeking', 'seeked', 'loadedmetadata', 'ended'].forEach(eventName => {
    audio.addEventListener(eventName, () => {
      if (!disposed && waveState.peaks) renderWaveform();
    });
  });

  const onResize = () => {
    if (disposed) return;
    if (!audio.src || !waveState.peaks) {
      drawPlaceholder();
      return;
    }
    renderWaveform();
  };
  window.addEventListener('resize', onResize);

  drawPlaceholder();
  audio.disabled = true;

  // 演示直达：?demo=wav1#/audio/forgery 或 ?demo=pending
  const presetRaw = new URLSearchParams(window.location.search).get('demo');
  const preset = AF_DEMO_ALIAS[presetRaw] || presetRaw;
  const presetSample = AF_SAMPLES.find(item => item.id === preset);
  if (presetSample) {
    selectedTarget = { type: 'sample', sample: presetSample };
    window.setTimeout(() => { if (!disposed) runAnalysis(presetSample); }, 140);
  } else if (preset === 'pending') {
    window.setTimeout(() => { if (!disposed) setPending('已载入 sample_interview.wav'); }, 140);
  }

  if (new URLSearchParams(window.location.search).get('report') === '1' && presetSample) {
    window.setTimeout(() => { if (!disposed) exportReport(true); }, 1500);
  }

  const observer = new MutationObserver(() => {
    if (!container.isConnected) dispose();
  });
  if (container.ownerDocument?.body) {
    observer.observe(container.ownerDocument.body, { childList: true, subtree: true });
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    observer.disconnect();
    runId += 1;
    probeController.abort();
    closeReportView();
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    window.removeEventListener('afterprint', onAfterPrint);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('resize', onResize);
  }

  return dispose;
}

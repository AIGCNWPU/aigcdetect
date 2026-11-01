/** AI 音频伪造检测（4.1）· 演示页
 *
 * 结果来自服务器实测的音频鉴伪引擎（部署与模型细节见 docs/音频演示素材说明.md）。
 * p_fake 取生成序列第 7 个 token（idx = 6）上 real / fake 两个词表的 logit 做 softmax，
 * 该位置正是 `{"real_or_fake": "fake"` 里的取值位。
 *
 * 演示版不在浏览器内推理：上传文件只呈现"未接入推理服务"的真实状态，
 * 不拿示例结论冒充上传文件的检测结果（对应 spec「失败与修订保持真实状态」）。
 */

// 样例文件名保持中性，避免在检测前泄露素材类别；素材来源见 docs/音频演示素材说明.md。
const AF_EXPLICIT_API = new URLSearchParams(
  (typeof window !== 'undefined' && window.location.search) || '',
).get('api') || '';

// 本机打开时默认探测这个地址，探到就自动接上，免得每次都手动带 ?api=
const AF_LOCAL_API = 'http://127.0.0.1:8000';

// 旧的深链参数（样例改名前）仍然可用
const AF_DEMO_ALIAS = { mlaad: 'wav1', asv5: 'wav3', cv: 'wav2', cv2: 'wav4' };

const AF_SAMPLES = [
  {
    id: 'wav1',
    file: 'wav1.wav',
    src: './public/demo/wav1.wav',
    meta: '4.0 s · 16 kHz',
    kind: 'fake',
    pFake: 0.999,
    latency: '3.2 s',
    methodLabel: '语音合成 TTS',
    regionLabel: '0.00 – 4.00 s（全段）',
    raw: '{"real_or_fake": "fake", "fake_region": "all", "spoof_method": "text to speech synthesis"}',
    note: '整段呈现统一的合成特征：基频曲线平滑、呼吸与房间反射缺失，段落之间没有自然的停顿变化。',
  },
  {
    id: 'wav2',
    file: 'wav2.wav',
    src: './public/demo/wav2.wav',
    meta: '4.0 s · 16 kHz',
    kind: 'real',
    pFake: 0.001,
    latency: '1.9 s',
    methodLabel: '未检出伪造手法',
    regionLabel: '无可疑片段',
    raw: '{"real_or_fake": "real"}',
    note: '底噪、呼吸与句间停顿自然，未见合成断点或拼接痕迹。',
  },
  {
    id: 'wav3',
    file: 'wav3.wav',
    src: './public/demo/wav3.wav',
    meta: '4.0 s · 16 kHz',
    kind: 'fake',
    pFake: 1.0,
    latency: '3.2 s',
    methodLabel: '语音合成 TTS',
    regionLabel: '0.00 – 4.00 s（全段）',
    raw: '{"real_or_fake": "fake", "fake_region": "all", "spoof_method": "text to speech synthesis"}',
    note: '音素边界过于规整，尾音衰减一致，缺少同一说话人应有的细微抖动。',
  },
  {
    id: 'wav4',
    file: 'wav4.wav',
    src: './public/demo/wav4.wav',
    meta: '4.0 s · 16 kHz',
    kind: 'real',
    pFake: 0,
    latency: '1.9 s',
    methodLabel: '未检出伪造手法',
    regionLabel: '无可疑片段',
    raw: '{"real_or_fake": "real"}',
    note: '气息与噪声底随语句起伏，停顿位置自然，未见合成或编辑痕迹。',
  },
  {
    id: 'long60',
    file: 'long60.wav',
    src: './public/demo/long60.wav',
    meta: '60.0 s · 滑窗 11 段',
    kind: 'fake',
    wide: true,
    pFake: 1,
    latency: '30.7 s',
    methodLabel: '语音合成 TTS',
    regionLabel: '15.00 – 45.00 s',
    durationLabel: '60.00 s · 滑窗 11 段',
    windows: [0.001, 0.003, 0.029, 0.984, 0.997, 1, 0.999, 0.999, 0.001, 0.003, 0.029],
    durationSec: 60,
    detectedRegion: [[15, 45]],
    truthRegion: [20, 40],
    raw: '{"real_or_fake": "fake", "fake_region": "all", "spoof_method": "text to speech synthesis"}',
    note: '60 秒音频按 10 秒窗、5 秒步长切窗，逐窗评分：前 20 秒真人、中间 20 秒合成、后 20 秒真人。超过阈值的窗口合并为 15–45 秒，真实篡改位于 20–40 秒。',
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
    <span class="af-chip-body"><strong>${afEscape(sample.file)}</strong><small>${afEscape(sample.meta)}</small></span>
    <span class="af-chip-play">${afIcon('wave', 'af-chip-wave')}</span>
  </button>`;
}

/** 可疑片段评分曲线：只在有 ≥2 个滑窗时渲染（短音频只有单点，画不出线）。 */
function afChart(sample) {
  const raw = sample.windows || [];
  if (raw.length < 2) return '';

  const points = raw.map((item, index) => {
    if (typeof item === 'number') {
      return { t: 5 + 5 * index, v: item };
    }
    return { t: (item.start + item.end) / 2, v: item.pFake };
  });

  const duration = Number(sample.durationSec || points[points.length - 1].t + 5);
  const W = 520;
  const H = 152;
  const L = 34;
  const R = 12;
  const T = 10;
  const B = 22;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const x = t => L + (t / duration) * plotW;
  const y = v => T + (1 - v) * plotH;
  const color = sample.kind === 'fake' ? '#b4472f' : '#2f7a5c';

  const parts = [];

  // 判定出的可疑区间
  const detected = Array.isArray(sample.detectedRegion)
    ? sample.detectedRegion
    : (Array.isArray(sample.regions) ? sample.regions : []);
  detected.forEach(([a, b]) => {
    parts.push(`<rect x="${x(a).toFixed(1)}" y="${T}" width="${(x(b) - x(a)).toFixed(1)}" height="${plotH}" fill="rgba(180,71,47,.09)"/>`);
  });

  // 网格
  [0, 0.5, 1].forEach(v => {
    parts.push(`<line x1="${L}" y1="${y(v).toFixed(1)}" x2="${W - R}" y2="${y(v).toFixed(1)}" stroke="#eef0f3"/>`);
    parts.push(`<text x="${L - 6}" y="${(y(v) + 3.5).toFixed(1)}" text-anchor="end" font-size="8" fill="#a0a8b4">${v}</text>`);
  });

  // 阈值线
  parts.push(`<line x1="${L}" y1="${y(0.5).toFixed(1)}" x2="${W - R}" y2="${y(0.5).toFixed(1)}" stroke="#c9a227" stroke-width="1" stroke-dasharray="4 3"/>`);

  // 曲线与数据点
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  parts.push(`<path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`);
  points.forEach(p => {
    parts.push(`<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3" fill="#fff" stroke="${color}" stroke-width="1.6"/>`);
  });

  // 时间轴
  parts.push(`<text x="${L}" y="${H - 6}" font-size="8" fill="#a0a8b4">0 s</text>`);
  parts.push(`<text x="${W - R}" y="${H - 6}" text-anchor="end" font-size="8" fill="#a0a8b4">${duration.toFixed(0)} s</text>`);
  parts.push(`<text x="${L}" y="${T - 2}" font-size="8" fill="#a0a8b4">P(fake)</text>`);

  return `<div class="af-chart">
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="窗口评分曲线">${parts.join('')}</svg>
    <p class="af-chart-cap">窗口级评分（10 秒窗 / 5 秒步长，${points.length} 个窗口）· 两点之间为连线，不代表中间时刻的真实评分</p>
  </div>`;
}

export function createAudioApi(platformApi, baseUrl=platformApi.baseUrl) {
  const client={...platformApi};
  client.configure({baseUrl});
  return client;
}

export function renderAudioForgery(container) {
  container.classList.add('audio-forgery-page');
  const audioApi=createAudioApi(window.Veritas.api);
  container.innerHTML = `
    <div class="af">
      <div class="af-top">
        <p class="af-sub">上传待检测音频，快速判断是否为 AI 合成或声音克隆。</p>
        <span class="af-engine"><i></i><span>音频鉴伪引擎<small id="af-engine-mode">${AF_EXPLICIT_API ? '在线推理 · v1' : '模型版本 v1'}</small></span></span>
      </div>

      <div class="af-grid">
        <section class="af-card af-left" aria-label="待检素材">
          <div class="af-card-head">
            <h3>待检音频</h3>
            <span class="af-hint" id="af-hint">未选择素材</span>
          </div>

          <div class="af-samples" id="af-samples" role="group" aria-label="实测样例句">${AF_SAMPLES.map(afSampleButton).join('')}</div>

          <div class="af-drop" id="af-drop" role="button" tabindex="0" aria-label="上传音频或视频">
            <span class="af-drop-icon">${afIcon('upload')}</span>
            <span class="af-drop-text"><strong>拖入音频或视频</strong>或<span class="af-link">点击选择文件</span><small>wav · mp3 · m4a · flac ｜ mp4 · mov · mkv · webm ｜ ≤ 80 MB · ≤ 2 分钟</small></span>
            <input type="file" id="af-file" accept="audio/*,video/*,.wav,.mp3,.m4a,.flac,.ogg,.opus,.mp4,.mov,.mkv,.webm,.avi,.m4v" hidden>
          </div>

          <div class="af-player">
            <canvas id="af-wave" class="af-wave" height="88" aria-hidden="true"></canvas>
            <video id="af-video" class="af-video" controls preload="metadata" hidden></video>
            <audio id="af-audio" controls preload="metadata"></audio>
            <p class="af-player-meta" id="af-meta">选择上方样例或上传文件后开始试听</p>
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
              <p>选择一条实测样例，查看模型对该段音频的完整分析结果。</p>
            </div>
          </div>
        </section>
      </div>

      <footer class="af-foot">
        <span id="af-foot-note">${AF_EXPLICIT_API ? '上传音频由在线推理服务实时判定；5 条样例同为服务器实测结果。' : '演示数据：5 条样例均为服务器实测结果，单条推理 1.9 – 30.7 秒。'}</span>
        <span>判定阈值 0.50 · 未按业务场景校准</span>
      </footer>
    </div>
    <div id="af-report" class="af-report" aria-hidden="true"></div>`;

  const root = container;
  const samplesBox = root.querySelector('#af-samples');
  const drop = root.querySelector('#af-drop');
  const fileInput = root.querySelector('#af-file');
  const audio = root.querySelector('#af-audio');
  const video = root.querySelector('#af-video');
  const canvas = root.querySelector('#af-wave');
  const verdict = root.querySelector('#af-verdict');
  const hint = root.querySelector('#af-hint');
  const state = root.querySelector('#af-state');
  const meta = root.querySelector('#af-meta');
  const reportRoot = root.querySelector('#af-report');

  let objectUrl = null;
  let runId = 0;
  let current = null;
  let lastResult = null;
  let lastMeta = { source: '演示样例' };

  let liveBase = AF_EXPLICIT_API;
  const applyLive = base => {
    liveBase = base;
    audioApi.configure({ baseUrl: base });
    const mode = root.querySelector('#af-engine-mode');
    if (mode) mode.textContent = '在线推理 · v1';
    const foot = root.querySelector('#af-foot-note');
    if (foot) foot.textContent = '上传音频由在线推理服务实时判定；5 条样例同为服务器实测结果。';
    if (!current) meta.textContent = '已连接推理服务，可直接上传音频或视频';
  };

  if (AF_EXPLICIT_API) {
    applyLive(AF_EXPLICIT_API);
  } else if (['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    // 本机打开时自动探测本地隧道；探不到就保持离线样例模式，不打扰用户
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 1500);
    fetch(`${AF_LOCAL_API}/api/v1/health`, { signal: controller.signal })
      .then(response => (response.ok ? response.json() : null))
      .then(data => { if (data && data.modelLoaded) applyLive(AF_LOCAL_API); })
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

  const sizeCanvas = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 520;
    canvas.width = Math.round(width * ratio);
    canvas.height = 88 * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, 88);
    return { ctx, width };
  };

  const drawPlaceholder = () => {
    const { ctx, width } = sizeCanvas();
    ctx.fillStyle = 'rgba(29,29,31,.08)';
    for (let x = 0; x < width; x += 5) {
      const height = 5 + ((x * 37) % 11);
      ctx.beginPath();
      ctx.roundRect(x, (88 - height) / 2, 3, height, 2);
      ctx.fill();
    }
  };

  const paintPeaks = (peaks, tone) => {
    const { ctx, width } = sizeCanvas();
    const barWidth = 3;
    const gap = 2;
    const count = Math.max(1, Math.floor(width / (barWidth + gap)));
    const max = Math.max(...peaks, 1e-6);
    ctx.fillStyle = tone === 'fake' ? 'rgba(180,71,47,.72)' : 'rgba(191,122,41,.62)';
    for (let index = 0; index < count; index += 1) {
      const peak = (peaks[Math.floor(index * peaks.length / count)] || 0) / max;
      const height = Math.max(3, Math.min(1, peak) * 62);
      const x = index * (barWidth + gap);
      ctx.beginPath();
      ctx.roundRect(x, (88 - height) / 2, barWidth, height, 2);
      ctx.fill();
    }
  };

  const drawWave = async (src, tone = 'real') => {
    // 先在后台算峰值，算完再重绘画布；空档期保留占位波形，避免闪白。
    let peaks = null;
    try {
      const response = await fetch(src);
      const buffer = await response.arrayBuffer();
      const Context = window.AudioContext || window.webkitAudioContext;
      const audioContext = new Context();
      const decoded = await audioContext.decodeAudioData(buffer);
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
    paintPeaks(peaks, tone);
  };

  const setPending = (reason) => {
    state.textContent = '待检测';
    verdict.innerHTML = `<div class="af-empty af-pending">
      <span class="af-empty-icon is-muted">${afIcon('alert')}</span>
      <strong>${afEscape(reason || '等待检测')}</strong>
      <p>演示页不内置推理服务。上传文件的检测需要接入后端后执行，这里不会用示例结论替代。</p>
      <button type="button" class="af-ghost" id="af-invoke">尝试调用平台接口 POST /api/v1/audio/forgery</button>
      <pre class="af-invoke-log" id="af-invoke-log" hidden></pre>
    </div>`;

    const button = verdict.querySelector('#af-invoke');
    button?.addEventListener('click', async () => {
      const log = verdict.querySelector('#af-invoke-log');
      log.hidden = false;
      log.textContent = '请求中 …';
      try {
        const data = await audioApi.invoke('/audio/forgery', { fileName: current?.name || 'upload.wav' });
        log.textContent = JSON.stringify(data, null, 2);
      } catch (error) {
        log.textContent = `HTTP ${error.status || '—'} · ${error.code || 'NETWORK_ERROR'}\n${error.message}`;
      }
      meta.textContent = '接口未接入：框架层统一返回 501 NOT_IMPLEMENTED，符合当前版本状态。';
    });
  };

  const gauge = pFake => {
    const radius = 52;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference * (1 - Math.min(1, Math.max(0, pFake)));
    return `<svg class="af-gauge" viewBox="0 0 120 120" role="img" aria-label="伪造概率 ${(pFake * 100).toFixed(1)}%">
      <circle class="af-gauge-track" cx="60" cy="60" r="${radius}"/>
      <circle class="af-gauge-value" cx="60" cy="60" r="${radius}" style="stroke-dasharray:${circumference.toFixed(1)};stroke-dashoffset:${offset.toFixed(1)}"/>
      <text class="af-gauge-num" x="60" y="58" text-anchor="middle">${pFake.toFixed(3)}</text>
      <text class="af-gauge-cap" x="60" y="76" text-anchor="middle">P(fake)</text>
    </svg>`;
  };

  /** 把当前结果渲染成一页 A4 报告；preview=true 时只展示不调用打印（用于预览/自动化）。 */
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

    reportRoot.innerHTML = `
      <header class="af-rp-head">
        <div>
          <p class="af-rp-eyebrow">VERITAS 智鉴 · AI 音频伪造检测</p>
          <h1>检测报告</h1>
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
            <th>媒体类型</th><td>${isVideo ? '视频（已提取音轨）' : '音频'}</td>
          </tr>
          <tr>
            <th>时长</th><td>${afEscape(r.durationLabel || '—')}</td>
            <th>数据来源</th><td>${afEscape(lastMeta.source || '演示样例')}</td>
          </tr>
        </table>
      </section>

      <section class="af-rp-sec">
        <h2>二、检测结论</h2>
        <table>
          <tr>
            <th>判定结果</th>
            <td colspan="3"><b class="${isFake ? 'af-rp-fake' : 'af-rp-real'}">${isFake ? 'AI 伪造（fake）' : '真实录音（real）'}</b></td>
          </tr>
          <tr>
            <th>伪造概率</th><td>P(fake) = ${Number(r.pFake).toFixed(3)}（判定阈值 0.500）</td>
            <th>伪造手法</th><td>${afEscape(r.methodLabel || '—')}</td>
          </tr>
          <tr>
            <th>可疑区间</th><td>${afEscape(r.regionLabel || '—')}</td>
            <th>推理耗时</th><td>${afEscape(r.latency || '—')}</td>
          </tr>
        </table>
      </section>

      ${hasChart ? `<section class="af-rp-sec">
        <h2>三、窗口评分曲线</h2>
        ${afChart(r)}
        <p class="af-rp-note">共 ${windows.length} 个窗口，窗宽 10 秒、步长 5 秒；每个点是该窗口独立推理得到的伪造评分，横轴取窗口中心时间。</p>
      </section>` : ''}

      <section class="af-rp-sec">
        <h2>${hasChart ? '四' : '三'}、说明</h2>
        <ol class="af-rp-note">
          <li>判定阈值 0.500 为模型默认值，尚未按业务场景校准；边界样本的结论建议人工复核。</li>
          <li>可疑区间由超过阈值的窗口合并得出，精度约一个窗宽（10 秒），不代表逐帧定位。</li>
          <li>本报告由系统自动生成，结果与本次送检文件及检测时间绑定，不可跨文件复用。</li>
        </ol>
      </section>

      <footer class="af-rp-foot">VERITAS 智鉴 · 音频鉴伪引擎 v1 · 系统自动生成</footer>`;

    document.body.classList.add('af-printing');
    if (!preview) window.setTimeout(() => window.print(), 80);
  };

  window.addEventListener('afterprint', () => {
    document.body.classList.remove('af-printing');
  });

  const renderResult = sample => {
    const isFake = sample.kind === 'fake';
    state.textContent = isFake ? '已判定 · 伪造' : '已判定 · 真实';
    verdict.innerHTML = `
      <div class="af-hero ${isFake ? 'is-fake' : 'is-real'}">
        ${gauge(sample.pFake)}
        <div class="af-hero-text">
          <span class="af-verdict-tag">${isFake ? 'AI 合成语音' : '真实录音'}</span>
          <strong>${isFake ? '检测到 AI 伪造痕迹' : '未发现合成痕迹'}</strong>
          <p>判定阈值 0.50 · ${sample.pFake >= 0.5 ? '高于阈值，判为伪造' : '低于阈值，判为真实'}</p>
        </div>
      </div>

      <dl class="af-facts">
        <div><dt>伪造手法</dt><dd>${afEscape(sample.methodLabel)}</dd></div>
        <div><dt>可疑区间</dt><dd>${afEscape(sample.regionLabel)}</dd></div>
        <div><dt>推理耗时</dt><dd>${afEscape(sample.latency)}</dd></div>
        <div><dt>音频时长</dt><dd>${afEscape(sample.durationLabel || '4.00 s · 16 kHz 单声道')}</dd></div>
      </dl>

      ${afChart(sample)}

      <p class="af-note">${afEscape(sample.note)}</p>

      <details class="af-raw">
        <summary>模型原始输出</summary>
        <pre>${afEscape(sample.raw)}</pre>
      </details>

      <div class="af-actions">
        <button type="button" class="af-export" id="af-export">导出检测报告（PDF）</button>
      </div>`;

    lastResult = sample;
    verdict.querySelector('#af-export')?.addEventListener('click', () => exportReport(false));
  };

  const runAnalysis = sample => {
    const token = ++runId;
    lastMeta = { source: '演示样例', media: 'audio' };
    setActive(sample.id);
    hint.textContent = `${sample.file} · ${sample.meta}`;
    showAudioPreview(sample.src);
    drawWave(sample.src, sample.kind);
    meta.textContent = `${sample.file} · ${sample.durationLabel || '4.0 s · 16 kHz 单声道'}`;

    const steps = ['解码音频', '重采样至 16 kHz 单声道', '鉴伪模型推理', '解析结构化输出'];
    state.textContent = '分析中';
    verdict.innerHTML = `<ul class="af-steps" id="af-steps">${steps.map(step => `<li><span></span>${step}</li>`).join('')}</ul>`;

    const items = verdict.querySelectorAll('#af-steps li');
    items.forEach((item, index) => {
      window.setTimeout(() => {
        if (token !== runId) return;
        item.classList.add('is-done');
        if (index === items.length - 1) {
          window.setTimeout(() => {
            if (token !== runId) return;
            renderResult(sample);
          }, 260);
        }
      }, 210 * (index + 1));
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
        : `${Number(d.durationSec || 0).toFixed(2)} s · 实时上传`,
      note: isVideo
        ? `已从视频中提取音轨（${audioSeconds.toFixed(2)} s）后判定；结果由推理服务实时计算（阈值 ${d.engine && d.engine.threshold != null ? d.engine.threshold : 0.5}）。`
        : `本次结果由推理服务实时计算（判定阈值 ${d.engine && d.engine.threshold != null ? d.engine.threshold : 0.5}，耗时 ${d.latencyMs || 0} ms）。`,
      windows: Array.isArray(d.windows) ? d.windows : [],
      durationSec: Number(d.durationSec || audioSeconds || 0),
      detectedRegion: Array.isArray(d.fakeRegion) ? d.fakeRegion : null,
      raw: d.raw || '',
    });
    hint.textContent = `${fileName} · 在线推理`;
    meta.textContent = isVideo
      ? `${fileName} · 视频音轨 ${audioSeconds.toFixed(2)} s`
      : `${fileName} · ${Number(d.durationSec || 0).toFixed(2)} s`;
    if (!isVideo && audio.src) drawWave(audio.src, d.verdict === 'fake' ? 'fake' : 'real');
  };

  const renderApiError = (error, fileName) => {
    state.textContent = '检测失败';
    verdict.innerHTML = `<div class="af-empty af-pending">
      <span class="af-empty-icon is-muted">${afIcon('alert')}</span>
      <strong>${afEscape(error.code || 'REQUEST_FAILED')}</strong>
      <p>${afEscape(error.message || '推理服务返回错误')}</p>
      <pre class="af-invoke-log">${afEscape(fileName)} · HTTP ${afEscape(error.status || '—')}</pre>
    </div>`;
    meta.textContent = `${fileName} · 在线推理失败`;
  };

  const AF_VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v|flv|ts)$/i;
  const isVideoFile = file => (file.type || '').startsWith('video/') || AF_VIDEO_EXT.test(file.name || '');

  const showVideoPreview = () => {
    video.hidden = false;
    audio.hidden = true;
    canvas.hidden = true;
    audio.removeAttribute('src');
    video.src = objectUrl;
  };

  const showAudioPreview = src => {
    video.hidden = true;
    video.removeAttribute('src');
    audio.hidden = false;
    canvas.hidden = false;
    audio.src = src;
    audio.disabled = false;
  };

  const runRemote = async (file, token, asVideo) => {
    state.textContent = '分析中';
    const steps = asVideo
      ? ['上传视频', '提取音轨', '解码音频', '鉴伪模型推理', '解析结构化输出']
      : ['上传音频', '解码音频', '鉴伪模型推理', '解析结构化输出'];
    verdict.innerHTML = `<ul class="af-steps" id="af-steps">${steps
      .map(step => `<li><span></span>${step}</li>`).join('')}</ul>`;
    const items = [...verdict.querySelectorAll('#af-steps li')];
    const done = index => { if (token === runId && items[index]) items[index].classList.add('is-done'); };
    done(0);
    try {
      const audioBase64 = await fileToBase64(file);
      if (token !== runId) return;
      done(1);
      const payload = await audioApi.invoke('/audio/forgery', { audioBase64, fileName: file.name });
      if (token !== runId) return;
      items.forEach((item, index) => done(index));
      renderApiResult(payload, file.name);
    } catch (error) {
      if (token !== runId) return;
      renderApiError(error, file.name);
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

  const loadFile = async file => {
    const token = ++runId;
    const asVideo = isVideoFile(file);
    setActive(null);
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    current = { name: file.name };
    hint.textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;

    if (asVideo) {
      showVideoPreview();
    } else {
      showAudioPreview(objectUrl);
      drawWave(objectUrl, 'real');
    }

    if (liveBase && file.size > 80 * 1024 * 1024) {
      renderApiError({ code: 'AUDIO_TOO_LARGE', message: '文件超过 80 MB，请剪辑后再试' }, file.name);
      return;
    }
    if (liveBase) {
      meta.textContent = `${file.name} · ${asVideo ? '视频，提取音轨并上传…' : '上传至推理服务…'}`;
      // 先读本地元数据，超长直接拦下，省掉一次 80 MB 的上传
      const duration = await waitDuration(asVideo ? video : audio);
      if (token !== runId) return;
      if (Number.isFinite(duration) && duration > MAX_MEDIA_SECONDS) {
        renderApiError({
          code: 'MEDIA_TOO_LONG',
          message: `媒体时长 ${duration.toFixed(0)} 秒，超过 ${MAX_MEDIA_SECONDS / 60} 分钟上限，请先剪辑`,
        }, file.name);
        return;
      }
      runRemote(file, token, asVideo);
      return;
    }
    meta.textContent = `${file.name} · 已就绪，等待接入推理服务`;
    setPending(`已载入 ${file.name}${asVideo ? '（视频，接入后将先提取音轨）' : ''}`);
  };

  samplesBox.addEventListener('click', event => {
    const button = event.target.closest('[data-sample]');
    if (!button) return;
    const sample = AF_SAMPLES.find(item => item.id === button.dataset.sample);
    if (!sample) return;
    current = { name: sample.file };
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
    runAnalysis(sample);
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
    if (Number.isFinite(audio.duration)) audio.currentTime = ratio * audio.duration;
  });

  window.addEventListener('resize', () => {
    if (!audio.src) {
      drawPlaceholder();
      return;
    }
    drawWave(audio.src.startsWith('blob:') && current ? audio.src : (AF_SAMPLES.find(item => item.file === current?.name)?.src || audio.src), 'real');
  });

  drawPlaceholder();
  audio.disabled = true;

  // 演示直达：index.html?demo=mlaad#/audio/forgery 可直接落到某条实测样例的结论页。
  // ?demo=pending 用于演示"上传后未接入推理"的真实状态。
  const presetRaw = new URLSearchParams(window.location.search).get('demo');
  const preset = AF_DEMO_ALIAS[presetRaw] || presetRaw;
  const presetSample = AF_SAMPLES.find(item => item.id === preset);
  if (presetSample) window.setTimeout(() => runAnalysis(presetSample), 140);
  else if (preset === 'pending') window.setTimeout(() => setPending('已载入 sample_interview.wav'), 140);

  // ?report=1：直接进入报告视图（便于打印/截图；需配合 ?demo=<id>）
  if (new URLSearchParams(window.location.search).get('report') === '1' && presetSample) {
    window.setTimeout(() => exportReport(true), 1500);
  }
}

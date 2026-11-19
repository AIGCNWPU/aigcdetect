/** 对话分人伪造检测 · 结果视图（4.1 音频伪造检测页内嵌）
 *
 * 单入口设计：AI 音频伪造检测上传任意音频，后端先做说话人分离；
 * 识别到 2 位及以上说话人时，页面自动切换到"分人"视图（这里渲染的部分），
 * 否则走单轨结果。本文件只负责"分人结果"的展示，不含页面骨架与路由。
 */
import { DIALOGUE_CASES } from './dialogue-cases.js';

export { DIALOGUE_CASES };

const AD_SAMPLE_NOTES = {
  '843_original': {
    title: '真实对话基线',
    note: '未经篡改的原始对话。系统判定两位说话人都是真人，与人工标注一致。',
  },
  '843_modified': {
    title: '单方语音替换',
    note: '同一段对话的篡改版：其中一位的一句话被换成 AI 合成语音。系统准确指出被替换的那位说话人，与人工标注一致。',
  },
};

const AD_VERDICT_TEXT = {
  A_fake: { label: 'A 的声音是伪造的', tone: 'fake' },
  B_fake: { label: 'B 的声音是伪造的', tone: 'fake' },
  both_fake: { label: '两人都是伪造的', tone: 'fake' },
  both_real: { label: '两人都是真人', tone: 'real' },
};

export { AD_VERDICT_TEXT };

/** 四类结论的人话版本（不暴露 0/1 编号）。 */
const AD_CATEGORY_TEXT = {
  both_real: '两人均为真人',
  A_fake: '其中一方被伪造',
  B_fake: '其中一方被伪造',
  both_fake: '两人均被伪造',
};

const AD_REASON_TEXT = {
  detector_false_positive: '真人被误报',
  detector_miss: '伪造被漏报',
  diarization_misattributed: '分离分错人',
  no_prediction: '没有预测',
  other: '其他',
};

const adEscape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const adFixed = (value, digits = 1) => (Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—');

/** 单个说话人的判定卡。 */
function adSpeakerCard(speaker) {
  const over = Boolean(speaker.isFake);
  return `<article class="ad-speaker ${over ? 'is-fake' : 'is-real'}">
    <header>
      <span class="ad-tag ad-tag-${speaker.id === 'A' ? 'a' : 'b'}">${adEscape(speaker.id)}</span>
      <span class="ad-label">${adEscape(speaker.label || '')}</span>
      <span class="ad-state">${over ? '判定：伪造' : '判定：真人'}</span>
    </header>
    <p class="ad-speaker-line">${over ? '这个人的声音中检出 AI 合成痕迹' : '这个人的声音中未检出 AI 合成痕迹'}</p>
    <p class="ad-speaker-meta">${(speaker.segments || []).length} 段发言 · 本人语音 ${adFixed(speaker.speech)} 秒</p>
  </article>`;
}

/** 单行连续色带：颜色只表示"这段时间是谁在说话"，交接处的短暂停并入相邻一方。 */
function adTimeline(sample) {
  const width = 1000;
  const padLeft = 8;
  const padRight = 8;
  const barTop = 34;
  const barHeight = 44;
  const height = barTop + barHeight + 28;
  const duration = Math.max(0.1, Number(sample.duration) || 0.1);
  const plotWidth = width - padLeft - padRight;
  const x = t => Math.max(padLeft, Math.min(width - padRight, padLeft + (Number(t) / duration) * plotWidth));
  const segmentsOf = id => (sample.speakers.find(item => item.id === id) || {}).segments || [];

  const turns = [];
  ['A', 'B'].forEach(id => segmentsOf(id).forEach(([start, end]) => turns.push({ id, start, end })));
  turns.sort((a, b) => a.start - b.start);

  const parts = [];
  parts.push(`<defs><clipPath id="ad-bar-clip"><rect x="${padLeft}" y="${barTop}" width="${plotWidth}" height="${barHeight}" rx="6" /></clipPath></defs>`);
  parts.push(`<g clip-path="url(#ad-bar-clip)">`);
  turns.forEach((turn, index) => {
    const start = index === 0 ? 0 : turn.start;
    const end = index === turns.length - 1 ? duration : turns[index + 1].start;
    parts.push(`<rect class="ad-tl-seg ad-tl-seg-${turn.id.toLowerCase()}" x="${x(start).toFixed(1)}" y="${barTop}" width="${Math.max(1.5, x(end) - x(start)).toFixed(1)}" height="${barHeight}" />`);
  });
  parts.push(`</g>`);

  (sample.gtRegions || []).forEach(([start, end]) => {
    const left = x(start);
    const w = Math.max(2, x(end) - left);
    parts.push(`<rect class="ad-tl-truth" x="${left.toFixed(1)}" y="${barTop - 4}" width="${w.toFixed(1)}" height="${barHeight + 8}" rx="4" />`);
    parts.push(`<text class="ad-tl-truth-text" x="${(left + w / 2).toFixed(1)}" y="${barTop - 10}" text-anchor="middle">被篡改的一句</text>`);
  });

  const step = duration > 30 ? 10 : 5;
  const axisY = barTop + barHeight + 2;
  for (let t = 0; t <= duration; t += step) {
    parts.push(`<line class="ad-tl-tick" x1="${x(t).toFixed(1)}" y1="${axisY}" x2="${x(t).toFixed(1)}" y2="${axisY + 6}" />`);
    parts.push(`<text class="ad-tl-text" x="${x(t).toFixed(1)}" y="${axisY + 19}" text-anchor="middle">${t}s</text>`);
  }

  return `<svg class="ad-timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="两位说话人在对话中的发言分布">
    ${parts.join('')}
  </svg>
  <p class="ad-legend">
    <span class="ad-legend-item"><i class="ad-swatch ad-swatch-a"></i>A 在说话</span>
    <span class="ad-legend-item"><i class="ad-swatch ad-swatch-b"></i>B 在说话</span>
    ${(sample.gtRegions || []).length ? '<span class="ad-legend-item"><i class="ad-swatch ad-swatch-truth"></i>人工标注：被篡改的一句</span>' : ''}
  </p>`;
}

/** 把后端多说话人结果映射成视图需要的形状（上传场景没有人工标注）。 */
export function normalizeUploadedDialogue(data, fileName = '') {
  const speakers = (data.speakers || []).map((item, index) => ({
    id: item.id || (index === 0 ? 'A' : 'B'),
    label: item.label || item.pyannoteLabel || '',
    pFake: Number(item.pFake ?? item.p_fake ?? 0),
    isFake: Boolean(item.isFake ?? item.is_fake),
    speech: Number(item.totalSpeech ?? item.total_speech ?? 0),
    segments: item.segments || [],
  }));
  return {
    id: 'upload',
    title: fileName,
    file: fileName,
    duration: Number(data.durationSec ?? data.duration ?? 0),
    verdict: data.verdict || (speakers.some(item => item.isFake) ? 'both_fake' : 'both_real'),
    threshold: data.threshold,
    truth: null,
    pred: null,
    reasons: [],
    speakers,
    gtRegions: [],
    raw: data.raw || {},
    uploaded: true,
  };
}

/** 上游结果是否应该渲染成"分人"视图。 */
export function isMultiSpeakerResult(data) {
  return Boolean(data && Array.isArray(data.speakers) && data.speakers.length >= 2);
}

/**
 * 渲染分人结果。
 * @param {HTMLElement} container 挂载点
 * @param {object} sample 样例（带真值）或 normalizeUploadedDialogue 的结果（无真值）
 */
export function renderSpeakerResult(container, sample) {
  const meta = AD_SAMPLE_NOTES[sample.id];
  const verdict = AD_VERDICT_TEXT[sample.verdict] || {
    label: sample.speakers.some(item => item.isFake) ? '其中一方的声音是伪造的' : '两人都是真人',
    tone: sample.speakers.some(item => item.isFake) ? 'fake' : 'real',
  };
  const graded = Boolean(sample.truth);
  const correct = sample.truth === sample.pred;
  const reasons = (sample.reasons || []).map(item => AD_REASON_TEXT[item] || item);
  const truthText = AD_CATEGORY_TEXT[sample.truth] || sample.truth;
  const predText = AD_CATEGORY_TEXT[sample.pred] || sample.pred;

  container.innerHTML = `<div class="ad-result">
    <div class="ad-verdict ad-verdict-${verdict.tone}">
      <div class="ad-verdict-main">
        <span class="ad-verdict-kicker">检测结论</span>
        <strong>${adEscape(verdict.label)}</strong>
        <span class="ad-verdict-sub">A 是率先开口的一方，B 是另一方。</span>
      </div>
      <div class="ad-verdict-side">
        ${graded
          ? `<span class="ad-pill ${correct ? 'is-ok' : 'is-bad'}">${correct ? '评测：判定正确' : '评测：判定有误'}</span>
             <span class="ad-note-inline">人工标注：${adEscape(truthText)}</span>
             <span class="ad-note-inline">系统判定：${adEscape(predText)}</span>`
          : '<span class="ad-pill is-ok">按说话人分别判定</span>'}
      </div>
    </div>

    <div class="ad-speakers">${sample.speakers.map(adSpeakerCard).join('')}</div>

    <h3 class="ad-h3">对话里的发言分布</h3>
    ${adTimeline(sample)}
    <p class="ad-muted ad-tl-note">整条色带是这段 ${adFixed(sample.duration)} 秒对话的<strong>完整录音</strong>，从头到尾连续不中断；颜色只表示那一刻是谁在说话，两人交接处的短暂停顿并入相邻一方。系统按说话人分别判定，得出上面两个人的结论。</p>

    ${meta ? `<div class="ad-note">
      <strong>${adEscape(meta.title)}</strong>
      <span>${adEscape(meta.note)}</span>
      ${reasons.length ? `<span class="ad-reasons">评测发现的偏差：${adEscape(reasons.join(' / '))}</span>` : ''}
    </div>` : ''}

    <details class="ad-details">
      <summary>技术细节：模型原始输出与打分</summary>
      <p class="ad-raw-score">${sample.speakers.map(item => `${adEscape(item.id)} ${adFixed(item.pFake, 4)}`).join(' · ')}
        <span class="ad-muted">（模型给出的相对置信分，0 偏向真人、1 偏向伪造；最终判定另有一条标定好的判定线）</span></p>
      <div class="ad-raw">
        <div><span class="ad-raw-k">A</span><pre>${adEscape(sample.raw?.A || '')}</pre></div>
        <div><span class="ad-raw-k">B</span><pre>${adEscape(sample.raw?.B || '')}</pre></div>
      </div>
    </details>
  </div>`;
}

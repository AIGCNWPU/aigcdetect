/** 把后端返回的检测结果转成"模型能直接复述"的结论。
 *
 * 两个形态：
 *   mode=single   单人/整段结论
 *   mode=dialogue 分人结论（谁被伪造）
 *
 * 这里只做文案，不碰业务判断——单人还是双人由服务端决定。
 */

const pct = value => `${(Number(value || 0) * 100).toFixed(2)}%`;
const sec = value => `${Number(value || 0).toFixed(2)} 秒`;

function regionText(region, duration) {
  if (region === 'all') return `整段（0.00 – ${Number(duration || 0).toFixed(2)} 秒）`;
  if (Array.isArray(region) && region.length) {
    return region
      .map(pair => `${Number(pair[0]).toFixed(2)} – ${Number(pair[1]).toFixed(2)} 秒`)
      .join('、');
  }
  return '';
}

function speakerLine(speaker) {
  const label = speaker.label ? `（${speaker.label}）` : '';
  const verdict = speaker.isFake ? '伪造' : '真人';
  const speech = Number(speaker.totalSpeech || 0).toFixed(1);
  return `${speaker.id}${label}：${verdict}，本人语音 ${speech} 秒`;
}

/** @returns {{ title: string, lines: string[] }} */
export function summarizeResult(data) {
  if (!data || typeof data !== 'object') {
    return { title: '检测失败', lines: ['服务没有返回结果。'] };
  }

  const duration = data.durationSec || data.duration || 0;
  const mode = data.mode || (Array.isArray(data.speakers) && data.speakers.length > 1 ? 'dialogue' : 'single');

  if (mode === 'dialogue' && Array.isArray(data.speakers) && data.speakers.length >= 2) {
    const fakes = data.speakers.filter(item => item.isFake);
    let title;
    if (fakes.length === 0) title = '这段对话里两位说话人都是真人';
    else if (fakes.length === data.speakers.length) title = '这段对话里两位说话人都是伪造的';
    else title = `这段对话里 ${fakes[0].id} 的声音是伪造的`;

    const lines = data.speakers.map(speakerLine);
    lines.unshift(`共识别到 ${data.speakers.length} 位说话人，对话时长 ${sec(duration)}。`);
    if (data.warnings && data.warnings.length) lines.push(`提示：${data.warnings.join('；')}`);
    return { title, lines };
  }

  const isFake = data.verdict === 'fake' || data.verdict === 'both_fake' || (data.pFake ?? 0) >= 0.5;
  const region = regionText(data.fakeRegion, duration);
  const lines = [`音频时长 ${sec(duration)}，模型给出的相对置信分 ${pct(data.pFake)}。`];
  if (region) lines.push(`可疑片段：${region}。`);
  if (data.spoofMethodLabel) lines.push(`伪造手法：${data.spoofMethodLabel}。`);
  if (data.warnings && data.warnings.length) lines.push(`提示：${data.warnings.join('；')}`);
  return { title: isFake ? '这段音频包含 AI 合成/克隆语音' : '这段音频未发现 AI 合成痕迹', lines };
}

/** 拼成一段给模型看的文本。 */
export function summarizeText(payload) {
  const { title, lines } = summarizeResult(payload);
  return [title, ...lines.map(line => `- ${line}`)].join('\n');
}

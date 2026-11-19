// 4.1 AI 音频伪造检测 → 标准报告模型映射器。
// 输入为前端当前结果：{ file, media, source, result: { kind, pFake, methodLabel, regionLabel, latency, note, durationLabel, durationSec, windows }, chart }。
// chart 是前端把分段风险曲线栅格化后的 PNG 数据；只产出内容，不涉及版式。

import { createStdReport, p, table, list, image, chapter, formatStdTime } from './model.js';

const percent = (value) => `${(Math.min(1, Math.max(0, Number(value) || 0)) * 100).toFixed(1)}%`;
// The on-page note can tell users to click the curve; that instruction means nothing on paper.
const reportNote = (value) => String(value || '').replace(/[，,]?\s*点击[^。]*[。]?/g, '。').replace(/。+/g, '。');
const or = (value, fallback = '—') => (value === null || value === undefined || value === '' ? fallback : String(value));

/** Sample windows are bare scores on a 10s window / 5s step grid; uploads carry explicit ranges. */
function windowRows(windows) {
  return (Array.isArray(windows) ? windows : []).map((item, index) => {
    const range = typeof item === 'number' ? { start: index * 5, end: index * 5 + 10, pFake: item } : item;
    const score = Number(range?.pFake);
    const flagged = score >= 0.5;
    return [String(index + 1), `${Number(range?.start).toFixed(1)} – ${Number(range?.end).toFixed(1)} s`, percent(score), flagged ? '可疑' : '正常'];
  });
}

export function buildAudioStdReport(payload, { generatedAt = new Date().toISOString(), reportNo = '' } = {}) {
  const result = payload?.result || {};
  const fileName = payload?.file || result.file || '未命名音频';
  const isFake = result.kind === 'fake';
  const conclusion = isFake ? '检测到 AI 伪造痕迹' : '未发现合成痕迹';
  const rows = windowRows(result.windows);

  const meta = [
    ['检测场景', 'AI 音频伪造检测'],
    ['检测对象', fileName],
    ['生成时间', formatStdTime(generatedAt)],
  ];
  if (reportNo) meta.push(['报告编号', reportNo]);

  const chapters = [
    chapter('检测结论', [
      p(`本次检测结论：${conclusion}。伪造风险评分 ${percent(result.pFake)}（参考阈值 50%）。`),
      table(
        [{ title: '项目', width: 26 }, { title: '内容', width: 74 }],
        [
          ['鉴定结论', conclusion],
          ['伪造风险评分', `${percent(result.pFake)}（参考阈值 50%）`],
          ['识别类型', or(result.methodLabel)],
          ['可疑时间区间', or(result.regionLabel)],
          ['分析耗时', or(result.latency)],
          ['特征说明', or(reportNote(result.note))],
        ],
        { caption: '检测结论摘要' },
      ),
    ]),
    chapter('检测对象', [
      table(
        [{ title: '项目', width: 26 }, { title: '内容', width: 74 }],
        [
          ['文件名称', fileName],
          ['媒体类型', payload?.media === 'video' ? '视频（自动提取音轨）' : '音频'],
          ['音频规格', or(result.durationLabel)],
          ['材料来源', or(payload?.source, '上传文件')],
        ],
        { caption: '检测对象信息' },
      ),
    ]),
  ];
  if (rows.length >= 2) {
    chapters.push(chapter('分段风险', [
      p(`共 ${rows.length} 个检测窗口（窗宽 10 秒、步长 5 秒），评分高于 50% 的窗口标记为可疑。`),
      image(payload?.chart, '分段伪造风险曲线', { widthCm: 15 }),
      table(
        [{ title: '窗口', width: 12 }, { title: '时间范围', width: 38 }, { title: '伪造风险', width: 25 }, { title: '判定', width: 25 }],
        rows,
        { caption: '分段风险明细' },
      ),
    ]));
  }
  chapters.push(chapter('说明与限制', [
    list([
      '评分高于 50% 参考阈值的片段标记为可疑，临近阈值的结果建议结合原始录音环境人工复核。',
      '长音频的可疑区间由连续超过阈值的窗口合并得出，时间精度约为一个步长（5 秒）。',
      '本报告仅对应本次送检的文件。',
    ]),
  ]));

  return createStdReport({
    docTitle: '音频真实性检测报告',
    subtitle: fileName,
    scenario: 'audio-forgery',
    generatedAt,
    reportNo,
    meta,
    chapters,
  });
}

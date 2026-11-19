import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAudioStdReport } from '../src/modules/image/report-standard/audio-map.js';
import { buildReportModel, reportFilename } from '../src/modules/image/report-standard/service.js';
import { validateStdReport } from '../src/modules/image/report-standard/model.js';

const png = 'data:image/png;base64,iVBORw0KGgo=';
const longSample = {
  file: 'long60.wav', media: 'audio', source: '样本音频', chart: png,
  result: { kind: 'fake', pFake: 1, methodLabel: '局部语音合成插入（TTS）', regionLabel: '15.00 – 45.00 s', latency: '30.7 s',
    note: '中段检出合成插入特征。', durationLabel: '60.00 s · 滑窗 11 段', windows: [0.001, 0.003, 0.984, 0.997] },
};

test('音频报告：结论、对象、分段风险与复核说明齐全，可通过标准模型校验', () => {
  const model = buildAudioStdReport(longSample, { generatedAt: '2026-11-19T02:00:00Z', reportNo: 'AF-1' });
  assert.equal(validateStdReport(model).ok, true);
  assert.deepEqual(model.chapters.map(chapter => chapter.title), ['检测结论', '检测对象', '分段风险', '说明与限制']);
  const segments = model.chapters[2].blocks.find(block => block.type === 'table');
  assert.deepEqual(segments.rows[2], ['3', '10.0 – 20.0 s', '98.4%', '可疑']);
  assert.equal(model.chapters[2].blocks.filter(block => block.type === 'image').length, 1);
  assert.match(model.chapters[0].blocks[0].text, /检测到 AI 伪造痕迹.*100\.0%/);
});

test('音频报告：短音频没有分段曲线时省略分段章节，并走统一场景入口与文件名', () => {
  const short = { file: 'wav1.wav', result: { kind: 'real', pFake: 0.02, windows: [] } };
  const model = buildReportModel({ scenario: 'audio', payload: short, generatedAt: '2026-11-19T02:00:00Z' });
  assert.deepEqual(model.chapters.map(chapter => chapter.title), ['检测结论', '检测对象', '说明与限制']);
  assert.match(model.chapters[0].blocks[0].text, /未发现合成痕迹/);
  assert.match(reportFilename(model, 'pdf'), /^智鉴音频检测报告-wav1\.wav-\d{8}-\d{6}\.pdf$/);
});

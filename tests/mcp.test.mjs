import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeResult, summarizeText } from '../mcp/summarize.mjs';

test('单人：伪造结论', () => {
  const { title, lines } = summarizeResult({
    mode: 'single',
    verdict: 'fake',
    pFake: 0.9876,
    durationSec: 4,
    fakeRegion: 'all',
    spoofMethodLabel: '语音合成 TTS',
  });
  assert.match(title, /包含 AI 合成/);
  assert.match(lines.join('\n'), /98\.76%/);
  assert.match(lines.join('\n'), /整段/);
  assert.match(lines.join('\n'), /语音合成 TTS/);
});

test('单人：真人结论', () => {
  const { title, lines } = summarizeResult({
    mode: 'single',
    verdict: 'real',
    pFake: 0.001,
    durationSec: 6,
    fakeRegion: null,
  });
  assert.match(title, /未发现 AI 合成痕迹/);
  assert.doesNotMatch(lines.join('\n'), /可疑片段/);
});

test('分人：一方被伪造', () => {
  const { title, lines } = summarizeResult({
    mode: 'dialogue',
    verdict: 'A_fake',
    durationSec: 34.46,
    speakers: [
      { id: 'A', label: 'SPEAKER_00', isFake: true, totalSpeech: 16.62 },
      { id: 'B', label: 'SPEAKER_01', isFake: false, totalSpeech: 12.5 },
    ],
  });
  assert.match(title, /A 的声音是伪造的/);
  assert.match(lines[0], /2 位说话人/);
  assert.ok(lines.some(line => line.startsWith('A') && line.includes('伪造')));
  assert.ok(lines.some(line => line.startsWith('B') && line.includes('真人')));
});

test('分人：两人都真 / 都假', () => {
  const bothReal = summarizeResult({
    mode: 'dialogue',
    durationSec: 30,
    speakers: [
      { id: 'A', isFake: false, totalSpeech: 15 },
      { id: 'B', isFake: false, totalSpeech: 12 },
    ],
  });
  assert.match(bothReal.title, /都是真人/);

  const bothFake = summarizeResult({
    mode: 'dialogue',
    durationSec: 30,
    speakers: [
      { id: 'A', isFake: true, totalSpeech: 15 },
      { id: 'B', isFake: true, totalSpeech: 12 },
    ],
  });
  assert.match(bothFake.title, /都是伪造的/);
});

test('没有 mode 字段时按 speakers 推断为分人', () => {
  const { title } = summarizeResult({
    durationSec: 20,
    speakers: [
      { id: 'A', isFake: false, totalSpeech: 10 },
      { id: 'B', isFake: true, totalSpeech: 8 },
    ],
  });
  assert.match(title, /B 的声音是伪造的/);
});

test('summarizeText 输出标题 + 列表', () => {
  const text = summarizeText({
    mode: 'single', verdict: 'fake', pFake: 0.9, durationSec: 5,
  });
  const lines = text.split('\n');
  assert.ok(lines.length >= 2);
  assert.match(lines[0], /AI 合成/);
  assert.match(lines[1], /^- /);
});

test('空结果不抛异常', () => {
  assert.match(summarizeResult(null).title, /失败/);
  assert.ok(summarizeResult({}).title.length > 0);
});

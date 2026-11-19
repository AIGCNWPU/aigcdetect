import test from 'node:test';
import assert from 'node:assert/strict';
import { DIALOGUE_CASES, AD_VERDICT_TEXT, isMultiSpeakerResult, normalizeUploadedDialogue, renderSpeakerResult } from '../src/modules/audio/dialogue-view.js';

const VERDICTS = ['both_real', 'A_fake', 'B_fake', 'both_fake'];

function fakeElement() {
  return { innerHTML: '' };
}

test('分人视图能渲染两类样例（都真 / 一方被替换）', () => {
  assert.equal(DIALOGUE_CASES.length, 2);
  for (const sample of DIALOGUE_CASES) {
    const target = fakeElement();
    assert.equal(renderSpeakerResult(target, sample), undefined);
    assert.match(target.innerHTML, /检测结论/);
    assert.match(target.innerHTML, /ad-speakers/);
    assert.match(target.innerHTML, /对话里的发言分布/);
    // 阈值属于内部参数，不展示给使用者
    assert.doesNotMatch(target.innerHTML, /τ/);
    assert.doesNotMatch(target.innerHTML, /0\.9959/);
    assert.doesNotMatch(target.innerHTML, /阈值/);
  }
});

test('样例覆盖都真与一方被替换，四类结论都有文案', () => {
  for (const verdict of VERDICTS) {
    assert.ok(AD_VERDICT_TEXT[verdict]?.label, `缺少 ${verdict} 的文案`);
  }
  const verdicts = new Set(DIALOGUE_CASES.map(item => item.verdict));
  assert.deepEqual([...verdicts].sort(), ['A_fake', 'both_real']);
  for (const sample of DIALOGUE_CASES) {
    assert.equal(sample.speakers.length, 2);
    for (const speaker of sample.speakers) {
      assert.ok(['A', 'B'].includes(speaker.id));
      assert.ok(speaker.segments.length > 0);
      assert.ok(speaker.pFake >= 0 && speaker.pFake <= 1);
    }
    assert.equal(typeof sample.duration, 'number');
    assert.ok(Array.isArray(sample.gtRegions));
  }
});

test('上传的多说话人结果会被识别并映射成视图结构', () => {
  const uploaded = {
    durationSec: 30.5,
    verdict: 'A_fake',
    speakers: [
      { id: 'A', label: 'SPEAKER_00', pFake: 0.99, isFake: true, totalSpeech: 12.5, segments: [[0, 3], [6, 9]] },
      { id: 'B', label: 'SPEAKER_01', pFake: 0.01, isFake: false, totalSpeech: 11.0, segments: [[3, 6], [9, 12]] },
    ],
  };
  assert.equal(isMultiSpeakerResult(uploaded), true);
  assert.equal(isMultiSpeakerResult({ speakers: [{ id: 'A' }] }), false);
  assert.equal(isMultiSpeakerResult({}), false);

  const sample = normalizeUploadedDialogue(uploaded, 'x.wav');
  assert.equal(sample.uploaded, true);
  assert.equal(sample.duration, 30.5);
  assert.equal(sample.truth, null);
  assert.equal(sample.speakers[0].pFake, 0.99);

  const target = fakeElement();
  renderSpeakerResult(target, sample);
  // 上传场景没有人工标注，不能显示"评测判定"结论
  assert.doesNotMatch(target.innerHTML, /评测：判定/);
  assert.doesNotMatch(target.innerHTML, /人工标注/);
  assert.match(target.innerHTML, /按说话人分别判定/);
});

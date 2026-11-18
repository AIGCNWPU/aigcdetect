import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../scripts/serve.mjs';
import { openDatabase } from '../src/server/db.js';
import { createAiScoringSegments } from '../src/modules/text/ai-segmentation.js';

const listen = async server => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
};
const close = server => new Promise(resolve => {
  server.closeAllConnections();
  server.close(resolve);
});

test('正式积分系统：未登录拦截、每次检测扣1积分、多子请求幂等、失败退回、余额不足拦截与统一分页明细', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'veritas-credits-test-'));
  const db = openDatabase(path.join(dir, 'app.db'));

  let upstreamCalls = 0;
  let forceUpstreamFail = false;
  const upstream = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    upstreamCalls += 1;
    res.setHeader('Content-Type', 'application/json');
    if (forceUpstreamFail) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: { code: 'UPSTREAM_DOWN', message: '模型离线' } }));
      return;
    }
    const payload = raw ? JSON.parse(raw) : {};
    res.statusCode = payload.action === 'detect' || payload.action === 'review' ? 202 : 200;
    res.end(JSON.stringify({ data: { ok: true, status: payload.action === 'status' ? 'completed' : 'queued' }, requestId: 'u-1' }));
  });
  const upstreamUrl = await listen(upstream);

  const textModelClient = {
    async analyze() { return { findings: [] }; },
  };
  const egteClient = {
    modelVersion: 'credit-test',
    thresholds: { humanMax: 0.5, aiMin: 0.8, dominanceMin: 0.6 },
    async analyze({ segments }) {
      return segments.map(item => ({ segmentId: item.segmentId, status: 'success', aiScore: 0.2, predictedLabel: 0, documentTokens: 20 }));
    },
  };

  const gateway = createServer({
    proxy: true,
    enforceCredits: true,
    audioServiceUrl: upstreamUrl,
    imageServiceUrl: upstreamUrl,
    textModelClient,
    egteClient,
  });
  const base = await listen(gateway);

  try {
    // 1. 未登录检测请求被 401 拦截且不触发上游推理
    const meAnon = await fetch(`${base}/api/v1/auth/me`);
    assert.equal(meAnon.headers.get('x-veritas-require-auth'), '1');
    const unauthDetect = await fetch(`${base}/api/v1/audio/forgery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: 'dGVzdA==', fileName: 'a.wav' }),
    });
    assert.equal(unauthDetect.status, 401);
    assert.equal(upstreamCalls, 0);

    // 2. 注册赠送 100 积分
    const reg = await fetch(`${base}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'credit_tester', password: 'password123' }),
    });
    assert.equal(reg.status, 200);
    const cookie = reg.headers.get('set-cookie').split(';')[0];
    const regBody = await reg.json();
    assert.equal(regBody.user.credits, 100);

    // 3. 音频检测消耗 1 积分（100 -> 99）
    const audioRes = await fetch(`${base}/api/v1/audio/forgery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ audioBase64: 'dGVzdA==', fileName: 'a.wav' }),
    });
    assert.equal(audioRes.status, 200);
    assert.equal(audioRes.headers.get('x-veritas-credits'), '99');

    // 4. 图片检测：detect 扣 1 积分（99 -> 98），同批次第二张图与 status 轮询、example 均不额外扣费
    const batchRunId = 'run-batch-image-001';
    const imgDetect1 = await fetch(`${base}/api/v1/image/general`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Veritas-Run-Id': batchRunId },
      body: JSON.stringify({ action: 'detect', id: 'img-1' }),
    });
    assert.equal(imgDetect1.status, 202);
    assert.equal(imgDetect1.headers.get('x-veritas-credits'), '98');

    const imgDetect2 = await fetch(`${base}/api/v1/image/general`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Veritas-Run-Id': batchRunId },
      body: JSON.stringify({ action: 'detect', id: 'img-2' }),
    });
    assert.equal(imgDetect2.status, 202);
    assert.equal(imgDetect2.headers.get('x-veritas-credits'), '98');

    const imgPoll = await fetch(`${base}/api/v1/image/general`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'status', jobId: 'job-1' }),
    });
    assert.equal(imgPoll.status, 200);

    const docExample = await fetch(`${base}/api/v1/image/documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ action: 'example' }),
    });
    assert.equal(docExample.status, 200);

    // 5. 新闻双服务并发同一 runId 只扣 1 积分（98 -> 97）
    const newsRunId = 'run-news-dual-001';
    const newsContent = '记者今日走访社区图书馆了解读者反馈，并现场核实了开放时间与读者借阅记录。';
    const [newsAi, newsProof] = await Promise.all([
      fetch(`${base}/api/v1/text/news`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Veritas-Run-Id': newsRunId },
        body: JSON.stringify({
          action: 'analyze',
          material: { title: '测试新闻', sourceType: 'paste', content: newsContent, language: 'zh', aiSegments: createAiScoringSegments(newsContent, { prefix: 'news-s' }) },
          checks: ['ai-risk'],
        }),
      }),
      fetch(`${base}/api/v1/text/news`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-Veritas-Run-Id': newsRunId },
        body: JSON.stringify({
          action: 'analyze',
          material: { title: '测试新闻', sourceType: 'paste', content: newsContent, language: 'zh' },
          checks: ['proofreading'],
        }),
      }),
    ]);
    assert.equal(newsAi.status, 200);
    assert.equal(newsProof.status, 200);
    const meAfterNews = await (await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: cookie } })).json();
    assert.equal(meAfterNews.user.credits, 97);

    // 6. 上游失败时自动退回积分（仍保持 97）
    forceUpstreamFail = true;
    const failedRes = await fetch(`${base}/api/v1/audio/forgery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ audioBase64: 'dGVzdA==', fileName: 'fail.wav' }),
    });
    assert.equal(failedRes.status, 502);
    assert.equal(failedRes.headers.get('x-veritas-credits'), null);
    forceUpstreamFail = false;

    const meAfterRefund = await (await fetch(`${base}/api/v1/auth/me`, { headers: { Cookie: cookie } })).json();
    assert.equal(meAfterRefund.user.credits, 97);

    // 7. 补造 9 次前端本地样本检测（97 -> 88），验证统一积分与检测明细每页 10 条分页（共 1 条注册 + 12 条检测 = 13 条）
    for (let i = 0; i < 9; i += 1) {
      const sampleRes = await fetch(`${base}/api/v1/me/detections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ scene: 'audio-forgery', summary: `语音样本 0${(i % 4) + 1}`, consumeCredit: true }),
      });
      assert.equal(sampleRes.status, 200);
    }

    const page1 = await (await fetch(`${base}/api/v1/me/credits?page=1&pageSize=10`, { headers: { Cookie: cookie } })).json();
    assert.equal(page1.credits, 88);
    assert.equal(page1.total, 13);
    assert.equal(page1.totalPages, 2);
    assert.equal(page1.ledger.length, 10);
    assert.equal(page1.ledger[0].delta, -1);
    assert.equal(page1.ledger[0].balance_after, 88);

    const page2 = await (await fetch(`${base}/api/v1/me/credits?page=2&pageSize=10`, { headers: { Cookie: cookie } })).json();
    assert.equal(page2.ledger.length, 3);
    assert.equal(page2.ledger.at(-1).reason, 'signup_bonus');
    assert.equal(page2.ledger.at(-1).delta, 100);
    assert.equal(page2.ledger.at(-1).balance_after, 100);

    // 8. 积分清零后返回 402 INSUFFICIENT_CREDITS 且不触发上游
    db.prepare('UPDATE users SET credits = 0 WHERE id = ?').run(regBody.user.id);
    const callsBeforeZero = upstreamCalls;
    const zeroRes = await fetch(`${base}/api/v1/audio/forgery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ audioBase64: 'dGVzdA==', fileName: 'zero.wav' }),
    });
    assert.equal(zeroRes.status, 402);
    const zeroBody = await zeroRes.json();
    assert.equal(zeroBody.error.code, 'INSUFFICIENT_CREDITS');
    assert.equal(upstreamCalls, callsBeforeZero);
  } finally {
    await close(gateway);
    await close(upstream);
    db.close();
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

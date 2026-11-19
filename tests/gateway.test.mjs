import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createServer, resolveBackend } from '../scripts/serve.mjs';

const AUDIO = 'http://127.0.0.1:18000';
const TEXT = 'http://127.0.0.1:18010';

test('网关按前缀分流：音频走音频服务，学术走文本后端，其余留在本地', () => {
  assert.equal(resolveBackend('/api/v1/audio/forgery', { audio: AUDIO, text: TEXT }), AUDIO);
  assert.equal(resolveBackend('/api/v1/audio/health', { audio: AUDIO, text: TEXT }), AUDIO);
  assert.equal(resolveBackend('/api/v1/text/academic', { audio: AUDIO, text: TEXT }), TEXT);
  assert.equal(resolveBackend('/api/v1/pdf/parse', { audio: AUDIO, text: TEXT }), TEXT);
  // 本地处理的路由不应被代理
  assert.equal(resolveBackend('/api/v1/health', { audio: AUDIO, text: TEXT }), null);
  assert.equal(resolveBackend('/api/v1/catalog', { audio: AUDIO, text: TEXT }), null);
  assert.equal(resolveBackend('/api/v1/video/general', { audio: AUDIO, text: TEXT }), null);
});

test('开启代理后，音频请求被转发到音频服务并原样返回', async () => {
  const seen = [];
  const upstream = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', chunk => chunks.push(chunk));
    request.on('end', () => {
      seen.push({ method: request.method, url: request.url, body: Buffer.concat(chunks).toString('utf8') });
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ data: { mode: 'dialogue', verdict: 'A_fake', speakers: [{ id: 'A' }, { id: 'B' }] }, requestId: 'upstream' }));
    });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const upstreamPort = upstream.address().port;

  const web = createServer({ proxy: true, audioBackendUrl: `http://127.0.0.1:${upstreamPort}` });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const base = `http://127.0.0.1:${web.address().port}`;

  try {
    const response = await fetch(`${base}/api/v1/audio/forgery`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'auto', fileName: 'a.wav' }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.data.mode, 'dialogue');
    assert.equal(payload.data.speakers.length, 2);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, 'POST');
    assert.match(seen[0].body, /"mode":"auto"/);
  } finally {
    web.closeAllConnections();
    await new Promise(resolve => web.close(resolve));
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
});

test('未开启代理时音频接口保持本地 501，不静默转发', async () => {
  const web = createServer({ proxy: false });
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  const base = `http://127.0.0.1:${web.address().port}`;
  try {
    const response = await fetch(`${base}/api/v1/audio/forgery`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 501);
    const payload = await response.json();
    assert.equal(payload.error.code, 'NOT_IMPLEMENTED');
  } finally {
    web.closeAllConnections();
    await new Promise(resolve => web.close(resolve));
  }
});

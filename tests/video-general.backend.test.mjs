import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readMultipartBody } from '../src/server/multipart.js';
import { runVideoScenario } from '../src/modules/video/service.js';
import { videoModule } from '../src/modules/video/definition.js';

const generalScenario = videoModule.scenarios.find(scenario => scenario.id === 'general');
const fakeVideo = Buffer.from('fake-mp4-bytes');

function multipartRequest(boundary, parts) {
  const encode = [];
  for (const part of parts) {
    encode.push(`--${boundary}\r\n`);
    if (part.filename === undefined) encode.push(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`);
    else encode.push({ head: `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\nContent-Type: video/mp4\r\n\r\n`, data: part.value });
  }
  encode.push(`--${boundary}--\r\n`);
  const body = Buffer.concat(encode.map(item => (typeof item === 'string' ? Buffer.from(item) : Buffer.concat([Buffer.from(item.head), item.data, Buffer.from('\r\n')]))));
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
    async * [Symbol.asyncIterator]() { yield body; },
  };
}

test('multipart 解析器提取文件与文本字段并拒绝超限', async () => {
  const boundary = '----veritas';
  const request = multipartRequest(boundary, [
    { name: 'video', filename: 'clip.mp4', value: fakeVideo },
    { name: 'note', value: '联调测试' },
  ]);
  const parsed = await readMultipartBody(request);
  assert.equal(parsed.files.length, 1);
  assert.equal(parsed.files[0].filename, 'clip.mp4');
  assert.deepEqual(parsed.files[0].data, fakeVideo);
  assert.equal(parsed.fields.get('note'), '联调测试');

  const oversized = { headers: request.headers, async *[Symbol.asyncIterator]() { for (let i = 0; i < 3; i += 1) yield Buffer.alloc(300 * 1024 * 1024, 7); } };
  await assert.rejects(() => readMultipartBody(oversized, { maxBytes: 1024 }), error => error.code === 'PAYLOAD_TOO_LARGE');
});

function startStubDetector(handler) {
  return new Promise(resolve => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

const stubResult = {
  risk: 'low', summary: 'stub 结论', coverage: 'full', scope: 'stub 范围',
  duration: 12.5, sampledFrames: 48, findings: [], segments: [], frames: [],
};

test('video/general 服务校验上传并转发检测结果', async () => {
  process.env.RESTRAV_SERVICE_URL = 'http://127.0.0.1:1'; // 先指向不可达端口验证失败路径
  await assert.rejects(
    () => runVideoScenario(generalScenario, { files: [{ name: 'video', filename: 'a.mp4', data: fakeVideo }], fields: new Map() }, { requestId: 'r1' }),
    error => error.code === 'DETECTOR_UNAVAILABLE',
  );

  await assert.rejects(
    () => runVideoScenario(generalScenario, { files: [{ name: 'video', filename: 'a.mov', data: fakeVideo }], fields: new Map() }, { requestId: 'r2' }),
    error => error.code === 'VALIDATION_ERROR' && /MP4 \/ WebM/.test(error.message),
  );
  await assert.rejects(
    () => runVideoScenario(generalScenario, { files: [], fields: new Map() }, { requestId: 'r3' }),
    error => error.code === 'VALIDATION_ERROR' && /video 字段/.test(error.message),
  );

  const { server, port } = await startStubDetector(async (request, response) => {
    assert.equal(request.url, '/detect');
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    assert.match(body, /name="video"; filename="clip\.mp4"/);
    assert.ok(body.includes('fake-mp4-bytes'));
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(stubResult));
  });
  try {
    process.env.RESTRAV_SERVICE_URL = `http://127.0.0.1:${port}`;
    const result = await runVideoScenario(
      generalScenario,
      { files: [{ name: 'video', filename: 'clip.mp4', data: fakeVideo }], fields: new Map() },
      { requestId: 'r4' },
    );
    assert.equal(result.risk, 'low');
    assert.equal(result.summary, 'stub 结论');
  } finally {
    delete process.env.RESTRAV_SERVICE_URL;
    server.close();
  }
});

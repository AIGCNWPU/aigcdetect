import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { probeFreeChapter, writeProbeArtifacts } from '../scripts/probe-free-chapter.mjs';

const unsupported = () => { throw Object.assign(new Error('正文不在HTML中。'), { code: 'CONTENT_NOT_FOUND', status: 422 }); };

test('免费章节探测在DOM失败后对Canvas截图执行OCR并保存可复核产物', async () => {
  const capture = Buffer.from('fake-public-canvas');
  const renderer = {
    async probe(url) {
      return {
        sourceUrl: url,
        finalUrl: url,
        title: '第二章 公开试读',
        html: '<html><canvas id="txtCanvas-0"></canvas></html>',
        renderer: 'fake-playwright',
        readable: null,
        probe: {
          diagnostics: { canvasCount: 1, canvases: [{ id: 'txtCanvas-0', visible: true }], hasRestrictionSignal: false, hasLoadingSignal: false },
          captures: [{ kind: 'canvas', index: 0, id: 'txtCanvas-0', width: 800, height: 1200, data: capture }],
        },
      };
    },
  };
  const report = await probeFreeChapter('https://www.qimao.com/shuku/1-2/', {
    fetchPage: async () => { throw Object.assign(new Error('静态页面无正文。'), { code: 'CONTENT_NOT_FOUND' }); },
    extract: unsupported,
    renderer,
    parseImage: async image => ({ text: `第一段公开正文，截图长度${image.length}。\n第二段公开正文用于验证OCR实验输出。`.repeat(3) }),
  });
  assert.equal(report.result.extractionMethod, 'browser-screenshot-ocr');
  assert.equal(report.result.completeness, 'unknown');
  assert.match(report.result.content, /第一段公开正文/);
  assert.deepEqual(report.diagnostic.attempted, ['static-html', 'browser-rendered', 'browser-screenshot-ocr']);

  const directory = await mkdtemp(path.join(os.tmpdir(), 'veritas-free-chapter-probe-'));
  try {
    const artifacts = await writeProbeArtifacts(report, directory);
    assert.equal(artifacts.hasResult, true);
    assert.deepEqual(await readFile(path.join(directory, 'capture-01-canvas.png')), capture);
    assert.match(await readFile(path.join(directory, 'result.md'), 'utf8'), /实验性OCR/);
    const diagnostic = JSON.parse(await readFile(path.join(directory, 'diagnostic.json'), 'utf8'));
    assert.equal(diagnostic.result.characterCount, report.result.content.length);
    assert.equal(diagnostic.result.content, undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('仍停留加载壳且OCR文字不足时不伪造章节正文', async () => {
  const report = await probeFreeChapter('https://t.shuqi.com/reader/1/?forceChapterId=2', {
    fetchPage: async () => { throw new Error('静态页面无正文。'); },
    extract: unsupported,
    renderer: {
      async probe(url) {
        return {
          sourceUrl: url, finalUrl: url, title: '书旗小说', html: '<div>加载中</div>', renderer: 'fake-playwright', readable: null,
          probe: { diagnostics: { canvasCount: 0, canvases: [], hasRestrictionSignal: false, hasLoadingSignal: true }, captures: [{ kind: 'viewport', data: Buffer.from('loading') }] },
        };
      },
    },
    parseImage: async () => ({ text: '加载中' }),
  });
  assert.equal(report.result, null);
  assert.equal(report.diagnostic.status, 'failed');
});

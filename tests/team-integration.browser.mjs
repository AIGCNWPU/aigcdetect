import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';
import { generalShowcase } from '../src/modules/image/general/example.js';

const server = createServer({ dist: true, proxy: false });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
page.setDefaultTimeout(10000);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await page.route('**/api/v1/video/deepfake/health', route => route.fulfill({ json: { ready: false } }));
await page.route('**/api/v1/health', route => route.fulfill({ json: { services: { videoGeneral: { available: false } } } }));

try {
  // The deepfake service checks metadata first and skips visual review on a hit, so each marker source gets its own run.
  for (const [route, prefix, apiKey, source] of [
    ['general', 'vg', 'videoGeneralDetection'],
    ['deepfake', 'vd', 'videoDeepfakeDetection', 'metadata'],
    ['deepfake', 'vd', 'videoDeepfakeDetection', 'visual'],
  ]) {
    // A fresh document per case: the second deepfake case would otherwise reuse the first case's task list.
    await page.goto('about:blank');
    await page.goto(base + '/#/video/' + route);
    const sample = page.locator(`[data-${prefix}-sample]`).first();
    await sample.waitFor();
    assert.equal(await page.locator(`.${prefix}-player`).count(), 0);
    await sample.click();
    await page.locator('[data-file]').waitFor();
    await page.evaluate(({ route, apiKey, source }) => {
      window.Veritas[apiKey].configure(async input => {
        const basic = {
          risk: 'high', summary: '测试样本 AI 标识', coverage: 'full', scope: '完整视频',
          duration: input.metadata.duration, sampledFrames: 2, findings: ['测试标记'],
        };
        if (route === 'general') return {
          ...basic, frames: [], segments: [],
          meta: { videoScore: .99, aiMarker: { source: 'embedded', label: 'AI-generated video' } },
        };
        const deepfake = { ...basic, persons: [], faceFrames: 0, aiProbability: .99 };
        return source === 'metadata'
          ? { ...deepfake, meta: { metadataScan: { detected: true, source: 'test-metadata', value: 'AI-generated video', markers: ['ai-generated'] } } }
          : { ...deepfake, visualAiMarker: { detected: true, time: .2, text: 'AI generated', location: '右下角', confidence: .94 } };
      });
    }, { route, apiKey, source });
    await page.locator('[data-detect]').click();
    await page.locator(`.${prefix}-player`).waitFor();
    assert.match(await page.locator(`.${prefix}-metrics`).innerText(), /99(?:\.0)?%/);
    if (route === 'deepfake') {
      const summary = await page.locator('.vd-summary-panel').innerText();
      if (source === 'metadata') {
        assert.match(summary, /元数据/);
        assert.doesNotMatch(summary, /画面中出现AI生成标识/);
      } else {
        assert.match(summary, /画面中出现AI生成标识/);
        assert.doesNotMatch(summary, /元数据已包含AI生成标识/);
      }
    } else {
      for (const width of [1920, 1440, 390]) {
        await page.setViewportSize({ width, height: 840 });
        const stage = page.locator('[data-stage]');
        await stage.locator('video').waitFor();
        const result = await stage.evaluate(el => {
          const box = el.getBoundingClientRect();
          const control = el.querySelector('[data-stage-toggle]').getBoundingClientRect();
          const style = getComputedStyle(el.querySelector('video'));
          return { height: box.height, offset: Math.abs(box.left + box.width / 2 - control.left - control.width / 2), fit: style.objectFit, position: style.objectPosition };
        });
        assert.ok(result.height <= 500 && result.offset <= 1);
        assert.equal(result.fit, 'contain');
        assert.equal(result.position, '50% 50%');
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    }
    console.log(`${route}${source ? ' ' + source : ''} video: sample upload, risk markers, probability and playback layout passed`);
  }

  let uploadId;
  await page.route('**/api/v1/image/general', async route => {
    const payload = route.request().postDataJSON();
    if (payload.action === 'detect') uploadId = payload.id;
    const data = payload.action === 'detect'
      ? { status: 'queued', jobId: 'team-browser-general', queuePosition: 1 }
      : { ...generalShowcase, id: uploadId, status: 'completed' };
    await route.fulfill({ json: { data } });
  });
  const reportFormats = [];
  await page.route('**/api/v1/image/report', route => {
    const { scenario, format } = route.request().postDataJSON();
    reportFormats.push([scenario, format]);
    return route.fulfill({ body: 'fixture export', headers: { 'Content-Disposition': `attachment; filename="fixture.${format}"` } });
  });
  await page.goto(base + '/#/image/general');
  await page.locator('#ig-files').waitFor({ state: 'attached' });
  assert.equal(await page.locator('.ig-showcase,.ig-benchmark').count(), 0);
  await page.locator('[data-ig-sample]').first().click();
  await page.locator('.ig-file').first().waitFor();
  await page.locator('#ig-start').click();
  await page.locator('.ig-result.likely_ai').waitFor();
  const generalDownload = page.waitForEvent('download');
  await page.locator('[data-ig-report="word"]').click();
  assert.equal((await generalDownload).suggestedFilename(), 'fixture.docx');

  const docModes = [];
  let materials;
  await page.route('**/api/v1/image/documents', async route => {
    const payload = route.request().postDataJSON();
    if (payload.action === 'review') {
      docModes.push(payload.mode);
      materials = payload.files.map(file => ({
        id: file.id, name: file.name,
        status: 'completed', pages: [],
        stages: { seed: { status: 'completed', score: .7 }, mirror: { status: 'completed', score: .5 } },
        quality: { blur: { score: .8, level: 'severe' } },
      }));
    }
    const data = payload.action === 'review' ? { status: 'queued', reviewId: 'team-browser-docs' }
      : { status: 'completed', reviewId: 'team-browser-docs', materials };
    await route.fulfill({ json: { data } });
  });
  await page.goto(base + '/#/image/documents');
  assert.equal(await page.locator('[data-doc-result]').count(), 0);
  await page.locator('[data-doc-sample]').first().click();
  await page.locator('.doc-file').first().waitFor();
  assert.equal(await page.locator('[data-mode="batch"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#doc-start').click();
  await page.locator('[data-doc-target="cross"]').waitFor();
  const docDownload = page.waitForEvent('download');
  await page.locator('[data-doc-report="pdf"]').click();
  assert.equal((await docDownload).suggestedFilename(), 'fixture.pdf');
  await page.locator('[data-mode="single"]').click();
  await page.locator('#doc-start').click();
  await page.locator('[data-doc-target="risks"]').waitFor();
  assert.equal(await page.locator('[data-doc-target="cross"]').count(), 0);
  assert.deepEqual(docModes, ['batch', 'single']);
  assert.deepEqual(reportFormats, [['general', 'docx'], ['documents', 'pdf']]);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log('Images: empty initial state, sample uploads, two document modes, export requests and mobile passed');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

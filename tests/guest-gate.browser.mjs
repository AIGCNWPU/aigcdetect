// Guests must get the sign-in dialog on their first detection click in every scene, before any detection request.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Usage: node tests/guest-gate.browser.mjs [siteUrl]. Without a URL it starts a local production-mode gateway,
// where media scenes that need their detection services are skipped; run it against a site for the full check.
const { chromium } = await import('../tmp/browser-check/node_modules/playwright/index.mjs');
let base = process.argv.slice(2).find(arg => !arg.startsWith('--')), server;
if (!base) {
  process.env.VERITAS_DATA_DIR = await mkdtemp(path.join(tmpdir(), 'veritas-guest-'));
  const { createServer } = await import('../scripts/serve.mjs');
  server = createServer({ dist: true, proxy: false, enforceCredits: true });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
}

const scenes = [
  ['#/text/academic', [['click', '.academic-sample-cta'], ['button', /提交检测/]]],
  ['#/text/news', [['click', '[data-news-sample]'], ['button', /保存并开始检测/]]],
  ['#/text/novel', [['click', '[data-novel-sample]'], ['optional', /前往章节检测/], ['button', /检测已选章节/]]],
  ['#/image/general', [['click', '[data-ig-sample]'], ['click', '#ig-start']]],
  ['#/image/refund', [['click', '[data-preset]'], ['optional', /^检测与核对$/], ['click', '[data-detection-start]']]],
  ['#/image/documents', [['click', '[data-doc-sample]'], ['click', '#doc-start']]],
  ['#/video/general', [['click', '[data-vg-sample]'], ['click', '[data-detect]']]],
  ['#/video/deepfake', [['click', '[data-vd-sample]'], ['click', '[data-detect]']]],
  ['#/video/aftersales', [['click', '[data-video-preset]'], ['optional', /^检测与核对$/], ['click', '[data-av-start]']]],
  ['#/audio/forgery', [['click', '[data-sample]'], ['click', '#af-start']]],
];
const browser = await chromium.launch({ channel: 'msedge' });
try {
  for (const [hash, steps] of scenes) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.setDefaultTimeout(15000);
    const detections = [];
    page.on('request', request => {
      const { pathname } = new URL(request.url());
      if (request.method() !== 'GET' && /^\/api\//.test(pathname) && !/^\/api\/v1\/auth\//.test(pathname)) detections.push(pathname);
    });
    await page.goto(base + '/' + hash);
    for (const [action, target] of steps) {
      if (action === 'click') {
        const el = page.locator(target).first();
        await el.waitFor();
        if (!server || await el.isEnabled()) await el.click();
        else { console.log(`${hash}: skipped locally (sample needs its backend service)`); break; }
      }
      else if (action === 'button') await page.getByRole('button', { name: target }).first().click();
      else {
        const el = page.getByRole('tab', { name: target }).or(page.getByRole('button', { name: target })).first();
        if (await el.isVisible().catch(() => false)) await el.click();
      }
      await page.waitForTimeout(400);
    }
    // Locally the media scenes have no detection service, and some report that before the sign-in check.
    if (server && /refund|aftersales|video|audio/.test(hash) && !(await page.locator('[data-auth-dialog]').isVisible())) {
      console.log(`${hash}: skipped locally (needs its detection service)`);
      await page.close();
      continue;
    }
    await page.locator('[data-auth-dialog]').waitFor({ state: 'visible' });
    // Only the refund and aftersales evidence sessions may be opened before the gate; no detection job is sent.
    assert.deepEqual(detections.filter(p => !/\/(sessions|videos)\b/.test(p)), [], `${hash} sent ${detections.join(', ')}`);
    console.log(`${hash}: sign-in dialog shown before any detection request`);
    await page.close();
  }
} finally {
  await browser.close();
  if (server) {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}

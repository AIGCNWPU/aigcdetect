import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const server = createServer({ dist: true, proxy: false });
server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

    for (const route of ['/', '/#/text/academic']) {
      await page.goto(`${base}${route}`, { waitUntil: 'networkidle' });
      await page.locator('.brand-mark img').waitFor();
      const topbar = await page.evaluate(() => {
        const mark = document.querySelector('.brand-mark');
        const img = mark?.querySelector('img');
        const wordmark = document.querySelector('.brand .brand-wordmark-svg');
        const slogan = document.querySelector('.brand .brand-slogan');
        const titleRow = document.querySelector('.brand .brand-title-row');
        const markBox = mark?.getBoundingClientRect();
        const imgBox = img?.getBoundingClientRect();
        const wmBox = wordmark?.getBoundingClientRect();
        const sloganBox = slogan?.getBoundingClientRect();
        const titleBox = titleRow?.getBoundingClientRect();
        const style = mark ? getComputedStyle(mark) : null;
        const icons = [...document.querySelectorAll('head link[rel*="icon"]')].map(el => ({
          rel: el.getAttribute('rel'),
          href: el.getAttribute('href'),
          type: el.getAttribute('type'),
        }));
        return {
          complete: img?.complete,
          naturalWidth: img?.naturalWidth,
          naturalHeight: img?.naturalHeight,
          src: img?.getAttribute('src'),
          backgroundImage: style?.backgroundImage,
          markWidth: markBox?.width,
          markHeight: markBox?.height,
          imgWidth: imgBox?.width,
          imgHeight: imgBox?.height,
          wordmarkWidth: wmBox?.width,
          wordmarkHeight: wmBox?.height,
          sloganText: slogan?.textContent?.trim(),
          sloganBelowTitle: Boolean(sloganBox && titleBox && sloganBox.top >= titleBox.bottom - 1),
          icons,
        };
      });
      assert.equal(topbar.complete, true, route);
      assert.equal(topbar.naturalWidth, 256, route);
      assert.equal(topbar.naturalHeight, 256, route);
      assert.equal(topbar.src, './public/brand-logo.png?v=5', route);
      assert.equal(topbar.backgroundImage, 'none', route);
      assert.equal(Math.round(topbar.markWidth), 35, route);
      assert.equal(Math.round(topbar.markHeight), 35, route);
      assert.equal(Math.round(topbar.imgWidth), 35, route);
      assert.equal(Math.round(topbar.imgHeight), 35, route);
      assert.ok(topbar.wordmarkWidth > 45 && topbar.wordmarkHeight >= 20, route);
      assert.equal(topbar.sloganText, '让真实，有据可循。', route);
      assert.equal(topbar.sloganBelowTitle, true, route);
      assert.ok(topbar.icons.some(item => item.href === './public/favicon.png?v=5'), route);
      assert.ok(topbar.icons.some(item => item.href === './public/favicon.svg?v=5'), route);
    }

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.locator('.sidebar-footer').click();
    await page.locator('.auth-head img').waitFor();
    const auth = await page.evaluate(() => {
      const img = document.querySelector('.auth-head img');
      const box = img?.getBoundingClientRect();
      return {
        complete: img?.complete,
        naturalWidth: img?.naturalWidth,
        naturalHeight: img?.naturalHeight,
        src: img?.getAttribute('src'),
        width: box?.width,
        height: box?.height,
      };
    });
    assert.equal(auth.complete, true);
    assert.equal(auth.naturalWidth, 256);
    assert.equal(auth.naturalHeight, 256);
    assert.equal(auth.src, './public/brand-logo.png?v=5');
    assert.equal(Math.round(auth.width), 34);
    assert.equal(Math.round(auth.height), 34);
    console.log('Browser brand icon verification passed:', JSON.stringify(auth));
  } finally {
    await browser.close();
  }
} finally {
  server.close();
}

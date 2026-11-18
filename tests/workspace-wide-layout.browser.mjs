import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

// Build dist first. This check only opens the form and scrolls it.
const server = createServer({ dist: true });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const failures = [];

try {
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel, headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1750, height: 850 } });
      await page.goto(`http://127.0.0.1:${server.address().port}/#/text/academic`);
      await page.locator('.academic-workspace').waitFor();
      let baseline;
      for (const width of [1750, 1800, 2200, 3840, 390]) {
        await page.setViewportSize({ width, height: 850 });
        const layout = await page.locator('main').evaluate(main => {
          const scrollport = main.getBoundingClientRect();
          const card = main.querySelector('.academic-workspace').getBoundingClientRect();
          const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
          const breadcrumb = main.querySelector('.breadcrumbs');
          main.scrollTop = 0;
          const breadcrumbBox = breadcrumb.getBoundingClientRect();
          main.scrollTop = main.scrollHeight;
          const footerVisible = main.querySelector('footer').getBoundingClientRect().bottom <= scrollport.bottom + 1;
          main.scrollTop = 0;
          return {
            rightGap: innerWidth - scrollport.right,
            leftGap: card.left - (innerWidth > 760 ? sidebar.right : scrollport.left),
            cardWidth: card.width,
            breadcrumbX: breadcrumbBox.left,
            cardX: card.left,
            top: breadcrumbBox.top - scrollport.top,
            footerVisible,
            horizontalOverflow: main.scrollWidth > main.clientWidth + 1,
          };
        });
        baseline ??= layout;
        const pass = Math.abs(layout.rightGap) <= 1
          && Math.abs(layout.cardX - layout.breadcrumbX) <= 1
          && layout.footerVisible && !layout.horizontalOverflow
          && (width === 390 || layout.top === baseline.top)
          && (width !== 2200 || (layout.leftGap < 120 && layout.cardWidth > baseline.cardWidth + 250))
          && (width !== 3840 || layout.cardWidth < 1900);
        console.log(JSON.stringify({ channel, width, pass, ...layout }));
        if (!pass) failures.push({ channel, width });
      }
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(failures, []);
} finally {
  server.close();
}

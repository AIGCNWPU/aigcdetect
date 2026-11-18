import assert from 'node:assert/strict';
import { once } from 'node:events';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

// Build dist before running. This check uses the shell without running detections.
const server = createServer({ dist: true, proxy: false });
server.listen(0, '127.0.0.1');
await once(server, 'listening');

try {
  for (const channel of ['chrome', 'msedge']) {
    const browser = await chromium.launch({ channel });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      await page.goto(`http://127.0.0.1:${server.address().port}/#/`);
      const toggle = page.locator('.sidebar-toggle');
      await toggle.waitFor();

      const transitions = await toggle.evaluate(async button => {
        const layout = button.closest('.app-layout');
        const sidebar = layout.querySelector('.sidebar');
        const icons = [...sidebar.querySelectorAll('.nav-item svg, .user-avatar')];
        const labels = [...sidebar.querySelectorAll('.nav-item > span, .nav-label, .sidebar-user')];
        const labelEnds = labels.map(label => label.getBoundingClientRect().right);
        function readFrame() {
          const bounds = sidebar.getBoundingClientRect();
          const overview = sidebar.querySelector('.overview-link');
          const overviewBox = overview.getBoundingClientRect();
          const toggleBox = button.getBoundingClientRect();
          const overviewText = overview.querySelector('span');
          return {
            width: bounds.width,
            aligned: Math.abs(overviewBox.top + overviewBox.height / 2 - toggleBox.top - toggleBox.height / 2) < 1,
            separated: overviewBox.right <= toggleBox.left && toggleBox.right <= bounds.right && toggleBox.width >= 24,
            overviewTextFits: Number(getComputedStyle(overviewText).opacity) <= .15 ||
              overviewText.getBoundingClientRect().right <= overviewBox.right + 1,
            icons: icons.map(icon => {
              const { x, y } = icon.getBoundingClientRect();
              return [x, y];
            }),
            earlyText: labels.some((label, index) => {
              const style = getComputedStyle(label);
              return style.display !== 'none' && Number(style.opacity) > .15
                && bounds.right < labelEnds[index] - 20;
            }),
          };
        }
        async function sampleTransition() {
          const frames = [readFrame()];
          button.click();
          const transitions = layout.getAnimations({ subtree: true });
          let animating = transitions.length > 0;
          void Promise.allSettled(transitions.map(transition => transition.finished)).then(() => {
            animating = false;
          });
          do {
            await new Promise(requestAnimationFrame);
            frames.push(readFrame());
          } while (animating);
          frames.push(readFrame());
          return frames;
        }
        return [await sampleTransition(), await sampleTransition()];
      });

      for (const [index, frames] of transitions.entries()) {
        const start = frames[0];
        const end = frames.at(-1);
        assert.equal(start.width, index === 0 ? 246 : 72);
        assert.equal(end.width, index === 0 ? 72 : 246);
        assert.ok(frames.some(frame => frame.width > 72 && frame.width < 246), 'width must animate');
        for (const frame of frames) {
          assert.deepEqual(frame.icons, start.icons, 'icons should stay in place throughout the transition');
          assert.ok(!frame.earlyText, 'labels should fade before the edge clips their text');
          assert.ok(frame.aligned && frame.separated, 'sidebar controls should fit in the same row');
          assert.ok(frame.overviewTextFits, 'overview text must fit while visible');
        }
      }

      await page.emulateMedia({ reducedMotion: 'reduce' });
      await toggle.focus();
      await page.keyboard.press('Enter');
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      assert.equal(await page.locator('.sidebar').evaluate(sidebar => sidebar.offsetWidth), 72);
      await page.reload();
      assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await toggle.isHidden());
      const imageLink = page.getByRole('navigation', { name: '检测模块' }).getByRole('link', { name: /AI图片检测/ });
      await imageLink.click();
      await page.waitForURL('**/#/image');
      console.log(`${channel}: sidebar motion, saved state, reduced motion and mobile navigation passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}

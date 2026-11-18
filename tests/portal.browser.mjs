import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, rmdir } from 'node:fs/promises';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';
import { getDatabase } from '../src/server/db.js';

// Build dist first. All submissions below use an isolated database and invalid-example addresses.
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'veritas-portal-'));
process.env.VERITAS_DATA_DIR = dataDir;
const server = createServer({ dist: true, proxy: false });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const endpoint = base + '/api/v1/developer/applications';
const testPayload = {
  submissionId: randomUUID(),
  email: 'retry@example.invalid',
  organization: '接口预览测试',
  useCase: '验证重复提交只保留一条记录',
  volume: 'under-1000',
};
const send = (data, headers = {}) => fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(data),
});

try {
  assert.equal((await fetch(endpoint)).status, 405);
  assert.equal((await send(testPayload, { Origin: 'https://elsewhere.invalid' })).status, 403);
  assert.equal((await send({ ...testPayload, email: 'invalid' })).status, 422);
  assert.equal((await send(testPayload)).status, 201);
  assert.equal((await send(testPayload)).status, 200);
  assert.equal((await send({ ...testPayload, volume: 'undecided' })).status, 409);
  assert.equal(getDatabase().prepare('SELECT count(*) AS total FROM api_applications').get().total, 1);

  for (const [channel, width] of [['chrome', 1440], ['msedge', 390]]) {
    const browser = await chromium.launch({ channel });
    try {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const failures = [];
      const requests = [];
      page.on('pageerror', error => failures.push(error.message));
      page.on('request', req => requests.push(new URL(req.url()).pathname));
      await page.goto(base);
      await page.getByRole('heading', { name: /全模态\s*AI\s*内容\s*真实性检测平台/ }).waitFor();
      await page.locator('.portal-optic img').evaluate(image => image.decode());
      assert.equal(await page.locator('.portal-capability li a').count(), 10);
      assert.ok(!requests.includes('/assets/app.js'), 'homepage must not load workspace JS');
      assert.ok(!requests.includes('/assets/styles.css'), 'homepage must not load workspace CSS');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.equal(await page.locator('.portal-hero-strip').count(), 0);
      assert.match(await page.locator('.portal-footer small').innerText(), /Copyright © \d{4} VERITAS 智鉴 · 版权所有/);
      assert.equal(await page.locator('.portal-footer a[href*="beian.miit.gov.cn"]').count(), 0);
      const imageTab = page.getByRole('tab', { name: '图像生成检测' });
      await imageTab.click();
      assert.equal(await imageTab.getAttribute('aria-selected'), 'true');
      const imagePanel = page.getByRole('tabpanel', { name: '图像生成检测' });
      assert.equal(await imagePanel.getByRole('table').getByRole('row').count(), 10);
      assert.equal(await imagePanel.getByRole('columnheader', { name: '腾讯朱雀' }).count(), 1);
      assert.equal(await imagePanel.getByRole('row', { name: /^HunyuanImage 3.0/ }).getByRole('cell', { name: '88.86%' }).count(), 1);
      assert.equal(await imagePanel.getByRole('row', { name: /^Nano Banana 2.0/ }).getByRole('cell', { name: '10.26%' }).count(), 1);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await imageTab.focus();
      await page.keyboard.press('ArrowRight');
      const documentPanel = page.getByRole('tabpanel', { name: '票据一致性核验' });
      assert.match(await documentPanel.locator('.portal-bench-metric').innerText(), /8\/8/);
      await page.keyboard.press('Home');
      const textPanel = page.getByRole('tabpanel', { name: '文本生成检测' });
      assert.match(await textPanel.locator('.portal-bench-metric').innerText(), /95\.96%/);
      assert.equal(await textPanel.getByRole('row', { name: /^ChatGPT/ }).getByRole('cell', { name: '80.74%' }).count(), 1);
      const comparison = page.getByRole('table', { name: '平台能力对比表' });
      assert.equal(await comparison.getByRole('columnheader').count(), 6);
      assert.equal(await comparison.getByRole('row').count(), 8);

      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.locator('dialog[open]').waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('link', { name: '进入检测中心', exact: true }).click();
      await page.getByRole('heading', { name: '选择你的检测模块' }).waitFor();
      assert.equal(new URL(page.url()).hash, '#/');
      await page.goBack();
      await page.getByRole('heading', { name: /全模态\s*AI\s*内容\s*真实性检测平台/ }).waitFor();
      await page.getByRole('link', { name: '论文与学术稿件', exact: true }).click();
      await page.locator('.academic-workspace').waitFor();

      await page.getByRole('link', { name: '返回首页', exact: true }).click();
      await page.getByRole('heading', { name: /全模态\s*AI\s*内容\s*真实性检测平台/ }).waitFor();
      await page.getByRole('link', { name: '查看 API', exact: true }).click();
      await page.getByRole('heading', { name: 'API 中心' }).waitFor();
      const quickstart = page.getByRole('link', { name: '快速入门', exact: true }).first();
      await quickstart.click();
      await page.waitForURL('**/#/api/quickstart');
      assert.match(await page.locator('[data-catalog-command]').textContent(), /api\/v1\/catalog/);
      assert.deepEqual((await (await page.request.get(base + '/api/v1/catalog')).json()).counts, { modules: 4, scenarios: 10 });
      await page.getByRole('link', { name: '申请接入', exact: true }).first().click();
      await page.waitForURL('**/#/api/apply');
      await page.waitForFunction(() => {
        const header = document.querySelector('.portal-header').getBoundingClientRect().bottom;
        const title = document.querySelector('#portal-apply h2').getBoundingClientRect();
        return title.top >= header && title.bottom < innerHeight;
      });

      await page.getByLabel('联系邮箱').fill(channel + '@example.invalid');
      await page.getByLabel('组织或项目名称').fill('智鉴本地预览');
      await page.getByLabel('使用场景').fill('核对站内表单和保存结果');
      await page.getByLabel('预计月调用量').selectOption('undecided');
      await page.getByRole('button', { name: '提交申请' }).click();
      await page.getByRole('heading', { name: '申请已收到' }).waitFor();
      assert.equal(getDatabase().prepare('SELECT organization FROM api_applications WHERE email = ?').get(channel + '@example.invalid').organization, '智鉴本地预览');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(failures, []);

      if (channel === 'chrome') {
        const motionPage = await browser.newPage({ viewport: { width, height: 720 }, reducedMotion: 'no-preference' });
        await motionPage.goto(base);
        const targets = ['.portal-bench-shell', '.portal-capability', '.portal-market-panel'];
        await motionPage.locator(targets[0]).waitFor({ state: 'attached' });
        await motionPage.evaluate(selectors => {
          window.revealCounts = {};
          document.addEventListener('animationstart', event => {
            if (event.animationName !== 'portal-scroll-in') return;
            const selector = selectors.find(item => document.querySelector(item) === event.target);
            if (selector) window.revealCounts[selector] = (window.revealCounts[selector] || 0) + 1;
          });
        }, targets);
        for (const selector of targets) {
          const target = motionPage.locator(selector).first();
          for (const expectedCount of [1, 2]) {
            await motionPage.evaluate(() => window.scrollTo(0, 0));
            await motionPage.waitForFunction(query => document.querySelector(query)?.classList.contains('reveal-pending'), selector);
            await target.evaluate(element => element.scrollIntoView({ block: 'center' }));
            await motionPage.waitForFunction(({ query, expected }) => window.revealCounts[query] >= expected,
              { query: selector, expected: expectedCount });
          }
        }
        await motionPage.close();
      }

      console.log(`${channel} ${width}px: home, workspace history, existing scene, API and stored application passed`);
    } finally {
      await browser.close();
    }
  }
} finally {
  await new Promise(resolve => server.close(resolve));
  getDatabase().close();
  for (const suffix of ['', '-wal', '-shm']) await rm(path.join(dataDir, 'app.db' + suffix), { force: true });
  await rmdir(dataDir);
}

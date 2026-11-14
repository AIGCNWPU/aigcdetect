import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const newsText = '😀今天的天汽晴朗，记者走访社区，了解公共阅读空间的使用情况，并记录居民的真实意见。\n记者于12月31日再次走访，核对活动时间和参与人数，随后整理了相关采访材料。';
const textModelClient = { async analyze({ task, payload }) {
  if (task === 'novel_quality') {
    const evidence=payload.paragraphs.filter(p=>p.text.startsWith('第1条线索：')||p.text.startsWith('第2条线索：')).slice(0,3);
    return {findings:evidence.length===3?[{type:'repetition',severity:'warning',message:'三处证据需要一并复核。',suggestion:'结合三段上下文确认是否必要回顾。',confidence:.8,evidence:evidence.map(p=>({paragraphId:p.paragraphId,quote:p.text}))}]:[]};
  }
  if (task !== 'news_review') return { findings: [] };
  return { findings: payload.paragraphs.slice(0, 2).map((p, index) => ({ paragraphId: p.paragraphId, quote: index ? '12月31日' : '天汽', type: '表达核查', severity: 'warning', message: index ? '请核实日期' : '请核对用词', suggestion: index ? '与采访记录核对日期。' : '核对是否应写为天气。', confidence: .8 })) };
} };
const egteClient = { modelVersion: 'review-browser-fixture', thresholds: { humanMax: .5, aiMin: .8, dominanceMin: .6 }, async analyze({ segments }) {
  return segments.map((item, index) => ({ segmentId: item.segmentId, status: 'success', aiScore: index % 2 ? .12 : .88, predictedLabel: index % 2 ? 0 : 1, documentTokens: 40 }));
} };
const server = createServer({ dist: process.argv.includes('--dist'), textModelClient, egteClient }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = process.env.REVIEW_BROWSER_BASE || `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } }), errors = [];
let novelRequests = 0;
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/api/v1/text/novel')) novelRequests++; });
await mkdir('output/text-review', { recursive: true });

try {
  await page.goto(`${base}/#/text/news`);
  await page.getByLabel('稿件标题 *').fill('新闻复核浏览器测试');
  await page.getByLabel('稿件正文 *').fill(newsText);
  await page.getByRole('button', { name: '保存并开始检测' }).click();
  await page.locator('[data-result-status]').filter({ hasText: '已完成' }).waitFor();
  const ai = page.locator('[data-result-service-panel="ai-risk"]');
  assert.equal(await ai.locator('.text-review-original').textContent(), newsText);
  await ai.getByRole('button', { name: '定位原文', exact: true }).first().click();
  assert.ok(await ai.locator('.text-review-mark.is-active').count());
  await ai.locator('.text-review-mark.is-active').first().click();
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.dataset.reviewEntry)), true);
  await ai.getByRole('button', { name: '仅疑似AI', exact: true }).click();
  assert.equal(await ai.locator('.text-review-original').textContent(), newsText);
  assert.equal(await ai.locator('.text-review-mark.is-human').count(), 0);
  await ai.getByRole('button', { name: '全部显示', exact: true }).click();
  assert.ok(await ai.locator('.text-review-mark.is-human').count());

  await page.getByRole('tab', { name: '三审三校', exact: true }).click();
  const proof = page.locator('[data-result-service-panel="proofreading"]');
  const statuses = proof.getByLabel('问题处理状态', { exact: true });
  assert.equal(await statuses.count(), 12);
  assert.match(await proof.locator('.text-review-results>header').innerText(), /去重 2 条/);
  await statuses.first().selectOption('modified');
  assert.equal(await proof.locator('[data-review-state]').evaluateAll(nodes => nodes.filter(node => node.value === 'modified').length), 6);
  await statuses.nth(1).selectOption('verify');
  assert.equal(await proof.locator('[data-review-state]').evaluateAll(nodes => nodes.filter(node => node.value === 'verify').length), 6);
  await proof.getByLabel('按处理状态筛选').selectOption('pending');
  assert.equal(await proof.locator('[data-review-entry]:visible').count(), 0);
  assert.equal(await proof.locator('.text-review-mark').count(), 0);
  assert.ok(await proof.locator('.text-review-empty').last().isVisible());
  await proof.getByLabel('按处理状态筛选').selectOption('all');
  await statuses.first().selectOption('retained');
  assert.equal(await proof.locator('[data-review-state]').evaluateAll(nodes => nodes.filter(node => node.value === 'retained').length), 6);
  await proof.getByRole('button', { name: '定位原文', exact: true }).first().click();
  assert.equal(await proof.locator('.text-review-mark.is-active').first().textContent(), '天汽');
  await proof.getByRole('button', { name: '下一个问题', exact: true }).click();
  assert.equal(await proof.locator('.text-review-mark.is-active').first().textContent(), '12月31日');
  await page.getByRole('tab', { name: 'AI内容分析', exact: true }).click();
  await page.getByRole('tab', { name: '三审三校', exact: true }).click();
  assert.equal(await statuses.first().inputValue(), 'retained');
  await page.screenshot({ path: 'output/text-review/news-desktop.png', fullPage: true });

  await page.getByRole('tab', { name: '稿件提交', exact: true }).click();
  await page.getByLabel('稿件正文 *').fill('新稿已更换，但尚未提交检测。');
  await page.getByRole('tab', { name: '检测结果', exact: true }).click();
  assert.equal(await proof.locator('.text-review-original').textContent(), newsText);
  await page.getByRole('tab', { name: '稿件提交', exact: true }).click();
  await page.getByLabel('稿件正文 *').fill(newsText);
  await page.getByRole('checkbox', { name: /疑似AI风险/ }).uncheck();
  await page.getByRole('button', { name: '保存并开始检测' }).click();
  await page.locator('[data-result-status]').filter({ hasText: '已完成' }).waitFor();
  assert.ok(await proof.isVisible());
  assert.equal(await statuses.first().inputValue(), 'pending');

  await page.goto(`${base}/#/text/novel`);
  const repeated = Array.from({ length: 12 }, (_, i) => `第${i + 1}条线索：雨夜里众人终于回到城门前，守卫仔细核对每个人的姓名，随后打开城门，将所有人带进院落，安排他们先休息，再详细说明一路遇到的事情。`);
  const chapterTexts = [];
  for (const [i, title] of ['第一章 雨夜', '第二章 回城'].entries()) {
    const content = [`${title}：<img src=x onerror="window.reviewXss=1">这是本章独有的开场，交代人物所在位置和当时的行动。`, ...repeated, `${title}：这一章独有的结尾，人物决定在第二天清晨离开住处，开始新的旅程。`].join('\n'); chapterTexts.push(content);
    await page.getByLabel('作品名称 *').fill('跨章证据浏览器测试');
    await page.getByLabel('章节名称 *').fill(title); await page.getByLabel('章节正文', { exact: true }).fill(content);
    await page.getByRole('button', { name: '添加章节', exact: true }).click();
  }
  await page.getByRole('tab', { name: '章节检测', exact: true }).click();
  await page.getByRole('button', { name: '检测已选章节' }).click();
  await page.locator('[data-result-status]').filter({ hasText: '已完成' }).waitFor();
  const requestCount = novelRequests;
  const novelAi = page.locator('[data-result-service-panel="ai-risk"]');
  const toolbar = novelAi.locator('.text-review-source>header');
  await toolbar.scrollIntoViewIfNeeded();
  const toolbarY = (await toolbar.boundingBox()).y;
  for(let i=0;i<24;i++)await novelAi.getByRole('button',{name:'下一个问题',exact:true}).click();
  const box=await toolbar.boundingBox();
  assert.ok(box.y>=0&&box.y+box.height<=1100,'导航条应始终可见');
  assert.ok(Math.abs(box.y-toolbarY)<2,'导航不应使整页跳到原文中部');
  assert.ok(await novelAi.locator('.text-review-source-body').evaluate(node=>node.scrollTop>0));
  assert.ok(await novelAi.locator('.text-review-source-body').evaluate(node=>node.clientHeight<=440));
  await page.getByRole('tab', { name: '重复与水稿', exact: true }).click();
  const quality = page.locator('[data-result-service-panel="quality"]');
  assert.equal(await quality.locator('.text-review-evidence').count(), 13);
  assert.equal(await quality.locator('.text-review-evidence').last().locator('figure').count(), 3);
  const first = quality.locator('.text-review-evidence').first();
  assert.match(await first.innerText(), /跨章重复证据对照/);
  assert.equal(await first.locator('figure').count(), 2);
  assert.equal(await first.locator('mark').count(), 2);
  await first.locator('summary').first().click();
  assert.match(await first.locator('details p').first().innerText(), /本章独有的开场/);
  assert.equal(await quality.locator('.text-review-original img').count(), 0);
  assert.equal(await page.evaluate(() => window.reviewXss), undefined);
  assert.ok(await quality.locator('.text-review-problems').evaluate(node => node.scrollHeight > node.clientHeight));
  await page.getByRole('tab', { name: '第一章 雨夜', exact: true }).click();
  await quality.getByRole('button', { name: '定位第2侧原文', exact: true }).first().click();
  assert.equal(await page.getByRole('tab', { name: '第二章 回城', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await quality.locator('.text-review-document').getAttribute('data-review-document'), '2');
  assert.ok(await quality.locator('.text-review-mark.is-active').count());
  assert.equal(await quality.locator('.text-review-original').textContent(), chapterTexts[1]);
  await quality.locator('.text-review-mark.is-active').first().click();
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.dataset.reviewEntry)), true);
  assert.equal(novelRequests, requestCount);
  await page.screenshot({ path: 'output/text-review/novel-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await first.locator('.text-review-evidence-grid').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await quality.locator('.text-review-evidence').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'output/text-review/novel-mobile.png', fullPage: true });
  await page.getByRole('checkbox', { name: /章节.*AI.*风险/ }).uncheck();
  await page.getByRole('button', { name: '检测已选章节' }).click();
  await page.locator('[data-result-status]').filter({ hasText: '已完成' }).waitFor();
  assert.ok(await quality.isVisible());
  assert.equal(await quality.locator('.text-review-evidence').count(), 13);
  await page.reload(); await page.getByRole('tab', { name: '章节检测', exact: true }).click();
  assert.equal(await page.locator('.text-review-workspace:visible').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Text review browser test passed: source navigation, stage states, cross-chapter evidence, snapshots, filters and narrow layout');
} finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

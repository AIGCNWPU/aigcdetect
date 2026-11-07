import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, stat } from 'node:fs/promises';
import { chromium } from '../tmp/browser-check/node_modules/playwright/index.mjs';
import { createServer } from '../scripts/serve.mjs';

const server = createServer({ dist: process.env.VIDEO_TEST_DIST === '1' });
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
const errors = [];
const posts = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });

const visibleFrameCount = () => page.locator('.vg-frame-card:visible').count();
const currentTime = () => page.locator('[data-current-time]').innerText();
const recordSampleVideo = async () => {
  await mkdir('tmp/video-fixtures', { recursive: true });
  const context = await browser.newContext({
    recordVideo: { dir: 'tmp/video-fixtures', size: { width: 320, height: 180 } },
    viewport: { width: 320, height: 180 },
  });
  const recorderPage = await context.newPage();
  await recorderPage.setContent('<body style="margin:0"><div id="x" style="height:180px;display:grid;place-items:center;color:#fff;font:20px sans-serif;background:#234">QA video</div><script>let i=0;setInterval(()=>{i++;document.getElementById("x").style.background=`hsl(${i*12},50%,${30+i%40}%)`;document.getElementById("x").textContent="QA "+i},120)</script></body>');
  await recorderPage.waitForTimeout(2200);
  const video = recorderPage.video();
  await context.close();
  const path = await video.path();
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const info = await stat(path).catch(() => null);
    if (info && info.size > 0) return path;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('无法生成浏览器测试视频。');
};

try {
  await page.goto(`${base}/#/video/general`);
  await page.getByRole('heading', { name: '视频检测工作台', exact: true }).waitFor();
  await page.locator('.vg-player').waitFor();
  assert.equal(await page.locator('.vg-segment-card').count(), 3);
  assert.equal(await page.locator('.vg-frame-card').count(), 8);
  assert.match(await page.locator('.vg-sample-strip').innerText(), /样例数据/);
  assert.match(await page.locator('.vg-metrics').innerText(), /高风险/);
  assert.match(await page.locator('.vg-summary-panel').innerText(), /00:12.4/);
  await mkdir('docs/screenshots', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/video-general-desktop.jpg', type: 'jpeg', quality: 88, fullPage: true });

  // 点击可疑片段应定位到对应时间并高亮；键盘可继续调整时间轴。
  await page.locator('.vg-segment-card').first().getByRole('button').click();
  assert.equal(await currentTime(), '00:12.4');
  assert.equal(await page.locator('.vg-segment-card').first().getAttribute('data-active'), 'true');
  const timeline = page.locator('[data-timeline]');
  await timeline.focus();
  await timeline.press('ArrowRight');
  assert.equal(await currentTime(), '00:14.4');
  await page.locator('[data-play-toggle]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-current-time]')?.textContent || '';
    return text !== '00:14.4';
  });
  await page.locator('[data-play-toggle]').click();

  // 代表画面筛选只保留中/高风险画面。
  await page.getByLabel('仅看可疑画面', { exact: true }).check();
  assert.equal(await visibleFrameCount(), 3);
  await page.getByLabel('仅看可疑画面', { exact: true }).uncheck();
  assert.equal(await visibleFrameCount(), 8);

  // 低风险样例展示“未发现可疑时间段”，不伪造片段。
  await page.locator('.vg-task').filter({ hasText: '旅行vlog' }).click();
  await page.locator('.vg-summary-panel').waitFor();
  assert.equal(await page.locator('.vg-segment-card').count(), 0);
  assert.match(await page.locator('.vg-segments').innerText(), /未发现可定位的可疑时间段/);
  assert.match(await page.locator('.vg-summary-panel').innerText(), /低风险/);
  await page.locator('.vg-task').filter({ hasText: '品牌短片' }).click();

  // 上传浏览器录制的测试视频，未接入服务时只提示，不发送请求。
  const videoPath = await recordSampleVideo();
  await page.locator('input[type=file]').setInputFiles(videoPath);
  await page.locator('[data-file]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-file-fact-size]').innerText(), /×/);
  assert.match(await page.locator('[data-file-fact-duration]').innerText(), /^\d{2}:\d{2}$/);
  await page.getByRole('button', { name: '开始检测', exact: true }).click();
  await page.getByText('检测服务尚未接入，视频未提交。下方的样例结果仅用于界面预览，不代表真实检测。').waitFor();
  assert.equal(posts.length, 0);

  // 通过公开适配入口注入测试结果；进度、任务列表和结果均来自该返回值。
  await page.evaluate(() => {
    window.qaCalls = 0;
    window.Veritas.videoGeneralDetection.configure(async (input, { signal, onProgress }) => {
      window.qaCalls += 1;
      onProgress({ stage: '测试采样画面', percent: 45 });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 700);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
      const duration = input.metadata.duration;
      const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#2f5d62"/><text x="30" y="180" fill="#fff" font-size="24">QA sample frame</text></svg>')}`;
      return {
        risk: 'medium',
        summary: '测试服务返回：检测到一个需人工复核的片段。',
        coverage: 'partial',
        scope: '仅检测测试视频的前半段。',
        duration,
        sampledFrames: 3,
        findings: ['测试线索：局部纹理不连续。'],
        segments: [{ id: 'qa-segment', start: 0.1, end: Math.min(0.5, duration), risk: 'medium', summary: '测试片段：需要复核。', frameId: 'qa-frame' }],
        frames: [{ id: 'qa-frame', time: 0.2, risk: 'medium', caption: '测试代表画面', image }],
      };
    });
  });
  await page.getByRole('button', { name: '开始检测', exact: true }).click();
  await page.getByText('测试采样画面', { exact: true }).waitFor();
  await page.locator('.vg-summary-panel').waitFor();
  assert.equal(await page.evaluate(() => window.qaCalls), 1);
  assert.match(await page.locator('.vg-metrics').innerText(), /1 段/);
  assert.match(await page.locator('.vg-summary-panel').innerText(), /部分覆盖/);
  assert.match(await page.locator('.vg-task').first().innerText(), /已完成/);

  // 保存到本机与导出独立 HTML 报告。
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.getByText('报告记录已保存到本机浏览器。').waitFor();
  assert.equal(await page.evaluate(() => {
    const reports = JSON.parse(localStorage.getItem('veritas.video.general.reports.v1') || '[]');
    return reports.length;
  }), 1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报告', exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^VERITAS-视频检测报告-.*\.html$/);
  await download.saveAs('tmp/video-general-report.html');
  await page.getByText('报告已导出为 HTML 文件。').waitFor();

  // 取消后任务保留失败状态，可通过同一入口重新检测。
  await page.locator('input[type=file]').setInputFiles(videoPath);
  await page.locator('[data-file]').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.Veritas.videoGeneralDetection.configure((_input, { signal, onProgress }) => {
      onProgress({ stage: '等待取消', percent: 20 });
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({}), 5000);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    });
  });
  await page.getByRole('button', { name: '开始检测', exact: true }).click();
  await page.getByRole('button', { name: '取消检测', exact: true }).waitFor();
  await page.getByRole('button', { name: '取消检测', exact: true }).click();
  await page.getByText('本次检测已取消', { exact: true }).waitFor();
  assert.match(await page.locator('.vg-task').first().innerText(), /已取消/);
  await page.evaluate(() => {
    window.Veritas.videoGeneralDetection.configure(async (input, { onProgress }) => {
      onProgress({ stage: '重试完成', percent: 100 });
      return {
        risk: 'low', summary: '重试返回的测试结果。', coverage: 'full', scope: '测试视频全片。',
        duration: input.metadata.duration, sampledFrames: 1,
        findings: [], segments: [], frames: [{ id: 'retry-frame', time: 0, risk: 'low', caption: '重试代表画面', image: '' }],
      };
    });
  });
  await page.getByRole('button', { name: '重新检测', exact: true }).click();
  await page.getByText('重试返回的测试结果。', { exact: true }).waitFor();
  assert.match(await page.locator('.vg-metrics').innerText(), /低风险/);

  // 窄屏无横向溢出，使用新的页面避免会话内测试任务进入截图。
  await page.close();
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobilePage.on('pageerror', error => errors.push(error.message));
  mobilePage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mobilePage.goto(`${base}/#/video/general`);
  await mobilePage.getByRole('heading', { name: '视频检测工作台', exact: true }).waitFor();
  await mobilePage.locator('.vg-player').waitFor();
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await mobilePage.screenshot({ path: 'docs/screenshots/video-general-mobile.jpg', type: 'jpeg', quality: 88, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Video general browser QA passed: samples, timeline seek/play, filter, low-risk state, upload metadata, adapter progress/result, report save/export, cancel/retry, mobile width.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

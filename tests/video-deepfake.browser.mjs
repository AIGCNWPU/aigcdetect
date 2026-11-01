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

const visibleFaceCount = () => page.locator('.vd-face-card:visible').count();
const currentTime = () => page.locator('[data-current-time]').innerText();
const recordSampleVideo = async () => {
  await mkdir('tmp/video-fixtures', { recursive: true });
  const context = await browser.newContext({
    recordVideo: { dir: 'tmp/video-fixtures', size: { width: 320, height: 180 } },
    viewport: { width: 320, height: 180 },
  });
  const recorderPage = await context.newPage();
  await recorderPage.setContent('<body style="margin:0"><div id="x" style="height:180px;display:grid;place-items:center;color:#fff;font:20px sans-serif;background:#234">QA face video</div><script>let i=0;setInterval(()=>{i++;document.getElementById("x").style.background=`hsl(${i*12},50%,${30+i%40}%)`;document.getElementById("x").textContent="QA "+i},120)</script></body>');
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
  await page.goto(`${base}/#/video/deepfake`);
  await page.getByRole('heading', { name: '深度伪造检测工作台', exact: true }).waitFor();
  await page.locator('.vd-player').waitFor();

  // 双人样例：默认选中高风险人物 A，分别展示两人结果。
  assert.equal(await page.locator('.vd-person-card').count(), 2);
  assert.equal(await page.locator('.vd-segment-card').count(), 2);
  assert.equal(await page.locator('.vd-face-card').count(), 6);
  assert.match(await page.locator('.vd-sample-strip').innerText(), /样例数据/);
  assert.match(await page.locator('.vd-metrics').innerText(), /高风险/);
  assert.match(await page.locator('.vd-metrics').innerText(), /2 人/);
  assert.match(await page.locator('.vd-summary-panel').innerText(), /00:18.6/);
  assert.match(await page.locator('.vd-person-detail').innerText(), /人物 A · 左侧受访者/);
  assert.match(await page.locator('.vd-person-card').filter({ hasText: '人物 A' }).innerText(), /2 段可疑/);
  assert.match(await page.locator('.vd-person-card').filter({ hasText: '人物 B' }).innerText(), /0 段可疑/);
  await mkdir('docs/screenshots', { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/video-deepfake-desktop.jpg', type: 'jpeg', quality: 88, fullPage: true });

  // 切换人物 B：展示其低风险与“无可疑片段”状态，不沿用人物 A 的片段。
  await page.locator('.vd-person-card').filter({ hasText: '人物 B' }).click();
  assert.match(await page.locator('.vd-person-detail').innerText(), /人物 B · 右侧提问者/);
  assert.match(await page.locator('.vd-person-detail').innerText(), /该人物未发现可定位的可疑片段/);
  assert.equal(await page.locator('.vd-face-card').count(), 4);
  await page.locator('.vd-person-card').filter({ hasText: '人物 A' }).click();

  // 片段定位、键盘时间轴与样例播放。
  await page.locator('.vd-segment-card').first().getByRole('button').click();
  assert.equal(await currentTime(), '00:18.6');
  assert.equal(await page.locator('.vd-segment-card').first().getAttribute('data-active'), 'true');
  const timeline = page.locator('[data-timeline]');
  await timeline.focus();
  await timeline.press('ArrowRight');
  assert.equal(await currentTime(), '00:20.6');
  await page.locator('[data-play-toggle]').click();
  await page.waitForFunction(() => {
    const text = document.querySelector('[data-current-time]')?.textContent || '';
    return text !== '00:20.6';
  });
  await page.locator('[data-play-toggle]').click();

  // 仅看可疑人脸画面。
  await page.getByLabel('仅看可疑画面', { exact: true }).check();
  assert.equal(await visibleFaceCount(), 2);
  assert.match(await page.locator('[data-face-count]').innerText(), /2 \/ 6 张/);
  await page.getByLabel('仅看可疑画面', { exact: true }).uncheck();
  assert.equal(await visibleFaceCount(), 6);
  assert.match(await page.locator('[data-face-count]').innerText(), /6 张/);

  // 多人样例：3 位人物，人物 E 只有部分覆盖。
  await page.locator('.vd-task').filter({ hasText: '会议_多人画面' }).click();
  await page.locator('.vd-person-card').first().waitFor();
  assert.equal(await page.locator('.vd-person-card').count(), 3);
  assert.match(await page.locator('.vd-person-card').filter({ hasText: '人物 E' }).innerText(), /部分覆盖/);
  assert.match(await page.locator('.vd-summary-panel').innerText(), /部分覆盖/);
  assert.equal(await page.locator('.vd-segment-card').count(), 1);

  // 上传浏览器录制的测试视频；点击拖拽区即可选择文件，未接入服务时只提示，不发送请求。
  const videoPath = await recordSampleVideo();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('[data-drop]').click({ position: { x: 24, y: 24 } });
  const chooser = await chooserPromise;
  await chooser.setFiles(videoPath);
  await page.locator('[data-file]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-file-fact-size]').innerText(), /×/);
  assert.match(await page.locator('[data-file-fact-duration]').innerText(), /^\d{2}:\d{2}$/);
  assert.match(await page.locator('[data-file-meta]').innerText(), /材料版本 v/);
  await page.getByRole('button', { name: '开始检测', exact: true }).click();
  await page.getByText('检测服务尚未接入，视频未提交。样例结果仅用于界面预览，不代表真实检测。').waitFor();
  assert.equal(posts.length, 0);

  // 通过公开适配入口注入双人测试结果；进度、逐人结果和材料版本均来自该返回值。
  await page.evaluate(() => {
    window.qaCalls = 0;
    window.Veritas.videoDeepfakeDetection.configure(async (input, { signal, onProgress }) => {
      window.qaCalls += 1;
      onProgress({ stage: '测试识别人脸', percent: 45 });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 600);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
      const duration = input.metadata.duration;
      const end = Math.min(0.8, Math.max(0.2, duration - 0.1));
      const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="#2f5d62"/><text x="40" y="240" fill="#fff" font-size="28">QA face frame</text></svg>')}`;
      return {
        risk: 'high',
        summary: '测试服务返回：两位人物中一位存在待复核片段。',
        coverage: 'partial',
        scope: '仅检测测试视频前段。',
        duration,
        sampledFrames: 6,
        faceFrames: 5,
        findings: ['测试线索：人物 A 边缘细节异常。'],
        persons: [
          {
            id: 'qa-person-a', label: '人物 A · 测试对象', risk: 'high', coverage: 'full',
            summary: '测试人物 A 存在一个可疑片段。', firstSeen: 0, lastSeen: duration, faceFrames: 3,
            findings: ['测试人物线索。'],
            segments: [{ id: 'qa-segment', start: 0.1, end, risk: 'high', summary: '测试可疑片段。', signals: ['测试信号'], frameId: 'qa-frame-a' }],
            frames: [{ id: 'qa-frame-a', time: 0.2, risk: 'high', quality: 88, caption: '测试人脸画面 A', image }],
          },
          {
            id: 'qa-person-b', label: '人物 B · 测试对象', risk: 'low', coverage: 'partial',
            summary: '测试人物 B 仅在部分区间出现。', firstSeen: 0, lastSeen: Math.max(0.3, duration / 2), faceFrames: 2,
            findings: [],
            segments: [],
            frames: [{ id: 'qa-frame-b', time: 0.1, risk: 'low', quality: 90, caption: '测试人脸画面 B', image }],
          },
        ],
      };
    });
  });
  await page.getByRole('button', { name: '开始检测', exact: true }).click();
  await page.getByText('测试识别人脸', { exact: true }).waitFor();
  await page.getByText('测试服务返回：两位人物中一位存在待复核片段。', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.qaCalls), 1);
  assert.match(await page.locator('.vd-metrics').innerText(), /2 人/);
  assert.match(await page.locator('.vd-summary-panel').innerText(), /部分覆盖/);
  assert.match(await page.locator('[data-result-file]').innerText(), /材料版本 v/);
  assert.match(await page.locator('.vd-task').first().innerText(), /已完成/);
  assert.equal(await page.locator('.vd-person-card').count(), 2);

  // 保存到本机与导出独立 HTML 报告。
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await page.getByText('报告记录已保存到本机浏览器。').waitFor();
  assert.equal(await page.evaluate(() => {
    const reports = JSON.parse(localStorage.getItem('veritas.video.deepfake.reports.v1') || '[]');
    return reports.length;
  }), 1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出报告', exact: true }).click();
  const download = await downloadPromise;
  assert.match(download.suggestedFilename(), /^VERITAS-深度伪造检测报告-.*\.html$/);
  await download.saveAs('tmp/video-deepfake-report.html');
  await page.getByText('报告已导出为 HTML 文件。').waitFor();

  // 更换新材料后仍显示历史结果版本，并提示重新检测。
  const retakeVideoPath = await recordSampleVideo();
  await page.locator('input[type=file]').setInputFiles(retakeVideoPath);
  await page.locator('[data-version-note]').waitFor({ state: 'visible' });
  assert.match(await page.locator('[data-version-note]').innerText(), /历史结果仍对应材料版本/);
  assert.match(await page.locator('[data-version-note]').innerText(), /请重新检测/);

  // 取消后任务保留失败状态，可通过同一入口重新检测。
  await page.evaluate(() => {
    window.Veritas.videoDeepfakeDetection.configure((_input, { signal, onProgress }) => {
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
  assert.match(await page.locator('.vd-task').first().innerText(), /已取消/);
  await page.evaluate(() => {
    window.Veritas.videoDeepfakeDetection.configure(async (input, { onProgress }) => {
      onProgress({ stage: '重试完成', percent: 100 });
      return {
        risk: 'low', summary: '重试返回的测试结果。', coverage: 'full', scope: '测试视频全片。',
        duration: input.metadata.duration, sampledFrames: 1, faceFrames: 1,
        findings: [], persons: [{
          id: 'retry-person', label: '人物 R · 重试对象', risk: 'low', coverage: 'full',
          summary: '重试检测未发现明显合成线索。', firstSeen: 0, lastSeen: input.metadata.duration, faceFrames: 1,
          findings: [], segments: [],
          frames: [{ id: 'retry-frame', time: 0, risk: 'low', quality: 91, caption: '重试人脸画面', image: '' }],
        }],
      };
    });
  });
  await page.getByRole('button', { name: '重新检测', exact: true }).click();
  await page.getByText('重试返回的测试结果。', { exact: true }).waitFor();
  assert.match(await page.locator('.vd-metrics').innerText(), /低风险/);

  // 未识别人脸时显示“无法判断”，不输出低风险。
  await page.locator('input[type=file]').setInputFiles(videoPath);
  await page.locator('[data-file]').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.Veritas.videoDeepfakeDetection.configure(async input => ({
      risk: 'unknown',
      summary: '本次处理未识别到可用于检测的人脸画面。',
      coverage: 'partial',
      scope: '仅处理已采样画面；未识别人脸。',
      duration: input.metadata.duration,
      sampledFrames: 4,
      faceFrames: 0,
      findings: [],
      persons: [],
    }));
  });
  await page.getByRole('button', { name: '开始检测', exact: true }).click();
  await page.getByText('未识别到可用于检测的人物画面', { exact: true }).waitFor();
  assert.equal(await page.locator('.vd-person-card').count(), 0);
  assert.match(await page.locator('.vd-summary-panel').innerText(), /无法判断/);
  assert.match(await page.locator('.vd-no-persons').innerText(), /未检测到人脸不等于视频真实/);

  // 窄屏无横向溢出，使用新的页面避免会话内测试任务进入截图。
  await page.close();
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  mobilePage.on('pageerror', error => errors.push(error.message));
  mobilePage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await mobilePage.goto(`${base}/#/video/deepfake`);
  await mobilePage.getByRole('heading', { name: '深度伪造检测工作台', exact: true }).waitFor();
  await mobilePage.locator('.vd-player').waitFor();
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await mobilePage.screenshot({ path: 'docs/screenshots/video-deepfake-mobile.jpg', type: 'jpeg', quality: 88, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Video deepfake browser QA passed: multi-person samples, person switching, timeline seek/play, face filter, upload metadata, adapter progress/result, material version warning, report save/export, cancel/retry, no-face state, mobile width.');
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

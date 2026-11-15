import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAiScoringSegments } from '../src/modules/text/ai-segmentation.js';
import { EgteClient } from '../src/modules/text/egte-client.js';
import { loadServerEnv } from '../src/server/env.js';

loadServerEnv(fileURLToPath(new URL('../.env', import.meta.url)));

const DEFAULT_NEWS_URL = 'https://www.msn.cn/zh-cn/gaming/%E9%80%9A%E7%94%A8/blg%E5%92%8Cgen%E5%86%B3%E8%B5%9B%E5%89%8D%E6%95%B0%E6%8D%AE%E5%AF%B9%E5%86%B3%E5%87%BA%E7%82%89-%E4%B8%96%E4%B8%80%E4%B8%8A-%E6%95%B0%E6%8D%AE%E8%A2%AB%E5%85%A8%E9%9D%A2%E5%8E%8B%E5%88%B6-blg%E4%BB%85%E4%B8%80%E4%BA%BA%E6%98%AF%E4%BC%98%E5%8A%BF/ar-AA2h7xAt';
const DEFAULT_NOVEL_URL = 'https://mip.ciweimao.com/chapter/113775098';
const newsContent = [
  '本次启动自检使用一篇简短新闻稿验证文本分析链路。编辑部在上午完成材料核对，并确认标题、时间和主要事实均已写入稿件。',
  '随后，系统分别执行人工智能文本检测和三审三校。该内容只用于服务连通性验证，不作为真实新闻结论。',
].join('\n');
const repeatedParagraph = '夜色覆盖城市以后，值班人员再次核对设备状态和当天记录，确认各项数据都已经完整保存。';
const novelContent = `${repeatedParagraph}\n${repeatedParagraph}\n随后他走到窗边，开始思考下一步行动，但这一段仍需编辑检查是否包含有效情节推进。`;

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizedBase(value, fallback) {
  return String(value || fallback).replace(/\/+$/u, '');
}

function safeError(error) {
  return String(error?.message || error || '未知错误').replace(/\s+/gu, ' ').slice(0, 500);
}

async function requestJson(fetchImpl, url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = payload?.error?.code || `HTTP_${response.status}`;
      const message = payload?.error?.message || '服务返回失败状态';
      throw new Error(`${code}: ${message}`);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function post(fetchImpl, url, body, timeoutMs) {
  return requestJson(fetchImpl, url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, timeoutMs);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function createTextStackChecks({ fetchImpl = globalThis.fetch, env = process.env } = {}) {
  const main = normalizedBase(env.VERIFY_MAIN_URL, 'http://127.0.0.1:14173');
  const parser = normalizedBase(env.VERIFY_PARSER_URL, 'http://127.0.0.1:8013');
  const browser = normalizedBase(env.VERIFY_BROWSER_URL, 'http://127.0.0.1:8014');
  const egteEndpoint = String(env.EGTE_API_URL || 'http://127.0.0.1:8012/api/v1/infer/batch').trim();
  let defaultEgteHealth = 'http://127.0.0.1:8012/health';
  try { defaultEgteHealth = new URL('/health', egteEndpoint).href; } catch {}
  const egteHealth = String(env.VERIFY_EGTE_HEALTH_URL || defaultEgteHealth).trim();
  const egteClient = new EgteClient({ env: { ...env, EGTE_API_URL: egteEndpoint }, fetchImpl });
  const newsUrl = String(env.VERIFY_NEWS_URL || DEFAULT_NEWS_URL).trim();
  const novelUrl = String(env.VERIFY_NOVEL_URL || DEFAULT_NOVEL_URL).trim();
  const regularTimeout = positiveNumber(env.VERIFY_HTTP_TIMEOUT_MS, 180_000);
  const analysisTimeout = positiveNumber(env.VERIFY_ANALYSIS_TIMEOUT_MS, 1_200_000);
  const call = (url, options, timeout = regularTimeout) => requestJson(fetchImpl, url, options, timeout);
  const submit = (url, body, timeout = regularTimeout) => post(fetchImpl, url, body, timeout);

  return [
    { name: '14173 主服务健康', run: async () => {
      const payload = await call(`${main}/api/v1/health`);
      requireValue(payload.status === 'ok', '主服务未返回ok');
      return payload.mode || 'ok';
    } },
    { name: '8012 EGTE健康', run: async () => {
      const payload = await call(egteHealth, {}, 30_000);
      requireValue(payload.status === 'ok' || payload.ready === true, 'EGTE未就绪');
      return payload.service || 'egte-infer';
    } },
    { name: '8012 EGTE真实推理', run: async () => {
      const [result] = await egteClient.analyze({ classifier: 'cred', segments: [{ segmentId: 'verify-egte-1', text: '这是一段用于验证服务器人工智能文本检测算法能否正常完成推理的中文测试内容，长度已经超过最低要求。' }] });
      requireValue(result?.status === 'success' && Number.isFinite(Number(result.aiScore)), 'EGTE未返回有效分数');
      return `score=${Number(result.aiScore).toFixed(4)}`;
    } },
    { name: '8013 MinerU健康', run: async () => {
      const payload = await call(`${parser}/health`, {}, 30_000);
      requireValue(payload.status === 'ok' && payload.ready === true, 'MinerU代理未就绪');
      return payload.engine || 'mineru-cli';
    } },
    { name: '8013 MinerU真实解析', run: async () => {
      const html = `<html><head><title>启动自检文档</title></head><body><article><p>${newsContent}</p><p>${newsContent}</p></article></body></html>`;
      const payload = await submit(`${parser}/api/v1/html/parse`, { html, sourceUrl: 'https://example.com/veritas-startup-check' }, regularTimeout);
      requireValue(String(payload?.data?.text || '').length >= 60, 'MinerU未返回足够正文');
      return `${payload.data.text.length}字`;
    } },
    { name: '8014 浏览器健康', run: async () => {
      const payload = await call(`${browser}/health`, {}, 30_000);
      requireValue(payload.status === 'ok' && payload.ready === true, '浏览器渲染服务未就绪');
      return payload.version || payload.engine || 'ok';
    } },
    { name: '8014 浏览器真实渲染', run: async () => {
      const payload = await submit(`${browser}/api/v1/render`, { url: newsUrl }, regularTimeout);
      const data = payload?.data;
      requireValue(data && String(data.html || '').length >= 100, '浏览器未返回渲染页面');
      requireValue(String(data.readable?.text || '').length >= 80, '浏览器未识别到可读文章正文');
      return `${data.readable.text.length}字 · ${String(data.readable.title || data.title || '').slice(0, 40)}`;
    } },
    { name: '新闻链接导入', run: async () => {
      const payload = await submit(`${main}/api/v1/text/news/import`, { url: newsUrl }, regularTimeout);
      requireValue(String(payload?.data?.title || '').length >= 4, '新闻导入缺少标题');
      requireValue(String(payload?.data?.content || '').length >= 80, '新闻导入缺少正文');
      return `${payload.data.content.length}字 · ${payload.data.extractionMethod || 'static'}`;
    } },
    { name: '小说链接导入', run: async () => {
      const payload = await submit(`${main}/api/v1/text/novel/import`, { url: novelUrl }, regularTimeout);
      requireValue(String(payload?.data?.title || '').length >= 2, '小说导入缺少章节标题');
      requireValue(String(payload?.data?.content || '').length >= 60, '小说导入缺少章节正文');
      return `${payload.data.content.length}字 · ${payload.data.site || 'unknown'}`;
    } },
    { name: '新闻AI检测', run: async () => {
      const payload = await submit(`${main}/api/v1/text/news`, {
        action: 'analyze',
        material: { title: '启动自检新闻稿', content: newsContent, language: 'zh', aiSegments: createAiScoringSegments(newsContent, { prefix: 'verify-news-s' }) },
        checks: ['ai-risk'],
      }, analysisTimeout);
      requireValue(payload?.data?.aiRisk?.findings?.length > 0, '新闻AI检测未返回片段');
      return payload.data.aiRisk.summary;
    } },
    { name: '新闻三审三校', run: async () => {
      const payload = await submit(`${main}/api/v1/text/news`, {
        action: 'analyze', material: { title: '启动自检新闻稿', content: newsContent, language: 'zh' }, checks: ['proofreading'],
      }, analysisTimeout);
      requireValue(payload?.data?.proofreading?.stages?.length === 6, '三审三校未完整返回六个阶段');
      return payload.data.proofreading.summary;
    } },
    { name: '小说AI检测', run: async () => {
      const payload = await submit(`${main}/api/v1/text/novel`, {
        action: 'analyze', work: { title: '启动自检作品', language: 'zh' },
        chapters: [{ localId: 'verify-c1', title: '第一章', content: novelContent, platform: 'unknown', language: 'zh', aiSegments: createAiScoringSegments(novelContent, { prefix: 'verify-novel-s' }) }],
        checks: ['ai-risk'],
      }, analysisTimeout);
      requireValue(payload?.data?.aiRisk?.findings?.length > 0, '小说AI检测未返回片段');
      return payload.data.aiRisk.summary;
    } },
    { name: '小说重复与水稿检测', run: async () => {
      const payload = await submit(`${main}/api/v1/text/novel`, {
        action: 'analyze', work: { title: '启动自检作品', language: 'zh' },
        chapters: [{ localId: 'verify-c1', title: '第一章', content: novelContent, platform: 'unknown', language: 'zh' }],
        checks: ['repetition', 'padding'],
      }, analysisTimeout);
      requireValue(payload?.data?.quality && Array.isArray(payload.data.quality.findings), '重复与水稿检测未返回有效结果');
      return payload.data.quality.summary;
    } },
  ];
}

export async function runTextStackVerification(options = {}) {
  const checks = createTextStackChecks(options);
  const logger = options.logger || console;
  const results = [];
  logger.log(`VERITAS 文本功能启动自检：${checks.length} 项`);
  for (const check of checks) {
    const started = Date.now();
    try {
      const detail = await check.run();
      const result = { name: check.name, status: 'passed', durationMs: Date.now() - started, detail: String(detail || 'ok') };
      results.push(result);
      logger.log(`[通过] ${result.name} (${result.durationMs}ms) ${result.detail}`);
    } catch (error) {
      const result = { name: check.name, status: 'failed', durationMs: Date.now() - started, error: safeError(error) };
      results.push(result);
      logger.error(`[失败] ${result.name} (${result.durationMs}ms) ${result.error}`);
    }
  }
  const passed = results.filter(item => item.status === 'passed').length;
  const failed = results.length - passed;
  logger.log(`自检完成：通过 ${passed}/${results.length}，失败 ${failed}/${results.length}`);
  return { status: failed ? 'failed' : 'ok', passed, failed, total: results.length, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runTextStackVerification();
  if (result.failed) process.exitCode = 1;
}

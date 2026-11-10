import test from 'node:test';
import assert from 'node:assert/strict';
import { runTextStackVerification } from '../scripts/verify-text-stack.mjs';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('文本栈启动自检逐项执行且单项失败不阻断后续功能', async () => {
  const called = [];
  const fetchImpl = async (url, init = {}) => {
    const pathname = new URL(url).pathname;
    const body = init.body ? JSON.parse(init.body) : {};
    called.push(`${init.method || 'GET'} ${pathname}`);
    if (url.includes(':8012') && pathname === '/health') return response({ status: 'ok', ready: true });
    if (url.includes(':8012')) return response({ data: { results: [{ ai_score: 0.12, predicted_label: 0 }] } });
    if (url.includes(':8013') && pathname === '/health') return response({ status: 'ok', ready: true, engine: 'mineru-cli' });
    if (url.includes(':8013')) return response({ error: { code: 'PARSER_FAILED', message: '模拟MinerU失败' } }, 502);
    if (url.includes(':8014') && pathname === '/health') return response({ status: 'ok', ready: true, version: 'test' });
    if (url.includes(':8014')) return response({ data: { title: '新闻标题', html: '<html><article>正文</article></html>'.repeat(5), readable: { title: '新闻标题', text: '公开新闻正文内容。'.repeat(20) } } });
    if (pathname === '/api/v1/health') return response({ status: 'ok', mode: 'development' });
    if (pathname.endsWith('/news/import')) return response({ data: { title: '新闻标题', content: '公开新闻正文内容。'.repeat(20), extractionMethod: 'browser-rendered' } });
    if (pathname.endsWith('/novel/import')) return response({ data: { title: '第一章', content: '公开小说章节正文。'.repeat(20), site: 'ciweimao' } });
    if (pathname.endsWith('/news') && body.checks?.includes('ai-risk')) return response({ data: { aiRisk: { summary: '新闻AI完成', findings: [{}] } } });
    if (pathname.endsWith('/news')) return response({ data: { proofreading: { summary: '六阶段完成', stages: Array.from({ length: 6 }, () => ({})) } } });
    if (pathname.endsWith('/novel') && body.checks?.includes('ai-risk')) return response({ data: { aiRisk: { summary: '小说AI完成', findings: [{}] } } });
    if (pathname.endsWith('/novel')) return response({ data: { quality: { summary: '水稿检测完成', findings: [] } } });
    return response({ error: { code: 'NOT_FOUND', message: pathname } }, 404);
  };
  const output = [];
  const result = await runTextStackVerification({
    fetchImpl,
    env: {
      EGTE_API_URL: 'http://127.0.0.1:8012/api/v1/infer/batch',
      VERIFY_NEWS_URL: 'https://news.example/item',
      VERIFY_NOVEL_URL: 'https://novel.example/chapter',
    },
    logger: { log: value => output.push(value), error: value => output.push(value) },
  });
  assert.equal(result.total, 13);
  assert.equal(result.passed, 12);
  assert.equal(result.failed, 1);
  assert.equal(result.results.find(item => item.name === '8013 MinerU真实解析').status, 'failed');
  assert.equal(result.results.at(-1).name, '小说重复与水稿检测');
  assert.equal(result.results.at(-1).status, 'passed');
  assert.ok(called.includes('POST /api/v1/text/news'));
  assert.ok(called.includes('POST /api/v1/text/novel'));
  assert.match(output.at(-1), /通过 12\/13，失败 1\/13/);
});

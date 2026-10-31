import { TextAnalysisError } from './text-analysis-error.js';
import { normalizeAiThresholds } from './ai-aggregation.js';

const DEFAULT_API_URL = 'http://127.0.0.1:8011';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function unavailable(message = 'AI文本检测服务当前不可用。') {
  return new TextAnalysisError('AI_DETECTOR_UNAVAILABLE', message, 503);
}

function configuredEndpoint(value) {
  let endpoint;
  try { endpoint = new URL(value || DEFAULT_API_URL); } catch { throw unavailable('AI文本检测服务地址配置无效。'); }
  const loopback = LOOPBACK_HOSTS.has(endpoint.hostname);
  if (endpoint.username || endpoint.password || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback))) {
    throw unavailable('AI文本检测服务必须使用HTTPS，或使用本机回环HTTP地址。');
  }
  return endpoint;
}

function firstValue(item, ...keys) {
  for (const key of keys) if (item?.[key] !== undefined && item[key] !== null) return item[key];
  return undefined;
}

function responseResults(body, expectedCount) {
  if (Array.isArray(body)) return body;
  if (Array.isArray(body?.results)) return body.results;
  if (Array.isArray(body?.data)) return body.data;
  if (Array.isArray(body?.data?.results)) return body.data.results;
  if (expectedCount === 1 && body?.data && typeof body.data === 'object') return [body.data];
  throw unavailable('AI文本检测服务返回格式无效。');
}

function normalizedLabel(value, score) {
  if (value === undefined || value === null || value === '') return Number.isFinite(score) ? (score >= 0.5 ? 1 : 0) : null;
  const number = Number(value);
  if (number === 0 || number === 1) return number;
  const text = String(value ?? '').trim().toLowerCase();
  if (text.includes('human') || text.includes('人工')) return 0;
  if (text.includes('ai') || text.includes('机器')) return 1;
  return Number.isFinite(score) ? (score >= 0.5 ? 1 : 0) : null;
}

function normalizeResult(item, segment) {
  const score = Number(firstValue(item, 'aiScore', 'ai_score', 'score', 'probability'));
  const label = normalizedLabel(firstValue(item, 'predictedLabel', 'predicted_label', 'label'), score);
  const success = Number.isFinite(score) && (label === 0 || label === 1);
  const rawStatus = typeof item?.status === 'string' ? item.status.trim().toLowerCase().slice(0, 40) : '';
  const status = success && (!rawStatus || ['ok', 'completed', 'success'].includes(rawStatus)) ? 'success' : rawStatus || 'failed';
  const tokens = Number(firstValue(item, 'documentTokens', 'document_tokens', 'tokenCount', 'token_count'));
  return {
    segmentId: String(firstValue(item, 'segmentId', 'segment_id') || segment?.segmentId || ''),
    status,
    reason: success ? '' : String(item?.reason || '').trim().slice(0, 240),
    documentTokens: Number.isInteger(tokens) && tokens >= 0 ? tokens : null,
    aiScore: success ? score : null,
    predictedLabel: success ? label : null,
  };
}

export class EgteClient {
  constructor({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
    this.endpoint = configuredEndpoint(env.EGTE_API_URL?.trim());
    this.apiKey = env.EGTE_API_KEY?.trim() || '';
    this.modelVersion = env.EGTE_MODEL_VERSION?.trim() || 'EGTE_CRED_RAID_20261023';
    this.thresholds = normalizeAiThresholds({
      humanMax: env.EGTE_HUMAN_MAX_SCORE,
      aiMin: env.EGTE_AI_MIN_SCORE,
      dominanceMin: env.EGTE_DOMINANCE_MIN_RATIO,
    });
    this.timeoutMs = Number(env.EGTE_TIMEOUT_MS || 600_000);
    this.fetchImpl = fetchImpl;
  }

  async analyze({ classifier = 'cred', segments }) {
    if (!['cred', 'raid'].includes(classifier)) throw new TextAnalysisError('INVALID_CLASSIFIER', '不支持的AI文本分类器。', 400);
    if (!Array.isArray(segments) || !segments.length) throw new TextAnalysisError('INVALID_AI_SEGMENTS', 'AI文本检测片段不能为空。', 400);
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({ classifier, segments }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw unavailable('AI文本检测服务响应超时，请稍后重试。');
      throw unavailable();
    }
    if (!response?.ok) throw unavailable('AI文本检测服务调用失败。');
    let body;
    try { body = await response.json(); } catch { throw unavailable('AI文本检测服务返回格式无效。'); }
    if (body?.ok === false) throw unavailable('AI文本检测服务调用失败。');
    return responseResults(body, segments.length).map((item, index) => normalizeResult(item, segments[index]));
  }

  close() {}
}

let sharedClient;
export function createEgteClient(options) {
  if (options) return new EgteClient(options);
  sharedClient ||= new EgteClient();
  return sharedClient;
}

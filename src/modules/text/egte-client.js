import { TextAnalysisError } from './text-analysis-error.js';
import { normalizeAiThresholds } from './ai-aggregation.js';

const DEFAULT_API_URL = 'http://127.0.0.1:8012/api/v1/infer/batch';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MAX_TEXT_BATCH_SIZE = 200;
const MIN_TEXT_CHARACTERS = 20;
const ISOLATABLE_BATCH_STATUSES = new Set([400, 413, 422, 500]);

class IsolatableBatchError extends Error {}

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

function isTextBatchEndpoint(endpoint) {
  const path = endpoint.pathname.replace(/\/+$/u, '');
  return path.endsWith('/api/v1/infer/batch');
}

function requestBody(endpoint, classifier, segments) {
  if (isTextBatchEndpoint(endpoint)) return { classifier, texts: segments.map(item => item.text) };
  return { classifier, segments };
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

function tooShortResult(segment) {
  return normalizeResult({
    status: 'too-short',
    reason: '去除首尾空白后少于20个字符，无法可靠评分。',
  }, segment);
}

function isolatedFailureResult(segment) {
  return normalizeResult({
    status: 'failed',
    reason: '算法服务拒绝该片段，已隔离处理；其他片段继续评分。',
  }, segment);
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
    const configuredBatchSize = Number(env.EGTE_BATCH_SIZE);
    this.batchSize = Number.isInteger(configuredBatchSize) && configuredBatchSize > 0
      ? Math.min(configuredBatchSize, MAX_TEXT_BATCH_SIZE)
      : MAX_TEXT_BATCH_SIZE;
    const configuredIsolationRequests = Number(env.EGTE_ISOLATION_MAX_REQUESTS);
    this.isolationMaxRequests = Number.isInteger(configuredIsolationRequests) && configuredIsolationRequests >= 4
      ? Math.min(configuredIsolationRequests, 256)
      : 64;
    this.fetchImpl = fetchImpl;
  }

  async requestBatch(classifier, segments) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    let response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody(this.endpoint, classifier, segments)),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw unavailable('AI文本检测服务响应超时，请稍后重试。');
      throw unavailable();
    }
    if (!response?.ok) {
      if (isTextBatchEndpoint(this.endpoint) && ISOLATABLE_BATCH_STATUSES.has(response?.status)) throw new IsolatableBatchError();
      throw unavailable('AI文本检测服务调用失败。');
    }
    let body;
    try { body = await response.json(); } catch { throw unavailable('AI文本检测服务返回格式无效。'); }
    if (body?.ok === false) throw unavailable('AI文本检测服务调用失败。');
    const results = responseResults(body, segments.length);
    if (results.length !== segments.length) throw unavailable('AI文本检测服务返回的结果数量不一致。');
    return results.map((item, index) => normalizeResult(item, segments[index]));
  }

  async requestBatchWithIsolation(classifier, segments, state = { requests: 0 }) {
    if (state.requests >= this.isolationMaxRequests) {
      throw unavailable('AI文本检测服务连续拒绝多个批次，已停止异常片段隔离。');
    }
    state.requests += 1;
    try {
      return await this.requestBatch(classifier, segments);
    } catch (error) {
      if (!(error instanceof IsolatableBatchError)) throw error;
      if (segments.length === 1) return [isolatedFailureResult(segments[0])];
      const middle = Math.ceil(segments.length / 2);
      const left = await this.requestBatchWithIsolation(classifier, segments.slice(0, middle), state);
      const right = await this.requestBatchWithIsolation(classifier, segments.slice(middle), state);
      return [...left, ...right];
    }
  }

  async analyze({ classifier = 'cred', segments }) {
    if (!['cred', 'raid'].includes(classifier)) throw new TextAnalysisError('INVALID_CLASSIFIER', '不支持的AI文本分类器。', 400);
    if (!Array.isArray(segments) || !segments.length) throw new TextAnalysisError('INVALID_AI_SEGMENTS', 'AI文本检测片段不能为空。', 400);
    if (!isTextBatchEndpoint(this.endpoint)) return this.requestBatch(classifier, segments);
    const results = new Array(segments.length);
    const scoreable = [];
    segments.forEach((segment, index) => {
      if ([...String(segment?.text || '').trim()].length < MIN_TEXT_CHARACTERS) results[index] = tooShortResult(segment);
      else scoreable.push({ index, segment });
    });
    for (let offset = 0; offset < scoreable.length; offset += this.batchSize) {
      const entries = scoreable.slice(offset, offset + this.batchSize);
      const batchResults = await this.requestBatchWithIsolation(classifier, entries.map(item => item.segment));
      batchResults.forEach((result, index) => { results[entries[index].index] = result; });
    }
    return results;
  }

  close() {}
}

let sharedClient;
export function createEgteClient(options) {
  if (options) return new EgteClient(options);
  sharedClient ||= new EgteClient();
  return sharedClient;
}

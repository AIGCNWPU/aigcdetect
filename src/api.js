import { scenarios } from './catalog.js';

// 空基址 = 同源请求，由 scripts/serve.mjs 代理到后端（避免只开前端隧道时打到浏览器本机 8010）。
// 可通过 api.configure({ baseUrl: 'http://host:8010' }) 直连后端。
const DEFAULT_API_BASE_URL = '';

/** 后续后端对接只需设置 api.configure({ baseUrl: 'https://your-api.example' })。
 * 业务页面默认不发请求。当前配套服务器的业务接口统一返回 HTTP 501。
 * 身份认证由正式后端接入；请勿在前端配置密钥。
 */
export const api = {
  baseUrl: DEFAULT_API_BASE_URL,
  configure({ baseUrl = '' } = {}) { this.baseUrl = baseUrl.replace(/\/$/, ''); },
  endpoint(scenarioPath) {
    const scenario = scenarios.find(item => item.path === scenarioPath);
    if (!scenario) throw new Error(`Unknown scenario: ${scenarioPath}`);
    return scenario.api;
  },
  async invoke(scenarioPath, payload = {}, { signal } = {}) {
    const endpoint = this.endpoint(scenarioPath);
    const url = new URL(this.baseUrl + endpoint.path, globalThis.location?.origin || 'http://localhost');
    const options = { method: endpoint.method, signal, headers: { Accept: 'application/json' } };
    if (endpoint.method === 'GET') {
      for (const [key, value] of Object.entries(payload)) if (value !== undefined) url.searchParams.set(key, String(value));
    } else {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    const response = await fetch(url, options);
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error?.message || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = data.error?.code;
      error.details = data;
      throw error;
    }
    return data;
  },
};

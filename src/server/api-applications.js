import { getDatabase } from './db.js';

export const API_APPLICATION_PATH = '/api/v1/developer/applications';
const volumes = new Set(['under-1000', '1000-10000', 'over-10000', 'undecided']);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function invalid(field, message) {
  return { status: 422, error: { code: 'INVALID_APPLICATION', field, message } };
}

export function saveApiApplication(payload) {
  const data = payload && typeof payload === 'object' ? payload : {};
  const { submissionId, volume } = data;
  const email = typeof data.email === 'string' ? data.email.trim() : '';
  const organization = typeof data.organization === 'string' ? data.organization.trim() : '';
  const useCase = typeof data.useCase === 'string' ? data.useCase.trim() : '';
  if (typeof submissionId !== 'string' || !uuid.test(submissionId)) return invalid(null, '申请编号无效，请刷新页面后再试。');
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) return invalid('email', '请输入有效的联系邮箱。');
  if (!organization || organization.length > 120) return invalid('organization', '请输入组织或项目名称，最多 120 字。');
  if (!useCase || useCase.length > 1200) return invalid('useCase', '请输入使用场景，最多 1200 字。');
  if (!volumes.has(volume)) return invalid('volume', '请选择预计调用量。');

  const id = submissionId.toLowerCase();
  const db = getDatabase();
  const createdAt = new Date().toISOString();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const inserted = db.prepare(`
    INSERT INTO api_applications (id, email, organization, use_case, monthly_volume, created_at)
    SELECT ?, ?, ?, ?, ?, ?
    WHERE (SELECT count(*) FROM api_applications WHERE lower(email) = lower(?) AND created_at >= ?) < 5
    ON CONFLICT(id) DO NOTHING
  `).run(id, email, organization, useCase, volume, createdAt, email, cutoff);
  if (inserted.changes) return { status: 201, data: { id } };

  const existing = db.prepare('SELECT email, organization, use_case, monthly_volume FROM api_applications WHERE id = ?').get(id);
  if (existing?.email === email && existing.organization === organization && existing.use_case === useCase && existing.monthly_volume === volume) {
    return { status: 200, data: { id } };
  }
  if (existing) return { status: 409, error: { code: 'SUBMISSION_CONFLICT', message: '申请内容已更新，请再次提交。' } };
  return { status: 429, error: { code: 'APPLICATION_LIMIT', message: '此邮箱今日提交的申请较多，请稍后再试。' } };
}

/**
 * 账号与会话：注册、登录、退出、当前用户、检测记录。
 *
 * 只用标准库：scrypt 做密码哈希，随机 32 字节做会话号，库里只存它的 SHA-256。
 */
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDatabase } from './db.js';

const SESSION_COOKIE = 'veritas_session';
const SESSION_DAYS = 30;
const SIGNUP_BONUS = 100;
const USERNAME_RE = /^[\w\u4e00-\u9fa5.-]{3,20}$/u;
const MIN_PASSWORD = 6;

const attempts = new Map();

function now() { return new Date().toISOString(); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  response.end(JSON.stringify(body));
}

async function readJson(request, maxBytes = 64 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('请求过大'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw Object.assign(new Error('请求体不是合法 JSON'), { status: 400 }); }
}

function parseCookies(header = '') {
  const out = {};
  for (const part of String(header).split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    try { out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch { /* Ignore malformed cookies. */ }
  }
  return out;
}

function cookieHeader(sid, secure) {
  const base = `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
  return secure ? `${base}; Secure` : base;
}

function isSecure(request) {
  return request.headers['x-forwarded-proto'] === 'https' || Boolean(request.socket?.encrypted);
}

export function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password, salt, expected) {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const wanted = Buffer.from(expected, 'hex');
  return actual.length === wanted.length && timingSafeEqual(actual, wanted);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    credits: Number(row.credits) || 0,
    createdAt: row.created_at,
  };
}

export function currentUser(request) {
  const sid = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (!sid) return null;
  const db = getDatabase();
  const row = db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid_hash = ? AND s.expires_at > ?`).get(sha256(sid), now());
  if (!row || row.status !== 'active') return null;
  return publicUser(row);
}

function createSession(userId) {
  const db = getDatabase();
  const sid = randomBytes(32).toString('hex');
  const created = now();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (sid_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha256(sid), userId, created, expires);
  return sid;
}

function destroySession(request) {
  const sid = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (sid) getDatabase().prepare('DELETE FROM sessions WHERE sid_hash = ?').run(sha256(sid));
}

function tooManyAttempts(key) {
  const entry = attempts.get(key);
  if (!entry) return false;
  if (Date.now() > entry.until) { attempts.delete(key); return false; }
  return entry.count >= 5;
}

function noteFailure(key) {
  const entry = attempts.get(key) || { count: 0, until: Date.now() + 15 * 60_000 };
  entry.count += 1;
  entry.until = Date.now() + 15 * 60_000;
  attempts.set(key, entry);
}

function register(body, response, request) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!USERNAME_RE.test(username)) return sendJson(response, 400, { error: { code: 'INVALID_USERNAME', message: '用户名需 3–20 位，可用中英文、数字、下划线' } });
  if (password.length < MIN_PASSWORD) return sendJson(response, 400, { error: { code: 'WEAK_PASSWORD', message: `密码至少 ${MIN_PASSWORD} 位` } });

  const db = getDatabase();
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return sendJson(response, 409, { error: { code: 'USERNAME_TAKEN', message: '该用户名已被注册' } });
  }

  const id = randomUUID();
  const salt = randomBytes(16).toString('hex');
  const created = now();
  db.prepare('INSERT INTO users (id, username, password_hash, salt, credits, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, username, hashPassword(password, salt), salt, SIGNUP_BONUS, 'active', created);
  db.prepare('INSERT INTO credit_ledger (id, user_id, delta, reason, ref_id, balance_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), id, SIGNUP_BONUS, 'signup_bonus', null, SIGNUP_BONUS, created);

  const sid = createSession(id);
  return sendJson(response, 200, { user: { id, username, credits: SIGNUP_BONUS, createdAt: created } }, { 'Set-Cookie': cookieHeader(sid, isSecure(request)) });
}

function login(body, response, request) {
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  const ip = request.headers['cf-connecting-ip'] || request.socket?.remoteAddress || 'unknown';
  const key = `${ip}:${username}`;
  if (tooManyAttempts(key)) return sendJson(response, 429, { error: { code: 'TOO_MANY_ATTEMPTS', message: '尝试次数过多，请 15 分钟后再试' } });

  const db = getDatabase();
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!row || row.status !== 'active' || !verifyPassword(password, row.salt, row.password_hash)) {
    noteFailure(key);
    return sendJson(response, 401, { error: { code: 'BAD_CREDENTIALS', message: '用户名或密码不正确' } });
  }
  attempts.delete(key);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), row.id);

  const sid = createSession(row.id);
  return sendJson(response, 200, { user: publicUser(row) }, { 'Set-Cookie': cookieHeader(sid, isSecure(request)) });
}

export function recordDetection(userId, { scene, path: routePath, status = 'succeeded', summary = '' }) {
  if (!userId) return;
  try {
    getDatabase().prepare('INSERT INTO detections (id, user_id, scene, path, status, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), userId, String(scene).slice(0, 40), String(routePath || '').slice(0, 120), String(status).slice(0, 20), String(summary || '').slice(0, 300), now());
  } catch { /* 记录失败不影响检测 */ }
}

function listDetections(userId, { page = 1, limit = 10 } = {}) {
  const db = getDatabase();
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 10)));
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM detections WHERE user_id = ?').get(userId)?.n) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Math.trunc(Number(page) || 1)));
  const offset = (currentPage - 1) * pageSize;
  const detections = db.prepare('SELECT id, scene, status, summary, created_at FROM detections WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(userId, pageSize, offset);
  return { detections, total, page: currentPage, pageSize, totalPages };
}

function ledger(userId, limit = 20) {
  return getDatabase().prepare('SELECT delta, reason, balance_after, created_at FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, Math.min(100, Math.max(1, Number(limit) || 20)));
}

/** 返回 true 表示这条请求已经被本模块处理。 */
export async function handleAuthRequest(request, response, pathname) {
  const method = request.method;
  try {
    if (pathname === '/api/v1/auth/me' && method === 'GET') {
      const user = currentUser(request);
      return sendJson(response, 200, { user }), true;
    }
    if (pathname === '/api/v1/auth/register' && method === 'POST') {
      return register(await readJson(request), response, request), true;
    }
    if (pathname === '/api/v1/auth/login' && method === 'POST') {
      return login(await readJson(request), response, request), true;
    }
    if (pathname === '/api/v1/auth/logout' && method === 'POST') {
      destroySession(request);
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Set-Cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` });
      response.end(JSON.stringify({ ok: true }));
      return true;
    }
    if (pathname === '/api/v1/me/detections' && method === 'GET') {
      const user = currentUser(request);
      if (!user) return sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录' } }), true;
      const url = new URL(request.url, 'http://localhost');
      const limit = url.searchParams.get('pageSize') ?? url.searchParams.get('limit') ?? 10;
      const page = url.searchParams.get('page') ?? 1;
      return sendJson(response, 200, listDetections(user.id, { page, limit })), true;
    }
    if (pathname === '/api/v1/me/detections' && method === 'POST') {
      const user = currentUser(request);
      if (!user) return sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录' } }), true;
      const body = await readJson(request);
      recordDetection(user.id, { scene: body.scene, status: body.status, summary: body.summary });
      return sendJson(response, 200, { ok: true }), true;
    }
    if (pathname === '/api/v1/me/credits' && method === 'GET') {
      const user = currentUser(request);
      if (!user) return sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录' } }), true;
      return sendJson(response, 200, { credits: user.credits, ledger: ledger(user.id) }), true;
    }
    return false;
  } catch (error) {
    if (!response.writableEnded) sendJson(response, error?.status || 500, { error: { code: 'AUTH_ERROR', message: error?.message || '账号服务异常' } });
    return true;
  }
}

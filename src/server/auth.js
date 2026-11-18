/**
 * 账号、会话与积分系统：注册、登录、退出、当前用户、每次检测积分扣减与统一积分明细。
 *
 * 只用标准库：scrypt 做密码哈希，随机 32 字节做会话号，库里只存它的 SHA-256。
 */
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { getDatabase } from './db.js';

const SESSION_COOKIE = 'veritas_session';
const SESSION_DAYS = 30;
const SIGNUP_BONUS = 100;
export const DETECTION_CREDIT_COST = 1;
const USERNAME_RE = /^[\w\u4e00-\u9fa5.-]{3,20}$/u;
const MIN_PASSWORD = 6;
const RUN_ID_RE = /^[A-Za-z0-9._:-]{6,80}$/;

const attempts = new Map();
const activeCharges = new Map();

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
  const row = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.sid_hash = ? AND s.expires_at > ?').get(sha256(sid), now());
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
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO users (id, username, password_hash, salt, credits, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, username, hashPassword(password, salt), salt, SIGNUP_BONUS, 'active', created);
    db.prepare('INSERT INTO credit_ledger (id, user_id, delta, reason, ref_id, balance_after, created_at, scene, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), id, SIGNUP_BONUS, 'signup_bonus', null, SIGNUP_BONUS, created, null, '新用户注册赠送积分');
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }

  const sid = createSession(id);
  return sendJson(
    response,
    200,
    { user: { id, username, credits: SIGNUP_BONUS, createdAt: created } },
    { 'Set-Cookie': cookieHeader(sid, isSecure(request)), 'X-Veritas-Credits': String(SIGNUP_BONUS) },
  );
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
  const user = publicUser(row);
  return sendJson(
    response,
    200,
    { user },
    { 'Set-Cookie': cookieHeader(sid, isSecure(request)), 'X-Veritas-Credits': String(user.credits) },
  );
}

export function recordDetection(userId, { scene, path: routePath, status = 'succeeded', summary = '' }) {
  if (!userId) return;
  try {
    getDatabase().prepare('INSERT INTO detections (id, user_id, scene, path, status, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), userId, String(scene).slice(0, 40), String(routePath || '').slice(0, 120), String(status).slice(0, 20), String(summary || '').slice(0, 300), now());
  } catch { /* 记录失败不影响检测 */ }
}

function refundDetectionCharge(entry) {
  if (entry.refunded) return;
  entry.refunded = true;
  try {
    const db = getDatabase();
    db.exec('BEGIN IMMEDIATE');
    try {
      const existing = db.prepare('SELECT id FROM credit_ledger WHERE id = ?').get(entry.ledgerId);
      if (existing) {
        db.prepare('DELETE FROM credit_ledger WHERE id = ?').run(entry.ledgerId);
        db.prepare('DELETE FROM detections WHERE id = ?').run(entry.detectionId);
        db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(entry.cost, entry.userId);
        db.prepare('UPDATE credit_ledger SET balance_after = balance_after + ? WHERE user_id = ? AND created_at >= ?')
          .run(entry.cost, entry.userId, entry.createdAt);
      }
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    }
  } catch { /* 忽略已关闭数据库的异常 */ }
}

/**
 * 为一次「开始检测」原子预扣积分（默认消耗 1 积分），并在同一按钮批次（runId）的多个子请求间幂等复用。
 * 若整个批次全部失败（如后端未启动、参数校验未过），自动退回预扣的积分。
 */
export function beginDetectionCharge(userId, { scene, path: routePath = '', summary = '', runId = '', cost = DETECTION_CREDIT_COST } = {}) {
  if (!userId) {
    return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: '请先登录或注册后再开始检测（新用户注册即赠 100 积分）', credits: 0 };
  }
  const safeCost = Math.max(1, Math.trunc(Number(cost) || DETECTION_CREDIT_COST));
  const safeScene = String(scene || 'detection').slice(0, 40);
  const safePath = String(routePath || '').slice(0, 120);
  const safeSummary = String(summary || '').slice(0, 300);
  const cleanRunId = typeof runId === 'string' && RUN_ID_RE.test(runId.trim()) ? runId.trim() : '';
  const chargeKey = cleanRunId ? `${userId}:${cleanRunId}` : '';

  const db = getDatabase();

  if (chargeKey && activeCharges.has(chargeKey)) {
    const active = activeCharges.get(chargeKey);
    active.inFlight += 1;
    let settled = false;
    const latest = Number(db.prepare('SELECT credits FROM users WHERE id = ?').get(userId)?.credits) ?? active.credits;
    return {
      ok: true,
      reused: true,
      credits: latest,
      finish(succeeded) {
        if (settled) return;
        settled = true;
        if (succeeded) active.anySucceeded = true;
        active.inFlight = Math.max(0, active.inFlight - 1);
        if (active.inFlight === 0) {
          activeCharges.delete(chargeKey);
          if (!active.anySucceeded) refundDetectionCharge(active);
        }
      },
    };
  }

  const refKey = cleanRunId ? `run:${cleanRunId}` : null;
  if (refKey) {
    const already = db.prepare('SELECT id FROM credit_ledger WHERE user_id = ? AND ref_id = ?').get(userId, refKey);
    if (already) {
      const latest = Number(db.prepare('SELECT credits FROM users WHERE id = ?').get(userId)?.credits) || 0;
      return { ok: true, reused: true, credits: latest, finish() {} };
    }
  }

  const detectionId = randomUUID();
  const ledgerId = randomUUID();
  const createdAt = now();
  let balanceAfter = 0;

  db.exec('BEGIN IMMEDIATE');
  try {
    const userRow = db.prepare('SELECT id, credits, status FROM users WHERE id = ?').get(userId);
    if (!userRow || userRow.status !== 'active') {
      db.exec('ROLLBACK');
      return { ok: false, status: 401, code: 'UNAUTHENTICATED', message: '账号状态无效，请重新登录', credits: 0 };
    }
    const currentCredits = Number(userRow.credits) || 0;
    if (currentCredits < safeCost) {
      db.exec('ROLLBACK');
      return {
        ok: false,
        status: 402,
        code: 'INSUFFICIENT_CREDITS',
        message: `账户可用积分不足（当前剩余 ${currentCredits} 积分，每次检测需消耗 ${safeCost} 积分）`,
        credits: currentCredits,
      };
    }
    balanceAfter = currentCredits - safeCost;
    db.prepare('UPDATE users SET credits = ? WHERE id = ?').run(balanceAfter, userId);
    db.prepare('INSERT INTO detections (id, user_id, scene, path, status, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(detectionId, userId, safeScene, safePath, 'succeeded', safeSummary, createdAt);
    db.prepare('INSERT INTO credit_ledger (id, user_id, delta, reason, ref_id, balance_after, created_at, scene, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(ledgerId, userId, -safeCost, 'detection', refKey || detectionId, balanceAfter, createdAt, safeScene, safeSummary);
    db.exec('COMMIT');
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }

  const entry = {
    userId,
    detectionId,
    ledgerId,
    cost: safeCost,
    credits: balanceAfter,
    createdAt,
    inFlight: 1,
    anySucceeded: false,
    refunded: false,
  };
  if (chargeKey) activeCharges.set(chargeKey, entry);

  let settled = false;
  return {
    ok: true,
    reused: false,
    credits: balanceAfter,
    finish(succeeded) {
      if (settled) return;
      settled = true;
      if (succeeded) entry.anySucceeded = true;
      entry.inFlight = Math.max(0, entry.inFlight - 1);
      if (entry.inFlight === 0) {
        if (chargeKey) activeCharges.delete(chargeKey);
        if (!entry.anySucceeded) refundDetectionCharge(entry);
      }
    },
  };
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

function listCreditLedger(userId, { page = 1, limit = 10 } = {}) {
  const db = getDatabase();
  const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(limit) || 10)));
  const total = Number(db.prepare('SELECT COUNT(*) AS n FROM credit_ledger WHERE user_id = ?').get(userId)?.n) || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(totalPages, Math.max(1, Math.trunc(Number(page) || 1)));
  const offset = (currentPage - 1) * pageSize;
  const ledger = db.prepare(`
    SELECT
      l.id,
      l.delta,
      l.reason,
      COALESCE(l.scene, d.scene) AS scene,
      COALESCE(NULLIF(l.summary, ''), d.summary, '') AS summary,
      l.balance_after,
      l.created_at
    FROM credit_ledger l
    LEFT JOIN detections d ON d.id = l.ref_id
    WHERE l.user_id = ?
    ORDER BY l.created_at DESC, l.rowid DESC
    LIMIT ? OFFSET ?
  `).all(userId, pageSize, offset);
  return { ledger, total, page: currentPage, pageSize, totalPages };
}

/** 返回 true 表示这条请求已经被本模块处理。 */
export async function handleAuthRequest(request, response, pathname, { enforceCredits = false } = {}) {
  const method = request.method;
  try {
    if (pathname === '/api/v1/auth/me' && method === 'GET') {
      const user = currentUser(request);
      const headers = { 'X-Veritas-Require-Auth': enforceCredits ? '1' : '0' };
      if (user) headers['X-Veritas-Credits'] = String(user.credits);
      return sendJson(response, 200, { user }, headers), true;
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
      return sendJson(response, 200, listDetections(user.id, { page, limit }), { 'X-Veritas-Credits': String(user.credits) }), true;
    }
    if (pathname === '/api/v1/me/detections' && method === 'POST') {
      const user = currentUser(request);
      if (!user) {
        if (!enforceCredits) return sendJson(response, 200, { ok: true, guest: true }), true;
        return sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录或注册后再开始检测（新用户注册即赠 100 积分）' } }), true;
      }
      const body = await readJson(request);
      if (body.consumeCredit !== false) {
        const runId = body.runId || request.headers['x-veritas-run-id'] || '';
        const charge = beginDetectionCharge(user.id, {
          scene: body.scene,
          path: body.path || '',
          summary: body.summary || '',
          runId,
        });
        if (!charge.ok) {
          return sendJson(response, charge.status, { error: { code: charge.code, message: charge.message }, credits: charge.credits }, { 'X-Veritas-Credits': String(charge.credits) }), true;
        }
        charge.finish(true);
        return sendJson(response, 200, { ok: true, credits: charge.credits }, { 'X-Veritas-Credits': String(charge.credits) }), true;
      }
      recordDetection(user.id, { scene: body.scene, status: body.status, summary: body.summary });
      return sendJson(response, 200, { ok: true, credits: user.credits }, { 'X-Veritas-Credits': String(user.credits) }), true;
    }
    if (pathname === '/api/v1/me/credits' && method === 'GET') {
      const user = currentUser(request);
      if (!user) return sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: '请先登录' } }), true;
      const url = new URL(request.url, 'http://localhost');
      const limit = url.searchParams.get('pageSize') ?? url.searchParams.get('limit') ?? 10;
      const page = url.searchParams.get('page') ?? 1;
      const paged = listCreditLedger(user.id, { page, limit });
      return sendJson(response, 200, { credits: user.credits, ...paged }, { 'X-Veritas-Credits': String(user.credits) }), true;
    }
    return false;
  } catch (error) {
    if (!response.writableEnded) sendJson(response, error?.status || 500, { error: { code: 'AUTH_ERROR', message: error?.message || '账号服务异常' } });
    return true;
  }
}

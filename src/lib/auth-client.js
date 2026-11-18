/**
 * 前端账号与积分：会话状态、登录/注册浮窗、检测前积分守卫、实时余额同步与个人中心统一明细。
 */
import { icon } from '../icons.js';
import { BRAND_SLOGAN, renderBrandWordmark } from './brand-wordmark.js';

const state = { user: null, loading: false, requireAuthForDetection: false };

// 登录态本地缓存：路由切换时先用缓存同步渲染，避免左下角从「本地用户」闪成「游客」
const CACHE_KEY = 'veritas.auth.user';
try {
  const cached = globalThis.localStorage?.getItem(CACHE_KEY);
  if (cached) state.user = JSON.parse(cached);
} catch { /* 隐私模式或 Node 环境下忽略 */ }

let sessionLoaded = false;
let sessionRequest = null;

const DIAMOND_SVG = '<svg class="me-diamond" viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M7 1.2 12.8 7 7 12.8 1.2 7 7 1.2Z" fill="currentColor" fill-opacity=".22" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"/></svg>';

function persistUser() {
  try {
    if (state.user) globalThis.localStorage?.setItem(CACHE_KEY, JSON.stringify(state.user));
    else globalThis.localStorage?.removeItem(CACHE_KEY);
  } catch { /* 忽略写入失败 */ }
}

function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function style() {
  if (typeof document === 'undefined' || document.querySelector('#auth-style')) return;
  const css = `
.sidebar-user{display:flex;flex-direction:column;gap:3px;min-width:0}.sidebar-user strong{font-size:13.5px;color:#1d2433;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sidebar-user span{font-size:12px;color:#6e7785;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.user-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#e8f1ff;color:#0875e8;flex-shrink:0}.user-avatar svg{width:17px;height:17px}
.sidebar-footer:focus-visible{outline:2px solid #0875e8;outline-offset:4px;border-radius:12px}
.topbar-user{display:none;align-items:center;gap:7px;border:1px solid #dce5f2;background:#ffffffcc;color:#24324a;border-radius:999px;padding:6px 12px 6px 8px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;transition:background .16s,border-color .16s}
.topbar-user:hover{background:#fff;border-color:#b8d0f2;color:#0875e8}
.topbar-user-avatar{display:grid;place-items:center;width:22px;height:22px;border-radius:50%;background:#e8f1ff;color:#0875e8;font-size:12px;font-weight:700;flex-shrink:0}
.topbar-user-avatar svg{width:14px;height:14px}
.topbar-user-avatar.has-user{background:linear-gradient(135deg,#0875e8,#0058b8);color:#fff}
@media(max-width:760px){.topbar-user{display:inline-flex}}
.auth-dialog{border:0;padding:0;background:transparent;max-width:100vw}
.auth-dialog::backdrop{background:rgba(18,26,42,.42);backdrop-filter:blur(4px)}
.auth-card{position:relative;width:368px;max-width:92vw;padding:28px 26px 22px;border-radius:20px;background:#fff;box-shadow:0 24px 70px rgba(20,34,62,.24);border:1px solid #e2e8f2;color:#1d2433}
.auth-head{display:flex;align-items:center;gap:11px;margin-bottom:8px}
.auth-head img{width:34px;height:34px;object-fit:contain;flex-shrink:0;filter:drop-shadow(0 2px 5px rgba(18,73,168,.16))}
.auth-brand-copy{display:flex;flex-direction:column;gap:3px;min-width:0}
.auth-brand-row{display:flex;align-items:center;gap:8px;line-height:1}
.auth-head strong{font-size:16px;font-weight:750;letter-spacing:.08em;color:#132542}
.auth-brand-sep{width:1px;height:14px;background:linear-gradient(180deg,rgba(19,37,66,.1),rgba(19,37,66,.32),rgba(19,37,66,.1))}
.auth-brand-wordmark{display:inline-flex;align-items:center}
.auth-brand-wordmark .brand-wordmark-svg{height:21px;width:auto;display:block}
.auth-brand-slogan{font-size:12px;font-weight:500;letter-spacing:.14em;color:#5a6d87;line-height:1.2}
.auth-sub{font-size:13px;color:#6e7785;margin:6px 0 18px;line-height:1.5}
.auth-tabs{display:flex;gap:6px;padding:4px;background:#f0f4fa;border-radius:11px;margin-bottom:16px}
.auth-tabs button{flex:1;border:0;background:transparent;padding:8px 10px;border-radius:8px;font:inherit;font-size:13px;color:#647082;cursor:pointer;transition:background .15s,color .15s}
.auth-tabs button[aria-selected=true]{background:#fff;color:#0875e8;font-weight:650;box-shadow:0 1px 4px rgba(18,54,108,.1)}
.auth-field{display:block;margin-bottom:13px}
.auth-field span{display:block;font-size:13px;font-weight:500;color:#4f5b6d;margin-bottom:6px}
.auth-field input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #d7e0ec;border-radius:10px;font:inherit;font-size:14px;background:#fbfcfe;color:#1d2433}
.auth-field input:focus{outline:none;border-color:#0875e8;box-shadow:0 0 0 3px rgba(8,117,232,.14);background:#fff}
.auth-error{min-height:18px;font-size:12.5px;color:#b4432f;margin:2px 0 10px}
.auth-submit{width:100%;padding:11px 14px;border:0;border-radius:10px;background:linear-gradient(135deg,#0875e8,#005ec4);box-shadow:0 6px 16px rgba(8,117,232,.22);color:#fff;font:inherit;font-size:14px;font-weight:650;cursor:pointer;transition:transform .15s,background .15s}
.auth-submit:hover:not([disabled]){transform:translateY(-1px)}
.auth-submit[disabled]{opacity:.6;cursor:wait}
.auth-close{position:absolute;top:12px;right:12px;width:30px;height:30px;border:0;border-radius:50%;background:#f1f5fb;color:#5f6b7b;cursor:pointer;font-size:17px;line-height:1;transition:background .15s,color .15s}
.auth-close:hover{background:#e4ecf8;color:#172235}
.auth-foot{font-size:12px;color:#8590a0;text-align:center;margin-top:14px}
.user-avatar.has-user{background:linear-gradient(135deg,#0875e8,#0058b8);color:#fff;font-weight:650;font-size:13px}
.me-shell{display:flex;flex-direction:column;gap:0}
.me-workspace{padding:26px;color:#1f2a3d;border:1px solid #fff;border-radius:24px;background:#ffffffb8;box-shadow:0 8px 28px #273b6407}
.me-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px 24px;border:1px solid #dde8f8;border-radius:16px;background:linear-gradient(120deg,#eef5ff,#f9fbff);margin-bottom:18px}
.me-head h2{margin:0 0 6px;font-size:22px;color:#172235}
.me-head p{margin:0;font-size:13px;color:#6c788a}
.me-credits{text-align:right;flex-shrink:0}
.me-credits-val{display:inline-flex;align-items:center;justify-content:flex-end;gap:7px;color:#0875e8}
.me-credits-val .me-diamond{width:18px;height:18px;flex-shrink:0}
.me-credits strong{font-size:30px;font-weight:720;color:#0875e8;font-variant-numeric:tabular-nums;line-height:1.1}
.me-credits span{display:block;margin-top:4px;font-size:12px;color:#6c788a}
.me-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.me-card{border:1px solid #e6edf7;border-radius:16px;background:#fff;padding:20px}
.me-card h3{margin:0 0 12px;font-size:16px;font-weight:650;color:#172235}
.me-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.me-card-head h3{margin:0}
.me-page-meta{font-size:12.5px;color:#738198;font-variant-numeric:tabular-nums}
.me-list{list-style:none;margin:0;padding:0;display:grid;gap:9px}
.me-list li{display:flex;gap:14px;align-items:center;justify-content:space-between;padding:13px 15px;border:1px solid #edf1f7;border-radius:12px;font-size:13px;background:#fcfdff;transition:border-color .15s,background .15s}
.me-list li:hover{border-color:#d8e5f7;background:#f7faff}
.me-item-main{display:flex;flex-direction:column;gap:5px;min-width:0}
.me-item-title{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}
.me-tag{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;line-height:1.4;flex-shrink:0}
.me-tag.is-plus{background:#e9f8ef;color:#1f7a4c}
.me-tag.is-minus{background:#eef4ff;color:#0875e8}
.me-record-link{display:inline-flex;align-items:center;gap:6px;font-weight:600;color:#1e293b;text-decoration:none}
.me-record-link:hover{color:#0875e8}
.me-record-link svg{width:14px;height:14px;color:#8b98ab;flex-shrink:0}
.me-record-link:hover svg{color:#0875e8}
.me-list b{font-weight:600;color:#1e293b}
.me-item-meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:12px;color:#7e8a9b;font-variant-numeric:tabular-nums}
.me-item-delta{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex-shrink:0;text-align:right;font-variant-numeric:tabular-nums}
.me-delta{display:inline-flex;align-items:center;gap:4px;font-size:14.5px;font-weight:700;line-height:1.2}
.me-delta.is-plus{color:#1f7a4c}
.me-delta.is-minus{color:#1e293b}
.me-delta .me-diamond{width:11px;height:11px;opacity:.85}
.me-item-delta small{font-size:12px;color:#7e8a9b}
.me-empty{font-size:13px;color:#7e8a9b;padding:18px;text-align:center;border:1px dashed #dce5f2;border-radius:12px;background:#fafcff}
.me-pager{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid #eef2f7}
.me-pager[hidden]{display:none}
.me-pager-info{font-size:12.5px;color:#7e8a9b;font-variant-numeric:tabular-nums}
.me-pager-btns{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-left:auto}
.me-page-btn{min-width:34px;height:34px;padding:0 11px;border:1px solid #dce4ef;border-radius:8px;background:#fff;color:#42526b;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;font-variant-numeric:tabular-nums;transition:background .15s,border-color .15s,color .15s}
.me-page-btn:hover:not(:disabled):not([aria-current=page]){background:#f2f7ff;border-color:#c2d7f5;color:#0875e8}
.me-page-btn[aria-current=page]{background:#0875e8;border-color:#0875e8;color:#fff;font-weight:650;cursor:default}
.me-page-btn:disabled{opacity:.45;cursor:not-allowed;background:#fafbfd}
.me-page-ellipsis{padding:0 4px;color:#9aa5b4;font-size:12.5px;user-select:none}
.me-actions-foot{display:flex;align-items:center;justify-content:flex-end;margin-top:16px}
.me-logout{border:1px solid #d5e0ee;background:#fff;color:#3d526f;border-radius:10px;padding:9px 16px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s,border-color .15s,color .15s}
.me-logout:hover{background:#f3f7fc;border-color:#0875e8;color:#0875e8}
@media(max-width:560px){.me-head{flex-direction:column;align-items:flex-start}.me-credits{text-align:left}.me-credits-val{justify-content:flex-start}.me-list li{align-items:flex-start}}
`;
  document.head.append(el(`<style id="auth-style">${css}</style>`));
}

function dialogMarkup() {
  return `<dialog class="auth-dialog" data-auth-dialog aria-label="登录或注册">
    <form class="auth-card" method="dialog" data-auth-form>
      <button type="button" class="auth-close" data-auth-close aria-label="关闭">×</button>
      <div class="auth-head"><img src="./public/brand-logo.png?v=5" alt=""><div class="auth-brand-copy"><div class="auth-brand-row"><strong>VERITAS</strong><i class="auth-brand-sep" aria-hidden="true"></i><span class="auth-brand-wordmark">${renderBrandWordmark('auth')}<span class="sr-only">智鉴</span></span></div><span class="auth-brand-slogan">${BRAND_SLOGAN}</span></div></div>
      <p class="auth-sub">登录后自动同步账户积分与检测明细，每次检测消耗 1 积分。</p>
      <div class="auth-tabs" role="tablist">
        <button type="button" role="tab" data-auth-mode="login" aria-selected="true">登录</button>
        <button type="button" role="tab" data-auth-mode="register" aria-selected="false">注册</button>
      </div>
      <label class="auth-field"><span>用户名</span><input name="username" autocomplete="username" required maxlength="20" placeholder="3–20 位，可用中英文与数字"></label>
      <label class="auth-field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required minlength="6" maxlength="64" placeholder="至少 6 位"></label>
      <p class="auth-error" data-auth-error role="alert"></p>
      <button type="submit" class="auth-submit" data-auth-submit>登录</button>
      <p class="auth-foot">新用户注册即赠 100 积分</p>
    </form>
  </dialog>`;
}

let dialog = null;
let mode = 'login';

export function openAuthDialog(initial = 'login', promptMessage = '') {
  if (typeof document === 'undefined') return;
  style();
  if (!dialog) {
    dialog = el(dialogMarkup());
    document.body.append(dialog);
    dialog.addEventListener('click', event => {
      if (event.target === dialog) dialog.close();
      const close = event.target.closest('[data-auth-close]');
      if (close) dialog.close();
      const tab = event.target.closest('[data-auth-mode]');
      if (tab) setMode(tab.dataset.authMode);
    });
    dialog.querySelector('[data-auth-form]').addEventListener('submit', submit);
  }
  setMode(initial);
  if (promptMessage) {
    dialog.querySelector('[data-auth-error]').textContent = promptMessage;
  }
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('input[name="username"]')?.focus();
}

function setMode(next) {
  mode = next;
  dialog.querySelectorAll('[data-auth-mode]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.authMode === mode)));
  dialog.querySelector('[data-auth-submit]').textContent = mode === 'login' ? '登录' : '注册';
  dialog.querySelector('[data-auth-error]').textContent = '';
  const password = dialog.querySelector('input[name="password"]');
  password.setAttribute('autocomplete', mode === 'login' ? 'current-password' : 'new-password');
}

async function submit(event) {
  event.preventDefault();
  if (state.loading) return;
  const form = event.currentTarget;
  const username = form.querySelector('input[name="username"]').value.trim();
  const password = form.querySelector('input[name="password"]').value;
  const errorHost = dialog.querySelector('[data-auth-error]');
  const button = dialog.querySelector('[data-auth-submit]');
  state.loading = true;
  button.disabled = true;
  errorHost.textContent = '';
  try {
    const response = await fetch(`/api/v1/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error?.message || '操作失败，请稍后再试。');
    state.user = body.user;
    sessionLoaded = true;
    persistUser();
    dialog.close();
    form.reset();
    refreshUserUI();
    if (location.hash.replace(/^#/, '') === '/me') renderMePage(document.querySelector('[data-me-page]'));
  } catch (error) {
    errorHost.textContent = error.message;
  } finally {
    state.loading = false;
    button.disabled = false;
  }
}

async function logout() {
  await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null;
  sessionLoaded = true;
  persistUser();
  refreshUserUI();
  if (location.hash.replace(/^#/, '') === '/me') renderMePage(document.querySelector('[data-me-page]'));
}

export function currentAuthUser() { return state.user; }

export function syncAuthCredits(nextCredits) {
  const num = Number(nextCredits);
  if (!state.user || !Number.isFinite(num)) return;
  state.user.credits = Math.max(0, Math.trunc(num));
  persistUser();
  if (typeof document !== 'undefined') {
    refreshUserUI();
    const meVal = document.querySelector('[data-me-balance]');
    if (meVal) meVal.textContent = String(state.user.credits);
  }
}

export function syncCreditsFromHeaders(headers) {
  if (!headers) return;
  const raw = typeof headers.get === 'function' ? headers.get('x-veritas-credits') : headers['x-veritas-credits'];
  if (raw !== null && raw !== undefined && raw !== '') {
    syncAuthCredits(Number(raw));
  }
}

export function handleDetectionHttpError(status, errorBody) {
  const code = errorBody?.error?.code || errorBody?.code;
  const msg = errorBody?.error?.message || errorBody?.message || '';
  if (errorBody?.credits !== undefined) {
    syncAuthCredits(errorBody.credits);
  }
  if (status === 401 || code === 'UNAUTHENTICATED') {
    state.user = null;
    persistUser();
    if (typeof document !== 'undefined') {
      refreshUserUI();
      openAuthDialog('login', msg || '请先登录或注册后再开始检测（新用户注册即赠 100 积分）');
    }
  }
}

/**
 * 检测前同步校验：
 * - 若站点启用强制积分登录且当前未登录，弹出登录/注册窗口并阻断本次请求；
 * - 若当前已登录但可用积分不足 1，抛出明确提示阻止无效上传。
 */
export function ensureDetectionAllowed(cost = 1) {
  if (typeof document === 'undefined') return true;
  if (!state.user) {
    if (state.requireAuthForDetection) {
      openAuthDialog('login', '请先登录或注册后再开始检测（新用户注册即赠 100 积分）');
      return false;
    }
    return true;
  }
  if ((Number(state.user.credits) || 0) < cost) {
    throw new Error(`账户可用积分不足（当前剩余 ${Number(state.user.credits) || 0} 积分，每次检测需消耗 ${cost} 积分）`);
  }
  return true;
}

/** 供前端本地样本检测（如音频样例点击「开始检测」）调用服务端扣减 1 积分并记录明细。 */
export async function consumeClientDetectionCredit(scene, summary = '') {
  if (typeof document === 'undefined') return true;
  if (!ensureDetectionAllowed(1)) return false;
  if (!state.user && !state.requireAuthForDetection) return true;
  const response = await fetch('/api/v1/me/detections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ scene, summary, consumeCredit: true }),
  });
  syncCreditsFromHeaders(response.headers);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    handleDetectionHttpError(response.status, body);
    if (response.status === 401) return false;
    throw new Error(body?.error?.message || '积分扣减失败，请稍后重试。');
  }
  if (body.credits !== undefined) syncAuthCredits(body.credits);
  return true;
}

function refreshUserUI() {
  if (typeof document === 'undefined') return;
  const footer = document.querySelector('.sidebar-footer');
  if (footer) {
    const name = footer.querySelector('.sidebar-user strong');
    const role = footer.querySelector('.sidebar-user span');
    const avatar = footer.querySelector('.user-avatar');
    if (name && role && avatar) {
      if (state.user) {
        const initial = state.user.username.slice(0, 1).toUpperCase();
        name.textContent = state.user.username;
        role.textContent = `${state.user.credits} 积分 · 个人中心`;
        avatar.textContent = initial;
        avatar.classList.add('has-user');
        avatar.setAttribute('role', 'img');
        avatar.setAttribute('aria-label', `${state.user.username} 的头像`);
      } else {
        name.textContent = '游客';
        role.textContent = '登录 / 注册';
        avatar.innerHTML = icon('user');
        avatar.classList.remove('has-user');
        avatar.removeAttribute('role');
        avatar.removeAttribute('aria-label');
      }
    }
  }
  const topBtn = document.querySelector('[data-topbar-user]');
  if (topBtn) {
    const topAvatar = topBtn.querySelector('.topbar-user-avatar');
    const topLabel = topBtn.querySelector('[data-topbar-user-label]');
    if (state.user) {
      const initial = state.user.username.slice(0, 1).toUpperCase();
      if (topAvatar) {
        topAvatar.textContent = initial;
        topAvatar.classList.add('has-user');
      }
      if (topLabel) topLabel.textContent = `${state.user.username} · ${state.user.credits}`;
    } else {
      if (topAvatar) {
        topAvatar.innerHTML = icon('user');
        topAvatar.classList.remove('has-user');
      }
      if (topLabel) topLabel.textContent = '登录';
    }
  }
}

/** 同步渲染当前登录态（不发起请求），路由切换时调用，避免闪烁 */
export function paintAuth() {
  if (typeof document === 'undefined') return;
  style();
  bindSidebarEntry();
  refreshUserUI();
}

function handleAccountAction() {
  if (state.user) location.hash = '#/me';
  else openAuthDialog('login');
}

function bindSidebarEntry() {
  const footer = document.querySelector('.sidebar-footer');
  if (footer && !footer.dataset.authBound) {
    footer.dataset.authBound = '1';
    footer.style.cursor = 'pointer';
    footer.setAttribute('role', 'button');
    footer.setAttribute('tabindex', '0');
    footer.addEventListener('click', event => {
      if (event.target.closest('[data-sidebar-settings]')) return;
      handleAccountAction();
    });
    footer.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleAccountAction();
      }
    });
  }
  const topBtn = document.querySelector('[data-topbar-user]');
  if (topBtn && !topBtn.dataset.authBound) {
    topBtn.dataset.authBound = '1';
    topBtn.addEventListener('click', () => handleAccountAction());
  }
}

/** 只在页面首次加载时校验一次会话；之后用内存/本地缓存 */
export function initAuth() {
  paintAuth();
  if (sessionRequest) return sessionRequest;
  if (sessionLoaded) return Promise.resolve(state.user);
  sessionRequest = fetch('/api/v1/auth/me', { headers: { Accept: 'application/json' } })
    .then(async response => {
      state.requireAuthForDetection = response.headers.get('x-veritas-require-auth') === '1';
      const body = await response.json();
      state.user = body.user || null;
      persistUser();
      refreshUserUI();
      return state.user;
    })
    .catch(() => state.user)
    .finally(() => {
      sessionLoaded = true;
      sessionRequest = null;
    });
  return sessionRequest;
}

export async function refreshAuthSession() {
  try {
    const response = await fetch('/api/v1/auth/me', { headers: { Accept: 'application/json' } });
    state.requireAuthForDetection = response.headers.get('x-veritas-require-auth') === '1';
    const body = await response.json();
    state.user = body.user || null;
    persistUser();
    refreshUserUI();
    return state.user;
  } catch {
    return state.user;
  }
}

function buildPageItems(current, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '…', totalPages];
  if (current >= totalPages - 3) return [1, '…', totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, '…', current - 1, current, current + 1, '…', totalPages];
}

export async function renderMePage(host) {
  if (!host) return;
  const shellHead = `<nav class="breadcrumbs" aria-label="面包屑"><a href="#/">模块总览</a>${icon('chevron')}<span aria-current="page">个人中心</span></nav>
    <header class="detail-heading"><span class="feature-symbol" style="--accent:#0875e8;--tint:#e8f1ff">${icon('user')}</span><div><h1>个人中心</h1></div><a class="quiet-back" href="#/">${icon('arrow')}<span>返回模块总览</span></a></header>`;
  if (!state.user) {
    host.innerHTML = `<div class="me-shell">${shellHead}<div class="me-workspace"><div class="me-card"><h3>尚未登录</h3><p class="me-empty">登录后即可查看账户可用积分与积分使用明细。</p><div class="me-actions-foot"><button type="button" class="me-logout" data-me-login>立即登录</button></div></div></div></div>`;
    host.querySelector('[data-me-login]')?.addEventListener('click', () => openAuthDialog('login'));
    return;
  }
  const PAGE_SIZE = 10;
  const user = state.user;
  const escapeText = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
  host.innerHTML = `<div class="me-shell">${shellHead}<div class="me-workspace">
    <div class="me-head"><div><h2>${escapeText(user.username)}</h2><p>注册日期：${new Date(user.createdAt).toLocaleDateString('zh-CN')} · 每次检测消耗 1 积分</p></div>
      <div class="me-credits"><div class="me-credits-val">${DIAMOND_SVG}<strong data-me-balance>${user.credits}</strong></div><span>可用积分</span></div></div>
    <div class="me-grid">
      <section class="me-card"><div class="me-card-head"><h3>积分与检测明细</h3><span class="me-page-meta" data-me-records-meta></span></div><div data-me-records><p class="me-empty">加载中…</p></div><nav class="me-pager" data-me-pager aria-label="积分与检测明细分页" hidden></nav></section>
    </div>
    <div class="me-actions-foot"><button type="button" class="me-logout" data-me-logout>退出登录</button></div></div></div>`;
  host.querySelector('[data-me-logout]')?.addEventListener('click', logout);

  const recordHost = host.querySelector('[data-me-records]');
  const metaHost = host.querySelector('[data-me-records-meta]');
  const pagerHost = host.querySelector('[data-me-pager]');
  let currentPage = 1;
  let reqSeq = 0;

  function renderLedgerTitle(row) {
    const delta = Number(row.delta) || 0;
    if (row.reason === 'signup_bonus') {
      return `<span class="me-tag is-plus">注册赠送</span><b>新用户注册赠送积分</b>`;
    }
    if (delta > 0) {
      return `<span class="me-tag is-plus">积分增加</span><b>${escapeText(row.summary || ledgerReasonLabel(row.reason))}</b>`;
    }
    const target = row.scene ? sceneRoute(row.scene) : '';
    const label = escapeText(row.scene ? sceneLabel(row.scene) : ledgerReasonLabel(row.reason));
    const node = target
      ? `<a class="me-record-link" href="#${target}"><span>${label}</span>${icon('chevron')}</a>`
      : `<b>${label}</b>`;
    return `<span class="me-tag is-minus">检测消耗</span>${node}`;
  }

  function paintLedger(data = {}) {
    if (Number.isFinite(Number(data.credits))) {
      syncAuthCredits(Number(data.credits));
    }
    const rawList = Array.isArray(data.ledger) ? data.ledger : [];
    const total = Number.isFinite(Number(data.total)) ? Number(data.total) : rawList.length;
    const totalPages = Math.max(1, Number(data.totalPages) || Math.ceil(total / PAGE_SIZE));
    currentPage = Math.min(totalPages, Math.max(1, Number(data.page) || currentPage));
    const list = rawList.slice(0, PAGE_SIZE);

    if (!total || !list.length) {
      metaHost.textContent = '';
      recordHost.innerHTML = '<p class="me-empty">暂无积分变动记录，注册赠送与每次检测消耗都将汇总在此。</p>';
      pagerHost.hidden = true;
      pagerHost.innerHTML = '';
      return;
    }

    metaHost.textContent = `共 ${total} 条 · 第 ${currentPage} / ${totalPages} 页`;
    recordHost.innerHTML = `<ul class="me-list">${list.map(row => {
      const delta = Number(row.delta) || 0;
      const sign = delta > 0 ? '+' : '';
      const tone = delta > 0 ? 'is-plus' : 'is-minus';
      const summary = row.summary && row.reason !== 'signup_bonus' ? `<span>· ${escapeText(row.summary)}</span>` : '';
      const balanceText = Number.isFinite(Number(row.balance_after)) ? `余额 ${Number(row.balance_after)}` : '';
      return `<li>
        <div class="me-item-main">
          <div class="me-item-title">${renderLedgerTitle(row)}</div>
          <div class="me-item-meta"><time>${new Date(row.created_at).toLocaleString('zh-CN')}</time>${summary}</div>
        </div>
        <div class="me-item-delta">
          <strong class="me-delta ${tone}">${DIAMOND_SVG}${sign}${delta}</strong>
          ${balanceText ? `<small>${balanceText}</small>` : ''}
        </div>
      </li>`;
    }).join('')}</ul>`;

    const items = buildPageItems(currentPage, totalPages);
    pagerHost.hidden = false;
    pagerHost.innerHTML = `<span class="me-pager-info">每页 ${PAGE_SIZE} 条</span><div class="me-pager-btns">
      <button type="button" class="me-page-btn" data-me-page-btn="${currentPage - 1}" ${currentPage <= 1 ? 'disabled' : ''}>上一页</button>
      ${items.map(item => item === '…'
        ? '<span class="me-page-ellipsis" aria-hidden="true">…</span>'
        : `<button type="button" class="me-page-btn" data-me-page-btn="${item}" ${item === currentPage ? 'aria-current="page"' : ''}>${item}</button>`
      ).join('')}
      <button type="button" class="me-page-btn" data-me-page-btn="${currentPage + 1}" ${currentPage >= totalPages ? 'disabled' : ''}>下一页</button>
    </div>`;
  }

  async function loadPage(targetPage) {
    const id = ++reqSeq;
    pagerHost.querySelectorAll('button').forEach(btn => { btn.disabled = true; });
    const data = await fetch(`/api/v1/me/credits?page=${encodeURIComponent(targetPage)}&pageSize=${PAGE_SIZE}`)
      .then(r => r.json())
      .catch(() => ({}));
    if (id !== reqSeq || !host.isConnected) return;
    paintLedger(data);
  }

  pagerHost.addEventListener('click', event => {
    const btn = event.target.closest('[data-me-page-btn]');
    if (!btn || btn.disabled || btn.getAttribute('aria-current') === 'page') return;
    const next = Number(btn.dataset.mePageBtn);
    if (Number.isFinite(next) && next >= 1 && next !== currentPage) void loadPage(next);
  });

  const initialData = await fetch(`/api/v1/me/credits?page=1&pageSize=${PAGE_SIZE}`)
    .then(r => r.json())
    .catch(() => ({}));
  if (!host.isConnected) return;

  paintLedger(initialData);
}

function ledgerReasonLabel(reason) {
  const map = {
    signup_bonus: '新用户注册赠送积分',
    detection: 'AI检测消耗',
  };
  return map[reason] || reason || '积分变动';
}

function sceneLabel(scene) {
  const map = {
    'text-news': 'AI新闻稿与投稿内容检测', 'text-novel': 'AI网文与小说内容检测', 'text-academic': 'AI论文与学术稿件检测',
    'image-general': '通用AI生成图片检测', 'image-documents': '证件、票据与证明材料核验', 'image-refund': '仅退款与售后AI凭证检测',
    'video-general': '通用AI生成视频检测', 'video-deepfake': '人物换脸与深度伪造检测', 'video-aftersales': '售后与退货AI视频凭证检测',
    'audio-forgery': 'AI音频伪造检测',
  };
  return map[scene] || scene;
}

function sceneRoute(scene) {
  const map = {
    'text-news': '/text/news', 'text-novel': '/text/novel', 'text-academic': '/text/academic',
    'image-general': '/image/general', 'image-documents': '/image/documents', 'image-refund': '/image/refund',
    'video-general': '/video/general', 'video-deepfake': '/video/deepfake', 'video-aftersales': '/video/aftersales',
    'audio-forgery': '/audio/forgery',
  };
  return map[scene] || '';
}

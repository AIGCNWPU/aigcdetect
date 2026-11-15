/**
 * 前端账号：会话状态、登录/注册浮窗、用户中心。
 * 未登录时页面按游客模式运行，所有检测功能照常可用。
 */
import { icon } from '../icons.js';

const state = { user: null, loading: false };

// 登录态本地缓存：路由切换时先用缓存同步渲染，避免左下角从「本地用户」闪成「游客」
const CACHE_KEY = 'veritas.auth.user';
try {
  const cached = localStorage.getItem(CACHE_KEY);
  if (cached) state.user = JSON.parse(cached);
} catch { /* 隐私模式下忽略 */ }

let sessionLoaded = false;
let sessionRequest = null;

function persistUser() {
  try {
    if (state.user) localStorage.setItem(CACHE_KEY, JSON.stringify(state.user));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* 忽略写入失败 */ }
}

function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

function style() {
  if (document.querySelector('#auth-style')) return;
  const css = `
.sidebar-user{display:flex;flex-direction:column;gap:3px;min-width:0}.sidebar-user strong{font-size:13px;overflow:hidden;text-overflow:ellipsis}.sidebar-user span{font-size:11px;color:#777}.user-avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#eee}
.auth-dialog{border:0;padding:0;background:transparent;max-width:100vw}
.auth-dialog::backdrop{background:rgba(18,24,38,.42);backdrop-filter:blur(3px)}
.auth-card{width:360px;max-width:92vw;padding:28px 26px 22px;border-radius:20px;background:#fff;box-shadow:0 24px 70px rgba(23,32,54,.28);border:1px solid #e8e6f0;color:#22283a}
.auth-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.auth-head img{width:34px;height:34px}
.auth-head strong{font-size:18px;letter-spacing:.04em}
.auth-head span{font-size:16px;font-weight:700;letter-spacing:.2em;color:#1d1d1f}
.auth-sub{font-size:12px;color:#8b8fa0;margin:4px 0 18px}
.auth-tabs{display:flex;gap:6px;padding:4px;background:#f3f1f8;border-radius:10px;margin-bottom:16px}
.auth-tabs button{flex:1;border:0;background:transparent;padding:8px;border-radius:8px;font-size:13px;color:#6d6a7d;cursor:pointer}
.auth-tabs button[aria-selected=true]{background:#fff;color:#3d2f5c;font-weight:600;box-shadow:0 1px 4px rgba(60,40,90,.12)}
.auth-field{display:block;margin-bottom:12px}
.auth-field span{display:block;font-size:12px;color:#6f7280;margin-bottom:6px}
.auth-field input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #dcdfe8;border-radius:9px;font-size:14px;background:#fbfbfd}
.auth-field input:focus{outline:2px solid #a98bd0;border-color:transparent}
.auth-error{min-height:18px;font-size:12px;color:#b4432f;margin:2px 0 10px}
.auth-submit{width:100%;padding:11px;border:0;border-radius:10px;background:linear-gradient(135deg,#7f5bb8,#5b3f95);color:#fff;font-size:14px;font-weight:600;cursor:pointer}
.auth-submit[disabled]{opacity:.6;cursor:wait}
.auth-close{position:absolute;top:10px;right:10px;width:30px;height:30px;border:0;border-radius:50%;background:#f2f0f7;color:#6a6578;cursor:pointer;font-size:16px;line-height:1}
.auth-foot{font-size:11px;color:#9aa0ad;text-align:center;margin-top:14px}
.user-avatar.has-user{background:linear-gradient(135deg,#7f5bb8,#5b3f95);color:#fff;font-weight:600;font-size:12px}
.me-workspace{padding:26px;color:#283247}
.me-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:22px;border:1px solid #e8e6f0;border-radius:16px;background:linear-gradient(120deg,#f6f1fc,#fbfcff);margin-bottom:18px}
.me-head h2{margin:0 0 6px;font-size:22px}
.me-head p{margin:0;font-size:12px;color:#868b9a}
.me-credits{text-align:right}
.me-credits strong{display:block;font-size:28px;color:#6a48a0}
.me-credits span{font-size:11px;color:#8b8fa0}
.me-grid{display:grid;grid-template-columns:minmax(0,1fr);gap:16px}
.me-card{border:1px solid #e9e7f1;border-radius:14px;background:#fff;padding:18px}
.me-card h3{margin:0 0 12px;font-size:15px}
.me-list{list-style:none;margin:0;padding:0;display:grid;gap:9px}
.me-list li{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #f0eef5;border-radius:10px;font-size:12px}
.me-list b{font-weight:600;color:#3d3552}
.me-list small{color:#9298a6}
.me-empty{font-size:12px;color:#9298a6;padding:14px;text-align:center;border:1px dashed #e2dff0;border-radius:10px}
.me-logout{border:1px solid #e3d8ef;background:#fff;color:#6a4c93;border-radius:9px;padding:8px 14px;font-size:12px;cursor:pointer}
`;
  document.head.append(el(`<style id="auth-style">${css}</style>`));
}

function dialogMarkup() {
  return `<dialog class="auth-dialog" data-auth-dialog aria-label="登录或注册">
    <form class="auth-card" method="dialog" data-auth-form>
      <button type="button" class="auth-close" data-auth-close aria-label="关闭">×</button>
      <div class="auth-head"><img src="./public/favicon.svg?v=4" alt=""><strong>VERITAS</strong><span>智鉴</span></div>
      <p class="auth-sub">登录后可保存检测记录与积分，游客也可直接使用全部功能。</p>
      <div class="auth-tabs" role="tablist">
        <button type="button" role="tab" data-auth-mode="login" aria-selected="true">登录</button>
        <button type="button" role="tab" data-auth-mode="register" aria-selected="false">注册</button>
      </div>
      <label class="auth-field"><span>用户名</span><input name="username" autocomplete="username" required maxlength="20" placeholder="3–20 位，可用中英文与数字"></label>
      <label class="auth-field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required minlength="6" maxlength="64" placeholder="至少 6 位"></label>
      <p class="auth-error" data-auth-error role="alert"></p>
      <button type="submit" class="auth-submit" data-auth-submit>登录</button>
      <p class="auth-foot">注册即赠送 100 积分 · 当前检测不扣积分</p>
    </form>
  </dialog>`;
}

let dialog = null;
let mode = 'login';

export function openAuthDialog(initial = 'login') {
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
  dialog.showModal();
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

function refreshUserUI() {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer) return;
  const name = footer.querySelector('.sidebar-user strong');
  const role = footer.querySelector('.sidebar-user span');
  const avatar = footer.querySelector('.user-avatar');
  if (!name || !role || !avatar) return;
  if (state.user) {
    const initial = state.user.username.slice(0, 1).toUpperCase();
    name.textContent = state.user.username;
    role.textContent = `${state.user.credits} 积分 · 个人空间`;
    avatar.textContent = initial;
    avatar.classList.add('has-user');
    avatar.setAttribute('role', 'img');
    avatar.setAttribute('aria-label', `${state.user.username} 的头像`);
  } else {
    name.textContent = '游客';
    role.textContent = '点击登录或注册';
    avatar.innerHTML = icon('user');
    avatar.classList.remove('has-user');
  }
}

/** 同步渲染当前登录态（不发起请求），路由切换时调用，避免闪烁 */
export function paintAuth() {
  style();
  bindSidebarEntry();
  refreshUserUI();
}

function bindSidebarEntry() {
  const footer = document.querySelector('.sidebar-footer');
  if (!footer || footer.dataset.authBound) return;
  footer.dataset.authBound = '1';
  footer.style.cursor = 'pointer';
  footer.addEventListener('click', event => {
    if (event.target.closest('[data-sidebar-settings]')) return;
    if (state.user) location.hash = '#/me';
    else openAuthDialog('login');
  });
}

/** 只在页面首次加载时校验一次会话；之后用内存/本地缓存 */
export function initAuth() {
  paintAuth();
  if (sessionRequest) return sessionRequest;
  if (sessionLoaded) return Promise.resolve(state.user);
  sessionRequest = fetch('/api/v1/auth/me', { headers: { Accept: 'application/json' } })
    .then(response => response.json())
    .then(body => {
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

export async function renderMePage(host) {
  if (!host) return;
  if (!state.user) {
    host.innerHTML = `<div class="me-workspace"><div class="me-card"><h3>尚未登录</h3><p class="me-empty">登录后可以查看积分与检测记录。</p><button class="me-logout" data-me-login>去登录</button></div></div>`;
    host.querySelector('[data-me-login]')?.addEventListener('click', () => openAuthDialog('login'));
    return;
  }
  const user = state.user;
  host.innerHTML = `<div class="me-workspace">
    <div class="me-head"><div><h2>${user.username}</h2><p>注册于 ${new Date(user.createdAt).toLocaleDateString('zh-CN')} · 当前检测不扣积分</p></div>
      <div class="me-credits"><strong>${user.credits}</strong><span>可用积分</span></div></div>
    <div class="me-grid">
      <section class="me-card"><h3>检测记录</h3><div data-me-records><p class="me-empty">加载中…</p></div></section>
      <section class="me-card"><h3>积分流水</h3><div data-me-credits><p class="me-empty">加载中…</p></div></section>
    </div>
    <p style="margin-top:16px"><button class="me-logout" data-me-logout>退出登录</button></p></div>`;
  host.querySelector('[data-me-logout]')?.addEventListener('click', logout);

  const [records, credits] = await Promise.all([
    fetch('/api/v1/me/detections?limit=50').then(r => r.json()).catch(() => ({})),
    fetch('/api/v1/me/credits').then(r => r.json()).catch(() => ({})),
  ]);

  const recordHost = host.querySelector('[data-me-records]');
  const list = records.detections || [];
  recordHost.innerHTML = list.length
    ? `<ul class="me-list">${list.map(item => `<li><b>${sceneLabel(item.scene)}</b><small>${new Date(item.created_at).toLocaleString('zh-CN')}</small></li>`).join('')}</ul>`
    : '<p class="me-empty">还没有检测记录，去任意场景试一次。</p>';

  const creditHost = host.querySelector('[data-me-credits]');
  const rows = credits.ledger || [];
  creditHost.innerHTML = rows.length
    ? `<ul class="me-list">${rows.map(row => `<li><b>${row.reason === 'signup_bonus' ? '注册赠送' : row.reason}</b><small>+${row.delta} · ${new Date(row.created_at).toLocaleDateString('zh-CN')}</small></li>`).join('')}</ul>`
    : '<p class="me-empty">暂无流水。</p>';
}

function sceneLabel(scene) {
  const map = {
    'text-news': '新闻稿检测', 'text-novel': '小说检测', 'text-academic': '论文检测',
    'image-general': '通用图片', 'image-documents': '证件票据', 'image-refund': '售后图片',
    'video-general': '通用视频', 'video-deepfake': '换脸检测', 'video-aftersales': '售后视频',
    'audio-forgery': '音频检测',
  };
  return map[scene] || scene;
}

import { modules, scenarios } from './catalog.js';
import { icon } from './icons.js';
import { api } from './api.js';
import { pageRenderers } from './modules/registry.js';

const app = document.querySelector('#app');
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
const href = path => `#${path}`;

// 允许用独立组件填充场景页。未注册时，工作区域保持空白。
export const pageRegistry = new Map(pageRenderers);
export function registerPage(path, render) {
  if (!scenarios.some(scenario => scenario.path === path)) throw new Error(`Unknown scenario: ${path}`);
  pageRegistry.set(path, render);
  if (readPath() === path) renderApp();
}

export function resolveRoute(path) {
  if (path === '/') return { type: 'overview' };
  const module = modules.find(item => path === item.path || path.startsWith(`${item.path}/`));
  if (!module) return { type: 'not-found' };
  if (path === module.path) return { type: 'module', module };
  const scenario = module.scenarios.find(item => path === item.path);
  if (!scenario) return { type: 'not-found' };
  if (path === scenario.path) return { type: 'scenario', module, scenario };
  return { type: 'not-found' };
}

function readPath() {
  try {
    const raw = decodeURIComponent(location.hash.slice(1) || '/');
    return raw.replace(/\/+$/, '') || '/';
  } catch { return '/invalid-route'; }
}

function breadcrumbs(route) {
  let result = '<a href="#/">模块总览</a>';
  if (route.module) result += `${icon('chevron')}<a href="${href(route.module.path)}">${route.module.title}</a>`;
  if (route.scenario) result += `${icon('chevron')}<a href="${href(route.scenario.path)}">${route.scenario.title}</a>`;
  return `<nav class="breadcrumbs" aria-label="面包屑">${result}</nav>`;
}

function overview() {
  return `<header class="page-heading"><div><p class="eyebrow">VERITAS WORKSPACE</p><h1>选择你的检测模块</h1><p class="heading-description">从文本到音视频，一站进入内容真实性检测工作空间。</p></div><span class="count-pill">4 大模块 <i></i> 10 个场景</span></header>
    <div class="theme-grid">${modules.map(module => `<article class="theme-card tone-${module.id}">
      <div class="theme-card-top"><span class="theme-symbol">${icon(module.id)}</span><span class="theme-number">${module.index}</span></div>
      <a class="theme-title" href="${href(module.path)}"><h2>${module.title}</h2></a>
      <p class="theme-description">${module.description}</p>
      <div class="theme-functions">${module.scenarios.map(scenario => `<a href="${href(scenario.path)}"><span>${scenario.title}</span>${icon('chevron')}</a>`).join('')}</div>
      <a class="theme-bottom" href="${href(module.path)}"><span>全部 ${module.scenarios.length} 个场景</span><span class="circle-arrow">${icon('arrow')}</span></a>
    </article>`).join('')}</div>
    <div class="workspace-note">${icon('shield')}<div><strong>多模态内容真实性检测</strong><p>选择检测模块，进入对应业务场景。</p></div><span>TEXT · IMAGE · VIDEO · AUDIO</span></div>`;
}

function modulePage(route) {
  const module = route.module;
  return `${breadcrumbs(route)}<header class="domain-heading tone-${module.id}"><span class="theme-symbol">${icon(module.id)}</span><div><p class="eyebrow">${module.kicker}</p><h1>${module.title}</h1><p class="domain-description">${module.description}</p></div><span class="domain-index">${module.index}</span></header>
    <div class="section-heading"><h2>全部场景 <span>${module.scenarios.length}</span></h2><span class="section-meta">选择业务场景</span></div>
    <div class="feature-grid">${module.scenarios.map(scenario => `<a class="feature-card tone-${module.id}" href="${href(scenario.path)}"><div class="feature-top"><span class="feature-symbol">${icon(module.id)}</span><span class="feature-code">${scenario.code}</span>${icon('arrow','feature-arrow')}</div><h2>${scenario.title}</h2><div class="audience-tags">${scenario.audience.map(user => `<span>${user}</span>`).join('')}</div></a>`).join('')}</div>`;
}

function scenarioPage(route) {
  const { module, scenario } = route;
  return `${breadcrumbs(route)}<header class="detail-heading tone-${module.id}"><span class="feature-symbol">${icon(module.id)}</span><div><p class="eyebrow">${module.kicker} / ${scenario.code}</p><h1>${scenario.title}</h1></div><a class="quiet-back" href="${href(module.path)}">返回场景列表 ${icon('arrow')}</a></header>
    <section id="scenario-workspace" class="feature-workspace" aria-label="${escapeHtml(scenario.title)}工作区域"></section>`;
}

function renderApp() {
  const route = resolveRoute(readPath());
  const title = route.scenario?.title || route.module?.title || 'AI检测平台';
  document.title = `${title} · VERITAS 智鉴`;
  const views = { overview, module: modulePage, scenario: scenarioPage };
  const content = views[route.type]?.(route) || '<section class="not-found"><p class="eyebrow">404</p><h1>页面未找到</h1><a class="back-link" href="#/">返回模块总览</a></section>';
  app.innerHTML = `<a class="skip-link" href="#main-content">跳转到主要内容</a><header class="topbar"><a class="brand" href="#/" aria-label="VERITAS 智鉴首页"><span class="brand-mark">${icon('shield')}</span><span>VERITAS</span><span class="brand-divider"></span><span class="brand-cn">智鉴</span></a><span class="top-status"><span></span>功能预览版</span></header>
    <div class="app-layout"><aside class="sidebar"><a href="#/" class="nav-item overview-link ${route.type==='overview'?'active':''}" ${route.type==='overview'?'aria-current="page"':''}>${icon('overview')}<span>模块总览</span></a><p class="nav-label">检测模块</p><nav aria-label="检测模块">${modules.map(module => `<a href="${href(module.path)}" class="nav-item ${route.module?.id===module.id?'active':''}" ${route.module?.id===module.id?'aria-current="page"':''}>${icon(module.id)}<span>${module.title}</span><span class="nav-count">${module.scenarios.length}</span></a>`).join('')}</nav><div class="sidebar-footer"><span class="mini-mark">V</span><div><span>智鉴工作空间</span><small>AI DETECTION PLATFORM</small></div></div></aside><main id="main-content" class="main-content" tabindex="-1">${content}<footer class="workspace-footer"><span>VERITAS 智鉴</span><span>让真实，有据可循。</span></footer></main></div>`;
  if (route.type === 'scenario') {
    const renderer = pageRegistry.get(route.scenario.path);
    if (renderer) renderer(document.querySelector('#scenario-workspace'), route);
  }
}

window.addEventListener('hashchange', () => {
  renderApp();
  window.scrollTo(0, 0);
  document.querySelector('#main-content')?.focus({ preventScroll: true });
});
// 跳转到主要内容是文档锚点，不应触发业务路由。
app.addEventListener('click', event => {
  const link = event.target.closest('.skip-link');
  if (link) { event.preventDefault(); document.querySelector('#main-content')?.focus(); }
});
window.Veritas = { modules, scenarios, registerPage, resolveRoute, api };
renderApp();

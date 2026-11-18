import { modules, scenarios } from './catalog.js';
import { icon } from './icons.js';
import { BRAND_SLOGAN } from './lib/brand-wordmark.js';
import { initAuth } from './lib/auth-client.js';
import { bindBenchmarks, renderBenchmarks } from './portal-benchmarks.js';
import { renderPlatformComparison } from './portal-comparison.js';

const app = document.querySelector('#app');
let revealObservers = [];
const homeHref = './';
const workspaceHref = '#/';
const apiHref = '#/api';
const apiApplicationPath = '/api/v1/developer/applications';
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

const moduleSummaries = {
  text: { name: '文本检测', detail: '识别疑似生成的段落，查看句级风险与复核线索。' },
  image: { name: '图片检测', detail: '核查生成或篡改风险，定位需要进一步查看的区域。' },
  video: { name: '视频检测', detail: '查看生成与换脸风险，按时间段回看可疑画面。' },
  audio: { name: '音频检测', detail: '识别语音合成与声音克隆迹象，定位可疑时段。' },
};
const sceneLabels = {
  text: { academic: '论文与学术稿件', news: '新闻稿与投稿内容', novel: '网文与小说' },
  image: { general: '通用图片检测', refund: '售后凭证检测', documents: '证件与票据检测' },
  video: { general: '通用视频检测', deepfake: '人物换脸检测', aftersales: '售后视频检测' },
  audio: { forgery: '音频伪造检测' },
};

function brand() {
  return `<a class="portal-brand" href="${homeHref}" aria-label="VERITAS 智鉴首页">
    <img src="./public/brand-logo.png?v=5" width="36" height="36" alt="">
    <span><strong>VERITAS</strong><i aria-hidden="true"></i><img class="portal-wordmark" src="./public/brand-wordmark.svg" width="51" height="23" alt="智鉴"></span>
  </a>`;
}

function header(page) {
  return `<a class="portal-skip" href="#portal-main" data-portal-scroll>跳转到正文</a>
    <header class="portal-header">
      <div class="portal-wrap portal-header-inner">
        ${brand()}
        <nav aria-label="官网导航">
          <a href="${homeHref}" ${page === 'home' ? 'aria-current="page"' : ''}>首页</a>
          <a href="${workspaceHref}">检测中心</a>
          <a href="${apiHref}" ${page === 'api' ? 'aria-current="page"' : ''}>API 中心</a>
        </nav>
        <button class="portal-account" type="button" data-topbar-user data-portal-user>
          ${icon('user')}<span data-topbar-user-label>登录</span>
        </button>
      </div>
    </header>`;
}

function footer(page) {
  return `<footer class="portal-footer">
    <div class="portal-wrap portal-footer-inner">
      <div>${brand()}<p>${BRAND_SLOGAN}</p></div>
      <nav aria-label="页脚导航">
        <a href="${workspaceHref}">检测中心</a>
        <a href="${apiHref}">API 中心</a>
        <a href="${page === 'home' ? '#portal-comparison' : './?section=comparison'}" ${page === 'home' ? 'data-portal-scroll' : ''}>能力对比</a>
        <a href="${page === 'home' ? '#portal-about' : './?section=about'}" ${page === 'home' ? 'data-portal-scroll' : ''}>关于智鉴</a>
      </nav>
      <small>Copyright © ${new Date().getFullYear()} VERITAS 智鉴 · 版权所有</small>
    </div>
  </footer>`;
}

function heroVisual() {
  return `<div class="portal-hero-visual" aria-hidden="true">
    <div class="portal-optic">
      <img src="./public/portal-prism.webp" width="1152" height="768" alt="" fetchpriority="high">
      <div class="portal-optic-ring portal-optic-ring-outer"></div>
      <div class="portal-optic-ring portal-optic-ring-inner"></div>
      <div class="portal-optic-sweep"></div>
    </div>
    <div class="portal-optic-caption">
      <span>${icon('text')}</span><span>${icon('image')}</span><span>${icon('video')}</span><span>${icon('audio')}</span>
      <small>文本 · 图片 · 视频 · 音频</small>
    </div>
  </div>`;
}

function capabilityCards() {
  return modules.map((module, index) => {
    const summary = moduleSummaries[module.id];
    return `<article class="portal-capability portal-tone-${module.id}" data-reveal style="--reveal-delay:${index * 75}ms">
      <div class="portal-capability-top"><span class="portal-feature-icon">${icon(module.id)}</span><span class="portal-scenario-count">${module.scenarios.length} 个场景</span><a href="#${module.path}" aria-label="查看${summary.name}">${icon('arrow')}</a></div>
      <h3><a href="#${module.path}">${summary.name}</a></h3>
      <p>${summary.detail}</p>
      <ul>${module.scenarios.map(scene =>
        `<li><a href="#${scene.path}">${sceneLabels[module.id][scene.id] || escapeHtml(scene.title)}${icon('chevron')}</a></li>`,
      ).join('')}</ul>
    </article>`;
  }).join('');
}

function robustness() {
  return `<section class="portal-robust" aria-labelledby="portal-robust-title">
    <div class="portal-wrap portal-robust-inner">
      <div class="portal-robust-heading" data-reveal>
        <h2 id="portal-robust-title">抗干扰与对抗场景</h2>
        <p>处理格式干扰、图像后处理和材料中的提示注入，让风险线索可回查。</p>
      </div>
      <div class="portal-robust-grid">
        <article data-reveal>
          <span class="portal-robust-icon">${icon('text')}</span>
          <h3>处理文本格式干扰</h3>
          <p>新闻与小说送检前归一化异常格式和不可见字符，检测结果仍关联原句。</p>
          <a href="#/text/news">查看新闻稿检测 ${icon('arrow')}</a>
        </article>
        <article data-reveal style="--reveal-delay:85ms">
          <span class="portal-robust-icon">${icon('image')}</span>
          <h3>核对图像线索</h3>
          <p>并列查看 AI 特征分布、可用的压缩差异与来源标识，复核同一张图上的不同线索。</p>
          <a href="#/image/general">查看通用图片检测 ${icon('arrow')}</a>
        </article>
        <article data-reveal style="--reveal-delay:170ms">
          <span class="portal-robust-icon">${icon('shield')}</span>
          <h3>材料指令隔离</h3>
          <p>将材料中的指令视为待核内容，并校验复核输出。也支持金额关系检查，受控试测标出了两项矛盾。</p>
          <a href="#/image/documents">查看证件与票据检测 ${icon('arrow')}</a>
        </article>
      </div>
    </div>
  </section>`;
}

function home() {
  return `<main id="portal-main" tabindex="-1">
    <section class="portal-hero" aria-labelledby="portal-home-title">
      <div class="portal-wrap portal-hero-inner">
        <div class="portal-hero-copy">
          <div class="portal-hero-kicker"><span></span>${BRAND_SLOGAN}</div>
          <h1 id="portal-home-title">全模态 AI 内容<br><span>真实性检测平台</span></h1>
          <p>检测文本、图片、视频和音频，查看风险线索与分析报告。</p>
          <div class="portal-actions">
            <a class="portal-button portal-button-primary" href="${workspaceHref}">进入检测中心 ${icon('arrow')}</a>
            <a class="portal-button portal-button-dark" href="${apiHref}">查看 API</a>
          </div>
        </div>
        ${heroVisual()}
      </div>
    </section>
    ${renderBenchmarks()}
    <section class="portal-section portal-wrap portal-home-capabilities" id="portal-capabilities" tabindex="-1" aria-labelledby="portal-capabilities-title">
      <header class="portal-section-heading" data-reveal>
        <div><h2 id="portal-capabilities-title">选择检测能力</h2><p>按手头的材料类型，直达对应的检测场景。</p></div>
        <a class="portal-text-link" href="${workspaceHref}">全部检测场景 ${icon('arrow')}</a>
      </header>
      <div class="portal-capability-grid">${capabilityCards()}</div>
    </section>
    ${robustness()}
    ${renderPlatformComparison()}
    <section class="portal-wrap portal-home-api" aria-labelledby="portal-home-api-title" data-reveal>
      <div>${icon('link')}<div><h2 id="portal-home-api-title">将智鉴检测接入你的系统</h2><p>查看支持的能力、请求示例与接入流程。</p></div></div>
      <div class="portal-actions"><a class="portal-button portal-button-light" href="#/api/quickstart">查看接入文档</a><a class="portal-button portal-button-primary" href="#/api/apply">申请接入 ${icon('arrow')}</a></div>
    </section>
    <section class="portal-wrap portal-about" id="portal-about" tabindex="-1" data-reveal>
      <h2>关于智鉴</h2>
      <p>VERITAS 智鉴面向多种内容提供 AI 生成与伪造风险检测，帮助用户找到需要复核的线索。</p>
    </section>
  </main>`;
}

const endpoints = [
  {
    icon: 'text', name: '新闻稿检测', url: '/api/v1/text/news', mode: '同步返回',
    input: '稿件标题、正文与检测项目', output: '句级 AI 风险或稿件审校结果',
    request: {
      action: 'analyze',
      material: { title: '示例新闻稿', content: '第一段新闻稿正文。' },
      checks: ['proofreading'],
    },
    response: { data: { proofreading: { completedStages: 6, totalStages: 6, issues: [] } } },
    responseNote: 'HTTP 200。返回字段随所选检测项目变化。',
  },
  {
    icon: 'image', name: '通用图片检测', url: '/api/v1/image/general', mode: '提交后查询',
    input: '图片与检测参数', output: '任务状态、生成风险及区域响应',
    request: { action: 'status', jobId: '替换为提交检测后取得的任务编号' },
    response: { data: { jobId: '示例任务编号', status: 'running' } },
    responseNote: '上例为查询任务。首次用 action: detect 提交图片，返回任务编号后再查询。',
  },
  {
    icon: 'video', name: '通用视频检测', url: '/api/v1/video/general', mode: '同步返回',
    input: 'MP4 或 WebM，multipart 字段 video', output: '整片风险、可疑时段及代表画面',
    request: 'Content-Type: multipart/form-data\nvideo: @sample.mp4',
    response: { data: { risk: 'medium', segments: [{ start: 2.1, end: 4.8, risk: 'medium' }] } },
    responseNote: 'HTTP 200。时间单位为秒，返回中还可包含代表画面与检测范围。',
  },
];
const catalogExcerpt = JSON.stringify({ counts: { modules: modules.length, scenarios: scenarios.length } }, null, 2);

function applicationForm() {
  return `<section class="portal-api-apply" id="portal-apply" tabindex="-1" aria-labelledby="portal-apply-title">
    <header><span class="portal-feature-icon">${icon('link')}</span><h2 id="portal-apply-title">申请 API 接入</h2><p>留下项目需求和联系方式。团队审核后会通过邮件回复。</p></header>
    <form class="portal-form" data-api-application>
      <div class="portal-form-row">
        <label>联系邮箱<input name="email" type="email" required maxlength="254" autocomplete="email" placeholder="name@example.com"></label>
        <label>组织或项目名称<input name="organization" required maxlength="120" autocomplete="organization" placeholder="请输入组织或项目名称"></label>
      </div>
      <label>使用场景<textarea name="useCase" required maxlength="1200" rows="4" placeholder="描述待检测的材料及接入用途"></textarea></label>
      <label>预计月调用量<select name="volume" required>
        <option value="">请选择</option><option value="under-1000">少于 1,000 次</option><option value="1000-10000">1,000–10,000 次</option><option value="over-10000">超过 10,000 次</option><option value="undecided">尚未确定</option>
      </select></label>
      <div class="portal-form-submit"><button class="portal-button portal-button-primary" type="submit">提交申请 ${icon('arrow')}</button><p>所填信息仅用于评估接入需求与联系回复。</p></div>
      <p class="portal-form-error" aria-live="polite"></p>
    </form>
    <div class="portal-form-success" hidden tabindex="-1" role="status">
      ${icon('check')}<div><h3>申请已收到</h3><p>审核结果将发送到你填写的联系邮箱。</p><p>申请编号 <code data-application-id></code></p></div>
    </div>
  </section>`;
}

function apiCenter() {
  const command = `curl "${location.origin}/api/v1/catalog"`;
  return `<main id="portal-main" tabindex="-1">
    <section class="portal-api-hero">
      <div class="portal-wrap portal-api-hero-inner">
        <div><h1>API 中心</h1><p>将智鉴的内容检测能力接入审核、核验和内容管理流程。</p>
        <div class="portal-actions">
          <a class="portal-button portal-button-primary" href="#/api/apply">申请接入 ${icon('arrow')}</a>
          <a class="portal-button portal-button-light" href="#/api/quickstart">快速入门</a>
        </div></div>
        <div class="portal-api-terminal" aria-hidden="true">
          <div><span></span><span></span><span></span><strong>智鉴能力目录</strong></div>
          <p><b>GET</b> /api/v1/catalog</p>
          <pre>{\n  "modules": ${modules.length},\n  "scenarios": ${scenarios.length}\n}</pre>
        </div>
      </div>
    </section>
    <div class="portal-wrap portal-docs">
      <nav class="portal-doc-nav" aria-label="API 文档导航">
        <a href="#/api/capabilities" data-doc-link="capabilities">能力目录</a>
        <a href="#/api/quickstart" data-doc-link="quickstart">快速入门</a>
        <a href="#/api/apply" data-doc-link="apply">申请接入</a>
      </nav>
      <div class="portal-doc-content">
        <section id="portal-capabilities" tabindex="-1" aria-labelledby="portal-api-capabilities-title">
          <header><h2 id="portal-api-capabilities-title">能力目录</h2><p>检测接口需申请接入。以下示例用于了解接口格式。</p></header>
          <div class="portal-endpoints">
            ${endpoints.map(item => `<article class="portal-endpoint portal-tone-${item.icon}">
              <div class="portal-endpoint-heading"><span class="portal-feature-icon">${icon(item.icon)}</span><div><h3>${item.name}</h3><code><b>POST</b> ${item.url}</code></div><span class="portal-endpoint-mode">${item.mode}</span></div>
              <dl><div><dt>输入</dt><dd>${item.input}</dd></div><div><dt>返回</dt><dd>${item.output}</dd></div></dl>
              <details><summary>查看请求与返回示例</summary>
                <p>请求示例</p><pre><code>${escapeHtml(typeof item.request === 'string' ? item.request : JSON.stringify(item.request, null, 2))}</code></pre>
                <p>响应节选</p><pre><code>${escapeHtml(JSON.stringify(item.response, null, 2))}</code></pre>
                <p>${item.responseNote}</p>
              </details>
            </article>`).join('')}
          </div>
        </section>
        <section id="portal-quickstart" tabindex="-1" aria-labelledby="portal-quickstart-title">
          <header><h2 id="portal-quickstart-title">快速入门</h2><p>用只读接口取得当前模块和场景，不需要密钥。</p></header>
          <div class="portal-code">
            <div><span>cURL</span><button type="button" data-copy-catalog>复制命令</button></div>
            <pre><code data-catalog-command>${escapeHtml(command)}</code></pre>
          </div>
          <div class="portal-catalog-links"><a class="portal-text-link" href="/api/v1/catalog" target="_blank" rel="noopener">查看 JSON 响应 ${icon('arrow')}</a><span aria-live="polite" data-copy-feedback></span></div>
          <details class="portal-catalog-excerpt"><summary>返回值节选</summary><pre><code>${escapeHtml(catalogExcerpt)}</code></pre></details>
        </section>
        ${applicationForm()}
      </div>
    </div>
  </main>`;
}

export function unmountPortal() {
  for (const observer of revealObservers) observer.disconnect();
  revealObservers = [];
}

function observeReveals() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;

  // Keep the rearm and reveal lines apart so the slide animation cannot rearm itself.
  const rearmInset = Math.min(64, Math.round(innerHeight * 0.07));
  const revealInset = rearmInset + 42;

  const rearm = element => {
    element.classList.remove('is-in-view');
    element.classList.add('reveal-pending');
  };
  const enterObserver = new IntersectionObserver(entries => {
    for (const { isIntersecting, target } of entries) {
      if (isIntersecting && target.classList.contains('reveal-pending')) {
        target.classList.remove('reveal-pending');
        target.classList.add('is-in-view');
      }
    }
  }, { rootMargin: `0px 0px -${revealInset}px 0px` });

  const rearmObserver = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting && entry.rootBounds && entry.boundingClientRect.top >= entry.rootBounds.bottom) {
        rearm(entry.target);
      }
    }
  }, { rootMargin: `0px 0px -${rearmInset}px 0px` });

  revealObservers = [enterObserver, rearmObserver];
  for (const element of app.querySelectorAll('[data-reveal]')) {
    if (element.getBoundingClientRect().top >= innerHeight - rearmInset) rearm(element);
    for (const observer of revealObservers) observer.observe(element);
  }
}

export function renderPortal(page) {
  unmountPortal();
  document.title = page === 'api' ? 'API 中心 · VERITAS 智鉴' : 'VERITAS 智鉴 · 全模态 AI 内容真实性检测平台';
  app.innerHTML = `<div class="portal${page === 'home' ? ' portal-home' : ''}">${header(page)}${page === 'api' ? apiCenter() : home()}${footer(page)}</div>`;
  if (page === 'home') {
    bindBenchmarks(app);
    observeReveals();
  }
  void initAuth();
}

export function showPortalSection(section, focus) {
  const querySection = !location.hash && new URL(location.href).searchParams.get('section');
  const landingSection = ['about', 'benchmarks', 'comparison'].includes(querySection) ? querySection : null;
  if (section || landingSection) {
    const target = document.getElementById(`portal-${section || landingSection}`);
    if (focus) target?.focus({ preventScroll: true });
    target?.scrollIntoView({ behavior: focus && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'instant' });
  } else if (focus) {
    window.scrollTo(0, 0);
    document.querySelector('#portal-main')?.focus({ preventScroll: true });
  }
  app.querySelectorAll('[data-doc-link]').forEach(link => {
    if (link.dataset.docLink === section) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

app.addEventListener('click', async event => {
  const anchor = event.target.closest('[data-portal-scroll]');
  if (anchor) {
    event.preventDefault();
    const target = document.getElementById(anchor.hash.slice(1));
    target?.focus({ preventScroll: true });
    const animate = !anchor.classList.contains('portal-skip') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
    target?.scrollIntoView({ behavior: animate ? 'smooth' : 'instant' });
  }
  const copy = event.target.closest('[data-copy-catalog]');
  if (copy) {
    const feedback = app.querySelector('[data-copy-feedback]');
    try {
      await navigator.clipboard.writeText(app.querySelector('[data-catalog-command]').textContent);
      feedback.textContent = '已复制';
    } catch {
      feedback.textContent = '请选中命令并手动复制';
    }
  }
  const currentDoc = event.target.closest('a[href^="#/api/"]');
  if (currentDoc?.hash === location.hash) showPortalSection(location.hash.split('/').at(-1), true);
});

app.addEventListener('submit', async event => {
  const form = event.target.closest('[data-api-application]');
  if (!form) return;
  event.preventDefault();
  const submit = form.querySelector('button[type=submit]');
  if (submit.disabled) return;
  const error = form.querySelector('.portal-form-error');
  const data = Object.fromEntries(new FormData(form));
  const signature = JSON.stringify(data);
  if (form.dataset.payload !== signature) {
    form.dataset.submissionId = crypto.randomUUID();
    form.dataset.payload = signature;
  }
  submit.disabled = true;
  submit.textContent = '提交中…';
  form.setAttribute('aria-busy', 'true');
  error.textContent = '';
  try {
    const response = await fetch(apiApplicationPath, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...data, submissionId: form.dataset.submissionId }),
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json();
    if (!response.ok || !body.data?.id) {
      error.textContent = body.error?.message || '申请提交失败，请稍后重试。';
      if (body.error?.code === 'SUBMISSION_CONFLICT') delete form.dataset.payload;
      if (body.error?.field) form.elements.namedItem(body.error.field)?.focus();
      return;
    }
    const success = form.nextElementSibling;
    success.querySelector('[data-application-id]').textContent = body.data.id.slice(0, 8).toUpperCase();
    form.reset();
    delete form.dataset.payload;
    delete form.dataset.submissionId;
    form.hidden = true;
    success.hidden = false;
    success.focus();
  } catch {
    error.textContent = '暂时无法确认提交结果。可以重试，重复提交不会生成新申请。';
  } finally {
    form.removeAttribute('aria-busy');
    submit.disabled = false;
    submit.innerHTML = '提交申请 ' + icon('arrow');
  }
});

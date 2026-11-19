const app = document.querySelector('#app');
let current;
let renderVersion = 0;
let workspaceStyles;
let workspaceStyleLink;

function readRoute() {
  if (!location.hash) return { shell: 'portal', page: 'home' };
  const match = /^#\/api(?:\/(capabilities|quickstart|apply))?\/?$/.exec(location.hash);
  return match ? { shell: 'portal', page: 'api', section: match[1] } : { shell: 'workspace' };
}

function loadWorkspaceStyles() {
  if (workspaceStyles) return workspaceStyles;
  const link = document.createElement('link');
  workspaceStyleLink = link;
  link.rel = 'stylesheet';
  // The build defines WORKSPACE_STYLES as the hashed stylesheet; the dev server serves the source file.
  link.href = new URL(typeof WORKSPACE_STYLES === 'string' ? WORKSPACE_STYLES : './styles.css', import.meta.url);
  link.media = 'not all';
  workspaceStyles = new Promise((resolve, reject) => {
    link.onload = () => resolve(link);
    link.onerror = () => {
      link.remove();
      workspaceStyles = undefined;
      workspaceStyleLink = undefined;
      reject(new Error('Workspace stylesheet could not be loaded'));
    };
  });
  document.head.append(link);
  return workspaceStyles;
}

// Fetch the workspace in the background so entering the detection center does not wait on the network.
// The stylesheet stays media="not all" until mounted, so preloading never changes the portal.
let workspacePreload;
function preloadWorkspace() {
  if (workspacePreload === 'started') return;
  workspacePreload = 'started';
  void import('./app.js').catch(() => {});
  void loadWorkspaceStyles().catch(() => {});
}

function scheduleWorkspacePreload() {
  if (workspacePreload || navigator.connection?.saveData) return;
  workspacePreload = 'scheduled';
  const idle = () => window.requestIdleCallback
    ? window.requestIdleCallback(preloadWorkspace, { timeout: 4000 })
    : setTimeout(preloadWorkspace, 1500);
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
  const intent = event => {
    const href = event.target.closest?.('a[href^="#/"]')?.getAttribute('href');
    if (href && !href.startsWith('#/api')) preloadWorkspace();
  };
  document.addEventListener('pointerover', intent, { passive: true });
  document.addEventListener('focusin', intent);
}

async function navigate(fromHistory = false) {
  const version = ++renderVersion;
  const route = readRoute();
  const loading = setTimeout(() => {
    if (version !== renderVersion) return;
    document.documentElement.classList.add('shell-loading');
    app.setAttribute('aria-busy', 'true');
  }, 140);
  try {
    if (route.shell === 'portal') {
      const portal = await import('./portal.js');
      if (version !== renderVersion) return;
      current?.workspace?.unmountWorkspace();
      if (workspaceStyleLink) workspaceStyleLink.media = 'not all';
      document.documentElement.dataset.shell = 'portal';
      const samePage = current?.page === route.page;
      if (!samePage) {
        portal.renderPortal(route.page);
        window.scrollTo(0, 0);
      }
      portal.showPortalSection(route.section, fromHistory);
      current = { ...route, portal };
      scheduleWorkspacePreload();
      return;
    }
    const [workspace, link] = await Promise.all([import('./app.js'), loadWorkspaceStyles()]);
    if (version !== renderVersion) return;
    current?.portal?.unmountPortal();
    link.media = 'all';
    document.documentElement.dataset.shell = 'workspace';
    workspace.mountWorkspace();
    if (fromHistory) document.querySelector('#main-content')?.focus({ preventScroll: true });
    current = { ...route, workspace };
  } catch (error) {
    if (version !== renderVersion) return;
    console.error(error);
    app.innerHTML = '<p role="alert">页面加载失败。<button type="button" data-retry>重新加载</button></p>';
    app.querySelector('[data-retry]').onclick = () => location.reload();
  } finally {
    clearTimeout(loading);
    if (version === renderVersion) {
      document.documentElement.classList.remove('shell-loading');
      app.removeAttribute('aria-busy');
    }
  }
}

window.addEventListener('hashchange', () => void navigate(true));
void navigate();

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
  link.href = new URL('./styles.css', import.meta.url);
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

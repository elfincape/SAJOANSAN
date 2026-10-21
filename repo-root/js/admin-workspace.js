import { subscribePrivateFeatures } from './private-features.js';
import { getCurrentProfile, signOut } from './auth.js';
import { getAdminMenus } from './admin-menu.js';
import { categoryForPath } from './admin-hub.js';
import { getSelectedCenter, withCenterParam } from './center.js';
import { menuPermissions, resourceForPath } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';
import { mountAppShell } from './app-shell.js';
import { applicationAreaForPath } from './workspace-navigation.js';

const body = document.body;
const params = new URLSearchParams(location.search);
const embedded =
  params.get('embedded') === '1' ||
  (params.has('portal_task') && parent !== window);
if (embedded) body.classList.add('work-embedded');
else mountWorkspace();

function mountWorkspace() {
  const header = body.querySelector(':scope > header, #app > header');
  const main = body.querySelector(':scope > main, #app');
  if (!header || !main) return;
  const title = (
    header.querySelector('h1,strong')?.textContent ||
    document.title.split('·')[0]
  )
    .replace(/^[\s\p{Extended_Pictographic}\uFE0F\u200D]+/u, '')
    .trim();
  const shell = mountAppShell({
    area: applicationAreaForPath(),
    title,
    main,
    legacyHeader: header,
    onSignOut: signOut,
  });
  let navigationContext;
  let navigationCenter;
  const stopFeatures = subscribePrivateFeatures(() => {
    if (navigationContext) renderNavigation();
  });
  addEventListener('pagehide', (event) => {
    if (!event.persisted) stopFeatures();
  });
  updateCenter();
  const centerHost = document.getElementById('center-switcher');
  if (centerHost)
    centerHost.addEventListener('app-center-bind', () =>
      queueMicrotask(updateCenter),
    );
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-center-code]'))
      queueMicrotask(updateCenter);
  });
  improveInputs(main);
  mountSectionNavigation(main);
  loadNavigation().catch((error) => {
    console.warn('[workspace] 메뉴를 불러오지 못했습니다:', error);
    shell.updateContext({ center: getSelectedCenter()?.code });
  });

  function updateCenter() {
    shell.updateContext({ center: getSelectedCenter()?.code });
    if (navigationContext && navigationCenter !== getSelectedCenter()?.code)
      renderNavigation();
  }
  async function loadNavigation() {
    const [profile, permissions] = await Promise.all([
      getCurrentProfile(),
      menuPermissions(),
    ]);
    if (!profile?.active) return;
    navigationContext = { profile, permissions };
    renderNavigation();
  }
  function renderNavigation() {
    const { profile, permissions } = navigationContext;
    const selected = getSelectedCenter();
    navigationCenter = selected?.code;
    shell.updateContext({ profile, permissions, center: selected?.code });
    if (applicationAreaForPath() !== 'admin') {
      shell.menus.replaceChildren();
      return;
    }
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', '관리 업무');
    shell.menus.replaceChildren(nav);
    const groups = {
      work: '업무 처리',
      reference: '기준정보',
      files: '파일 도구',
      system: '시스템',
    };
    const menus = selected
      ? getAdminMenus(profile, selected.code).filter((menu) => {
          if (menu.href === '/portal/') return false;
          const resource = resourceForPath(menu.href);
          return (
            !resource ||
            permissionAllowed(permissions, resource, 'read', selected.code)
          );
        })
      : [];
    for (const [category, title] of Object.entries(groups)) {
      const items = menus.filter(
        (menu) => categoryForPath(menu.href) === category,
      );
      if (!items.length) continue;
      const section = document.createElement('details');
      section.className = 'work-nav-group';
      section.open =
        category === 'reference' || items.some((menu) => activePath(menu.href));
      const summary = document.createElement('summary');
      summary.textContent = title;
      section.append(summary);
      for (const menu of items) section.append(makeLink(menu.href, menu.title));
      nav.append(section);
    }
    updateCenter();
  }
}

function activePath(href) {
  const pathname = new URL(href, location.origin).pathname;
  if (pathname === '/admin/')
    return ['/admin/', '/admin/index.html'].includes(location.pathname);
  if (
    pathname === '/admin/routes.html' &&
    location.pathname === '/admin/route-edit.html'
  )
    return true;
  return pathname === location.pathname;
}

function makeLink(href, title) {
  const link = document.createElement('a');
  link.href = withCenterParam(href);
  link.dataset.centerLink = 'true';
  link.className = 'app-function-link';
  const label = document.createElement('span');
  label.textContent = title;
  link.append(label);
  if (activePath(href)) link.setAttribute('aria-current', 'page');
  return link;
}

function improveInputs(main) {
  for (const input of main.querySelectorAll('input[type="search"]')) {
    if (!input.labels.length && !input.hasAttribute('aria-label'))
      input.setAttribute('aria-label', input.placeholder || '목록 검색');
  }
  for (const label of main.querySelectorAll('label.app-label:not([for])')) {
    const field = label.nextElementSibling;
    if (field?.matches('input[id],select[id],textarea[id]'))
      label.htmlFor = field.id;
  }
  for (const table of main.querySelectorAll(
    '.table-wrap,.table-scroll,.scroll',
  )) {
    if (!table.querySelector('table')) continue;
    table.setAttribute('tabindex', '0');
    table.setAttribute('role', 'region');
    table.setAttribute(
      'aria-label',
      table.getAttribute('aria-label') || '목록',
    );
  }
}

function mountSectionNavigation(main) {
  const sections = Array.from(
    main.querySelectorAll(':scope > section, :scope > fieldset > section'),
  ).filter((section) => !section.hidden && section.querySelector('h2,h3'));
  if (sections.length < 3) return;
  const nav = document.createElement('nav');
  nav.className = 'work-section-navigation';
  nav.setAttribute('aria-label', '작업 단계');
  for (const [index, section] of sections.entries()) {
    section.id ||= 'work-section-' + (index + 1);
    const link = document.createElement('a');
    link.href = '#' + section.id;
    link.textContent =
      section.getAttribute('aria-label') ||
      section.querySelector('h2,h3').textContent.trim();
    nav.append(link);
  }
  main.prepend(nav);
}

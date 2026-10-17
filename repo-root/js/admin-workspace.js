import { getCurrentProfile } from './auth.js';
import { getAdminMenus } from './admin-menu.js';
import { categoryForPath } from './admin-hub.js';
import { getSelectedCenter, withCenterParam } from './center.js';
import { menuPermissions, resourceForPath } from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';

const body = document.body;
const params = new URLSearchParams(location.search);
const embedded =
  params.get('embedded') === '1' ||
  (params.has('portal_task') && parent !== window);
if (embedded) body.classList.add('work-embedded');
else mountWorkspace();

function mountWorkspace() {
  const header = body.querySelector(':scope > header, #app > header');
  const toolbar =
    header?.firstElementChild?.tagName === 'DIV'
      ? header.firstElementChild
      : header;
  const main = body.querySelector(':scope > main, #app');
  if (!toolbar || !main) return;
  main.id ||= 'work-main';
  const skip = document.createElement('a');
  skip.className = 'work-skip';
  skip.href = '#' + main.id;
  skip.textContent = '본문으로 이동';
  main.setAttribute('tabindex', '-1');
  const sidebar = document.createElement('dialog');
  sidebar.id = 'work-navigation';
  sidebar.className = 'work-navigation';
  sidebar.setAttribute('aria-label', '업무 탐색');
  sidebar.innerHTML = `<div class="work-brand"><a href="/portal/">이안물류<small>통합 업무</small></a><button type="button" class="work-nav-close" aria-label="메뉴 닫기" title="메뉴 닫기">×</button></div>
    <div class="work-center"><span>현재 센터</span><strong></strong><a href="/admin/?selectCenter=1" data-fixed-center="true">센터 변경</a></div>
    <nav aria-label="업무 메뉴"></nav><div class="work-nav-footer">운영 관리</div>`;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'work-nav-toggle btn btn-ghost';
  toggle.setAttribute('aria-label', '업무 메뉴 열기');
  toggle.setAttribute('aria-controls', sidebar.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.title = '업무 메뉴 열기';
  toggle.textContent = '☰';
  body.prepend(skip, sidebar);
  toolbar.prepend(toggle);
  const mobile = matchMedia('(max-width: 1000px)');
  let navigationContext;
  let navigationCenter;
  function closeDrawer() {
    sidebar.close();
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }
  function syncDrawer() {
    if (sidebar.open) sidebar.close();
    toggle.setAttribute('aria-expanded', 'false');
    if (!mobile.matches) sidebar.setAttribute('open', '');
  }
  toggle.addEventListener('click', () => {
    sidebar.showModal();
    toggle.setAttribute('aria-expanded', 'true');
  });
  sidebar
    .querySelector('.work-nav-close')
    .addEventListener('click', closeDrawer);
  sidebar.addEventListener('cancel', () =>
    toggle.setAttribute('aria-expanded', 'false'),
  );
  sidebar.addEventListener('click', (event) => {
    if (event.target === sidebar && mobile.matches) closeDrawer();
    const link = event.target.closest('a[href]');
    if (link && link.dataset.centerLink === 'true')
      link.href = withCenterParam(link.href);
  });
  mobile.addEventListener('change', syncDrawer);
  syncDrawer();
  updateCenter();
  const centerHost = document.getElementById('center-switcher');
  if (centerHost)
    new MutationObserver(updateCenter).observe(centerHost, {
      childList: true,
      subtree: true,
    });
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-center-code]'))
      queueMicrotask(updateCenter);
  });
  improveInputs(main);
  mountSectionNavigation(main);
  loadNavigation().catch((error) => {
    console.warn('[workspace] 메뉴를 불러오지 못했습니다:', error);
    const nav = sidebar.querySelector('nav');
    nav.replaceChildren(makeLink('/portal/', '업무 포털'));
  });

  function updateCenter() {
    sidebar.querySelector('.work-center strong').textContent =
      getSelectedCenter()?.name || '센터 선택';
    sidebar.querySelector('.work-brand a').href = withCenterParam('/portal/');
    for (const link of header.querySelectorAll('a[href]')) {
      if (new URL(link.href).pathname.startsWith('/portal/'))
        link.href = withCenterParam(link.href);
    }
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
    const nav = sidebar.querySelector('nav');
    nav.replaceChildren();
    const quick = document.createElement('div');
    quick.className = 'work-nav-group';
    quick.append(makeLink('/portal/', '업무 포털'));
    if (profile.role === 'editor' || profile.role === 'admin')
      quick.append(makeLink('/', '코스표 대시보드'));
    const canManage =
      profile.role === 'editor' ||
      profile.role === 'admin' ||
      Object.entries(permissions.access || {}).some(
        ([key, access]) =>
          access.read &&
          ![
            'tasks',
            'incidents',
            'forms',
            'search',
            'notifications',
            'hq',
            'history',
            'trash',
          ].includes(key),
      );
    if (canManage) quick.append(makeLink('/admin/', '관리 허브'));
    nav.append(quick);
    const groups = {
      work: '업무 처리',
      reference: '기준정보',
      files: '파일 도구',
      system: '시스템',
    };
    const menus = selected
      ? getAdminMenus(profile).filter((menu) => {
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
      for (const menu of items)
        section.append(makeLink(menu.href, menu.title, menu.icon));
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

function makeLink(href, title, icon) {
  const link = document.createElement('a');
  link.href = withCenterParam(href);
  link.dataset.centerLink = 'true';
  if (icon) {
    const span = document.createElement('span');
    span.className = 'work-nav-icon';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = icon;
    link.append(span);
  }
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

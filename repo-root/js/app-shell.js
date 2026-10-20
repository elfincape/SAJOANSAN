import {
  CENTERS,
  getCenterByCode,
  getSelectedCenter,
  setSelectedCenterCode,
  withCenterParam,
} from './center.js';
import {
  applicationAreas,
  renderWorkspaceNavigation,
} from './workspace-navigation.js';
import { mountThemeToggle } from './theme.js';
import { mountWorkspaceScroll } from './workspace-scroll.js';

const areas = Object.fromEntries(
  applicationAreas.map(({ area, label }) => [area, label]),
);
let currentShell;

export function mountAppShell({
  area,
  title = areas[area],
  main,
  legacyHeader,
  menuContent,
  onCenterChange,
  onSignOut,
}) {
  if (currentShell) return currentShell;
  const body = document.body;
  body.classList.add('app-shell');
  body.dataset.appArea = area;
  main.classList.add('app-main');
  main.id ||= 'work-main';
  main.setAttribute('tabindex', '-1');
  document.title = title + ' · 이안물류';

  const skip = document.createElement('a');
  skip.className = 'app-skip';
  skip.href = '#' + main.id;
  skip.textContent = '본문으로 이동';
  const sidebar = document.createElement('dialog');
  sidebar.id = 'app-sidebar';
  sidebar.setAttribute('aria-label', '이안물류 업무 탐색');
  sidebar.innerHTML = `<div class="app-brand"><a href="/portal/">이안물류<small>통합 업무</small></a><button type="button" data-navigation-toggle aria-label="메뉴 닫기" title="메뉴 닫기">×</button></div><nav id="app-workspace-navigation" aria-label="주요 화면"></nav><div class="app-local-menu"></div>`;
  const menus = sidebar.querySelector('.app-local-menu');
  if (menuContent) menus.append(menuContent);
  const oldMenuWrapper = menus.querySelector('.sidebar-content');
  if (oldMenuWrapper) oldMenuWrapper.replaceWith(...oldMenuWrapper.childNodes);
  for (const icon of menus.querySelectorAll('.sidebar-group-label svg'))
    icon.remove();
  const header = document.createElement('header');
  header.id = 'app-header';
  header.innerHTML = `<div class="app-header-row"><button type="button" class="app-menu-toggle" data-navigation-toggle aria-label="업무 메뉴 열기" title="업무 메뉴 열기" aria-controls="app-sidebar" aria-expanded="false">☰</button><nav class="app-location" aria-label="현재 위치"></nav><div class="app-page-actions"></div><div class="app-header-controls"><label id="center-switcher" data-app-center="true"><span>센터</span><select id="app-center-select" aria-label="작업 센터"></select></label><button type="button" id="app-account-toggle" popovertarget="app-account-menu" aria-label="사용자 메뉴" title="사용자 메뉴"><span id="app-profile-label">사용자</span><span aria-hidden="true">⌄</span></button></div></div>`;
  const account = document.createElement('div');
  account.id = 'app-account-menu';
  account.setAttribute('popover', 'auto');
  const compatibility = document.createElement('div');
  compatibility.hidden = true;
  compatibility.id = 'app-legacy-hooks';
  const oldTitle = legacyHeader?.querySelector('h1, strong');
  const path = header.querySelector('.app-location');
  if (area === 'admin' && title !== areas.admin) {
    const parent = document.createElement('a');
    parent.href = '/admin/';
    parent.textContent = areas.admin;
    path.append(parent);
    const divider = document.createElement('span');
    divider.className = 'app-path-divider';
    divider.textContent = '/';
    divider.setAttribute('aria-hidden', 'true');
    path.append(divider);
  }
  const heading =
    oldTitle || document.createElement(area === 'portal' ? 'strong' : 'h1');
  heading.textContent = title;
  path.append(heading);
  const pageActions = header.querySelector('.app-page-actions');
  let logout;
  if (legacyHeader) {
    for (const element of legacyHeader.querySelectorAll(
      'a[href], button, #user-badge, #user',
    )) {
      if (element.matches('#user-badge, #user')) compatibility.append(element);
      else if (element.id === 'logout-btn') {
        logout = element;
        account.append(element);
      } else if (element.id === 'me-btn') account.append(element);
      else if (
        element.tagName === 'A' &&
        [
          '/',
          '/admin/',
          '/admin/index.html',
          '/portal/',
          '/portal/index.html',
        ].includes(new URL(element.href).pathname)
      )
        compatibility.append(element);
      else if (!element.classList.contains('theme-toggle'))
        pageActions.append(element);
    }
    legacyHeader.remove();
  }
  if (
    !compatibility.querySelector(area === 'portal' ? '#user' : '#user-badge') &&
    !document.getElementById(area === 'portal' ? 'user' : 'user-badge')
  ) {
    const hook = document.createElement('span');
    hook.id = area === 'portal' ? 'user' : 'user-badge';
    compatibility.append(hook);
  }
  if (!logout) {
    logout = document.createElement('button');
    logout.type = 'button';
    logout.textContent = '로그아웃';
    logout.addEventListener('click', () => {
      account.hidePopover();
      onSignOut?.();
    });
    account.append(logout);
  }
  body.prepend(skip, sidebar, header);
  body.append(account, compatibility);
  account.addEventListener('click', (event) => {
    if (event.target.closest('button') && account.matches(':popover-open'))
      account.hidePopover();
  });
  mountThemeToggle(header.querySelector('.app-header-controls'));

  const mobile = matchMedia('(max-width: 1000px)');
  const toggle = header.querySelector('.app-menu-toggle');
  const close = sidebar.querySelector('button');
  function closeDrawer(restoreFocus = true) {
    if (!mobile.matches) return;
    sidebar.close();
    toggle.setAttribute('aria-expanded', 'false');
    if (restoreFocus) toggle.focus();
  }
  function syncDrawer() {
    if (sidebar.open) sidebar.close();
    toggle.setAttribute('aria-expanded', 'false');
    if (!mobile.matches) sidebar.setAttribute('open', '');
  }
  toggle.addEventListener('click', () => {
    sidebar.showModal();
    toggle.setAttribute('aria-expanded', 'true');
    close.focus();
  });
  close.addEventListener('click', () => closeDrawer());
  sidebar.addEventListener('cancel', () => {
    toggle.setAttribute('aria-expanded', 'false');
  });
  sidebar.addEventListener('click', (event) => {
    if (event.target === sidebar) closeDrawer();
    const item = event.target.closest('a[href],button[data-view]');
    if (item) {
      closeDrawer(false);
      if (mobile.matches && item.matches('[data-view]'))
        document.getElementById('portal-title')?.focus();
    }
  });
  mobile.addEventListener('change', syncDrawer);
  syncDrawer();

  const centerHost = header.querySelector('#center-switcher');
  const centerSelect = header.querySelector('#app-center-select');
  const requestedCenter = new URLSearchParams(location.search).get('center');
  let context = {
    centers: area === 'portal' ? [] : CENTERS,
    center:
      area === 'portal'
        ? getCenterByCode(requestedCenter)?.code || requestedCenter || ''
        : getSelectedCenter()?.code,
  };
  let centerOptions;
  let navigationSignature;
  let changeCenter = onCenterChange;
  centerHost.addEventListener('app-center-bind', (event) => {
    changeCenter = (code) => {
      const next = getCenterByCode(code);
      setSelectedCenterCode(code);
      if (event.detail.onChange) event.detail.onChange(next);
      else
        location.assign(
          withCenterParam(
            location.pathname + location.search + location.hash,
            next,
          ),
        );
    };
    updateContext({ center: getSelectedCenter()?.code });
  });
  centerSelect.addEventListener('change', () => {
    if (changeCenter) changeCenter(centerSelect.value);
    else {
      const next = getCenterByCode(centerSelect.value);
      if (next) {
        setSelectedCenterCode(next.code);
        location.assign(
          withCenterParam(
            location.pathname + location.search + location.hash,
            next,
          ),
        );
      }
    }
  });
  function updateContext(next) {
    Object.assign(context, next);
    const options = JSON.stringify(context.centers || []);
    if (options !== centerOptions) {
      centerOptions = options;
      centerSelect.replaceChildren();
      const empty = document.createElement('option');
      empty.value = '';
      empty.textContent = '센터 선택';
      empty.disabled = true;
      centerSelect.append(empty);
      for (const center of context.centers || []) {
        const option = document.createElement('option');
        option.value = center.code;
        option.textContent =
          getCenterByCode(center.code)?.shortName ||
          center.shortName ||
          center.name;
        centerSelect.append(option);
      }
    }
    centerSelect.value = context.center || '';
    if (context.profile)
      header.querySelector('#app-profile-label').textContent =
        context.profile.display_name || context.profile.email || '사용자';
    const signature = JSON.stringify([
      context.profile?.role,
      context.permissions?.access,
      context.center,
    ]);
    if (signature !== navigationSignature) {
      navigationSignature = signature;
      renderWorkspaceNavigation(
        sidebar.querySelector('#app-workspace-navigation'),
        context,
      );
    }
    const portal = new URL('/portal/', location.origin);
    if (context.center) portal.searchParams.set('center', context.center);
    sidebar.querySelector('.app-brand a').href =
      portal.pathname + portal.search;
    const parentLink = path.querySelector('a');
    if (parentLink && getCenterByCode(context.center))
      parentLink.href = withCenterParam(
        '/admin/',
        getCenterByCode(context.center),
      );
  }
  currentShell = { header, sidebar, menus, updateContext };
  const headerSize = new ResizeObserver(() =>
    body.style.setProperty(
      '--app-header-height',
      header.getBoundingClientRect().height + 'px',
    ),
  );
  headerSize.observe(header);
  updateContext(context);
  normalizeHeadings(main);
  mountWorkspaceScroll(main);
  const observer = new MutationObserver((records) => {
    for (const record of records)
      for (const added of record.addedNodes)
        if (added.nodeType === 1) normalizeHeadings(added);
  });
  observer.observe(main, { childList: true, subtree: true });
  addEventListener('pagehide', () => {
    observer.disconnect();
    headerSize.disconnect();
  });
  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    normalizeHeadings(main);
    observer.observe(main, { childList: true, subtree: true });
    headerSize.observe(header);
  });
  return currentShell;
}

function normalizeHeadings(root) {
  const headings = [...root.querySelectorAll('h2,h3')];
  if (root.matches('h2,h3')) headings.unshift(root);
  for (const heading of headings) {
    heading.classList.add('app-function-title');
    for (const child of heading.childNodes) {
      if (child.nodeType === 3)
        child.textContent = child.textContent.replace(
          /^[\s\p{Extended_Pictographic}\uFE0F\u200D]+/u,
          '',
        );
    }
  }
}

const categoryPaths = {
  reference: ['routes', 'delivery-points', 'drivers', 'vehicles', 'companies'],
  files: [
    'pdf-image-converter',
    'excel-compare',
    'pallet-slips',
    'daily-temperature',
    'export',
    'import',
    'image-straightener',
  ],
  system: ['notion-health', 'users', 'audit-log', 'settings'],
};

export function categoryForPath(href) {
  const path = new URL(href, location.origin).pathname
    .split('/')
    .pop()
    .replace(/\.html$/, '');
  return (
    Object.keys(categoryPaths).find((key) =>
      categoryPaths[key].includes(path),
    ) || 'work'
  );
}

export async function mountAdminHub(grid) {
  const input = document.getElementById('menu-search');
  const controls = document.getElementById('hub-categories');
  const count = document.getElementById('hub-result-count');
  const empty = document.getElementById('hub-empty');
  const reset = document.getElementById('hub-reset');
  if (!input || !controls || !count || !empty || !reset) return;

  const context = await menuPermissions();
  const items = Array.from(grid.children).filter(
    (item) => item.tagName === 'A',
  );
  const allowed = (item) => {
    const target = new URL(item.href, location.href);
    const resource = resourceForPath(target.pathname);
    return (
      !resource ||
      permissionAllowed(
        context,
        resource,
        'read',
        permissionCenterForUrl(target, permissionCenterForUrl(location.href)),
      )
    );
  };
  const available = items.filter(allowed);
  const buttons = Array.from(controls.querySelectorAll('[data-hub-category]'));
  let selected = 'all';

  for (const item of items) {
    item.dataset.category =
      item.id === 'permission-center-card'
        ? 'system'
        : categoryForPath(item.href);
    item.classList.add('hub-tool');
  }

  function update() {
    const term = input.value.trim().toLocaleLowerCase('ko');
    let visible = 0;
    for (const item of items) {
      const matches =
        (selected === 'all' || item.dataset.category === selected) &&
        item.textContent.toLocaleLowerCase('ko').includes(term);
      item.dataset.hubFiltered = String(!matches);
      item.hidden = !matches || !allowed(item);
      if (!item.hidden) visible++;
    }
    for (const button of buttons) {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.hubCategory === selected),
      );
    }
    count.textContent = `${visible}개 도구 · 사용 가능한 전체 ${available.length}개`;
    empty.hidden = visible > 0;
  }

  input.addEventListener('input', update);
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      update();
    }
  });
  controls.addEventListener('click', (event) => {
    const button = event.target.closest('[data-hub-category]');
    if (!button || !controls.contains(button)) return;
    selected = button.dataset.hubCategory;
    update();
  });
  reset.addEventListener('click', () => {
    selected = 'all';
    input.value = '';
    update();
    input.focus();
  });
  update();
}
import {
  menuPermissions,
  permissionCenterForUrl,
  resourceForPath,
} from './menu-permissions.js';
import { permissionAllowed } from './portal-permissions.js';

const storageKey = 'sajo.appearance.v1';
const root = document.documentElement;
let toggle;

function savedTheme() {
  try {
    return localStorage.getItem(storageKey) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyTheme(theme) {
  root.dataset.theme = theme;
  if (!toggle) return;
  const dark = theme === 'dark';
  const label = dark ? '라이트 모드로 전환' : '다크 모드로 전환';
  toggle.textContent = dark ? '☀' : '☾';
  toggle.title = label;
  toggle.setAttribute('aria-label', label);
  toggle.setAttribute('aria-pressed', String(dark));
}

applyTheme(savedTheme());
addEventListener('storage', (event) => {
  if (event.key === storageKey || event.key === null) applyTheme(savedTheme());
});

function mountToggle() {
  if (
    parent !== window &&
    new URLSearchParams(location.search).has('portal_task')
  )
    return;
  toggle = document.createElement('button');
  toggle.id = 'theme-toggle';
  toggle.type = 'button';
  toggle.className = 'theme-toggle btn btn-ghost';
  toggle.addEventListener('click', () => {
    const theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(theme);
    try {
      localStorage.setItem(storageKey, theme);
    } catch {
      /* Current-page mode still works without storage. */
    }
  });
  const header = document.querySelector(
    '.portal-header, body > header, #app > header',
  );
  const host =
    header?.querySelector('.portal-identity') ||
    (header?.firstElementChild?.tagName === 'DIV'
      ? header.firstElementChild
      : header);
  if (host) host.append(toggle);
  else {
    toggle.classList.add('theme-toggle-floating');
    document.body.append(toggle);
  }
  applyTheme(root.dataset.theme);
}

if (document.readyState === 'loading')
  addEventListener('DOMContentLoaded', mountToggle, { once: true });
else mountToggle();

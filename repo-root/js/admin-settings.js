import { requireRole, signOut } from './auth.js';
import { requireSelectedCenter, withCenterParam } from './center.js';
import {
  CONFIGURABLE_FEATURES,
  FEATURE_CATEGORIES,
} from './feature-catalog.mjs';
import {
  PRIVATE_FEATURE_DEFAULTS,
  isPrivateFeatureOwner,
  loadPrivateFeatures,
  savePrivateFeatures,
  subscribePrivateFeatures,
} from './private-features.js';

const profile = await requireRole('admin');
if (profile) {
  if (!isPrivateFeatureOwner(profile)) location.replace('/admin/');
  else mountSettings();
}
async function mountSettings() {
  const center = await requireSelectedCenter();
  document.querySelector('a[href="/admin/"]').href = withCenterParam(
    '/admin/',
    center,
  );
  document.getElementById('logout-btn').addEventListener('click', signOut);
  const root = document.getElementById('feature-groups'),
    status = document.getElementById('save-status'),
    search = document.getElementById('feature-search'),
    count = document.getElementById('feature-count');
  let features = loadPrivateFeatures(profile);
  const rows = new Map(),
    sections = [];
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  for (const [key, title] of Object.entries(FEATURE_CATEGORIES)) {
    const section = el('section'),
      heading = el('h3', title),
      panel = el('div', undefined, 'feature-panel');
    section.append(heading, panel);
    root.append(section);
    sections.push(section);
    for (const feature of CONFIGURABLE_FEATURES.filter(
      (f) => f.category === key,
    )) {
      const row = el('div', undefined, 'feature-row'),
        text = el('div', undefined, 'feature-label'),
        label = el('strong', feature.title),
        details = el('p', undefined, 'feature-description');
      details.textContent = [
        feature.desc,
        feature.centers.length
          ? '적용 센터: ' +
            feature.centers
              .map((code) =>
                code === '002' ? '평택' : code === '001' ? '안산' : code,
              )
              .join(', ')
          : '모든 지원 센터',
        feature.adminOnly
          ? '관리자 전용'
          : feature.ownerOnly
            ? '소유자 전용'
            : '페이지 권한 조건 적용',
      ]
        .filter(Boolean)
        .join(' · ');
      const id = 'feature-' + feature.id;
      label.id = id;
      text.append(label, details);
      const toggle = el('button', undefined, 'feature-switch');
      toggle.type = 'button';
      toggle.role = 'switch';
      toggle.dataset.feature = feature.id;
      toggle.setAttribute('aria-labelledby', id);
      const state = el('span', undefined, 'feature-state');
      row.append(text, state, toggle);
      panel.append(row);
      rows.set(feature.id, { row, toggle, state, feature });
    }
  }
  function render() {
    const term = search.value.trim().toLocaleLowerCase('ko');
    let visible = 0,
      enabled = 0;
    for (const { row, toggle, state, feature } of rows.values()) {
      const on = features[feature.id];
      toggle.setAttribute('aria-checked', String(on));
      state.textContent = on ? '켜짐' : '꺼짐';
      row.hidden = ![feature.title, feature.desc, row.textContent]
        .join(' ')
        .toLocaleLowerCase('ko')
        .includes(term);
      if (!row.hidden) {
        visible++;
        if (on) enabled++;
      }
    }
    for (const section of sections)
      section.hidden = ![...section.querySelectorAll('.feature-row')].some(
        (row) => !row.hidden,
      );
    count.textContent = visible + '개 기능 · 켜짐 ' + enabled + '개';
    document.getElementById('feature-empty').hidden = visible > 0;
    for (const id of ['enable-all', 'disable-all'])
      document.getElementById(id).disabled = visible === 0;
  }
  function persist(next) {
    if (!savePrivateFeatures(profile, next)) {
      status.textContent =
        '저장하지 못했습니다. 브라우저 저장 공간 설정을 확인하고 다시 시도하세요.';
      status.setAttribute('role', 'alert');
      return;
    }
    status.setAttribute('role', 'status');
    status.textContent =
      '이 브라우저에 저장했습니다. 관리 허브와 열린 탭의 메뉴에 반영됩니다.';
  }
  root.addEventListener('click', (event) => {
    const toggle = event.target.closest('[data-feature]');
    if (toggle)
      persist({
        ...features,
        [toggle.dataset.feature]: !features[toggle.dataset.feature],
      });
  });
  search.addEventListener('input', render);
  for (const [id, value] of [
    ['enable-all', true],
    ['disable-all', false],
  ])
    document.getElementById(id).addEventListener('click', () =>
      persist({
        ...features,
        ...Object.fromEntries(
          [...rows]
            .filter(([, entry]) => !entry.row.hidden)
            .map(([key]) => [key, value]),
        ),
      }),
    );
  document
    .getElementById('reset-defaults')
    .addEventListener('click', () => persist({ ...PRIVATE_FEATURE_DEFAULTS }));
  const stop = subscribePrivateFeatures(() => {
    features = loadPrivateFeatures(profile);
    render();
  });
  addEventListener('pagehide', (event) => {
    if (!event.persisted) stop();
  });
  render();
}

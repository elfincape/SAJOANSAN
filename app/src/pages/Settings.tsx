import '../styles/settings.css';
import { useEffect, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { CONFIGURABLE_FEATURES, FEATURE_CATEGORIES } from '../domain/feature-catalog';
import type { Feature } from '../domain/feature-catalog';
import { PRIVATE_FEATURE_DEFAULTS, isPrivateFeatureOwner, loadPrivateFeatures, savePrivateFeatures, subscribePrivateFeatures } from '../lib/private-features';

function description(feature: Feature) {
  return [feature.desc, feature.centers.length ? '적용 센터: ' + feature.centers.map(code => code === '002' ? '평택' : code === '001' ? '안산' : code).join(', ') : '모든 지원 센터', feature.adminOnly ? '관리자 전용' : feature.ownerOnly ? '소유자 전용' : '페이지 권한 조건 적용'].filter(Boolean).join(' · ');
}
function SettingsContent() {
  const { profile } = useAdminPage();
  const [features, setFeatures] = useState(() => loadPrivateFeatures(profile));
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState({ text: '', error: false });
  useEffect(() => {
    if (!isPrivateFeatureOwner(profile)) location.replace('/admin/');
    return subscribePrivateFeatures(() => setFeatures(loadPrivateFeatures(profile)));
  }, [profile]);
  if (!isPrivateFeatureOwner(profile)) return null;
  const term = search.trim().toLocaleLowerCase('ko');
  const visible = CONFIGURABLE_FEATURES.filter(feature => [feature.title, feature.desc, description(feature), features[feature.id] ? '켜짐' : '꺼짐'].join(' ').toLocaleLowerCase('ko').includes(term));
  function persist(next: Record<string, boolean>) {
    if (!savePrivateFeatures(profile, next)) setStatus({ text: '저장하지 못했습니다. 브라우저 저장 공간 설정을 확인하고 다시 시도하세요.', error: true });
    else setStatus({ text: '이 브라우저에 저장했습니다. 관리 허브와 열린 탭의 메뉴에 반영됩니다.', error: false });
  }
  return <main id="work-main" tabIndex={-1} className="app-main flex-1 max-w-3xl w-full mx-auto px-4 py-8">
    <div className="flex flex-wrap items-center gap-2 mb-6"><h2 className="app-function-title text-lg font-semibold mr-auto" style={{ fontSize: 20 }}>관리 허브 기능 표시</h2><button id="enable-all" className="btn btn-ghost" disabled={!visible.length} onClick={() => persist({ ...features, ...Object.fromEntries(visible.map(feature => [feature.id, true])) })}>검색 결과 켜기</button><button id="disable-all" className="btn btn-ghost" disabled={!visible.length} onClick={() => persist({ ...features, ...Object.fromEntries(visible.map(feature => [feature.id, false])) })}>검색 결과 끄기</button></div>
    <p className="feature-help">현재 브라우저의 메뉴 표시 설정입니다. 사용자 권한과는 별개이며, 기능을 켜도 접근 권한은 추가되지 않습니다. 기능이 등록되면 이 목록에도 함께 반영됩니다.</p>
    <div className="feature-toolbar"><label htmlFor="feature-search">기능 검색<input id="feature-search" type="search" className="app-input" placeholder="기능 이름·센터·설명 검색" value={search} onChange={event => setSearch(event.target.value)} /></label><span id="feature-count" role="status" aria-live="polite">{visible.length}개 기능 · 켜짐 {visible.filter(feature => features[feature.id]).length}개</span><button id="reset-defaults" className="btn btn-ghost" onClick={() => persist({ ...PRIVATE_FEATURE_DEFAULTS })}>기본값 복원</button></div>
    <div id="feature-groups" className="space-y-6">{Object.entries(FEATURE_CATEGORIES).map(([key, title]) => {
      const items = CONFIGURABLE_FEATURES.filter(feature => feature.category === key);
      return <section key={key} hidden={!visible.some(feature => feature.category === key)}><h3 className="app-function-title">{title}</h3><div className="feature-panel">{items.map(feature => <div key={feature.id} className="feature-row" hidden={!visible.includes(feature)}><div className="feature-label"><strong id={`feature-${feature.id}`}>{feature.title}</strong><p className="feature-description">{description(feature)}</p></div><span className="feature-state">{features[feature.id] ? '켜짐' : '꺼짐'}</span><button className="feature-switch" type="button" role="switch" data-feature={feature.id} aria-labelledby={`feature-${feature.id}`} aria-checked={features[feature.id]} onClick={() => persist({ ...features, [feature.id]: !features[feature.id] })} /></div>)}</div></section>;
    })}</div>
    <p id="feature-empty" hidden={visible.length > 0}>검색에 맞는 기능이 없습니다.</p><p className="feature-help">설정과 페이지별 권한 메뉴는 복구를 위해 항상 유지됩니다. 표시 설정은 이 계정의 현재 브라우저에 저장되며 다른 기기·다른 사용자에게는 적용되지 않습니다.</p>
    <p id="save-status" className="text-xs text-emerald-400 mt-5 min-h-5" aria-live="polite" role={status.error ? 'alert' : 'status'}>{status.text}</p>
  </main>;
}
export default function Settings() { return <AdminPage title="설정" minRole="admin" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><SettingsContent /></AdminPage>; }

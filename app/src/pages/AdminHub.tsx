import { Fragment, useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { FEATURE_CATALOG, FEATURE_CATEGORIES } from '../domain/feature-catalog';
import { loadPrivateFeatures, subscribePrivateFeatures } from '../lib/private-features';
import { featureAccessible } from '../lib/feature-access';
import { withCenterParam } from '../lib/center';
import '../styles/hub-directory.css';

function HubContent() {
  const { profile, permissions, center } = useAdminPage();
  const [features, setFeatures] = useState(() => loadPrivateFeatures(profile));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => subscribePrivateFeatures(() => setFeatures(loadPrivateFeatures(profile))), [profile]);
  const allowed = FEATURE_CATALOG.filter(feature => feature.href && feature.hub !== false && featureAccessible(feature, profile, permissions, center.code, features));
  const term = search.trim().toLocaleLowerCase('ko');
  const visible = allowed.filter(item => (category === 'all' || item.category === category) && [item.title, item.desc].filter(Boolean).join(' ').toLocaleLowerCase('ko').includes(term));
  return <main id="work-main" tabIndex={-1} className="hub-workspace hub-directory app-main flex-1 max-w-[1200px] w-full mx-auto px-4 py-8">
    <div className="hub-heading"><h2 className="app-function-title">{center.shortName} 관리 도구</h2><p>업무 목적에 맞는 도구를 분류별로 찾거나 검색하세요.</p></div>
    <section className="hub-controls" aria-label="관리 도구 찾기"><div className="hub-search"><label htmlFor="menu-search">도구 검색</label><input ref={input} id="menu-search" type="search" placeholder="코스, 기사, 엑셀 등 도구 이름 검색" autoComplete="off" aria-controls="menu-grid" value={search} onChange={event => setSearch(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setSearch(''); }} /></div>
      <div id="hub-categories" className="hub-categories" role="group" aria-label="도구 분류">{[['all', '전체'], ...Object.entries(FEATURE_CATEGORIES)].map(([key, title]) => <button key={key} type="button" data-hub-category={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{title}</button>)}</div>
    </section>
    <p id="hub-result-count" className="hub-result-count" role="status" aria-live="polite">{visible.length}개 도구 · 사용 가능한 전체 {allowed.length}개</p>
    <div id="menu-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{Object.entries(FEATURE_CATEGORIES).map(([key, title]) => <Fragment key={key}>
      <h3 id={`hub-group-${key}`} className="hub-group-heading" hidden={!visible.some(menu => menu.category === key)}>{title}</h3>
      {allowed.filter(menu => menu.category === key).map(menu => <a key={menu.id} href={withCenterParam(menu.href!, center)} data-category={menu.category} data-hub-filtered={String(!visible.includes(menu))} hidden={!visible.includes(menu)} className="group block rounded-lg border border-zinc-700 bg-zinc-800/40 hover:bg-zinc-800 hover:border-zinc-600 transition p-4 hub-tool"><h4 className="font-semibold app-function-title">{menu.title}</h4>{menu.desc ? <p>{menu.desc}</p> : null}</a>)}
    </Fragment>)}</div>
    <div id="hub-empty" className="hub-empty" hidden={visible.length > 0}><h2 className="app-function-title">조건에 맞는 도구가 없습니다</h2><p>검색어를 바꾸거나 전체 도구에서 다시 찾아보세요.</p><button id="hub-reset" type="button" className="btn" onClick={() => { setCategory('all'); setSearch(''); input.current?.focus(); }}>검색·분류 초기화</button></div>
  </main>;
}
export default function AdminHub() { return <AdminPage title="관리 허브" bodyClass="bg-zinc-900 text-zinc-100 min-h-screen flex flex-col"><HubContent /></AdminPage>; }

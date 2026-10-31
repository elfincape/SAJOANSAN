import { useEffect, useId, useRef, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  CalendarDays,
  ChevronRight,
  Files,
  ListTree,
  SlidersHorizontal,
  Route,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { FEATURE_CATALOG, FEATURE_CATEGORIES } from '../domain/feature-catalog';
import {
  loadPrivateFeatures,
  subscribePrivateFeatures,
} from '../lib/private-features';
import { featureAccessible } from '../lib/feature-access';
import { withCenterParam } from '../lib/center';
import '../styles/hub-directory.css';

const categoryIcons: Record<string, LucideIcon> = {
  dispatch: Route,
  transport: ListTree,
  daily: CalendarDays,
  documents: Files,
  administration: SlidersHorizontal,
};
function CategoryIcon({ category }: { category: string }) {
  const Icon = categoryIcons[category] ?? SlidersHorizontal;
  return (
    <Icon aria-hidden="true" data-menu-icon={category} size={22} strokeWidth={1.5} />
  );
}

function HubContent() {
  const { profile, permissions, center } = useAdminPage();
  const [features, setFeatures] = useState(() => loadPrivateFeatures(profile));
  const [search, setSearch] = useState<string>(() => history.state?.__workspaceHub?.search ?? '');
  const [pointerTabs, setPointerTabs] = useState(false);
  const [category, setCategory] = useState<string>(() => history.state?.__workspaceHub?.category ?? 'dispatch');
  useEffect(() => {
    history.replaceState({ ...history.state, __workspaceHub: { search, category } }, '', location.href);
  }, [search, category]);
  const input = useRef<HTMLInputElement>(null);
  const groupId = useId();
  const reducedMotion = useReducedMotion();
  const surfaceTransition = {
    duration: reducedMotion ? 0 : 0.22,
    ease: [0.22, 1, 0.36, 1] as const,
  };
  useEffect(
    () =>
      subscribePrivateFeatures(() => setFeatures(loadPrivateFeatures(profile))),
    [profile],
  );
  const allowed = FEATURE_CATALOG.filter(
    (feature) =>
      feature.href &&
      feature.hub !== false &&
      featureAccessible(feature, profile, permissions, center.code, features),
  );
  const categories = Object.entries(FEATURE_CATEGORIES).filter(([key]) =>
    allowed.some((item) => item.category === key),
  );
  const selected = categories.some(([key]) => key === category)
    ? category
    : (categories[0]?.[0] ?? '');
  const term = search.trim().toLocaleLowerCase('ko');
  const matches = allowed.filter((item) =>
    [item.title, item.desc]
      .filter(Boolean)
      .join(' ')
      .toLocaleLowerCase('ko')
      .includes(term),
  );
  const visible = term
    ? matches
    : matches.filter((item) => item.category === selected);
  function links(items: typeof allowed) {
    return items.map((menu) => (
      <motion.a
        layout="position"
        key={menu.id}
        href={withCenterParam(menu.href!, center)}
        data-category={menu.category}
        className="hub-tool"
      >
        <span>{menu.title}</span>
        <ChevronRight aria-hidden="true" size={18} strokeWidth={1.5} />
      </motion.a>
    ));
  }
  return (
    <main
      id="work-main"
      tabIndex={-1}
      className="hub-workspace hub-directory app-main"
    >
      <div className="hub-heading">
        <h2>관리 허브</h2>
        <div className="hub-search">
          <label className="sr-only" htmlFor="menu-search">
            기능 검색
          </label>
          <input
            ref={input}
            id="menu-search"
            name="menu-search"
            type="search"
            placeholder="기능 이름 검색…"
            autoComplete="off"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setSearch('');
            }}
          />
        </div>
      </div>
      <LayoutGroup id={groupId}>
        <Tabs.Root
          value={selected}
          onValueChange={(value) => {
            setCategory(value);
            setSearch('');
          }}
          orientation="horizontal"
          className="hub-browser"
        >
          <Tabs.List
            id="hub-categories"
            className="hub-categories"
            aria-label="업무 분류"
            data-pointer-focus={pointerTabs || undefined}
            onPointerDownCapture={() => setPointerTabs(true)}
            onKeyDownCapture={() => setPointerTabs(false)}
            onBlurCapture={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget))
                setPointerTabs(false);
            }}
          >
            {categories.map(([key, title]) => (
              <Tabs.Trigger
                key={key}
                value={key}
                className="hub-category"
                data-hub-category={key}
              >
                {selected === key && !term ? (
                  <motion.span
                    layoutId="category-selection"
                    className="hub-category-surface"
                    aria-hidden="true"
                    initial={false}
                    style={{ borderRadius: 18 }}
                    transition={surfaceTransition}
                  />
                ) : null}
                <span className="hub-category-meta">
                  <CategoryIcon category={key} />
                  <span>
                    {allowed.filter((item) => item.category === key).length}개
                  </span>
                </span>
                <span>{title}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <motion.div
            layout
            className="hub-results"
            style={{ borderRadius: 20 }}
            transition={surfaceTransition}
          >
            <motion.div layout="position" className="hub-results-heading">
              <h3>
                {term
                  ? '검색 결과'
                  : (FEATURE_CATEGORIES[
                      selected as keyof typeof FEATURE_CATEGORIES
                    ] ?? '기능')}
              </h3>
              <span id="hub-result-count" role="status" aria-live="polite">
                {visible.length}개
              </span>
            </motion.div>
            {categories.map(([key]) => (
              <Tabs.Content key={key} value={key} className="hub-tool-list">
                {links(
                  term
                    ? matches
                    : matches.filter((menu) => menu.category === key),
                )}
              </Tabs.Content>
            ))}
            {!visible.length ? (
              <div id="hub-empty" className="hub-empty">
                <p>
                  {term
                    ? '검색 결과가 없습니다.'
                    : '사용 가능한 기능이 없습니다.'}
                </p>
                {term ? (
                  <button
                    id="hub-reset"
                    type="button"
                    className="btn"
                    onClick={() => {
                      setSearch('');
                      input.current?.focus();
                    }}
                  >
                    검색 초기화
                  </button>
                ) : null}
              </div>
            ) : null}
          </motion.div>
        </Tabs.Root>
      </LayoutGroup>
    </main>
  );
}
export default function AdminHub() {
  return (
    <AdminPage title="관리 허브" bodyClass="min-h-screen flex flex-col">
      <HubContent />
    </AdminPage>
  );
}

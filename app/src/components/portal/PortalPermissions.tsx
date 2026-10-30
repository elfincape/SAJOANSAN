import { useEffect, useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { LayoutGroup, motion, useReducedMotion } from 'motion/react';
import {
  FEATURE_CATALOG,
  FEATURE_CATEGORIES,
} from '../../domain/feature-catalog';
import type {
  MemberPermission,
  MemberPermissionChange,
  PermissionConfig,
  PortalMember,
} from '../../domain/portal-types';
import {
  centerEditResources,
  effectivePermission,
  memberRoleLabels,
} from '../../domain/portal-permissions';
import { usePortal } from './PortalStore';
import { useFeedback } from '../useFeedback';
import { portalApi } from '../../lib/portal';
import '../../styles/portal-permissions.css';

function categoryFor(config: PermissionConfig) {
  const feature = FEATURE_CATALOG.find(
    (item) => item.resource === config.resource,
  );
  if (feature) return feature.category;
  if (
    [
      'tasks',
      'forms',
      'incidents',
      'hq',
      'briefing',
      'notifications',
      'history',
      'search',
      'trash',
    ].includes(config.resource)
  )
    return 'daily';
  if (['mail', 'backups', 'connections'].includes(config.resource))
    return 'documents';
  return 'administration';
}
function levelOf(access: {
  read: boolean;
  edit: boolean;
}): MemberPermission['level'] {
  return access.edit ? 'edit' : access.read ? 'read' : 'none';
}
function samePermission(
  a: MemberPermission | null,
  b: MemberPermission | null,
) {
  return a === null || b === null
    ? a === b
    : a.level === b.level && a.scope === b.scope;
}

function EmployeePermissions({
  person,
  onDirty,
}: {
  person: PortalMember;
  onDirty: (dirty: boolean) => void;
}) {
  const { state, mutate, centerName, viewState } = usePortal();
  const [drafts, setDrafts] = useState<Record<string, MemberPermission | null>>(
    {},
  );
  const [category, setCategory] = useState(() =>
    String(viewState.get('permissionCategory') ?? 'dispatch'),
  );
  const [previewCenter, setPreviewCenter] = useState(
    String(
      viewState.get('permissionPreviewCenter') ??
        person.centers[0] ??
        state.context?.centers[0]?.code ??
        '',
    ),
  );
  const reducedMotion = useReducedMotion();
  const rules = state.permissions.rules;
  const categories = Object.entries(FEATURE_CATEGORIES).filter(([key]) =>
    rules.some((rule) => categoryFor(rule) === key),
  );
  const selectedCategory = categories.some(([key]) => key === category)
    ? category
    : (categories[0]?.[0] ?? '');
  const changes: MemberPermissionChange[] = rules
    .filter((rule) =>
      Object.prototype.hasOwnProperty.call(drafts, rule.resource),
    )
    .map((rule) => ({
      resource: rule.resource,
      version: rule.version,
      permission: drafts[rule.resource],
    }));
  useEffect(() => {
    onDirty(changes.length > 0);
  }, [changes.length, onDirty]);
  function permissionFor(config: PermissionConfig) {
    return Object.prototype.hasOwnProperty.call(drafts, config.resource)
      ? drafts[config.resource]
      : (config.member_overrides?.[person.id] ?? null);
  }
  function previewConfig(config: PermissionConfig) {
    if (!Object.prototype.hasOwnProperty.call(drafts, config.resource))
      return config;
    const member_overrides = { ...config.member_overrides };
    const permission = permissionFor(config);
    if (permission) member_overrides[person.id] = permission;
    else delete member_overrides[person.id];
    return { ...config, member_overrides };
  }
  function change(
    config: PermissionConfig,
    permission: MemberPermission | null,
  ) {
    setDrafts((previous) => {
      const next = { ...previous };
      if (
        samePermission(permission, config.member_overrides?.[person.id] ?? null)
      )
        delete next[config.resource];
      else next[config.resource] = permission;
      return next;
    });
  }
  async function save() {
    if (!changes.length || state.busy || person.role === 'admin') return;
    const saved = await mutate(
      JSON.stringify([
        'member-permissions',
        person.id,
        person.display_name,
        person.role,
        person.centers,
        changes,
      ]),
      (requestId) =>
        portalApi.updateMemberPermissions({ requestId, person, changes }),
    );
    if (saved) setDrafts({});
  }
  return (
    <section
      className="employee-permission-editor"
      aria-labelledby="employee-permission-title"
    >
      <header className="employee-permission-heading">
        <div>
          <h2 id="employee-permission-title">{person.name}</h2>
          <div className="employee-permission-meta">
            <span>{memberRoleLabels[person.role] ?? person.role}</span>
            <span>{person.active ? '활성' : '비활성 · 접근 불가'}</span>
            <span>
              담당 센터: {person.centers.map(centerName).join(' · ') || '없음'}
            </span>
          </div>
          <a
            href={`/portal/?view=members&user=${encodeURIComponent(person.id)}`}
          >
            역할·센터 변경
          </a>
        </div>
        <div className="employee-permission-save">
          <span role="status">
            {changes.length
              ? `${changes.length}개 업무 변경 · 저장 전`
              : '저장된 권한'}
          </span>
          <button
            type="button"
            className="primary"
            disabled={state.busy || !changes.length || person.role === 'admin'}
            onClick={() => void save()}
          >
            {state.busy ? '저장 중…' : '변경사항 저장'}
          </button>
        </div>
      </header>
      {person.role === 'admin' ? (
        <p className="employee-permission-notice">
          관리자 · 모든 업무와 센터에 접근 가능
        </p>
      ) : !person.active ? (
        <p className="employee-permission-notice">
          비활성 계정 · 설정을 저장해도 계정이 활성화되기 전에는 접근할 수
          없습니다.
        </p>
      ) : null}
      <div className="employee-permission-preview">
        <label>
          적용 확인 센터
          <select
            value={previewCenter}
            onChange={(event) => {
              setPreviewCenter(event.target.value);
              viewState.set('permissionPreviewCenter', event.target.value);
            }}
          >
            {state.context?.centers.map((center) => (
              <option key={center.code} value={center.code}>
                {centerName(center.code)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <LayoutGroup id={`employee-permissions-${person.id}`}>
        <Tabs.Root
          value={selectedCategory}
          onValueChange={(value) => {
            setCategory(value);
            viewState.set('permissionCategory', value);
          }}
          className="employee-permission-tabs"
        >
          <Tabs.List
            aria-label="업무 분류"
            className="employee-permission-categories"
          >
            {categories.map(([key, title]) => (
              <Tabs.Trigger
                key={key}
                value={key}
                className="employee-permission-category"
              >
                {selectedCategory === key ? (
                  <motion.span
                    aria-hidden="true"
                    className="workspace-selection"
                    layoutId="employee-category"
                    style={{ borderRadius: 10 }}
                    transition={
                      reducedMotion
                        ? { duration: 0 }
                        : { type: 'spring', stiffness: 420, damping: 38 }
                    }
                  />
                ) : null}
                {title}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          {categories.map(([key]) => (
            <Tabs.Content
              key={key}
              value={key}
              className="employee-permission-panel"
            >
              <div
                className="employee-permission-table"
                role="region"
                aria-label={`${FEATURE_CATEGORIES[key as keyof typeof FEATURE_CATEGORIES]} 권한`}
                tabIndex={0}
              >
                <table>
                  <thead>
                    <tr>
                      <th scope="col">업무</th>
                      <th scope="col">권한</th>
                      <th scope="col">조회 범위</th>
                      <th scope="col">{centerName(previewCenter)} 적용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rules
                      .filter((config) => categoryFor(config) === key)
                      .map((config) => {
                        const permission = permissionFor(config);
                        const sharedTool = ['distance_tools', 'gimhae_dispatch'].includes(config.resource);
                        const effective = effectivePermission(
                          previewConfig(config),
                          person,
                          sharedTool ? undefined : previewCenter,
                        );
                        const level = permission?.level ?? 'inherit';
                        const fixed =
                          person.role === 'admin' || config.admin_only;
                        const editAllowed =
                          person.role === 'editor' ||
                          ['incidents', 'notifications'].includes(
                            config.resource,
                          );
                        const statusOnly =
                          config.resource === 'incidents' &&
                          person.role === 'viewer';
                        const editLabel =
                          config.resource === 'notifications'
                            ? '알림 확인'
                            : statusOnly
                              ? '처리 상태 변경'
                              : '수정';
                        const actualLabel = effective.edit
                          ? config.resource === 'notifications'
                            ? '알림 확인'
                            : statusOnly
                              ? '처리 상태 변경'
                              : '조회·수정'
                          : effective.read
                            ? '조회'
                            : '불가';
                        const related = [
                          ...new Set(
                            FEATURE_CATALOG.filter(
                              (feature) =>
                                feature.resource === config.resource &&
                                feature.title !== config.title,
                            ).map((feature) => feature.title),
                          ),
                        ];
                        return (
                          <tr
                            key={config.resource}
                            data-resource={config.resource}
                            data-changed={Object.prototype.hasOwnProperty.call(
                              drafts,
                              config.resource,
                            )}
                          >
                            <th scope="row">
                              <strong>{config.title}</strong>
                              {related.length > 0 ? (
                                <small>{related.join(' · ')}</small>
                              ) : null}
                              {config.admin_only ? (
                                <small>관리자 전용</small>
                              ) : null}
                            </th>
                            <td data-label="권한">
                              <label>
                                <span className="sr-only">
                                  {config.title} 권한
                                </span>
                                <select
                                  data-permission-level={config.resource}
                                  value={
                                    fixed
                                      ? person.role === 'admin'
                                        ? 'edit'
                                        : 'none'
                                      : level
                                  }
                                  disabled={state.busy || fixed}
                                  onChange={(event) =>
                                    change(
                                      config,
                                      event.target.value === 'inherit'
                                        ? null
                                        : {
                                            level: event.target
                                              .value as MemberPermission['level'],
                                            scope: sharedTool ? 'all' : permission?.scope ?? 'own',
                                          },
                                    )
                                  }
                                >
                                  <option value="inherit">기존 설정</option>
                                  <option value="none">불가</option>
                                  <option value="read">조회</option>
                                  <option value="edit" disabled={!editAllowed}>
                                    {editLabel}
                                  </option>
                                </select>
                              </label>
                              {fixed ? (
                                <small>
                                  {config.admin_only
                                    ? '관리자 전용'
                                    : '관리자 권한'}
                                </small>
                              ) : null}
                            </td>
                            <td data-label="조회 범위">
                              <label>
                                <span className="sr-only">
                                  {config.title} 조회 범위
                                </span>
                                <select
                                  data-permission-scope={config.resource}
                                  value={
                                    sharedTool || person.role === 'admin'
                                      ? 'all'
                                      : (permission?.scope ?? 'inherit')
                                  }
                                  disabled={
                                    state.busy ||
                                    sharedTool ||
                                    fixed ||
                                    !permission ||
                                    level === 'none'
                                  }
                                  onChange={(event) => {
                                    if (permission)
                                      change(config, {
                                        ...permission,
                                        scope: event.target
                                          .value as MemberPermission['scope'],
                                      });
                                  }}
                                >
                                  <option value="inherit">기존 범위</option>
                                  <option value="own">담당센터</option>
                                  <option value="all">{sharedTool ? '센터 무관' : '전체센터'}</option>
                                </select>
                              </label>
                              {level === 'edit' &&
                              centerEditResources.includes(config.resource) ? (
                                <small>수정은 담당센터만</small>
                              ) : null}
                            </td>
                            <td
                              data-label={`${centerName(previewCenter)} 적용`}
                            >
                              <span
                                className="employee-permission-effective"
                                data-level={levelOf(effective)}
                              >
                                {sharedTool ? `공용 · ${actualLabel}` : actualLabel}
                              </span>
                              {!person.active ? (
                                <small>계정 비활성</small>
                              ) : !editAllowed &&
                                permission?.level === 'edit' ? (
                                <small>조회 전용 역할</small>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </Tabs.Content>
          ))}
        </Tabs.Root>
      </LayoutGroup>
      {!rules.length ? (
        <p className="employee-permission-notice">등록된 업무 없음</p>
      ) : null}
    </section>
  );
}

export function PortalPermissions() {
  const { state, centerName, viewState } = usePortal();
  const [selected, setSelected] = useState(() =>
    String(
      viewState.get('permissionMemberId') ??
        new URLSearchParams(location.search).get('user') ??
        '',
    ),
  );
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const { confirm, feedback } = useFeedback();
  const members = state.members.filter((person) =>
    [person.name, person.email, ...person.centers.map(centerName)]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const person =
    state.members.find((person) => person.id === selected) ??
    state.members.find((person) => person.active && person.role !== 'admin') ??
    state.members[0];
  async function select(userId: string) {
    if (userId === person?.id || state.busy) return;
    if (
      dirty &&
      !(await confirm('저장하지 않은 변경사항을 버리고 직원을 변경할까요?', {
        okText: '변경사항 버리기',
        cancelText: '계속 편집',
      }))
    )
      return;
    setDirty(false);
    setSelected(userId);
    viewState.set('permissionMemberId', userId);
  }
  return (
    <>
      <div className="employee-permission-workspace">
        <section
          className="employee-permission-directory"
          aria-label="직원 목록"
        >
          <div className="employee-permission-list-heading">
            <h2>직원</h2>
            <span>{members.length}명</span>
          </div>
          <label className="employee-permission-search">
            <span className="sr-only">직원 검색</span>
            <input
              type="search"
              name="permission_member_search"
              placeholder="직원 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="employee-permission-mobile-select">
            직원 선택
            <select
              value={person?.id ?? ''}
              disabled={state.busy}
              onChange={(event) => void select(event.target.value)}
            >
              {person && !members.some((member) => member.id === person.id) ? (
                <option value={person.id}>{person.name} (현재 편집)</option>
              ) : null}
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>
          <div className="employee-permission-people">
            {members.map((member) => (
              <button
                type="button"
                key={member.id}
                data-permission-member={member.id}
                aria-pressed={person?.id === member.id}
                disabled={state.busy}
                onClick={() => void select(member.id)}
              >
                <strong>{member.name}</strong>
                <span>
                  {member.active
                    ? member.centers.map(centerName).join(' · ') ||
                      memberRoleLabels[member.role] ||
                      member.role
                    : '비활성'}
                </span>
              </button>
            ))}
          </div>
          {!members.length ? (
            <p className="employee-permission-notice">검색 결과 없음</p>
          ) : null}
        </section>
        {person ? (
          <EmployeePermissions
            key={
              person.id +
              JSON.stringify(person) +
              JSON.stringify(state.permissions.rules)
            }
            person={person}
            onDirty={setDirty}
          />
        ) : (
          <section className="employee-permission-editor">
            <h2>등록된 직원 없음</h2>
          </section>
        )}
      </div>
      {feedback}
    </>
  );
}

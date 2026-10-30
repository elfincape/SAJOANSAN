import { Fragment, useEffect, useState } from 'react';
import { FEATURE_CATALOG } from '../../domain/feature-catalog';
import { PORTAL_VIEWS } from '../../domain/portal-navigation';
import { viewResource } from '../../domain/portal-types';
import type {
  PermissionConfig,
  PermissionRule,
} from '../../domain/portal-types';
import {
  centerEditResources,
  effectivePermission,
} from '../../domain/portal-permissions';
import { usePortal } from './PortalStore';
import { useFeedback } from '../useFeedback';
import { portalApi } from '../../lib/portal';
import '../../styles/portal-permissions.css';

function relatedPages(resource: string) {
  return [
    ...new Set([
      ...FEATURE_CATALOG.filter((feature) => feature.resource === resource).map(
        (feature) => feature.title,
      ),
      ...PORTAL_VIEWS.filter((view) => viewResource(view.id) === resource).map(
        (view) => view.title,
      ),
    ]),
  ];
}

function PermissionEditor({
  config,
  onDirty,
}: {
  config: PermissionConfig;
  onDirty: (dirty: boolean) => void;
}) {
  const { state, mutate, centerName } = usePortal();
  const [read, setRead] = useState(config.read_rule);
  const [write, setWrite] = useState(config.write_rule);
  const [role, setRole] = useState('editor');
  const [centers, setCenters] = useState<string[]>([]);
  const viewerWrite = ['incidents', 'notifications'].includes(config.resource);
  const normalize = (
    rule: PermissionRule,
    writing: boolean,
  ): PermissionRule => ({
    everyone: rule.everyone === true,
    roles: [
      'admin',
      ...['editor', 'viewer'].filter(
        (role) =>
          (rule.roles ?? []).includes(role) &&
          !(writing && role === 'viewer' && !viewerWrite),
      ),
    ],
    centers: (state.context?.centers ?? [])
      .filter((c) => (rule.centers ?? []).includes(c.code))
      .map((c) => c.code)
      .sort(),
    scope: rule.scope,
  });
  const data = { read: normalize(read, false), write: normalize(write, true) };
  const [saved, setSaved] = useState(() => JSON.stringify(data));
  const dirty = JSON.stringify(data) !== saved;
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const columns = [
    {
      key: 'read_rule',
      title: '열람',
      rule: read,
      set: setRead,
      writing: false,
    },
    {
      key: 'write_rule',
      title: '수정',
      rule: write,
      set: setWrite,
      writing: true,
    },
  ];
  function toggle(
    rule: PermissionRule,
    key: 'roles' | 'centers',
    value: string,
    checked: boolean,
  ) {
    return {
      ...rule,
      [key]: checked
        ? [...(rule[key] ?? []), value]
        : (rule[key] ?? []).filter((item) => item !== value),
    };
  }
  const formId = `permission-form-${config.resource}`;
  const pages = relatedPages(config.resource).filter(
    (title) => title !== config.title,
  );
  return (
    <>
      <header className="permission-editor-heading">
        <div>
          <h2 id="permission-editor-title">{config.title}</h2>
          <span className="permission-save-state" role="status">
            {config.admin_only
              ? '관리자 전용 · 변경 불가'
              : dirty
                ? '저장하지 않은 변경사항'
                : '저장된 권한'}
          </span>
        </div>
        {!config.admin_only ? (
          <button
            type="submit"
            form={formId}
            className="primary"
            disabled={state.busy || !dirty}
          >
            {state.busy ? '저장 중…' : '저장'}
          </button>
        ) : null}
      </header>
      {pages.length ? (
        <div className="permission-applies">
          <span>적용 화면</span>
          <span>{pages.join(' · ')}</span>
        </div>
      ) : null}
      {config.admin_only ? (
        <p className="permission-fixed-state">
          관리자만 열람·수정할 수 있습니다.
        </p>
      ) : (
        <>
          <form
            id={formId}
            className="portal-form permission-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (state.busy || !dirty) return;
              void mutate(
                JSON.stringify([
                  'permission',
                  config.resource,
                  config.version,
                  data,
                ]),
                (requestId) =>
                  portalApi.updatePermission({ requestId, config, ...data }),
              ).then((success) => {
                if (success) setSaved(JSON.stringify(data));
              });
            }}
          >
            <table className="permission-matrix">
              <thead>
                <tr>
                  <th scope="col">허용 대상</th>
                  <th scope="col">열람</th>
                  <th scope="col">수정</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row">활성 사용자 전체</th>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <input
                        type="checkbox"
                        name={`${column.key}_everyone`}
                        aria-label={`활성 사용자 전체 ${column.title}`}
                        checked={column.rule.everyone === true}
                        disabled={state.busy}
                        onChange={(event) =>
                          column.set({
                            ...column.rule,
                            everyone: event.target.checked,
                          })
                        }
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">
                    관리자{' '}
                    <span className="permission-fixed-label">항상 허용</span>
                  </th>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <input
                        type="checkbox"
                        name={`${column.key}_admin`}
                        aria-label={`관리자 ${column.title} 항상 허용`}
                        checked
                        disabled
                      />
                    </td>
                  ))}
                </tr>
                {(
                  [
                    ['editor', '센터 업무 담당'],
                    ['viewer', '조회 전용'],
                  ] as const
                ).map(([value, title]) => (
                  <tr key={value}>
                    <th scope="row">{title}</th>
                    {columns.map((column) => {
                      const restricted =
                        column.writing && value === 'viewer' && !viewerWrite;
                      return (
                        <td key={column.key}>
                          <input
                            type="checkbox"
                            name={`${column.key}_${value}`}
                            aria-label={`${title} ${column.title}`}
                            checked={(column.rule.roles ?? []).includes(value)}
                            disabled={
                              state.busy || column.rule.everyone || restricted
                            }
                            data-permanently-disabled={String(restricted)}
                            onChange={(event) =>
                              column.set(
                                toggle(
                                  column.rule,
                                  'roles',
                                  value,
                                  event.target.checked,
                                ),
                              )
                            }
                          />
                          {restricted ? (
                            <span className="permission-restricted">
                              허용 불가
                            </span>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tbody>
                <tr className="permission-section-row">
                  <th colSpan={3}>
                    사용자의 담당 센터{' '}
                    <span>역할 또는 아래 센터 중 하나 충족</span>
                  </th>
                </tr>
                {state.context?.centers.map((center) => (
                  <tr key={center.code}>
                    <th scope="row">{centerName(center.code)}</th>
                    {columns.map((column) => (
                      <td key={column.key}>
                        <input
                          type="checkbox"
                          name={`${column.key}_center_${center.code}`}
                          aria-label={`${centerName(center.code)} 소속 사용자 ${column.title}`}
                          checked={(column.rule.centers ?? []).includes(
                            center.code,
                          )}
                          disabled={state.busy || column.rule.everyone}
                          onChange={(event) =>
                            column.set(
                              toggle(
                                column.rule,
                                'centers',
                                center.code,
                                event.target.checked,
                              ),
                            )
                          }
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tbody>
                <tr className="permission-section-row">
                  <th colSpan={3}>접근할 자료 범위</th>
                </tr>
                <tr>
                  <th scope="row">센터 자료</th>
                  {columns.map((column) => (
                    <td key={column.key}>
                      <select
                        name={`${column.key}_scope`}
                        aria-label={`${column.title} 자료 범위`}
                        value={column.rule.scope}
                        disabled={state.busy}
                        onChange={(event) =>
                          column.set({
                            ...column.rule,
                            scope: event.target.value,
                          })
                        }
                      >
                        <option value="all">전체 센터</option>
                        <option value="own">담당센터</option>
                      </select>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
            <div className="permission-policy" aria-label="적용 제한">
              <span>수정 허용에는 열람 포함</span>
              <span>
                {centerEditResources.includes(config.resource)
                  ? '수정은 본인 담당 센터로 제한'
                  : config.resource === 'incidents'
                    ? '조회 전용: 처리완료·재개만 허용'
                    : config.resource === 'notifications'
                      ? '수정 권한은 알림 확인에만 적용'
                      : '조회 전용은 수정 불가'}
              </span>
              {['routes', 'delivery_points'].includes(config.resource) ? (
                <span>대시보드 조회: 코스·납품처 열람 모두 필요</span>
              ) : null}
              {['charter', 'delivery_points'].includes(config.resource) ? (
                <span>
                  가배차 작업: 용차 권한 · 상차·착지 설정: 납품처 권한
                </span>
              ) : null}
            </div>
          </form>
          <details className="permission-simulation">
            <summary>적용 결과 확인</summary>
            <div className="permission-preview-controls">
              <label>
                사용자 역할
                <select
                  aria-label="미리볼 사용자 역할"
                  value={role}
                  onChange={(event) => setRole(event.target.value)}
                >
                  <option value="editor">센터 업무 담당</option>
                  <option value="viewer">조회 전용</option>
                  <option value="admin">관리자</option>
                </select>
              </label>
              <fieldset>
                <legend>담당 센터</legend>
                {state.context?.centers.map((center) => (
                  <label key={center.code}>
                    <input
                      type="checkbox"
                      name={`preview_${center.code}`}
                      checked={centers.includes(center.code)}
                      onChange={(event) =>
                        setCenters((previous) =>
                          event.target.checked
                            ? [...previous, center.code]
                            : previous.filter((code) => code !== center.code),
                        )
                      }
                    />
                    {centerName(center.code)}
                  </label>
                ))}
              </fieldset>
            </div>
            <p className="permission-preview-status">
              현재 입력값 기준 · 저장 전 실제 권한에는 미반영
            </p>
            <div className="permission-preview-table">
              <table>
                <thead>
                  <tr>
                    <th>센터</th>
                    <th>적용 권한</th>
                  </tr>
                </thead>
                <tbody>
                  {state.context?.centers.map((center) => {
                    const access = effectivePermission(
                      {
                        ...config,
                        read_rule: data.read,
                        write_rule: data.write,
                      },
                      { active: true, role, centers },
                      center.code,
                    );
                    return (
                      <tr key={center.code}>
                        <th scope="row">{centerName(center.code)}</th>
                        <td>
                          {access.edit
                            ? config.resource === 'notifications'
                              ? '알림 확인'
                              : config.resource === 'incidents'
                                ? '열람·처리 상태 변경'
                                : '열람·수정'
                            : access.read
                              ? '열람 전용'
                              : '접근 불가'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </>
  );
}

export function PortalPermissions() {
  const { state, centerName, viewState } = usePortal();
  const [selected, setSelected] = useState(() =>
    String(viewState.get('permissionResource') ?? ''),
  );
  const [search, setSearch] = useState('');
  const [dirty, setDirty] = useState(false);
  const { confirm, feedback } = useFeedback();
  const order = ['포털', '운영관리 목록', '운영 관리', '도구'];
  const rules = [...state.permissions.rules].sort(
    (a, b) => order.indexOf(a.section) - order.indexOf(b.section),
  );
  const configs = rules.filter((config) =>
    [config.title, ...relatedPages(config.resource)]
      .join(' ')
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  const config =
    rules.find((config) => config.resource === selected) ??
    rules.find((config) => !config.admin_only) ??
    rules[0];
  let section = '';
  function summary(rule: PermissionRule) {
    const targets = rule.everyone
      ? '전체'
      : [
          ...(rule.roles ?? [])
            .filter((role) => role !== 'admin')
            .map((role) =>
              role === 'editor'
                ? '업무 담당'
                : role === 'viewer'
                  ? '조회'
                  : role,
            ),
          (rule.centers ?? []).length ? `${rule.centers!.length}개 센터` : '',
        ]
          .filter(Boolean)
          .join('·') || '관리자';
    return `${targets} / ${rule.scope === 'own' ? '담당 자료' : '전체 자료'}`;
  }
  function fullSummary(rule: PermissionRule) {
    return `${summary(rule)}${rule.centers?.length ? ` (${rule.centers.map(centerName).join(', ')})` : ''}`;
  }
  async function select(resource: string) {
    if (resource === config?.resource || state.busy) return;
    if (
      dirty &&
      !(await confirm('저장하지 않은 변경사항을 버리고 이동할까요?', {
        okText: '변경사항 버리기',
        cancelText: '계속 편집',
      }))
    )
      return;
    setDirty(false);
    setSelected(resource);
    viewState.set('permissionResource', resource);
  }
  return (
    <>
      <div className="workspace permission-workspace">
        <section
          className="permission-directory"
          aria-label="페이지별 권한 목록"
        >
          <div className="permission-list-heading">
            <h2>페이지</h2>
            <span>{configs.length}개</span>
          </div>
          <label className="permission-search">
            <span className="sr-only">페이지 검색</span>
            <input
              name="permission_search"
              type="search"
              placeholder="페이지 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="permission-mobile-select">
            페이지 선택
            <select
              value={config?.resource ?? ''}
              disabled={state.busy}
              onChange={(event) => void select(event.target.value)}
            >
              {config &&
              !configs.some((item) => item.resource === config.resource) ? (
                <option value={config.resource}>
                  {config.title} (현재 편집)
                </option>
              ) : null}
              {configs.map((config) => (
                <option key={config.resource} value={config.resource}>
                  {config.title}
                </option>
              ))}
            </select>
          </label>
          <div className="permission-directory-rows">
            <div className="permission-row-head" aria-hidden="true">
              <span>페이지</span>
              <span>열람</span>
              <span>수정</span>
            </div>
            {configs.map((rule) => {
              const heading = rule.section !== section;
              section = rule.section;
              return (
                <Fragment key={rule.resource}>
                  {heading ? <h3>{rule.section}</h3> : null}
                  <button
                    type="button"
                    className="permission-choice"
                    data-resource={rule.resource}
                    aria-pressed={rule.resource === config?.resource}
                    disabled={state.busy}
                    onClick={() => void select(rule.resource)}
                  >
                    <strong>{rule.title}</strong>
                    <span
                      title={
                        rule.admin_only
                          ? '관리자 전용'
                          : fullSummary(rule.read_rule)
                      }
                    >
                      <span className="sr-only">열람: </span>
                      {rule.admin_only
                        ? '관리자 전용'
                        : summary(rule.read_rule)}
                    </span>
                    <span
                      title={
                        rule.admin_only
                          ? '관리자 전용'
                          : fullSummary(rule.write_rule)
                      }
                    >
                      <span className="sr-only">수정: </span>
                      {rule.admin_only
                        ? '관리자 전용'
                        : summary(rule.write_rule)}
                    </span>
                  </button>
                </Fragment>
              );
            })}
          </div>
          {!configs.length ? (
            <p className="permission-empty" role="status">
              검색 결과 없음
            </p>
          ) : null}
        </section>
        <section
          className="permission-editor"
          aria-labelledby="permission-editor-title"
        >
          {config ? (
            <PermissionEditor
              key={config.resource + JSON.stringify(config)}
              config={config}
              onDirty={setDirty}
            />
          ) : (
            <h2 id="permission-editor-title">설정할 페이지 없음</h2>
          )}
        </section>
      </div>
      {feedback}
    </>
  );
}

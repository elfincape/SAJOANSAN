import { MentionText } from './PortalMentions';
import { Fragment, useState } from 'react';
import type {
  PermissionConfig,
  PermissionRule,
} from '../../domain/portal-types';
import { centerEditResources } from '../../domain/portal-permissions';
import { PortalPermissionPreview } from './PortalPermissionPreview';
import { usePortal } from './PortalStore';
import { portalApi } from '../../lib/portal';
function RuleEditor({
  title,
  name,
  rule,
  onChange,
  resource,
}: {
  title: string;
  name: string;
  rule: PermissionRule;
  onChange: (rule: PermissionRule) => void;
  resource: string;
}) {
  const { state, centerName } = usePortal(),
    write = name === 'write_rule',
    viewerWrite = ['incidents', 'notifications'].includes(resource);
  function toggle(key: 'roles' | 'centers', value: string, checked: boolean) {
    onChange({
      ...rule,
      [key]: checked
        ? [...(rule[key] ?? []), value]
        : rule[key]?.filter((v) => v !== value),
    });
  }
  return (
    <fieldset>
      <legend>
        <MentionText>{title}</MentionText>
      </legend>
      <label className="member-choice">
        활성 사용자 전체
        <input
          name={name + '_everyone'}
          type="checkbox"
          checked={rule.everyone === true}
          disabled={state.busy}
          onChange={(e) => onChange({ ...rule, everyone: e.target.checked })}
        />
      </label>
      <small>
        전체 허용을 끄면 아래 역할 또는 센터 소속 중 하나를 만족하는 사용자에게
        허용합니다.
      </small>
      <label className="member-choice">
        관리자 · 항상 허용
        <input name={name + '_admin'} type="checkbox" checked disabled />
      </label>
      {[
        ['editor', '센터 업무 담당'],
        ['viewer', '조회 전용'],
      ].map(([role, label]) => (
        <label key={role} className="member-choice">
          {label}
          <input
            name={name + '_' + role}
            type="checkbox"
            checked={(rule.roles ?? []).includes(role)}
            disabled={
              state.busy ||
              rule.everyone ||
              (write && role === 'viewer' && !viewerWrite)
            }
            data-permanently-disabled={String(
              write && role === 'viewer' && !viewerWrite,
            )}
            onChange={(e) => toggle('roles', role, e.target.checked)}
          />
        </label>
      ))}
      <fieldset>
        <legend>허용 대상의 담당 센터</legend>
        {state.context?.centers.map((c) => (
          <label key={c.code} className="member-choice">
            {centerName(c.code)}
            <input
              name={name + '_center_' + c.code}
              type="checkbox"
              checked={(rule.centers ?? []).includes(c.code)}
              disabled={state.busy || rule.everyone}
              onChange={(e) => toggle('centers', c.code, e.target.checked)}
            />
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>접근할 자료 범위</legend>
        {[
          ['all', '전체 센터 자료'],
          ['own', '본인 담당 센터 자료만'],
        ].map(([value, label]) => (
          <label key={value} className="member-choice">
            <input
              type="radio"
              name={name + '_scope'}
              value={value}
              checked={rule.scope === value}
              disabled={state.busy}
              onChange={() => onChange({ ...rule, scope: value })}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {write ? (
        <p>
          <MentionText>
            {centerEditResources.includes(resource)
              ? '실제 수정은 센터 업무 담당자의 담당 센터 안에서만 가능합니다. 전체 센터 자료를 선택해도 담당 밖 수정은 허용되지 않습니다.'
              : resource === 'incidents'
                ? '조회 전용도 허용 조건에 따라 처리완료·재개할 수 있습니다. 내용 작성·수정은 센터 담당 권한이 필요합니다.'
                : resource === 'notifications'
                  ? '알림 확인에 적용됩니다. 업무 내용 수정 권한을 부여하지 않습니다.'
                  : '조회 전용 사용자는 업무 내용을 수정할 수 없습니다.'}
          </MentionText>
        </p>
      ) : null}
    </fieldset>
  );
}
function PermissionEditor({ config }: { config: PermissionConfig }) {
  const { state, mutate, centerName } = usePortal(),
    [read, setRead] = useState(config.read_rule),
    [write, setWrite] = useState(config.write_rule),
    [role, setRole] = useState('editor'),
    [centers, setCenters] = useState<string[]>([]),
    normalize = (rule: PermissionRule, writing: boolean): PermissionRule => ({
      everyone: rule.everyone === true,
      roles: [
        'admin',
        ...['editor', 'viewer'].filter(
          (role) =>
            (rule.roles ?? []).includes(role) &&
            !(
              writing &&
              role === 'viewer' &&
              !['incidents', 'notifications'].includes(config.resource)
            ),
        ),
      ],
      centers: (state.context?.centers ?? [])
        .filter((c) => (rule.centers ?? []).includes(c.code))
        .map((c) => c.code)
        .sort(),
      scope: rule.scope,
    }),
    data = { read: normalize(read, false), write: normalize(write, true) };
  return (
    <>
      <h2>
        <MentionText>{config.title}</MentionText> 권한
      </h2>
      {['routes', 'delivery_points'].includes(config.resource) ? (
        <p>
          대시보드 코스 조회에는 코스와 납품처의 열람 권한이 모두 필요합니다.
          기사·차량·운수사 정보도 각 페이지의 열람 조건을 따릅니다.
        </p>
      ) : null}
      {['charter', 'delivery_points'].includes(config.resource) ? (
        <p>
          평택 가배차·용차 작업은 용차 권한, 가배차 화면의 기사 상차 기준·착지
          관계 설정은 납품처 권한을 따릅니다.
        </p>
      ) : null}
      {config.resource === 'dispatch_parser' ? (
        <p>배차정보 파서, 김해 가배차와 요청·회신 초안에 함께 적용됩니다.</p>
      ) : null}
      {config.admin_only ? (
        <p>
          계정·권한·외부 연결과 원본을 관리하는 관리자 전용 기능입니다. 일반
          사용자에게 허용할 수 없습니다.
        </p>
      ) : (
        <>
          <form
            className="portal-form permission-form"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate(
                JSON.stringify([
                  'permission',
                  config.resource,
                  config.version,
                  data,
                ]),
                (requestId) =>
                  portalApi.updatePermission({ requestId, config, ...data }),
              );
            }}
          >
            <div className="permission-columns">
              <RuleEditor
                title="열람 허용"
                name="read_rule"
                resource={config.resource}
                rule={read}
                onChange={setRead}
              />
              <RuleEditor
                title="수정 허용"
                name="write_rule"
                resource={config.resource}
                rule={write}
                onChange={setWrite}
              />
            </div>
            <p>
              담당 센터 조건은 허용할 사용자를 고릅니다. 자료 범위는 그 사용자가
              접근할 센터 자료를 고릅니다. 이 두 설정은 서로 다릅니다.
            </p>
            <button className="primary" disabled={state.busy}>
              페이지 권한 저장
            </button>
          </form>
          <section className="permission-simulation">
            <h3>사용자 속성으로 확인</h3>
            <select
              aria-label="미리볼 사용자 역할"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              {[
                ['editor', '센터 업무 담당'],
                ['viewer', '조회 전용'],
                ['admin', '관리자'],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <fieldset>
              <legend>미리볼 사용자의 담당 센터</legend>
              {state.context?.centers.map((c) => (
                <label key={c.code} className="member-choice">
                  {centerName(c.code)}
                  <input
                    type="checkbox"
                    name={'preview_' + c.code}
                    checked={centers.includes(c.code)}
                    onChange={(e) =>
                      setCenters((s) =>
                        e.target.checked
                          ? [...s, c.code]
                          : s.filter((code) => code !== c.code),
                      )
                    }
                  />
                </label>
              ))}
            </fieldset>
            <div>
              <PortalPermissionPreview
                rules={[
                  { ...config, read_rule: data.read, write_rule: data.write },
                ]}
                person={{ active: true, role, centers }}
              />
            </div>
          </section>
        </>
      )}
    </>
  );
}
export function PortalPermissions() {
  const { state, centerName, viewState } = usePortal(),
    [selected, setSelected] = useState(() =>
      String(viewState.get('permissionResource') ?? ''),
    ),
    [serial, setSerial] = useState(0),
    [search, setSearch] = useState(''),
    order = ['포털', '운영관리 목록', '운영 관리', '도구'],
    configs = [...state.permissions.rules]
      .sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section))
      .filter((c) =>
        c.title.toLowerCase().includes(search.trim().toLowerCase()),
      ),
    config = state.permissions.rules.find((c) => c.resource === selected);
  let section = '';
  function summary(rule: PermissionRule) {
    return (
      (rule.everyone
        ? '활성 사용자 전체'
        : [
            (rule.roles ?? [])
              .filter((r) => r !== 'admin')
              .map(
                (r) =>
                  (
                    ({
                      editor: '센터 업무 담당',
                      viewer: '조회 전용',
                    }) as Record<string, string>
                  )[r],
              )
              .join(', '),
            (rule.centers ?? []).map(centerName).join(', '),
          ]
            .filter(Boolean)
            .join(' 또는 ') || '관리자만') +
      ' · ' +
      (rule.scope === 'own' ? '본인 담당 센터 자료' : '전체 센터 자료')
    );
  }
  return (
    <>
      <section id="quick-actions" className="quick-actions" />
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">운영관리·포털 목록</strong>
            <span id="count">
              <MentionText>{state.permissions.rules.length}</MentionText>개 목록
            </span>
          </div>
          <div id="items" className="portal-items">
            <p>
              사용자 역할·담당 센터 → 페이지 허용 조건 → 최종 접근 권한 순서로
              적용됩니다. 관리자는 항상 허용되며, 수정 권한에는 열람이
              포함됩니다.
            </p>
            <label>
              페이지·업무 검색
              <input
                name="permission_search"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <div>
              {configs.map((c) => {
                const heading = c.section !== section;
                section = c.section;
                return (
                  <Fragment key={c.resource}>
                    {heading ? (
                      <h3>
                        <MentionText>{c.section}</MentionText>
                      </h3>
                    ) : null}
                    <button
                      className="task-row permission-row"
                      data-resource={c.resource}
                      aria-pressed={c.resource === selected}
                      disabled={state.busy}
                      onClick={() => {
                        setSelected(c.resource);
                        viewState.set('permissionResource', c.resource);
                        setSerial((s) => s + 1);
                      }}
                    >
                      <strong>{c.title}</strong>
                      <small>
                        {c.admin_only
                          ? '관리자 전용 · 변경 불가'
                          : '열람: ' + summary(c.read_rule)}
                      </small>
                      {!c.admin_only ? (
                        <small>수정: {summary(c.write_rule)}</small>
                      ) : null}
                    </button>
                  </Fragment>
                );
              })}
              {!configs.length ? <p>일치하는 페이지·업무가 없습니다.</p> : null}
            </div>
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {config ? (
            <PermissionEditor
              key={config.resource + JSON.stringify(config) + serial}
              config={config}
            />
          ) : (
            <p>
              페이지·업무를 선택하면 허용 대상과 자료 범위를 설정할 수 있습니다.
            </p>
          )}
        </aside>
      </div>
    </>
  );
}

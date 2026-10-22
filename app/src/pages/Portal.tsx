import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import '../styles/portal.css';
import '../styles/workspace-ui.css';
import '../styles/portal-theme.css';
import '../styles/theme.css';
import '../styles/portal-task-ui.css';
import '../styles/portal-workflow.css';
import { getLoadedAuthContext, loadAuthContext } from '../lib/auth';
import type { Profile } from '../lib/auth';
import { portalApi, portalHasMailbox, portalRecord } from '../lib/portal';
import { finishOneDrive } from '../lib/onedrive';
import { permissionAllowed } from '../lib/permissions';
import {
  PortalIncidentList,
  PortalIncidentDetail,
} from '../components/portal/PortalIncidents';
import { PortalNotifications } from '../components/portal/PortalNotifications';
import { PortalPermissions as PortalPermissionsView } from '../components/portal/PortalPermissions';
import { PortalTrash } from '../components/portal/PortalTrash';
import { PortalAccess } from '../components/portal/PortalAccess';
import { PortalMail } from '../components/portal/PortalMail';
import { PortalBackups } from '../components/portal/PortalBackups';
import { PortalConnections } from '../components/portal/PortalConnections';
import { PortalMembers } from '../components/portal/PortalMembers';
import { PortalBriefing } from '../components/portal/PortalBriefing';
import { portalBriefing } from '../lib/portal-ai';
import { PortalRegistration } from '../components/portal/PortalRegistration';
import { PortalSearch } from '../components/portal/PortalSearch';
import { PortalHistoryView } from '../components/portal/PortalHistoryView';
import { PortalHeadquarters } from '../components/portal/PortalHeadquarters';
import { PortalTickets } from '../components/portal/PortalTickets';
import { PortalTaskDetail } from '../components/portal/PortalTaskDetail';
import { portalViewTitle } from '../domain/portal-navigation';
import { PortalShell } from '../components/portal/PortalShell';
import { PortalStore } from '../components/portal/PortalStore';
import type { PortalState } from '../components/portal/PortalStore';
import {
  PortalCalendar,
  PortalTaskRow,
  PortalTaskWithChildren,
} from '../components/portal/PortalTaskList';
import { assignedToMe } from '../domain/portal-assignment';
import { koreaDate } from '../domain/operations';
import { validDate } from '../domain/driver-health';
import { orderTasks, finished } from '../domain/portal-model';
import {
  periodBounds,
  shiftPeriod,
  taskEnd,
  taskState,
  taskPeriod,
  overlapsPeriod,
} from '../domain/portal-calendar';
import {
  portalCenterName,
  portalStamp,
  viewResource,
} from '../domain/portal-types';
import type {
  PortalSelection,
  PortalTask,
  PortalPermissions,
} from '../domain/portal-types';
const separateViews = [
  'history',
  'search',
  'surveys',
  'briefing',
  'members',
  'permissions',
  'connections',
  'backups',
  'mail',
  'access',
];
const failure = (error: unknown, fallback = '') =>
  error && typeof error === 'object' && 'message' in error
    ? String(error.message)
    : fallback;
function Icon({ kind }: { kind: string }) {
  return (
    <svg
      className="portal-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'calendar' ? (
        <>
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2" />
        </>
      ) : (
        <path
          d={
            kind === 'refresh'
              ? 'M20 7v5h-5M4 17v-5h5M6.1 6.1a8.3 8.3 0 0 1 13.7 3.1M4.2 14.8a8.3 8.3 0 0 0 13.7 3.1'
              : kind === 'add'
                ? 'M12 5v14M5 12h14'
                : 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01'
          }
        />
      )}
    </svg>
  );
}
function Work({ profile }: { profile: Profile }) {
  const [state, setState] = useState<PortalState>(() => ({
      view: 'center',
      refreshVersion: 0,
      registrationTab: 'templates',
      unit: 'week',
      layout: 'calendar',
      status: 'all',
      date: koreaDate(),
      mine: false,
      context: null,
      briefing: null,
      permissions: { access: {}, rules: [] },
      center: '',
      tasks: [],
      incidents: [],
      templates: [],
      surveys: [],
      notifications: [],
      parents: [],
      participants: [],
      members: [],
      staff: [],
      selected: null,
      busy: true,
      mailAvailable: false,
      message: '',
      messageError: false,
      ticket: false,
      ticketMode: 'detail',
      ticketParent: null,
      parentTaskId: null,
      parentTask: null,
      hqReviewOpen: false,
      unread: 0,
    })),
    current = useRef(state),
    retry = useRef<{ key: string; requestId: string } | null>(null),
    initialized = useRef(false),
    mounted = useRef(true);
  const taskDrafts = useRef(
      new Map<
        string,
        {
          version: number;
          inputs: import('../domain/portal-types').PortalInputs;
        }
      >(),
    ).current,
    workflowRequests = useRef(
      new Map<string, { key: string; id: string }>(),
    ).current;
  const viewState = useRef(new Map<string, unknown>()).current;
  const draftBases = useRef(new Map<string, PortalTask>()).current;
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  function update(fn: (s: PortalState) => void) {
    const selected = current.current.selected;
    if (
      selected?.type === 'task' &&
      taskDrafts.get(selected.row.id)?.version === selected.row.version
    )
      draftBases.set(selected.row.id, selected.row);
    const next = { ...current.current };
    fn(next);
    current.current = next;
    setState(next);
  }
  function message(text: string, error = false) {
    update((s) => {
      s.message = text.replaceAll('HQ', '배송팀');
      s.messageError = error;
    });
  }
  function allowed(
    resource: string,
    action: 'read' | 'edit' = 'read',
    center?: string,
  ) {
    const s = current.current;
    return resource === 'mail'
      ? action === 'read' && s.mailAvailable
      : permissionAllowed(s.permissions, resource, action, center);
  }
  function canWrite(code: string, resource = 'tasks') {
    const s = current.current;
    return (
      !!s.context?.writable_centers.includes(code) &&
      allowed(resource, 'edit', code) &&
      (!['hq', 'search', 'notifications', 'trash'].includes(s.view) ||
        allowed(viewResource(s.view), 'edit', code))
    );
  }
  const centerName = (code: string) =>
    portalCenterName(code, current.current.context?.centers);
  async function loadData() {
    const permissions = await portalApi.permissions();
    update((s) => {
      s.permissions = permissions;
    });
    const s = current.current;
    if (
      !allowed(
        viewResource(s.view),
        'read',
        ['center', 'surveys'].includes(s.view) ? s.center : undefined,
      )
    ) {
      update((s) => {
        s.tasks = [];
        s.incidents = [];
        s.templates = [];
        s.surveys = [];
        s.notifications = [];
        s.selected = null;
      });
      return;
    }
    if (
      ['mail', 'search', 'backups', 'connections', 'history'].includes(s.view)
    ) {
      update((s) => {
        s.refreshVersion++;
      });
      return;
    }
    const period = periodBounds(s.date, s.unit),
      [
        tasks,
        incidents,
        templates,
        surveys,
        notifications,
        staff,
        members,
        participants,
        briefing,
      ] = await Promise.all([
        portalApi.tasks({
          center: ['hq', 'trash'].includes(s.view) ? undefined : s.center,
          trash: s.view === 'trash',
          from: period.from,
          through: period.through,
          includeCompleted: true,
        }),
        portalApi.incidents({
          center: ['hq', 'briefing', 'incidents'].includes(s.view)
            ? undefined
            : s.center,
          includeResolved: true,
        }),
        portalApi.templates(s.center),
        portalApi.surveys(s.view === 'hq' ? undefined : s.center),
        portalApi.notifications(),
        s.view === 'access' ? portalApi.staffAccess() : [],
        s.view === 'members' ? portalApi.members() : [],
        portalApi.participantOptions(s.center),
        s.view === 'briefing' ? portalBriefing.cached() : null,
      ]),
      parents = await portalApi.parentTasks(incidents.map((i) => i.task_id));
    if (!mounted.current) return;
    update((s) => {
      s.tasks = tasks;
      s.incidents = incidents;
      s.templates = templates;
      s.surveys = surveys;
      s.notifications = notifications;
      s.staff = staff;
      s.members = members;
      s.participants = participants;
      s.parents = parents;
      s.briefing = briefing;
      s.unread = notifications.filter((n) => !n.read_at).length;
      if (s.selected) {
        const values =
            s.selected.type === 'task'
              ? tasks
              : s.selected.type === 'incident'
                ? incidents
                : surveys,
          row = values.find((row) => row.id === s.selected!.row.id);
        if (row && !(s.selected.type === 'task' && taskDrafts.has(row.id)))
          s.selected = { ...s.selected, row } as PortalSelection;
        else if (s.selected.type !== 'task') s.selected = null;
      }
    });
    const selected = current.current.selected;
    if (
      selected?.type === 'task' &&
      !tasks.some((t) => t.id === selected.row.id) &&
      !taskDrafts.has(selected.row.id)
    ) {
      const row = await portalRecord('task', selected.row.id);
      update((s) => {
        s.selected = { type: 'task', row };
      });
    }
  }
  async function refresh() {
    if (current.current.busy) return;
    update((s) => {
      s.busy = true;
    });
    message('');
    try {
      await loadData();
      message('');
    } catch (error) {
      message(failure(error, '업무를 불러오지 못했습니다.'), true);
    } finally {
      update((s) => {
        s.busy = false;
      });
    }
  }
  async function mutate<T>(
    key: string,
    operation: (id: string) => Promise<T>,
    success?: (result: T) => void,
  ) {
    if (current.current.busy) return false;
    if (retry.current?.key !== key)
      retry.current = { key, requestId: crypto.randomUUID() };
    update((s) => {
      s.busy = true;
    });
    message('저장하는 중입니다…');
    try {
      const result = await operation(retry.current.requestId);
      retry.current = null;
      if (success) success(result);
      else if (
        result &&
        typeof result === 'object' &&
        'id' in result &&
        result.id === current.current.selected?.row.id
      )
        update((s) => {
          if (
            s.selected?.type === 'task' &&
            'version' in result &&
            typeof result.version === 'number'
          ) {
            const draft = taskDrafts.get(s.selected.row.id);
            if (draft)
              taskDrafts.set(s.selected.row.id, {
                ...draft,
                version: result.version,
              });
          }
          if (s.selected)
            s.selected = {
              ...s.selected,
              row: result,
            } as unknown as PortalSelection;
        });
      let reloadError = false;
      try {
        await loadData();
      } catch {
        reloadError = true;
      }
      const selected = current.current.selected;
      message(
        (selected?.type === 'task' && finished(selected.row)
          ? '완료 처리되었습니다. 완료 시각과 처리 기록을 저장했습니다.'
          : '저장했습니다.') +
          (reloadError
            ? ' 목록 새로고침에 실패했습니다. 잠시 후 새로고침하세요.'
            : ''),
      );
      return true;
    } catch (error) {
      message(
        failure(
          error,
          '저장하지 못했습니다. 입력을 유지했습니다. 다시 시도해 주세요.',
        ),
        true,
      );
      return false;
    } finally {
      update((s) => {
        s.busy = false;
      });
    }
  }
  function choose(selection: PortalSelection) {
    const previous = current.current.selected;
    if (previous?.type === 'task' && taskDrafts.has(previous.row.id))
      draftBases.set(previous.row.id, previous.row);
    if (selection.type === 'task') {
      const draft = taskDrafts.get(selection.row.id),
        base = draftBases.get(selection.row.id);
      if (draft && base?.version === draft.version)
        selection = { type: 'task', row: base };
      else if (!draft) draftBases.delete(selection.row.id);
    }
    update((s) => {
      s.parentTask = null;
      s.parentTaskId = null;
      s.ticketMode = 'detail';
      s.selected = selection;
      if (s.view !== 'hq' && (selection.type === 'task' || s.view === 'center'))
        s.ticket = true;
      else s.ticket = false;
    });
  }
  useEffect(() => {
    mounted.current = true;
    if (initialized.current)
      return () => {
        mounted.current = false;
      };
    initialized.current = true;
    void (async () => {
      try {
        if (new URLSearchParams(location.search).has('onedrive_state'))
          await finishOneDrive();
        const context = await portalApi.context(),
          permissions = await portalApi.permissions(),
          mailAvailable =
            profile.id === '2a828c2d-9a6f-40d4-8e13-336b591811cc' ||
            (await portalHasMailbox()),
          params = new URLSearchParams(location.search),
          requested = params.get('center'),
          center = context.centers.some((c) => c.code === requested)
            ? requested!
            : (context.writable_centers[0] ?? context.centers[0]?.code ?? '');
        update((s) => {
          s.context = context;
          s.permissions = permissions;
          s.center = center;
          s.mailAvailable = mailAvailable;
          if (profile.role === 'admin' && !requested) s.view = 'hq';
          const view = params.get('view');
          if (
            view &&
            (view === 'mail'
              ? mailAvailable
              : permissionAllowed(permissions, viewResource(view), 'read'))
          )
            s.view = view;
        });
        if (
          !allowed(
            viewResource(current.current.view),
            'read',
            ['center', 'surveys'].includes(current.current.view)
              ? center
              : undefined,
          )
        ) {
          const orderedCenters = [...context.centers].sort(
              (a, b) =>
                ['001', '002', 'gimhae', 'yangsan'].indexOf(a.code) -
                ['001', '002', 'gimhae', 'yangsan'].indexOf(b.code),
            ),
            first = orderedCenters.find((c) =>
              allowed('tasks', 'read', c.code),
            );
          if (first)
            update((s) => {
              s.view = 'center';
              s.center = first.code;
            });
          else {
            const firstView = [
              'incidents',
              'surveys',
              'hq',
              'briefing',
              'mail',
              'search',
              'notifications',
              'history',
              'permissions',
              'connections',
              'members',
              'trash',
              'backups',
            ].find((v) => allowed(viewResource(v)));
            if (firstView)
              update((s) => {
                s.view = firstView;
              });
          }
        }
        await loadData();
        message('');
        update((s) => {
          s.busy = false;
        });
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error
            ? String(error.code)
            : '';
        message(
          ['PGRST202', '42P01'].includes(code)
            ? '업무 포털 서버 구성이 아직 적용되지 않았습니다. 관리자에게 서버 반영을 요청해 주세요.'
            : failure(error, String(error)),
          true,
        );
        update((s) => {
          s.busy = true;
        });
      }
    })();
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!state.context) return;
    let checking = false;
    const check = async () => {
      if (
        current.current.busy ||
        checking ||
        document.visibilityState === 'hidden'
      )
        return;
      checking = true;
      try {
        const unread = await portalApi.unreadCount();
        if (!current.current.busy && mounted.current)
          update((s) => {
            s.unread = unread || 0;
          });
      } catch {
        /* Retain inputs during temporary failures. */
      } finally {
        checking = false;
      }
    };
    let timer = setInterval(() => void check(), 30000);
    const visibility = () => {
        if (document.visibilityState === 'visible') void check();
      },
      hide = () => clearInterval(timer),
      show = (e: PageTransitionEvent) => {
        if (e.persisted) {
          clearInterval(timer);
          timer = setInterval(() => void check(), 30000);
          void check();
        }
      };
    document.addEventListener('visibilitychange', visibility);
    addEventListener('pagehide', hide);
    addEventListener('pageshow', show);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visibility);
      removeEventListener('pagehide', hide);
      removeEventListener('pageshow', show);
    };
  }, [!!state.context]);
  useLayoutEffect(() => {
    document.body.className =
      'workspace-ui portal-shell app-shell' +
      (state.view === 'center' ? ' center-workspace' : '') +
      (state.view === 'center' && state.layout === 'calendar'
        ? ' calendar-view'
        : '') +
      (state.view === 'surveys' && state.registrationTab === 'templates'
        ? ' registration-workspace'
        : '') +
      (['permissions', 'members'].includes(state.view)
        ? ' permissions-workspace'
        : '');
    document.body.dataset.appArea = 'portal';
    document.title = `${portalViewTitle(state.view)} · 업무 포털 · 이안물류`;
  }, [state.view, state.layout, state.registrationTab]);
  function navigate(view: string, center?: string) {
    if (current.current.busy) return;
    update((s) => {
      s.view = view;
      s.selected = null;
      s.ticket = false;
      if (center) s.center = center;
    });
    const url = new URL(location.href);
    url.searchParams.set('view', view);
    if (center) url.searchParams.set('center', center);
    history.replaceState(null, '', url.pathname + url.search);
    void refresh();
  }
  function changeCenter(center: string) {
    if (current.current.busy) return;
    update((s) => {
      s.center = center;
      s.selected = null;
    });
    const url = new URL(location.href);
    url.searchParams.set('center', center);
    history.replaceState(null, '', url.pathname + url.search);
    void refresh();
  }
  const hq = state.view === 'hq',
    denied =
      !!state.context &&
      !allowed(
        viewResource(state.view),
        'read',
        ['center', 'surveys'].includes(state.view) ? state.center : undefined,
      ),
    period = periodBounds(state.date, state.unit),
    handedOff = new Set(
      state.notifications.filter((n) => n.task_id).map((n) => n.task_id!),
    ),
    tasks = orderTasks(state.tasks, { userId: profile.id, handedOff }),
    candidates = tasks.filter(
      (t) =>
        (!state.mine || assignedToMe(t, profile, state.participants)) &&
        (overlapsPeriod(t, period.from, period.through) ||
          (taskEnd(t) < period.from && !finished(t))),
    ),
    visible = candidates.filter(
      (t) => state.status === 'all' || taskState(t) === state.status,
    ),
    inPeriod = visible.filter((t) =>
      overlapsPeriod(t, period.from, period.through),
    ),
    overdue = visible.filter((t) => taskEnd(t) < period.from && !finished(t)),
    count =
      state.view === 'center'
        ? inPeriod.length + overdue.length
        : state.view === 'incidents'
          ? state.incidents.length
          : state.view === 'trash'
            ? state.tasks.length
            : state.view === 'notifications'
              ? state.notifications.length
              : hq
                ? tasks.filter((t) => !finished(t)).length +
                  state.incidents.filter((i) => i.status === 'open').length
                : 0;
  const title = !state.context
    ? '업무목록'
    : denied
      ? '열람 권한 없음'
      : hq
        ? '배송팀 업무'
        : state.view === 'incidents'
          ? '특이사항'
          : state.view === 'surveys'
            ? centerName(state.center) + ' 업무 등록·조사'
            : state.view === 'center'
              ? centerName(state.center) + ' 업무목록'
              : (
                  {
                    members: '사용자 권한·센터',
                    permissions: '페이지별 권한',
                    notifications: '알림함',
                    trash: '휴지통',
                    history: '처리 기록',
                    search: '통합 검색',
                    connections: 'OneDrive 관리',
                    backups: '운영 원본 보관',
                    mail: '개인 메일함',
                    briefing: '배송팀 AI 브리핑',
                    access: '센터 담당자 배정',
                  } as Record<string, string>
                )[state.view] || '업무목록';
  return (
    <PortalStore.Provider
      value={{
        profile,
        viewState,
        taskDrafts,
        workflowRequests,
        state,
        update,
        refresh,
        loadData,
        message,
        choose,
        allowed,
        canWrite,
        centerName,
        mutate,
      }}
    >
      <PortalShell
        profile={profile}
        context={state.context || { centers: [], writable_centers: [] }}
        permissions={state.permissions}
        center={state.center}
        view={state.view}
        busy={state.busy}
        unread={state.unread}
        mailAvailable={state.mailAvailable}
        onNavigate={navigate}
        onCenter={changeCenter}
      >
        <div id="portal-content" className="app-main" tabIndex={-1}>
          <main
            id="portal-main"
            tabIndex={-1}
            data-view={state.view}
            aria-busy={state.busy}
          >
            <div className="heading" key={state.view}>
              <div>
                <h1 id="portal-title" tabIndex={-1}>
                  {title}
                </h1>
                <p id="portal-description">
                  {denied
                    ? '관리자에게 이 목록의 열람 권한을 요청하세요.'
                    : hq
                      ? '확인 필요한 업무와 특이사항을 센터 속성으로 확인하고 여기에서 처리하세요.'
                      : state.view === 'surveys'
                        ? state.registrationTab === 'surveys'
                          ? '조사한 업무 내용과 검토 진행 상태를 확인하세요.'
                          : '센터 업무 양식을 등록·수정하고 실행 주기를 관리하세요.'
                        : ((
                            {
                              incidents:
                                '센터 업무에서 발생한 특이사항을 처리중·처리완료로 확인하세요.',
                              members:
                                '역할·담당 센터를 설정하고 페이지별 적용 권한을 확인하세요.',
                              permissions:
                                '멤버의 역할·센터 속성으로 열람과 수정 조건을 설정하세요.',
                              connections:
                                '업무자료 저장 폴더와 연결 상태를 관리합니다.',
                              backups:
                                '월말 전체 원본과 OneDrive 저장 상태를 확인하세요.',
                              mail: '본인 전용 받은 메일과 첨부파일을 확인하세요.',
                              history:
                                '센터 업무와 특이사항의 실제 처리 내역을 확인하세요.',
                              search:
                                '업무와 운영 마스터, 과거 특이사항을 유형별로 찾으세요.',
                            } as Record<string, string>
                          )[state.view] ??
                          '진행 중 업무는 날짜가 지나도 계속 표시됩니다.')}
                </p>
              </div>
              <div className="heading-actions">
                <button
                  id="refresh"
                  disabled={state.busy}
                  onClick={() => void refresh()}
                >
                  <Icon kind="refresh" />
                  <span>새로고침</span>
                  <span className="portal-refresh-progress" role="status" aria-live="polite">{state.busy ? '처리 중' : ''}</span>
                </button>
                <button
                  onClick={() =>
                    update((s) => {
                      s.ticket = true;
                      s.ticketMode = 'issue';
                    })
                  }
                  id="issue-task"
                  type="button"
                  hidden={state.view !== 'center' || !canWrite(state.center)}
                  disabled={state.busy}
                >
                  업무 발행
                </button>
                <button
                  onClick={() =>
                    update((s) => {
                      s.ticket = true;
                      s.ticketMode = 'create';
                    })
                  }
                  id="new-task"
                  className="primary"
                  type="button"
                  hidden={state.view !== 'center' || !canWrite(state.center)}
                  disabled={state.busy}
                >
                  <Icon kind="add" />
                  일회성 업무등록
                </button>
              </div>
            </div>
            <div
              id="message"
              hidden={!state.message}
              aria-hidden={state.ticket || !!state.parentTaskId || undefined}
              role={state.messageError ? 'alert' : 'status'}
              aria-live={state.messageError ? 'assertive' : 'polite'}
              className={'portal-feedback' + (state.messageError ? ' error' : '')}
            >
              <span>{state.message}</span>{state.message ? <button type="button" aria-label="처리 안내 닫기" onClick={() => message('')}>닫기</button> : null}
            </div>
            {!online ? (
              <p className="portal-offline" role="status">
                브라우저가 오프라인 상태입니다. 입력은 이 화면에 유지됩니다.
                연결을 확인한 뒤 다시 저장하세요.
              </p>
            ) : null}
            {state.view === 'access' && !denied ? <PortalAccess /> : null}
            {state.view === 'mail' && !denied ? <PortalMail /> : null}
            {state.view === 'backups' && !denied ? <PortalBackups /> : null}
            {state.view === 'connections' && !denied ? (
              <PortalConnections />
            ) : null}
            {state.view === 'permissions' && !denied ? (
              <PortalPermissionsView />
            ) : null}
            {state.view === 'members' && !denied ? <PortalMembers /> : null}
            {state.view === 'briefing' && !denied ? <PortalBriefing /> : null}
            {state.view === 'surveys' && !denied ? (
              <PortalRegistration key={state.center} />
            ) : null}
            {state.view === 'search' && !denied ? <PortalSearch /> : null}
            {state.view === 'history' && !denied ? <PortalHistoryView /> : null}
            {!separateViews.includes(state.view) ? (
              <section
                id="quick-actions"
                className="quick-actions"
                aria-label="업무 등록"
              />
            ) : null}
            <div
              className="filters task-toolbar"
              role="region"
              aria-label="업무 조회 조건"
              hidden={denied || !['center', 'hq'].includes(state.view)}
            >
              <select
                id="center"
                hidden
                aria-label="선택한 센터"
                value={state.center}
                disabled={state.busy || hq}
                onChange={(e) => changeCenter(e.target.value)}
              >
                {state.context?.centers.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input id="completed" type="checkbox" checked hidden readOnly />
              <div className="toolbar-top">
                <div className="toolbar-period-group">
                  <span className="filter-label">조회 기간</span>
                  <div className="toolbar-period">
                    <div
                      id="task-unit"
                      className="view-buttons"
                      role="group"
                      aria-label="조회 기간"
                    >
                      {[
                        ['day', '일'],
                        ['week', '주'],
                        ['month', '월'],
                      ].map(([value, text]) => (
                        <button
                          key={value}
                          type="button"
                          data-view-control="task-unit"
                          data-value={value}
                          aria-pressed={state.unit === value}
                          disabled={state.busy}
                          onClick={() => {
                            update((s) => {
                              s.unit = value;
                            });
                            void refresh();
                          }}
                        >
                          {text}
                        </button>
                      ))}
                    </div>
                    <div className="date-navigation">
                      <button
                        id="period-prev"
                        type="button"
                        aria-label="이전 기간"
                        disabled={state.busy}
                        onClick={() => {
                          update((s) => {
                            s.date = shiftPeriod(s.date, s.unit, -1);
                          });
                          void refresh();
                        }}
                      >
                        ‹
                      </button>
                      <input
                        id="task-date"
                        type="date"
                        aria-label="기준일"
                        value={state.date}
                        disabled={state.busy}
                        onChange={(e) => {
                          if (!validDate(e.target.value)) {
                            message('조회 날짜를 확인하세요.', true);
                            return;
                          }
                          update((s) => {
                            s.date = e.target.value;
                          });
                          void refresh();
                        }}
                      />
                      <button
                        id="period-next"
                        type="button"
                        aria-label="다음 기간"
                        disabled={state.busy}
                        onClick={() => {
                          update((s) => {
                            s.date = shiftPeriod(s.date, s.unit, 1);
                          });
                          void refresh();
                        }}
                      >
                        ›
                      </button>
                      <button
                        id="period-today"
                        type="button"
                        disabled={state.busy}
                        onClick={() => {
                          update((s) => {
                            s.date = koreaDate();
                          });
                          void refresh();
                        }}
                      >
                        오늘
                      </button>
                    </div>
                  </div>
                </div>
                <div
                  id="task-layout"
                  className="view-buttons"
                  role="group"
                  aria-label="보기 방식"
                  hidden={state.view !== 'center'}
                >
                  {[
                    ['list', '목록'],
                    ['calendar', '캘린더'],
                  ].map(([value, text]) => (
                    <button
                      key={value}
                      type="button"
                      data-view-control="task-layout"
                      data-value={value}
                      aria-pressed={state.layout === value}
                      disabled={state.busy}
                      onClick={() =>
                        update((s) => {
                          s.layout = value;
                        })
                      }
                    >
                      <Icon kind={value} />
                      {text}
                    </button>
                  ))}
                </div>
              </div>
              <div className="toolbar-bottom" hidden={state.view !== 'center'}>
                <div className="toolbar-status-group">
                  <span className="filter-label">업무 상태</span>
                  <div
                    id="task-status"
                    className="view-buttons"
                    role="group"
                    aria-label="업무 상태"
                  >
                    {[
                      ['all', '전체'],
                      ['active', '진행중'],
                      ['completed', '완료'],
                      ['delayed', '지연'],
                    ].map(([value, text]) => (
                      <button
                        key={value}
                        type="button"
                        data-view-control="task-status"
                        data-value={value}
                        data-task-state={value}
                        aria-pressed={state.status === value}
                        disabled={state.busy}
                        onClick={() =>
                          update((s) => {
                            s.status = value;
                          })
                        }
                      >
                        {text}
                        <span
                          className="status-count"
                          data-status-count={value}
                        >
                          {value === 'all'
                            ? candidates.length
                            : candidates.filter((t) => taskState(t) === value)
                                .length}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
                <label className="check ui-switch">
                  <span className="ui-switch-control">
                    <input
                      id="mine"
                      type="checkbox"
                      role="switch"
                      checked={state.mine}
                      disabled={state.busy || state.view !== 'center'}
                      onChange={(e) =>
                        update((s) => {
                          s.mine = e.target.checked;
                        })
                      }
                    />
                    <span className="ui-switch-track" aria-hidden="true" />
                  </span>
                  내 업무만
                </label>
              </div>
            </div>
            {!separateViews.includes(state.view) ? (
              <div className="workspace">
                <section className="list">
                  <div className="list-heading">
                    <strong id="list-title">
                      {state.view === 'trash'
                        ? '휴지통의 업무'
                        : state.view === 'notifications'
                          ? '내 알림'
                          : hq
                            ? '업무와 지원 요청'
                            : state.view === 'incidents'
                              ? '특이사항'
                              : '업무목록'}
                    </strong>
                    <span id="count">{denied ? '' : count + '건'}</span>
                  </div>
                  <div id="items" className="portal-items">
                    {!denied && state.view === 'trash' ? <PortalTrash /> : null}
                    {!denied && state.view === 'notifications' ? (
                      <PortalNotifications />
                    ) : null}
                    {!denied && hq ? <PortalHeadquarters /> : null}
                    {!denied && state.view === 'incidents' ? (
                      <>
                        <PortalIncidentList />
                        {!count && !state.busy ? (
                          <div className="portal-empty">
                            <strong>표시할 항목이 없습니다.</strong>
                            <p>등록된 항목이 있으면 여기에 표시됩니다.</p>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                    {state.context && !denied && state.view === 'center' ? (
                      <>
                        {overdue.length ? (
                          <>
                            <h3>이전 기간 미완료 · {overdue.length}건</h3>
                            {overdue.map((task) => (
                              <PortalTaskWithChildren
                                key={task.id}
                                task={task}
                                incidents={state.incidents}
                                centerName={centerName}
                                onChoose={choose}
                              />
                            ))}
                          </>
                        ) : null}
                        <h3>
                          {period.from}
                          {period.from === period.through
                            ? ''
                            : ' ~ ' + period.through}
                        </h3>
                        {state.layout === 'calendar' ? (
                          <PortalCalendar
                            tasks={inPeriod}
                            date={state.date}
                            unit={state.unit}
                            participants={state.participants}
                            centerName={centerName}
                            onChoose={choose}
                          />
                        ) : (
                          inPeriod.map((task) => (
                            <PortalTaskWithChildren
                              key={task.id}
                              task={task}
                              incidents={state.incidents}
                              centerName={centerName}
                              onChoose={choose}
                            />
                          ))
                        )}
                        {!count && !state.busy ? (
                          <div className="portal-empty">
                            <strong>조회 조건에 맞는 업무가 없습니다.</strong>
                            <p>
                              기간이나 상태를 변경해 확인하세요. 새 업무는
                              상단에서 등록할 수 있습니다.
                            </p>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </section>
                <aside id="detail" aria-label="업무 처리">
                  {state.selected?.type === 'incident' && !state.ticket ? (
                    <PortalIncidentDetail
                      key={
                        state.selected.row.id + ':' + state.selected.row.version
                      }
                      row={state.selected.row}
                    />
                  ) : state.selected?.type === 'task' && !state.ticket ? (
                    <PortalTaskDetail
                      key={state.selected.row.id}
                      task={state.selected.row}
                    />
                  ) : (
                    <p>목록에서 항목을 선택하세요.</p>
                  )}
                </aside>
              </div>
            ) : null}
          </main>
        </div>
      </PortalShell>
      <PortalTickets />
    </PortalStore.Provider>
  );
}
export default function Portal() {
  const [profile, setProfile] = useState<Profile | null>(() => getLoadedAuthContext()?.profile ?? null),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void loadAuthContext()
      .then((auth) => {
        if (active && auth) setProfile(auth.profile);
      })
      .catch((error) => {
        if (active)
          setError(failure(error, '로그인 상태를 확인하지 못했습니다.'));
      });
    return () => {
      active = false;
    };
  }, []);
  return profile ? (
    <Work profile={profile} />
  ) : error ? (
    <p role="alert">{error}</p>
  ) : null;
}

import { supabase } from './supabase';
import {
  operationsRpc,
  operationPages,
  operationsContext,
  operationsTasks,
  operationsIncidents,
  operationsDailyLog,
  operationsIncidentAction,
} from './operations';
import type {
  PortalTask,
  PortalIncident,
  PortalTemplate,
  PortalSurvey,
  PortalNotification,
  PortalMember,
  ParticipantSubject,
  PortalEvent,
  PortalPermissions,
  PermissionConfig,
  PermissionRule,
  MemberPermissionChange,
  PortalInputs,
} from '../domain/portal-types';
export const portalApi = {
  context: operationsContext,
  permissions: () =>
    operationsRpc<PortalPermissions>('operations_permissions_context'),
  updatePermission: ({
    requestId,
    config,
    read,
    write,
  }: {
    requestId: string;
    config: PermissionConfig;
    read: PermissionRule;
    write: PermissionRule;
  }) =>
    operationsRpc('operations_update_permission', {
      p_request_id: requestId,
      p_resource: config.resource,
      p_expected_version: config.version,
      p_read: read,
      p_write: write,
    }),
  members: () => operationsRpc<PortalMember[]>('operations_members'),
  updateMemberPermissions: ({ requestId, person, changes }: {
    requestId: string;
    person: PortalMember;
    changes: MemberPermissionChange[];
  }) => operationsRpc<{ user_id: string; rules: PermissionConfig[] }>('operations_update_member_permissions', {
    p_request_id: requestId,
    p_user_id: person.id,
    p_expected_member: { display_name: person.display_name, role: person.role, centers: [...person.centers].sort() },
    p_changes: changes,
  }),
  updateMember: ({
    requestId,
    person,
    name,
    role,
    centers,
  }: {
    requestId: string;
    person: PortalMember;
    name: string;
    role: string;
    centers: string[];
  }) =>
    operationsRpc('operations_update_member', {
      p_request_id: requestId,
      p_user_id: person.id,
      p_expected: {
        display_name: person.display_name,
        role: person.role,
        centers: person.centers,
      },
      p_name: name,
      p_role: role,
      p_centers: centers,
    }),
  participantOptions: (center: string) =>
    operationsRpc<ParticipantSubject[]>('operations_participant_options', {
      p_center: center,
    }),
  setParticipants: ({
    requestId,
    task,
    handler,
    from = null,
    to = null,
    memo = '',
  }: {
    requestId: string;
    task: PortalTask;
    handler: string | null;
    from?: string | null;
    to?: string | null;
    memo?: string;
  }) =>
    operationsRpc<PortalTask>('operations_set_task_participants', {
      p_request_id: requestId,
      p_task_id: task.id,
      p_expected_version: task.version,
      p_handler: handler,
      p_from: from,
      p_to: to,
      p_memo: memo,
    }),
  staffAccess: () => operationsRpc<PortalMember[]>('operations_staff_access'),
  setMembership: ({
    requestId,
    userId,
    center,
    expected,
    enabled,
  }: {
    requestId: string;
    userId: string;
    center: string;
    expected: boolean;
    enabled: boolean;
  }) =>
    operationsRpc('operations_set_membership', {
      p_request_id: requestId,
      p_user_id: userId,
      p_center: center,
      p_expected: expected,
      p_enabled: enabled,
    }),
  templates: (center: string) =>
    operationPages<PortalTemplate>(() =>
      supabase
        .from('operations_templates')
        .select('*')
        .eq('center_code', center)
        .order('version', { ascending: false })
        .order('id'),
    ),
  retireCustom: ({
    requestId,
    template,
  }: {
    requestId: string;
    template: PortalTemplate;
  }) =>
    operationsRpc('operations_retire_custom_template', {
      p_request_id: requestId,
      p_template_id: template.id,
    }),
  publishCustom: ({
    requestId,
    center,
    title,
    spec,
    familyId = null,
  }: {
    requestId: string;
    center: string;
    title: string;
    spec: import('../domain/portal-types').PortalSpec;
    familyId?: string | null;
  }) =>
    operationsRpc<PortalTemplate>('operations_publish_custom_template', {
      p_request_id: requestId,
      p_center: center,
      p_title: title,
      p_spec: spec,
      p_family_id: familyId,
    }),
  issuePeriod: ({
    requestId,
    templateId,
    date,
    endDate,
  }: {
    requestId: string;
    templateId: string;
    date: string;
    endDate: string;
  }) =>
    operationsRpc<PortalTask>('operations_issue_task_period', {
      p_request_id: requestId,
      p_template_id: templateId,
      p_work_date: date,
      p_end_date: endDate,
    }),
  issueCustom: ({
    requestId,
    templateId,
    date,
  }: {
    requestId: string;
    templateId: string;
    date: string;
  }) =>
    operationsRpc<PortalTask>('operations_issue_custom_task', {
      p_request_id: requestId,
      p_template_id: templateId,
      p_work_date: date,
    }),
  people: (center: string) =>
    operationsRpc<{ id: string; name: string }[]>('operations_handoff_people', {
      p_center: center,
    }),
  events: ({ taskId, incidentId }: { taskId?: string; incidentId?: string }) =>
    operationPages<PortalEvent>(() =>
      supabase
        .from('operations_task_events')
        .select('id,action,occurred_at,actor_id,request_body,after_value')
        .eq(taskId ? 'task_id' : 'incident_id', taskId ?? incidentId)
        .order('occurred_at')
        .order('id'),
    ),
  trashTask: ({
    requestId,
    task,
    restore = false,
  }: {
    requestId: string;
    task: PortalTask;
    restore?: boolean;
  }) =>
    operationsRpc<PortalTask>('operations_task_trash', {
      p_request_id: requestId,
      p_task_id: task.id,
      p_expected_version: task.version,
      p_restore: restore,
    }),
  reopen: ({ requestId, task }: { requestId: string; task: PortalTask }) =>
    operationsRpc<PortalTask>('operations_reopen_task', {
      p_request_id: requestId,
      p_task_id: task.id,
      p_expected_version: task.version,
    }),
  notifications: () =>
    operationPages<PortalNotification>(() =>
      supabase
        .from('operations_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .order('id'),
    ),
  unreadCount: async () => {
    const { count, error } = await supabase
      .from('operations_notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    if (error) throw error;
    return count;
  },
  readNotification: (id: string) =>
    operationsRpc('operations_read_notification', { p_id: id }),
  surveys: (center?: string) =>
    operationPages<PortalSurvey>(() => {
      let query = supabase
        .from('operations_surveys')
        .select('*')
        .order('updated_at', { ascending: false })
        .order('id');
      if (center) query = query.eq('center_code', center);
      return query;
    }),
  deleteSurvey: ({
    requestId,
    survey,
  }: {
    requestId: string;
    survey: PortalSurvey;
  }) =>
    operationsRpc('operations_survey_delete', {
      p_request_id: requestId,
      p_id: survey.id,
      p_expected_version: survey.version,
    }),
  surveyAction: ({
    requestId,
    survey,
    action,
    data,
  }: {
    requestId: string;
    survey?: PortalSurvey | null;
    action: string;
    data: Record<string, unknown>;
  }) =>
    operationsRpc<PortalSurvey>('operations_survey_action', {
      p_request_id: requestId,
      p_id: survey?.id ?? null,
      p_expected_version: survey?.version ?? null,
      p_action: action,
      p_data: data,
    }),
  save: ({
    requestId,
    task,
    center,
    title,
    date,
    endDate,
    inputs = {},
    status = 'pending',
  }: {
    requestId: string;
    task?: PortalTask | null;
    center: string;
    title: string;
    date: string;
    endDate?: string;
    inputs?: PortalInputs;
    status?: string;
  }) => {
    if (!requestId) throw Error('재시도에도 같은 요청 번호를 사용해야 합니다.');
    return operationsRpc<PortalTask>('operations_save_task_period', {
      p_request_id: requestId,
      p_task_id: task?.id ?? null,
      p_expected_version: task?.version ?? null,
      p_center: center,
      p_title: title,
      p_work_date: date,
      p_end_date: endDate ?? task?.work_end_date ?? date,
      p_inputs: inputs,
      p_status: status,
    });
  },
  taskAction: ({
    requestId,
    task,
    action,
    data,
  }: {
    requestId: string;
    task: PortalTask;
    action: string;
    data: Record<string, unknown>;
  }) =>
    operationsRpc<PortalTask>('operations_task_action', {
      p_request_id: requestId,
      p_task_id: task.id,
      p_expected_version: task.version,
      p_action: action,
      p_data: data,
    }),
  incidentAction: ({
    requestId,
    incident = null,
    action,
    data = {},
  }: {
    requestId: string;
    incident?: PortalIncident | null;
    action: string;
    data?: Record<string, unknown>;
  }) =>
    operationsIncidentAction({
      requestId,
      incident,
      action,
      data,
    }) as Promise<PortalIncident>,
  templateAction: ({
    requestId,
    template = null,
    action,
    data = {},
  }: {
    requestId: string;
    template?: PortalTemplate | null;
    action: string;
    data?: Record<string, unknown>;
  }) =>
    operationsRpc<PortalTemplate>('operations_template_action', {
      p_request_id: requestId,
      p_template_id: template?.id ?? null,
      p_expected_version: template?.version ?? null,
      p_action: action,
      p_data: data,
    }),
  fromTemplate: ({
    requestId,
    templateId,
    date,
    inputs = {},
    ownerId = null,
    recurring = false,
  }: {
    requestId: string;
    templateId: string;
    date: string;
    inputs?: PortalInputs;
    ownerId?: string | null;
    recurring?: boolean;
  }) =>
    operationsRpc<PortalTask>('operations_task_from_template', {
      p_request_id: requestId,
      p_template_id: templateId,
      p_work_date: date,
      p_inputs: inputs,
      p_owner_id: ownerId,
      p_recurring: recurring,
    }),
  parentTasks: async (ids: (string | null | undefined)[]) => {
    const rows: PortalTask[] = [],
      unique = [...new Set(ids.filter((value): value is string => !!value))];
    for (let offset = 0; offset < unique.length; offset += 100) {
      const { data, error } = await supabase
        .from('operations_tasks')
        .select('id,title,center_code,status,work_date')
        .in('id', unique.slice(offset, offset + 100))
        .returns<PortalTask[]>();
      if (error) throw error;
      rows.push(...data);
    }
    return rows;
  },
  incidents: (options: Parameters<typeof operationsIncidents>[0]) =>
    operationsIncidents(options) as Promise<PortalIncident[]>,
  tasks: (options: Parameters<typeof operationsTasks>[0]) =>
    operationsTasks(options) as Promise<PortalTask[]>,
  dailyLog: operationsDailyLog,
  recordCjShare: ({
    requestId,
    task,
    shared,
    note,
  }: {
    requestId: string;
    task: PortalTask;
    shared: boolean;
    note: string;
  }) =>
    operationsRpc<PortalTask>('operations_record_cj_share', {
      p_request_id: requestId,
      p_task_id: task.id,
      p_expected_version: task.version,
      p_shared: shared,
      p_note: note,
    }),
};
export async function portalRecord<K extends 'task' | 'incident' | 'survey'>(
  kind: K,
  id: string,
): Promise<
  K extends 'task'
    ? PortalTask
    : K extends 'incident'
      ? PortalIncident
      : PortalSurvey
> {
  const table = {
      task: 'operations_tasks',
      incident: 'operations_incidents',
      survey: 'operations_surveys',
    }[kind],
    { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('id', id)
      .single();
  if (error) throw error;
  return data;
}
export async function portalHasMailbox() {
  try {
    const { data, error } = await supabase
      .from('private_mailboxes')
      .select('id')
      .limit(1);
    return !error && !!data?.length;
  } catch {
    return false;
  }
}

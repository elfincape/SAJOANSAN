import type { OperationsRecord, OperationsContext } from './operations';
import type { PermissionContext } from '../lib/permissions';
export interface PortalField {
  key: string;
  label: string;
  type: string;
  control?: string;
  options?: string[];
  required_on_complete?: boolean;
}
export interface PortalSpec {
  fields?: PortalField[];
  steps?: { key: string; label: string }[];
  description?: string;
  completion_condition?: string;
  effective_from?: string;
  ui_cadence?: string;
  external_process?: string[];
  repeat?: { kind: string; days?: number[]; day?: number; date?: string };
  due_time?: string;
  owner_ids?: string[];
  integration?: {
    kind: string;
    capture_range?: string;
    worksheet?: string;
    dispatch_field?: string;
  };
  [key: string]: unknown;
}
export type PortalInputs = Record<string, unknown> & {
  work_note?: string;
  cj_shared?: boolean;
  steps?: Record<string, string>;
};
export interface PortalTask extends OperationsRecord {
  version: number;
  work_date: string;
  work_end_date?: string | null;
  created_at: string;
  owner_id?: string | null;
  created_by?: string;
  completed_by?: string | null;
  completed_at?: string | null;
  deleted_at?: string | null;
  handler_subject_id?: string | null;
  handoff_from_subject_id?: string | null;
  handoff_to_subject_id?: string | null;
  handoff_actor_id?: string | null;
  template_snapshot?: { spec?: PortalSpec; [key: string]: unknown };
  inputs: PortalInputs;
}
export interface PortalIncident extends OperationsRecord {
  version: number;
  task_id: string | null;
  created_at: string;
  kind: string;
  inputs: PortalInputs;
}
export interface PortalTemplate {
  id: string;
  title: string;
  center_code: string;
  family_id: string;
  version: number;
  status: string;
  spec: PortalSpec;
  approved_at?: string;
  created_at: string;
  [key: string]: unknown;
}
export interface PortalSurvey {
  id: string;
  title: string;
  center_code: string;
  version: number;
  stage: string;
  details: Record<string, string>;
  template_id?: string | null;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}
export interface PortalNotification {
  id: string;
  title: string;
  created_at: string;
  read_at?: string | null;
  task_id?: string | null;
  incident_id?: string | null;
  reason_key?: string;
}
export interface PortalMember {
  id: string;
  name: string;
  display_name?: string | null;
  email?: string | null;
  role: string;
  active: boolean;
  centers: string[];
  [key: string]: unknown;
}
export interface ParticipantSubject {
  eligible?: boolean;
  id: string;
  kind: string;
  name: string;
  user_id?: string | null;
  center_code?: string;
  role_key?: string;
  role?: string;
  centers?: string[];
}
export interface PortalEvent {
  id: string;
  action: string;
  occurred_at: string;
  report_date?: string;
  actor_id?: string;
  task_id?: string | null;
  incident_id?: string | null;
  request_body?: {
    from?: string;
    to?: string;
    handler?: string;
    data?: Record<string, unknown>;
    [key: string]: unknown;
  };
  after_value?: Record<string, unknown>;
}
export interface PermissionRule {
  everyone?: boolean;
  roles?: string[];
  centers?: string[];
  scope: string;
}
export interface PermissionConfig {
  resource: string;
  title: string;
  section: string;
  version: number;
  admin_only?: boolean;
  read_rule: PermissionRule;
  write_rule: PermissionRule;
}
export interface PortalPermissions extends PermissionContext {
  rules: PermissionConfig[];
  [key: string]: unknown;
}
export interface PortalContext extends OperationsContext {}
export type PortalSelection =
  | { type: 'task'; row: PortalTask }
  | { type: 'incident'; row: PortalIncident }
  | { type: 'survey'; row: PortalSurvey };
export const centerLabels: Record<string, string> = {
  '001': '사조안산',
  '002': '사조평택',
  gimhae: '김해센터',
  yangsan: '양산공장',
};
export function portalCenterName(
  code: string,
  centers: { code: string; name: string }[] = [],
) {
  return (
    centerLabels[code] ?? centers.find((c) => c.code === code)?.name ?? code
  );
}
export const viewResource = (view: string) =>
  (
    ({
      center: 'tasks',
      surveys: 'forms',
      briefing: 'briefing',
      access: 'members',
    }) as Record<string, string>
  )[view] ?? view;
export const portalStamp = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(value))
    : '';

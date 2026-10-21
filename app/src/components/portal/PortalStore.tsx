import { createContext, useContext } from 'react';
import type { Profile } from '../../lib/auth';
import type {
  PortalTask,
  PortalIncident,
  PortalTemplate,
  PortalSurvey,
  PortalNotification,
  PortalMember,
  ParticipantSubject,
  PortalPermissions,
  PortalContext,
  PortalSelection,
} from '../../domain/portal-types';
export interface PortalState {
  view: string;
  refreshVersion: number;
  registrationTab: string;
  unit: string;
  layout: string;
  status: string;
  date: string;
  mine: boolean;
  context: PortalContext | null;
  permissions: PortalPermissions;
  center: string;
  tasks: PortalTask[];
  incidents: PortalIncident[];
  templates: PortalTemplate[];
  surveys: PortalSurvey[];
  notifications: PortalNotification[];
  parents: PortalTask[];
  participants: ParticipantSubject[];
  members: PortalMember[];
  staff: PortalMember[];
  selected: PortalSelection | null;
  busy: boolean;
  mailAvailable: boolean;
  message: string;
  messageError: boolean;
  ticket: boolean;
  ticketMode: string;
  ticketParent: PortalTask | null;
  parentTaskId: string | null;
  parentTask: PortalTask | null;
  hqReviewOpen: boolean;
  unread: number;
}
export interface PortalStoreValue {
  profile: Profile;
  taskDrafts: Map<
    string,
    {
      version: number;
      inputs: import('../../domain/portal-types').PortalInputs;
    }
  >;
  workflowRequests: Map<string, { key: string; id: string }>;
  state: PortalState;
  update: (fn: (s: PortalState) => void) => void;
  refresh: () => Promise<void>;
  loadData: () => Promise<void>;
  message: (text: string, error?: boolean) => void;
  choose: (selection: PortalSelection) => void;
  allowed: (
    resource: string,
    action?: 'read' | 'edit',
    center?: string,
  ) => boolean;
  canWrite: (code: string, resource?: string) => boolean;
  centerName: (code: string) => string;
  mutate: <T>(
    key: string,
    operation: (requestId: string) => Promise<T>,
    success?: (result: T) => void,
  ) => Promise<boolean>;
}
export const PortalStore = createContext<PortalStoreValue | null>(null);
export function usePortal() {
  const value = useContext(PortalStore);
  if (!value) throw Error('업무 포털 컨텍스트가 없습니다.');
  return value;
}

import { supabase } from './supabase';
import { oneDriveCall } from './onedrive';
import { MAIL_DIAGNOSTIC_OWNER_ID } from '../domain/portal-mail';
import type {
  Mailbox,
  MailMessage,
  MailCollectionProgress,
} from '../domain/portal-mail';
export interface MailAutomationStatus {
  schemaReady: boolean;
  workerReady: boolean;
  schedulerReady: boolean;
  notesConnected: boolean;
  analysisReady: boolean;
  config: {
    enabled: boolean;
    readStateVerified: boolean;
    analysisConsent: boolean;
    analysisConsentAt: string | null;
  };
  nextRunAt: string | null;
  job: {
    id: string;
    status: 'queued' | 'running' | 'complete' | 'stopped' | 'failed';
    stopRequested: boolean;
    error: string | null;
    updatedAt: string;
  } | null;
  progress: MailCollectionProgress | null;
  reports: {
    day: string;
    dirty: boolean;
    error: string | null;
    pageId: string | null;
  }[];
  recent: {
    id: string;
    subject: string;
    sent_at: string;
    created_at: string;
    analysis_status: string;
    analysis_error: string | null;
  }[];
}
export interface DailyMailSource {
  id: string;
  subject: string;
  sender: string;
  receivedAt: string;
  sentAt?: string;
  intent?: string;
  analysisState?: string;
  intentCorrected?: boolean;
}
export interface DailyMailItem {
  ref: string;
  text: string;
  status: string;
  evidence: string;
  source: DailyMailSource;
  sourceType?: 'body' | 'image';
  confidence?: 'readable' | 'uncertain';
  assignee?: string | null;
  assigneeConfirmed?: boolean;
  due?: string | null;
  dueOriginal?: string | null;
  visibleFrom?: string;
  serviceDate?: string | null;
  serviceOriginal?: string | null;
  dueAt?: string | null;
  dueDate?: string | null;
  duePrecision?: 'time' | 'day' | null;
  resolution?: {
    manual: boolean;
    done?: boolean;
    actor?: string;
    updatedAt?: string;
    evidence?: string;
    source?: DailyMailSource;
  };
}
export interface DailyMailOverview {
  workItems?: DailyWork[];
  workSections?: {
    id: 'tasks' | 'issues' | 'reference' | 'completed';
    title: string;
  }[];
  workStatusLabels?: Record<string, string>;
  day: string;
  title: string;
  groups: {
    name: string;
    threads: {
      subject: string;
      mails: {
        source: DailyMailSource;
        summary: { text: string; evidence: string }[];
      }[];
    }[];
  }[];
  issues: DailyMailItem[];
  tasks: DailyMailItem[];
  waiting: DailyMailItem[];
  resolvedWaiting?: DailyMailItem[];
  sources: DailyMailSource[];
}
export interface DailyWork {
  section:
    'tasks' | 'issues' | 'reference' | 'routine' | 'review' | 'completed';
  schema: 'sajo-daily-work-v1';
  reportKind?: 'routine' | 'review' | null;
  workId: string;
  portalTaskId: string | null;
  controlRef: string | null;
  category: 'task' | 'issue' | 'reference';
  title: string;
  summary: string[];
  nextAction: string | null;
  progress: string | null;
  waitingFor: string | null;
  center: string | null;
  customer: string | null;
  requester: string | null;
  assignee: string | null;
  requestedAt: string | null;
  dueAt: string | null;
  dueDate: string | null;
  serviceDate: string | null;
  status: 'pending' | 'in_progress' | 'waiting' | 'complete' | 'cancelled';
  closedAt: string | null;
  ownerStateAt: string | null;
  inferredStateAt?: string | null;
  sourceRefs: {
    kind: 'mail' | 'manual' | 'assistant' | 'linked';
    id: string;
    ref: string;
    title: string | null;
    receivedAt: string | null;
    dateBasis?: 'received' | 'sent' | 'input';
    collectedAt?: string | null;
    evidence?: string | null;
    intentCorrected?: boolean;
  }[];
  needsConfirmation: boolean;
  originRef: string;
}
export interface MailAnalysisRule {
  id: string;
  name: string;
  enabled: boolean;
  mode: 'all' | 'any';
  conditions: {
    field: 'subject' | 'body' | 'sender' | 'domain';
    value: string;
  }[];
}
export interface MailFilterStatus {
  schemaReady: boolean;
  offset?: number;
  nextOffset?: number;
  hasMore?: boolean;
  rules: MailAnalysisRule[];
  messages: {
    id: string;
    subject: string;
    sender: string;
    sent_at: string;
    analysis_status: string;
    analysis_excluded: boolean;
    analysis_filter_override: 'inherit' | 'include' | 'exclude';
    analysis_exclusion?: {
      reason?: string;
      ruleName?: string;
      ruleId?: string;
    } | null;
  }[];
}
export interface MailRulePreview {
  matches: {
    id: string;
    subject: string;
    sender: string;
    matched: boolean;
    reason?: string | null;
    matchedFields: string[];
  }[];
  scanned: number;
  nextOffset: number;
  more: boolean;
  unresolved: { id: string; subject?: string; code: string; reason?: string }[];
}
export interface MailManualItem {
  details?: string[];
  entryId?: string;
  itemId: string;
  ref: string;
  text: string;
  kind: 'task' | 'dispatch' | 'issue' | 'reference' | 'waiting';
  visibleFrom: string;
  receivedAt: string;
  submittedAt?: string;
  serviceDate: string | null;
  serviceOriginal?: string | null;
  dueAt: string | null;
  dueDate?: string | null;
  duePrecision?: 'time' | 'day' | null;
  dueOriginal?: string | null;
  assignee: string | null;
  done: boolean;
  completedAt: string | null;
  needsConfirmation?: boolean;
}
export interface MailManualEntry {
  entryId: string;
  status: 'ready' | 'pending' | 'processing' | 'failed';
  submittedAt: string;
  receivedAt?: string;
  reportDay: string;
  referenceDate: string | null;
  referenceSource: 'owner' | 'received';
  authoredDate: string | null;
  needsConfirmation: boolean;
  error?: string | null;
  items: MailManualItem[];
}
export interface MailManualList {
  day: string;
  entries: MailManualEntry[];
  tasks: MailManualItem[];
  issues: MailManualItem[];
}
export const privateMail = {
  manualSource: (entryId: string) =>
    oneDriveCall<{
      entryId: string;
      text: string;
      clientRequestId: string;
      requestedReference: string | null;
      submittedAt: string;
      referenceDate: string | null;
      authoredDate: string | null;
    }>('private-mail-manual-source', { entryId }),
  manualEnqueue: (body: {
    text: string;
    clientRequestId: string;
    referenceDate?: string | null;
    retry?: boolean;
  }) => oneDriveCall<MailManualEntry>('private-mail-manual-enqueue', body),
  manualAdd: (body: {
    text: string;
    clientRequestId: string;
    referenceDate?: string | null;
    retry?: boolean;
  }) =>
    oneDriveCall<MailManualEntry>(
      'private-mail-manual-add',
      body,
      false,
      255000,
    ),
  manualList: (day: string) =>
    oneDriveCall<MailManualList>('private-mail-manual-list', { day }),
  manualUpdate: (body: { entryId: string; itemId: string; done: boolean }) =>
    oneDriveCall<{
      entryId: string;
      itemId: string;
      done: boolean;
      completedAt: string | null;
      reportDay: string;
    }>('private-mail-manual-update', body),

  dailyOverview: (day?: string) =>
    oneDriveCall<DailyMailOverview>('private-mail-daily-overview', { day }),
  correctIntent: (id: string, reference: boolean) =>
    oneDriveCall<{ saved: boolean }>('private-mail-intent-correction', {
      id,
      reference,
    }),
  setTaskStatus: (body: { ref: string; done: boolean; day: string }) =>
    oneDriveCall<{ saved: boolean }>('private-mail-item-status', body),
  filterStatus: (offset = 0) =>
    oneDriveCall<MailFilterStatus>('private-mail-filter-status', { offset }),
  previewRule: (body: {
    rule: MailAnalysisRule;
    offset?: number;
    limit?: number;
  }) => oneDriveCall<MailRulePreview>('private-mail-rules-preview', body),
  saveRules: (body: { rules: MailAnalysisRule[]; previewConfirmed: boolean }) =>
    oneDriveCall<{ saved: boolean }>('private-mail-rules-save', body),
  setMailFilter: (body: {
    id: string;
    override: 'inherit' | 'include' | 'exclude';
    confirmExisting?: boolean;
  }) => oneDriveCall<{ saved: boolean }>('private-mail-filter-override', body),
  applyRules: (body: { ids: string[]; confirmExisting?: boolean }) =>
    oneDriveCall<{
      results: {
        id: string;
        excluded?: boolean;
        reason?: string;
        ruleName?: string;
      }[];
      scanned: number;
      unresolved: { id: string; code: string }[];
    }>('private-mail-filter-apply-preview', body),
  analyzeOne: (id: string) =>
    oneDriveCall<{ status: string; code?: string; reportDay?: string }>(
      'private-mail-analyze-one',
      { id },
      false,
      255000,
    ),
  writeReport: (day: string) =>
    oneDriveCall<{ status: string; code?: string }>(
      'private-mail-report-now',
      { day },
      false,
      255000,
    ),
  automationStatus: () =>
    oneDriveCall<MailAutomationStatus>('private-mail-automation-status'),
  automationConfig: (config: { enabled: boolean }) =>
    oneDriveCall<{ saved: boolean; config: MailAutomationStatus['config'] }>(
      'private-mail-automation-config',
      config,
    ),
  runAutomation: () =>
    oneDriveCall<{ job: { id: string; status: string } }>(
      'private-mail-run-now',
    ),
  stopAutomation: () =>
    oneDriveCall<{ stopped: boolean }>('private-mail-job-stop'),
  briefingStatus: () =>
    oneDriveCall<{
      readable: boolean;
      writeVerified: boolean;
      hasWriteScope?: boolean;
      reason: string;
      notebookName?: string;
      sectionName?: string;
    }>('private-mail-briefing-status'),
  status: () => oneDriveCall<{ mailboxes: Mailbox[] }>('private-mail-status'),
  list: (query = '', offset = 0) =>
    oneDriveCall<{ messages: MailMessage[]; more: boolean }>(
      'private-mail-list',
      { query, offset },
    ),
  detail: (id: string) =>
    oneDriveCall<{ message: MailMessage }>('private-mail-detail', { id }),
  download: (id: string, index: number) =>
    oneDriveCall<Blob>('private-mail-download', { id, index }, true),
};
export async function runMailCollection(
  mode = 'collect',
  continuous = false,
  identity?: { requestId: string; cycleId?: string },
): Promise<{
  counts?: { saved?: number; deferred?: number };
  progress?: MailCollectionProgress;
}> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session || session.user?.id !== MAIL_DIAGNOSTIC_OWNER_ID)
    throw Error('본인 계정으로 다시 로그인해 주세요.');
  let response: Response;
  try {
    response = await fetch('/api/private-mail-collect', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode, continuous, ...identity }),
      signal: AbortSignal.timeout(255000),
    });
  } catch {
    throw Object.assign(
      Error(
        '메일 서버 응답을 기다리지 못했습니다. 저장 위치에서 다시 시도합니다.',
      ),
      { code: 'NETWORK_ERROR' },
    );
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    const allowed = new Set([
      'BATCH_TIMEOUT',
      'FILE_UPLOAD_FAILED',
      'COLLECTION_NOT_CONFIGURED',
      'OWNER_SYNC_DISABLED',
      'AUTH_REQUIRED',
      'OWNER_CONNECTION_REQUIRED',
      'MAILBOX_TARGET_REJECTED',
      'OWNER_FOLDER_REQUIRED',
      'DRIVE_OWNER_UNAVAILABLE',
      'PERMISSIONS_INCOMPLETE',
      'ANONYMOUS_LINK_PRESENT',
      'ORGANIZATION_LINK_PRESENT',
      'SHARING_LINK_PRESENT',
      'INVITATION_PRESENT',
      'PERMISSION_IDENTITY_UNAVAILABLE',
      'OTHER_PRINCIPAL_PRESENT',
      'MAILBOX_BUSY',
      'FOLDER_CHECK_FAILED',
      'BEGIN_FAILED',
      'POP_CONNECTION_FAILED',
      'POP_LOGIN_FAILED',
      'POP_USER_REJECTED',
      'POP_PASSWORD_REJECTED',
      'POP_AUTH_TIMEOUT',
      'POP_AUTH_CLOSED',
      'POP_AUTH_PROTOCOL_ERROR',
      'POP_MAILBOX_BUSY',
      'POP_LOGIN_DELAY',
      'POP_AUTH_SERVER_ERROR',
      'COLLECTION_FAILED',
      'FINALIZE_FAILED',
      'COLLECTION_CHANGED',
    ]);
    const code = allowed.has(failure.code) ? failure.code : 'REQUEST_FAILED';
    const stages: Record<string, string> = {
      configuration: '서버 설정',
      begin: '메일함 준비',
      connect: '메일 서버 연결',
      login: '메일 로그인',
      collect: '메일 저장',
      finalize: '수신 상태 기록',
    };
    throw Object.assign(
      Error((stages[failure.stage] || '메일 수신') + ' 실패 · ' + code),
      { code, status: response.status },
    );
  }
  return response.json();
}

import { oneDriveCall } from './onedrive';
export interface AiDefault {
  provider: string;
  model: string;
  protocol?: string;
  revision: number;
  scope?: string;
}
export interface AiModel {
  id: string;
  support: 'supported' | 'unsupported' | 'unknown';
  available: boolean;
  diagnosticCapabilities?: AiModel['capabilities'];
  capabilities: null | {
    protocol: string;
    images: boolean;
    structured: string;
    verification: string;
  };
}
export interface AiProvider {
  id: string;
  label: string;
  secretName: string;
  keyConfigured: boolean;
  maskedKey: string;
  liveVerified: boolean;
  catalogStatus: 'ready' | 'not_configured' | 'access_denied' | 'unavailable';
  models: AiModel[];
}
export interface ApiManagementStatus {
  judgment?: {
    provider: string;
    keyConfigured: boolean;
    liveVerified: boolean;
  };
  scope: string;
  default: AiDefault;
  providers: AiProvider[];
}
export interface ApiCompatibilityResult {
  provider: string;
  model: string;
  protocol: string;
  checkedAt: string;
  passed: boolean;
  checks: {
    kind: string;
    status: string;
    returnedModel?: string;
    stopReason?: string;
    usage?: Record<string, number | null>;
    unsupportedProbability?: number;
    reviewRequired?: boolean;
    providerStatus?: number | null;
    diagnosticCode?: string | null;
    responseReason?: string | null;
    retryAfterSeconds?: number | null;
  }[];
}
export const apiManagement = {
  stressCases: () => oneDriveCall<{cases:{id:string;kind:string}[]}>(
    'private-mail-stress-verify', {confirmation:'isolated-stress',list:true}, false, 30000),
  stressCase: (caseId:string,receiptId?:string) => oneDriveCall<Record<string,unknown>>(
    'private-mail-stress-verify', {confirmation:'isolated-stress',caseId,...(receiptId?{receiptId}:{})}, false, 180000),
  stressNote: (proof:string,stored:unknown) => oneDriveCall<Record<string,unknown>>(
    'private-mail-stress-verify', {confirmation:'isolated-stress',operation:'notes',proof,stored}, false, 180000),
  verify: (provider: string, model: string) =>
    oneDriveCall<ApiCompatibilityResult>(
      'api-admin-verify',
      { provider, model, confirmation: 'synthetic-compatibility' },
      false,
      75000,
    ),
  status: () =>
    oneDriveCall<ApiManagementStatus>('api-admin-status', {}, false, 30000),
  save: (provider: string, model: string, revision: number) =>
    oneDriveCall<{ saved: boolean; default: AiDefault }>(
      'api-admin-default',
      { provider, model, revision },
      false,
      30000,
    ),
};

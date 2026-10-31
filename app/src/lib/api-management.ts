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
  scope: string;
  default: AiDefault;
  providers: AiProvider[];
}
export const apiManagement = {
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

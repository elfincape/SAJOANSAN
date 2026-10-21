import { oneDriveCall } from './onedrive';
export interface PortalBackup {
  id: string;
  period: string;
  status: string;
  file_name: string;
  captured_at: string;
  counts: Record<string, number>;
  last_error?: string;
  attempts: number;
  verified_at?: string;
}
export interface BackupComparison {
  total: number;
  counts: {
    table_name: string;
    added: number;
    removed: number;
    changed: number;
  }[];
  items: {
    table_name: string;
    title: string;
    action: string;
    fields: string[];
  }[];
  limited?: boolean;
}
export const portalBackups = {
  list: async () =>
    (await oneDriveCall<{ backups: PortalBackup[] }>('backups-list')).backups,
  compare: (id: string) =>
    oneDriveCall<BackupComparison>('backups-compare', { id }),
  retry: (id: string) => oneDriveCall('backups-retry', { id }),
  download: (id: string) =>
    oneDriveCall<Blob>('backups-download', { id }, true),
};

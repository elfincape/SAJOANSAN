import { oneDriveCall } from './onedrive';
export interface PortalFile {
  id: string;
  file_name: string;
  original_name: string;
  byte_size: number;
  created_at: string;
  status: string;
  uploaded_by: string;
  request_id: string;
  last_error?: string | null;
}
export const operationsFiles = {
  health: () => oneDriveCall<{ rootAccessible: boolean }>('operations-health'),
  settings: () =>
    oneDriveCall<{
      folderUrl?: string;
      connected?: boolean;
      folderConfigured?: boolean;
      root_name?: string;
      root_url?: string;
      configured?: boolean;
    }>('operations-settings'),
  configure: (url: string) => oneDriveCall('operations-config', { url }),
  list: async (kind: string, subjectId: string) =>
    (
      await oneDriveCall<{ files: PortalFile[] }>('operations-list', {
        kind,
        subjectId,
      })
    ).files,
  download: (fileId: string) =>
    oneDriveCall<Blob>('operations-download', { fileId }, true),
  upload: ({
    kind,
    subjectId,
    requestId,
    file,
  }: {
    kind: string;
    subjectId: string;
    requestId: string;
    file: File;
  }) => {
    const form = new FormData();
    form.set('kind', kind);
    form.set('subjectId', subjectId);
    form.set('requestId', requestId);
    form.set('file', file);
    return oneDriveCall<PortalFile>('operations-upload', form);
  },
};

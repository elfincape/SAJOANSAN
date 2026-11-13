import { oneDriveCall } from './onedrive';
export interface PortalFile {
  id: string;
  file?: { id: string };
  mime_type?: string;
  file_name: string;
  original_name: string;
  byte_size: number;
  created_at: string;
  status: string;
  uploaded_by: string;
  request_id: string;
  ordinal?: number;
  verified_at?: string | null;
  last_error?: string | null;
}
interface FileReceipt { id: string; saved: true }
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
  upload: async ({
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
    const receipt = await oneDriveCall<FileReceipt>('operations-upload', form);
    if (receipt?.saved !== true || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(receipt.id))
      throw new Error('파일의 최종 저장을 확인하지 못했습니다. 같은 요청으로 저장 상태를 확인해 주세요.');
    return receipt;
  },
};

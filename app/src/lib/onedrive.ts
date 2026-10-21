import { supabase } from './supabase';
import type { DocumentAdapter, DocumentRecord, DocumentUpload } from '../domain/driver-documents';

export async function oneDriveCall<T>(action: string, body?: FormData | Record<string, unknown>, binary = false): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('다시 로그인해 주세요.');
  const multipart = body instanceof FormData;
  const response = await fetch(import.meta.env.VITE_SUPABASE_URL + '/functions/v1/onedrive-auth/' + action, {
    method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, apikey: import.meta.env.VITE_SUPABASE_ANON_KEY, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: multipart ? body : JSON.stringify(body || {}), signal: AbortSignal.timeout(110000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw Object.assign(new Error(error.error || 'OneDrive 요청에 실패했습니다.'), { status: response.status });
  }
  return (binary ? response.blob() : response.json()) as Promise<T>;
}
export const oneDriveConnection = {
  status: () => oneDriveCall<{ connected: boolean }>('status'),
  configureArchive: (url: string) => oneDriveCall('archive-config', { url }),
  configurePdf: (url: string) => oneDriveCall('pdf-config', { url }),
  configureCompany: (url: string) => oneDriveCall('company-config', { url }),
};
export const companyDocuments: DocumentAdapter = {
  status: oneDriveConnection.status,
  list: async driverId => (await oneDriveCall<{ documents: DocumentRecord[] }>('company-list', { driverId })).documents,
  download: (driverId, kind, version, documentId) => oneDriveCall<Blob>('company-download', { driverId, kind, version, documentId }, true),
  remove: (driverId, kind, version, documentId) => oneDriveCall('company-remove', { driverId, kind, version, documentId }),
  upload: async ({ driverId, kind, file, requestId }: DocumentUpload) => {
    const form = new FormData(); form.set('driverId', driverId); form.set('kind', kind); form.set('file', file); form.set('requestId', requestId);
    return oneDriveCall('company-upload', form);
  },
};
export async function connectOneDrive() {
  const result = await oneDriveCall<{ authorizationUrl: string; state: string; proof: string }>('start', { returnPath: location.pathname + location.search });
  const target = new URL(result.authorizationUrl);
  if (target.origin !== 'https://login.microsoftonline.com') throw new Error('로그인 주소가 올바르지 않습니다.');
  sessionStorage.setItem('onedrive-proof', JSON.stringify({ state: result.state, proof: result.proof, returnPath: location.pathname + location.search }));
  location.assign(result.authorizationUrl);
}
export async function finishOneDrive() {
  const state = new URLSearchParams(location.search).get('onedrive_state');
  if (!state) return false;
  const saved = JSON.parse(sessionStorage.getItem('onedrive-proof') || 'null');
  if (!saved || saved.state !== state) throw new Error('연결을 시작한 브라우저에서 다시 로그인해 주세요.');
  await oneDriveCall('finish', { state, proof: saved.proof }); sessionStorage.removeItem('onedrive-proof');
  const path = String(saved.returnPath || '/admin/drivers.html');
  history.replaceState(null, '', path.startsWith('/portal/') || path.startsWith('/admin/drivers.html') ? path : '/admin/drivers.html');
  return true;
}

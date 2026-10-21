export const DOCUMENT_TYPES = [
  ['food_transport', '식품운반업 앞'], ['food_transport_back', '식품운반업 뒤'],
  ['livestock_transport', '축산물운반업 앞'], ['livestock_transport_back', '축산물운반업 뒤'],
  ['freight_license', '화물운송사자격증'], ['vehicle_registration', '차량등록증'],
  ['identity', '신분증'], ['health_certificate', '보건증'],
] as const;
export interface DocumentRecord {
  id?: string; document_type: string; request_id?: string; uploaded_at: string;
  page_number?: number; file_name?: string;
}
export interface PdfSaved { saved: boolean; fileName: string }
export interface DocumentUpload { driverId: string; kind: string; file: File; expiresOn?: string; requestId: string; companyId?: string | null }
export interface DocumentAdapter {
  status: () => Promise<{ connected: boolean }>;
  list: (ownerId: string) => Promise<DocumentRecord[]>;
  download: (ownerId: string, kind: string, version: string, id?: string) => Promise<Blob>;
  remove: (ownerId: string, kind: string, version: string, id?: string) => Promise<unknown>;
  upload: (input: DocumentUpload) => Promise<unknown>;
  replaceCompany?: (ownerId: string, kind: string) => Promise<{ count: number }>;
  compilePdf?: (ownerId: string, onProgress?: (message: string) => void, options?: { includeCompany?: boolean }) => Promise<PdfSaved>;
}
export function validateDocumentFile(file: File) {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('JPG, PNG, WEBP 사진을 선택해 주세요.');
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new Error('사진은 10MB 이하만 선택할 수 있습니다.');
}

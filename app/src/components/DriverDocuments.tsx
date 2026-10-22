import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { registerWorkspaceNavigationGuard } from '../lib/workspace-navigation';
import { FileArea } from './FileArea';
import { DOCUMENT_TYPES, validateDocumentFile } from '../domain/driver-documents';
import type { DocumentAdapter, DocumentRecord } from '../domain/driver-documents';

const noop = () => {};
const emptyExpiry = () => '';
const emptyPdfOptions = () => ({});
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);
export function DriverDocuments({ ownerId, adapter, companyMode = false, getExpiry = emptyExpiry, getPdfOptions = emptyPdfOptions, onSaved = noop, onRecords = noop, editable = true, resetKey = 0, id, className = '' }: {
  ownerId?: string | null; adapter: DocumentAdapter; companyMode?: boolean;
  getExpiry?: () => string; getPdfOptions?: () => { includeCompany?: boolean };
  onSaved?: (ownerId: string, kind: string, expiry: string) => void;
  onRecords?: (ownerId: string, records: DocumentRecord[] | null) => void;
  editable?: boolean; resetKey?: number; id?: string; className?: string;
}) {
  const [notice, setNotice] = useState('');
  const [records, setRecords] = useState<DocumentRecord[]>([]);
  const [loaded, setLoaded] = useState(false), [pending, setPending] = useState(false);
  const pendingRef = useRef(false), generation = useRef(0);
  const urls = useRef(new Set<string>()), inputs = useRef(new Map<string, HTMLInputElement>());
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const clearUrls = () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current.clear(); };
  useEffect(() => {
    const unregister = registerWorkspaceNavigationGuard(() => !pendingRef.current);
    const unload = (event: BeforeUnloadEvent) => { if (pendingRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', unload); window.addEventListener('pagehide', clearUrls);
    return () => { unregister(); window.removeEventListener('beforeunload', unload); window.removeEventListener('pagehide', clearUrls); clearUrls(); };
  }, []);
  useLayoutEffect(() => {
    const id = ++generation.current;
    clearUrls(); setPreviews({}); setRecords([]); setLoaded(false);
    if (!ownerId) { setNotice((companyMode ? '운수사' : '기사') + ' 기본 정보를 먼저 저장하세요.'); return; }
    setNotice('사진 선택 또는 Ctrl+V로 자동 저장됩니다. 뒷면은 여러 장 추가할 수 있습니다.');
    void (async () => {
      try {
        if ((await adapter.status()).connected !== true) throw new Error('관리자가 OneDrive를 먼저 연결해 주세요.');
        const result = await adapter.list(ownerId); onRecords(ownerId, result);
        if (id === generation.current) { setRecords(result); setLoaded(true); }
      } catch (error) { if (id === generation.current) setNotice(errorMessage(error)); }
    })();
    return () => { generation.current++; };
  }, [ownerId, adapter, companyMode, onRecords, resetKey]);
  async function run(work: (current: () => boolean) => Promise<string | void>, reloadAfter = true) {
    if (pendingRef.current || !loaded || !ownerId) return;
    const id = generation.current, savedOwner = ownerId, current = () => generation.current === id;
    pendingRef.current = true; setPending(true); let message = '';
    try { message = await work(current) || '저장 완료'; }
    catch (error) { message = errorMessage(error); }
    finally {
      if (reloadAfter) try {
        const result = await adapter.list(savedOwner); onRecords(savedOwner, result);
        if (current()) { clearUrls(); setPreviews({}); setRecords(result); setLoaded(true); }
      } catch (error) { onRecords(savedOwner, null); if (current()) setLoaded(false); message += ' · 목록 조회 실패: ' + errorMessage(error); }
      pendingRef.current = false; setPending(false); if (current()) setNotice(message);
    }
  }
  async function save(kind: string, files: File[]) {
    if (!files.length || !editable || !ownerId) return;
    const expiry = getExpiry(), multiple = kind.endsWith('_back');
    try {
      files.forEach(validateDocumentFile);
      if (!multiple && files.length > 1) throw new Error('앞면 및 단일 서류는 한 장만 선택해 주세요.');
      if (kind === 'health_certificate' && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new Error('보건증 만료일을 먼저 선택해 주세요.');
    } catch (error) { setNotice(errorMessage(error)); const input = inputs.current.get(kind); if (input) input.value = ''; return; }
    await run(async current => {
      let saved = 0;
      try {
        for (const file of files) {
          if (current()) setNotice(`저장중 · ${saved + 1}/${files.length}`);
          await adapter.upload({ driverId: ownerId, kind, file, expiresOn: expiry, requestId: crypto.randomUUID() });
          saved++; onSaved(ownerId, kind, expiry);
        }
        return `${saved}장 저장 완료`;
      } catch (error) { throw new Error(`${saved}장 저장 완료 · 나머지 사진 저장 실패: ${errorMessage(error)}`); }
      finally { const input = inputs.current.get(kind); if (input) input.value = ''; }
    });
  }
  const types = companyMode ? DOCUMENT_TYPES.slice(0, 4) : DOCUMENT_TYPES;
  return <div id={id} className={`${className} document-manager`}>
    <h3 className="document-manager-title app-function-title">{companyMode ? '운수사 인허가 사진' : '기사 서류 사진'}</h3><p className="document-manager-notice" role="status">{notice}</p>
    {ownerId ? types.map(([kind, label]) => {
      const pages = records.filter(row => row.document_type === kind).sort((a, b) => (a.page_number || 0) - (b.page_number || 0));
      return <FileArea as="section" accept="image/jpeg,image/png,image/webp" multiple={kind.endsWith('_back')} disabled={pending || !loaded || !editable} onFiles={files => void save(kind, files)} key={`${ownerId}:${resetKey}:${kind}`} className="document-kind" data-file-dropzone="" onPaste={event => {
        if (pendingRef.current || !loaded || !editable) return;
        let files = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
        if (!files.length) files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
        if (files.length) { event.preventDefault(); void save(kind, files); }
      }}>
        <details className="document-kind-details" open={kind === types[0][0]}><summary className="document-kind-heading"><span>{label}</span><span className="document-count">{pages.length}장</span></summary><div className="document-kind-content">
          <div className="document-upload-actions"><label className="document-upload-label">사진 선택<input ref={element => { if (element) inputs.current.set(kind, element); else inputs.current.delete(kind); }} type="file" accept="image/jpeg,image/png,image/webp" multiple={kind.endsWith('_back')} className="document-file-input" aria-label={`${label} 사진 선택`} disabled={pending || !loaded || !editable} onChange={event => void save(kind, [...(event.currentTarget.files || [])])} /></label><button type="button" className="btn btn-ghost text-xs" disabled={pending || !loaded || !editable} aria-label={`${label} 사진 붙여넣기`}>붙여넣기 · Ctrl+V</button>
            {!companyMode && ['food_transport', 'livestock_transport'].includes(kind) && adapter.replaceCompany ? <button type="button" className="btn btn-ghost text-xs document-company-replace" disabled={pending || !loaded || !editable} onClick={() => {
              if (!window.confirm(label.replace(' 앞', '') + ' 앞면과 모든 뒷면을 기사에 저장된 운수사의 사진으로 대체하시겠습니까?')) return;
              void run(async () => { setNotice('운수사 사진 복사 중…'); const result = await adapter.replaceCompany!(ownerId, kind); return `운수사 사진 ${result.count}장으로 대체했습니다.`; });
            }}>운수사 대체</button> : null}
          </div>
          {kind.endsWith('_back') ? <p className="document-hint">여러 장 선택 가능 · 기존 뒷면에 추가됩니다.</p> : null}
          <div className="document-file-list">{pages.length ? pages.map((row, index) => {
            const key = row.id || `${kind}:${row.page_number || 0}`, version = row.request_id || row.uploaded_at;
            return <div key={key} className="document-file"><div className="document-file-info"><p className="document-file-name">{row.file_name || (kind.endsWith('_back') ? `${index + 1}번째 사진` : '등록 사진')}</p><p className="document-file-date">{new Date(row.uploaded_at).toLocaleString('ko-KR')} 저장</p></div><div className="document-file-actions"><button type="button" className="btn btn-ghost text-xs" disabled={pending || !loaded} onClick={() => void run(async current => {
              setNotice('사진 불러오는 중…'); const blob = await adapter.download(ownerId, kind, version, row.id);
              if (current()) { const url = URL.createObjectURL(blob); urls.current.add(url); setPreviews(previous => ({ ...previous, [key]: url })); }
              return '저장된 사진 · 마우스를 올리면 확대됩니다.';
            }, false)}>저장 사진 보기</button><button type="button" className="btn btn-ghost text-xs" disabled={pending || !loaded || !editable} onClick={() => { if (window.confirm('선택한 사진을 삭제 보관 폴더로 이동하시겠습니까?')) void run(async () => { await adapter.remove(ownerId, kind, version, row.id); return '사진 삭제 완료'; }); }}>사진 삭제</button></div><div>{previews[key] ? <><img src={previews[key]} alt={row.file_name || '서류 사진'} tabIndex={0} className="driver-document-preview max-h-48 max-w-full object-contain" title="마우스를 올리면 확대됩니다." /><img src={previews[key]} alt="" className="driver-document-zoom" aria-hidden="true" /></> : null}</div></div>;
          }) : <p className="document-empty">등록된 사진 없음</p>}</div>
        </div></details>
      </FileArea>;
    }) : null}
    {ownerId && adapter.compilePdf && !companyMode ? <section className="border-t border-zinc-700 pt-3 space-y-2"><button type="button" className="btn btn-ghost text-xs" disabled={pending || !loaded || !records.length} onClick={() => void run(async current => {
      const result = await adapter.compilePdf!(ownerId, message => { if (current()) setNotice(message); }, getPdfOptions()); return 'OneDrive 저장 완료 · ' + result.fileName;
    }, false)}>인허가 PDF 저장</button><p className="text-xs text-zinc-400">서류가 일부만 등록되어 있어도 등록된 사진만 취합합니다. 사진이 없는 서류는 제외됩니다.</p></section> : null}
  </div>;
}

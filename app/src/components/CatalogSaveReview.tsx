import { useEffect, useRef, useState } from 'react';
import { readCatalog, catalogValueEqual } from '../lib/catalog-scope';
import type { CatalogTable } from '../lib/catalog-scope';
import { ChangeReview } from './Workbench';

export function CatalogSaveReview<T extends { id: string }>({ table, id, error, busy, patch, labels, onRebase }: {
  table: CatalogTable; id: string; error: string; busy: boolean; patch: Record<string, unknown>;
  labels: Record<string, string>; onRebase: (latest: T) => void;
}) {
  const [latest, setLatest] = useState<T | null>(null), [reading, setReading] = useState(false), [readError, setReadError] = useState('');
  const request = useRef(0);
  useEffect(() => { request.current++; setLatest(null); setReadError(''); setReading(false); return () => { request.current++; }; }, [id, error]);
  const display = (key: string, value: unknown) => key === 'photos' ? `${Array.isArray(value) ? value.length : 0}장` : value === null ? '(빈 값)' : typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
  if (!error) return null;
  return <div className="p-3 space-y-2" data-state="error">
    <p role="alert">{error}</p>
    {id ? <button type="button" className="btn btn-ghost" disabled={busy || reading} onClick={async () => {
      const token = ++request.current; setReading(true); setReadError(''); setLatest(null);
      try {
        const result = await readCatalog<T>(table, id);
        if (request.current !== token) return;
        if (result.error) throw result.error;
        if (!result.data) throw Error('원본을 조회할 수 없습니다. 삭제 또는 접근 권한을 확인하세요.');
        setLatest(result.data);
      } catch (reason) { if (request.current === token) setReadError(reason instanceof Error ? reason.message : '최신값 조회에 실패했습니다.'); }
      finally { if (request.current === token) setReading(false); }
    }}>{reading ? '조회 중…' : '최신값 확인'}</button> : null}
    {readError ? <p role="alert">{readError}</p> : null}
    {latest ? <>
      <p className="text-xs">현재 저장값 → 내 입력</p>
      <ChangeReview fields={Object.entries(patch).filter(([key]) => key !== 'id').map(([key, value]) => ({ label: labels[key] || key, before: display(key, (latest as Record<string, unknown>)[key]), after: display(key, value) + (key === 'photos' && !catalogValueEqual((latest as Record<string, unknown>)[key], value) ? ' · 구성 변경' : '') }))}/>
      <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => { onRebase(latest); setLatest(null); }}>내 입력을 유지하고 최신값 기준으로 재검토</button>
    </> : null}
  </div>;
}

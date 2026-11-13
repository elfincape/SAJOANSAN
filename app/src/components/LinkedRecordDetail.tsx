import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { allowWorkspaceNavigation, registerWorkspaceNavigationGuard } from '../lib/workspace-navigation';
import { useAdminPage } from './AdminPage';
import './linked-record.css';

export type LinkedRecord = { kind: 'driver' | 'vehicle' | 'delivery_point'; id: string; label: string };
const pages = { driver: 'drivers', vehicle: 'vehicles', delivery_point: 'delivery-points' };
const labels = { driver: '기사', vehicle: '차량', delivery_point: '납품처' };
export function linkedRecordId() {
  const params = new URLSearchParams(location.search);
  return params.get('linked_detail') === '1' ? params.get('id') || '' : '';
}
declare global { interface Window { linkedRecordCanClose?: (recheck?: boolean) => Promise<boolean> } }
export function useLinkedRecordBridge() {
  useEffect(() => {
    if (!linkedRecordId() || window === parent) return;
    window.linkedRecordCanClose = (recheck) => allowWorkspaceNavigation(recheck);
    const escape = (event: KeyboardEvent) => { if(event.key==='Escape' && !document.querySelector('[role=dialog]')) { event.preventDefault(); parent.postMessage({type:'linked-record-close'},location.origin); } };
    addEventListener('keydown',escape);
    return () => { delete window.linkedRecordCanClose; removeEventListener('keydown',escape); };
  }, []);
}
export function LinkedRecordButton({ record, open }: { record: LinkedRecord; open: (record: LinkedRecord) => void }) {
  return record.id ? <button type="button" className="linked-record-trigger" data-linked-target={record.kind+':'+record.id} aria-label={`${record.label || '연결 원본 확인 필요'} 원본 열기`} onClick={event => { event.stopPropagation(); open(record); }}>{record.label || '연결 원본 확인 필요'}</button> : <>-</>;
}
export function LinkedRecordDetail({ record, close, refresh }: { record: LinkedRecord; close: () => void; refresh: () => Promise<void> }) {
  const { center } = useAdminPage();
  const frame = useRef<HTMLIFrameElement>(null), pending = useRef(false);
  const [closing, setClosing] = useState(false), [error, setError] = useState('');
  const [opener] = useState(() => document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const [originSelector] = useState(() => {
    const target=`[data-linked-target="${CSS.escape(record.kind+':'+record.id)}"]`;
    const row=opener?.closest('[row-id]')?.getAttribute('row-id'), cell=opener?.closest('[col-id]')?.getAttribute('col-id');
    if(row && cell) return `[row-id="${CSS.escape(row)}"] [col-id="${CSS.escape(cell)}"] ${target}`;
    const stop=opener?.closest('tr[data-id]')?.getAttribute('data-id');
    return stop ? `tr[data-id="${CSS.escape(stop)}"] ${target}` : target;
  });
  async function allowClose(recheck = false) {
    try { return await frame.current?.contentWindow?.linkedRecordCanClose?.(recheck) ?? true; }
    catch { setError('원본 화면의 저장 상태를 확인하지 못했습니다. 입력을 확인하세요.'); return false; }
  }
  useEffect(() => registerWorkspaceNavigationGuard(recheck => allowClose(recheck)), []);
  async function dismiss() {
    if (pending.current) return;
    pending.current=true;
    try {
      if (!await allowClose()) return;
      setClosing(true);
      await refresh();
      close();
    } catch { setError('목록을 갱신하지 못했습니다. 다시 닫기를 눌러 확인하세요.'); }
    finally { pending.current=false; setClosing(false); }
  }
  useEffect(() => {
    const request = (event: MessageEvent) => { if(event.origin===location.origin && event.source===frame.current?.contentWindow && event.data?.type==='linked-record-close') void dismiss(); };
    addEventListener('message',request); return () => removeEventListener('message',request);
  }, []);
  const params = new URLSearchParams({ id:record.id, center:center.slug, embedded:'1', linked_detail:'1' });
  return <Dialog.Root open onOpenChange={open => { if(!open) void dismiss(); }}><Dialog.Portal>
    <Dialog.Overlay className="linked-record-overlay" />
    <Dialog.Content className="linked-record-panel" aria-describedby="linked-record-purpose" onInteractOutside={event=>event.preventDefault()} onCloseAutoFocus={event=>{event.preventDefault();requestAnimationFrame(()=>{const target=opener?.isConnected ? opener : document.querySelector<HTMLElement>(originSelector) ?? document.getElementById('work-main'); target?.focus({preventScroll:true});});}}>
      <header><div><Dialog.Title>{labels[record.kind]} 원본</Dialog.Title><p id="linked-record-purpose">공통 원본 수정 · 코스 연결은 유지됩니다.</p></div><button type="button" className="btn btn-ghost" disabled={closing} onClick={()=>void dismiss()}>{closing?'갱신 중…':'닫기'}</button></header>
      {error?<p role="alert">{error}</p>:null}
      <iframe ref={frame} src={`/admin/${pages[record.kind]}.html?${params}`} title={`${labels[record.kind]} 원본 편집`} />
    </Dialog.Content>
  </Dialog.Portal></Dialog.Root>;
}

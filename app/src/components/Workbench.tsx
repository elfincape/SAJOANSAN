import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useAdminPage } from './AdminPage';
import { createWorkspaceStore } from '../lib/workspace-session';
import { useDownload } from './useDownload';
import './workbench.css';

export function SplitPane({ children, scope, revealToken = 0, revealFocus }: { children: [ReactNode, ReactNode]; scope: string; revealToken?: number; revealFocus?: string }) {
  const { profile, center } = useAdminPage();
  const key = `sajo.split.v1:${profile.id}:${center.code}:${scope}`;
  const [width, setWidth] = useState(() => { try { return Math.min(680, Math.max(320, Number(localStorage.getItem(key)) || 480)); } catch { return 480; } });
  const [collapsed, setCollapsed] = useState(() => { if (new URLSearchParams(location.search).has('id')) return false; try { return localStorage.getItem(key + ':collapsed') !== 'false'; } catch { return true; } }), [available, setAvailable] = useState(1100);
  const container = useRef<HTMLDivElement>(null), drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    if (!revealToken) return;
    setCollapsed(false);
    const frame = requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(revealFocus || '.work-editor input:not(:disabled):not([type="hidden"]), .work-editor select:not(:disabled), .work-editor textarea:not(:disabled)')?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [revealToken, revealFocus]);
  useEffect(() => { if (new URLSearchParams(location.search).get('linked_detail') === '1') return; try { localStorage.setItem(key + ':collapsed', String(collapsed)); } catch { /* Current layout remains usable. */ } }, [key, collapsed]);
  const maximum = Math.max(320, Math.min(680, available - 332));
  const effective = Math.min(width, maximum);
  useEffect(() => {
    if (!container.current) return;
    const observer = new ResizeObserver(entries => setAvailable(entries[0].contentRect.width));
    observer.observe(container.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { try { localStorage.setItem(key, String(width)); } catch { /* Layout remains usable without persistence. */ } }, [key, width]);
  return <div ref={container} className="workspace-split" data-editor-collapsed={collapsed} style={{ '--editor-width': effective + 'px' } as CSSProperties}>
    <div className="workspace-split-controls"><span>목록 · 상세 편집</span><button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(previous => !previous)}>{collapsed ? '편집 패널 열기' : '편집 패널 접기'}</button></div>
    {children[0]}
    <div className="workspace-split-handle" role="separator" aria-label="목록과 편집 패널 너비" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={maximum} aria-valuenow={effective} tabIndex={0}
      onPointerDown={event => { if (event.button !== 0) return; drag.current = { x: event.clientX, width: effective }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={event => { if (drag.current) setWidth(Math.max(320, Math.min(maximum, drag.current.width + drag.current.x - event.clientX))); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setWidth(event.key === 'Home' ? 320 : event.key === 'End' ? maximum : Math.max(320, Math.min(maximum, effective + (event.key === 'ArrowLeft' ? 20 : -20)))); }}><span aria-hidden="true"/></div>
    {children[1]}
  </div>;
}

export function useRowSelection(ids: string[], initialIds: string[] = [], ready = true) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialIds));
  const signature = ids.join('|');
  useEffect(() => {
    if (!ready) return;
    const visible = new Set(ids);
    setSelected(previous => { const next = new Set([...previous].filter(id => visible.has(id))); return next.size === previous.size ? previous : next; });
  }, [signature, ready]);
  const toggle = (id: string) => setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  return { selected, toggle, clear: () => setSelected(new Set()), all: () => setSelected(selected.size === ids.length ? new Set() : new Set(ids)) };
}
export function SelectionCheckbox({ checked, mixed = false, label, onChange }: { checked: boolean; mixed?: boolean; label: string; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed; }, [mixed]);
  return <label className="selection-hitbox" onClick={event => event.stopPropagation()}><input ref={ref} type="checkbox" aria-label={label} checked={checked} onChange={onChange} /></label>;
}
export function SelectionActions({ count, clear, children }: { count: number; clear: () => void; children: ReactNode }) {
  return count ? <div className="selection-actions" role="toolbar" aria-label="선택 항목 작업"><strong role="status" aria-live="polite">{count}개 선택</strong><div>{children}</div><button type="button" onClick={clear}>선택 해제</button></div> : null;
}
export function useSelectionExport(name: string, headers: string[], rows: unknown[][]) {
  const { download, downloadLink } = useDownload();
  function exportRows() {
    const cell = (value: unknown) => { let text = String(value ?? ''); if (/^[\s]*[=+\-@]/.test(text)) text = "'" + text; return '"' + text.replaceAll('"', '""') + '"'; };
    download(new Blob(['\uFEFF' + [headers, ...rows].map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), name + '.csv');
  }
  return { exportRows, downloadLink };
}
export function TableSkeleton({ columns }: { columns: number }) {
  return <>{Array.from({ length: 4 }, (_, row) => <tr key={row} aria-hidden="true" className="workbench-skeleton">{Array.from({ length: columns }, (_, col) => <td key={col}><span/></td>)}</tr>)}</>;
}
export function ChangeReview({ fields }: { fields: { label: string; before: unknown; after: unknown }[] }) {
  const changed = fields.filter(field => JSON.stringify(field.before ?? '') !== JSON.stringify(field.after ?? ''));
  return changed.length ? <details className="change-review"><summary>저장 전 변경사항 {changed.length}개 확인</summary><dl>{changed.map(field => <div key={field.label}><dt>{field.label}</dt><dd><del>{String(field.before ?? '') || '비어 있음'}</del><span aria-hidden="true">→</span><ins>{String(field.after ?? '') || '비어 있음'}</ins></dd></div>)}</dl></details> : null;
}

const listViews = createWorkspaceStore<Record<string, string>>('master-list-view', value => Object.values(value).every(item => typeof item === 'string'));
export function useWorkbenchView(scope: string) {
  const { profile, center } = useAdminPage();
  const key = `${profile.id}:${center.code}:${scope}:${new URLSearchParams(location.search).get('id') || 'list'}`;
  const [initial] = useState(() => listViews.get(key) ?? {});
  useEffect(() => {
    const selector = '.work-list .table-wrap';
    let restoring = true;
    const restore = () => { const list = document.querySelector<HTMLElement>(selector); if (restoring && list) list.scrollTop = Number(initial.scroll || 0); };
    const observer = new MutationObserver(restore);
    observer.observe(document.getElementById('work-main') ?? document.body, { childList: true, subtree: true });
    const stop = () => { restoring = false; observer.disconnect(); };
    const timer = setTimeout(stop, 2000);
    const rememberScroll = (event: Event) => { const list = event.target; if (!restoring && list instanceof HTMLElement && list.matches(selector)) listViews.set(key, { ...listViews.get(key), scroll: String(list.scrollTop) }); };
    addEventListener('wheel', stop, { passive: true }); addEventListener('pointerdown', stop, { passive: true }); addEventListener('scroll', rememberScroll, true);
    restore();
    return () => { observer.disconnect(); clearTimeout(timer); removeEventListener('wheel', stop); removeEventListener('pointerdown', stop); removeEventListener('scroll', rememberScroll, true); };
  }, [key, initial]);
  let selection: string[] = [];
  try { const value = JSON.parse(initial.selection || '[]'); if (Array.isArray(value) && value.every(id => typeof id === 'string')) selection = value; } catch { /* Ignore invalid selection metadata. */ }
  return { initial, selection, remember: (value: Record<string, string>) => listViews.set(key, { ...listViews.get(key), ...value }) };
}
const retainedDrafts = createWorkspaceStore<{ selected: string | null; draft: Record<string, string> }>('master-input', value => (value.selected === null || typeof value.selected === 'string') && !!value.draft && Object.values(value.draft).every(item => typeof item === 'string'));
export function useRetainedMasterDraft<T extends { [K in keyof T]: string }>(scope: string, selected: string | null, draft: T, dirty: boolean, ready: boolean) {
  const { profile, center } = useAdminPage();
  const key = `${profile.id}:${center.code}:${scope}:${new URLSearchParams(location.search).get('id') || 'list'}`;
  const [pending, setPending] = useState(() => { const saved = retainedDrafts.get(key); return saved && Object.keys(draft).every(field => typeof saved.draft[field] === 'string') ? saved as unknown as { selected: string | null; draft: T } : undefined; });
  useEffect(() => {
    if (!ready || pending) return;
    if (dirty) retainedDrafts.set(key, { selected, draft: { ...draft } });
    else retainedDrafts.delete(key);
  }, [key, selected, draft, dirty, ready, pending]);
  return { pending, storageKeys: [retainedDrafts.storageKey(key), listViews.storageKey(key)], consume: () => setPending(undefined), discard: () => { retainedDrafts.delete(key); setPending(undefined); } };
}

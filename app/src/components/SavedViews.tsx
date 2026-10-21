import { useEffect, useState } from 'react';
import { useAdminPage } from './AdminPage';
import './workbench.css';

interface SavedView<T> { id: string; name: string; value: T }
function sameShape(value: unknown, shape: unknown, depth = 0): boolean {
  if (depth > 5 || value == null || shape == null) return value === shape;
  if (Array.isArray(shape)) return Array.isArray(value) && value.length <= 200 && value.every(item => typeof item === 'string' || typeof item === 'number' || typeof item === 'object' && item !== null && !Array.isArray(item));
  if (typeof shape === 'object') return typeof value === 'object' && !Array.isArray(value) && Object.entries(shape).every(([key, child]) => sameShape((value as Record<string, unknown>)[key], child, depth + 1));
  return typeof value === typeof shape && (typeof value !== 'string' || value.length <= 2000);
}
export function SavedViews<T extends object>({ scope, value, defaultValue, onApply, disabled = false }: {
  scope: string; value: T; defaultValue: T; onApply: (value: T) => void; disabled?: boolean;
}) {
  const { profile, center } = useAdminPage();
  const key = `sajo.views.v1:${profile.id}:${center.code}:${scope}`;
  const [views, setViews] = useState<SavedView<T>[]>([]);
  const [editing, setEditing] = useState(false), [name, setName] = useState(''), [message, setMessage] = useState('');
  const [removed, setRemoved] = useState<SavedView<T> | null>(null);
  useEffect(() => {
    function load() {
      try {
        const stored: unknown = JSON.parse(localStorage.getItem(key) || '[]');
        setViews(Array.isArray(stored) ? stored.slice(0, 12).filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && item.name.length <= 48 && sameShape(item.value, defaultValue)) : []);
      } catch { setViews([]); }
    }
    load();
    const storage = (event: StorageEvent) => { if (event.key === key || event.key === null) load(); };
    addEventListener('storage', storage);
    return () => removeEventListener('storage', storage);
    // The shape is defined by the screen; current filters never trigger a reload.
  }, [key]);
  function persist(next: SavedView<T>[]) {
    try { localStorage.setItem(key, JSON.stringify(next)); setViews(next); return true; }
    catch { setMessage('보기를 저장하지 못했습니다. 브라우저 저장 공간을 확인하세요.'); return false; }
  }
  const current = JSON.stringify(value);
  return <section className="saved-views" aria-label="저장한 업무 보기">
    <div className="saved-views-row">
      <span className="saved-views-label">업무 보기</span>
      <div className="saved-views-tabs" role="group" aria-label="보기 선택">
        <button type="button" aria-pressed={current === JSON.stringify(defaultValue)} disabled={disabled} onClick={() => { onApply(structuredClone(defaultValue)); setMessage('전체 보기로 전환했습니다.'); }}>전체</button>
        {views.map(view => <span className="saved-view" key={view.id}><button type="button" aria-pressed={current === JSON.stringify(view.value)} disabled={disabled} onClick={() => { onApply(structuredClone(view.value)); setMessage(`‘${view.name}’ 보기를 적용했습니다.`); }}>{view.name}</button><button type="button" className="saved-view-remove" aria-label={`${view.name} 보기 삭제`} disabled={disabled} onClick={() => { if (persist(views.filter(item => item.id !== view.id))) { setRemoved(view); setMessage(`‘${view.name}’ 보기를 삭제했습니다.`); } }}>×</button></span>)}
      </div>
      <button type="button" className="saved-view-add" disabled={disabled || views.length >= 12} aria-expanded={editing} onClick={() => { setEditing(previous => !previous); setMessage(''); }}>현재 보기 저장</button>
    </div>
    {editing ? <form className="saved-view-form" onSubmit={event => {
      event.preventDefault(); const title = name.trim();
      if (!title) { setMessage('보기 이름을 입력하세요.'); return; }
      if (views.some(view => view.name === title)) { setMessage('같은 이름의 보기가 있습니다. 다른 이름을 사용하세요.'); return; }
      if (views.length >= 12) return;
      if (persist([...views, { id: crypto.randomUUID(), name: title, value: structuredClone(value) }])) { setEditing(false); setName(''); setMessage('현재 계정·센터의 이 브라우저에 저장했습니다.'); }
    }}><label>보기 이름<input name="view-name" maxLength={48} autoComplete="off" placeholder="예: 평택 차량 확인" value={name} onChange={event => setName(event.target.value)} /></label><button type="submit" disabled={disabled}>보기 저장</button><button type="button" onClick={() => setEditing(false)}>취소</button></form> : null}
    <div className="saved-view-status" role="status" aria-live="polite">{message}{removed ? <button type="button" disabled={disabled || views.length >= 12} onClick={() => { if (persist([...views, removed])) { setRemoved(null); setMessage('보기 삭제를 취소했습니다.'); } }}>삭제 취소</button> : null}</div>
  </section>;
}

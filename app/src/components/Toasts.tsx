import { useEffect, useState } from 'react';

export interface Notice { id: number; text: string; type: 'success' | 'error' | 'info' | 'warn' }
function Toast({ notice, dismiss }: { notice: Notice; dismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || notice.type === 'error') return;
    const timer = setTimeout(() => dismiss(notice.id), notice.type === 'warn' ? 12000 : 6500);
    return () => clearTimeout(timer);
  }, [notice.id, notice.type, paused, dismiss]);
  return <div data-notice={notice.type} role={notice.type === 'error' ? 'alert' : 'status'} className="pointer-events-auto px-4 py-2.5 rounded-md border shadow-lg text-sm"
    onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}>
    <span className="notice-text">{notice.type === 'error' ? '오류 · ' : notice.type === 'warn' ? '확인 · ' : ''}{notice.text}</span>
    <button type="button" aria-label="알림 닫기" onClick={() => dismiss(notice.id)}>닫기</button>
  </div>;
}
export function Toasts({ notices, dismiss }: { notices: Notice[]; dismiss: (id: number) => void }) {
  return <div id="toast-container" className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" aria-label="처리 결과 알림">{notices.map(notice => <Toast key={notice.id} notice={notice} dismiss={dismiss} />)}</div>;
}

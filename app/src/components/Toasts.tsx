import { useEffect, useState } from 'react';

export interface Notice { id: number; text: string; type: 'success' | 'error' | 'info' | 'warn' }
const styles = {
  info: 'bg-zinc-800 border-zinc-600 text-zinc-100',
  success: 'bg-emerald-900/90 border-emerald-600 text-emerald-50',
  error: 'bg-red-900/90 border-red-600 text-red-50',
  warn: 'bg-amber-900/90 border-amber-600 text-amber-50',
};

function Toast({ notice, dismiss }: { notice: Notice; dismiss: (id: number) => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    const fade = setTimeout(() => setVisible(false), 2800);
    const remove = setTimeout(() => dismiss(notice.id), 3020);
    return () => { cancelAnimationFrame(frame); clearTimeout(fade); clearTimeout(remove); };
  }, [notice.id, dismiss]);
  return <div className={`pointer-events-auto px-4 py-2.5 rounded-md border shadow-lg text-sm transition-all duration-200 ${visible ? '' : 'opacity-0 translate-y-[-4px]'} ${styles[notice.type]}`}>{notice.text}</div>;
}

export function Toasts({ notices, dismiss }: { notices: Notice[]; dismiss: (id: number) => void }) {
  return <div id="toast-container" className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" aria-live="polite">{notices.map(notice => <Toast key={notice.id} notice={notice} dismiss={dismiss} />)}</div>;
}

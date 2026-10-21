import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { Toasts } from './Toasts';
import type { Notice } from './Toasts';

interface Confirmation { message: string; okText: string; cancelText: string; danger: boolean }
export function useFeedback() {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const resolve = useRef<((value: boolean) => void) | undefined>(undefined);
  const sequence = useRef(0);
  const dismiss = useCallback((id: number) => setNotices(items => items.filter(item => item.id !== id)), []);
  useEffect(() => () => resolve.current?.(false), []);
  const toast = useCallback((text: string, type: Notice['type'] = 'info') => {
    setNotices(items => [...items, { id: ++sequence.current, text, type }]);
  }, []);
  function confirm(message: string, options: Partial<Omit<Confirmation, 'message'>> = {}) {
    resolve.current?.(false);
    setConfirmation({ message, okText: '확인', cancelText: '취소', danger: false, ...options });
    return new Promise<boolean>(done => { resolve.current = done; });
  }
  function finish(value: boolean) { resolve.current?.(value); resolve.current = undefined; setConfirmation(null); }
  const feedback = <><Toasts notices={notices} dismiss={dismiss} />{confirmation ? <Modal width="sm" onClose={() => finish(false)}><div className="p-5"><div className="text-sm whitespace-pre-line leading-relaxed text-zinc-100 mb-5">{confirmation.message}</div><div className="flex justify-end gap-2"><button data-act="cancel" className="px-3 py-1.5 rounded-md text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100" onClick={() => finish(false)}>{confirmation.cancelText}</button><button data-act="ok" className={`px-3 py-1.5 rounded-md text-sm ${confirmation.danger ? 'bg-red-600 hover:bg-red-500 text-white' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`} onClick={() => finish(true)}>{confirmation.okText}</button></div></div></Modal> : null}</>;
  return { toast, confirm, feedback };
}

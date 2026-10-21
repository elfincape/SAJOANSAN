import { createContext, createElement, useContext, useEffect, useRef, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';

const extensions: Record<string, string[]> = {
  'image/jpeg': ['jpg', 'jpeg', 'jfif'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/gif': ['gif'],
  'image/bmp': ['bmp'], 'image/avif': ['avif'], 'image/heic': ['heic'], 'image/heif': ['heif'],
  'image/tiff': ['tif', 'tiff'], 'image/svg+xml': ['svg'], 'application/pdf': ['pdf'], 'text/plain': ['txt'], 'text/csv': ['csv'],
};
interface Options { accept: string; multiple?: boolean; disabled?: boolean; onFiles: (files: File[]) => void }
interface Registration extends Options { element: HTMLElement; active: (value: boolean) => void; feedback: (text: string) => void }
const Registry = createContext<Map<symbol, Registration> | null>(null);
function validate(files: File[], options: Options) {
  if (!files.length) throw new Error('업로드할 파일을 놓아 주세요. 폴더는 업로드할 수 없습니다.');
  if (!options.multiple && files.length > 1) throw new Error('이 구역에는 파일을 한 개씩 올려 주세요.');
  const accepted = options.accept.toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
  if (files.some(file => !accepted.some(type => {
    const name = file.name.toLowerCase(), mime = file.type.toLowerCase(), ext = name.split('.').at(-1)!;
    if (type.startsWith('.')) return name.endsWith(type);
    if (type.endsWith('/*')) return mime.startsWith(type.slice(0, -1)) || (!mime && Object.entries(extensions).some(([m, list]) => m.startsWith(type.slice(0, -1)) && list.includes(ext)));
    return mime === type || (!mime && extensions[type]?.includes(ext));
  }) && accepted.length)) throw new Error('이 구역에서 지원하는 파일 형식을 확인해 주세요. (' + options.accept + ')');
  return files;
}
const imageAccept = (accept: string) => !accept || accept.toLowerCase().split(',').some(type => type.trim().startsWith('image/') || /\.(png|jpe?g|jfif|webp|gif|bmp|avif|hei[cf]|tiff?|svg)$/.test(type.trim()));

export function FileTransfers({ children }: { children: ReactNode }) {
  const registrations = useRef(new Map<symbol, Registration>());
  useEffect(() => {
    let active: Registration | undefined;
    const fileDrag = (event: DragEvent) => [...(event.dataTransfer?.types || [])].includes('Files');
    const clear = () => { active?.active(false); active = undefined; };
    const target = (node: EventTarget | null) => {
      if (!(node instanceof Node)) return undefined;
      const found = [...registrations.current.values()].filter(item => item.element.contains(node));
      const nearest = found.filter(a => !found.some(b => a !== b && a.element.contains(b.element)));
      return nearest.length === 1 ? nearest[0] : undefined;
    };
    const hover = (event: DragEvent) => {
      if (!fileDrag(event)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const match = target(event.target), next = match && !match.disabled ? match : undefined;
      if (active !== next) { clear(); active = next; active?.active(true); }
      if (event.dataTransfer) event.dataTransfer.dropEffect = next ? 'copy' : 'none';
    };
    const leave = (event: DragEvent) => { if (active && (!(event.relatedTarget instanceof Node) || !active.element.contains(event.relatedTarget))) clear(); };
    const drop = (event: DragEvent) => {
      if (!fileDrag(event)) return;
      event.preventDefault(); event.stopImmediatePropagation(); clear();
      const match = target(event.target); if (!match) return;
      if (match.disabled) { match.feedback('현재 업로드할 수 없습니다. 진행 중인 작업이 끝난 뒤 다시 놓아 주세요.'); return; }
      try { const files = validate([...(event.dataTransfer?.files || [])], match); match.feedback(''); match.onFiles(files); }
      catch (error) { match.feedback(error instanceof Error ? error.message : '파일을 선택 버튼으로 다시 선택해 주세요.'); }
    };
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || (event.target instanceof Element && event.target.closest('textarea,input:not([type=file]),[contenteditable=true],[role=textbox]'))) return;
      const images = [...(event.clipboardData?.items || [])].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (!images.length) return;
      const match = target(event.target); if (!match || match.disabled || !imageAccept(match.accept)) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const files = images.map((file, index) => file.name && /\.[a-z0-9]+$/i.test(file.name) ? file : new File([file], `clipboard-${Date.now()}-${index + 1}.${(extensions[file.type] || ['png'])[0]}`, { type: file.type }));
      try { validate(files, match); match.feedback(''); match.onFiles(files); }
      catch (error) { match.feedback(error instanceof Error ? error.message : '사진을 파일 선택으로 다시 넣어 주세요.'); }
    };
    window.addEventListener('dragenter', hover, true); window.addEventListener('dragover', hover, true); window.addEventListener('dragleave', leave, true);
    window.addEventListener('drop', drop, true); window.addEventListener('dragend', clear, true); window.addEventListener('blur', clear); window.addEventListener('paste', paste, true);
    return () => {
      clear(); window.removeEventListener('dragenter', hover, true); window.removeEventListener('dragover', hover, true); window.removeEventListener('dragleave', leave, true);
      window.removeEventListener('drop', drop, true); window.removeEventListener('dragend', clear, true); window.removeEventListener('blur', clear); window.removeEventListener('paste', paste, true);
    };
  }, []);
  return <Registry.Provider value={registrations.current}>{children}</Registry.Provider>;
}

export function FileArea({ as = 'div', accept, multiple = false, disabled = false, onFiles, children, className = '', ...props }: Options & Omit<HTMLAttributes<HTMLElement>, 'onDrop'> & { as?: 'div' | 'section' | 'article' | 'button'; children: ReactNode; type?: 'button' }) {
  const registry = useContext(Registry), key = useRef(Symbol());
  const element = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(false), [feedback, setFeedback] = useState('');
  useEffect(() => {
    const id = key.current;
    if (registry && element.current) registry.set(id, { element: element.current, accept, multiple, disabled, onFiles, active: setActive, feedback: setFeedback });
    return () => { registry?.delete(id); };
  }, [registry, accept, multiple, disabled, onFiles]);
  const images = imageAccept(accept);
  return createElement(as, { ...props, ref: element, className: `${className}${active ? ' file-drop-active' : ''}${images ? ' file-paste-target' : ''}`, tabIndex: props.tabIndex ?? (images ? 0 : undefined), onClick: (event: React.MouseEvent<HTMLElement>) => {
    props.onClick?.(event);
    if (images && event.target instanceof Element && !event.target.closest('input,textarea,select,button,a,[contenteditable=true],[role=textbox]')) event.currentTarget.focus({ preventScroll: true });
  } }, children, images ? <p className="file-paste-hint" data-file-paste-hint="">사진 영역을 클릭하고 Ctrl+V로 붙여넣기</p> : null, feedback ? <span className="file-drop-feedback" data-file-drop-feedback="" role="status">{feedback}</span> : null);
}

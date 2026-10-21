import '../styles/image-straightener.css';
import { useEffect, useRef, useState } from 'react';
import { AdminPage } from '../components/AdminPage';

interface Photo { url: string; rotation: number }
export default function ImageStraightener() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  function addFiles(fileList: FileList | File[]) {
    const files = [...fileList].filter(file => file.type.startsWith('image/'));
    if (!files.length) return;
    const added = files.map(file => ({ url: URL.createObjectURL(file), rotation: 0 }));
    urls.current.push(...added.map(item => item.url));
    setCurrentIndex(photos.length);
    setPhotos(items => [...items, ...added]);
    if (fileInput.current) fileInput.current.value = '';
  }
  function move(direction: number) {
    if (photos.length < 2) return;
    setCurrentIndex(index => (index + direction + photos.length) % photos.length);
  }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.items ?? [])].filter(item => item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => !!file);
      if (files.length) { event.preventDefault(); addFiles(files); }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
    };
    document.addEventListener('paste', paste);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('paste', paste); document.removeEventListener('keydown', key); };
  }, [photos.length]);
  useEffect(() => () => { urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []; }, []);
  const photo = photos[currentIndex];
  return <AdminPage title="기울기 보정" feature="imageStraightener" bodyClass="bg-zinc-900 text-zinc-100 h-full flex flex-col">
    <main id="work-main" tabIndex={-1} className="workspace app-main flex-1 flex flex-col">
      <section id="empty-state" className={`flex-1 flex items-center justify-center p-4${photo ? ' hidden' : ''}`}>
        <button id="paste-target" type="button" className="paste-target rounded-2xl flex items-center justify-center" aria-label="사진 추가" onClick={event => event.currentTarget.focus()}><span className="plus">＋</span></button>
      </section>
      <input ref={fileInput} id="file-input" type="file" accept="image/*" multiple hidden onChange={event => { if (event.currentTarget.files) addFiles(event.currentTarget.files); }} />
      <section id="editor" className={`photo-stage flex-1 ${photo ? 'flex' : 'hidden'} items-center justify-center`}>
        {photo ? <img id="photo" alt="" src={photo.url} style={{ transform: `rotate(${photo.rotation}deg)` }} /> : null}
        <button id="previous" type="button" className="nav-button absolute left-3 sm:left-6 top-1/2 -translate-y-1/2" aria-label="이전 사진" disabled={photos.length < 2} onClick={() => move(-1)}>‹</button>
        <button id="next" type="button" className="nav-button absolute right-3 sm:right-6 top-1/2 -translate-y-1/2" aria-label="다음 사진" disabled={photos.length < 2} onClick={() => move(1)}>›</button>
      </section>
      <section id="controls" className={`${photo ? '' : 'hidden '}shrink-0 border-t border-zinc-700 bg-zinc-900 px-4 pt-3 pb-[max(.75rem,env(safe-area-inset-bottom))]`}>
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <span id="photo-count" className="text-xs text-zinc-400 shrink-0" aria-live="polite">{photo ? `${currentIndex + 1} / ${photos.length}` : ''}</span>
          <button id="add-photo" type="button" className="btn btn-ghost shrink-0" aria-label="사진 추가" onClick={() => fileInput.current?.click()}>＋</button>
          <input id="rotation" className="w-full" type="range" min="-90" max="90" step="0.1" value={photo?.rotation ?? 0} aria-label="기울기" onChange={event => {
            const value = Number(event.currentTarget.value);
            setPhotos(items => items.map((item, index) => index === currentIndex ? { ...item, rotation: value } : item));
          }} />
          <output id="rotation-value" className="w-14 text-right text-xs tabular-nums text-zinc-300">{(photo?.rotation ?? 0).toFixed(1)}°</output>
        </div>
      </section>
    </main>
  </AdminPage>;
}

import { useEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';

function Content() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(650);
  const { setControlsDisabled } = useAdminPage();
  useEffect(() => {
    function update(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'talkcloud-state') return;
      if (Number.isFinite(event.data.height)) setHeight(Math.max(500, Math.min(12000, event.data.height)));
      setControlsDisabled(event.data.busy === true);
    }
    window.addEventListener('message', update);
    return () => { window.removeEventListener('message', update); setControlsDisabled(false); };
  }, [setControlsDisabled]);
  return <main id="work-main" tabIndex={-1} className="app-main px-4 py-6">
    <iframe ref={frame} src="/talkcloud/index.html" title="톡클라우드 사진·동영상 정리"
      style={{ width: '100%', height, border: 0, display: 'block', colorScheme: 'normal' }} />
  </main>;
}

export default function Talkcloud() {
  return <AdminPage title="톡클라우드 사진·동영상 정리" feature="talkcloud"><Content /></AdminPage>;
}

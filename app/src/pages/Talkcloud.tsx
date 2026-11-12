import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AdminPage, useAdminPage } from '../components/AdminPage';
import { supabase } from '../lib/supabase';

type HubRequest = (path: string, body?: unknown) => Promise<Response>;
const host = window as Window & { talkcloudRequest?: HubRequest };

function Content() {
  const frame = useRef<HTMLIFrameElement>(null);
  const result = useRef<HTMLElement>(null);
  const [height, setHeight] = useState(650);
  const [message, setMessage] = useState('연결 상태 확인 중');
  const [resultVersion, setResultVersion] = useState(0);
  const [resultImage, setResultImage] = useState('');
  const active = useRef(false);
  const lastActivity = useRef(0);
  const [accountValid, setAccountValid] = useState(true);
  const { setControlsDisabled, profile } = useAdminPage();
  useLayoutEffect(() => {
    let valid = true;
    host.talkcloudRequest = async (path, body) => {
      if (!/^(state|availability|login|rooms|delete|cancel|logout|verification|challenge|result-image|activity)(\?v=\d+)?$/.test(path)) throw new Error('잘못된 요청입니다.');
      const { data: { session } } = await supabase.auth.getSession();
      if (!valid || session?.user.id !== profile.id) throw new Error('관리허브 로그인이 필요합니다.');
      const response = await fetch('/api/talkcloud/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + session.access_token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!valid) throw new Error('계정이 변경됐습니다.');
      return response;
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user.id !== profile.id) {
        valid = false; active.current = false;
        setAccountValid(false); setResultVersion(0); setResultImage(''); setControlsDisabled(false);
        setMessage('계정이 변경됐습니다. 화면을 다시 열어 주세요.');
      }
    });
    return () => { valid = false; delete host.talkcloudRequest; subscription.unsubscribe(); };
  }, [profile.id, setControlsDisabled]);
  useEffect(() => {
    function update(event: MessageEvent) {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.type !== 'talkcloud-state') return;
      if (Number.isFinite(event.data.height)) setHeight(Math.max(500, Math.min(12000, event.data.height)));
      if (typeof event.data.message === 'string') setMessage(event.data.message);
      if (Number.isFinite(event.data.resultVersion)) setResultVersion(event.data.resultVersion);
      active.current = event.data.authenticated === true && event.data.busy !== true;
      setControlsDisabled(event.data.busy === true);
    }
    window.addEventListener('message', update);
    return () => { window.removeEventListener('message', update); setControlsDisabled(false); };
  }, [setControlsDisabled]);
  useEffect(() => {
    let trailing: ReturnType<typeof setTimeout> | undefined;
    function activity() {
      if (!active.current) return;
      if (Date.now() - lastActivity.current < 15000) {
        if (!trailing) trailing = setTimeout(() => { trailing = undefined; activity(); }, 15000);
        return;
      }
      lastActivity.current = Date.now();
      void host.talkcloudRequest?.('activity', {}).catch(() => {});
    }
    for (const type of ['pointerdown', 'keydown', 'wheel']) window.addEventListener(type, activity, { passive: true });
    return () => { clearTimeout(trailing); for (const type of ['pointerdown', 'keydown', 'wheel']) window.removeEventListener(type, activity); };
  }, []);
  useEffect(() => {
    if (!resultVersion) { setResultImage(''); return; }
    const controller = new AbortController();
    let url = '';
    void host.talkcloudRequest?.('result-image?v=' + resultVersion)
      .then(response => { if (!response.ok) throw new Error('완료 화면을 불러오지 못했습니다.'); return response.blob(); })
      .then(blob => { if (!controller.signal.aborted) { url = URL.createObjectURL(blob); setResultImage(url); } })
      .catch(() => {});
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [resultVersion]);
  useEffect(() => { if (resultImage) result.current?.scrollIntoView({ block: 'start' }); }, [resultImage]);
  return <main id="work-main" tabIndex={-1} className="app-main px-4 py-6">
    <div role="status" aria-live="polite" style={{ position: 'sticky', top: 'calc(var(--app-header-height, 64px) + 8px)', zIndex: 20, background: 'var(--theme-panel)', border: '1px solid var(--theme-border)', borderRadius: 10, padding: '14px 18px', marginBottom: 12 }}>{message}</div>
    {resultImage && <figure ref={result} style={{ margin: '0 0 20px', scrollMarginTop: 'calc(var(--app-header-height, 64px) + 80px)' }}><figcaption style={{ marginBottom: 8 }}>삭제 완료 후 휴지통 화면</figcaption><img src={resultImage} alt="삭제 완료 후 톡클라우드 휴지통" style={{ display: 'block', maxWidth: '100%', maxHeight: 420, borderRadius: 10 }} /></figure>}
    {accountValid && <iframe ref={frame} src="/talkcloud/index.html" title="톡클라우드 사진·동영상 정리"
      style={{ width: '100%', height, border: 0, display: 'block', colorScheme: 'normal' }} />}
  </main>;
}

export default function Talkcloud() {
  return <AdminPage title="톡클라우드 사진·동영상 정리"><Content /></AdminPage>;
}

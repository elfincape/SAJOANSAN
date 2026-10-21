import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { supabase } from '../lib/supabase';
import { loginDestination, loginProfile, mapAuthError, signInWithUsername } from '../lib/login';
import { ThemeToggle } from '../components/ThemeToggle';
import { Toasts } from '../components/Toasts';
import type { Notice } from '../components/Toasts';
import '../styles/common.css';
import '../styles/workspace-ui.css';
import '../styles/theme.css';

let initialSession: Promise<boolean> | undefined;
function checkSession() {
  if (!initialSession) initialSession = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await loginProfile(supabase, session.user.id);
        if (profile?.active) return true;
        localStorage.removeItem('sajo.selectedCenterCode');
        await supabase.auth.signOut();
      }
    } catch { /* Match the original silent initial-session failure. */ }
    return false;
  })().finally(() => { initialSession = undefined; });
  return initialSession;
}

export default function Login() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notices, setNotices] = useState<Notice[]>([]);
  const email = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const redirectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismiss = useCallback((id: number) => setNotices(items => items.filter(item => item.id !== id)), []);
  const notify = (text: string, type: Notice['type']) => setNotices(items => [...items, { id: Date.now(), text, type }]);
  const destination = () => loginDestination(location.search, location.origin);

  useEffect(() => {
    document.title = '로그인 · 코스표 관리 시스템';
    document.body.className = 'workspace-ui bg-zinc-900 text-zinc-100 min-h-screen flex items-center justify-center px-4';
    let active = true;
    void checkSession().then(loggedIn => {
      if (!active) return;
      if (loggedIn) { location.replace(destination()); return; }
      const reason = new URLSearchParams(location.search).get('reason');
      if (reason === 'inactive') setError('비활성화된 계정입니다. 관리자에게 문의하세요.');
      if (reason === 'expired') setError('세션이 만료되었습니다. 다시 로그인해주세요.');
      email.current?.focus();
    });
    return () => { active = false; clearTimeout(redirectTimer.current); };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    setError('');
    const name = identifier.trim();
    if (!name || !password) { setError('아이디와 비밀번호를 입력해주세요.'); return; }
    submitting.current = true;
    setLoading(true);
    try {
      const result = await signInWithUsername(supabase, name, password);
      if (result.error) {
        const message = mapAuthError(result.error);
        setError(message); notify(message, 'error'); return;
      }
      const id = result.data?.user?.id;
      if (!id) { setError('로그인에 실패했습니다. 잠시 후 다시 시도해주세요.'); return; }
      const { data: profile, error: profileError } = await loginProfile(supabase, id);
      if (profileError) {
        await supabase.auth.signOut();
        setError('사용자 정보를 확인하지 못했습니다. 관리자에게 문의하세요.');
        notify('프로필 조회 실패', 'error'); return;
      }
      if (!profile || !profile.active) {
        localStorage.removeItem('sajo.selectedCenterCode');
        await supabase.auth.signOut();
        setError(!profile ? '등록되지 않은 계정입니다. 관리자에게 문의하세요.' : '비활성화된 계정입니다. 관리자에게 문의하세요.'); return;
      }
      notify('로그인되었습니다.', 'success');
      localStorage.removeItem('sajo.selectedCenterCode');
      redirectTimer.current = setTimeout(() => location.replace(destination()), 250);
    } catch {
      setError('알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      notify('로그인 중 오류가 발생했습니다.', 'error');
    } finally { submitting.current = false; setLoading(false); }
  }

  const inputClass = `app-input${error ? ' border-red-600/60' : ''}`;
  return <>
    <main className="w-full max-w-sm">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-lg bg-emerald-600/20 border border-emerald-600/40 mb-3">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></svg>
        </div>
        <h1 className="text-lg font-semibold tracking-tight">코스표 관리 시스템</h1>
        <p className="text-xs text-zinc-500 mt-1">내부 관리자 전용</p>
      </div>
      <form id="login-form" className="bg-zinc-800/60 border border-zinc-700 rounded-lg p-5 shadow-xl space-y-4" autoComplete="on" noValidate onSubmit={submit}>
        <div><label htmlFor="email" className="app-label">아이디</label><input ref={email} id="email" name="email" type="text" required autoComplete="username" className={inputClass} placeholder="아이디 또는 기존 이메일" autoCapitalize="none" spellCheck={false} value={identifier} disabled={loading} onChange={event => setIdentifier(event.target.value)} /></div>
        <div><label htmlFor="password" className="app-label">비밀번호</label><input id="password" name="password" type="password" required autoComplete="current-password" className={inputClass} placeholder="••••••••" value={password} disabled={loading} onChange={event => setPassword(event.target.value)} /></div>
        <div id="form-error" className={`${error ? '' : 'hidden '}text-xs text-red-400 bg-red-900/20 border border-red-900/40 rounded-md px-3 py-2`}>{error}</div>
        <button id="submit-btn" type="submit" className="w-full btn btn-primary justify-center py-2.5 disabled:opacity-60 disabled:cursor-not-allowed" disabled={loading}>
          <span id="btn-label">{loading ? '로그인 중...' : '로그인'}</span>
          <svg id="btn-spinner" xmlns="http://www.w3.org/2000/svg" className={`${loading ? '' : 'hidden '}w-4 h-4 animate-spin`} viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" /><path d="M22 12a10 10 0 00-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
        </button>
      </form>
      <p className="text-[11px] text-zinc-600 text-center mt-6 leading-relaxed">계정 문의는 시스템 관리자에게 요청하세요.<br />이 시스템은 내부 사용자 전용이며 외부 접근이 제한됩니다.</p>
    </main>
    <ThemeToggle floating />
    <Toasts notices={notices} dismiss={dismiss} />
  </>;
}

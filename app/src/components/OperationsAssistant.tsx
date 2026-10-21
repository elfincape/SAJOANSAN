import { useEffect, useRef, useState } from 'react';
import { useAdminPage } from './AdminPage';
import { askOperationsAssistant } from '../lib/operations-assistant';
import { buildTsv } from '../domain/operations-assistant';
import type { AssistantAnswer } from '../domain/operations-assistant';
interface Message {
  role?: string;
  content: string;
  error?: boolean;
  answer?: AssistantAnswer;
}
export function OperationsAssistant() {
  const { center } = useAdminPage(),
    [open, setOpen] = useState(false),
    [unread, setUnread] = useState(false),
    [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(''),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [fallback, setFallback] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null),
    lastFocus = useRef<HTMLElement | null>(null),
    question = useRef<HTMLTextAreaElement>(null),
    scroller = useRef<HTMLDivElement>(null),
    fallbackInput = useRef<HTMLTextAreaElement>(null),
    opened = useRef(open);
  opened.current = open;
  function close() {
    controller.current?.abort();
    setOpen(false);
    lastFocus.current?.focus();
  }
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && opened.current) close();
    };
    document.addEventListener('keydown', escape);
    return () => {
      controller.current?.abort();
      document.removeEventListener('keydown', escape);
    };
  }, []);
  useEffect(() => {
    if (open) requestAnimationFrame(() => question.current?.focus());
  }, [open]);
  useEffect(() => {
    if (scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [messages]);
  useEffect(() => {
    if (fallback !== null) fallbackInput.current?.select();
  }, [fallback]);
  async function send() {
    const value = input.trim();
    if (!value || controller.current) return;
    const next = [...messages, { role: 'user', content: value }];
    setMessages(next);
    setInput('');
    setBusy(true);
    setStatus('조회 중…');
    const abort = new AbortController();
    controller.current = abort;
    try {
      const answer = await askOperationsAssistant(
        value,
        center.slug,
        next
          .filter((m) => m.role)
          .slice(-8)
          .map((m) => ({ role: m.role!, content: m.content.slice(0, 500) })),
        abort.signal,
      );
      setMessages((old) => [
        ...old,
        { role: 'assistant', content: answer.answer.slice(0, 500), answer },
      ]);
      if (!opened.current) setUnread(true);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        setMessages((old) => [
          ...old,
          {
            content:
              error instanceof TypeError
                ? '질의 서버에 연결하지 못했습니다. 잠시 후 다시 시도해주세요.'
                : error instanceof Error
                  ? error.message
                  : '조회에 실패했습니다.',
            error: true,
          },
        ]);
    } finally {
      controller.current = null;
      setBusy(false);
      setStatus('');
    }
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setStatus('복사했습니다.');
    } catch {
      setFallback(text);
      setStatus('자동 복사 실패 · 선택된 내용을 복사하세요.');
    }
  }
  return (
    <div id="operations-assistant-root">
      <button
        type="button"
        className="ops-assistant-launcher"
        title="도우미"
        aria-label="도우미 열기"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else {
            lastFocus.current = document.activeElement as HTMLElement;
            setOpen(true);
            setUnread(false);
          }
        }}
      >
        💬
        <span className="ops-assistant-badge" hidden={!unread} />
      </button>
      <section
        className="ops-assistant-panel"
        hidden={!open}
        role="dialog"
        aria-modal="false"
        aria-labelledby="ops-assistant-title"
      >
        <div className="ops-assistant-head">
          <strong id="ops-assistant-title">도우미</strong>
          <span className="ops-assistant-center">{center.name}</span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => {
              setMessages([]);
              setInput('');
              setStatus('');
              question.current?.focus();
            }}
          >
            새 대화
          </button>
          <button type="button" onClick={close}>
            닫기
          </button>
        </div>
        <div className="ops-assistant-warning">
          읽기 전용 · AI 답변은 원본 데이터 확인 필요
        </div>
        <div
          ref={scroller}
          className="ops-assistant-messages"
          aria-live="polite"
        >
          {messages.map((m, i) =>
            m.answer ? (
              <article
                key={i}
                className="ops-assistant-message"
                data-role="assistant"
                data-content={m.content}
              >
                <div className="ops-assistant-answer">{m.answer.answer}</div>
                {m.answer.columns.length && m.answer.rows.length ? (
                  <div className="ops-assistant-table-wrap">
                    <table className="ops-assistant-table">
                      <thead>
                        <tr>
                          {m.answer.columns.map((c, i) => (
                            <th key={i}>{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {m.answer.rows.map((r, i) => (
                          <tr key={i}>
                            {m.answer!.columns.map((c, i) => (
                              <td key={i}>{String(r[c.key] ?? '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {m.answer.notices.map((notice, i) => (
                  <div key={i} className="ops-assistant-notice">
                    {notice}
                  </div>
                ))}
                {m.answer.meta.truncated ? (
                  <div className="ops-assistant-notice">일부 결과만 표시됨</div>
                ) : null}
                <div className="ops-assistant-actions">
                  <button
                    type="button"
                    className="ops-assistant-copy"
                    onClick={() =>
                      void copy(
                        m.answer!.columns.length
                          ? buildTsv(m.answer!.columns, m.answer!.rows)
                          : m.answer!.answer,
                      )
                    }
                  >
                    {m.answer.columns.length ? '표 복사' : '답변 복사'}
                  </button>
                </div>
              </article>
            ) : (
              <div
                key={i}
                className={
                  'ops-assistant-message ' + (m.error ? 'error' : 'user')
                }
                data-role={m.role}
                data-content={m.role ? m.content : undefined}
              >
                {m.content}
              </div>
            ),
          )}
        </div>
        <form
          className="ops-assistant-form"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={question}
            placeholder="현재 센터 데이터를 질문하세요"
            maxLength={1000}
            aria-label="데이터 질문"
            disabled={busy}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <div className="ops-assistant-form-row">
            <span className="ops-assistant-status">{status}</span>
            <button
              type="button"
              hidden={!busy}
              onClick={() => controller.current?.abort()}
            >
              중지
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              전송
            </button>
          </div>
        </form>
      </section>
      {fallback !== null ? (
        <textarea
          ref={fallbackInput}
          className="ops-assistant-fallback"
          readOnly
          value={fallback}
          onBlur={() => setFallback(null)}
        />
      ) : null}
    </div>
  );
}

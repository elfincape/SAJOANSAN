import { MentionText } from './PortalMentions';
import { useEffect, useRef, useState } from 'react';
import { usePortal } from './PortalStore';
import { privateMail, runMailCollection } from '../../lib/portal-mail';
import {
  mailboxState,
  collectAllMail,
  mailHtmlText,
  MAIL_DIAGNOSTIC_OWNER_ID,
} from '../../domain/portal-mail';
import type {
  Mailbox,
  MailMessage,
  MailFile,
  MailCollectionProgress,
} from '../../domain/portal-mail';
import { portalStamp } from '../../domain/portal-types';
import { useDownload } from '../useDownload';
import { MailBriefingConnection } from './MailBriefingConnection';
function MailReceipt({
  onCollected,
  initialProgress,
}: {
  onCollected: () => void;
  initialProgress?: MailCollectionProgress;
}) {
  const [busy, setBusy] = useState(false),
    [status, setStatus] = useState(''),
    [progress, setProgress] = useState<MailCollectionProgress | null>(null),
    active = useRef(true),
    running = useRef(false),
    stop = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      stop.current = true;
    };
  }, []);
  const shown = progress ?? initialProgress;
  async function start() {
    if (running.current) return;
    running.current = true;
    stop.current = false;
    setBusy(true);
    setStatus('수집 대상을 확인하고 있습니다…');
    const requestId = crypto.randomUUID();
    let cycleId = shown?.remaining ? shown.cycleId : undefined;
    const collect = () =>
      collectAllMail({
        collect: () =>
          runMailCollection('collect', true, { requestId, cycleId }),
        shouldStop: () => stop.current || !active.current,
        onProgress: (next) => {
          if (!active.current) return;
          cycleId = next.cycleId;
          setProgress(next);
          setStatus('메일 수집 중…');
          onCollected();
        },
      });
    try {
      const result = navigator.locks
        ? await navigator.locks.request(
            'sajoansan-private-mail-collection',
            { ifAvailable: true },
            async (lock) => {
              if (!lock)
                throw Error(
                  '다른 탭에서 메일을 수집 중입니다. 해당 탭의 진행 상태를 확인해 주세요.',
                );
              return collect();
            },
          )
        : await collect();
      if (active.current && result)
        setStatus(
          (result.phase === 'complete' ? '수집 완료' : '수집 중단') +
            ' · ' +
            result.saved +
            '건 저장' +
            (result.remaining
              ? ' · ' + result.remaining + '건은 다시 시작하면 이어받습니다.'
              : ''),
        );
    } catch (error) {
      if (active.current) {
        setStatus(
          error instanceof Error
            ? error.message
            : '메일 수집에 실패했습니다. 다시 시작하면 이어받습니다.',
        );
        onCollected();
      }
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <>
      <button type="button" disabled={busy} onClick={() => void start()}>
        {shown?.remaining ? '메일 이어받기' : '메일 가져오기'}
      </button>
      {busy ? (
        <button
          type="button"
          disabled={stop.current}
          onClick={() => {
            stop.current = true;
            setStatus('현재 처리 중인 메일까지 저장한 뒤 중단합니다…');
          }}
        >
          수집 중단
        </button>
      ) : null}
      <p role="status" aria-live="polite">
        <MentionText>{status}</MentionText>
      </p>
      {shown ? (
        <>
          <progress
            aria-label="메일 수집 진행률"
            max={Math.max(shown.total, 1)}
            value={shown.processed}
          />
          <p>
            확인 {shown.processed} / {shown.total}건 · 저장 {shown.saved}건 ·
            대기 {shown.remaining}건
          </p>
        </>
      ) : null}
      {shown &&
      (shown.undated ?? 0) + (shown.oversized ?? 0) + (shown.missing ?? 0) >
        0 ? (
        <p>
          미수집: 날짜 확인 {shown.undated ?? 0}건 · 크기 초과{' '}
          {shown.oversized ?? 0}건 · 원본 없음 {shown.missing ?? 0}건
        </p>
      ) : null}
      <p>
        화면을 떠나면 현재 수집 요청이 끝난 뒤 중단됩니다. 다시 시작하면 저장
        위치에서 이어받습니다.
      </p>
    </>
  );
}
function Attachment({
  messageId,
  file,
  current,
}: {
  messageId: string;
  file: MailFile;
  current: () => boolean;
}) {
  const { message } = usePortal(),
    [busy, setBusy] = useState(false),
    { download, downloadLink } = useDownload();
  return (
    <>
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const blob = await privateMail.download(messageId, file.index);
            if (current())
              download(blob, file.kind === 'eml' ? 'original.eml' : file.name);
          } catch (error) {
            if (current())
              message(
                error instanceof Error ? error.message : String(error),
                true,
              );
          } finally {
            setBusy(false);
          }
        }}
      >
        {(file.kind === 'eml' ? '원본 EML' : file.name) +
          ' · ' +
          Math.ceil(file.size / 1024) +
          'KB 다운로드'}
      </button>
      {downloadLink}
    </>
  );
}
function MailDetail({ id, current }: { id: string; current: () => boolean }) {
  const { message } = usePortal(),
    [mail, setMail] = useState<MailMessage | null>(null),
    [body, setBody] = useState<{
      source: string;
      text: string;
      kind: string;
      link: string;
      exported: string;
    } | null>(null),
    [error, setError] = useState(false),
    [html, setHtml] = useState<string | null>(null),
    [formatted, setFormatted] = useState(false),
    [formatBusy, setFormatBusy] = useState(false),
    { download, downloadLink } = useDownload(),
    active = useRef(true);
  useEffect(() => {
    active.current = true;
    void (async () => {
      try {
        const { message: mail } = await privateMail.detail(id);
        if (!active.current || !current()) return;
        setMail(mail);
        const link = new URL(location.href);
        link.searchParams.set('view', 'mail');
        link.searchParams.set('message', id);
        history.replaceState(history.state, '', link);
        const file =
          mail.files.find((f) => f.kind === 'text') ||
          mail.files.find((f) => f.kind === 'html');
        if (file) {
          const blob = await privateMail.download(id, file.index);
          if (!active.current || !current()) return;
          const source = await blob.text();
          if (!active.current || !current()) return;
          const text = file.kind === 'html' ? mailHtmlText(source) : source,
            exported = [
              '제목: ' + (mail.subject || '(제목 없음)'),
              '발신자: ' + mail.sender,
              '날짜: ' + mail.sent_at,
              '출처: ' + link.href,
              '첨부: ' +
                (mail.files
                  .filter((f) => f.kind === 'attachment')
                  .map((f) => f.name)
                  .join(', ') || '없음'),
              '',
              text,
            ].join('\n');
          setBody({ source, text, kind: file.kind, link: link.href, exported });
        }
      } catch (error) {
        if (active.current && current()) {
          setError(true);
          message(error instanceof Error ? error.message : String(error), true);
        }
      }
    })();
    return () => {
      active.current = false;
    };
  }, [id]);
  function isCurrent() {
    return active.current && current();
  }
  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      if (isCurrent()) message(label + ' 완료');
    } catch {
      if (isCurrent())
        message('복사하지 못했습니다. 본문 저장을 이용해 주세요.', true);
    }
  }
  const original = mail?.files.find((f) => f.kind === 'html');
  return error ? (
    <p className="error">
      메일을 열지 못했습니다. 목록에서 다시 선택해 주세요.
    </p>
  ) : mail ? (
    <>
      <h2>
        <MentionText>{mail.subject || '(제목 없음)'}</MentionText>
      </h2>
      <p>
        <MentionText>{mail.sender}</MentionText> ·<MentionText> </MentionText>
        <MentionText>{portalStamp(mail.sent_at)}</MentionText>
      </p>
      <div className="private-mail-actions">
        {body ? (
          <>
            <button onClick={() => void copy('본문 복사', body.exported)}>
              본문 복사
            </button>
            <button onClick={() => void copy('링크 복사', body.link)}>
              링크 복사
            </button>
            <button
              onClick={() =>
                download(
                  new Blob([body.exported], {
                    type: 'text/plain;charset=utf-8',
                  }),
                  'mail-' + id + '.txt',
                )
              }
            >
              본문 저장
            </button>
            {original ? (
              <button
                disabled={formatBusy}
                aria-pressed={formatted}
                onClick={async () => {
                  setFormatBusy(true);
                  try {
                    if (html === null) {
                      const source =
                        body.kind === 'html'
                          ? body.source
                          : await (
                              await privateMail.download(id, original.index)
                            ).text();
                      if (!isCurrent()) return;
                      setHtml(source);
                    }
                    setFormatted((s) => !s);
                  } catch (error) {
                    if (isCurrent())
                      message(
                        error instanceof Error ? error.message : String(error),
                        true,
                      );
                  } finally {
                    setFormatBusy(false);
                  }
                }}
              >
                {formatted ? '텍스트 보기' : '서식 보기'}
              </button>
            ) : null}
          </>
        ) : null}
      </div>
      <section>
        {body ? (
          <>
            <pre className="private-mail-text" hidden={formatted}>
              <MentionText>{body.text}</MentionText>
            </pre>
            {html !== null ? (
              <iframe
                title="메일 본문 · 외부 콘텐츠 차단"
                sandbox=""
                referrerPolicy="no-referrer"
                className="private-mail-body"
                srcDoc={html}
                hidden={!formatted}
              />
            ) : null}
          </>
        ) : mail.files.some((f) => ['text', 'html'].includes(f.kind)) ? null : (
          <p>표시 가능한 본문이 없습니다.</p>
        )}
      </section>
      {body || !mail.files.some((f) => ['text', 'html'].includes(f.kind)) ? (
        <section>
          {mail.files
            .filter((f) => ['attachment', 'eml'].includes(f.kind))
            .map((file) => (
              <Attachment
                key={file.index}
                messageId={id}
                file={file}
                current={isCurrent}
              />
            ))}
        </section>
      ) : null}
      {downloadLink}
    </>
  ) : (
    <p>본문을 불러오는 중입니다…</p>
  );
}
export function PortalMail() {
  const { state, profile, message } = usePortal(),
    [box, setBox] = useState<Mailbox | null>(null),
    [status, setStatus] = useState('loading'),
    [input, setInput] = useState(''),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [rows, setRows] = useState<MailMessage[] | null>(null),
    [more, setMore] = useState(false),
    [count, setCount] = useState(''),
    [loading, setLoading] = useState(false),
    [listError, setListError] = useState(false),
    [selected, setSelected] = useState<{
      id: string;
      serial: number;
    } | null>(null),
    generation = useRef(0),
    selection = useRef(0),
    mailboxRequest = useRef(0),
    [listVersion, setListVersion] = useState(0);
  const requested = useRef<string | null>(null);
  useEffect(() => {
    const run = ++generation.current,
      request = ++mailboxRequest.current;
    setStatus('loading');
    setSelected(null);
    setRows(null);
    setCount('');
    setInput('');
    setQuery('');
    setOffset(0);
    requested.current = new URL(location.href).searchParams.get('message');
    void privateMail
      .status()
      .then((result) => {
        if (run !== generation.current || request !== mailboxRequest.current)
          return;
        const box = result.mailboxes[0];
        setBox(box ?? null);
        setStatus(box ? 'ready' : 'empty');
        if (box) setListVersion((s) => s + 1);
      })
      .catch((error) => {
        if (run === generation.current && request === mailboxRequest.current) {
          setStatus('error');
          message(error instanceof Error ? error.message : String(error), true);
        }
      });
    return () => {
      generation.current++;
      selection.current++;
    };
  }, [state.refreshVersion]);
  useEffect(() => {
    if (status !== 'ready') return;
    const run = ++selection.current;
    let active = true;
    setLoading(true);
    setListError(false);
    setRows(null);
    void privateMail
      .list(query, offset)
      .then((data) => {
        if (!active || run !== selection.current) return;
        setRows(data.messages);
        setMore(data.more);
        setCount(
          data.messages.length
            ? offset + 1 + '–' + (offset + data.messages.length) + '건'
            : '0건',
        );
        if (requested.current) {
          const id = requested.current;
          requested.current = null;
          const serial = ++selection.current;
          setSelected({ id, serial });
        }
      })
      .catch((error) => {
        if (active) {
          setListError(true);
          message(error instanceof Error ? error.message : String(error), true);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [status, query, offset, listVersion]);
  const collected = box ? mailboxState(box) : null,
    counts = box?.last_counts ?? {};
  function refreshAfterReceipt() {
    const run = generation.current,
      request = ++mailboxRequest.current;
    void privateMail
      .status()
      .then((result) => {
        if (run !== generation.current || request !== mailboxRequest.current)
          return;
        const nextBox = result.mailboxes[0];
        setBox(nextBox ?? null);
        setStatus(nextBox ? 'ready' : 'empty');
        setOffset(0);
        setListVersion((version) => version + 1);
      })
      .catch((error) => {
        if (run === generation.current && request === mailboxRequest.current)
          message(
            '메일은 수신했지만 목록을 갱신하지 못했습니다. ' +
              (error instanceof Error ? error.message : String(error)),
            true,
          );
      });
  }
  return (
    <>
      <section id="quick-actions" className="quick-actions">
        {profile.id === MAIL_DIAGNOSTIC_OWNER_ID ? (
          <>
            <MailReceipt
              key={state.refreshVersion}
              onCollected={refreshAfterReceipt}
              initialProgress={box?.last_counts?.progress}
            />
            <MailBriefingConnection />
          </>
        ) : null}
      </section>
      <div className="workspace">
        <section className="list">
          <div className="list-heading">
            <strong id="list-title">받은 메일</strong>
            <span id="count">
              <MentionText>{count}</MentionText>
            </span>
          </div>
          <div id="items" className="portal-items">
            {status === 'loading' ? (
              <p>메일함을 불러오는 중입니다…</p>
            ) : status === 'empty' ? (
              <p>아직 개인 메일함이 구성되지 않았습니다.</p>
            ) : status === 'error' ? (
              <p className="error">
                메일함 상태를 확인하지 못했습니다. 새로고침해 주세요.
              </p>
            ) : (
              <>
                <p
                  className={box?.last_error || collected?.stale ? 'error' : ''}
                >
                  <MentionText>{collected?.label}</MentionText> · 마지막 정상
                  수집<MentionText> </MentionText>
                  <MentionText>
                    {portalStamp(box?.last_success_at) || '없음'}
                  </MentionText>
                  <MentionText>
                    {counts.oversized || counts.undated || counts.deferred ? (
                      <span>
                        <MentionText> </MentionText>· 다음 수집 대기
                        <MentionText> </MentionText>
                        <MentionText>{counts.deferred || 0}</MentionText>건 ·
                        크기 제한 제외<MentionText> </MentionText>
                        <MentionText>{counts.oversized || 0}</MentionText>건 ·
                        날짜 확인 필요<MentionText> </MentionText>
                        <MentionText>{counts.undated || 0}</MentionText>건
                      </span>
                    ) : null}
                  </MentionText>
                </p>
                <form
                  className="portal-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setQuery(input);
                    setOffset(0);
                    setListVersion((s) => s + 1);
                  }}
                >
                  <label>
                    제목·발신자 검색
                    <input
                      type="search"
                      maxLength={100}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                    />
                  </label>
                  <button type="submit" disabled={loading}>
                    검색
                  </button>
                </form>
                <div>
                  {listError ? (
                    <p className="error">
                      메일 조회 실패 · 검색을 다시 실행해 주세요.
                    </p>
                  ) : loading || !rows ? (
                    <p>메일을 조회하는 중입니다…</p>
                  ) : rows.length ? (
                    rows.map((row) => (
                      <button
                        key={row.id}
                        className="task-row"
                        disabled={state.busy}
                        onClick={() => {
                          const serial = ++selection.current;
                          setSelected({ id: row.id, serial });
                        }}
                      >
                        <span className="task-row-copy">
                          <strong className="task-row-name">
                            {row.subject || '(제목 없음)'}
                          </strong>
                          <small>
                            {row.sender} · {portalStamp(row.sent_at)}
                          </small>
                        </span>
                      </button>
                    ))
                  ) : (
                    <p>
                      <MentionText>
                        {query
                          ? '검색 결과가 없습니다.'
                          : '아직 수신된 메일이 없습니다.'}
                      </MentionText>
                    </p>
                  )}
                </div>
                <div>
                  {rows && !loading && !listError ? (
                    <>
                      {offset ? (
                        <button
                          onClick={() => setOffset((s) => Math.max(0, s - 50))}
                        >
                          이전 50건
                        </button>
                      ) : null}
                      {more ? (
                        <button onClick={() => setOffset((s) => s + 50)}>
                          다음 50건
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              </>
            )}
          </div>
        </section>
        <aside id="detail" aria-label="업무 처리">
          {selected ? (
            <MailDetail
              key={selected.id + ':' + selected.serial}
              id={selected.id}
              current={() => selected.serial === selection.current}
            />
          ) : (
            <p>메일을 선택하세요.</p>
          )}
        </aside>
      </div>
    </>
  );
}

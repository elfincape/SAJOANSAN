import { privateMail } from './onedrive-api.js';
import {
  mountMailReceipt,
  MAIL_DIAGNOSTIC_OWNER_ID,
} from './portal-mail-diagnostic.js';

export function createPortalMail({ node, button, message, stamp, profile }) {
  let generation = 0;
  return async function renderMail() {
    const ticket = ++generation,
      items = document.getElementById('items'),
      detail = document.getElementById('detail');
    let selection = 0;
    const active = () =>
      ticket === generation &&
      document
        .querySelector('[data-view=mail]')
        ?.getAttribute('aria-pressed') === 'true';
    const actions = document.getElementById('quick-actions');
    actions.replaceChildren();
    document.getElementById('list-title').textContent = '받은 메일';
    document.getElementById('count').textContent = '';
    items.replaceChildren(node('p', '메일함을 불러오는 중입니다…'));
    detail.replaceChildren(node('p', '메일을 선택하세요.'));
    if (profile?.id === MAIL_DIAGNOSTIC_OWNER_ID)
      mountMailReceipt({ host: actions, node, button, isActive: active });
    try {
      const status = await privateMail.status();
      if (!active()) return;
      const box = status.mailboxes[0];
      if (!box) {
        items.replaceChildren(
          node('p', '아직 개인 메일함이 구성되지 않았습니다.'),
        );
        return;
      }
      const stale =
        box.status === 'running' && Date.parse(box.lease_until) < Date.now();
      const state = !box.enabled
        ? '수집 중지'
        : stale
          ? '수집 중단 · 서버 점검 필요'
          : {
              running: '수집 중',
              error: '수집 실패 · 서버 점검 필요',
              ready: '수집 대기',
              disabled: '수집 중지',
            }[box.status] || '상태 확인 필요';
      const summary = node(
        'p',
        state + ' · 마지막 정상 수집 ' + (stamp(box.last_success_at) || '없음'),
        box.last_error || stale ? 'error' : '',
      );
      const counts = box.last_counts || {};
      if (counts.oversized || counts.undated || counts.deferred)
        summary.append(
          node(
            'span',
            ' · 다음 수집 대기 ' +
              (counts.deferred || 0) +
              '건 · 크기 제한 제외 ' +
              (counts.oversized || 0) +
              '건 · 날짜 확인 필요 ' +
              (counts.undated || 0) +
              '건',
          ),
        );
      const form = node('form', undefined, 'portal-form'),
        label = node('label', '제목·발신자 검색'),
        input = node('input');
      input.type = 'search';
      input.maxLength = 100;
      label.append(input);
      form.append(label);
      const submit = node('button', '검색');
      submit.type = 'submit';
      form.append(submit);
      const results = node('div'),
        pages = node('div');
      items.replaceChildren(summary, form, results, pages);
      let offset = 0,
        query = '';
      async function load() {
        const current = ++selection;
        results.replaceChildren(node('p', '메일을 조회하는 중입니다…'));
        submit.disabled = true;
        pages.replaceChildren();
        try {
          const data = await privateMail.list(query, offset);
          if (!active() || current !== selection) return;
          results.replaceChildren();
          document.getElementById('count').textContent =
            offset + 1 + '–' + (offset + data.messages.length) + '건';
          if (!data.messages.length) {
            results.append(
              node(
                'p',
                query
                  ? '검색 결과가 없습니다.'
                  : '아직 수신된 메일이 없습니다.',
              ),
            );
            document.getElementById('count').textContent = '0건';
          }
          for (const row of data.messages) {
            const item = button('', () => show(row), results, 'task-row'),
              copy = node('span', undefined, 'task-row-copy');
            copy.append(
              node('strong', row.subject || '(제목 없음)', 'task-row-name'),
              node('small', row.sender + ' · ' + stamp(row.sent_at)),
            );
            item.append(copy);
          }
          if (offset)
            button(
              '이전 50건',
              () => {
                offset = Math.max(0, offset - 50);
                load();
              },
              pages,
            );
          if (data.more)
            button(
              '다음 50건',
              () => {
                offset += 50;
                load();
              },
              pages,
            );
        } catch (error) {
          if (active()) {
            results.replaceChildren(
              node('p', '메일 조회 실패 · 검색을 다시 실행해 주세요.', 'error'),
            );
            message(error.message, true);
          }
        } finally {
          submit.disabled = false;
        }
      }
      form.onsubmit = (event) => {
        event.preventDefault();
        query = input.value;
        offset = 0;
        load();
      };
      async function show(row) {
        const current = ++selection;
        detail.replaceChildren(node('p', '본문을 불러오는 중입니다…'));
        try {
          const { message: mail } = await privateMail.detail(row.id);
          if (!active() || current !== selection) return;
          detail.replaceChildren(
            node('h2', mail.subject || '(제목 없음)'),
            node('p', mail.sender + ' · ' + stamp(mail.sent_at)),
          );
          const link = new URL(location.href);
          link.searchParams.set('view', 'mail');
          link.searchParams.set('message', row.id);
          history.replaceState(history.state, '', link);
          const body =
            mail.files.find((f) => f.kind === 'text') ||
            mail.files.find((f) => f.kind === 'html');
          const controls = node('div', undefined, 'private-mail-actions');
          const content = node('section');
          detail.append(controls, content);
          if (body) {
            const blob = await privateMail.download(row.id, body.index);
            if (!active() || current !== selection) return;
            const source = await blob.text();
            if (!active() || current !== selection) return;
            let text = source;
            if (body.kind === 'html') {
              const parsed = new DOMParser().parseFromString(
                source,
                'text/html',
              );
              parsed
                .querySelectorAll('script,style,noscript,template')
                .forEach((el) => el.remove());
              parsed
                .querySelectorAll('br,hr')
                .forEach((el) => el.replaceWith('\n'));
              parsed.querySelectorAll('td,th').forEach((el) => el.append('\t'));
              parsed
                .querySelectorAll('p,div,li,blockquote,pre,tr,h1,h2,h3,h4')
                .forEach((el) => el.append('\n'));
              text = parsed.body.textContent
                .replace(/\n[ \t]+/g, '\n')
                .replace(/\n{3,}/g, '\n\n')
                .trim();
            }
            const readable = node('pre', undefined, 'private-mail-text');
            readable.textContent = text;
            content.append(readable);
            const exported = [
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
            const copy = (label, value) =>
              button(
                label,
                async () => {
                  try {
                    await navigator.clipboard.writeText(value);
                    if (active()) message(label + ' 완료');
                  } catch {
                    if (active())
                      message(
                        '복사하지 못했습니다. 본문 저장을 이용해 주세요.',
                        true,
                      );
                  }
                },
                controls,
              );
            copy('본문 복사', exported);
            copy('링크 복사', link.href);
            button(
              '본문 저장',
              () => {
                const url = URL.createObjectURL(
                    new Blob([exported], { type: 'text/plain;charset=utf-8' }),
                  ),
                  a = node('a');
                a.href = url;
                a.download = 'mail-' + row.id + '.txt';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              },
              controls,
            );
            const formatted = mail.files.find((f) => f.kind === 'html');
            if (formatted) {
              let frame;
              const toggle = button(
                '서식 보기',
                async () => {
                  toggle.disabled = true;
                  try {
                    if (!frame) {
                      const html =
                        body.kind === 'html'
                          ? source
                          : await (
                              await privateMail.download(
                                row.id,
                                formatted.index,
                              )
                            ).text();
                      if (!active() || current !== selection) return;
                      frame = node('iframe');
                      frame.title = '메일 본문 · 외부 콘텐츠 차단';
                      frame.setAttribute('sandbox', '');
                      frame.referrerPolicy = 'no-referrer';
                      frame.className = 'private-mail-body';
                      frame.srcdoc = html;
                      frame.hidden = true;
                      content.append(frame);
                    }
                    readable.hidden = !readable.hidden;
                    frame.hidden = !readable.hidden;
                    toggle.textContent = readable.hidden
                      ? '텍스트 보기'
                      : '서식 보기';
                    toggle.setAttribute(
                      'aria-pressed',
                      String(readable.hidden),
                    );
                  } catch (error) {
                    if (active()) message(error.message, true);
                  } finally {
                    toggle.disabled = false;
                  }
                },
                controls,
              );
              toggle.setAttribute('aria-pressed', 'false');
            }
          } else content.append(node('p', '표시 가능한 본문이 없습니다.'));
          const downloads = node('section');
          detail.append(downloads);
          for (const file of mail.files.filter((f) =>
            ['attachment', 'eml'].includes(f.kind),
          )) {
            const download = button(
              (file.kind === 'eml' ? '원본 EML' : file.name) +
                ' · ' +
                Math.ceil(file.size / 1024) +
                'KB 다운로드',
              async () => {
                download.disabled = true;
                try {
                  const blob = await privateMail.download(row.id, file.index);
                  if (!active() || current !== selection) return;
                  const url = URL.createObjectURL(blob),
                    a = node('a');
                  a.href = url;
                  a.download = file.kind === 'eml' ? 'original.eml' : file.name;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                } catch (error) {
                  if (active()) message(error.message, true);
                } finally {
                  download.disabled = false;
                }
              },
              downloads,
            );
          }
        } catch (error) {
          if (active() && current === selection) {
            detail.replaceChildren(
              node(
                'p',
                '메일을 열지 못했습니다. 목록에서 다시 선택해 주세요.',
                'error',
              ),
            );
            message(error.message, true);
          }
        }
      }
      await load();
      const requested = new URL(location.href).searchParams.get('message');
      if (requested && active()) await show({ id: requested });
    } catch (error) {
      if (active()) {
        items.replaceChildren(
          node(
            'p',
            '메일함 상태를 확인하지 못했습니다. 새로고침해 주세요.',
            'error',
          ),
        );
        message(error.message, true);
      }
    }
  };
}

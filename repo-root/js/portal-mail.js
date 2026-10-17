import { privateMail } from './onedrive-api.js';

export function createPortalMail({ node, button, message, stamp }) {
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
    document.getElementById('quick-actions').replaceChildren();
    document.getElementById('list-title').textContent = '받은 메일';
    document.getElementById('count').textContent = '';
    items.replaceChildren(node('p', '메일함을 불러오는 중입니다…'));
    detail.replaceChildren(
      node('h2', '개인 메일함'),
      node(
        'p',
        '메일은 본인만 열람하며 통합 검색과 AI 브리핑에 포함되지 않습니다. 제목·발신자로 검색할 수 있습니다. 외부 이미지와 활성 콘텐츠는 표시하지 않습니다.',
      ),
    );
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
          const body =
            mail.files.find((f) => f.kind === 'html') ||
            mail.files.find((f) => f.kind === 'text');
          const content = node('section');
          detail.append(content);
          if (body) {
            const blob = await privateMail.download(row.id, body.index);
            if (!active() || current !== selection) return;
            if (body.kind === 'html') {
              const frame = node('iframe');
              frame.title = '메일 본문 · 외부 콘텐츠 차단';
              frame.setAttribute('sandbox', '');
              frame.referrerPolicy = 'no-referrer';
              frame.className = 'private-mail-body';
              frame.srcdoc = await blob.text();
              content.append(frame);
            } else
              content.append(
                node('pre', await blob.text(), 'private-mail-text'),
              );
          } else content.append(node('p', '표시 가능한 본문이 없습니다.'));
          const downloads = node('section');
          detail.append(
            downloads,
            node(
              'p',
              '첨부파일은 저장 후 신뢰할 수 있는지 확인하고 여세요. 실행 파일은 실행하지 마세요.',
            ),
          );
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

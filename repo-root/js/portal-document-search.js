import { DOCUMENT_SEARCH_URL } from './config.js';

export function renderDocumentSearch({
  supabase,
  host,
  node,
  button,
  openRecord,
  term,
  center,
  page,
  current,
  next,
}) {
  const section = node('section', undefined, 'document-search-results');
  section.setAttribute('aria-label', '첨부 문서 본문 검색');
  const heading = node('h3', '첨부 문서 본문'),
    status = node('p', '문서 본문을 검색하고 있습니다…');
  status.setAttribute('role', 'status');
  section.append(heading, status);
  host.append(section);
  const endpoint = DOCUMENT_SEARCH_URL;
  if (!endpoint) {
    status.textContent =
      '문서 본문 검색 연결을 준비하고 있습니다. 파일명 검색과 원본 기록은 위 결과에서 이용할 수 있습니다.';
    return;
  }
  async function load() {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== 'https:')
        throw Error('문서 검색 연결 설정을 확인해 주세요.');
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) throw Error('로그인이 필요합니다.');
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ query: term, center: center || null, page }),
        signal: AbortSignal.timeout(90000),
      });
      const result = await response.json();
      if (!response.ok)
        throw Error(result.error || '문서 본문을 조회하지 못했습니다.');
      if (!current() || !section.isConnected) return;
      heading.textContent = '첨부 문서 본문 · ' + result.total + '건';
      status.textContent = result.pending
        ? '일부 문서를 준비 중입니다. 다시 검색하면 색인이 이어집니다.'
        : result.total
          ? '원본을 열어 검색 내용을 확인하세요.'
          : '문서 본문 검색 결과가 없습니다.';
      for (const row of result.items) {
        const kind = ['task', 'incident', 'survey'].find(
          (type) => row[type + '_id'],
        );
        if (!kind) continue;
        const entry = node('div', undefined, 'history-entry');
        entry.append(node('strong', row.title), node('p', row.excerpt));
        button(
          '첨부된 원본 기록 열기',
          () => openRecord(kind, row[kind + '_id']),
          entry,
        );
        section.append(entry);
      }
      if (result.total > (page + 1) * 20)
        button('문서 본문 다음 20건', next, section);
    } catch (error) {
      if (current() && section.isConnected)
        status.textContent =
          (error.name === 'TimeoutError'
            ? '문서 본문 검색이 지연되고 있습니다.'
            : error.message || '문서 검색 서버에 연결하지 못했습니다.') +
          ' 기존 검색 결과는 계속 이용할 수 있습니다.';
    }
  }
  void load();
}

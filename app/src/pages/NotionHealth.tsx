import { AdminPage } from '../components/AdminPage';

export default function NotionHealth() {
  return <AdminPage title="보건증 Notion 연동" minRole="admin">
  <main id="work-main" tabIndex={-1} className="app-main max-w-3xl mx-auto px-4 py-8">
    <nav className="work-section-navigation" aria-label="작업 단계">{['연결 확인', '보건증 관리 대상 동기화', '보건증 갱신 완료 자동 반영'].map((title, index) => <a key={title} href={`#work-section-${index + 1}`}>{title}</a>)}</nav>
    <section id="work-section-1" className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-5">
      <h2 className="app-function-title text-lg font-semibold">연결 확인</h2>
      <p className="text-sm text-zinc-400 mt-2">보건증 갱신 목록의 접근 권한과 필요한 열을 확인합니다.</p>
      <div className="flex flex-wrap gap-3 mt-5">
        <button id="test-btn" className="btn btn-primary" disabled>연결 테스트</button>
        <a href="https://app.notion.com/p/46ceeb04f20842c1b9b246a3657c3b21" target="_blank" rel="noopener noreferrer" className="btn btn-ghost">Notion 목록 열기</a>
      </div>
      <p id="test-status" role="status" aria-live="polite" className="text-sm mt-5">Notion 동기화가 일시 중지되었습니다.</p>
      <ul id="test-details" className="text-sm text-zinc-400 mt-3 space-y-1"></ul>
    </section>
    <section id="work-section-2" className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-5 mt-5">
      <h2 className="app-function-title text-lg font-semibold">보건증 관리 대상 동기화</h2>
      <p id="sync-center" className="text-sm text-zinc-400 mt-2">센터 확인 중…</p>
      <p className="text-sm text-zinc-400 mt-2">미등록·만료 임박·오늘 만료·만료 기사를 15분 주기로 Notion에 반영합니다. 버튼으로 즉시 실행할 수도 있습니다. 연락일, 갱신 예정일, 담당자와 메모는 보존합니다.</p>
      <p id="preview-status" role="status" aria-live="polite" className="text-sm mt-4">대상 조회 중…</p>
      <ul id="preview-counts" className="text-sm text-zinc-400 mt-2 space-y-1"></ul>
      <div className="flex flex-wrap gap-3 mt-5">
        <button id="preview-btn" className="btn btn-ghost" disabled>대상 새로고침</button>
        <button id="sync-btn" className="btn btn-primary" disabled>Notion 동기화</button>
      </div>
      <p id="sync-status" role="status" aria-live="polite" className="text-sm mt-4"></p>
      <ul id="sync-details" className="text-sm text-zinc-400 mt-2 space-y-1"></ul>
    </section>
    <section id="work-section-3" className="rounded-lg border border-zinc-700 bg-zinc-800/40 p-5 mt-5">
      <h2 className="app-function-title text-lg font-semibold">보건증 갱신 완료 자동 반영</h2>
      <p className="text-sm text-zinc-400 mt-2">웹에 기존보다 늦은 유효한 만료일을 저장하면 기존 Notion 건을 갱신 완료로 처리합니다. 완료일과 새 만료일을 기록하고 연락 기록·갱신 예정일·메모는 유지합니다.</p>
      <p className="text-sm text-zinc-400 mt-2">15분 주기로 확인합니다. 예약 실행 상황에 따라 반영이 늦어질 수 있습니다.</p>
      <p id="complete-last-updated" role="status" aria-live="polite" className="text-sm text-zinc-300 mt-3">자동 동기화 중지</p>
      <button id="complete-btn" className="btn btn-primary mt-5" disabled>갱신 완료 즉시 반영</button>
      <p id="complete-status" role="status" aria-live="polite" className="text-sm mt-4"></p>
      <ul id="complete-details" className="text-sm text-zinc-400 mt-2 space-y-1"></ul>
    </section>
    <p className="text-sm text-zinc-400 mt-5">관리 대상 등록과 갱신 완료 확인은 15분 주기로 실행합니다. 신규 항목 알림은 Notion에서 설정한 보건증 관리 대상 알림 자동화로 전달됩니다.</p>
  </main>
  </AdminPage>;
}

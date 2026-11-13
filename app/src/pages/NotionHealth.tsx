import { AdminPage } from '../components/AdminPage';
export default function NotionHealth() {
  return <AdminPage title="폐기된 Notion 연동" minRole="admin"><main id="work-main" tabIndex={-1} className="app-main"><p role="status">Notion 연동은 사용자 결정으로 폐기됐습니다.</p><a className="btn btn-ghost" href="/admin/drivers.html">기사 서류 관리 열기</a></main></AdminPage>;
}

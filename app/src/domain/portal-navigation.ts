export const PORTAL_NAV_GROUPS = [
  { id: 'center', title: '센터 업무' },
  { id: 'registration', title: '업무 등록·조사' },
  { id: 'hq', title: '배송팀' },
  { id: 'lookup', title: '조회·알림' },
  { id: 'manage', title: '포털 관리' },
] as const;
export const PORTAL_VIEWS = [
  { id: 'center', title: '센터 업무', group: '센터 업무', byCenter: true },
  { id: 'incidents', title: '특이사항', group: '센터 업무' },
  { id: 'surveys', title: '업무 등록·조사', group: '업무 등록·조사', byCenter: true },
  { id: 'hq', title: '전체 업무·지원 요청', group: '배송팀' },
  { id: 'briefing', title: 'AI 브리핑', group: '배송팀' },
  { id: 'mail', title: '개인 메일함', group: '조회·알림' },
  { id: 'search', title: '통합 검색', group: '조회·알림' },
  { id: 'notifications', title: '알림함', group: '조회·알림' },
  { id: 'history', title: '처리 기록', group: '포털 관리' },
  { id: 'permissions', title: '직원별 권한', group: '포털 관리' },
  { id: 'connections', title: 'OneDrive 관리', group: '포털 관리' },
  { id: 'members', title: '직원 역할·센터', group: '포털 관리' },
  { id: 'trash', title: '휴지통', group: '포털 관리' },
  { id: 'backups', title: '운영 원본 보관', group: '포털 관리' },
] as const;
export const portalViewTitle = (view: string) =>
  PORTAL_VIEWS.find(item => item.id === view)?.title ?? (view === 'access' ? '직원 역할·센터' : '센터 업무');

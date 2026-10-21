export interface Feature {
  id: string; href?: string; title: string; desc?: string;
  category: 'work' | 'reference' | 'files' | 'system'; resource?: string;
  aliases: readonly string[]; centers: readonly string[]; defaultEnabled: boolean;
  adminOnly?: boolean; ownerOnly?: boolean; fixed?: boolean; hub?: boolean;
  parent?: string; legacyFeature?: string;
}
type FeatureEntry = Omit<Feature, 'aliases' | 'centers' | 'defaultEnabled'> & Partial<Pick<Feature, 'aliases' | 'centers' | 'defaultEnabled'>>;
// Register each feature once. Settings, menus, categories and route guards share this catalog.
export const FEATURE_CATEGORIES = Object.freeze({
  work: '업무 처리',
  reference: '기준정보',
  files: '파일 도구',
  system: '시스템',
});
export const FEATURE_CATALOG = Object.freeze(
  ([
    {
      id: 'portal',
      href: '/portal/',
      title: '업무 포털',
      desc: '오늘 할 일·업무 처리·인계·센터 업무조사',
      category: 'work',
      fixed: true,
    },
    {
      id: 'routes',
      href: '/admin/routes.html',
      aliases: ['/admin/route-edit.html'],
      title: '코스 관리',
      desc: '코스와 납품처(운행시간) 편집',
      category: 'reference',
      resource: 'routes',
    },
    {
      id: 'deliveryPoints',
      href: '/admin/delivery-points.html',
      title: '납품처 관리',
      desc: '주소·진입조건·마감시간',
      category: 'reference',
      resource: 'delivery_points',
    },
    {
      id: 'drivers',
      href: '/admin/drivers.html',
      title: '기사 관리',
      desc: '기사 명부와 연락처',
      category: 'reference',
      resource: 'drivers',
    },
    {
      id: 'pdfConverter',
      href: '/admin/pdf-image-converter.html',
      title: 'PDF IMG 변환기',
      desc: 'PDF 페이지를 기사 서류 사진으로 등록',
      category: 'files',
      resource: 'pdf_converter',
      legacyFeature: 'drivers',
    },
    {
      id: 'vehicles',
      href: '/admin/vehicles.html',
      title: '차량 관리',
      desc: '차량번호·톤수·팔레트 적재량',
      category: 'reference',
      resource: 'vehicles',
    },
    {
      id: 'companies',
      href: '/admin/companies.html',
      title: '운수사 관리',
      desc: '운수사 정보',
      category: 'reference',
      resource: 'companies',
    },
    {
      id: 'gimhaeDispatch',
      href: '/admin/gimhae-dispatch.html',
      title: '김해 배차 요청',
      desc: 'CJ 요청 사진·운수사 회신·전달문 복사',
      category: 'work',
      resource: 'dispatch_parser',
      legacyFeature: 'dispatchParser',
    },
    {
      id: 'dispatchParser',
      href: '/admin/dispatch-parser.html',
      title: '배차정보 파서',
      desc: '배차 문자 자동 파싱',
      category: 'work',
      resource: 'dispatch_parser',
    },
    {
      id: 'pyeongtaekCharterParser',
      href: '/admin/pyeongtaek-charter-parser.html',
      title: '평택 용차내역 파서',
      desc: '엑셀·정산·DB 조회/수정·월 보관',
      category: 'work',
      resource: 'charter',
    },
    {
      id: 'pyeongtaekDispatch',
      href: '/admin/pyeongtaek-dispatch.html',
      title: '평택 가배차',
      desc: '당일 물량·고정차 배정·임시차 초안',
      category: 'work',
      resource: 'charter',
      centers: ['002'],
    },
    {
      id: 'charterFuelEstimator',
      href: '/admin/charter-fuel-estimator.html',
      title: '착지별 주행거리 계산',
      category: 'work',
      resource: 'delivery_points',
    },
    {
      id: 'naverDistance',
      href: '/admin/naver-shortest-distance.html',
      title: '네이버 최단거리 계산',
      category: 'work',
      resource: 'delivery_points',
    },
    {
      id: 'transfers',
      href: '/admin/transfers.html',
      title: '이배송 관리',
      category: 'work',
      resource: 'transfers',
    },
    {
      id: 'excelCompare',
      href: '/admin/excel-compare.html',
      title: '엑셀 시트 비교',
      desc: '행 매칭·값 가져오기·TRUE/FALSE 확인',
      category: 'files',
      resource: 'excel_compare',
    },
    {
      id: 'palletSlips',
      href: '/admin/pallet-slips.html',
      title: '파레트 전표관리',
      desc: '엑셀 전표 매칭 후 결과 내려받기',
      category: 'files',
      resource: 'pallet_slips',
    },
    {
      id: 'oneTopWork',
      href: '/admin/one-top-two-room-work.html',
      title: '1탑2실 작업',
      desc: '영수증·온도 분석·차량번호별 Excel 반영',
      category: 'work',
      resource: 'one_top',
    },
    {
      id: 'dailyTemperature',
      href: '/admin/daily-temperature.html',
      title: '1탑2실 템플릿 생성',
      category: 'files',
      resource: 'temperature',
    },
    {
      id: 'coupangEntry',
      href: '/admin/coupang-entry.html',
      title: '쿠팡 입문확인',
      category: 'work',
      resource: 'coupang',
    },
    {
      id: 'ansanGimhaeBusanAnsan',
      href: '/admin/ansan-gimhae-busan-ansan.html',
      title: '안산김해부산안산',
      category: 'work',
      resource: 'busan',
      ownerOnly: true,
      defaultEnabled: false,
    },
    {
      id: 'imageStraightener',
      href: '/admin/image-straightener.html',
      title: '기울기 보정',
      category: 'files',
      resource: 'straightener',
      ownerOnly: true,
      defaultEnabled: false,
    },
    {
      id: 'haulCalculator',
      href: '/admin/haul-dispatch-calculator.html',
      title: '하불 배차 계산',
      desc: '실제 구간단가 기준 차량 조합 계산',
      category: 'work',
      resource: 'haul',
    },
    {
      id: 'haulPrices',
      title: '하불 배차 계산 금액',
      desc: '하불 배차 계산 화면 안의 금액 표시',
      category: 'work',
      resource: 'haul',
      ownerOnly: true,
      defaultEnabled: false,
      parent: 'haulCalculator',
    },
    {
      id: 'notionHealth',
      href: '/admin/notion-health.html',
      title: '보건증 Notion 연동',
      category: 'system',
      resource: 'connections',
      adminOnly: true,
    },
    {
      id: 'exportData',
      href: '/admin/export.html',
      title: '코스표 내려받기',
      desc: 'CSV / XLSX 다운로드',
      category: 'files',
      resource: 'export',
      adminOnly: true,
    },
    {
      id: 'importData',
      href: '/admin/import.html',
      title: 'CSV 일괄 가져오기',
      category: 'files',
      resource: 'import',
      adminOnly: true,
    },
    {
      id: 'users',
      href: '/admin/users.html',
      title: '사용자 관리',
      desc: '계정·활성 상태와 사용자 권한 설정 연결',
      category: 'system',
      resource: 'users',
      adminOnly: true,
    },
    {
      id: 'auditLog',
      href: '/admin/audit-log.html',
      title: '변경 이력',
      category: 'system',
      resource: 'audit',
      adminOnly: true,
      ownerOnly: true,
      defaultEnabled: false,
    },
    {
      id: 'operations',
      href: '/admin/operations.html',
      title: '운영 업무 현황',
      category: 'work',
      resource: 'history',
      hub: false,
      fixed: true,
    },
    {
      id: 'permissions',
      href: '/portal/?view=permissions',
      title: '페이지별 권한',
      desc: '페이지·업무별 열람·수정 조건과 적용 범위',
      category: 'system',
      resource: 'permissions',
      adminOnly: true,
      fixed: true,
    },
    {
      id: 'settings',
      href: '/admin/settings.html',
      title: '설정',
      desc: '관리 허브 기능 표시 설정',
      category: 'system',
      resource: 'settings',
      adminOnly: true,
      ownerOnly: true,
      fixed: true,
    },
    {
      id: 'adminHub',
      href: '/admin/',
      aliases: ['/admin/index.html'],
      title: '관리 허브',
      category: 'system',
      hub: false,
      fixed: true,
    },
  ] as FeatureEntry[]).map((entry) =>
    Object.freeze({
      defaultEnabled: true,
      ...entry,
      aliases: Object.freeze(entry.aliases ?? []),
      centers: Object.freeze(entry.centers ?? []),
    }),
  ),
);
export const CONFIGURABLE_FEATURES = Object.freeze(
  FEATURE_CATALOG.filter((feature) => !feature.fixed),
);
export const PAGE_RESOURCES: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(
    FEATURE_CATALOG.filter((f) => f.resource).flatMap((f) =>
      [f.href, ...f.aliases]
        .filter((path) => path?.startsWith('/admin/'))
        .map((path) => [path!.split('/').at(-1)!, f.resource!]),
    ),
  ),
);
export function featureForPath(path: string) {
  const url = new URL(path, 'https://catalog.invalid');
  return (
    FEATURE_CATALOG.find((f) => {
      if (!f.href?.includes('?')) return false;
      const target = new URL(f.href, url);
      return (
        target.pathname === url.pathname &&
        [...target.searchParams].every(
          ([key, value]) => url.searchParams.get(key) === value,
        )
      );
    }) ??
    FEATURE_CATALOG.find(
      (f) => f.href === url.pathname || f.aliases.includes(url.pathname),
    )
  );
}
export function featureAvailable(feature: Feature, profile: { role?: string } | null | undefined, centerCode: string) {
  return (
    (!feature.adminOnly || profile?.role === 'admin') &&
    (!feature.centers.length || feature.centers.includes(centerCode))
  );
}

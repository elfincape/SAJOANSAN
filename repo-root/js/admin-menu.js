import {
  isPrivateFeatureOwner,
  loadPrivateFeatures,
} from './private-features.js';

export function getAdminMenus(profile, centerCode) {
  // 메뉴 정의
  const isAdmin = profile.role === 'admin';
  const isPrivateOwner = isPrivateFeatureOwner(profile);
  const privateFeatures = loadPrivateFeatures(profile);
  return [
    {
      href: '/portal/',
      title: '업무 포털',
      desc: '오늘 할 일·업무 처리·인계·센터 업무조사',
      icon: iconLog(),
      color: 'emerald',
    },
    {
      feature: 'routes',
      href: '/admin/routes.html',
      title: '코스 관리',
      desc: '코스와 납품처(운행시간) 편집',
      icon: iconRoute(),
      color: 'emerald',
    },
    {
      feature: 'deliveryPoints',
      href: '/admin/delivery-points.html',
      title: '납품처 관리',
      desc: '납품처 마스터(주소·진입조건·마감시간)',
      icon: iconStore(),
      color: 'sky',
    },
    {
      feature: 'drivers',
      href: '/admin/drivers.html',
      title: '기사 관리',
      desc: '기사 명부와 연락처',
      icon: iconUser(),
      color: 'amber',
    },
    {
      feature: 'drivers',
      href: '/admin/pdf-image-converter.html',
      title: 'PDF IMG 변환기',
      desc: 'PDF 페이지를 기사 서류 사진으로 등록',
      icon: iconParser(),
      color: 'cyan',
    },
    {
      feature: 'vehicles',
      href: '/admin/vehicles.html',
      title: '차량 관리',
      desc: '차량번호·톤수·팔레트 적재량',
      icon: iconTruck(),
      color: 'violet',
    },
    {
      feature: 'companies',
      href: '/admin/companies.html',
      title: '운수사 관리',
      desc: '운수사 정보',
      icon: iconBuilding(),
      color: 'rose',
    },
    {
      feature: 'dispatchParser',
      href: '/admin/dispatch-parser.html',
      title: '배차정보 파서',
      desc: '배차 문자 자동 파싱',
      icon: iconParser(),
      color: 'sky',
    },
    {
      feature: 'pyeongtaekCharterParser',
      href: '/admin/pyeongtaek-charter-parser.html',
      title: '평택 용차내역 파서',
      desc: '엑셀 업로드·DB 조회/수정·가로형 정산·OneDrive 월 보관',
      icon: iconParser(),
      color: 'sky',
    },
    ...(centerCode === '002' ? [{
      href: '/admin/pyeongtaek-dispatch.html',
      title: '평택 가배차',
      desc: '당일 물량 · 고정차 배정 · 임시차 초안',
      color: 'emerald',
    }] : []),
    {
      href: '/admin/charter-fuel-estimator.html',
      title: '착지별 주행거리 계산',
      desc: '',
      icon: iconTruck(),
      color: 'amber',
    },
    {
      href: '/admin/naver-shortest-distance.html',
      title: '네이버 최단거리 계산',
      desc: '',
      icon: iconRoute(),
      color: 'sky',
    },
    {
      feature: 'transfers',
      href: '/admin/transfers.html',
      title: '이배송 관리',
      desc: '이배송 관리',
      icon: iconTransfer(),
      color: 'emerald',
    },
    {
      feature: 'excelCompare',
      href: '/admin/excel-compare.html',
      title: '엑셀 시트 비교',
      desc: '여러 열로 행 매칭·값 가져오기·TRUE/FALSE 확인',
      icon: iconTransfer(),
      color: 'emerald',
    },
    {
      feature: 'palletSlips',
      href: '/admin/pallet-slips.html',
      title: '파레트 전표관리',
      desc: '엑셀 전표 매칭 후 결과 내려받기',
      icon: iconStore(),
      color: 'violet',
    },
    {
      feature: 'oneTopWork',
      href: '/admin/one-top-two-room-work.html',
      title: '1탑2실 작업',
      desc: '영수증 촬영·온도 분석·차량번호별 Excel 반영',
      icon: iconParser(),
      color: 'sky',
    },
    {
      feature: 'dailyTemperature',
      href: '/admin/daily-temperature.html',
      title: '1탑2실 템플릿 생성',
      desc: '고정·광역·임시 순서 유지 템플릿 생성',
      icon: iconParser(),
      color: 'emerald',
    },
    {
      feature: 'coupangEntry',
      href: '/admin/coupang-entry.html',
      title: '쿠팡 입문확인',
      desc: '쿠팡 시간표 이미지·배차정보 매칭 엑셀 생성',
      icon: iconLog(),
      color: 'cyan',
    },
    ...(isPrivateOwner
      ? [
          {
            feature: 'ansanGimhaeBusanAnsan',
            href: '/admin/ansan-gimhae-busan-ansan.html',
            title: '안산김해부산안산',
            desc: '',
            icon: iconRoute(),
            color: 'amber',
          },
        ]
      : []),
    ...(isPrivateOwner
      ? [
          {
            feature: 'imageStraightener',
            href: '/admin/image-straightener.html',
            title: '기울기 보정',
            desc: '',
            icon: iconParser(),
            color: 'cyan',
          },
        ]
      : []),
    {
      feature: 'haulCalculator',
      href: '/admin/haul-dispatch-calculator.html',
      title: '하불 배차 계산',
      desc: '실제 구간단가 기준 최저가 차량 조합 계산',
      icon: iconLog(),
      color: 'emerald',
    },
    ...(isAdmin
      ? [
          {
            href: '/admin/notion-health.html',
            title: '보건증 Notion 연동',
            desc: '보건증 갱신 목록 연결 확인',
            icon: iconLog(),
            color: 'emerald',
          },
          {
            feature: 'exportData',
            href: '/admin/export.html',
            icon: iconTransfer(),
            title: '코스표 내려받기',
            desc: 'CSV / XLSX로 전체 코스 다운로드',
            color: 'cyan',
          },
          {
            feature: 'importData',
            href: '/admin/import.html',
            icon: iconTransfer(),
            title: 'CSV 일괄 가져오기',
            desc: '엑셀 코스표를 한 번에 업로드',
            color: 'amber',
            adminOnly: true,
          },
          {
            feature: 'users',
            href: '/admin/users.html',
            title: '사용자 관리',
            desc: '계정·권한·활성 상태',
            icon: iconShield(),
            color: 'cyan',
            adminOnly: true,
          },
          ...(isPrivateOwner
            ? [
                {
                  feature: 'auditLog',
                  href: '/admin/audit-log.html',
                  title: '변경 이력',
                  desc: '데이터 변경 로그',
                  icon: iconLog(),
                  color: 'zinc',
                  adminOnly: true,
                },
              ]
            : []),
        ]
      : []),
    ...(isPrivateOwner
      ? [
          {
            href: '/admin/settings.html',
            title: '설정',
            desc: '관리 허브 기능 표시 설정',
            icon: iconShield(),
            color: 'zinc',
          },
        ]
      : []),
  ].filter((menu) => !menu.feature || privateFeatures[menu.feature]);
}

// ----- 인라인 SVG 아이콘들 -----
function iconRoute() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M6 19a3 3 0 100-6h12a3 3 0 100-6M6 5v0M18 19v0"/>
      </svg>`;
}
function iconStore() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 9l1-4h16l1 4M3 9v11h18V9M3 9h18M9 13h6"/>
      </svg>`;
}
function iconUser() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M16 14a4 4 0 10-8 0M5 21a7 7 0 0114 0M12 11a3 3 0 100-6 3 3 0 000 6z"/>
      </svg>`;
}
function iconTruck() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M3 7h11v8H3zM14 10h4l3 3v2h-7zM6.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17.5 18a1.5 1.5 0 100-3 1.5 1.5 0 000 3z"/>
      </svg>`;
}
function iconBuilding() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M4 21V5a2 2 0 012-2h8a2 2 0 012 2v16M4 21h16M16 9h2a2 2 0 012 2v10M9 8h2M9 12h2M9 16h2"/>
      </svg>`;
}
function iconParser() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M4 6h16M4 12h10M4 18h7M15 15l2 2 4-4"/>
      </svg>`;
}
function iconTransfer() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 17h6M9 13h6M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2z"/>
      </svg>`;
}
function iconShield() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M12 3l8 4v5c0 5.25-3.5 10.15-8 11.5C7.5 22.15 4 17.25 4 12V7l8-4z"/>
      </svg>`;
}
function iconLog() {
  return `<svg xmlns="http://www.w3.org/2000/svg" class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round"
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>
      </svg>`;
}

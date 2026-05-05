// 시간 유틸
// =============================================================================
// 현재 정책:
//   - 04:00 기준 business_minute 정책 폐기
//   - 모든 시간은 00:00 기준 "하루 내 분(minute of day)"으로 저장/표시
//   - 허용 범위: 00:00 ~ 23:59
//   - 24:00, 25:30, 27:59 같은 익일/초과 표기 사용 안 함
//
// 주의:
//   DB 컬럼명이 *_business_min 으로 남아 있어도 값의 의미는 이제
//   "00:00 기준 분"으로 사용한다.
// =============================================================================

// -----------------------------------------------------------------------------
// 분 → "HH:MM"
//   0    → "00:00"
//   60   → "01:00"
//   1320 → "22:00"
//   1439 → "23:59"
// -----------------------------------------------------------------------------
export function minToDisplay(min) {
  if (min == null || Number.isNaN(Number(min))) return '';

  const n = Number(min);
  if (!Number.isFinite(n)) return '';
  if (n < 0 || n >= 1440) return '';

  const h = Math.floor(n / 60);
  const m = n % 60;

  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// -----------------------------------------------------------------------------
// "HH:MM" → 분
//   "00:00" → 0
//   "01:00" → 60
//   "22:00" → 1320
//   "23:59" → 1439
//
// 허용:
//   "9:5"    → 545
//   "09:05"  → 545
//   "9시5분" → 545
//   "9.05"   → 545
//
// 불허:
//   "24:00"
//   "25:30"
//   "27:59"
//   "03:99"
// -----------------------------------------------------------------------------
export function displayToMin(str) {
  if (!str) return null;

  const s = String(str).trim();
  if (!s) return null;

  const m = s.match(/^(\d{1,2})\s*[:.시]\s*(\d{1,2})\s*분?$/);
  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);

  if (!Number.isInteger(h) || !Number.isInteger(min)) return null;
  if (h < 0 || h > 23) return null;
  if (min < 0 || min > 59) return null;

  return h * 60 + min;
}

// -----------------------------------------------------------------------------
// 입력 시간 문자열 정규화
//   "9:5"    → "09:05"
//   "9시5분" → "09:05"
//   "9.05"   → "09:05"
// -----------------------------------------------------------------------------
export function normalizeTime(str) {
  const min = displayToMin(str);
  return min == null ? '' : minToDisplay(min);
}

// -----------------------------------------------------------------------------
// 기존 코드 호환용 alias
// -----------------------------------------------------------------------------
// 기존 파일들이 bizMinToDisplay/displayToBizMin/bizMinToStandard 이름을 import하고
// 있으므로 이름은 유지한다.
// 단, 더 이상 04:00 기준 보정은 하지 않는다.

export function bizMinToDisplay(min) {
  return minToDisplay(min);
}

export function displayToBizMin(str) {
  return displayToMin(str);
}

export function bizMinToStandard(min) {
  return minToDisplay(min);
}

// -----------------------------------------------------------------------------
// 여유시간 포맷
// -----------------------------------------------------------------------------
// 여유시간 정책은 폐기되었지만, 기존 화면(route-edit 등)에서 import 중일 수 있어
// 런타임 오류 방지를 위해 함수는 유지한다.
// 새 화면/정책에서는 사용하지 않는 것을 권장한다.
export function formatSlack(min) {
  if (min == null || Number.isNaN(Number(min))) return '';

  const n = Number(min);
  if (n === 0) return '정시';

  const negative = n < 0;
  const abs = Math.abs(n);
  const h = Math.floor(abs / 60);
  const m = abs % 60;

  let core;
  if (h > 0 && m > 0)      core = `${h}시간 ${m}분`;
  else if (h > 0)          core = `${h}시간`;
  else                     core = `${m}분`;

  return negative ? `${core} 부족` : core;
}

// -----------------------------------------------------------------------------
// 단위 테스트 예시
// -----------------------------------------------------------------------------
// displayToMin('00:00')      === 0
// displayToMin('01:00')      === 60
// displayToMin('04:00')      === 240
// displayToMin('22:00')      === 1320
// displayToMin('23:59')      === 1439
// displayToMin('24:00')      === null
// displayToMin('25:30')      === null
// minToDisplay(0)            === '00:00'
// minToDisplay(60)           === '01:00'
// minToDisplay(240)          === '04:00'
// minToDisplay(1320)         === '22:00'
// minToDisplay(1439)         === '23:59'
// bizMinToDisplay(240)       === '04:00'
// displayToBizMin('04:00')   === 240
// bizMinToStandard(1320)     === '22:00'

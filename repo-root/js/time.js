
export function bizMinToDisplay(min) {
  if (min == null || Number.isNaN(min)) return '';
  const totalMin = min + 4 * 60; // 04:00 기준 보정
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "HH:MM" 문자열 → business_minute
// 04시 미만으로 입력된 시간(예: "01:00")은 다음날로 해석한다.
// "25:30" 같은 24시 넘기는 표기도 자연스럽게 처리된다.
export function displayToBizMin(str) {
  if (!str) return null;
  const parts = String(str).trim().split(':');
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (m < 0 || m > 59) return null;

  let total = h * 60 + m;
  if (h < 4) total += 24 * 60; // 새벽 0~3시 → 다음날 처리
  const biz = total - 4 * 60;

  // 영업일 범위 [0, 1440) 강제
  if (biz < 0 || biz >= 1440) return null;
  return biz;
}

// 여유시간(분) → 사람이 읽는 문자열
//   90  → "1시간 30분"
//   30  → "30분"
//   0   → "정시"
//   -45 → "45분 부족"
//   -90 → "1시간 30분 부족"
export function formatSlack(min) {
  if (min == null || Number.isNaN(min)) return '';
  if (min === 0) return '정시';

  const negative = min < 0;
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;

  let core;
  if (h > 0 && m > 0)      core = `${h}시간 ${m}분`;
  else if (h > 0)          core = `${h}시간`;
  else                     core = `${m}분`;

  return negative ? `${core} 부족` : core;
}

// 표시 전용: 항상 0~23:59 표기
export function bizMinToStandard(min) {
  if (min == null) return '';
  // business_minute는 04:00=0 기준, 실제 시각 = (min + 240) % 1440
  const real = ((Number(min) + 240) % 1440 + 1440) % 1440;
  const h = Math.floor(real / 60);
  const m = real % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

// -----------------------------------------------------------------------------
// 단위 테스트 예시 (실제 실행되지 않음, 주석)
// -----------------------------------------------------------------------------
// displayToBizMin('22:00')   === 1080
// displayToBizMin('01:00')   === 1260
// displayToBizMin('25:00')   === 1260
// displayToBizMin('04:00')   === 0
// displayToBizMin('03:59')   === 1439
// bizMinToDisplay(0)         === '04:00'
// bizMinToDisplay(1080)      === '22:00'
// bizMinToDisplay(1260)      === '25:00'   // 24시 넘김 표기
// bizMinToDisplay(1439)      === '27:59'
// formatSlack(90)            === '1시간 30분'
// formatSlack(30)            === '30분'
// formatSlack(-45)           === '45분 부족'
// formatSlack(0)             === '정시'

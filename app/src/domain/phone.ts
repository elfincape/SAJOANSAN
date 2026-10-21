export function formatPhone(str: string | null | undefined) {
  if (!str) return '';
  const digits = String(str).replace(/\D/g, '');

  // 서울 02
  if (digits.startsWith('02')) {
    if (digits.length === 9)  return `02-${digits.slice(2,5)}-${digits.slice(5)}`;
    if (digits.length === 10) return `02-${digits.slice(2,6)}-${digits.slice(6)}`;
  }
  // 휴대전화 / 기타 지역번호 (3자리 시외)
  if (digits.length === 10) {
    return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11) {
    return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
  }
  // 8자리(대표번호 1588 등)
  if (digits.length === 8) {
    return `${digits.slice(0,4)}-${digits.slice(4)}`;
  }
  return str;
}

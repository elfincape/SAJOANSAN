export function normalizeStopTime(value: string) {
  if (!value) return '';
  const match = String(value).trim().match(/^(\d{1,2})\s*[:.시]\s*(\d{1,2})\s*분?$/);
  if (!match) return '';
  const hour = parseInt(match[1], 10), minute = parseInt(match[2], 10);
  if (Number.isNaN(hour) || Number.isNaN(minute) || minute < 0 || minute > 59 || hour < 0 || hour > 27) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

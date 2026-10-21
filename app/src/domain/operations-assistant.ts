export interface AssistantColumn {
  key: string;
  label: string;
  type: string;
}
export interface AssistantAnswer {
  answer: string;
  columns: AssistantColumn[];
  rows: Record<string, unknown>[];
  notices: string[];
  meta: { truncated?: boolean };
}
export function sanitizeTsvCell(value: unknown, type = 'text') {
  if (value == null) return '';
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value))
    return String(value);
  let text = String(value).replace(/[\t\r\n]+/g, ' ');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return text;
}
export function buildTsv(
  columns: AssistantColumn[],
  rows: Record<string, unknown>[],
) {
  const cols = Array.isArray(columns) ? columns : [],
    header = cols.map((c) => sanitizeTsvCell(c.label || c.key)).join('\t'),
    body = (Array.isArray(rows) ? rows : []).map((row) =>
      cols.map((c) => sanitizeTsvCell(row?.[c.key], c.type)).join('\t'),
    );
  return [header, ...body].join('\n');
}
export function normalizeAssistantResponse(value: unknown): AssistantAnswer {
  if (!value || typeof value !== 'object')
    throw Error('잘못된 응답 형식입니다.');
  const v = value as Record<string, unknown>;
  return {
    answer: String(v.answer || ''),
    columns: Array.isArray(v.columns)
      ? v.columns
          .slice(0, 30)
          .map((c) => ({
            key: String(c.key || ''),
            label: String(c.label || c.key || ''),
            type: c.type === 'number' ? 'number' : 'text',
          }))
          .filter((c) => c.key)
      : [],
    rows: Array.isArray(v.rows) ? v.rows : [],
    notices: Array.isArray(v.notices) ? v.notices.map(String).slice(0, 10) : [],
    meta: v.meta && typeof v.meta === 'object' ? v.meta : {},
  };
}

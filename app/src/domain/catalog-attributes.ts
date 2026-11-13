import { CENTERS } from '../lib/center';
// Existing center_code is an original's own classification, never a relationship value.
export const centerAttribute = {
  key: 'center', label: '센터', column: 'center_code',
  targets: ['routes', 'delivery_points'] as const,
  values: CENTERS.map(center => ({ value: center.code, label: center.shortName })),
};
export const centerAttributeLabel = (value: string | null | undefined) => value == null ? '미분류' : centerAttribute.values.find(item => item.value === value)?.label ?? (value ? `기존 값 · ${value}` : '기존 값 · 빈 문자열');
export const centerAccessKey = (value: string | null | undefined) => value == null || value === '' ? 'unclassified' : value;

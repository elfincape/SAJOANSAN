import type { DeliveryPoint } from '../lib/delivery-points';
import { bizMinToDisplay, displayToBizMin } from './time';
import { normalizeTime, parseDeliveryPointPhotos, splitLegacyMemoAndPhotos, stripLegacyPhotoPayload } from './delivery-photos';
import type { DeliveryPhoto } from './delivery-photos';

export const textFields = {
  'f-code': 'code', 'f-name': 'name', 'f-address': 'address', 'f-region': 'region',
  'f-security-key-location': 'security_key_location', 'f-security-password': 'security_password',
  'f-rep-name': 'rep_name', 'f-rep-phone': 'rep_phone', 'f-mgr-name': 'contact_name', 'f-mgr-office': 'contact_office', 'f-mgr-mobile': 'contact_mobile',
} as const;
export const flags = { 'f-1ton': 'allow_under_1ton', 'f-3_5ton': 'allow_under_3_5ton', 'f-5ton': 'allow_over_5ton', 'f-yard': 'allow_unmanned_yard' } as const;
export const radios = { dmethod: 'delivery_method', amethod: 'access_method', dloc: 'delivery_location' } as const;
type TextKey = typeof textFields[keyof typeof textFields] | typeof radios[keyof typeof radios];
export type PointDraft = Record<TextKey, string> & Record<typeof flags[keyof typeof flags], boolean> & { id: string; deadline: string; memo: string; photos: DeliveryPhoto[] };
export function pointToDraft(row?: DeliveryPoint): PointDraft {
  const legacy = splitLegacyMemoAndPhotos(row?.memo || '');
  const photos = parseDeliveryPointPhotos(row?.photos);
  return {
    ...Object.fromEntries([...Object.values(textFields), ...Object.values(radios)].map(key => [key, row?.[key] || ''])) as Record<TextKey, string>,
    ...Object.fromEntries(Object.values(flags).map(key => [key, !!row?.[key]])) as Record<typeof flags[keyof typeof flags], boolean>,
    id: row?.id || '', deadline: row?.deadline_text || (row?.deadline_business_min != null ? bizMinToDisplay(row.deadline_business_min) : ''),
    contact_mobile: row?.contact_mobile || row?.contact || '', memo: legacy.memo, photos: photos.length ? photos : legacy.photos,
  };
}
export function pointPayload(draft: PointDraft, center: string) {
  const deadline = draft.deadline.trim();
  const payload: Record<string, unknown> = {
    ...Object.fromEntries([...Object.values(textFields), ...Object.values(radios)].map(key => [key, draft[key].trim() || null])),
    ...Object.fromEntries(Object.values(flags).map(key => [key, draft[key]])),
    center_code: center, name: draft.name.trim(), deadline_text: deadline ? normalizeTime(deadline) : null,
    deadline_business_min: deadline ? displayToBizMin(normalizeTime(deadline)) : null,
    contact: draft.contact_mobile.trim() || null, memo: stripLegacyPhotoPayload(draft.memo) || null, photos: draft.photos,
  };
  if (draft.id) payload.id = draft.id;
  return payload;
}

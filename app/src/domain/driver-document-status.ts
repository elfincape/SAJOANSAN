export const DOCUMENT_GROUPS = [
  ['식품', ['food_transport', 'food_transport_back']],
  ['축산', ['livestock_transport', 'livestock_transport_back']],
  ['화물', ['freight_license']], ['차량', ['vehicle_registration']],
  ['신분', ['identity']], ['보건', ['health_certificate']]
] as const;
export function documentChecks(records: { document_type: string }[]) {
  const kinds = new Set(records.map(row => row.document_type));
  return DOCUMENT_GROUPS.map(([label, required]) => ({label, checked: required.every(kind => kinds.has(kind))}));
}

export const DOCUMENT_GROUPS = [
  ['식품', ['food_transport', 'food_transport_back']],
  ['축산', ['livestock_transport', 'livestock_transport_back']],
  ['화물', ['freight_license']], ['차량', ['vehicle_registration']],
  ['신분', ['identity']], ['보건', ['health_certificate']]
];
export function documentChecks(records) {
  const kinds = new Set(records.map(row => row.document_type));
  return DOCUMENT_GROUPS.map(([label, required]) => ({label, checked: required.every(kind => kinds.has(kind))}));
}
export function documentChecksHtml(records) {
  if (!records) return '<span class="text-xs text-zinc-400">조회 실패</span>';
  return '<div class="flex gap-2 whitespace-nowrap">' + documentChecks(records).map(({label,checked}) =>
    '<label class="inline-flex flex-col items-center gap-1 text-xs"><span>'+label+'</span><input type="checkbox" disabled aria-label="'+label+' 서류 등록" '+(checked?'checked':'')+' style="opacity:1;accent-color:#34d399;pointer-events:none"></label>'
  ).join('') + '</div>';
}

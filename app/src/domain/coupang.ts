export type RawSchedule=Record<string,unknown>;
export interface ScheduleRow extends RawSchedule {_order:number;centerRaw:string;centerBase:string;isB2B:boolean;reservationTime:string|null;quantity:number|null;cold:number|null;frozen:number|null}
export interface DispatchBase {centerText:string;ton:string;driver:string;vehicle:string;phone:string}
export interface DispatchRow extends DispatchBase {groupId:string;groupFill:string;centerKey:string;centerBaseKey:string;isB2B:boolean;centerLabel:string}
export interface DispatchMatch {matchedDispatch:DispatchRow|null;matchType:string;confidence:number;warning:string}
export interface CoupangMatch {schedule:ScheduleRow;match:DispatchMatch;include:boolean}
  const GROUP_FILL_COLORS = ['FFE2F0CB','FFFFD6A5','FFCAFFBF','FF9BF6FF','FFA0C4FF','FFBDB2FF','FFFFADAD','FFFDFFB6','FFCDE7BE','FFD7E3FC','FFFFC8DD','FFE0BBE4'];
  export function defaultEntryDate(now = new Date()) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  }
  export function formatEntryDateLabel(value: string) {
    const d = parseDateInput(value);
    if (!d) return '';
    const days = ['일요일','월요일','화요일','수요일','목요일','금요일','토요일'];
    return `${d.getMonth() + 1}월${d.getDate()}일(${days[d.getDay()]})`;
  }
  function parseDateInput(value: string) {
    const s = String(value || '').trim();
    if (/^\d{6}$/.test(s)) return new Date(2000 + Number(s.slice(0, 2)), Number(s.slice(2, 4)) - 1, Number(s.slice(4, 6)));
    if (/^\d{8}$/.test(s)) return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  }
  export function normalizeScheduleRow(row: RawSchedule, index: number): ScheduleRow {
    const raw = normalizeCenterName(row.centerRaw || row.center || row.centerBase || '');
    // 원문에 있는 센터 번호를 API의 축약된 centerBase로 덮어쓰지 않는다.
    const base = raw.replace(/\s*b2b/ig, '').trim();
    const isB2B = /b2b/i.test(raw) || row.isB2B === true || String(row.isB2B).toLowerCase() === 'true';
    return { ...row, _order: index, centerRaw: `${base}${isB2B ? ' B2B' : ''}`, centerBase: base, isB2B, reservationTime: roundToNearestHalfHour(normalizeTime(row.reservationTime)), quantity: numberOrNull(row.quantity), cold: numberOrNull(row.cold ?? row.refrigerated), frozen: numberOrNull(row.frozen) };
  }
  export function isActiveScheduleRow(row: ScheduleRow) { return Boolean(row.reservationTime || row.quantity != null || row.cold != null || row.frozen != null); }

  export function parseDispatchText(raw: string) {
    const state={usedGroupFills:new Set<string>()};
    const lines = String(raw || '').replace(/\r/g, '\n').split('\n').map(v => v.trim()).filter(Boolean);
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      if (!hasTonnage(lines[i])) continue;
      if (i + 2 >= lines.length) break;
      const batchSpecs = tonCountSpecs(lines[i]);
      if (batchSpecs.length) {
        const { centerText, tons } = batchNameTon(lines[i], batchSpecs); let offset = 1;
        tons.forEach(ton => { if (i + offset + 1 >= lines.length) return; const dv = driverVehicle(lines[i + offset]); out.push(dispatchRecord(centerText, ton, dv.driver, dv.vehicle, normalizePhone(lines[i + offset + 1]))); offset += 2; });
        i += offset - 1; continue;
      }
      const nt = nameTon(lines[i]); const dv = driverVehicle(lines[i + 1]); out.push(dispatchRecord(nt.centerText, nt.ton, dv.driver, dv.vehicle, normalizePhone(lines[i + 2]))); i += 2;
    }
    return out.flatMap(expandDispatchRecord);
  function expandDispatchRecord(record: DispatchBase) {
    const expanded = expandCenterExpression(record.centerText);
    const groupId = `dispatch-group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const groupFill = pickDistinctGroupFill();
    return expanded.map(key => ({ ...record, groupId, groupFill, centerKey: key.key, centerBaseKey: key.baseKey, isB2B: key.isB2B, centerLabel: key.label }));
  }
  function pickDistinctGroupFill() {
    const available = GROUP_FILL_COLORS.filter(color => !state.usedGroupFills.has(color));
    const color = available.length ? available[Math.floor(Math.random() * available.length)] : randomPastelArgb();
    state.usedGroupFills.add(color);
    return color;
  }
  function randomPastelArgb() {
    let color = '';
    do {
      const r = 185 + Math.floor(Math.random() * 55);
      const g = 185 + Math.floor(Math.random() * 55);
      const b = 185 + Math.floor(Math.random() * 55);
      color = `FF${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`.toUpperCase();
    } while (state.usedGroupFills.has(color));
    return color;
  }

  }
  function dispatchRecord(centerText: string, ton: string, driver: string, vehicle: string, phone: string) { return { centerText, ton, driver, vehicle, phone }; }
  export function expandCenterExpression(text: string) {
    const cleaned = normalizeCenterName(String(text || '').replace(/^쿠팡\s*/,'')).replace(/([가-힣\d])\s+B2B/gi, '$1B2B');
    const parts = cleaned.split(/[\/+,，、\s]+/).filter(Boolean); const result: ReturnType<typeof centerKeyObj>[] = []; let lastRegion = ''; let lastBaseLabel = '';
    parts.forEach(part => {
      if (/^(b2b|비투비)$/i.test(part) && lastBaseLabel) { result.push(centerKeyObj(`${lastBaseLabel}B2B`)); return; }
      const m = part.match(/^([가-힣]+)?(\d*)(b2b)?$/i);
      if (!m) return;
      if (!m[1] && (!m[2] || !lastRegion)) return;
      if (m[1]) lastRegion = m[1];
      const baseLabel = `${lastRegion}${m[2]}`;
      lastBaseLabel = baseLabel;
      result.push(centerKeyObj(`${baseLabel}${m[3] ? 'B2B' : ''}`));
    });
    return result.length ? result : [centerKeyObj(cleaned)];
  }
  function centerKeyObj(label: string) { const normalized = normalizeCenterName(label); const isB2B = /b2b/i.test(normalized); const base = normalized.replace(/\s*b2b/ig, ''); return { label: normalized, key: centerKey(normalized), baseKey: centerKey(base), isB2B }; }
  function hasTonnage(line: string) { return /\d+(?:\.\d+)?(?:톤|축)/.test(line); }
  function nameTon(line: string) { const cleaned = String(line || '').replace(/^\d+\.\s*/, '').replace(/\s*경유\s*/g, ' ').trim(); const m = cleaned.match(/\d+(?:\.\d+)?(?:톤|축)/); return { centerText: (m ? cleaned.slice(0, m.index) : cleaned).trim(), ton: m ? m[0] : '' }; }
  function tonCountSpecs(line: string) { const specs = []; const re = /(\d+(?:\.\d+)?(?:톤|축))\s*(\d+)\s*대/g; let m; while ((m = re.exec(line))) specs.push({ ton: m[1], count: Number(m[2]) }); return specs; }
  function batchNameTon(line: string, specs: {ton:string;count:number}[]) { const idx = line.search(/\d+(?:\.\d+)?(?:톤|축)\s*\d+\s*대/); const centerText = (idx >= 0 ? line.slice(0, idx) : nameTon(line).centerText).trim(); return { centerText, tons: specs.flatMap(s => Array.from({ length: s.count }, () => s.ton)) }; }
  function driverVehicle(line: string) { const parts = String(line || '').trim().split(/\s+/); return { driver: parts[0] || '', vehicle: parts[1] || '' }; }

  export function matchScheduleToDispatch(scheduleRow: ScheduleRow, dispatchRows: DispatchRow[]): DispatchMatch {
    const rawKey = centerKey(scheduleRow.centerRaw); const baseKey = centerKey(scheduleRow.centerBase);
    if (scheduleRow.isB2B) {
      const exact = dispatchRows.find(d => d.centerKey === rawKey && d.isB2B); if (exact) return { matchedDispatch: exact, matchType: 'b2b_exact', confidence: 1, warning: '' };
      const inherited = dispatchRows.find(d => d.centerBaseKey === baseKey && !d.isB2B); if (inherited) return { matchedDispatch: inherited, matchType: 'b2b_inherited_from_base', confidence: .82, warning: 'B2B 별도 배차가 없어 일반 센터 배차를 상속했습니다.' };
      return { matchedDispatch: null, matchType: 'unmatched', confidence: 0, warning: 'B2B 매칭 실패' };
    }
    const exact = dispatchRows.find(d => d.centerKey === baseKey && !d.isB2B); if (exact) return { matchedDispatch: exact, matchType: 'exact', confidence: 1, warning: '' };
    return { matchedDispatch: null, matchType: 'unmatched', confidence: 0, warning: '매칭 실패' };
  }
  function roundToNearestHalfHour(timeText: unknown) {
    const t = normalizeTime(timeText);
    if (!t) return null;
    const [h, m] = t.split(':').map(Number);
    const roundedTotal = Math.round((h * 60 + m) / 30) * 30;
    return `${String(Math.floor(roundedTotal / 60) % 24).padStart(2,'0')}:${String(roundedTotal % 60).padStart(2,'0')}`;
  }
  export function normalizeTime(value: unknown): string | null {
    if (value == null || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value)) { const total = Math.round((value % 1) * 24 * 60); return `${String(Math.floor(total / 60) % 24).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`; }
    if (value instanceof Date) return `${String(value.getHours()).padStart(2,'0')}:${String(value.getMinutes()).padStart(2,'0')}`;
    const s = String(value).trim();
    const numeric = Number(s);
    if (Number.isFinite(numeric) && numeric >= 0 && numeric < 1) return normalizeTime(numeric);
    const m = s.match(/(오전|오후)?\s*(\d{1,2})\s*[:시]?\s*(\d{2})?/);
    if (!m) return null;
    let hour = Number(m[2]);
    if (m[1] === '오후' && hour < 12) hour += 12;
    if (m[1] === '오전' && hour === 12) hour = 0;
    return `${String(hour).padStart(2,'0')}:${String(Number(m[3] || 0)).padStart(2,'0')}`;
  }
  function normalizeCenterName(value: unknown) {
    return String(value || '')
      .replace(/군지암|ㄱㅈㅇ/g, '곤지암')
      .replace(/ㅍㅌ/g, '평택')
      .replace(/([가-힣])\s+(?=\d)/g, '$1')
      .replace(/\s*(?:b2b|비투비)/gi, ' B2B')
      .replace(/\s+/g, ' ').trim();
  }
  function centerKey(value: unknown) { return normalizeCenterName(value).toLowerCase().replace(/\s+/g, '').replace(/비투비/g, 'b2b'); }
  function normalizePhone(raw: unknown) { const d = String(raw || '').replace(/\D/g, ''); return d.length === 11 ? `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}` : String(raw || '').trim(); }
  function numberOrNull(v: unknown) { const text = String(v ?? '').replace(/[^\d.-]/g, ''); if (!text) return null; const n = Number(text); return Number.isFinite(n) ? n : null; }
  export function parseScheduleRowsFromText(text: string): RawSchedule[] {
    const jsonText = extractJsonArrayText(text);
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (err) {
      console.error('[coupang-entry] JSON.parse 실패 원문:', jsonText);
      throw new Error(`JSON 추출 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!Array.isArray(parsed)) throw new Error(`JSON 배열이 아닙니다. 실제 타입: ${parsed === null ? 'null' : typeof parsed}`);
    return parsed;
  }
  function extractJsonArrayText(text: string) {
    const s = String(text ?? '').trim();
    console.log('[coupang-entry] JSON 추출 대상 원문:', s);
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = fence ? fence[1].trim() : s;
    const a = body.indexOf('[');
    const b = body.lastIndexOf(']');
    if (a >= 0 && b >= a) return body.slice(a, b + 1);
    throw new Error('응답에서 JSON 배열([ ... ])을 찾지 못했습니다.');
  }

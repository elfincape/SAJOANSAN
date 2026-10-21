export interface DispatchRecord { name: string; ton: string; driver: string; vehicle: string; phone: string; _warn: boolean }
interface TonSpec { ton: string; count: number }
  function normalizePhone(raw: string) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('010'))
      return `${digits.slice(0,3)}-${digits.slice(3,7)}-${digits.slice(7)}`;
    if (digits.length === 11)
      return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    if (digits.length === 10)
      return `${digits.slice(0,3)}-${digits.slice(3,6)}-${digits.slice(6)}`;
    return raw.trim();
  }

  /** 해당 줄에 톤수/축냉 표기가 있는지 여부 — 레코드 시작 줄 판별 */
  function hasTonnage(line: string) {
    return /\d+(?:\.\d+)?(?:톤|축)/.test(line);
  }

  function parseNameTon(line: string) {
    // ① 번호 접두사 제거: "1. ", "2. " 등
    const noPrefix = line.replace(/^\d+\.\s*/, '');

    // ② 공백+슬래시 이후 제거 ("오산 5톤 /후레스써브" → "오산 5톤")
    const beforeAltSlash = noPrefix.split(/\s\/(?!\s*\d)/)[0];
    const beforeSlash    = beforeAltSlash.split(/\s\//)[0].trim();

    // ③ "경유" 키워드 제거
    const cleaned = beforeSlash.replace(/\s*경유\s*/g, ' ').replace(/\s+/g, ' ').trim();

    // ④ 톤수 추출: N톤 또는 N축(축냉차 표기) 모두 인식
    //    톤수 뒤 시간정보("12시 입문", "19시" 등)는 자동으로 무시됨
    const tonMatch = cleaned.match(/(\d+(?:\.\d+)?(?:톤|축))/);
    const ton = tonMatch ? tonMatch[1] : '';

    // ⑤ 거래처명: 톤수 앞부분 정리, 이름 내 "/" → "+"
    let name = ton
      ? cleaned.slice(0, cleaned.indexOf(ton)).trim()
      : cleaned;
    name = name.replace(/\//g, '+').trim();

    return { name, ton };
  }

  function parseDispatchName(rawName: string, { batch = false } = {}) {
    const cleaned = String(rawName || '').replace(/\s+/g, ' ').trim();
    if (!batch) return cleaned;
    // N대 묶음 배차에서 첫 토큰은 거래처명, 뒤 토큰은 지점/상차지로 오는 경우가 많음
    // 예: "한마루 곤지암 11톤 2대" → 거래처명 "한마루"
    return cleaned.split(/\s+/)[0] || cleaned;
  }

  function parseTonCountSpecs(line: string) {
    const specs = [];
    const re = /(\d+(?:\.\d+)?(?:톤|축))\s*(\d+)\s*대/g;
    let match;
    while ((match = re.exec(line)) !== null) {
      const count = Number(match[2]);
      if (Number.isFinite(count) && count > 0) {
        specs.push({ ton: match[1], count });
      }
    }
    return specs;
  }

  function expandTonCounts(specs: TonSpec[]) {
    return specs.flatMap(spec => Array.from({ length: spec.count }, () => spec.ton));
  }

  function parseBatchNameTon(line: string, specs: TonSpec[]) {
    const firstSpecIndex = line.search(/\d+(?:\.\d+)?(?:톤|축)\s*\d+\s*대/);
    const namePart = firstSpecIndex >= 0 ? line.slice(0, firstSpecIndex).trim() : parseNameTon(line).name;
    return { name: parseDispatchName(namePart, { batch: specs.length > 0 }), tons: expandTonCounts(specs) };
  }

  function parseDriverVehicle(line: string) {
    const parts = line.trim().split(/\s+/);
    return { driver: parts[0] || '', vehicle: parts[1] || '' };
  }

  export function parseDispatch(raw: string): DispatchRecord[] {
    const text   = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    /* ── 포맷 1: " / " 구분자가 있는 경우 분할, 없으면 전체를 1개 청크로 ── */
    const chunks = text.split(/[ \t]\/(?=[ \t\n])/);

    const results = [];

    for (const chunk of chunks) {
      /* 빈 줄 제거 후 라인 배열 */
      const lines = chunk.split('\n').map(l => l.trim()).filter(l => l.length > 0);

      /* ── 슬라이딩 윈도우: 톤수 표기가 없는 줄(날짜행 등)은 건너뜀 ── */
      let i = 0;
      while (i < lines.length) {
        // 레코드 시작 줄에 톤수가 없으면 1줄 스킵
        if (!hasTonnage(lines[i])) { i++; continue; }
        // 남은 줄이 3줄 미만이면 중단
        if (i + 2 >= lines.length) break;

        const batchSpecs = parseTonCountSpecs(lines[i]);
        if (batchSpecs.length > 0) {
          const { name, tons } = parseBatchNameTon(lines[i], batchSpecs);
          if (!name) { i++; continue; }

          let offset = 1;
          let parsedCount = 0;
          for (const ton of tons) {
            if (i + offset + 1 >= lines.length) break;
            const { driver, vehicle } = parseDriverVehicle(lines[i + offset]);
            const phone = normalizePhone(lines[i + offset + 1]);
            results.push({ name, ton, driver, vehicle, phone, _warn: !driver || !vehicle || !ton });
            parsedCount++;
            offset += 2;
          }
          i += parsedCount > 0 ? 1 + parsedCount * 2 : 1;
          continue;
        }

        const { name, ton }       = parseNameTon(lines[i]);
        const { driver, vehicle } = parseDriverVehicle(lines[i + 1]);
        const phone               = normalizePhone(lines[i + 2]);
        if (!name) { i++; continue; }
        results.push({ name, ton, driver, vehicle, phone, _warn: !driver || !vehicle || !ton });
        i += 3;
      }
    }

    return results;
  }


export const resultValue = (r: DispatchRecord) => `${r.name}\\${r.ton}\\${r.driver}\\${r.vehicle}\\${r.phone}`;

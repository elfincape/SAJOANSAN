class CoupangVisionError extends Error {detail?:unknown;edge?:unknown}
  const PROMPT = `이미지의 쿠팡 시간표 표를 읽어라.
각 행에서 센터명, 예약시간, 물량, 냉장, 냉동 값을 추출해라.
센터명이 있지만 예약시간이 비어 있는 행도 누락하지 말고 reservationTime을 null로 넣어라.
센터명은 원문 그대로 centerRaw에 넣어라.
센터명 초성에 ㄱㅈㅇ이 들어가면 반드시 곤지암으로 판단해라. ㅍㅌ이 들어가면 반드시 평택으로 판단하되, ㅍㅌ 뒤의 숫자는 보존해라. 예: ㅍㅌ2 → 평택2, ㅍㅌ2 B2B → 평택2 B2B.
B2B 여부를 판단해 isB2B에 넣어라.
centerBase에는 B2B를 제거한 기본 센터명을 넣어라.
예약시간은 HH:mm 형식으로 통일해라.
물량은 숫자만 number로 변환해라.
설명하지 말고 JSON 배열만 반환해라.`;
  export async function callCoupangVisionEdge({ model, mediaType, base64 }: {model:string;mediaType:string;base64:string}): Promise<string> {
    const supabaseUrl = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    const edgeURL = `${supabaseUrl}/functions/v1/coupang-vision`;
    console.log('[coupang-entry] Supabase Edge Function 요청 URL:', edgeURL);
    const res = await fetch(edgeURL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`
      },
      signal:AbortSignal.timeout(120000),
      body: JSON.stringify({ model, mediaType, imageBase64: base64, prompt: PROMPT })
    });
    const responseText = await res.text();
    console.log('[coupang-entry] Edge Function HTTP Status:', res.status, res.statusText);
    console.log('[coupang-entry] Edge Function 원본 response body:', responseText);
    let data = null;
    try { data = responseText ? JSON.parse(responseText) : null; }
    catch (err) {
      console.error('[coupang-entry] Edge Function JSON.parse 실패:', err);
      console.error('[coupang-entry] stack:', err instanceof Error ? err.stack : '(stack 없음)');
      throw new Error(`Edge Function 응답 JSON 파싱 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
    console.log('[coupang-entry] Edge Function 파싱된 응답:', data);
    if (!res.ok || data?.error) {
      const detail = data?.responseText || data?.rawBody || data?.error || responseText || `${res.status} ${res.statusText}`;
      const err = new CoupangVisionError(`Edge Function 실패 (${res.status}): ${data?.error || res.statusText}`);
      err.detail = detail;
      err.edge = data;
      throw err;
    }
    if (typeof data?.text === 'string' && data.text.trim()) {
      console.log('[coupang-entry] Edge Function provider:', data.provider || '(unknown)');
      return data.text;
    }
    throw new Error('Edge Function 응답에 text가 없습니다.');
  }

  export async function fileToBase64(file: File) { const buf = await file.arrayBuffer(); let binary = ''; new Uint8Array(buf).forEach(b => { binary += String.fromCharCode(b); }); return btoa(binary); }

let credentials;
export async function saveCourseCapture(
  job,
  course,
  worker,
  png,
  fetcher = fetch,
) {
  const ref = process.env.SUPABASE_PROJECT_REF,
    token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!/^[a-z]{20}$/.test(ref || '') || !token)
    throw Error('캡처 저장 서버 설정 확인 필요');
  if (!png?.length || png.length > 2097152)
    throw Error('캡처 이미지 크기 확인 필요');
  if (!credentials) {
    const r = await fetcher(
      `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
      {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!r.ok) throw Error('캡처 저장 인증 확인 필요');
    const keys = await r.json();
    credentials = keys.find((k) => k.name === 'service_role')?.api_key;
    if (!credentials) throw Error('캡처 저장 서버 키 확인 필요');
  }
  const path = `${job.owner_id}/${job.id}/${worker}/${course.id}.png`;
  const r = await fetcher(
    `https://${ref}.supabase.co/storage/v1/object/naver-course-captures/${path}`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + credentials,
        apikey: credentials,
        'Content-Type': 'image/png',
        'x-upsert': 'true',
      },
      body: png,
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok) throw Error('캡처 파일 저장 실패');
  return path;
}

export async function removeCourseCaptures(paths, fetcher = fetch) {
  if (!paths.length) return;
  if (!credentials) throw Error('캡처 정리 인증 확인 필요');
  const r = await fetcher(
    `https://${process.env.SUPABASE_PROJECT_REF}.supabase.co/storage/v1/object/naver-course-captures`,
    {
      method: 'DELETE',
      headers: {
        Authorization: 'Bearer ' + credentials,
        apikey: credentials,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prefixes: paths }),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok) throw Error('검증용 캡처 정리 실패');
}

import {createHash} from 'node:crypto';
let credentials;
export async function saveCourseCapture(
  job,
  course,
  worker,
  png,
  fetcher = fetch,
  {sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),checkActive=async()=>{}} = {},
) {
  const ref = process.env.SUPABASE_PROJECT_REF,
    token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!/^[a-z]{20}$/.test(ref || '') || !token)
    throw Error('캡처 저장 서버 설정 확인 필요');
  if (!png?.length || png.length > 2097152)
    throw Error('캡처 이미지 크기 확인 필요');
  const request=async(url,options)=>{
    for(let attempt=0;;attempt++){
      await checkActive();let response;
      try{response=await fetcher(url,{...options,signal:AbortSignal.timeout(options.method==='POST'?30000:20000)});}
      catch{if(attempt>=2)throw Object.assign(Error('캡처 저장 서버 응답을 확인하지 못했습니다.'),{code:'CAPTURE_STORAGE_UNAVAILABLE'});}
      if(response&&(![429,502,503,504].includes(response.status)||attempt>=2))return response;
      await sleep(500*2**attempt);
    }
  };
  if (!credentials) {
    const r = await request(
      `https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`,
      {
        headers: { Authorization: 'Bearer ' + token },
        signal: AbortSignal.timeout(20000),
      },
    );
    if (!r.ok) throw Object.assign(Error([401,403].includes(r.status)?'캡처 저장 인증 확인 필요':'캡처 저장 서버 응답 오류: HTTP '+r.status),{code:'CAPTURE_STORAGE_UNAVAILABLE',httpStatus:r.status});
    const keys = await r.json();
    credentials = keys.find((k) => k.name === 'service_role')?.api_key;
    if (!credentials) throw Error('캡처 저장 서버 키 확인 필요');
  }
  const path = `${job.owner_id}/${job.id}/${course.id}/${createHash('sha256').update(png).digest('hex')}.png`;
  const r = await request(
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
  if (!r.ok) throw Object.assign(Error('캡처 파일 저장 응답 오류: HTTP '+r.status),{code:'CAPTURE_STORAGE_UNAVAILABLE',httpStatus:r.status});
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

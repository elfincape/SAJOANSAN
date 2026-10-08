export function notionError(message,status=502,code='notion_error',extra={}) {
  return Object.assign(new Error(message),{status,code,extra});
}
export function notionClient(env,fetcher=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms))) {
  let last=0;
  return async(path,method='GET',body) => {
    if(Date.now()-last<400) await wait(400-(Date.now()-last));
    last=Date.now();
    let response;
    try {
      response=await fetcher('https://api.notion.com/v1/'+path,{
        method,headers:{Authorization:'Bearer '+env.NOTION_API_TOKEN.trim(),'Notion-Version':'2026-03-11',
          'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)
      });
    } catch {
      throw notionError('Notion 응답을 확인하지 못했습니다. 다시 시도해 주세요.',504,'notion_unreachable',
        {uncertainWrite:method==='PATCH'||path==='pages'});
    }
    if(!response.ok) {
      const messages={401:'Notion 토큰을 확인해 주세요.',403:'Notion 연결의 콘텐츠 읽기·쓰기·삽입 권한을 확인해 주세요.',
        404:'보건증 갱신 목록의 연결 권한과 데이터 소스 ID를 확인해 주세요.',
        429:'Notion 요청 제한입니다. 잠시 후 다시 시도해 주세요.'};
      throw notionError(messages[response.status] || 'Notion 요청에 실패했습니다. 다시 시도해 주세요.',502,
        'notion_'+response.status,{uncertainWrite:response.status>=500 && (method==='PATCH'||path==='pages')});
    }
    const result=await response.json().catch(()=>null);
    if(!result) throw notionError('Notion 응답을 확인할 수 없습니다.',502,'notion_invalid_response',
      {uncertainWrite:method==='PATCH'||path==='pages'});
    return result;
  };
}

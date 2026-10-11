export const HAIKU_MODEL='claude-haiku-4-5-20251001';
export async function callHaiku({key,prompt,maxTokens=2400,timeoutMs=45000,fetcher=fetch}){
 if(!key)throw Object.assign(new Error('AI 서버 설정이 필요합니다.'),{code:'AI_NOT_CONFIGURED',status:503});
 const response=await fetcher('https://aiapiflow.com/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:HAIKU_MODEL,max_tokens:maxTokens,messages:[{role:'user',content:prompt}]}),signal:AbortSignal.timeout(timeoutMs)});
 if(!response.ok)throw Object.assign(new Error(response.status===429?'AI 요청이 많습니다. 잠시 후 다시 시도해 주세요.':'AI 응답을 생성하지 못했습니다.'),{code:response.status===429?'RATE_LIMITED':'MODEL_FAILED',status:response.status===429?429:502});
 return response.json();
}

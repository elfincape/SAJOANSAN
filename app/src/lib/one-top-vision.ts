import {DEFAULT_MODEL,OPUS_FALLBACK_MODEL,API_INTERVAL_MS,API_RATE_RETRY_DELAYS,PROMPT} from '../domain/one-top-config';
import {normalizeApiResult} from '../domain/one-top';
import {prepareVisionImage} from '../domain/one-top-images';
type Progress=(message:string)=>void;
class VisionError extends Error {code?:string;status?:number}
  export async function analyzeReceiptWithFallback(dataUrl:string,index:number,total:number,requestedModel:string,defaultDate:string,progress:Progress) {
    try {
      const result=normalizeApiResult(await callVisionWithRateLimitRetry(dataUrl,index,total,requestedModel,progress),defaultDate);
      return {result,model:requestedModel};
    } catch(err) {
      if(requestedModel!==DEFAULT_MODEL||!isVisionNoResponseError(err))throw err;
      console.warn('[one-top-two-room] Haiku 무응답 · Opus 5 자동 요청',err);
    }
    await waitForApiSlot(API_INTERVAL_MS,index,total,progress,'Haiku 무응답 · Opus 5 자동 요청');
    const result=normalizeApiResult(await callVisionWithRateLimitRetry(dataUrl,index,total,OPUS_FALLBACK_MODEL,progress),defaultDate);
    return {result,model:OPUS_FALLBACK_MODEL};
  }

  function isVisionNoResponseError(err:unknown){return (err as VisionError)?.code==='VISION_NO_RESPONSE';}

  async function callVisionWithRateLimitRetry(dataUrl:string,index:number,total:number,model:string,progress:Progress) {
    for(let attempt=0;;attempt++){
      try{return await callVision(dataUrl,model);}
      catch(err){if(!isRateLimitError(err)||attempt>=API_RATE_RETRY_DELAYS.length)throw err;await waitForApiSlot(API_RATE_RETRY_DELAYS[attempt],index,total,progress,'API 요청 제한 · 자동 재시도');}
    }
  }

  function isRateLimitError(err:unknown){const value=err as VisionError;return value?.status===429||/requests-per-minute|rate.?limit|too many requests/i.test(String(value?.message||err));}
  export async function waitForApiSlot(ms:number,index:number,total:number,progress:Progress,label='API 요청 간격 대기') { for(let left=Math.ceil(ms/1000);left>0;left--){progress(`${index}/${total} · ${label} ${left}초`);await new Promise(resolve=>setTimeout(resolve,1000));} }

  async function callVision(dataUrl:string,model=DEFAULT_MODEL) {
    const edgeURL = `${String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/,'')}/functions/v1/coupang-vision`;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
    // Excel 삽입/DB 임시저장에는 원본을 유지하고 API 요청 사본만 축소한다.
    const visionDataUrl=await prepareVisionImage(dataUrl);
    const [meta,base64] = visionDataUrl.split(','); const mediaType = meta.match(/^data:([^;]+)/)?.[1] || 'image/jpeg';
    let res;
    try { res=await fetch(edgeURL,{ method:'POST', headers:{'content-type':'application/json',apikey:anonKey,authorization:`Bearer ${anonKey}`}, body:JSON.stringify({model,mediaType,imageBase64:base64,prompt:PROMPT}) }); }
    catch(cause) { const err=new VisionError(`${model} API가 응답하지 않았습니다.`);err.code='VISION_NO_RESPONSE';err.cause=cause;throw err; }
    const raw=await res.text(); let payload;
    try { payload=raw?JSON.parse(raw):null; } catch { throw new VisionError('API 응답 JSON을 읽지 못했습니다.'); }
    if (!res.ok || payload?.error) { const err=new VisionError(payload?.error || `API HTTP ${res.status}`); err.status=Number(payload?.status)||res.status; throw err; }
    const modelText=String(payload?.text||'').trim();
    if(!modelText){const err=new VisionError(`${model}이 응답 내용을 반환하지 않았습니다.`);err.code='VISION_NO_RESPONSE';throw err;}
    try { return JSON.parse(extractJsonObject(modelText)); }
    catch(error) { const err=error instanceof VisionError?error:new VisionError(error instanceof Error?error.message:String(error));err.code='VISION_JSON_INVALID';throw err; }
  }

  function extractJsonObject(text:string) {
    const clean=String(text||'').replace(/```(?:json)?/gi,'').replace(/```/g,'').trim();
    const start=clean.indexOf('{'), end=clean.lastIndexOf('}');
    if (start<0 || end<start) throw new Error('API 응답에서 JSON 객체를 찾지 못했습니다.');
    return clean.slice(start,end+1);
  }


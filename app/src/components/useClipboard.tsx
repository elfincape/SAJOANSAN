import { useEffect, useRef, useState } from 'react';
interface CopyRequest { text:string; resolve:()=>void; reject:(error:Error)=>void }
export function useClipboard(){
 const [request,setRequest]=useState<CopyRequest|null>(null),input=useRef<HTMLTextAreaElement>(null),handled=useRef<CopyRequest|null>(null);
 useEffect(()=>{if(!request||!input.current||handled.current===request)return;handled.current=request;input.current.select();try{if(!document.execCommand('copy'))throw new Error('브라우저가 복사를 허용하지 않았습니다.');request.resolve();}catch(error){request.reject(error instanceof Error?error:new Error(String(error)));}setRequest(null);},[request]);
 async function copy(text:string){if(navigator.clipboard?.writeText&&window.isSecureContext){await navigator.clipboard.writeText(text);return;}return new Promise<void>((resolve,reject)=>setRequest({text,resolve,reject}));}
 return {copy,clipboard:request?<textarea ref={input} readOnly value={request.text} style={{position:'fixed',left:'-9999px',top:0}}/>:null};
}

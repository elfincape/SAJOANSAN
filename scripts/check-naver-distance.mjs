import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,rm} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF;
if(!/^[a-z]{20}$/.test(ref||'')||!process.env.SUPABASE_ACCESS_TOKEN)throw Error('Missing Supabase deployment settings');
// Temporary, unpredictable probe accepts only a fixed public-address test and never reads user data.
const token=randomBytes(32).toString('hex'),name='naver-fuel-probe-'+randomBytes(6).toString('hex'),dir=new URL('../supabase/functions/'+name+'/',import.meta.url);
const addresses=['경기도 평택시 경기대로 245','경기도 오산시 성호대로 141','경기도 수원시 팔달구 효원로 241','경기도 성남시 중원구 성남대로 997','경기도 용인시 처인구 중부대로 1199','경기도 안성시 시청길 25','경기도 안산시 단원구 화랑로 387'];
await mkdir(dir,{recursive:true});
await writeFile(new URL('provider.js',dir),await readFile(new URL('../supabase/functions/naver-distance/provider.js',import.meta.url),'utf8'));
await writeFile(new URL('index.ts',dir),`import {calculateNaverRoute} from './provider.js';
Deno.serve(async req=>{
 if(req.method!=='POST'||req.headers.get('x-fuel-probe')!==${JSON.stringify(token)})return new Response('Unauthorized',{status:401});
 try{
  const base={origin:'경기도 평택시 산단로 263',priority:'RECOMMEND'},stops=${JSON.stringify(addresses)}.map(address=>({address}));
  const five=await calculateNaverRoute({...base,stops:stops.slice(0,2)},Deno.env.toObject());
  const fifteen=await calculateNaverRoute({...base,stops},Deno.env.toObject());
  return Response.json({five:{usage:five.usage,distances:five.sections.map(s=>s.distanceMeters)},fifteen:{usage:fifteen.usage,distances:fifteen.sections.map(s=>s.distanceMeters)}});
 }catch(e){return Response.json({error:e.status?e.message:'Naver probe connection failed'},{status:e.status||502});}
});`);
let deployed=false;
try{
 execFileSync('supabase',['functions','deploy',name,'--project-ref',ref,'--no-verify-jwt'],{stdio:'pipe'});deployed=true;
 let response;
 for(let attempt=0;attempt<3;attempt++){
  response=await fetch('https://'+ref+'.supabase.co/functions/v1/'+name,{method:'POST',headers:{'x-fuel-probe':token},signal:AbortSignal.timeout(180000)});
  if(response.status!==404)break;await new Promise(resolve=>setTimeout(resolve,2000));
 }
 const data=await response.json();
 if(!response.ok)throw Error('Naver live probe failed: '+(data.error||response.status));
 if(data.five?.usage?.directions5!==1||data.fifteen?.usage?.directions15!==1||data.five.distances.length!==2||data.fifteen.distances.length!==7)throw Error('Naver live route/segment validation failed');
 console.log('Naver live Geocoding, Directions 5 and Directions 15 verified: '+JSON.stringify(data));
}finally{
 if(deployed)execFileSync('supabase',['functions','delete',name,'--project-ref',ref,'--yes'],{stdio:'pipe'});
 await rm(dir,{recursive:true,force:true});
}

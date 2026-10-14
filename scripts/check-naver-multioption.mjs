import {randomBytes} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,rm} from 'node:fs/promises';
const ref=process.env.SUPABASE_PROJECT_REF;
if(!/^[a-z]{20}$/.test(ref||'')||!process.env.SUPABASE_ACCESS_TOKEN)throw Error('Missing Supabase deployment settings');
const token=randomBytes(32).toString('hex'),name='naver-options-probe-'+randomBytes(6).toString('hex'),dir=new URL('../supabase/functions/'+name+'/',import.meta.url);
await mkdir(dir,{recursive:true});
await writeFile(new URL('index.ts',dir),`Deno.serve(async req=>{
 if(req.method!=='POST'||req.headers.get('x-fuel-probe')!==${JSON.stringify(token)})return new Response('Unauthorized',{status:401});
 try{
  const headers={'x-ncp-apigw-api-key-id':Deno.env.get('NAVER_MAPS_CLIENT_ID'),'x-ncp-apigw-api-key':Deno.env.get('NAVER_MAPS_CLIENT_SECRET')};
  const params=new URLSearchParams({start:'127.1058342,37.359708',goal:'129.0759854,35.1794698',option:'traoptimal:trafast:tracomfort'}),results=[];
  for(const api of ['map-direction','map-direction-15']){
   const r=await fetch('https://maps.apigw.ntruss.com/'+api+'/v1/driving?'+params,{headers,signal:AbortSignal.timeout(60000)});
   const data=await r.json();if(!r.ok||data.code!==0)throw Error('Multi-option request failed: '+r.status);
   const routes=Object.fromEntries(['traoptimal','trafast','tracomfort'].map(option=>[option,data.route?.[option]?.[0]?.summary?.distance]));
   if(Object.values(routes).some(value=>!Number.isFinite(value)||value<=0))throw Error('Missing option routes');
   results.push({api,httpRequests:1,routes});
  }
  return Response.json({results});
 }catch(e){return Response.json({error:e.message},{status:502});}
});`);
let deployed=false;
try{
 execFileSync('supabase',['functions','deploy',name,'--project-ref',ref,'--no-verify-jwt'],{stdio:'pipe'});deployed=true;
 const r=await fetch('https://'+ref+'.supabase.co/functions/v1/'+name,{method:'POST',headers:{'x-fuel-probe':token},signal:AbortSignal.timeout(150000)});
 const data=await r.json();if(!r.ok)throw Error(data.error||'Naver multi-option probe failed');
 console.log('Exactly one 3-option request per Directions API: '+JSON.stringify(data));
}finally{
 if(deployed)execFileSync('supabase',['functions','delete',name,'--project-ref',ref,'--yes'],{stdio:'pipe'});
 await rm(dir,{recursive:true,force:true});
}

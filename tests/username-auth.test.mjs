import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
import {makeHandler} from '../supabase/functions/username-auth/handler.js';
import {signInWithUsername,validUsername} from '../repo-root/js/username-auth.js';
assert(validUsername('AnsAn01'));assert(validUsername('평택담당자'));assert(!validUsername('a@b'));assert(!validUsername('ab'));
let emailCalled,sessionSet,bodyCalled;
const browser={auth:{
 signInWithPassword:async b=>{emailCalled=b;return {data:{user:{id:'old'}}};},
 setSession:async b=>{sessionSet=b;return {data:{user:{id:'new'}}};}
},functions:{invoke:async (name,{body})=>{bodyCalled=body;return {data:{session:{access_token:'access',refresh_token:'refresh'}}};}}};
assert.equal((await signInWithUsername(browser,'old@example.com','pwd')).data.user.id,'old');
assert.equal(emailCalled.email,'old@example.com');
assert.equal((await signInWithUsername(browser,'AnsAn01','pwd')).data.user.id,'new');
assert.equal(bodyCalled.username,'ansan01');assert.equal(sessionSet.access_token,'access');
assert((await signInWithUsername(browser,'ab','pwd')).error);
let lookupEmail='old@example.com',permit=true,actor={role:'admin',active:true},existing=null,grantError=false,saveError=null,removed=false;
let grant,profile,queried,keys;
const admin={
 rpc:async(name,args)=>{if(name==='account_login_attempt'){keys=args.p_keys;return {data:permit};}return {data:lookupEmail};},
 from:()=>({select:()=>({eq:(col,val)=>{queried={col,val};return {maybeSingle:async()=>({data:col==='id'?actor:existing})};}}),
 upsert:p=>{profile=p;return {select:()=>({single:async()=>({data:p,error:saveError})})};}}),
 auth:{getUser:async()=>({data:{user:{id:'admin'}}}),admin:{
  createUser:async b=>{assert.equal(b.email_confirm,true);return {data:{user:{id:'new-user'}}};},
  deleteUser:async()=>{removed=true;}
 }}
};
const auth={auth:{signInWithPassword:async b=>{grant=b;return grantError?{error:{}}:{data:{session:{access_token:'a',refresh_token:'r'}}};}}};
const handler=makeHandler({SUPABASE_URL:'url',SUPABASE_SERVICE_ROLE_KEY:'service',SUPABASE_ANON_KEY:'anon'},(url,key)=>key==='service'?admin:auth);
const call=async(body,origin='https://sajoansan.vercel.app')=>handler(new Request('https://example.test',{method:'POST',headers:{origin,'content-type':'application/json',authorization:'Bearer test'},body:JSON.stringify(body)}));
let r=await call({action:'login',username:'AnsAn01',password:'secret'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{session:{access_token:'a',refresh_token:'r'}});
assert.equal(grant.email,'old@example.com');assert(keys.every(x=>/^[a-f0-9]{64}$/.test(x)));
lookupEmail=null;r=await call({action:'login',username:'missing',password:'secret'});assert.equal(r.status,401);assert.equal((await r.json()).error,'아이디 또는 비밀번호가 올바르지 않습니다.');
lookupEmail='old@example.com';grantError=true;r=await call({action:'login',username:'ansan01',password:'wrong'});assert.equal(r.status,401);grantError=false;
permit=false;assert.equal((await call({action:'login',username:'ansan01',password:'secret'})).status,429);permit=true;
assert.equal((await call({action:'login',username:'ansan01',password:'secret'},'https://evil.test')).status,403);
actor={role:'editor',active:true};assert.equal((await call({action:'create',username:'newuser',password:'password123',role:'editor'})).status,403);
actor={role:'admin',active:true};existing={id:'old'};assert.equal((await call({action:'create',username:'newuser',password:'password123',role:'editor'})).status,409);
assert.deepEqual(queried,{col:'username',val:'newuser'});existing=null;
assert.equal((await call({action:'create',username:'newuser',password:'short',role:'editor'})).status,400);
r=await call({action:'create',username:'평택담당자',password:'password123',role:'editor',display_name:'담당자'});assert.equal(r.status,200);assert.equal(profile.username,'평택담당자');assert(!('password' in profile));
saveError={code:'23505'};assert.equal((await call({action:'create',username:'newuser',password:'password123',role:'editor'})).status,409);assert(removed);
const sql=fs.readFileSync(new URL('../repo-root/sql/username-accounts.sql',import.meta.url),'utf8');
assert(sql.includes('lower(username)'));assert(sql.includes('revoke all on function public.account_login_email(text) from public,anon,authenticated'));
for(const path of ['../repo-root/login.html','../repo-root/admin/users.html']){
 const html=fs.readFileSync(new URL(path,import.meta.url),'utf8');const script=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
 assert(script.includes('username-auth.js'));

}
console.log('Username login, legacy email login, session persistence, admin creation, rollback, duplicate IDs, rate limit and origin checks passed');

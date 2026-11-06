import assert from 'node:assert/strict';
import {permissionAllowed,effectivePermission,centerEditResources} from '../repo-root/js/portal-permissions.js';
const context={access:{tasks:{read:true,edit:false,read_centers:['001'],edit_centers:[]},forms:{read:true,edit:true,read_centers:['001','002'],edit_centers:['002']}}};
assert.equal(permissionAllowed(context,'tasks','read','001'),true);
assert.equal(permissionAllowed(context,'tasks','read','002'),false);
assert.equal(permissionAllowed(context,'tasks','edit','001'),false);
assert.equal(permissionAllowed(context,'forms','edit','001'),false);
assert.equal(permissionAllowed(context,'forms','edit','002'),true);
assert.equal(permissionAllowed(context,'members'),false);
assert.equal(permissionAllowed(null,'tasks'),false);
const writable={access:{tasks:{read:false,edit:true,read_centers:[],edit_centers:['001']}}};
assert.equal(permissionAllowed(writable,'tasks','read'),true);
assert.equal(permissionAllowed(writable,'tasks','read','001'),true);
assert.equal(permissionAllowed(writable,'tasks','read','002'),false);
assert.equal(permissionAllowed(writable,'tasks','delete'),false);
console.log('PASS: separate read/edit, no global fallback across centers, unknown/missing permissions deny access');

const rule={everyone:true,roles:[],centers:[],scope:'all'};
const config={resource:'drivers',read_rule:rule,write_rule:rule};
const editor={role:'editor',active:true,centers:['002']};
assert.deepEqual(effectivePermission(config,editor,'002'),{read:true,edit:true});
assert.deepEqual(effectivePermission(config,editor,'001'),{read:true,edit:false});
assert.deepEqual(effectivePermission(config,{...editor,centers:[]},'002'),{read:true,edit:false});
assert.deepEqual(effectivePermission(config,{...editor,role:'viewer'},'002'),{read:true,edit:false});
assert.deepEqual(effectivePermission(config,{...editor,active:false},'002'),{read:false,edit:false});
assert.deepEqual(effectivePermission({...config,admin_only:true},editor,'002'),{read:false,edit:false});
assert.deepEqual(effectivePermission({...config,admin_only:true},{...editor,role:'admin',centers:[]},'001'),{read:true,edit:true});
for(const resource of centerEditResources)assert.equal(effectivePermission({...config,resource},editor,'001').edit,false,resource);
for(const resource of ['incidents','notifications'])assert.equal(effectivePermission({...config,resource},{...editor,role:'viewer'},'001').edit,true,resource);
const scoped={...config,read_rule:{...rule,scope:'own'},write_rule:{...rule,scope:'own'}};
assert.deepEqual(effectivePermission(scoped,editor,'001'),{read:false,edit:false});
assert.deepEqual(effectivePermission(scoped,editor,'002'),{read:true,edit:true});
const centerCondition={...config,read_rule:{everyone:false,roles:[],centers:['002'],scope:'all'},write_rule:{everyone:false,roles:[],centers:[],scope:'all'}};
assert.equal(effectivePermission(centerCondition,editor,'001').read,true);
assert.equal(effectivePermission(centerCondition,{...editor,centers:['001']},'002').read,false);
console.log('PASS: active state, role, center membership, audience vs data scope, admin-only and status-only exceptions');

// Exercise the real browser auth cache across permission refresh and logout races.
{
 const {stripTypeScriptTypes}=await import('node:module'),{default:vm}=await import('node:vm'),{readFileSync}=await import('node:fs');
 const code=stripTypeScriptTypes(readFileSync(new URL('../app/src/lib/auth.ts',import.meta.url),'utf8')).replace(/^import .*;$/gm,'').replace(/\bexport /g,'')+'\nglobalThis.exports={loadAuthContext,getLoadedAuthContext,signOut};';
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
 function mountAuth(){
  const snapshots=[];let profileId='synthetic-user';
  const supabase={auth:{getSession:async()=>({data:{session:{user:{id:profileId}}}}),getUser:async()=>({data:{user:{id:profileId}}}),signOut:async()=>{}},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{id:profileId,role:'editor',active:true}})})})}),rpc:()=>{const response=deferred();snapshots.push(response);return response.promise;}};
  const context={supabase,clearSelectedCenter(){},location:{replace(){}},console};vm.runInNewContext(code,context);
  return {auth:context.exports,snapshots};
 }
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 const first=mountAuth(),old=first.auth.loadAuthContext();await tick();
 const refreshed=first.auth.loadAuthContext(true);await tick();
 assert.equal(first.snapshots.length,2,'forced refresh must request the current permission snapshot while an older request is pending');
 first.snapshots[1].resolve({data:{access:{drivers:{read:true,edit:true}}}});
 assert.equal((await refreshed).permissions.access.drivers.edit,true);
 first.snapshots[0].resolve({data:{access:{drivers:{read:true,edit:false}}}});
 assert.equal(await old,null,'superseded permission result must not be returned to an older caller');
 assert.equal(first.auth.getLoadedAuthContext().permissions.access.drivers.edit,true,'late stale response must not overwrite current permissions');
 const logout=mountAuth(),loading=logout.auth.loadAuthContext();await tick();await logout.auth.signOut();
 logout.snapshots[0].resolve({data:{access:{drivers:{read:true,edit:true}}}});
 assert.equal(await loading,null,'request started before logout must not restore an authenticated context');
 assert.equal(logout.auth.getLoadedAuthContext(),undefined,'logout must keep the auth cache empty after an old request finishes');
 console.log('PASS browser permission cache: forced refresh supersedes old requests and logout rejects late responses');
}

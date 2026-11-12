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

const catalog = {access:{routes:{read:true,edit:true,read_centers:['001'],edit_centers:['001'],read_unclassified:true,edit_unclassified:false}}};
assert.equal(permissionAllowed(catalog,'routes','read','unclassified'),true);
assert.equal(permissionAllowed(catalog,'routes','edit','unclassified'),false);

if (process.env.PGLITE_MODULE) {
 const {PGlite}=await import(process.env.PGLITE_MODULE), {readFileSync}=await import('node:fs');
 const db=new PGlite(), sql=name=>readFileSync(new URL('../repo-root/sql/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 try {
  await db.exec(`create role authenticated; create role anon; create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table user_profiles(id uuid primary key,role text,active boolean);
   create table centers(code text primary key,name text,active boolean default true);
   create table operations_center_members(user_id uuid,center_code text);
   create table operations_permissions(resource text primary key,admin_only boolean default false,read_rule jsonb,write_rule jsonb,member_overrides jsonb default '{}',section text,title text);
   create function is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from user_profiles where id=auth.uid() and active and role='admin')$$;
   create function operations_can_read() returns boolean language sql stable security definer as $$select exists(select 1 from user_profiles where id=auth.uid() and active)$$;
   create table companies(id uuid primary key,name text,center_code text);
   create table drivers(id uuid primary key,name text,phone text,center_code text);
   create table vehicles(id uuid primary key,plate_number text,tonnage numeric,pallet_capacity numeric,center_code text);
   create table routes(id uuid primary key,name text,car_number text,active boolean,center_code text,company_id uuid,primary_driver_id uuid references drivers,secondary_driver_id uuid,primary_vehicle_id uuid,secondary_vehicle_id uuid);
   create table delivery_points(id uuid primary key,code text,name text,address text,region text,contact text,contact_name text,memo text,center_code text,
     allow_under_1ton boolean,allow_under_3_5ton boolean,allow_over_5ton boolean,allow_unmanned_yard boolean,deadline_text text,deadline_business_min integer,
     delivery_method text,access_method text,delivery_location text,security_key_location text,security_password text);
   create table route_stops(id uuid primary key,route_id uuid references routes,delivery_point_id uuid references delivery_points,stop_order integer,
     arrival_text text,arrival_business_min integer,unloading_start_text text,unloading_start_business_min integer,unloading_end_text text,unloading_end_business_min integer,
     deadline_text text,deadline_business_min integer,override_delivery_method text,override_access_method text,override_delivery_location text,memo text,
     created_at timestamptz default now(),updated_at timestamptz default now(),unique(route_id,stop_order));
   insert into user_profiles values('${id(1)}','admin',true),('${id(2)}','editor',true),('${id(3)}','viewer',true),('${id(4)}','admin',false);
   insert into centers values('001','안산',true),('002','평택',true);
   insert into operations_center_members values('${id(2)}','001');
   insert into operations_permissions(resource,read_rule,write_rule) select x,'{"everyone":true,"scope":"own"}','{"everyone":true,"scope":"own"}' from unnest(array['routes','delivery_points','drivers','vehicles','companies']) x;
   insert into drivers(id,name,center_code) values('${id(30)}','격리 기사','002');
   insert into routes(id,name,center_code,primary_driver_id) values('${id(10)}','격리 안산','001','${id(30)}'),('${id(11)}','격리 평택','002',null),('${id(12)}','격리 미분류',null,null);
   insert into delivery_points(id,name,address,center_code,delivery_method,access_method,deadline_business_min,allow_over_5ton) values('${id(20)}','격리 공유','원주소','002','대면','보안키',0,false);
   insert into route_stops(id,route_id,delivery_point_id,stop_order) values('${id(40)}','${id(10)}','${id(20)}',1),('${id(41)}','${id(11)}','${id(20)}',1);`);
  const base=sql('operations-permissions.sql');
  for(const name of ['operations_permission_match','operations_permission_for_actor','operations_resource_allowed']) {
   const definition=base.match(new RegExp('create(?: or replace)? function public\\.'+name+'\\([\\s\\S]*?as (\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;','i'))[0];
   await db.exec(definition);
  }
  await db.exec(sql('legacy-common-catalog.sql'));
  for(const table of ['routes','delivery_points','drivers','vehicles','companies','route_stops']) {
   const resource=table==='route_stops'?'routes':table;
   const center=table==='route_stops'?"(select coalesce(center_code,'') from routes where id=route_stops.route_id)":"coalesce(center_code,'')";
   await db.exec(`alter table ${table} enable row level security;
    create policy read_access on ${table} for select to authenticated using(operations_resource_allowed('${resource}','read',${center}));
    create policy update_access on ${table} for update to authenticated using(operations_resource_allowed('${resource}','edit',${center})) with check(operations_resource_allowed('${resource}','edit',${center}));
    create policy insert_access on ${table} for insert to authenticated with check(operations_resource_allowed('${resource}','edit',${center}));
    create policy delete_access on ${table} for delete to authenticated using(operations_resource_allowed('${resource}','edit',${center}));`);
  }
  await db.exec(`grant usage on schema public,auth to authenticated;grant select on all tables in schema public to authenticated;
   create table charter_trips(id text);create table charter_archives(id text);
   create table onedrive_uploads(status text,expiry_erp_saved boolean,document_expiry date);
   create function save_pyeongtaek_dispatch_profiles(jsonb) returns void language sql as $$select$$;
   revoke all on function save_pyeongtaek_dispatch_profiles(jsonb) from public;
   create function fixture_frozen() returns trigger language plpgsql as $$begin raise exception 'frozen';end$$;
   create trigger ean_catalog_frozen before insert or update or delete on routes for each row execute function fixture_frozen();
   create trigger ean_catalog_no_truncate before truncate on routes for each statement execute function fixture_frozen();
   insert into onedrive_uploads values('committed',false,'2026-12-31');`);
  await assert.rejects(db.exec(sql('legacy-common-catalog-activate.sql')),/pending document/);
  await db.exec('rollback;delete from onedrive_uploads;');
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='ean_catalog_frozen'")).rows[0].n,1,'failed activation keeps the old write fence');
  await db.exec(sql('legacy-common-catalog-activate.sql'));
  assert.equal((await db.query("select has_table_privilege('authenticated','drivers','UPDATE') ok")).rows[0].ok,true);
  assert.equal((await db.query("select has_table_privilege('authenticated','drivers','DELETE') ok")).rows[0].ok,false,'originals stay soft-delete only');
  assert.equal((await db.query("select has_table_privilege('anon','drivers','UPDATE') ok")).rows[0].ok,false);
  assert.equal((await db.query("select count(*)::int n from pg_trigger where tgname='ean_catalog_no_truncate'")).rows[0].n,1);
  const actor=async n=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`);
  await actor(1);
  assert.equal((await db.query('select count(*)::int n from routes')).rows[0].n,3,'OP includes unclassified');
  const view=(await db.query('select * from course_view order by stop_id')).rows;
  assert.equal(view.length,2,'shared cross-attribute destination remains linked');
  assert.equal(view[0].primary_driver_name,'격리 기사','driver attribute is independent');
  assert.equal(view[0].effective_deadline_business_min,0);
  assert.equal(view[0].allow_over_5ton,false);
  await db.exec(`update delivery_points set address='공통 수정' where id='${id(20)}'`);
  assert.equal((await db.query("select count(*)::int n from course_view where dp_address='공통 수정'")).rows[0].n,2);
  const snapshot=async r=>(await db.query('select * from route_stops where route_id=$1 order by stop_order',[id(r)])).rows;
  const old=await snapshot(10), changed=old.map(s=>({...s,condition_modes:{delivery_method:'clear',access_method:'set'},override_access_method:''}));
  const save=(r,expected,next)=>db.query('select legacy_save_route_stops($1,$2,$3) result',[id(r),JSON.stringify(expected),JSON.stringify(next)]);
  await save(10,old,changed); await save(10,old,changed);
  let current=(await db.query('select * from course_view order by stop_id')).rows;
  assert.equal(current[0].delivery_method,null);assert.equal(current[0].access_method,'');assert.equal(current[1].delivery_method,'대면');
  await assert.rejects(save(10,old,changed.map(s=>({...s,memo:'stale'}))),/다른 작업/);
  const before=await snapshot(10);
  await assert.rejects(save(10,before,[...before.map(s=>({...s,stop_order:2})),{...before[0],id:id(42),delivery_point_id:id(999),stop_order:1}]),/foreign key/);
  assert.deepEqual(await snapshot(10),before,'failure rolls back temporary ordering and partial rows');
  await db.exec(`update drivers set deleted_at=now() where id='${id(30)}'`);
  assert.equal((await db.query(`select primary_driver_id from routes where id='${id(10)}'`)).rows[0].primary_driver_id,id(30));
  await assert.rejects(db.exec(`delete from drivers where id='${id(30)}'`),/연결은 보존|permission denied/);
  await actor(2);
  assert.equal((await db.query('select count(*)::int n from routes')).rows[0].n,1);
  assert.equal((await db.query('select count(*)::int n from delivery_points')).rows[0].n,0);
  await assert.rejects(save(11,await snapshot(11),[]),/권한/);
  const denied=await db.query(`update routes set name='denied' where id='${id(11)}' returning id`);assert.equal(denied.rows.length,0);
  await db.exec(`reset role;update operations_permissions set member_overrides=jsonb_build_object('${id(2)}',jsonb_build_object('level','none','scope','all')) where resource='routes';set role authenticated;`);
  assert.equal((await db.query('select count(*)::int n from routes')).rows[0].n,0);
  await actor(4);assert.equal((await db.query('select count(*)::int n from routes')).rows[0].n,0);
  // Execute the new cell writer against this same isolated PostgreSQL fixture.
  await db.exec(`reset role; alter table delivery_points add column updated_at timestamptz default now();
    create function cell_test_stamp() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp();return new;end$$;
    create trigger cell_test_stamp before update on delivery_points for each row execute function cell_test_stamp();`);
  await actor(1);
  const {createRequire}=await import('node:module');
  const ts=createRequire(import.meta.url)('../app/node_modules/typescript');
  const cellJs=ts.transpileModule(readFileSync(new URL('../app/src/lib/dashboard-edit.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace(/^import[\s\S]*?;\s*/gm,'').replace(/^export /gm,'');
  let dropResponse=false;
  const quoted=value=>{assert.match(value,/^[a-z_]+$/);return '"'+value+'"';};
  const databaseClient={from(table){
    let patch=null,filters=[],columns='*';
    const q={update(value){patch=value;return q;},eq(key,value){filters.push([key,value]);return q;},is(key,value){assert.equal(value,null);filters.push([key,null]);return q;},select(value){columns=value;return q;},single(){return q;},maybeSingle(){return q;},async then(ok,bad){
      try{
        const args=[],bind=value=>{args.push(value);return '$'+args.length;};
        const set=patch?Object.entries(patch).map(([k,v])=>quoted(k)+'='+bind(v)).join(','):'';
        const where=filters.map(([k,v])=>quoted(k)+(v===null?' is null':'='+bind(v))).join(' and ');
        const selected=columns==='*'?'*':columns.split(',').map(quoted).join(',');
        const sql=patch?`update ${quoted(table)} set ${set} where ${where} returning ${selected}`:`select ${selected} from ${quoted(table)} where ${where}`;
        const result=await db.query(sql,args);
        if(patch&&dropResponse){dropResponse=false;return ok({data:null,error:{message:'isolated lost response'}});}
        return ok({data:result.rows[0]??null,error:null});
      }catch(error){return ok({data:null,error});}
    }};return q;
  }};
  const writer=new Function('supabase','saveRouteStops',cellJs+';return {writeCell};')(databaseClient,async(routeId,expected,next)=>{
    try{return {data:(await db.query('select legacy_save_route_stops($1,$2,$3) result',[routeId,JSON.stringify(expected),JSON.stringify(next)])).rows[0],error:null};}catch(error){return {error};}
  });
  const source=(await db.query('select * from delivery_points where id=$1',[id(20)])).rows[0];
  source.updated_at=new Date(source.updated_at).toISOString();
  const cell={column:'dp_address',scope:'value',table:'delivery_points',id:id(20),source,field:'address',candidates:[]};
  const input={value:'셀에서 저장한 주소',mode:'set',conditions:{}};
  dropResponse=true;
  await assert.rejects(writer.writeCell(cell,input),{message:'isolated lost response'});
  const afterFirst=(await db.query('select updated_at from delivery_points where id=$1',[id(20)])).rows[0].updated_at;
  await writer.writeCell(cell,input);
  assert.deepEqual((await db.query('select updated_at from delivery_points where id=$1',[id(20)])).rows[0].updated_at,afterFirst,'lost-response retry must not write again');
  assert.equal((await db.query("select count(*)::int n from course_view where dp_address='셀에서 저장한 주소'")).rows[0].n,2,'actual cell write appears on both linked routes');
  await assert.rejects(writer.writeCell(cell,{...input,value:'stale overwrite'}),/다른 작업/);
  const stopExpected=await snapshot(10);
  await writer.writeCell({column:'delivery_method',scope:'value',table:'routes',id:id(10),source:{},field:'override_delivery_method',stops:stopExpected,stopId:id(40),candidates:[]},{...input,value:'',mode:'inherit'});
  assert.equal((await db.query('select delivery_method from course_view where stop_id=$1',[id(40)])).rows[0].delivery_method,'대면');
  await db.query('insert into delivery_points(id,name,center_code) values($1,$2,$3)',[id(21),'격리 교체 납품처','001']);
  const replacement={column:'dp_name',scope:'link',table:'routes',id:id(10),source:{},field:'delivery_point_id',stops:await snapshot(10),stopId:id(40),candidates:[{id:id(21),label:'격리 교체 납품처'}]};
  await writer.writeCell(replacement,{...input,value:id(21)});
  assert.equal((await snapshot(10))[0].id,id(40),'replacement preserves stable relationship ID');
  assert.equal((await snapshot(10))[0].delivery_point_id,id(21));
  assert.equal((await snapshot(11))[0].delivery_point_id,id(20),'other course keeps its destination');
  assert.equal((await db.query('select count(*)::int n from delivery_points')).rows[0].n,2,'replacement never deletes the common source');
  await actor(3);
  await assert.rejects(writer.writeCell(cell,{...input,value:'forbidden'}));
  console.log('PASS cell writer + isolated PostgreSQL: persisted shared edit, lost response retry without duplicate write, stale conflict, existing stop RPC, viewer denial');
  console.log('PASS isolated SQL: RLS list/detail/write denial, OP unclassified, shared source, cross-attribute links, clear/empty/0/false, atomic retry/conflict/rollback, deletion reference preservation');
 } finally {await db.close();}
}

const rule={everyone:true,roles:[],centers:[],scope:'all'};
const config={resource:'drivers',read_rule:rule,write_rule:rule};
const editor={role:'editor',active:true,centers:['002']};
assert.deepEqual(effectivePermission(config,editor,'002'),{read:true,edit:true});
assert.deepEqual(effectivePermission(config,editor,'001'),{read:true,edit:true});
assert.deepEqual(effectivePermission(config,{...editor,centers:[]},'002'),{read:true,edit:true});
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

if(process.env.PGLITE_MODULE && !process.env.LEGACY_CATALOG_ONLY){
 const {PGlite}=await import(process.env.PGLITE_MODULE),{readFileSync}=await import('node:fs');
 const db=new PGlite();
 const sql=name=>readFileSync(new URL('../repo-root/sql/'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
 const member='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
 try{
  await db.exec(`create role authenticated;create role anon;create role service_role bypassrls;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table user_profiles(id uuid primary key,role text,active boolean,display_name text,email text);
   create table centers(code text primary key,name text,active boolean default true);
   create function operations_ai_snapshot() returns jsonb language sql as $$select '{}'::jsonb$$;
   create function operations_run_scheduler() returns jsonb language sql as $$select '{}'::jsonb$$;
   insert into centers values('001','가상센터1',true),('002','가상센터2',true);
   create function is_admin() returns boolean language sql stable as $$select exists(select 1 from user_profiles where id=auth.uid() and active and role='admin')$$;
   insert into user_profiles values('${member}','editor',true,'가상직원','member@example.test'),('${other}','editor',true,'가상직원2','other@example.test');`);
  for(const name of ['operations-core.sql','operations-workflow.sql','operations-templates.sql','operations-portal.sql','operations-access.sql','operations-files.sql','operations-trash.sql','operations-members-participants.sql'])await db.exec(sql(name));
  await db.exec(`create table operations_permissions(resource text primary key,admin_only boolean default false,read_rule jsonb,write_rule jsonb,member_overrides jsonb default '{}');`);
  const base=sql('operations-permissions.sql');
  await db.exec('alter table operations_tasks add column work_end_date date;');
  for(const name of ['operations_permission_match','operations_permission_for_actor','operations_resource_allowed','operations_save_task_period','operations_save_task','operations_reopen_task','operations_incident_action']){
   const definition=base.match(new RegExp('create(?: or replace)? function public\\.'+name+'\\([\\s\\S]*?as (\\$[a-z_]*\\$)[\\s\\S]*?\\1\\s*;','i'))?.[0];
   assert.ok(definition,'real permission function source: '+name);await db.exec(definition);
  }
  await db.exec(sql('operations-explicit-scope-rollback.sql'));
  await db.exec('revoke all on function operations_permission_for_actor(text,text,text,uuid),operations_reserve_file(uuid,uuid,text,uuid,text,integer,text,text,text),operations_commit_file(uuid,uuid,text,text) from public,anon,authenticated;');
  await db.exec(`select set_config('request.jwt.claim.sub','${member}',false);insert into operations_permissions(resource,read_rule,write_rule,member_overrides) select x,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,'{"everyone":true,"roles":[],"centers":[],"scope":"all"}'::jsonb,jsonb_build_object('${member}',jsonb_build_object('level','edit','scope','all')) from unnest(array['tasks','forms','incidents','drivers','vehicles','companies','delivery_points','routes','distance_tools']) x;`);
  // On the original SQL, even a saved edit/all grant cannot pass native write guards.
  const migration=new URL('../repo-root/sql/operations-explicit-scope.sql',import.meta.url);
  let patch;try{patch=readFileSync(migration,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
  if(patch){await db.exec(patch);await db.exec(patch);}
  assert.equal((await db.query("select has_function_privilege('authenticated','operations_permission_for_actor(text,text,text,uuid)','execute') allowed")).rows[0].allowed,false,'migration must preserve the internal actor-helper ACL');
  const allowed=async(resource,actor=member,center='001',action='edit')=>(await db.query('select operations_permission_for_actor($1,$2,$3,$4) allowed',[resource,action,center,actor])).rows[0].allowed;
  assert.equal(await allowed('drivers'),true,'SQL explicit all must allow an editor with no assigned center');
  assert.equal((await db.query("select operations_can_edit_resource('tasks','001') allowed")).rows[0].allowed,true,'native task writes must honor the same all-center grant');
  const context=(await db.query('select operations_portal_context() value')).rows[0].value;
  assert.deepEqual(context.writable_centers,['001','002','gimhae','yangsan'],'portal must expose writable centers from effective permissions');
  const rpc=async(name,args)=>(await db.query('select to_jsonb('+name+'('+args.map((_,i)=>'$'+(i+1)).join(',')+')) value',args)).rows[0].value;
  const request=()=>crypto.randomUUID();
  const incident=(await db.query(`insert into operations_incidents(center_code,title,kind,created_by) values('001','가상 사고 원문','가상',$1) returning *`,[member])).rows[0];
  await db.exec("update operations_permissions set member_overrides='{}' where resource='incidents'");
  assert.equal((await db.query("select operations_can_edit_resource('incidents','001') allowed")).rows[0].allowed,false,'inherited incident status permission must not permit content writes without membership');
  await assert.rejects(()=>rpc('operations_incident_action',[request(),incident.id,incident.version,'edit',{title:'unauthorized'}]),/권한/);
  const incidentArgs=[request(),member,'incident',incident.id,'d'.repeat(43),100,'application/pdf','사고.pdf','pdf'];
  await assert.rejects(()=>rpc('operations_reserve_file',incidentArgs),/권한/,'inherited incident permission must not allow a cross-center upload');
  const incidentFile=(await db.query(`insert into operations_files(incident_id,center_code,uploaded_by,request_id,content_hash,original_name,file_name,mime_type,byte_size,ordinal,drive_id,item_id) values($1,'001',$2,$3,$4,'사고.pdf','사고.pdf','application/pdf',100,1,'synthetic-drive','incident-item') returning id`,[incident.id,member,request(),'e'.repeat(43)])).rows[0].id;
  await assert.rejects(()=>rpc('operations_commit_file',[incidentFile,member,'synthetic-drive','incident-item']),/권한/);
  await db.query("insert into operations_center_members values($1,'002')",[member]);
  assert.equal((await db.query("select operations_can_edit_resource('incidents','001') allowed")).rows[0].allowed,false,'inherited incident content remains restricted for foreign-center editors');
  await db.query('delete from operations_center_members where user_id=$1',[member]);
  await db.query("update user_profiles set role='viewer' where id=$1",[member]);
  const resolved=await rpc('operations_incident_action',[request(),incident.id,incident.version,'resolve',{note:'상태 처리'}]);
  assert.equal(resolved.status,'resolved','existing viewer status-only exception remains available');
  const openIncident=await rpc('operations_incident_action',[request(),incident.id,resolved.version,'reopen',{}]);
  await db.query("update user_profiles set role='editor' where id=$1",[member]);
  await db.query("update operations_permissions set member_overrides=jsonb_build_object($1::text,jsonb_build_object('level','edit','scope','all')) where resource='incidents'",[member]);
  assert.equal((await rpc('operations_incident_action',[request(),incident.id,openIncident.version,'edit',{title:'명시 권한 수정'}])).title,'명시 권한 수정');
  assert.ok((await rpc('operations_reserve_file',incidentArgs)).id,'explicit global incident edit enables cross-center upload');
  assert.equal(await rpc('operations_commit_file',[incidentFile,member,'synthetic-drive','incident-item']),incidentFile);
  for(const level of ['read','none']){
   await db.query("update operations_permissions set member_overrides=jsonb_build_object($1::text,jsonb_build_object('level',$2::text,'scope','all')) where resource='incidents'",[member,level]);
   assert.equal((await db.query("select operations_can_edit_resource('incidents','001') allowed")).rows[0].allowed,false,level+' must not permit incident content edits');
  }
  await db.query("update operations_permissions set member_overrides=jsonb_build_object($1::text,jsonb_build_object('level','edit','scope','all')) where resource='incidents'",[member]);
  const template=(await db.query(`insert into operations_templates(family_id,version,center_code,title,spec,status,created_by,approved_by,approved_at) values(gen_random_uuid(),1,'001','가상 권한 검증 양식','{"effective_from":"2026-11-01","fields":[],"steps":[]}', 'approved',$1,$1,now()) returning id`,[member])).rows[0].id;
  const issueId=request(),created=await rpc('operations_task_from_template',[issueId,template,'2026-11-06',{},member,false]);
  assert.equal(created.owner_id,member,'no-center editor can own a task with an explicit task grant');
  assert.equal((await rpc('operations_task_from_template',[issueId,template,'2026-11-06',{},member,false])).id,created.id,'native retry preserves the task ID');
  const edited=await rpc('operations_save_task',[request(),created.id,created.version,'001','가상 업무 수정','2026-11-06',{note:'진행 기록'},'in_progress']);
  assert.equal(edited.inputs.note,'진행 기록','native save actually persists the update');
  await assert.rejects(()=>rpc('operations_save_task',[request(),created.id,created.version,'001','이전 버전','2026-11-06',{},'pending']),/다른 사용자|버전/);
  const completed=await rpc('operations_save_task',[request(),edited.id,edited.version,'001',edited.title,'2026-11-06',edited.inputs,'completed']);
  assert.equal(completed.status,'completed');
  const reopened=await rpc('operations_reopen_task',[request(),completed.id,completed.version]);assert.equal(reopened.status,'in_progress');
  const options=await rpc('operations_participant_options',['001']);
  assert.equal(options.find(row=>row.user_id===member).eligible,true,'assignment options honor explicit global task permission');
  assert.equal(options.find(row=>row.user_id===other).eligible,false,'unassigned inherited editor is not made eligible');
  assert.ok((await db.query("select * from operations_handoff_people('001')")).rows.some(row=>row.id===member));
  const assigned=await rpc('operations_set_task_participants',[request(),reopened.id,reopened.version,options.find(row=>row.user_id===member).id,null,null,'검증 담당']);
  assert.equal(assigned.owner_id,member);
  const reserveRequest=request(),args=[reserveRequest,member,'task',created.id,'a'.repeat(43),100,'application/pdf','가상첨부.pdf','pdf'];
  const file=await rpc('operations_reserve_file',args);
  assert.equal((await rpc('operations_reserve_file',args)).id,file.id,'attachment reserve retries reuse the original record');
  await db.query("update operations_files set drive_id='synthetic-drive',item_id='synthetic-item' where id=$1",[file.id]);
  assert.equal(await rpc('operations_commit_file',[file.id,member,'synthetic-drive','synthetic-item']),file.id);
  await assert.rejects(()=>rpc('operations_commit_file',[file.id,other,'synthetic-drive','synthetic-item']),/권한/);
  await db.query("update operations_permissions set member_overrides=member_overrides||jsonb_build_object($1::text,jsonb_build_object('level','edit','scope','all')) where resource='tasks'",[other]);
  await assert.rejects(()=>rpc('operations_commit_file',[file.id,other,'synthetic-drive','synthetic-item']),/권한/,'even an equally authorized editor cannot commit another uploader\'s file');
  await db.query("update operations_permissions set member_overrides=member_overrides-$1::text where resource='tasks'",[other]);
  const privateTask=(await db.query(`insert into operations_tasks(center_code,title,work_date,owner_id,created_by,inputs) values('001','다른 직원 개인 업무','2026-11-06',$1,$1,'{"personal_work":{}}') returning id`,[other])).rows[0].id;
  await assert.rejects(()=>rpc('operations_reserve_file',[request(),member,'task',privateTask,'b'.repeat(43),100,'application/pdf','개인.pdf','pdf']),/개인 업무/);
  const privateFile=(await db.query(`insert into operations_files(task_id,center_code,uploaded_by,request_id,content_hash,original_name,file_name,mime_type,byte_size,ordinal,drive_id,item_id) values($1,'001',$2,$3,$4,'개인.pdf','개인.pdf','application/pdf',100,1,'synthetic-drive','private-item') returning id`,[privateTask,member,request(),'c'.repeat(43)])).rows[0].id;
  await assert.rejects(()=>rpc('operations_commit_file',[privateFile,member,'synthetic-drive','private-item']),/개인 업무/);
  assert.equal((await db.query('select status from operations_files where id=$1',[privateFile])).rows[0].status,'reserved','private-file rejection must not partially commit');
  await db.query("update operations_files set status='saved',verified_at=now() where id=$1",[privateFile]);
  await assert.rejects(()=>rpc('operations_commit_file',[privateFile,member,'synthetic-drive','private-item']),/개인 업무/,'idempotent file replies must still respect current private ownership');
  assert.ok((await db.query('select count(*)::int count from operations_task_events where task_id=$1',[created.id])).rows[0].count>=6,'native task and file history is retained');
  await db.exec(`create table permission_fixture(id integer primary key,center_code text,payload text);insert into permission_fixture values(1,'001','before');alter table permission_fixture enable row level security;grant select,update on permission_fixture to authenticated;
   create policy fixture_base on permission_fixture to authenticated using(true) with check(true);
   create policy fixture_read on permission_fixture as restrictive for select to authenticated using(operations_resource_allowed('drivers','read',center_code));
   create policy fixture_edit on permission_fixture as restrictive for update to authenticated using(operations_resource_allowed('drivers','edit',center_code)) with check(operations_resource_allowed('drivers','edit',center_code));
   set role authenticated;`);
  assert.equal((await db.query("update permission_fixture set payload='after' where id=1 returning payload")).rows[0].payload,'after');
  await db.exec(`reset role;update operations_permissions set member_overrides=jsonb_build_object('${member}',jsonb_build_object('level','none','scope','all')) where resource='drivers';set role authenticated;`);
  assert.equal((await db.query('select * from permission_fixture')).rows.length,0,'explicit denial must hide rows even with the old permissive policy');
  assert.equal((await db.query("update permission_fixture set payload='denied' returning id")).rows.length,0,'explicit denial must prevent actual updates');
  await db.exec(`reset role;`);
  assert.equal(await allowed('tasks',other),false,'unassigned inherited editor remains restricted');
  await db.query("update operations_permissions set member_overrides=jsonb_build_object($1::text,jsonb_build_object('level','edit','scope','own')) where resource='tasks'",[member]);
  assert.equal(await allowed('tasks'),false,'own-center scope with no membership remains denied');
  await db.query("insert into operations_center_members values($1,'001')",[member]);
  assert.equal(await allowed('tasks'),true);assert.equal(await allowed('tasks',member,'002'),false,'own-center scope never reaches another center');
  await db.query("update operations_permissions set member_overrides=jsonb_build_object($1::text,jsonb_build_object('level','read','scope','all')) where resource='tasks'",[member]);
  assert.equal(await allowed('tasks'),false);assert.equal(await allowed('tasks',member,'002','read'),true,'read grants never enable writes');
  await db.query("update operations_permissions set member_overrides=jsonb_build_object($1::text,jsonb_build_object('level','edit','scope','all')) where resource='tasks'",[member]);
  await db.query("update user_profiles set role='viewer' where id=$1",[member]);assert.equal(await allowed('tasks'),false,'ordinary viewer role is still read-only');
  await db.query("update user_profiles set role='editor' where id=$1",[member]);
  await db.exec(`update user_profiles set active=false where id='${member}';`);assert.equal(await allowed('tasks'),false);
  await db.exec(`update user_profiles set active=true where id='${member}';update operations_permissions set admin_only=true where resource='tasks';`);assert.equal(await allowed('tasks'),false);
  if(patch){
   const current=(await db.query("select pg_get_functiondef('operations_can_edit_resource(text,text)'::regprocedure) source")).rows[0].source;
   await db.exec(current.replace('select public.operations_resource_allowed','-- unreviewed function revision\n select public.operations_resource_allowed'));
   await assert.rejects(()=>db.exec(patch),/함수 버전이 변경/,'unknown production function versions must abort instead of overwriting newer code');
   await db.exec('rollback;');await db.exec(current);await db.exec(patch);
  }
  console.log('PASS isolated PostgreSQL explicit grants, native guards, portal centers, restrictive RLS writes/denial and repeated migration');
 }finally{await db.close();}
}

{
 const {stripTypeScriptTypes}=await import('node:module'),{readFileSync}=await import('node:fs'),{default:vm}=await import('node:vm');
 const scope={};vm.runInNewContext(stripTypeScriptTypes(readFileSync(new URL('../app/src/domain/portal-permissions.ts',import.meta.url),'utf8')).replace(/\bexport /g,'')+'\nglobalThis.preview=effectivePermission;',scope);
 const person={id:'11111111-1111-4111-8111-111111111111',active:true,role:'editor',centers:[]};
 const grant=(level,scope)=>({...config,member_overrides:{[person.id]:{level,scope}}});
 const cases=[
  ['explicit all without membership',grant('edit','all'),person,'001',{read:true,edit:true}],
  ['explicit all other center',grant('edit','all'),{...person,centers:['002']},'001',{read:true,edit:true}],
  ['explicit all resource overview',grant('edit','all'),person,undefined,{read:true,edit:true}],
  ['explicit own without membership',grant('edit','own'),person,'001',{read:false,edit:false}],
  ['explicit own assigned center',grant('edit','own'),{...person,centers:['001']},'001',{read:true,edit:true}],
  ['explicit own foreign center',grant('edit','own'),{...person,centers:['002']},'001',{read:false,edit:false}],
  ['explicit deny beats inherited allow',grant('none','all'),{...person,centers:['001']},'001',{read:false,edit:false}],
  ['explicit read stays read-only',grant('read','all'),person,'001',{read:true,edit:false}],
  ['inactive explicit editor',grant('edit','all'),{...person,active:false},'001',{read:false,edit:false}],
  ['viewer role ceiling',grant('edit','all'),{...person,role:'viewer'},'001',{read:true,edit:false}],
  ['administrator-only boundary',{...grant('edit','all'),admin_only:true},person,'001',{read:false,edit:false}],
  ['global common catalog rule',config,person,'001',{read:true,edit:true}],
  ['malformed override',{...config,member_overrides:{[person.id]:{level:'edit'}}},person,'001',{read:false,edit:false}],
 ];
 for(const [name,cfg,p,center,want] of cases){
  assert.deepEqual(JSON.parse(JSON.stringify(scope.preview(cfg,p,center))),want,'React preview: '+name);
  assert.deepEqual(effectivePermission(cfg,p,center),want,'legacy preview: '+name);
 }
 for(const resource of centerEditResources)for(const center of [undefined,'001','002']){
  const cfg={...grant('edit','all'),resource};
  assert.equal(scope.preview(cfg,person,center).edit,true,'explicit React all-center grant: '+resource);
  assert.equal(effectivePermission(cfg,person,center).edit,true,'explicit legacy all-center grant: '+resource);
 }
 console.log('PASS explicit employee scopes: React/legacy previews preserve deny, own-center, role and admin boundaries');
}

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

// Employee editor uses the existing permission predicate, including explicit unclassified scope.
{
 const {stripTypeScriptTypes}=await import('node:module'),{readFileSync}=await import('node:fs'),{default:vm}=await import('node:vm');
 const ctx={MAIL_DIAGNOSTIC_OWNER_ID:'fixture-owner'};
 for(const path of ['feature-catalog.ts','portal-permissions.ts','employee-permissions.ts']){
  const code=stripTypeScriptTypes(readFileSync(new URL('../app/src/domain/'+path,import.meta.url),'utf8')).replace(/^import .*;\r?\n/gm,'').replace(/\bexport /g,'');
  vm.runInNewContext(code,ctx);
 }
 const p={id:'fixture-employee',active:true,role:'editor',centers:['001']};
 const cfg={...config,member_overrides:{[p.id]:{level:'edit',scope:'own'}}};
 const centers=[{code:'001'},{code:'002'}],name=code=>code==='001'?'안산':'평택';
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.effectivePermission(cfg,p,''))),{read:false,edit:false},'unclassified is not the global overview');
 assert.deepEqual(effectivePermission(cfg,p,''),{read:false,edit:false},'legacy unclassified preview follows SQL');
 let result=ctx.employeePermissionSummary(cfg,p,centers,name);
 assert.equal(result.readScope,'안산');assert.equal(result.editScope,'안산');
 result=ctx.employeePermissionSummary(config,{...p,role:'admin'},centers,name);
 assert.equal(result.readScope,'전체 자료 · 미분류 포함');
 result=ctx.employeePermissionSummary({...config,resource:'settings'},{...p,role:'admin'},centers,name);
 assert.equal(result.label,'불가','non-owner admin must not be displayed as permitted for private pages');
 result=ctx.employeePermissionSummary(cfg,{...p,active:false},centers,name);
 assert.equal(result.label,'불가');assert.equal(result.reason,'비활성 계정');
 result=ctx.employeePermissionSummary({...config,resource:'tasks',write_rule:{...rule,scope:'own'}},p,centers,name);
 assert.equal(result.readScope,'전체 센터 자료');assert.equal(result.editScope,'안산','different read/write scopes stay separate');
 assert.equal(ctx.permissionTitle({...config,resource:'permissions'}),'직원별 업무 권한');
 for(const [level,label,read,edit] of [['edit','사용',true,true],['read','조회',true,false],['none','불가',false,false]]){
  const rule={...config,member_overrides:{[p.id]:{level,scope:'all'}}};
  const summary=ctx.employeePermissionSummary(rule,p,centers,name);
  assert.equal(summary.level,level);assert.equal(summary.label,label);
  assert.equal(summary.read,read);assert.equal(summary.edit,edit);
 }
 const inherited=ctx.employeePermissionSummary(config,p,centers,name);
 assert.equal(inherited.level,'edit');assert.equal(inherited.label,'사용','existing grants display their effective level without an inherit option');
 console.log('PASS employee summary: unclassified denial, OP, fixed restrictions, inactive, distinct read/write scope');
}

if(process.env.PGLITE_MODULE && !process.env.LEGACY_CATALOG_ONLY){
 const {PGlite}=await import(process.env.PGLITE_MODULE),{readFileSync}=await import('node:fs');
 const db=new PGlite(); const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
 try {
  await db.exec(`create role authenticated;create role anon;create role service_role;create schema auth;
   create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
   create table user_profiles(id uuid primary key,role text,active boolean,display_name text);
   create table centers(code text primary key);
   create table operations_center_members(user_id uuid,center_code text);
   create table operations_permissions(resource text primary key,admin_only boolean default false,read_rule jsonb,write_rule jsonb,version integer default 1,updated_by uuid,updated_at timestamptz);
   create table operations_task_events(id bigserial,actor_id uuid,request_id uuid,request_body jsonb,membership_user_id uuid,action text,before_value jsonb,after_value jsonb,unique(actor_id,request_id));
   create function is_admin() returns boolean language sql stable security definer as $$select exists(select 1 from user_profiles where id=auth.uid() and active and role='admin')$$;
   create function operations_permission_match(jsonb,uuid,text) returns boolean language sql stable as $$select false$$;
   insert into user_profiles values('${id(1)}','admin',true,'관리자'),('${id(2)}','editor',true,'격리 직원'),('${id(3)}','viewer',true,'조회 직원');
   insert into centers values('001'),('002');insert into operations_center_members values('${id(2)}','001');
   insert into operations_permissions(resource,admin_only,read_rule,write_rule) values('routes',false,'{}','{}'),('permissions',true,'{}','{}');
   grant usage on schema public,auth to authenticated;`);
  await db.exec(readFileSync(new URL('../repo-root/sql/operations-member-permissions.sql',import.meta.url),'utf8'));
  const actor=async n=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id(n)}',false);set role authenticated;`);
  const expected={display_name:'격리 직원',role:'editor',centers:['001']};
  const change=(version,permission)=>[{resource:'routes',version,permission}];
  const call=(request,changes,person=2,exp=expected)=>db.query('select operations_update_member_permissions($1,$2,$3,$4) result',[id(request),id(person),JSON.stringify(exp),JSON.stringify(changes)]);
  await actor(2);await assert.rejects(call(10,change(1,{level:'edit',scope:'all'})),/관리자만/);
  await actor(1);const grant=change(1,{level:'edit',scope:'all'});
  const first=await call(10,grant);assert.equal(first.rows[0].result.rules[0].member_overrides[id(2)].level,'edit');
  const access=async()=>{
   await db.exec('reset role;');
   const result=await db.query("select operations_permission_for_actor('routes','read',null,$1) as read, operations_permission_for_actor('routes','edit',null,$1) as edit",[id(2)]);
   await actor(1);return result.rows[0];
  };
  assert.deepEqual(await access(),{read:true,edit:true},'사용 includes both read and edit through actual SQL');
  assert.deepEqual((await call(10,grant)).rows,first.rows,'lost-response retry returns original receipt');
  await assert.rejects(call(10,change(1,{level:'none',scope:'all'})),/이미 사용/);
  await assert.rejects(call(11,change(1,{level:'none',scope:'all'})),/다른 관리자가 업무 권한/);
  await assert.rejects(call(12,change(2,{level:'read',scope:'all'}),2,{...expected,centers:['002']}),/직원 정보를 변경/);
  await assert.rejects(call(13,[...change(2,{level:'none',scope:'all'}),{resource:'permissions',version:1,permission:{level:'edit',scope:'all'}}]),/관리자 전용/);
  await db.exec('reset role;');
  assert.equal((await db.query("select version from operations_permissions where resource='routes'")).rows[0].version,2,'failed batch is atomic');
  assert.equal((await db.query('select count(*)::int n from operations_task_events')).rows[0].n,1,'retry creates no second history');
  await actor(1);await call(14,change(2,{level:'none',scope:'all'}));
  assert.deepEqual(await access(),{read:false,edit:false},'불가 denies reads as well as edits through actual SQL');
  await call(18,change(3,{level:'read',scope:'all'}));
  assert.deepEqual(await access(),{read:true,edit:false},'조회 cannot edit through actual SQL');
  await call(15,change(4,null));
  await assert.rejects(call(16,change(5,{level:'edit',scope:'all'}),3,{display_name:'조회 직원',role:'viewer',centers:[]}),/조회 전용 직원/);
  await db.exec(`reset role;update user_profiles set active=false where id='${id(1)}';`);
  await actor(1);await assert.rejects(call(17,change(5,{level:'read',scope:'all'})),/관리자만/);
  console.log('PASS isolated actual member RPC: admin boundary, atomic save, deny/inherit, role ceiling, stale member/rule, idempotency and history');
 }finally {await db.close();}
}

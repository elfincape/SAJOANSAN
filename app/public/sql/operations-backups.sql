begin;
create table public.operations_master_backups(
 id uuid primary key default gen_random_uuid(),period text not null unique,
 captured_at timestamptz not null default now(),file_name text not null unique,
 snapshot jsonb not null,counts jsonb not null,status text not null default 'pending' check(status in ('pending','failed','saved')),
 workbook_base64 text,content_hash text,byte_size integer,drive_id text,folder_id text,item_id text,
 attempts integer not null default 0,last_attempt_at timestamptz,last_error text,verified_at timestamptz,recover_empty_once boolean not null default false,
 check(status<>'saved' or (item_id is not null and verified_at is not null and content_hash is not null))
);
alter table public.operations_master_backups enable row level security;
create policy operations_master_backups_hq on public.operations_master_backups for select to authenticated
 using(exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin'));
revoke all on public.operations_master_backups from public,anon,authenticated;
grant select(id,period,captured_at,file_name,counts,status,attempts,last_attempt_at,last_error,verified_at) on public.operations_master_backups to authenticated;
grant all on public.operations_master_backups to service_role;
create function public.operations_master_snapshot() returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
 'centers',(select coalesce(jsonb_agg(to_jsonb(x) order by code),'[]') from public.centers x),
 'companies',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.companies x),
 'drivers',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.drivers x),
 'vehicles',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.vehicles x),
 'routes',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.routes x),
 'delivery_points',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.delivery_points x),
 'route_stops',(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public.route_stops x));
$$;
revoke all on function public.operations_master_snapshot() from public,anon,authenticated;
grant execute on function public.operations_master_snapshot() to service_role;
create function public.operations_master_capture(p_baseline boolean default false) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare local_time timestamp:=now() at time zone 'Asia/Seoul';key text;original jsonb;totals jsonb;result uuid;filename text;
begin
 perform pg_advisory_xact_lock(hashtextextended('operations-master-capture',0));
 if p_baseline then key:='baseline';filename:=to_char(local_time,'YYYYMMDD_HH24MISS')||'_운영마스터_현재원본.xlsx';
 else
  if (local_time+interval '1 day')::date<>date_trunc('month',local_time+interval '1 day')::date or to_char(local_time,'HH24:MI')<>'23:59' then return null;end if;
  key:=to_char(local_time,'YYYY-MM');filename:=to_char(local_time,'YYYYMM')||'_운영마스터_전체원본.xlsx';
 end if;
 select id into result from public.operations_master_backups where period=key;if found then return result;end if;
 original:=public.operations_master_snapshot();
 select jsonb_object_agg(k,jsonb_array_length(v)) into totals from jsonb_each(original) e(k,v);
 insert into public.operations_master_backups(period,file_name,snapshot,counts) values(key,filename,original,totals) returning id into result;
 return result;
end $$;
revoke all on function public.operations_master_capture(boolean) from public,anon,authenticated;
grant execute on function public.operations_master_capture(boolean) to service_role;
create function public.operations_master_payload(p_id uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select (to_jsonb(b)-'snapshot')||jsonb_build_object('original_text',b.snapshot::text) from public.operations_master_backups b where id=p_id;
$$;
revoke all on function public.operations_master_payload(uuid) from public,anon,authenticated;
grant execute on function public.operations_master_payload(uuid) to service_role;
create function public.operations_backup_immutable() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if row(new.id,new.period,new.captured_at,new.file_name,new.snapshot,new.counts) is distinct from row(old.id,old.period,old.captured_at,old.file_name,old.snapshot,old.counts)
  or (old.workbook_base64 is not null and row(new.workbook_base64,new.content_hash,new.byte_size) is distinct from row(old.workbook_base64,old.content_hash,old.byte_size))
  or (old.status='saved' and new.status<>'saved') then raise exception '보관된 운영 원본은 덮어쓸 수 없습니다.';end if;
 return new;
end $$;
create trigger operations_backup_original before update on public.operations_master_backups for each row execute function public.operations_backup_immutable();
create function public.operations_master_compare(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare archived jsonb;current_data jsonb;result jsonb;
begin
 if not exists(select 1 from public.user_profiles where id=auth.uid() and active and role='admin') then raise exception 'HQ 권한이 필요합니다.' using errcode='42501';end if;
 select snapshot into archived from public.operations_master_backups where id=p_id;
 if not found then raise exception '보관 원본이 없습니다.';end if;
 current_data:=public.operations_master_snapshot();
 with old_rows as(select k table_name,coalesce(r->>'id',r->>'code') id,r value from jsonb_each(archived) e(k,v),lateral jsonb_array_elements(v) r),
 new_rows as(select k table_name,coalesce(r->>'id',r->>'code') id,r value from jsonb_each(current_data) e(k,v),lateral jsonb_array_elements(v) r),
 changes as(select coalesce(o.table_name,n.table_name) table_name,coalesce(o.id,n.id) id,
  case when o.id is null then 'added' when n.id is null then 'removed' else 'changed' end action,
  coalesce(n.value->>'name',n.value->>'plate_number',o.value->>'name',o.value->>'plate_number',n.value->>'code',o.value->>'code',coalesce(o.id,n.id)) title,
  (select coalesce(jsonb_agg(k order by k),'[]') from (select jsonb_object_keys(coalesce(o.value,'{}')) k union select jsonb_object_keys(coalesce(n.value,'{}'))) fields where o.value->k is distinct from n.value->k) fields
 from old_rows o full join new_rows n using(table_name,id) where o.value is distinct from n.value),
 summaries as(select table_name,count(*) total,count(*) filter(where action='added') added,count(*) filter(where action='removed') removed,count(*) filter(where action='changed') changed from changes group by table_name)
 select jsonb_build_object('counts',coalesce((select jsonb_agg(to_jsonb(s) order by table_name) from summaries s),'[]'),
 'items',coalesce((select jsonb_agg(to_jsonb(c)) from (select * from changes order by table_name,title,id limit 200)c),'[]'),
 'total',(select count(*) from changes),'limited',(select count(*)>200 from changes)) into result;
 return result;
end $$;
revoke all on function public.operations_master_compare(uuid) from public,anon;
grant execute on function public.operations_master_compare(uuid) to authenticated;
notify pgrst,'reload schema';
commit;

create table if not exists public.notion_graph_state (
  kind text not null check(kind in ('companies','drivers','routes')),
  center_code text not null check(center_code in ('001','002')),
  web_id uuid not null, notion_id uuid unique, baseline jsonb,
  status text not null default '연결 대기', synced_at timestamptz,
  summary_block_id uuid, summary_hash text, summary_status text default '정상',
  primary key(kind,center_code,web_id)
);
alter table public.notion_graph_state enable row level security;
revoke all on public.notion_graph_state from public,anon,authenticated;
grant all on public.notion_graph_state to service_role;
alter table public.notion_points_state add column if not exists summary_block_id uuid,
  add column if not exists summary_hash text,
  add column if not exists summary_status text default '정상';
-- Unassignments retain the operational stop details so a later reassignment can recover them.
create table if not exists public.notion_graph_stop_archive (
  id bigint generated always as identity primary key,
  center_code text not null, route_id uuid not null, delivery_point_id uuid not null,
  snapshot jsonb not null, archived_at timestamptz not null default now()
);
alter table public.notion_graph_stop_archive enable row level security;
revoke all on public.notion_graph_stop_archive from public,anon,authenticated;
grant all on public.notion_graph_stop_archive to service_role;
grant usage,select on sequence public.notion_graph_stop_archive_id_seq to service_role;

create or replace function public.notion_graph_apply(p_kind text,p_center text,p_id uuid,p_expected jsonb,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare before_row jsonb; saved jsonb; item record; allowed text[];
  co public.companies; dr public.drivers; ro public.routes;
  stops jsonb; target uuid; prior jsonb; next_order integer;
begin
  if p_center not in ('001','002') or p_expected is null or p_values is null then raise exception 'Invalid scope';end if;
  case p_kind
    when 'companies' then
      select to_jsonb(c) into before_row from public.companies c where id=p_id and center_code=p_center for update;
      allowed=array['name','memo'];
    when 'drivers' then
      select to_jsonb(d) into before_row from public.drivers d where id=p_id and center_code=p_center for update;
      allowed=array['name','phone','memo','company_id'];
    when 'routes' then
      select to_jsonb(r) into before_row from public.routes r where id=p_id and center_code=p_center for update;
      allowed=array['name','car_number','active','closed_days','company_id','primary_driver_id','secondary_driver_id','stops'];
      -- Match the web editor's lock order and capture every operational field, not only membership.
      perform 1 from public.route_stops s where route_id=p_id order by id for update;
      select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) into stops from public.route_stops s where route_id=p_id;
    else raise exception 'Invalid kind';
  end case;
  if before_row is null then return null;end if;
  for item in select * from jsonb_each(p_expected) loop
    if item.key='_stops' then
      if p_kind<>'routes' or stops is distinct from item.value then return null;end if;
    elsif (before_row->item.key) is distinct from item.value then return null;
    end if;
  end loop;
  for item in select * from jsonb_each(p_values) loop
    if not(item.key=any(allowed)) then raise exception 'Invalid field';end if;
  end loop;
  if p_values ? 'company_id' and p_values->>'company_id' is not null and not exists
    (select 1 from public.companies where id=(p_values->>'company_id')::uuid and center_code=p_center) then raise exception 'Invalid company scope';end if;
  if p_kind='routes' then
    for item in select * from jsonb_each(p_values) where key in ('primary_driver_id','secondary_driver_id') loop
      if item.value<>'null'::jsonb and not exists(select 1 from public.drivers where id=(item.value#>>'{}')::uuid and center_code=p_center) then raise exception 'Invalid driver scope';end if;
    end loop;
    if p_values ? 'stops' then
      if jsonb_typeof(p_values->'stops')<>'array' then raise exception 'Invalid stops';end if;
      for target in select distinct value::uuid from jsonb_array_elements_text(p_values->'stops') loop
        if not exists(select 1 from public.delivery_points where id=target and center_code=p_center) then raise exception 'Invalid delivery scope';end if;
      end loop;
    end if;
  end if;
  case p_kind
    when 'companies' then
      co=jsonb_populate_record(null::public.companies,before_row||p_values);
      update public.companies set name=co.name,memo=co.memo where id=p_id and center_code=p_center returning to_jsonb(companies.*) into saved;
    when 'drivers' then
      dr=jsonb_populate_record(null::public.drivers,before_row||p_values);
      update public.drivers set name=dr.name,phone=dr.phone,memo=dr.memo,company_id=dr.company_id where id=p_id and center_code=p_center returning to_jsonb(drivers.*) into saved;
    when 'routes' then
      ro=jsonb_populate_record(null::public.routes,before_row||(p_values-'stops'));
      update public.routes set name=ro.name,car_number=ro.car_number,active=ro.active,closed_days=ro.closed_days,
        company_id=ro.company_id,primary_driver_id=ro.primary_driver_id,secondary_driver_id=ro.secondary_driver_id
        where id=p_id and center_code=p_center returning to_jsonb(routes.*) into saved;
      if p_values ? 'stops' then
        insert into public.notion_graph_stop_archive(center_code,route_id,delivery_point_id,snapshot)
          select p_center,p_id,s.delivery_point_id,to_jsonb(s) from public.route_stops s where s.route_id=p_id
          and not exists(select 1 from jsonb_array_elements_text(p_values->'stops') x where x.value::uuid=s.delivery_point_id);
        delete from public.route_stops s where s.route_id=p_id
          and not exists(select 1 from jsonb_array_elements_text(p_values->'stops') x where x.value::uuid=s.delivery_point_id);
        select coalesce(max(stop_order),0) into next_order from public.route_stops where route_id=p_id;
        for target in select distinct value::uuid from jsonb_array_elements_text(p_values->'stops') loop
          if not exists(select 1 from public.route_stops where route_id=p_id and delivery_point_id=target) then
            prior=null;
            select snapshot into prior from public.notion_graph_stop_archive
              where center_code=p_center and route_id=p_id and delivery_point_id=target order by archived_at desc,id desc limit 1;
            next_order=next_order+1;
            insert into public.route_stops(route_id,delivery_point_id,stop_order,arrival_text,arrival_business_min,
              unloading_start_text,unloading_start_business_min,unloading_end_text,unloading_end_business_min,
              deadline_text,deadline_business_min,override_delivery_method,override_access_method,override_delivery_location,memo)
              values(p_id,target,next_order,prior->>'arrival_text',(prior->>'arrival_business_min')::integer,
                prior->>'unloading_start_text',(prior->>'unloading_start_business_min')::integer,
                prior->>'unloading_end_text',(prior->>'unloading_end_business_min')::integer,
                prior->>'deadline_text',(prior->>'deadline_business_min')::integer,prior->>'override_delivery_method',
                prior->>'override_access_method',prior->>'override_delivery_location',prior->>'memo');
          end if;
        end loop;
      end if;
  end case;
  return saved;
end;$$;
revoke all on function public.notion_graph_apply(text,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.notion_graph_apply(text,text,uuid,jsonb,jsonb) to service_role;

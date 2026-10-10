alter table public.delivery_points
  add column if not exists contact_name text,
  add column if not exists contact_office text,
  add column if not exists contact_mobile text,
  add column if not exists rep_name text,
  add column if not exists rep_phone text;
create table if not exists public.notion_points_state (
  center_code text not null check(center_code in ('001','002')),
  web_id uuid not null,
  notion_id uuid unique,
  baseline jsonb,
  photo_hash text,
  status text not null default '연결 대기',
  synced_at timestamptz,
  primary key(center_code,web_id)
);
alter table public.notion_points_state enable row level security;
revoke all on public.notion_points_state from public,anon,authenticated;
grant all on public.notion_points_state to service_role;
create table if not exists public.notion_points_lock (
  id boolean primary key default true check(id),token uuid not null,expires_at timestamptz not null
);
alter table public.notion_points_lock enable row level security;
revoke all on public.notion_points_lock from public,anon,authenticated;
grant all on public.notion_points_lock to service_role;
create or replace function public.notion_points_acquire(p_token uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $$
declare n integer;
begin
  insert into public.notion_points_lock values(true,p_token,clock_timestamp()+interval '180 seconds')
  on conflict(id) do update set token=excluded.token,expires_at=excluded.expires_at
  where public.notion_points_lock.expires_at<=clock_timestamp();
  get diagnostics n=row_count;return n=1;
end;$$;
create or replace function public.notion_points_release(p_token uuid)
returns void language sql security definer set search_path=pg_catalog as $$
delete from public.notion_points_lock where id=true and token=p_token;$$;
-- Compare the original field values under a row lock before applying a Notion edit.
create or replace function public.notion_points_apply(p_id uuid,p_center text,p_expected jsonb,p_values jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
declare current_row public.delivery_points; new_row public.delivery_points; item record;
begin
  if p_center not in ('001','002') or p_expected is null or p_values is null then raise exception 'Invalid center or values';end if;
  select * into current_row from public.delivery_points where id=p_id and center_code=p_center for update;
  if not found then return null;end if;
  for item in select * from jsonb_each(p_expected) loop
    if (to_jsonb(current_row)->item.key) is distinct from item.value then return null;end if;
  end loop;
  for item in select * from jsonb_each(p_values) loop
    if item.key not in ('name','code','address','region','deadline_text','deadline_business_min','delivery_method','delivery_location','access_method','security_key_location','security_password','contact','contact_mobile','contact_name','contact_office','rep_name','rep_phone','memo','allow_under_1ton','allow_under_3_5ton','allow_over_5ton','allow_unmanned_yard','photos') then raise exception 'Invalid field';end if;
  end loop;
  new_row=jsonb_populate_record(current_row,p_values);
  update public.delivery_points set name=new_row.name,code=new_row.code,address=new_row.address,region=new_row.region,
    deadline_text=new_row.deadline_text,deadline_business_min=new_row.deadline_business_min,
    delivery_method=new_row.delivery_method,delivery_location=new_row.delivery_location,access_method=new_row.access_method,
    security_key_location=new_row.security_key_location,security_password=new_row.security_password,contact=new_row.contact,memo=new_row.memo,
    contact_mobile=new_row.contact_mobile,contact_name=new_row.contact_name,contact_office=new_row.contact_office,rep_name=new_row.rep_name,rep_phone=new_row.rep_phone,
    allow_under_1ton=new_row.allow_under_1ton,allow_under_3_5ton=new_row.allow_under_3_5ton,allow_over_5ton=new_row.allow_over_5ton,
    allow_unmanned_yard=new_row.allow_unmanned_yard,photos=new_row.photos
  where id=p_id and center_code=p_center returning * into new_row;
  return to_jsonb(new_row);
end;$$;
revoke all on function public.notion_points_acquire(uuid),public.notion_points_release(uuid),public.notion_points_apply(uuid,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.notion_points_acquire(uuid),public.notion_points_release(uuid),public.notion_points_apply(uuid,text,jsonb,jsonb) to service_role;

alter table public.notion_points_state add column if not exists web_photo_signature text,
  add column if not exists notion_photo_fingerprint text;
-- Return only small fields and a database-side photo signature, never image bytes.
create or replace function public.notion_points_scan_web(p_center text,p_cursor uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog,public as $$
  select coalesce(jsonb_agg(item order by id),'[]'::jsonb) from (
    select p.id,(to_jsonb(p)-'photos')||jsonb_build_object(
      '_photo_sig',encode(sha256(convert_to(coalesce(p.photos::jsonb,'[]'::jsonb)::text,'UTF8')),'hex'),
      '_has_photos',case when jsonb_typeof(coalesce(p.photos::jsonb,'[]'::jsonb))='array'
        then jsonb_array_length(coalesce(p.photos::jsonb,'[]'::jsonb))>0 else true end) as item
    from public.delivery_points p where p.center_code=p_center and (p_cursor is null or p.id>p_cursor)
    order by p.id limit 101
  ) selected;
$$;
-- Do not acknowledge a photo changed by a browser after the verified snapshot.
create or replace function public.notion_points_photo_signature(p_center text,p_id uuid,p_photos jsonb)
returns text language sql security invoker set search_path=pg_catalog,public as $$
  select encode(sha256(convert_to(coalesce(photos::jsonb,'[]'::jsonb)::text,'UTF8')),'hex')
  from public.delivery_points where id=p_id and center_code=p_center
    and coalesce(photos::jsonb,'[]'::jsonb)=p_photos;
$$;
revoke all on function public.notion_points_scan_web(text,uuid),public.notion_points_photo_signature(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.notion_points_scan_web(text,uuid),public.notion_points_photo_signature(text,uuid,jsonb) to service_role;

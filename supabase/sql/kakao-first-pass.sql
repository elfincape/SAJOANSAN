begin;

-- The source is the portal owner's single, server-pinned collection folder.
create table if not exists public.kakao_triage_batch (
  id uuid primary key,
  source_version text not null
);
create table if not exists public.kakao_triage_message (
  room_id bigint not null,
  message_id bigint not null,
  seq bigint not null,
  batch_id uuid not null references public.kakao_triage_batch(id),
  observation jsonb not null,
  processor text,
  next_run timestamptz,
  lease uuid,
  lease_until timestamptz,
  input_key text,
  result jsonb,
  primary key (room_id, message_id),
  unique (room_id, seq)
);
create index if not exists kakao_triage_batch_messages on public.kakao_triage_message(batch_id,seq);
create index if not exists kakao_triage_due on public.kakao_triage_message(next_run) where next_run is not null;
create table if not exists public.kakao_triage_photo (
  sha256 text not null,
  processor text not null,
  facts jsonb,
  lease uuid,
  lease_until timestamptz,
  primary key (sha256,processor)
);

-- Merge an observed version atomically. An older reader cannot overwrite a newer import.
create or replace function public.kakao_triage_ingest(
  p_id uuid, p_expected text, p_version text, p_messages jsonb
) returns boolean language plpgsql set search_path = pg_catalog,public as $$
declare
  room bigint;
  previous text;
  changed bigint[];
begin
  perform pg_advisory_xact_lock(hashtextextended('kakao-batch-' || p_id::text, 0));
  select source_version into previous from public.kakao_triage_batch where id=p_id;
  if previous = p_version then return true; end if;
  if previous is distinct from p_expected then return false; end if;
  room := (p_messages->0->>'room_id')::bigint;
  if room is not null then
    perform pg_advisory_xact_lock(hashtextextended('kakao-room-' || room::text, 0));
  end if;
  -- A producer batch keeps its original occurrences; only observations/attachments may advance.
  if exists (
    select 1 from public.kakao_triage_message old where old.batch_id=p_id and not exists (
      select 1 from jsonb_array_elements(p_messages) m
      where (m->>'room_id')::bigint=old.room_id and (m->>'message_id')::bigint=old.message_id
    )
  ) or exists (
    select 1 from jsonb_array_elements(p_messages) m
    left join public.kakao_triage_message old on old.room_id=room and old.message_id=(m->>'message_id')::bigint
    where (m->>'room_id')::bigint is distinct from room or old.batch_id <> p_id or old.seq <> (m->>'sequence')::bigint
  ) then raise exception 'KAKAO_OCCURRENCE_CHANGED'; end if;

  insert into public.kakao_triage_batch values (p_id,p_version)
    on conflict (id) do update set source_version=excluded.source_version;
  with merged as (
    insert into public.kakao_triage_message as existing (room_id,message_id,seq,batch_id,observation)
    select room,(m->>'message_id')::bigint,(m->>'sequence')::bigint,p_id,m
      from jsonb_array_elements(p_messages) as m
    on conflict (room_id,message_id) do update set observation=excluded.observation
      where existing.observation is distinct from excluded.observation
    returning seq
  ) select array_agg(seq) into changed from merged;

  -- Each decision uses the two preceding and two following observations of the same room.
  with affected as (
    select neighbor.seq from unnest(changed) as pos
    cross join lateral (
      (select m.seq from public.kakao_triage_message m where m.room_id=room and m.seq>=pos order by m.seq limit 3)
      union all
      (select m.seq from public.kakao_triage_message m where m.room_id=room and m.seq<pos order by m.seq desc limit 2)
    ) neighbor
  )
  update public.kakao_triage_message m set next_run=now(), lease=null, lease_until=null
    where m.room_id=room and m.seq in (select seq from affected);
  return true;
end $$;

create or replace function public.kakao_triage_claim(
  p_batch uuid, p_processor text, p_lease uuid
) returns jsonb language plpgsql set search_path = pg_catalog,public as $$
declare
  job public.kakao_triage_message;
  prev_rows jsonb;
  next_rows jsonb;
  summary jsonb;
  saved jsonb;
begin
  select m.* into job from public.kakao_triage_message m
    where (p_batch is null or m.batch_id=p_batch)
      and (m.processor is distinct from p_processor or m.next_run <= now())
      and (m.lease is null or m.lease_until <= now())
    order by m.next_run nulls first,m.room_id,m.seq
    limit 1 for update skip locked;
  if not found then
    with scope as (
      select processor is distinct from p_processor or next_run is not null as pending,
        greatest(case when processor is distinct from p_processor then now() else next_run end,
                 lease_until, now()) as ready_at
      from public.kakao_triage_message where p_batch is null or batch_id=p_batch
    )
    select jsonb_build_object('total',count(*),'pending',count(*) filter(where pending),
      'retryAt',min(ready_at) filter(where pending)) into summary from scope;

    if p_batch is not null then
      select coalesce(jsonb_agg(x.entry order by x.seq),'[]'::jsonb) into saved from (
        select seq, jsonb_build_object('roomId',room_id,'messageId',message_id,
          'attachmentIds',jsonb_path_query_array(observation,'$.attachments[*].attachment_id')) || result as entry
        from public.kakao_triage_message where batch_id=p_batch and processor=p_processor
          and next_run is null and lease is null order by seq limit 50
      ) x;
      summary := summary || jsonb_build_object('results',saved,'resultsTruncated',
        (summary->>'total')::bigint-(summary->>'pending')::bigint > jsonb_array_length(saved));
    end if;
    return jsonb_build_object('idle',true,'summary',summary);
  end if;
  update public.kakao_triage_message set lease=p_lease,lease_until=now()+interval '4 minutes'
    where room_id=job.room_id and message_id=job.message_id;
  select jsonb_agg(x.observation order by x.seq) into prev_rows from (
    select seq,observation from public.kakao_triage_message where room_id=job.room_id and seq<job.seq order by seq desc limit 2
  ) x;
  select jsonb_agg(x.observation order by x.seq) into next_rows from (
    select seq,observation from public.kakao_triage_message where room_id=job.room_id and seq>job.seq order by seq limit 2
  ) x;
  return jsonb_build_object('batch',job.batch_id,'target',job.observation,
    'before',coalesce(prev_rows,'[]'::jsonb),'after',coalesce(next_rows,'[]'::jsonb),
    'previousKey',job.input_key,'previousResult',job.result);
end $$;

create or replace function public.kakao_triage_claim_photo(
  p_hash text,p_processor text,p_lease uuid
) returns jsonb language plpgsql set search_path = pg_catalog,public as $$
declare
  photo public.kakao_triage_photo;
begin
  insert into public.kakao_triage_photo (sha256,processor) values (p_hash,p_processor)
    on conflict do nothing;
  select * into strict photo from public.kakao_triage_photo
    where sha256=p_hash and processor=p_processor for update;
  if photo.facts is not null then return jsonb_build_object('facts',photo.facts); end if;
  if photo.lease_until > now() then return jsonb_build_object('claimed',false); end if;
  update public.kakao_triage_photo set lease=p_lease,lease_until=now()+interval '3 minutes'
    where sha256=p_hash and processor=p_processor;
  return jsonb_build_object('claimed',true);
end $$;

alter table public.kakao_triage_batch enable row level security;
alter table public.kakao_triage_message enable row level security;
alter table public.kakao_triage_photo enable row level security;
revoke all on public.kakao_triage_batch,public.kakao_triage_message,public.kakao_triage_photo from public,anon,authenticated;
grant select,insert,update on public.kakao_triage_batch,public.kakao_triage_message,public.kakao_triage_photo to service_role;
revoke all on function public.kakao_triage_ingest(uuid,text,text,jsonb), public.kakao_triage_claim(uuid,text,uuid),
  public.kakao_triage_claim_photo(text,text,uuid) from public,anon,authenticated;
grant execute on function public.kakao_triage_ingest(uuid,text,text,jsonb),public.kakao_triage_claim(uuid,text,uuid),
  public.kakao_triage_claim_photo(text,text,uuid) to service_role;
commit;

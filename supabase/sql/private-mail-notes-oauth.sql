begin;
alter table public.onedrive_connection add column if not exists encrypted_notes_tokens text;
alter table public.onedrive_oauth add column if not exists purpose text not null default 'files'
 check(purpose in ('files','mail-briefing'));
CREATE OR REPLACE FUNCTION public.onedrive_finish_oauth(p_state text, p_proof text, p_user uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare pending public.onedrive_oauth;
begin
 delete from public.onedrive_oauth where state_hash=p_state and proof_hash=p_proof and user_id=p_user and purpose='files' and stage='ready' and expires_at>now() returning * into pending;
 if pending.state_hash is null then return false; end if;
 insert into public.onedrive_connection(id,encrypted_tokens,connected_by,updated_at) values(true,pending.encrypted_data,p_user,now())
 on conflict(id) do update set encrypted_tokens=excluded.encrypted_tokens,connected_by=excluded.connected_by,updated_at=now();
 return true;
end $function$;
create or replace function public.onedrive_finish_notes_oauth(p_state text,p_proof text,p_user uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare pending public.onedrive_oauth;
begin
 if p_user is distinct from '2a828c2d-9a6f-40d4-8e13-336b591811cc'::uuid then return false; end if;
 if not exists(select 1 from public.user_profiles where id=p_user and active) then return false; end if;
 select * into pending from public.onedrive_oauth where state_hash=p_state and proof_hash=p_proof
  and user_id=p_user and purpose='mail-briefing' and stage='ready' and expires_at>clock_timestamp() for update;
 if pending.state_hash is null then return false; end if;
 update public.onedrive_connection set encrypted_notes_tokens=pending.encrypted_data,updated_at=clock_timestamp() where id=true;
 if not found then return false; end if;
 delete from public.onedrive_oauth where state_hash=p_state;
 return true;
end; $$;
revoke all on function public.onedrive_finish_notes_oauth(text,text,uuid) from public,anon,authenticated;
grant execute on function public.onedrive_finish_notes_oauth(text,text,uuid) to service_role;
commit;

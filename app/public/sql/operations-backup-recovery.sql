begin;
alter table public.operations_master_backups add column if not exists recover_empty_once boolean not null default false;
create or replace function public.operations_backup_no_delete() returns trigger language plpgsql as $$
begin raise exception '보관된 운영 원본은 삭제할 수 없습니다.';end $$;
drop trigger if exists operations_backup_preserve on public.operations_master_backups;
create trigger operations_backup_preserve before delete on public.operations_master_backups for each row execute function public.operations_backup_no_delete();
notify pgrst,'reload schema';
commit;

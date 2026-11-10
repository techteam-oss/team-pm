-- Record when a task reaches a "done" status, for dashboards.
alter table public.tasks add column completed_at timestamptz;
create index on public.tasks(space_id, completed_at) where completed_at is not null;

create or replace function private.tasks_completed_at() returns trigger language plpgsql security definer set search_path = '' as $$
declare done boolean;
begin
  select is_done into done from public.statuses where id = new.status_id;
  if not coalesce(done, false) then
    new.completed_at := null;
  elsif tg_op = 'INSERT' or new.status_id is distinct from old.status_id then
    new.completed_at := now();
  else
    new.completed_at := coalesce(old.completed_at, now());  -- clients cannot set it
  end if;
  return new;
end; $$;
create trigger tasks_completed_at before insert or update on public.tasks for each row execute function private.tasks_completed_at();
revoke all on function private.tasks_completed_at() from public, anon, authenticated;

update public.tasks t set completed_at = t.updated_at
from public.statuses s where s.id = t.status_id and s.is_done and t.completed_at is null;

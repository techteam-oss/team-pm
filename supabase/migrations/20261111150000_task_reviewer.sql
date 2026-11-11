-- QA / reviewer on a task: one person who checks the work before it's closed.
alter table public.tasks add column reviewer_id uuid references auth.users(id) on delete set null;
create index tasks_reviewer_idx on public.tasks (reviewer_id) where reviewer_id is not null;

-- The reviewer must be able to see the space, and is auto-added as a watcher.
create or replace function private.tasks_reviewer_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reviewer_id is not null and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id) then
    if coalesce(private.user_space_level(new.reviewer_id, new.space_id), 0) < 1 then
      raise exception 'The QA reviewer must have access to this space' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger tasks_reviewer_check before insert or update of reviewer_id on public.tasks
  for each row execute function private.tasks_reviewer_check();

create or replace function private.tasks_reviewer_watch() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.reviewer_id is not null and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id) then
    insert into public.task_watchers(task_id, user_id, space_id) values (new.id, new.reviewer_id, new.space_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger tasks_reviewer_watch after insert or update of reviewer_id on public.tasks
  for each row execute function private.tasks_reviewer_watch();

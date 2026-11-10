-- Time tracking: timers and manual entries per task. One running timer per user.
create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check (ended_at is null or ended_at - started_at <= interval '24 hours')
);
create index on public.time_entries(task_id);
create index on public.time_entries(user_id, started_at desc);
create index on public.time_entries(space_id, started_at);
create unique index time_entries_one_running on public.time_entries(user_id) where ended_at is null;

create trigger time_entries_inherit before insert or update of task_id on public.time_entries
  for each row execute function private.inherit_from_task();

alter table public.time_entries enable row level security;
create policy "read time" on public.time_entries for select to authenticated
  using (coalesce(private.space_level(space_id),0) >= 1);
create policy "editors log own time" on public.time_entries for insert to authenticated
  with check (user_id = (select auth.uid()) and coalesce(private.space_level(space_id),0) >= 3);
create policy "own or full edits time" on public.time_entries for update to authenticated
  using (user_id = (select auth.uid()) or coalesce(private.space_level(space_id),0) >= 4)
  with check (coalesce(private.space_level(space_id),0) >= 1);
create policy "own or full deletes time" on public.time_entries for delete to authenticated
  using (user_id = (select auth.uid()) or coalesce(private.space_level(space_id),0) >= 4);

-- user_id cannot be changed after insert
create or replace function private.time_entries_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id <> old.user_id then raise exception 'cannot change who logged time'; end if;
  return new;
end; $$;
create trigger time_entries_guard before update on public.time_entries for each row execute function private.time_entries_guard();
revoke all on function private.time_entries_guard() from public, anon, authenticated;

alter publication supabase_realtime add table public.time_entries;

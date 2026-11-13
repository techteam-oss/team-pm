-- Batch 2 (Siraj, 2026-11-13):
--  1. "Blocked by" links between tasks, and a notice when the last blocker is done.
--  2. Storage meter for admins (files and database against the free-plan limits).
--  3. Forgotten-timer reminder: a timer running for 4 hours tells its owner once.
--  4. Late-work alert: 2+ days overdue tells the task's creator, QA reviewer and the admins once.

-- 1. Dependencies -------------------------------------------------------------------------------------
create table public.task_dependencies (
  task_id uuid not null references public.tasks(id) on delete cascade,        -- the task that waits
  blocked_by_id uuid not null references public.tasks(id) on delete cascade,  -- the task it waits on
  space_id uuid not null references public.spaces(id) on delete cascade,      -- the waiting task's space
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (task_id, blocked_by_id),
  check (task_id <> blocked_by_id)
);
create index on public.task_dependencies (blocked_by_id);
create index on public.task_dependencies (space_id);
alter table public.task_dependencies enable row level security;

create or replace function private.dependency_inherit() returns trigger language plpgsql security definer set search_path = '' as $$
declare a record; b record;
begin
  select space_id, workspace_id into a from public.tasks where id = new.task_id;
  select space_id, workspace_id into b from public.tasks where id = new.blocked_by_id;
  if a.space_id is null or b.space_id is null or a.workspace_id <> b.workspace_id then raise exception 'Task not found'; end if;
  -- You must be able to see the blocking task too.
  if coalesce(private.space_level(b.space_id), 0) < 1 then raise exception 'Task not found'; end if;
  -- No loops: the blocker must not (directly or indirectly) wait on this task.
  if exists (
    with recursive chain as (
      select blocked_by_id as id, 1 as depth from public.task_dependencies where task_id = new.blocked_by_id
      union
      select d.blocked_by_id, chain.depth + 1 from public.task_dependencies d join chain on d.task_id = chain.id where chain.depth < 50
    ) select 1 from chain where id = new.task_id
  ) then raise exception 'That would make the tasks wait on each other'; end if;
  new.space_id := a.space_id; new.workspace_id := a.workspace_id;
  return new;
end; $$;
create trigger task_dependencies_inherit before insert on public.task_dependencies for each row execute function private.dependency_inherit();

create policy "read dependencies" on public.task_dependencies for select to authenticated
  using (coalesce(private.space_level(space_id), 0) >= 1);
create policy "editors add dependencies" on public.task_dependencies for insert to authenticated
  with check (coalesce(private.space_level(space_id), 0) >= 3);
create policy "editors remove dependencies" on public.task_dependencies for delete to authenticated
  using (coalesce(private.space_level(space_id), 0) >= 3);
revoke update on public.task_dependencies from authenticated;

-- Keep space_id right when move_task moves the waiting task to another space.
create or replace function private.dependency_follow_move() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.task_dependencies set space_id = new.space_id where task_id = new.id;
  return new;
end; $$;
create trigger tasks_dependency_follow after update of space_id on public.tasks for each row
  when (old.space_id is distinct from new.space_id) execute function private.dependency_follow_move();

-- Log links in the task's activity.
create or replace function private.dependency_log() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; other record;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  select number, title into other from public.tasks where id = r.blocked_by_id;
  insert into public.activity_log(task_id, space_id, user_id, action, details)
  values (r.task_id, r.space_id, auth.uid(), case when tg_op = 'INSERT' then 'blocked_by' else 'unblocked_by' end,
    jsonb_build_object('task', '#' || other.number || ' ' || other.title));
  return null;
exception when foreign_key_violation then return null;  -- task already deleted
end; $$;
create trigger task_dependencies_log after insert or delete on public.task_dependencies for each row execute function private.dependency_log();

-- When a task is done, tell the assignees of every task that no longer waits on anything.
create or replace function private.dependency_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; u uuid;
begin
  if not coalesce((select is_done from public.statuses where id = new.status_id), false)
     or coalesce((select is_done from public.statuses where id = old.status_id), false) then return new; end if;
  for r in
    select t.id, t.title from public.task_dependencies d join public.tasks t on t.id = d.task_id
    where d.blocked_by_id = new.id and not t.archived
      and not exists (select 1 from public.task_dependencies d2 join public.tasks b on b.id = d2.blocked_by_id
                      left join public.statuses s on s.id = b.status_id
                      where d2.task_id = t.id and not coalesce(s.is_done, false))
  loop
    for u in select user_id from public.task_assignees where task_id = r.id loop
      perform private.notify(u, 'blocked_done', r.id, auth.uid(),
        '"' || new.title || '" is done, so you can start "' || r.title || '".');
    end loop;
  end loop;
  return new;
end; $$;
create trigger tasks_dependency_notify after update of status_id on public.tasks for each row execute function private.dependency_notify();

alter publication supabase_realtime add table public.task_dependencies;

-- 2. Storage meter -------------------------------------------------------------------------------------
create or replace function public.storage_usage(ws uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(ws, array['owner','admin']::public.workspace_role[]) then raise exception 'Only admins can see storage' using errcode = '42501'; end if;
  return jsonb_build_object(
    'files_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects),
    'files_count', (select count(*) from storage.objects),
    'attachments_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'attachments'),
    'avatars_bytes', (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects where bucket_id = 'avatars'),
    'database_bytes', pg_database_size(current_database()),
    'files_limit', 1073741824,      -- free plan: 1 GB of files for the organisation
    'database_limit', 524288000     -- free plan: 500 MB database
  );
end; $$;
revoke all on function public.storage_usage(uuid) from public, anon;
grant execute on function public.storage_usage(uuid) to authenticated;

-- 3 + 4. Reminders ------------------------------------------------------------------------------------
create or replace function private.cron_running_timers() returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct task_id from public.time_entries where ended_at is null loop
    perform private.check_estimate(r.task_id);
  end loop;
  -- Forgotten timers: once per time entry, after 4 hours.
  for r in
    select e.id, e.user_id, e.task_id, e.started_at, t.title from public.time_entries e join public.tasks t on t.id = e.task_id
    where e.ended_at is null and e.started_at < now() - interval '4 hours'
      and not exists (select 1 from public.notifications n where n.kind = 'timer_running' and n.data ->> 'entry' = e.id::text)
  loop
    insert into public.notifications(workspace_id, user_id, kind, task_id, actor_id, message, data)
    select t.workspace_id, r.user_id, 'timer_running', r.task_id, null,
      'Your timer on "' || r.title || '" has been running for ' || floor(extract(epoch from now() - r.started_at) / 3600) || ' hours. Stop it if you are not working on it, or fix the time afterwards.',
      jsonb_build_object('entry', r.id)
    from public.tasks t where t.id = r.task_id;
  end loop;
end; $$;

create or replace function private.cron_due_reminders() returns void language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Karachi')::date; r record; u uuid; late text;
begin
  for r in
    select t.id, t.title, t.due_date, a.user_id
    from public.tasks t
    join public.task_assignees a on a.task_id = t.id
    left join public.statuses s on s.id = t.status_id
    where not t.archived and t.due_date is not null and t.due_date <= today and not coalesce(s.is_done, false)
  loop
    if not exists (select 1 from public.notifications n where n.task_id = r.id and n.user_id = r.user_id
                   and n.kind = case when r.due_date = today then 'due_today' else 'overdue' end and n.data ->> 'due' = r.due_date::text) then
      perform private.notify(r.user_id, case when r.due_date = today then 'due_today' else 'overdue' end, r.id, null,
        case when r.due_date = today then '"' || r.title || '" is due today.'
             else '"' || r.title || '" was due on ' || to_char(r.due_date, 'DD Mon') || ' and is not done yet.' end,
        jsonb_build_object('due', r.due_date));
    end if;
  end loop;

  -- Two or more days late: tell the creator, the QA reviewer and the admins, once per due date.
  for r in
    select t.id, t.title, t.due_date, t.workspace_id, t.created_by, t.reviewer_id,
      (select string_agg(private.person(a.user_id), ', ') from public.task_assignees a where a.task_id = t.id) as who
    from public.tasks t left join public.statuses s on s.id = t.status_id
    where not t.archived and t.due_date is not null and t.due_date <= today - 2 and not coalesce(s.is_done, false)
  loop
    late := '"' || r.title || '" is ' || (today - r.due_date) || ' days late (due ' || to_char(r.due_date, 'DD Mon') || ')'
      || case when r.who is null then ' and nobody is assigned.' else '. Assigned to ' || r.who || '.' end;
    for u in
      select r.created_by union select r.reviewer_id
      union select user_id from public.workspace_members where workspace_id = r.workspace_id and role in ('owner','admin')
    loop
      if u is not null and not exists (select 1 from public.notifications n where n.task_id = r.id and n.user_id = u
                                       and n.kind = 'overdue_alert' and n.data ->> 'due' = r.due_date::text)
         and not exists (select 1 from public.task_assignees a where a.task_id = r.id and a.user_id = u) then
        perform private.notify(u, 'overdue_alert', r.id, null, late,
          jsonb_build_object('due', r.due_date, 'subject', left('Late: "' || r.title || '"', 150), 'heading', 'Work is late'));
      end if;
    end loop;
  end loop;
end; $$;

create or replace function private.email_default(kind text) returns boolean language sql immutable set search_path = '' as $$
  select kind in ('mention','assigned','qa_review','ready_for_qa','qa_approved','qa_changes','comment_assigned','estimate_exceeded',
    'due_today','overdue','overdue_alert','feedback','feedback_update','blocked_done','digest','weekly_summary','timer_running')
$$;

revoke all on function private.dependency_inherit(), private.dependency_follow_move(), private.dependency_log(), private.dependency_notify(),
  private.cron_running_timers(), private.cron_due_reminders(), private.email_default(text) from public, anon, authenticated;

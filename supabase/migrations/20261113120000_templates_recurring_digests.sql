-- Batch 3 (Siraj, 2026-11-13):
--  1. Task and list templates (save once, reuse in one click).
--  2. Recurring tasks: finishing one creates the next with a moved due date.
--  3. Daily digest email (one email a weekday morning instead of one per task) and a Monday
--     summary for admins.

alter table public.tasks add column recurrence text check (recurrence in ('daily', 'weekdays', 'weekly', 'monthly'));

-- 0. Copy helpers ---------------------------------------------------------------------------------------
-- A task as plain data: what a template or the next repeat needs (no status, dates, comments or time).
create or replace function private.task_snapshot(p_task uuid, p_depth int default 0) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', t.title, 'description', t.description, 'priority', t.priority,
    'time_estimate_minutes', t.time_estimate_minutes, 'tags', to_jsonb(t.tags), 'reviewer_id', t.reviewer_id,
    'recurrence', t.recurrence,
    'assignees', coalesce((select jsonb_agg(user_id) from public.task_assignees where task_id = t.id), '[]'),
    'checklist', coalesce((select jsonb_agg(title order by position, created_at) from public.checklist_items where task_id = t.id), '[]'),
    'subtasks', case when p_depth >= 3 then '[]'::jsonb else coalesce((
      select jsonb_agg(private.task_snapshot(s.id, p_depth + 1) order by s.position, s.created_at)
      from public.tasks s where s.parent_task_id = t.id and not s.archived), '[]') end)
  from public.tasks t where t.id = p_task
$$;

-- Create a task (and its subtasks and checklist) from a snapshot. People without access to the
-- target space are left off; the caller's permission is checked by the public functions.
create or replace function private.task_from_snapshot(s jsonb, p_list uuid, p_parent uuid, p_due date, p_start date, p_title text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid; sp uuid; st uuid; u text; c text; sub jsonb; i int := 0; rev uuid;
begin
  select space_id into sp from public.lists where id = p_list;
  select id into st from public.statuses where list_id = p_list and not is_done order by position limit 1;
  rev := nullif(s ->> 'reviewer_id', '')::uuid;
  if rev is not null and coalesce(private.user_space_level(rev, sp), 0) < 1 then rev := null; end if;
  insert into public.tasks(list_id, parent_task_id, title, description, priority, time_estimate_minutes, tags, reviewer_id,
    status_id, due_date, start_date, recurrence, position)
  values (p_list, p_parent, left(coalesce(nullif(btrim(p_title), ''), s ->> 'title'), 500), s ->> 'description',
    coalesce(s ->> 'priority', 'normal')::public.task_priority, (s ->> 'time_estimate_minutes')::int,
    coalesce(array(select jsonb_array_elements_text(s -> 'tags')), '{}'), rev, st, p_due, p_start,
    case when p_parent is null then s ->> 'recurrence' end, extract(epoch from now()))
  returning id into new_id;
  for u in select jsonb_array_elements_text(coalesce(s -> 'assignees', '[]')) loop
    if coalesce(private.user_space_level(u::uuid, sp), 0) >= 1 then
      insert into public.task_assignees(task_id, user_id) values (new_id, u::uuid) on conflict do nothing;
    end if;
  end loop;
  for c in select jsonb_array_elements_text(coalesce(s -> 'checklist', '[]')) loop
    i := i + 1;
    insert into public.checklist_items(task_id, title, position) values (new_id, left(c, 500), i);
  end loop;
  for sub in select jsonb_array_elements(coalesce(s -> 'subtasks', '[]')) loop
    perform private.task_from_snapshot(sub, p_list, new_id, null, null);
  end loop;
  return new_id;
end; $$;

-- 1. Templates ------------------------------------------------------------------------------------------
create table public.templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kind text not null check (kind in ('task', 'list')),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  data jsonb not null,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.templates (workspace_id, kind);
alter table public.templates enable row level security;
create policy "members read templates" on public.templates for select to authenticated
  using (private.has_role(workspace_id, array['owner','admin','member','guest']::public.workspace_role[]));
create policy "creator or admin deletes template" on public.templates for delete to authenticated
  using (created_by = (select auth.uid()) or private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy "creator or admin renames template" on public.templates for update to authenticated
  using (created_by = (select auth.uid()) or private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
revoke insert, update on public.templates from authenticated;
grant update (name) on public.templates to authenticated;

create or replace function public.save_task_template(p_task uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare t record; new_id uuid;
begin
  select id, workspace_id, space_id into t from public.tasks where id = p_task;
  if t.id is null or coalesce(private.space_level(t.space_id), 0) < 3 then raise exception 'You need edit access to save this task as a template' using errcode = '42501'; end if;
  insert into public.templates(workspace_id, kind, name, data) values (t.workspace_id, 'task', btrim(p_name), private.task_snapshot(p_task))
  returning id into new_id;
  return new_id;
end; $$;

create or replace function public.save_list_template(p_list uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare l record; new_id uuid;
begin
  select id, workspace_id, space_id into l from public.lists where id = p_list;
  if l.id is null or coalesce(private.space_level(l.space_id), 0) < 3 then raise exception 'You need edit access to save this list as a template' using errcode = '42501'; end if;
  insert into public.templates(workspace_id, kind, name, data) values (l.workspace_id, 'list', btrim(p_name), jsonb_build_object(
    'statuses', (select jsonb_agg(jsonb_build_object('name', name, 'color', color, 'is_done', is_done) order by position) from public.statuses where list_id = p_list),
    'tasks', coalesce((select jsonb_agg(private.task_snapshot(id) order by position, created_at) from public.tasks
                       where list_id = p_list and parent_task_id is null and not archived), '[]')))
  returning id into new_id;
  return new_id;
end; $$;

create or replace function public.use_task_template(p_template uuid, p_list uuid, p_title text default null, p_due date default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tp record; l record;
begin
  select * into tp from public.templates where id = p_template and kind = 'task';
  select id, workspace_id, space_id into l from public.lists where id = p_list and not archived;
  if tp.id is null or l.id is null or tp.workspace_id <> l.workspace_id then raise exception 'Template or list not found'; end if;
  if coalesce(private.space_level(l.space_id), 0) < 3 then raise exception 'You need edit access to add tasks here' using errcode = '42501'; end if;
  return private.task_from_snapshot(tp.data, p_list, null, p_due, null, p_title);
end; $$;

create or replace function public.use_list_template(p_template uuid, p_space uuid, p_folder uuid, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare tp record; sp record; new_list uuid; s jsonb; i int := 0; t jsonb;
begin
  select * into tp from public.templates where id = p_template and kind = 'list';
  select id, workspace_id into sp from public.spaces where id = p_space;
  if tp.id is null or sp.id is null or tp.workspace_id <> sp.workspace_id then raise exception 'Template or space not found'; end if;
  if coalesce(private.space_level(p_space), 0) < 4 then raise exception 'You need full access to the space to add lists' using errcode = '42501'; end if;
  if p_folder is not null and not exists (select 1 from public.folders where id = p_folder and space_id = p_space) then raise exception 'Folder not found'; end if;
  insert into public.lists(space_id, folder_id, name) values (p_space, p_folder, left(coalesce(nullif(btrim(p_name), ''), tp.name), 200)) returning id into new_list;
  -- Use the template's statuses instead of the defaults.
  if jsonb_array_length(coalesce(tp.data -> 'statuses', '[]')) > 0 then
    delete from public.statuses where list_id = new_list;
    for s in select jsonb_array_elements(tp.data -> 'statuses') loop
      i := i + 1;
      insert into public.statuses(list_id, space_id, workspace_id, name, color, position, is_done)
      values (new_list, p_space, sp.workspace_id, s ->> 'name', coalesce(s ->> 'color', '#9aa1ad'), i, coalesce((s ->> 'is_done')::boolean, false));
    end loop;
  end if;
  for t in select jsonb_array_elements(coalesce(tp.data -> 'tasks', '[]')) loop
    perform private.task_from_snapshot(t, new_list, null, null, null);
  end loop;
  return new_list;
end; $$;

revoke all on function public.save_task_template(uuid, text), public.save_list_template(uuid, text),
  public.use_task_template(uuid, uuid, text, date), public.use_list_template(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.save_task_template(uuid, text), public.save_list_template(uuid, text),
  public.use_task_template(uuid, uuid, text, date), public.use_list_template(uuid, uuid, uuid, text) to authenticated;

-- 2. Recurring tasks ------------------------------------------------------------------------------------
create or replace function private.next_date(d date, rule text) returns date language sql immutable set search_path = '' as $$
  select case rule
    when 'daily' then d + 1
    when 'weekdays' then d + case extract(isodow from d)::int when 5 then 3 when 6 then 2 else 1 end
    when 'weekly' then d + 7
    when 'monthly' then (d + interval '1 month')::date
  end
$$;

-- When a repeating task is finished, create the next one and hand the repeat over to it.
create or replace function private.tasks_recur() returns trigger language plpgsql security definer set search_path = '' as $$
declare base date; nxt date; new_id uuid; new_no bigint;
begin
  if new.recurrence is null or new.archived or new.parent_task_id is not null then return new; end if;
  if not coalesce((select is_done from public.statuses where id = new.status_id), false)
     or coalesce((select is_done from public.statuses where id = old.status_id), false) then return new; end if;
  base := coalesce(new.due_date, (now() at time zone 'Asia/Karachi')::date);
  nxt := private.next_date(base, new.recurrence);
  -- Never schedule into the past (a task finished late jumps ahead to the next date after today).
  while nxt < (now() at time zone 'Asia/Karachi')::date loop
    nxt := private.next_date(nxt, new.recurrence);
  end loop;
  new_id := private.task_from_snapshot(private.task_snapshot(new.id), new.list_id, null, nxt,
    case when new.start_date is not null and new.due_date is not null then nxt - (new.due_date - new.start_date) end);
  update public.tasks set recurrence = null where id = new.id;
  select number into new_no from public.tasks where id = new_id;
  insert into public.activity_log(task_id, space_id, user_id, action, details)
  values (new.id, new.space_id, auth.uid(), 'recurred', jsonb_build_object('next', '#' || new_no, 'due', nxt)),
         (new_id, new.space_id, auth.uid(), 'repeat_of', jsonb_build_object('previous', '#' || new.number));
  return new;
end; $$;
create trigger tasks_recur after update of status_id on public.tasks for each row execute function private.tasks_recur();

-- 3. Digests ---------------------------------------------------------------------------------------------
-- Due/overdue reminders stay in the bell; by default the morning digest emails them in one go.
create or replace function private.email_default(kind text) returns boolean language sql immutable set search_path = '' as $$
  select kind in ('mention','assigned','qa_review','ready_for_qa','qa_approved','qa_changes','comment_assigned','estimate_exceeded',
    'overdue_alert','feedback','feedback_update','blocked_done','digest','weekly_summary','timer_running')
$$;

create or replace function private.list_titles(titles text[], n int default 5) returns text language sql immutable set search_path = '' as $$
  select case when coalesce(array_length(titles, 1), 0) = 0 then ''
    else array_to_string(titles[1:n], ', ') || case when array_length(titles, 1) > n then ' and ' || (array_length(titles, 1) - n) || ' more' else '' end end
$$;

-- Weekday mornings, 09:05 Pakistan time: one digest per person who has something on their plate.
create or replace function private.cron_daily_digest() returns void language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Karachi')::date; r record; parts text[]; total int;
begin
  if extract(isodow from today) > 5 then return; end if;
  for r in
    select m.workspace_id, m.user_id,
      array(select '"' || t.title || '"' from public.tasks t join public.task_assignees a on a.task_id = t.id left join public.statuses s on s.id = t.status_id
            where a.user_id = m.user_id and t.workspace_id = m.workspace_id and not t.archived and not coalesce(s.is_done, false) and t.due_date = today order by t.priority, t.title) as due_today,
      array(select '"' || t.title || '"' from public.tasks t join public.task_assignees a on a.task_id = t.id left join public.statuses s on s.id = t.status_id
            where a.user_id = m.user_id and t.workspace_id = m.workspace_id and not t.archived and not coalesce(s.is_done, false) and t.due_date < today order by t.due_date) as overdue,
      array(select '"' || t.title || '"' from public.tasks t
            where t.reviewer_id = m.user_id and t.workspace_id = m.workspace_id and not t.archived and t.qa_state = 'pending' order by t.updated_at) as to_review,
      array(select '"' || t.title || '"' from public.tasks t join public.task_assignees a on a.task_id = t.id
            where a.user_id = m.user_id and t.workspace_id = m.workspace_id and not t.archived and t.qa_state = 'changes') as sent_back,
      (select count(*) from public.tasks t join public.task_assignees a on a.task_id = t.id left join public.statuses s on s.id = t.status_id
            where a.user_id = m.user_id and t.workspace_id = m.workspace_id and not t.archived and not coalesce(s.is_done, false)) as open_count
    from public.workspace_members m
  loop
    total := coalesce(array_length(r.due_today, 1), 0) + coalesce(array_length(r.overdue, 1), 0)
           + coalesce(array_length(r.to_review, 1), 0) + coalesce(array_length(r.sent_back, 1), 0);
    continue when total = 0;
    continue when exists (select 1 from public.notifications where user_id = r.user_id and kind = 'digest' and data ->> 'day' = today::text);
    parts := array[]::text[];
    if array_length(r.overdue, 1) > 0 then parts := parts || ('Overdue (' || array_length(r.overdue, 1) || '): ' || private.list_titles(r.overdue) || '.'); end if;
    if array_length(r.due_today, 1) > 0 then parts := parts || ('Due today (' || array_length(r.due_today, 1) || '): ' || private.list_titles(r.due_today) || '.'); end if;
    if array_length(r.sent_back, 1) > 0 then parts := parts || ('Sent back by QA (' || array_length(r.sent_back, 1) || '): ' || private.list_titles(r.sent_back) || '.'); end if;
    if array_length(r.to_review, 1) > 0 then parts := parts || ('Waiting for your QA (' || array_length(r.to_review, 1) || '): ' || private.list_titles(r.to_review) || '.'); end if;
    parts := parts || ('You have ' || r.open_count || ' open task' || case when r.open_count = 1 then '' else 's' end || ' in total.');
    insert into public.notifications(workspace_id, user_id, kind, task_id, actor_id, message, data)
    values (r.workspace_id, r.user_id, 'digest', null, null, array_to_string(parts, ' '),
      jsonb_build_object('day', today, 'path', '#/my', 'button', 'Open my tasks', 'heading', 'Your day',
        'subject', 'Your day: ' || total || case when total = 1 then ' thing needs' else ' things need' end || ' you today'));
  end loop;
end; $$;

-- Monday 09:10 Pakistan time: last week at a glance for owners and admins.
create or replace function private.cron_weekly_summary() returns void language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Karachi')::date; w record; u uuid; msg text; files_pct int;
begin
  files_pct := round(100.0 * (select coalesce(sum((metadata ->> 'size')::bigint), 0) from storage.objects) / 1073741824);
  for w in
    select ws.id, ws.name,
      (select count(*) from public.tasks t where t.workspace_id = ws.id and t.completed_at >= now() - interval '7 days') as done,
      (select count(*) from public.tasks t where t.workspace_id = ws.id and t.qa_state = 'approved' and t.qa_at >= now() - interval '7 days') as approved,
      (select count(*) from public.activity_log l join public.tasks t on t.id = l.task_id where t.workspace_id = ws.id and l.action = 'qa_changes' and l.created_at >= now() - interval '7 days') as sent_back,
      (select count(*) from public.tasks t left join public.statuses s on s.id = t.status_id
         where t.workspace_id = ws.id and not t.archived and not coalesce(s.is_done, false) and t.due_date < today) as overdue,
      (select count(*) from public.tasks t where t.workspace_id = ws.id and not t.archived and t.qa_state = 'pending') as waiting_qa,
      (select round(coalesce(sum(extract(epoch from coalesce(e.ended_at, now()) - e.started_at)), 0) / 3600, 1)
         from public.time_entries e join public.tasks t on t.id = e.task_id where t.workspace_id = ws.id and e.started_at >= now() - interval '7 days') as hours,
      (select string_agg(x.who || ' (' || x.n || ')', ', ') from (
         select private.person(t.completed_by) as who, count(*) as n from public.tasks t
         where t.workspace_id = ws.id and t.completed_at >= now() - interval '7 days' and t.completed_by is not null
         group by t.completed_by order by count(*) desc limit 3) x) as top
    from public.workspaces ws
  loop
    msg := 'Last 7 days: ' || w.done || ' task' || case when w.done = 1 then '' else 's' end || ' finished, '
      || w.approved || ' approved by QA, ' || w.sent_back || ' sent back for changes, ' || w.hours || ' hours tracked. '
      || 'Right now: ' || w.overdue || ' overdue, ' || w.waiting_qa || ' waiting for QA.'
      || case when w.top is not null then ' Most tasks finished: ' || w.top || '.' else '' end
      || case when files_pct >= 80 then ' Storage is ' || files_pct || '% full: see Settings.' else '' end;
    for u in select user_id from public.workspace_members where workspace_id = w.id and role in ('owner', 'admin') loop
      continue when exists (select 1 from public.notifications where user_id = u and kind = 'weekly_summary' and data ->> 'week' = today::text);
      insert into public.notifications(workspace_id, user_id, kind, task_id, actor_id, message, data)
      values (w.id, u, 'weekly_summary', null, null, msg,
        jsonb_build_object('week', today, 'path', '#/workload', 'button', 'Open workload', 'heading', 'Your week at ' || w.name,
          'subject', 'Weekly summary: ' || w.done || ' done, ' || w.overdue || ' overdue'));
    end loop;
  end loop;
end; $$;

select cron.schedule('team-pm-daily-digest', '5 4 * * 1-5', 'select private.cron_daily_digest()');
select cron.schedule('team-pm-weekly-summary', '10 4 * * 1', 'select private.cron_weekly_summary()');

revoke all on function private.task_snapshot(uuid, int), private.task_from_snapshot(jsonb, uuid, uuid, date, date, text),
  private.next_date(date, text), private.tasks_recur(), private.email_default(text), private.list_titles(text[], int),
  private.cron_daily_digest(), private.cron_weekly_summary() from public, anon, authenticated;

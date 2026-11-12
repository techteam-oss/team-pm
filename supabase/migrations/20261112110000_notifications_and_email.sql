-- In-app notifications, emails through GoHighLevel, and scheduled checks (Siraj, 2026-11-12).
-- Every notification row can also be emailed: the database POSTs it to the workspace's GHL inbound
-- webhook (pg_net), and one GHL workflow sends it from sub-account 1. All emails share one payload:
-- {event, email, name, subject, heading, message, button_text, link, task, actor, workspace}.

-- 1. Workspace settings, set by owners/admins on the Settings page.
create table public.workspace_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  ghl_webhook_url text check (ghl_webhook_url is null or ghl_webhook_url ~ '^https://[^\s]+$'),
  app_url text not null default 'https://techteam-oss.github.io/team-pm/' check (app_url ~ '^https://[^\s]+/$'),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null default auth.uid()
);
alter table public.workspace_settings enable row level security;
create policy "admins read settings" on public.workspace_settings for select to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy "admins add settings" on public.workspace_settings for insert to authenticated
  with check (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy "admins change settings" on public.workspace_settings for update to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));

-- 2. Per-person email choices. Missing keys fall back to private.email_default().
alter table public.profiles add column email_prefs jsonb not null default '{}';
grant update (email_prefs) on public.profiles to authenticated;

create or replace function private.email_default(kind text) returns boolean language sql immutable set search_path = '' as $$
  select kind in ('mention','assigned','qa_review','ready_for_qa','comment_assigned','estimate_exceeded','due_today','overdue')
$$;

-- 3. Notifications.
create table public.notifications (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null,
  task_id uuid references public.tasks(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  message text not null,
  data jsonb not null default '{}',
  read_at timestamptz,
  emailed boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.notifications(user_id, created_at desc);
create index on public.notifications(task_id, kind);
alter table public.notifications enable row level security;
create policy "read own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "mark own notifications" on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own notifications" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;
alter publication supabase_realtime add table public.notifications;

-- notify(): one row per person, never to the person who did it, only to people who can open the task.
create or replace function private.notify(p_user uuid, p_kind text, p_task uuid, p_actor uuid, p_message text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare t record;
begin
  if p_user is null or p_user is not distinct from p_actor then return; end if;
  select id, workspace_id, space_id into t from public.tasks where id = p_task;
  if t.id is null or coalesce(private.user_space_level(p_user, t.space_id), 0) < 1 then return; end if;
  insert into public.notifications(workspace_id, user_id, kind, task_id, actor_id, message, data)
  values (t.workspace_id, p_user, p_kind, p_task, p_actor, p_message, p_data);
end; $$;

create or replace function private.person(uid uuid) returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select coalesce(nullif(full_name, ''), split_part(email, '@', 1)) from public.profiles where id = uid), 'Someone')
$$;

-- Email the notification through GHL if the workspace has a webhook and the person wants this kind.
create or replace function private.email_notification() returns trigger language plpgsql security definer set search_path = '' as $$
declare s record; p record; t record; subj text; head text; btn text := 'Open task'; link text;
begin
  select ghl_webhook_url, app_url into s from public.workspace_settings where workspace_id = new.workspace_id;
  if s.ghl_webhook_url is null then return new; end if;
  select email, coalesce(nullif(full_name, ''), split_part(email, '@', 1)) as name, email_prefs into p from public.profiles where id = new.user_id;
  if p.email is null or not coalesce((p.email_prefs ->> new.kind)::boolean, private.email_default(new.kind)) then return new; end if;
  select tk.id, tk.number, tk.title, tk.list_id, w.name as ws into t
    from public.tasks tk join public.workspaces w on w.id = tk.workspace_id where tk.id = new.task_id;
  link := s.app_url || '#/list/' || t.list_id || '?task=' || t.id;
  subj := case new.kind
    when 'mention' then private.person(new.actor_id) || ' mentioned you on "' || t.title || '"'
    when 'comment' then 'New comment on "' || t.title || '"'
    when 'comment_assigned' then private.person(new.actor_id) || ' assigned you a comment on "' || t.title || '"'
    when 'assigned' then 'You were assigned "' || t.title || '"'
    when 'qa_review' then 'You are the QA reviewer for "' || t.title || '"'
    when 'ready_for_qa' then '"' || t.title || '" is ready for your QA review'
    when 'completed' then '"' || t.title || '" was completed'
    when 'estimate_exceeded' then '"' || t.title || '" went over its time estimate'
    when 'due_today' then '"' || t.title || '" is due today'
    when 'overdue' then '"' || t.title || '" is overdue'
    else 'Update on "' || t.title || '"' end;
  head := case new.kind when 'estimate_exceeded' then 'Time estimate exceeded' when 'overdue' then 'Task overdue'
    when 'due_today' then 'Due today' when 'mention' then 'You were mentioned' when 'assigned' then 'New task for you'
    when 'qa_review' then 'QA review assigned' when 'ready_for_qa' then 'Ready for QA' else 'Task update' end;
  perform net.http_post(
    url := s.ghl_webhook_url,
    body := jsonb_build_object('event', new.kind, 'email', p.email, 'name', p.name, 'subject', left(subj, 180),
      'heading', head, 'message', new.message, 'button_text', btn, 'link', link,
      'task', t.title, 'task_number', t.number, 'actor', case when new.actor_id is null then '' else private.person(new.actor_id) end, 'workspace', t.ws),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  update public.notifications set emailed = true where id = new.id;
  return new;
exception when others then
  return new;   -- an email problem must never block the action that caused it
end; $$;
create trigger notifications_email after insert on public.notifications for each row execute function private.email_notification();

-- 4. What creates notifications.
-- Comments: mentions, assigned comments, and everyone else watching or assigned to the task.
create or replace function private.comment_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare mentioned uuid[]; who text := private.person(new.user_id); title text; snippet text; u uuid;
begin
  select tk.title into title from public.tasks tk where tk.id = new.task_id;
  snippet := left(regexp_replace(new.body, '@\[([^\]]{1,80})\]\([0-9a-f-]{36}\)', '@\1', 'g'), 300);
  select coalesce(array_agg(distinct m[1]::uuid), '{}') into mentioned
    from regexp_matches(new.body, '@\[[^\]]{1,80}\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)', 'g') as m;
  foreach u in array mentioned loop
    perform private.notify(u, 'mention', new.task_id, new.user_id, who || ' mentioned you: "' || snippet || '"');
  end loop;
  if new.assigned_to is not null and not (new.assigned_to = any(mentioned)) then
    perform private.notify(new.assigned_to, 'comment_assigned', new.task_id, new.user_id, who || ' assigned you a comment: "' || snippet || '"');
  end if;
  for u in
    select user_id from public.task_watchers where task_id = new.task_id
    union select user_id from public.task_assignees where task_id = new.task_id
  loop
    if not (u = any(mentioned)) and u is distinct from new.assigned_to then
      perform private.notify(u, 'comment', new.task_id, new.user_id, who || ' commented on "' || title || '": "' || snippet || '"');
    end if;
  end loop;
  return new;
end; $$;
create trigger comments_notify after insert on public.comments for each row execute function private.comment_notify();

create or replace function private.assignee_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.notify(new.user_id, 'assigned', new.task_id, auth.uid(),
    private.person(auth.uid()) || ' assigned you to "' || (select title from public.tasks where id = new.task_id) || '"');
  return new;
end; $$;
create trigger assignees_notify after insert on public.task_assignees for each row execute function private.assignee_notify();

create or replace function private.task_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare done_now boolean; was_done boolean;
begin
  if new.reviewer_id is not null and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id) then
    perform private.notify(new.reviewer_id, 'qa_review', new.id, auth.uid(),
      private.person(auth.uid()) || ' made you the QA reviewer for "' || new.title || '"');
  end if;
  if tg_op = 'UPDATE' and new.status_id is distinct from old.status_id then
    select is_done into done_now from public.statuses where id = new.status_id;
    select is_done into was_done from public.statuses where id = old.status_id;
    if coalesce(done_now, false) and not coalesce(was_done, false) then
      perform private.notify(new.reviewer_id, 'ready_for_qa', new.id, auth.uid(),
        private.person(auth.uid()) || ' finished "' || new.title || '". It is ready for your QA review.');
      if new.created_by is distinct from new.reviewer_id then
        perform private.notify(new.created_by, 'completed', new.id, auth.uid(), private.person(auth.uid()) || ' completed "' || new.title || '"');
      end if;
    end if;
  end if;
  return new;
end; $$;
create trigger tasks_notify after insert or update of reviewer_id, status_id on public.tasks for each row execute function private.task_notify();

-- Time estimate: once spent time passes the estimate, tell the assignees, the creator and the workspace admins.
-- Sent once per estimate value (raising the estimate re-arms it).
create or replace function private.check_estimate(p_task uuid) returns void language plpgsql security definer set search_path = '' as $$
declare t record; spent numeric; u uuid; msg text;
begin
  select id, title, workspace_id, created_by, time_estimate_minutes as est into t from public.tasks where id = p_task and not archived;
  if t.id is null or coalesce(t.est, 0) <= 0 then return; end if;
  select coalesce(sum(extract(epoch from coalesce(ended_at, now()) - started_at)) / 60, 0) into spent from public.time_entries where task_id = p_task;
  if spent <= t.est then return; end if;
  if exists (select 1 from public.notifications where task_id = p_task and kind = 'estimate_exceeded' and (data ->> 'estimate')::int = t.est) then return; end if;
  msg := '"' || t.title || '" has ' || round(spent / 60, 1) || ' h logged against an estimate of ' || round(t.est / 60.0, 1) || ' h.';
  for u in
    select user_id from public.task_assignees where task_id = p_task
    union select t.created_by
    union select user_id from public.workspace_members where workspace_id = t.workspace_id and role in ('owner','admin')
  loop
    perform private.notify(u, 'estimate_exceeded', p_task, null, msg, jsonb_build_object('estimate', t.est, 'spent', round(spent)));
  end loop;
end; $$;

create or replace function private.time_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.check_estimate(new.task_id); return new; end; $$;
create trigger time_entries_notify after insert or update on public.time_entries for each row execute function private.time_notify();

create or replace function private.estimate_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin perform private.check_estimate(new.id); return new; end; $$;
create trigger tasks_estimate_notify after update of time_estimate_minutes on public.tasks for each row
  when (new.time_estimate_minutes is distinct from old.time_estimate_minutes) execute function private.estimate_notify();

-- 5. Scheduled checks (pg_cron).
create extension if not exists pg_cron;

-- Running timers can cross the estimate without anyone pressing stop.
create or replace function private.cron_running_timers() returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select distinct task_id from public.time_entries where ended_at is null loop
    perform private.check_estimate(r.task_id);
  end loop;
end; $$;

-- Morning reminders (09:00 Pakistan time): due today and overdue, once per task per due date.
create or replace function private.cron_due_reminders() returns void language plpgsql security definer set search_path = '' as $$
declare today date := (now() at time zone 'Asia/Karachi')::date; r record;
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
end; $$;

create or replace function private.cron_cleanup() returns void language sql security definer set search_path = '' as $$
  delete from public.notifications where read_at is not null and created_at < now() - interval '60 days';
$$;

select cron.schedule('team-pm-running-timers', '*/10 * * * *', 'select private.cron_running_timers()');
select cron.schedule('team-pm-due-reminders', '0 4 * * *', 'select private.cron_due_reminders()');
select cron.schedule('team-pm-cleanup', '30 3 * * 0', 'select private.cron_cleanup()');

-- 6. Admin "send me a test email" button.
create or replace function public.send_test_email(ws uuid) returns text language plpgsql security definer set search_path = '' as $$
declare s record; p record;
begin
  if not private.has_role(ws, array['owner','admin']::public.workspace_role[]) then raise exception 'Only admins can do this' using errcode = '42501'; end if;
  select ghl_webhook_url, app_url into s from public.workspace_settings where workspace_id = ws;
  if s.ghl_webhook_url is null then raise exception 'Add the GHL webhook URL first'; end if;
  select email, coalesce(nullif(full_name, ''), split_part(email, '@', 1)) as name into p from public.profiles where id = auth.uid();
  perform net.http_post(url := s.ghl_webhook_url,
    body := jsonb_build_object('event', 'test', 'email', p.email, 'name', p.name, 'subject', 'Test email from your project tool',
      'heading', 'Emails are working', 'message', 'If you can read this, GoHighLevel is sending emails for the project tool.',
      'button_text', 'Open the app', 'link', s.app_url, 'task', '', 'task_number', '', 'actor', '', 'workspace', (select name from public.workspaces where id = ws)),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return p.email;
end; $$;
revoke all on function public.send_test_email(uuid) from public, anon;
grant execute on function public.send_test_email(uuid) to authenticated;

revoke all on function private.notify(uuid, text, uuid, uuid, text, jsonb), private.person(uuid), private.email_notification(),
  private.comment_notify(), private.assignee_notify(), private.task_notify(), private.check_estimate(uuid), private.time_notify(),
  private.estimate_notify(), private.cron_running_timers(), private.cron_due_reminders(), private.cron_cleanup(), private.email_default(text)
  from public, anon, authenticated;

-- Mandatory launch fixes (Siraj, 2026-11-12), from the 6/10 review:
--  1. member_login_status(): lets admins see who never finished their invite, for the "Resend invite" button.
--  2. allow_auth_email(): rate limit for emails the public "Forgot password" form can trigger.
--  3. Notifications that are not about a task (feedback) carry their own link and subject in data.
--  4. In-app feedback, with admin triage and a reply that notifies the author.
--  5. Nightly backups inside the database (kept 14 days) and an admin "Download backup".

-- 1. Account status per member (admins only).
create or replace function public.member_login_status(ws uuid)
returns table (member_id uuid, has_password boolean, confirmed boolean, invited_at timestamptz, last_sign_in_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(ws, array['owner','admin']::public.workspace_role[]) then
    raise exception 'Only admins can see this' using errcode = '42501';
  end if;
  return query
    select u.id, coalesce(u.encrypted_password, '') <> '', u.email_confirmed_at is not null, u.invited_at, u.last_sign_in_at
    from auth.users u join public.workspace_members m on m.user_id = u.id and m.workspace_id = ws;
end; $$;
revoke all on function public.member_login_status(uuid) from public, anon;
grant execute on function public.member_login_status(uuid) to authenticated;

-- 2. Rate limit: at most 3 emails per address and 10 per IP address an hour, from public forms.
create table private.auth_email_log (
  id bigint generated always as identity primary key,
  kind text not null,
  email text not null,
  ip text,
  created_at timestamptz not null default now()
);
create index on private.auth_email_log (email, created_at);
create index on private.auth_email_log (ip, created_at);

create or replace function public.allow_auth_email(p_kind text, p_email text, p_ip text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare by_email int; by_ip int;
begin
  select count(*) into by_email from private.auth_email_log where email = lower(p_email) and created_at > now() - interval '1 hour';
  select count(*) into by_ip from private.auth_email_log where p_ip is not null and ip = p_ip and created_at > now() - interval '1 hour';
  if by_email >= 3 or by_ip >= 10 then return false; end if;
  insert into private.auth_email_log(kind, email, ip) values (p_kind, lower(p_email), p_ip);
  return true;
end; $$;
revoke all on function public.allow_auth_email(text, text, text) from public, anon, authenticated;
grant execute on function public.allow_auth_email(text, text, text) to service_role;

-- 3. Emails for notifications. Task notifications as before; task-less ones (feedback) use
--    data.path / data.subject / data.heading / data.button.
create or replace function private.email_default(kind text) returns boolean language sql immutable set search_path = '' as $$
  select kind in ('mention','assigned','qa_review','ready_for_qa','comment_assigned','estimate_exceeded','due_today','overdue','feedback','feedback_update')
$$;

create or replace function private.email_notification() returns trigger language plpgsql security definer set search_path = '' as $$
declare s record; p record; t record; subj text; head text; btn text := 'Open task'; link text; ws text;
begin
  select ghl_webhook_url, app_url into s from public.workspace_settings where workspace_id = new.workspace_id;
  if s.ghl_webhook_url is null then return new; end if;
  select email, coalesce(nullif(full_name, ''), split_part(email, '@', 1)) as name, email_prefs into p from public.profiles where id = new.user_id;
  if p.email is null or not coalesce((p.email_prefs ->> new.kind)::boolean, private.email_default(new.kind)) then return new; end if;
  if new.task_id is null then
    select name into ws from public.workspaces where id = new.workspace_id;
    link := s.app_url || coalesce(new.data ->> 'path', '');
    subj := coalesce(new.data ->> 'subject', 'Update from Impact Hub');
    head := coalesce(new.data ->> 'heading', 'Update');
    btn := coalesce(new.data ->> 'button', 'Open the app');
    t := null;
  else
    select tk.id, tk.number, tk.title, tk.list_id, w.name as ws into t
      from public.tasks tk join public.workspaces w on w.id = tk.workspace_id where tk.id = new.task_id;
    ws := t.ws;
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
  end if;
  perform net.http_post(
    url := s.ghl_webhook_url,
    body := jsonb_build_object('event', new.kind, 'email', p.email, 'name', p.name, 'subject', left(subj, 180),
      'heading', head, 'message', new.message, 'button_text', btn, 'link', link,
      'task', coalesce(t.title, ''), 'task_number', coalesce(t.number::text, ''),
      'actor', case when new.actor_id is null then '' else private.person(new.actor_id) end, 'workspace', coalesce(ws, '')),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  update public.notifications set emailed = true where id = new.id;
  return new;
exception when others then
  return new;   -- an email problem must never block the action that caused it
end; $$;

-- 4. Feedback.
create table public.feedback (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null default auth.uid(),
  kind text not null check (kind in ('bug','idea','question')),
  blocking boolean not null default false,
  message text not null check (length(btrim(message)) between 3 and 4000),
  page text check (length(page) <= 500),
  device text check (length(device) <= 500),
  status text not null default 'new' check (status in ('new','planned','done','wont_do')),
  admin_note text check (length(admin_note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.feedback(workspace_id, created_at desc);
create index on public.feedback(user_id);
alter table public.feedback enable row level security;
create policy "members send feedback" on public.feedback for insert to authenticated
  with check (user_id = (select auth.uid()) and status = 'new' and admin_note is null
    and private.has_role(workspace_id, array['owner','admin','member','guest']::public.workspace_role[]));
create policy "admins and authors read feedback" on public.feedback for select to authenticated
  using (user_id = (select auth.uid()) or private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy "admins triage feedback" on public.feedback for update to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]))
  with check (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
revoke update, delete on public.feedback from authenticated;
grant update (status, admin_note) on public.feedback to authenticated;

create or replace function private.feedback_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
create trigger feedback_touch before update on public.feedback for each row execute function private.feedback_touch();

-- New feedback: tell every owner and admin (in the bell, and by email through GHL).
create or replace function private.feedback_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare u uuid; who text := private.person(new.user_id); what text;
begin
  what := case new.kind when 'bug' then 'a problem' when 'idea' then 'an idea' else 'a question' end;
  for u in select user_id from public.workspace_members where workspace_id = new.workspace_id and role in ('owner','admin') loop
    if u is distinct from new.user_id then
      insert into public.notifications(workspace_id, user_id, kind, task_id, actor_id, message, data)
      values (new.workspace_id, u, 'feedback', null, new.user_id,
        who || case when new.blocking then ' is blocked and reported ' else ' sent ' end || what || ': "' || left(new.message, 300) || '"',
        jsonb_build_object('path', '#/feedback?id=' || new.id, 'feedback_id', new.id, 'blocking', new.blocking, 'button', 'Open feedback',
          'subject', case when new.blocking then 'Blocker: ' else '' end || who || ' sent feedback about Impact Hub',
          'heading', case when new.blocking then 'Someone is blocked' else 'New feedback' end));
    end if;
  end loop;
  return new;
end; $$;
create trigger feedback_notify after insert on public.feedback for each row execute function private.feedback_notify();

-- Status change or reply: tell the person who sent it.
create or replace function private.feedback_update_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  if new.user_id is null or new.user_id is not distinct from auth.uid() then return new; end if;
  if new.status is not distinct from old.status and new.admin_note is not distinct from old.admin_note then return new; end if;
  st := case new.status when 'new' then 'New' when 'planned' then 'Planned' when 'done' then 'Done' else 'Won''t do' end;
  insert into public.notifications(workspace_id, user_id, kind, task_id, actor_id, message, data)
  values (new.workspace_id, new.user_id, 'feedback_update', null, auth.uid(),
    private.person(auth.uid()) || ' updated your feedback "' || left(new.message, 80) || '" to ' || st
      || coalesce(': "' || left(nullif(btrim(new.admin_note), ''), 300) || '"', '.'),
    jsonb_build_object('path', '#/feedback?id=' || new.id, 'feedback_id', new.id, 'button', 'See the reply',
      'subject', 'Your feedback is now: ' || st, 'heading', 'Reply to your feedback'));
  return new;
end; $$;
create trigger feedback_update_notify after update of status, admin_note on public.feedback for each row execute function private.feedback_update_notify();

-- 5. Backups. A full copy of each workspace every night (02:00 Pakistan time), kept for 14 days.
--    Files in storage are not included (only their records).
create table private.backups (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,              -- no foreign key, so a deleted workspace keeps its backups
  taken_at timestamptz not null default now(),
  data jsonb not null
);
create index on private.backups(workspace_id, taken_at desc);

create or replace function private.workspace_snapshot(ws uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare res jsonb := jsonb_build_object('format', 'team-pm-backup', 'version', 1, 'taken_at', now(), 'workspace_id', ws);
  t text; rows jsonb; sp uuid[];
begin
  select coalesce(array_agg(id), '{}') into sp from public.spaces where workspace_id = ws;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into rows from public.workspaces x where x.id = ws;
  res := res || jsonb_build_object('workspaces', rows);
  foreach t in array array['workspace_members','workspace_settings','spaces','folders','lists','statuses','tasks','audit_log','feedback'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where x.workspace_id = $1', t) into rows using ws;
    res := res || jsonb_build_object(t, rows);
  end loop;
  foreach t in array array['space_members','task_assignees','task_watchers','comments','comment_reactions','checklist_items','attachments','time_entries','activity_log'] loop
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]'') from public.%I x where x.space_id = any($1)', t) into rows using sp;
    res := res || jsonb_build_object(t, rows);
  end loop;
  select coalesce(jsonb_agg(to_jsonb(x)), '[]') into rows from public.profiles x
    where x.id in (select user_id from public.workspace_members where workspace_id = ws);
  return res || jsonb_build_object('profiles', rows);
end; $$;

create or replace function private.cron_backup() returns void language plpgsql security definer set search_path = '' as $$
declare w uuid;
begin
  for w in select id from public.workspaces loop
    insert into private.backups(workspace_id, data) values (w, private.workspace_snapshot(w));
  end loop;
  delete from private.backups where taken_at < now() - interval '14 days';
end; $$;
select cron.schedule('team-pm-nightly-backup', '0 21 * * *', 'select private.cron_backup()');

create or replace function public.backup_status(ws uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_role(ws, array['owner','admin']::public.workspace_role[]) then raise exception 'Only admins can see backups' using errcode = '42501'; end if;
  return (select jsonb_build_object('count', count(*), 'latest', max(taken_at), 'oldest', min(taken_at),
    'size', pg_size_pretty(coalesce(sum(pg_column_size(data)), 0)::bigint)) from private.backups where workspace_id = ws);
end; $$;

-- Admin download: the same snapshot, built on demand. Recorded in the activity log.
create or replace function public.export_workspace(ws uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_role(ws, array['owner','admin']::public.workspace_role[]) then raise exception 'Only admins can download backups' using errcode = '42501'; end if;
  insert into public.audit_log(workspace_id, actor_id, action, entity, name, details)
    values (ws, auth.uid(), 'exported', 'workspace', (select name from public.workspaces where id = ws), '{}');
  return private.workspace_snapshot(ws);
end; $$;
revoke all on function public.backup_status(uuid), public.export_workspace(uuid) from public, anon;
grant execute on function public.backup_status(uuid), public.export_workspace(uuid) to authenticated;

-- Weekly cleanup also clears the rate-limit log.
create or replace function private.cron_cleanup() returns void language sql security definer set search_path = '' as $$
  delete from public.notifications where read_at is not null and created_at < now() - interval '60 days';
  delete from private.auth_email_log where created_at < now() - interval '2 days';
$$;

revoke all on function private.feedback_touch(), private.feedback_notify(), private.feedback_update_notify(),
  private.workspace_snapshot(uuid), private.cron_backup(), private.cron_cleanup(), private.email_notification(), private.email_default(text)
  from public, anon, authenticated;

-- Test email now names the app (Impact Hub).
create or replace function public.send_test_email(ws uuid) returns text language plpgsql security definer set search_path = '' as $$
declare s record; p record;
begin
  if not private.has_role(ws, array['owner','admin']::public.workspace_role[]) then raise exception 'Only admins can do this' using errcode = '42501'; end if;
  select ghl_webhook_url, app_url into s from public.workspace_settings where workspace_id = ws;
  if s.ghl_webhook_url is null then raise exception 'Add the GHL webhook URL first'; end if;
  select email, coalesce(nullif(full_name, ''), split_part(email, '@', 1)) as name into p from public.profiles where id = auth.uid();
  perform net.http_post(url := s.ghl_webhook_url,
    body := jsonb_build_object('event', 'test', 'email', p.email, 'name', p.name, 'subject', 'Test email from Impact Hub',
      'heading', 'Emails are working', 'message', 'If you can read this, GoHighLevel is sending emails for Impact Hub.',
      'button_text', 'Open Impact Hub', 'link', s.app_url, 'task', '', 'task_number', '', 'actor', '', 'workspace', (select name from public.workspaces where id = ws)),
    headers := '{"Content-Type": "application/json"}'::jsonb);
  return p.email;
end; $$;
revoke all on function public.send_test_email(uuid) from public, anon;
grant execute on function public.send_test_email(uuid) to authenticated;

-- First backup right away.
select private.cron_backup();

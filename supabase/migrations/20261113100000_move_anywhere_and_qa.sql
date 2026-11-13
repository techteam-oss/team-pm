-- Move tasks anywhere, and a real QA step (Siraj, 2026-11-13).
--  1. move_task: a task (with its subtasks, comments, files and time) can move to any open list in the
--     workspace, in any space or folder, if the mover can edit both spaces.
--  2. Files follow a moved task: storage access also checks the attachment row, not only the folder name.
--  3. QA trail on every task: who completed it, who reviewed it, approved or sent back, and how often.
--  4. qa_review(): the reviewer (or a space admin) approves or sends the task back with a reason.
--  5. Emails: new kinds qa_approved / qa_changes; task emails may carry their own subject/heading.

-- 1. Move anywhere -----------------------------------------------------------------------------------
create or replace function public.move_task(p_task uuid, p_list uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; target record; r record; st uuid; ids uuid[]; from_name text;
begin
  select id, list_id, space_id, workspace_id, parent_task_id into t from public.tasks where id = p_task;
  if t.id is null or coalesce(private.space_level(t.space_id), 0) < 1 then raise exception 'Task not found'; end if;
  if private.space_level(t.space_id) < 3 then raise exception 'You need edit access to move tasks' using errcode = '42501'; end if;
  select l.id, l.space_id, l.workspace_id, l.name, s.name as space_name into target
    from public.lists l join public.spaces s on s.id = l.space_id where l.id = p_list and not l.archived;
  if target.id is null or target.workspace_id <> t.workspace_id then raise exception 'Pick an open list to move the task to'; end if;
  if coalesce(private.space_level(target.space_id), 0) < 3 then
    raise exception 'You need edit access to the space "%" to move tasks into it', target.space_name using errcode = '42501';
  end if;
  if t.list_id = p_list then return; end if;
  select s.name || ' / ' || l.name into from_name from public.lists l join public.spaces s on s.id = l.space_id where l.id = t.list_id;

  ids := array[]::uuid[];
  for r in
    with recursive tree as (
      select id, status_id, 0 as depth from public.tasks where id = p_task
      union all
      select c.id, c.status_id, tree.depth + 1 from public.tasks c join tree on c.parent_task_id = tree.id where tree.depth < 20
    )
    select tree.id, tree.depth, s.name as status_name, coalesce(s.is_done, false) as is_done
    from tree left join public.statuses s on s.id = tree.status_id
    order by tree.depth
  loop
    select id into st from public.statuses where list_id = p_list and lower(name) = lower(r.status_name) limit 1;
    if st is null then
      select id into st from public.statuses where list_id = p_list and is_done = r.is_done order by position limit 1;
    end if;
    if st is null then
      select id into st from public.statuses where list_id = p_list order by position limit 1;
    end if;
    -- tasks_inherit sets space_id and workspace_id from the new list.
    update public.tasks set list_id = p_list, status_id = st,
      parent_task_id = case when r.depth = 0 then null else parent_task_id end
    where id = r.id;
    ids := ids || r.id;
    st := null;
  end loop;

  if target.space_id <> t.space_id then
    update public.task_assignees set space_id = target.space_id where task_id = any(ids);
    update public.task_watchers set space_id = target.space_id where task_id = any(ids);
    update public.comments set space_id = target.space_id where task_id = any(ids);
    update public.comment_reactions set space_id = target.space_id where comment_id in (select id from public.comments where task_id = any(ids));
    update public.checklist_items set space_id = target.space_id where task_id = any(ids);
    update public.attachments set space_id = target.space_id where task_id = any(ids);
    update public.time_entries set space_id = target.space_id where task_id = any(ids);
    update public.activity_log set space_id = target.space_id where task_id = any(ids);
  end if;

  insert into public.activity_log(task_id, space_id, user_id, action, details)
  values (p_task, target.space_id, auth.uid(), 'moved',
    jsonb_build_object('from', from_name, 'to', target.space_name || ' / ' || target.name));
end; $$;
revoke all on function public.move_task(uuid, uuid) from public, anon;
grant execute on function public.move_task(uuid, uuid) to authenticated;

-- 2. Files of a moved task stay under the old space's folder in storage. Access now follows the
--    attachment row (which moves with the task), so people in the old space lose access too.
drop policy if exists "read attachment files" on storage.objects;
create policy "read attachment files" on storage.objects for select to authenticated
  using (bucket_id = 'attachments'
    and exists (select 1 from public.attachments a where a.storage_path = name and coalesce(private.space_level(a.space_id), 0) >= 1));
drop policy if exists "delete attachment files" on storage.objects;
create policy "delete attachment files" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (owner_id = (select auth.uid())::text
    or exists (select 1 from public.attachments a where a.storage_path = name and coalesce(private.space_level(a.space_id), 0) >= 4)));

-- 3. QA trail ----------------------------------------------------------------------------------------
alter table public.tasks
  add column completed_by uuid references auth.users(id) on delete set null,
  add column qa_state text check (qa_state in ('pending', 'approved', 'changes')),
  add column qa_by uuid references auth.users(id) on delete set null,
  add column qa_at timestamptz,
  add column qa_note text check (length(qa_note) <= 2000),
  add column rework_count int not null default 0;
create index tasks_qa_pending_idx on public.tasks (reviewer_id) where qa_state = 'pending';

-- A status counts as "in review" when its name says so (the default "Review" status, or "QA").
create or replace function private.is_review_status(p_status uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select not is_done and name ~* '(review|\mqa\M)' from public.statuses where id = p_status), false)
$$;

-- Runs after tasks_completed_at (alphabetical order) and keeps the QA fields honest: clients cannot
-- write them, only qa_review() can approve or send back, and status changes move the task in and
-- out of "waiting for QA". completed_by is the person who moved the task into Review or Done.
create or replace function private.tasks_qa_trail() returns trigger language plpgsql security definer set search_path = '' as $$
declare finished_now boolean; finished_before boolean := false; done_now boolean;
begin
  if current_setting('app.qa_review', true) = 'on' then return new; end if;
  if tg_op = 'UPDATE' then
    new.qa_state := old.qa_state; new.qa_by := old.qa_by; new.qa_at := old.qa_at;
    new.qa_note := old.qa_note; new.rework_count := old.rework_count; new.completed_by := old.completed_by;
    finished_before := coalesce((select is_done from public.statuses where id = old.status_id), false) or private.is_review_status(old.status_id);
  else
    new.qa_state := null; new.qa_by := null; new.qa_at := null; new.qa_note := null; new.rework_count := 0; new.completed_by := null;
  end if;
  done_now := coalesce((select is_done from public.statuses where id = new.status_id), false);
  finished_now := done_now or private.is_review_status(new.status_id);

  if finished_now and not finished_before then new.completed_by := auth.uid();
  elsif not finished_now then new.completed_by := null;
  end if;

  if tg_op = 'INSERT' or new.status_id is distinct from old.status_id or new.reviewer_id is distinct from old.reviewer_id then
    if new.reviewer_id is null then
      if new.qa_state = 'pending' then new.qa_state := null; end if;
    elsif finished_now and new.qa_state is distinct from 'approved' then
      new.qa_state := 'pending'; new.qa_by := null; new.qa_at := null;
    elsif not finished_now and new.qa_state in ('pending', 'approved') then
      new.qa_state := null;   -- reopened: it needs a fresh review when it is finished again
    end if;
  end if;
  return new;
end; $$;
create trigger tasks_qa_trail before insert or update on public.tasks for each row execute function private.tasks_qa_trail();

-- Tasks already in Review or Done with a reviewer start out waiting for QA.
select set_config('app.qa_review', 'on', false);
update public.tasks t set qa_state = 'pending'
from public.statuses s
where s.id = t.status_id and t.reviewer_id is not null and (s.is_done or private.is_review_status(s.id)) and t.qa_state is null;
select set_config('app.qa_review', 'off', false);

-- 4. Approve or send back ----------------------------------------------------------------------------
create or replace function public.qa_review(p_task uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; st uuid; who uuid := auth.uid(); u uuid; note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  select id, title, list_id, space_id, status_id, reviewer_id, created_by into t from public.tasks where id = p_task and not archived;
  if t.id is null or coalesce(private.space_level(t.space_id), 0) < 1 then raise exception 'Task not found'; end if;
  if who is distinct from t.reviewer_id and coalesce(private.space_level(t.space_id), 0) < 4 then
    raise exception 'Only the QA reviewer or a space admin can review this task' using errcode = '42501';
  end if;
  if not p_approve and note is null then raise exception 'Say what needs to change'; end if;
  if length(note) > 2000 then raise exception 'Keep the note under 2000 characters'; end if;

  if p_approve then
    -- Approved work is done: keep a done status, otherwise use the list's first done status.
    if not coalesce((select is_done from public.statuses where id = t.status_id), false) then
      select id into st from public.statuses where list_id = t.list_id and is_done order by position limit 1;
    end if;
  else
    -- Sent back: "In progress" if the list has it, otherwise the first open status that is not a review status.
    select id into st from public.statuses where list_id = t.list_id and not is_done and lower(name) = 'in progress' limit 1;
    if st is null then
      select id into st from public.statuses where list_id = t.list_id and not is_done and not private.is_review_status(id) order by position limit 1;
    end if;
  end if;

  perform set_config('app.qa_review', 'on', true);
  update public.tasks set
    status_id = coalesce(st, status_id),
    completed_by = case when p_approve then coalesce(completed_by, who) else null end,
    qa_state = case when p_approve then 'approved' else 'changes' end,
    qa_by = who, qa_at = now(), qa_note = note,
    rework_count = rework_count + case when p_approve then 0 else 1 end
  where id = p_task;
  perform set_config('app.qa_review', 'off', true);

  insert into public.activity_log(task_id, space_id, user_id, action, details)
  values (p_task, t.space_id, who, case when p_approve then 'qa_approved' else 'qa_changes' end, jsonb_build_object('note', note));

  for u in select user_id from public.task_assignees where task_id = p_task union select t.created_by loop
    perform private.notify(u, case when p_approve then 'qa_approved' else 'qa_changes' end, p_task, who,
      case when p_approve then private.person(who) || ' approved "' || t.title || '"'
        else private.person(who) || ' sent "' || t.title || '" back: ' || note end);
  end loop;
end; $$;
revoke all on function public.qa_review(uuid, boolean, text) from public, anon;
grant execute on function public.qa_review(uuid, boolean, text) to authenticated;

-- Ready-for-QA notice now fires when the task starts waiting for QA (Review or Done), once.
create or replace function private.task_notify() returns trigger language plpgsql security definer set search_path = '' as $$
declare done_now boolean; was_done boolean;
begin
  if new.reviewer_id is not null and (tg_op = 'INSERT' or new.reviewer_id is distinct from old.reviewer_id) then
    perform private.notify(new.reviewer_id, 'qa_review', new.id, auth.uid(),
      private.person(auth.uid()) || ' made you the QA reviewer for "' || new.title || '"');
  end if;
  if tg_op = 'UPDATE' and new.qa_state = 'pending' and old.qa_state is distinct from 'pending' then
    perform private.notify(new.reviewer_id, 'ready_for_qa', new.id, auth.uid(),
      private.person(auth.uid()) || ' finished "' || new.title || '". It is ready for your QA review.');
  end if;
  if tg_op = 'UPDATE' and new.status_id is distinct from old.status_id then
    select is_done into done_now from public.statuses where id = new.status_id;
    select is_done into was_done from public.statuses where id = old.status_id;
    if coalesce(done_now, false) and not coalesce(was_done, false) and new.created_by is distinct from new.reviewer_id then
      perform private.notify(new.created_by, 'completed', new.id, auth.uid(), private.person(auth.uid()) || ' completed "' || new.title || '"');
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists tasks_notify on public.tasks;
create trigger tasks_notify after insert or update of reviewer_id, status_id, qa_state on public.tasks for each row execute function private.task_notify();

-- 5. Emails ------------------------------------------------------------------------------------------
create or replace function private.email_default(kind text) returns boolean language sql immutable set search_path = '' as $$
  select kind in ('mention','assigned','qa_review','ready_for_qa','qa_approved','qa_changes','comment_assigned','estimate_exceeded',
    'due_today','overdue','feedback','feedback_update','blocked_done','digest','weekly_summary','timer_running')
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
    subj := coalesce(new.data ->> 'subject', case new.kind
      when 'mention' then private.person(new.actor_id) || ' mentioned you on "' || t.title || '"'
      when 'comment' then 'New comment on "' || t.title || '"'
      when 'comment_assigned' then private.person(new.actor_id) || ' assigned you a comment on "' || t.title || '"'
      when 'assigned' then 'You were assigned "' || t.title || '"'
      when 'qa_review' then 'You are the QA reviewer for "' || t.title || '"'
      when 'ready_for_qa' then '"' || t.title || '" is ready for your QA review'
      when 'qa_approved' then 'QA approved "' || t.title || '"'
      when 'qa_changes' then 'Changes needed on "' || t.title || '"'
      when 'completed' then '"' || t.title || '" was completed'
      when 'estimate_exceeded' then '"' || t.title || '" went over its time estimate'
      when 'due_today' then '"' || t.title || '" is due today'
      when 'overdue' then '"' || t.title || '" is overdue'
      when 'blocked_done' then '"' || t.title || '" is no longer blocked'
      when 'timer_running' then 'Your timer is still running on "' || t.title || '"'
      else 'Update on "' || t.title || '"' end);
    head := coalesce(new.data ->> 'heading', case new.kind when 'estimate_exceeded' then 'Time estimate exceeded' when 'overdue' then 'Task overdue'
      when 'due_today' then 'Due today' when 'mention' then 'You were mentioned' when 'assigned' then 'New task for you'
      when 'qa_review' then 'QA review assigned' when 'ready_for_qa' then 'Ready for QA'
      when 'qa_approved' then 'QA approved' when 'qa_changes' then 'Changes needed'
      when 'blocked_done' then 'You can start now' when 'timer_running' then 'Timer still running'
      else 'Task update' end);
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

revoke all on function private.is_review_status(uuid), private.tasks_qa_trail(), private.task_notify(),
  private.email_default(text), private.email_notification() from public, anon, authenticated;

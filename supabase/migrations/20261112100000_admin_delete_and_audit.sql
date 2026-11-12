-- Admin powers and a deletion log (Siraj, 2026-11-12):
--  * Owners/admins already have full access to every space (private.space_level returns 4 for them).
--  * Only owners/admins may delete spaces, folders and lists, and permanently delete tasks.
--  * Members with edit access can move any task in the space to the trash (restorable).
--  * Every delete / trash / restore / member removal is written to audit_log, which only owners/admins can read.

-- 1. Delete rights. Restrictive policies are ANDed with the existing permissive ones.
create policy "only admins delete folders" on public.folders as restrictive for delete to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy "only admins delete lists" on public.lists as restrictive for delete to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy "only admins delete tasks permanently" on public.tasks as restrictive for delete to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));

create or replace function private.tasks_archive_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if new.deleted_at is not null and old.deleted_at is null then
    -- anyone with edit access to the space can move a task to the trash
    if uid is not null and coalesce(current_setting('team_pm.cascade', true), '') <> '1'
       and private.space_level(new.space_id) < 3 then
      raise exception 'You need edit access to this space to delete tasks';
    end if;
    new.deleted_at := now(); new.deleted_by := uid; new.archived := true;
  elsif not new.archived then
    new.deleted_at := null; new.deleted_by := null;
  elsif new.deleted_at is distinct from old.deleted_at then
    new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;
  end if;
  return new;
end; $$;

-- 2. The log.
create table public.audit_log (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,          -- deleted | trashed | restored | removed
  entity text not null,          -- space | folder | list | task | member | attachment
  entity_id uuid,
  name text,
  space_name text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.audit_log(workspace_id, created_at desc);
alter table public.audit_log enable row level security;
create policy "admins read audit log" on public.audit_log for select to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));

create or replace function private.audit_delete() returns trigger language plpgsql security definer set search_path = '' as $$
declare sp text; info jsonb := '{}';
begin
  if pg_trigger_depth() > 1 then return old; end if;   -- rows removed by a cascade are covered by their parent's entry
  if tg_table_name = 'spaces' then
    info := jsonb_build_object('lists', (select count(*) from public.lists where space_id = old.id),
                               'tasks', (select count(*) from public.tasks where space_id = old.id));
    insert into public.audit_log(workspace_id, actor_id, action, entity, entity_id, name, space_name, details)
    values (old.workspace_id, auth.uid(), 'deleted', 'space', old.id, old.name, old.name, info);
  elsif tg_table_name = 'folders' then
    select name into sp from public.spaces where id = old.space_id;
    info := jsonb_build_object('lists', (select count(*) from public.lists where folder_id = old.id),
                               'tasks', (select count(*) from public.tasks t join public.lists l on l.id = t.list_id where l.folder_id = old.id));
    insert into public.audit_log(workspace_id, actor_id, action, entity, entity_id, name, space_name, details)
    values (old.workspace_id, auth.uid(), 'deleted', 'folder', old.id, old.name, sp, info);
  elsif tg_table_name = 'lists' then
    select name into sp from public.spaces where id = old.space_id;
    info := jsonb_build_object('tasks', (select count(*) from public.tasks where list_id = old.id));
    insert into public.audit_log(workspace_id, actor_id, action, entity, entity_id, name, space_name, details)
    values (old.workspace_id, auth.uid(), 'deleted', 'list', old.id, old.name, sp, info);
  elsif tg_table_name = 'tasks' then
    select name into sp from public.spaces where id = old.space_id;
    insert into public.audit_log(workspace_id, actor_id, action, entity, entity_id, name, space_name, details)
    values (old.workspace_id, auth.uid(), 'deleted', 'task', old.id, old.title, sp,
      jsonb_build_object('number', old.number, 'list', (select name from public.lists where id = old.list_id)));
  elsif tg_table_name = 'workspace_members' then
    insert into public.audit_log(workspace_id, actor_id, action, entity, entity_id, name, details)
    values (old.workspace_id, auth.uid(), 'removed', 'member', old.user_id,
      (select coalesce(full_name, email) from public.profiles where id = old.user_id), jsonb_build_object('role', old.role));
  elsif tg_table_name = 'attachments' then
    insert into public.audit_log(workspace_id, actor_id, action, entity, entity_id, name, space_name, details)
    select t.workspace_id, auth.uid(), 'deleted', 'attachment', old.id, old.file_name, s.name, jsonb_build_object('task', t.title, 'number', t.number)
    from public.tasks t join public.spaces s on s.id = t.space_id where t.id = old.task_id;
  end if;
  return old;
end; $$;

create trigger audit_spaces before delete on public.spaces for each row execute function private.audit_delete();
create trigger audit_folders before delete on public.folders for each row execute function private.audit_delete();
create trigger audit_lists before delete on public.lists for each row execute function private.audit_delete();
create trigger audit_tasks before delete on public.tasks for each row execute function private.audit_delete();
create trigger audit_members before delete on public.workspace_members for each row execute function private.audit_delete();
create trigger audit_attachments before delete on public.attachments for each row execute function private.audit_delete();

-- Trash and restore go into the log too (only the task the person acted on, not its subtasks).
create or replace function private.audit_trash() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(current_setting('team_pm.cascade', true), '') = '1' then return new; end if;
  if (new.deleted_at is not null and old.deleted_at is null) or (old.deleted_at is not null and new.deleted_at is null) then
    insert into public.audit_log(workspace_id, actor_id, action, entity, entity_id, name, space_name, details)
    select new.workspace_id, auth.uid(), case when new.deleted_at is not null then 'trashed' else 'restored' end, 'task', new.id, new.title, s.name,
      jsonb_build_object('number', new.number, 'list', (select name from public.lists where id = new.list_id))
    from public.spaces s where s.id = new.space_id;
  end if;
  return new;
end; $$;
create trigger audit_tasks_trash after update of deleted_at on public.tasks for each row
  when (old.deleted_at is distinct from new.deleted_at) execute function private.audit_trash();

revoke all on function private.audit_delete(), private.audit_trash(), private.tasks_archive_guard() from public, anon, authenticated;

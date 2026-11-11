-- Archive and trash for tasks. archived = hidden from views. deleted_at set = in the trash (also archived).
alter table public.tasks add column deleted_at timestamptz, add column deleted_by uuid references auth.users(id) on delete set null;
create index on public.tasks(workspace_id, archived) where archived;

create or replace function private.tasks_archive_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if new.deleted_at is not null and old.deleted_at is null then
    -- moving to trash needs delete rights: full access, or edit access on a task you created
    if uid is not null and coalesce(current_setting('team_pm.cascade', true), '') <> '1'
       and not (private.space_level(new.space_id) >= 4 or (old.created_by = uid and private.space_level(new.space_id) >= 3)) then
      raise exception 'Only the task creator or someone with full access can delete this task';
    end if;
    new.deleted_at := now(); new.deleted_by := uid; new.archived := true;
  elsif not new.archived then
    new.deleted_at := null; new.deleted_by := null;          -- restoring clears the trash flag
  elsif new.deleted_at is distinct from old.deleted_at then
    new.deleted_at := old.deleted_at; new.deleted_by := old.deleted_by;  -- no other edits to these columns
  end if;
  return new;
end; $$;
create trigger tasks_archive_guard before update on public.tasks for each row
  when (old.archived is distinct from new.archived or old.deleted_at is distinct from new.deleted_at)
  execute function private.tasks_archive_guard();

-- Log it, and carry the change down to subtasks.
create or replace function private.tasks_archive_after() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.activity_log(task_id, space_id, user_id, action)
  values (new.id, new.space_id, (select auth.uid()),
    case when new.deleted_at is not null and old.deleted_at is null then 'trashed'
         when new.archived and not old.archived then 'archived' else 'restored' end);
  perform set_config('team_pm.cascade', '1', true);       -- subtasks follow the parent without a second permission check
  update public.tasks set archived = new.archived, deleted_at = new.deleted_at, deleted_by = new.deleted_by
    where parent_task_id = new.id and (archived, deleted_at) is distinct from (new.archived, new.deleted_at);
  perform set_config('team_pm.cascade', '', true);
  return new;
end; $$;
create trigger tasks_archive_after after update on public.tasks for each row
  when (old.archived is distinct from new.archived or old.deleted_at is distinct from new.deleted_at)
  execute function private.tasks_archive_after();

revoke all on function private.tasks_archive_guard(), private.tasks_archive_after() from public, anon, authenticated;

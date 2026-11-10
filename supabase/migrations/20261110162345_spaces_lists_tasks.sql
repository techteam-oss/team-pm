-- Applied to project team-pm on 2026-11-10.
create type public.space_access as enum ('view','comment','edit','full');
create type public.task_priority as enum ('urgent','high','normal','low');

create table public.spaces (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  color text not null default '#7b68ee',
  is_private boolean not null default false,
  position double precision not null default 0,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.spaces(workspace_id);

create table public.space_members (
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access public.space_access not null default 'edit',
  primary key (space_id, user_id)
);
create index on public.space_members(user_id);

create table public.folders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index on public.folders(space_id);

create table public.lists (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  position double precision not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.lists(space_id);

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color text not null default '#9aa1ad',
  position double precision not null default 0,
  is_done boolean not null default false
);
create index on public.statuses(list_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  parent_task_id uuid references public.tasks(id) on delete cascade,
  status_id uuid references public.statuses(id) on delete set null,
  title text not null check (char_length(title) between 1 and 500),
  description text,
  priority public.task_priority not null default 'normal',
  start_date date,
  due_date date,
  time_estimate_minutes integer check (time_estimate_minutes >= 0),
  tags text[] not null default '{}',
  position double precision not null default 0,
  archived boolean not null default false,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.tasks(list_id, status_id);
create index on public.tasks(space_id);
create index on public.tasks(parent_task_id);

create table public.task_assignees (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  primary key (task_id, user_id)
);
create index on public.task_assignees(user_id);

-- Keep workspace_id / space_id consistent with the parent row (clients cannot spoof them)
create or replace function private.inherit_from_space() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select workspace_id into new.workspace_id from public.spaces where id = new.space_id;
  if new.workspace_id is null then raise exception 'space not found'; end if;
  return new;
end; $$;
create trigger folders_inherit before insert or update on public.folders for each row execute function private.inherit_from_space();

create or replace function private.lists_inherit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.folder_id is not null then
    select space_id into new.space_id from public.folders where id = new.folder_id;
  end if;
  select workspace_id into new.workspace_id from public.spaces where id = new.space_id;
  if new.workspace_id is null then raise exception 'space not found'; end if;
  return new;
end; $$;
create trigger lists_inherit before insert or update on public.lists for each row execute function private.lists_inherit();

create or replace function private.inherit_from_list() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select workspace_id, space_id into new.workspace_id, new.space_id from public.lists where id = new.list_id;
  if new.space_id is null then raise exception 'list not found'; end if;
  return new;
end; $$;
create trigger statuses_inherit before insert or update on public.statuses for each row execute function private.inherit_from_list();

create or replace function private.tasks_inherit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select workspace_id, space_id into new.workspace_id, new.space_id from public.lists where id = new.list_id;
  if new.space_id is null then raise exception 'list not found'; end if;
  if new.status_id is not null and not exists (select 1 from public.statuses where id = new.status_id and list_id = new.list_id) then
    raise exception 'status does not belong to this list';
  end if;
  if new.parent_task_id is not null and not exists (select 1 from public.tasks where id = new.parent_task_id and list_id = new.list_id) then
    raise exception 'parent task must be in the same list';
  end if;
  new.updated_at := now();
  return new;
end; $$;
create trigger tasks_inherit before insert or update on public.tasks for each row execute function private.tasks_inherit();

create or replace function private.assignee_inherit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select space_id into new.space_id from public.tasks where id = new.task_id;
  if new.space_id is null then raise exception 'task not found'; end if;
  return new;
end; $$;
create trigger assignee_inherit before insert or update on public.task_assignees for each row execute function private.assignee_inherit();

-- New lists get default statuses
create or replace function private.default_statuses() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.statuses (list_id, space_id, workspace_id, name, color, position, is_done) values
    (new.id, new.space_id, new.workspace_id, 'To do', '#9aa1ad', 1, false),
    (new.id, new.space_id, new.workspace_id, 'In progress', '#3b82f6', 2, false),
    (new.id, new.space_id, new.workspace_id, 'Review', '#f59e0b', 3, false),
    (new.id, new.space_id, new.workspace_id, 'Done', '#22c55e', 4, true);
  return new;
end; $$;
create trigger lists_default_statuses after insert on public.lists for each row execute function private.default_statuses();

-- Access level for the current user on a space: 0 none, 1 view, 2 comment, 3 edit, 4 full
create or replace function private.space_level(sp uuid) returns int language sql security definer stable set search_path = '' as $$
  select case
    when m.role in ('owner','admin') then 4
    when sm.access is not null then case sm.access when 'full' then 4 when 'edit' then 3 when 'comment' then 2 else 1 end
    when m.role = 'member' and not s.is_private then 3
    else 0 end
  from public.spaces s
  join public.workspace_members m on m.workspace_id = s.workspace_id and m.user_id = (select auth.uid())
  left join public.space_members sm on sm.space_id = s.id and sm.user_id = (select auth.uid())
  where s.id = sp
$$;
revoke all on function private.space_level(uuid) from public, anon;
grant execute on function private.space_level(uuid) to authenticated;
revoke all on function private.inherit_from_space(), private.lists_inherit(), private.inherit_from_list(), private.tasks_inherit(), private.assignee_inherit(), private.default_statuses() from public, anon, authenticated;

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.folders enable row level security;
alter table public.lists enable row level security;
alter table public.statuses enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;

create policy "see spaces you can access" on public.spaces for select to authenticated using (coalesce(private.space_level(id),0) >= 1);
create policy "admins create spaces" on public.spaces for insert to authenticated with check (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));
create policy "full access edits space" on public.spaces for update to authenticated using (coalesce(private.space_level(id),0) >= 4);
create policy "admins delete spaces" on public.spaces for delete to authenticated using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[]));

create policy "see who is in a space" on public.space_members for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "admins grant space access" on public.space_members for insert to authenticated with check (private.has_role((select workspace_id from public.spaces where id = space_id), array['owner','admin']::public.workspace_role[]));
create policy "admins change space access" on public.space_members for update to authenticated using (private.has_role((select workspace_id from public.spaces where id = space_id), array['owner','admin']::public.workspace_role[]));
create policy "admins revoke space access" on public.space_members for delete to authenticated using (private.has_role((select workspace_id from public.spaces where id = space_id), array['owner','admin']::public.workspace_role[]));

create policy "read folders" on public.folders for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "full manages folders" on public.folders for all to authenticated using (coalesce(private.space_level(space_id),0) >= 4) with check (coalesce(private.space_level(space_id),0) >= 4);

create policy "read lists" on public.lists for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "full manages lists" on public.lists for all to authenticated using (coalesce(private.space_level(space_id),0) >= 4) with check (coalesce(private.space_level(space_id),0) >= 4);

create policy "read statuses" on public.statuses for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "full manages statuses" on public.statuses for all to authenticated using (coalesce(private.space_level(space_id),0) >= 4) with check (coalesce(private.space_level(space_id),0) >= 4);

create policy "read tasks" on public.tasks for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "editors create tasks" on public.tasks for insert to authenticated with check (coalesce(private.space_level(space_id),0) >= 3);
create policy "editors update tasks" on public.tasks for update to authenticated using (coalesce(private.space_level(space_id),0) >= 3) with check (coalesce(private.space_level(space_id),0) >= 3);
create policy "full or creator deletes tasks" on public.tasks for delete to authenticated using (coalesce(private.space_level(space_id),0) >= 4 or (created_by = (select auth.uid()) and coalesce(private.space_level(space_id),0) >= 3));

create policy "read assignees" on public.task_assignees for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "editors assign" on public.task_assignees for insert to authenticated with check (coalesce(private.space_level(space_id),0) >= 3 and private.shares_workspace(user_id));
create policy "editors unassign" on public.task_assignees for delete to authenticated using (coalesce(private.space_level(space_id),0) >= 3);

alter publication supabase_realtime add table public.tasks, public.task_assignees;

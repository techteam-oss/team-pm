-- Applied to project team-pm (oxcoqixujubjiasimmwm) on 2026-11-10.
-- Private schema for security-definer helpers (not exposed through the API)
create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  avatar_url text,
  theme text not null default 'system' check (theme in ('light','dark','system')),
  created_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create type public.workspace_role as enum ('owner','admin','member','guest');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index workspace_members_user_idx on public.workspace_members(user_id);

create or replace function private.is_member(ws uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.workspace_members
                 where workspace_id = ws and user_id = (select auth.uid()));
$$;

create or replace function private.has_role(ws uuid, roles public.workspace_role[])
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.workspace_members
                 where workspace_id = ws and user_id = (select auth.uid())
                 and role = any(roles));
$$;

create or replace function private.shares_workspace(other uuid)
returns boolean language sql security definer stable set search_path = '' as $$
  select exists (select 1 from public.workspace_members a
                 join public.workspace_members b on a.workspace_id = b.workspace_id
                 where a.user_id = (select auth.uid()) and b.user_id = other);
$$;

grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Create a workspace and become its owner in one step (intentionally callable by signed-in users)
create or replace function public.create_workspace(ws_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  insert into public.workspaces (name, created_by) values (ws_name, (select auth.uid())) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  return new_id;
end;
$$;
revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

create policy "read own or teammates' profiles" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_workspace(id));
create policy "update own profile" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members read workspace" on public.workspaces for select to authenticated
  using (private.is_member(id));
create policy "owners and admins rename workspace" on public.workspaces for update to authenticated
  using (private.has_role(id, array['owner','admin']::public.workspace_role[]));
create policy "owners delete workspace" on public.workspaces for delete to authenticated
  using (private.has_role(id, array['owner']::public.workspace_role[]));

create policy "members see fellow members" on public.workspace_members for select to authenticated
  using (private.is_member(workspace_id));
create policy "admins add members" on public.workspace_members for insert to authenticated
  with check (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])
              and (role <> 'owner' or private.has_role(workspace_id, array['owner']::public.workspace_role[])));
create policy "admins change roles" on public.workspace_members for update to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])
         and (role <> 'owner' or private.has_role(workspace_id, array['owner']::public.workspace_role[])))
  with check (role <> 'owner' or private.has_role(workspace_id, array['owner']::public.workspace_role[]));
create policy "admins remove members" on public.workspace_members for delete to authenticated
  using (private.has_role(workspace_id, array['owner','admin']::public.workspace_role[])
         and (role <> 'owner' or private.has_role(workspace_id, array['owner']::public.workspace_role[])));

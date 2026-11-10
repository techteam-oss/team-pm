-- Only the very first user (bootstrap) or an existing owner/admin can create a workspace.
create or replace function public.create_workspace(ws_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if exists (select 1 from public.workspaces)
     and not exists (select 1 from public.workspace_members
                     where user_id = (select auth.uid()) and role in ('owner','admin')) then
    raise exception 'only admins can create workspaces';
  end if;
  insert into public.workspaces (name, created_by) values (ws_name, (select auth.uid())) returning id into new_id;
  insert into public.workspace_members (workspace_id, user_id, role) values (new_id, (select auth.uid()), 'owner');
  return new_id;
end;
$$;
revoke all on function public.create_workspace(text) from public, anon;
grant execute on function public.create_workspace(text) to authenticated;

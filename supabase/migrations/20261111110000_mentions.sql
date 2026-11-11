-- @mentions in comments are stored as @[Name](user-uuid). Mentioned people who can see the space start watching the task.
create or replace function private.user_space_level(uid uuid, sp uuid) returns int language sql security definer stable set search_path = '' as $$
  select case
    when m.role in ('owner','admin') then 4
    when sm.access is not null then case sm.access when 'full' then 4 when 'edit' then 3 when 'comment' then 2 else 1 end
    when m.role = 'member' and not s.is_private then 3
    else 0 end
  from public.spaces s
  join public.workspace_members m on m.workspace_id = s.workspace_id and m.user_id = uid
  left join public.space_members sm on sm.space_id = s.id and sm.user_id = uid
  where s.id = sp
$$;
revoke all on function private.user_space_level(uuid, uuid) from public, anon, authenticated;

create or replace function private.comment_mentions() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.task_watchers(task_id, user_id, space_id)
  select distinct new.task_id, m[1]::uuid, new.space_id
  from regexp_matches(new.body, '@\[[^\]]{1,80}\]\(([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)', 'g') as m
  where coalesce(private.user_space_level(m[1]::uuid, new.space_id), 0) >= 1
  on conflict do nothing;
  return new;
end; $$;
create trigger comments_mentions after insert or update of body on public.comments for each row execute function private.comment_mentions();
revoke all on function private.comment_mentions() from public, anon, authenticated;

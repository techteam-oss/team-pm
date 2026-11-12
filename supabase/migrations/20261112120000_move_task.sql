-- Move a task (and its subtasks) to another list in the same space (Siraj, 2026-11-12).
-- Statuses are matched by name in the new list; otherwise a done task lands in the first done status
-- and an open one in the first open status. A subtask moved on its own becomes a top-level task.
create or replace function public.move_task(p_task uuid, p_list uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t record; target record; r record; st uuid;
begin
  select id, list_id, space_id, parent_task_id into t from public.tasks where id = p_task;
  if t.id is null or coalesce(private.space_level(t.space_id), 0) < 1 then raise exception 'Task not found'; end if;
  if private.space_level(t.space_id) < 3 then raise exception 'You need edit access to move tasks' using errcode = '42501'; end if;
  select id, space_id, name into target from public.lists where id = p_list and not archived;
  if target.id is null or target.space_id <> t.space_id then raise exception 'Tasks can only move to an open list in the same space'; end if;
  if t.list_id = p_list then return; end if;

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
    update public.tasks set list_id = p_list, status_id = st,
      parent_task_id = case when r.depth = 0 then null else parent_task_id end
    where id = r.id;
    st := null;
  end loop;

  insert into public.activity_log(task_id, space_id, user_id, action, details)
  values (p_task, t.space_id, auth.uid(), 'moved',
    jsonb_build_object('from', (select name from public.lists where id = t.list_id), 'to', target.name));
end; $$;
revoke all on function public.move_task(uuid, uuid) from public, anon;
grant execute on function public.move_task(uuid, uuid) to authenticated;

-- Phase 2: comments, reactions, checklists, watchers, activity log, attachments.
create or replace function private.inherit_from_task() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select space_id into new.space_id from public.tasks where id = new.task_id;
  if new.space_id is null then raise exception 'task not found'; end if;
  return new;
end; $$;

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  body text not null check (char_length(body) between 1 and 10000),
  assigned_to uuid references auth.users(id) on delete set null,
  resolved boolean not null default false,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);
create index on public.comments(task_id, created_at);
create index on public.comments(assigned_to) where assigned_to is not null and not resolved;
create trigger comments_inherit before insert or update on public.comments for each row execute function private.inherit_from_task();

create table public.comment_reactions (
  comment_id uuid not null references public.comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  emoji text not null check (char_length(emoji) between 1 and 16),
  space_id uuid not null references public.spaces(id) on delete cascade,
  primary key (comment_id, user_id, emoji)
);
create or replace function private.reaction_inherit() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  select space_id into new.space_id from public.comments where id = new.comment_id;
  if new.space_id is null then raise exception 'comment not found'; end if;
  return new;
end; $$;
create trigger reactions_inherit before insert on public.comment_reactions for each row execute function private.reaction_inherit();

create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 500),
  done boolean not null default false,
  position double precision not null default 0,
  created_at timestamptz not null default now()
);
create index on public.checklist_items(task_id);
create trigger checklist_inherit before insert or update on public.checklist_items for each row execute function private.inherit_from_task();

create table public.task_watchers (
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  primary key (task_id, user_id)
);
create trigger watchers_inherit before insert on public.task_watchers for each row execute function private.inherit_from_task();

create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  mime_type text,
  uploaded_by uuid not null references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.attachments(task_id);
create trigger attachments_inherit before insert on public.attachments for each row execute function private.inherit_from_task();

create table public.activity_log (
  id bigint generated always as identity primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  space_id uuid not null references public.spaces(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on public.activity_log(task_id, created_at);

-- Activity is written only by triggers
create or replace function private.log_task_changes() returns trigger language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log(task_id, space_id, user_id, action) values (new.id, new.space_id, uid, 'created');
    if uid is not null then
      insert into public.task_watchers(task_id, user_id, space_id) values (new.id, uid, new.space_id) on conflict do nothing;
    end if;
    return new;
  end if;
  if new.status_id is distinct from old.status_id then
    insert into public.activity_log(task_id, space_id, user_id, action, details) values (new.id, new.space_id, uid, 'status',
      jsonb_build_object('from', (select name from public.statuses where id = old.status_id), 'to', (select name from public.statuses where id = new.status_id)));
  end if;
  if new.priority is distinct from old.priority then
    insert into public.activity_log(task_id, space_id, user_id, action, details) values (new.id, new.space_id, uid, 'priority', jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.activity_log(task_id, space_id, user_id, action, details) values (new.id, new.space_id, uid, 'due_date', jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;
  if new.title is distinct from old.title then
    insert into public.activity_log(task_id, space_id, user_id, action, details) values (new.id, new.space_id, uid, 'title', jsonb_build_object('from', old.title, 'to', new.title));
  end if;
  return new;
end; $$;
create trigger tasks_activity after insert or update on public.tasks for each row execute function private.log_task_changes();

create or replace function private.log_assignee_changes() returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if tg_op = 'INSERT' then r := new; else r := old; end if;
  insert into public.activity_log(task_id, space_id, user_id, action, details)
    values (r.task_id, r.space_id, (select auth.uid()), case when tg_op = 'INSERT' then 'assigned' else 'unassigned' end, jsonb_build_object('user_id', r.user_id));
  if tg_op = 'INSERT' then
    insert into public.task_watchers(task_id, user_id, space_id) values (r.task_id, r.user_id, r.space_id) on conflict do nothing;
  end if;
  return null;
exception when foreign_key_violation then return null; -- task already deleted
end; $$;
create trigger assignees_activity after insert or delete on public.task_assignees for each row execute function private.log_assignee_changes();

revoke all on function private.inherit_from_task(), private.reaction_inherit(), private.log_task_changes(), private.log_assignee_changes() from public, anon, authenticated;

-- RLS
alter table public.comments enable row level security;
alter table public.comment_reactions enable row level security;
alter table public.checklist_items enable row level security;
alter table public.task_watchers enable row level security;
alter table public.attachments enable row level security;
alter table public.activity_log enable row level security;

create policy "read comments" on public.comments for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "commenters add comments" on public.comments for insert to authenticated
  with check (coalesce(private.space_level(space_id),0) >= 2 and user_id = (select auth.uid()) and (assigned_to is null or private.shares_workspace(assigned_to)));
create policy "author or editor updates comment" on public.comments for update to authenticated
  using (coalesce(private.space_level(space_id),0) >= 2 and (user_id = (select auth.uid()) or assigned_to = (select auth.uid()) or coalesce(private.space_level(space_id),0) >= 3))
  with check (assigned_to is null or private.shares_workspace(assigned_to));
create policy "author or full deletes comment" on public.comments for delete to authenticated
  using (user_id = (select auth.uid()) or coalesce(private.space_level(space_id),0) >= 4);

create policy "read reactions" on public.comment_reactions for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "react" on public.comment_reactions for insert to authenticated with check (coalesce(private.space_level(space_id),0) >= 2 and user_id = (select auth.uid()));
create policy "unreact" on public.comment_reactions for delete to authenticated using (user_id = (select auth.uid()));

create policy "read checklist" on public.checklist_items for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "editors manage checklist" on public.checklist_items for all to authenticated
  using (coalesce(private.space_level(space_id),0) >= 3) with check (coalesce(private.space_level(space_id),0) >= 3);

create policy "read watchers" on public.task_watchers for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "watch" on public.task_watchers for insert to authenticated
  with check ((user_id = (select auth.uid()) and coalesce(private.space_level(space_id),0) >= 1) or (coalesce(private.space_level(space_id),0) >= 3 and private.shares_workspace(user_id)));
create policy "unwatch" on public.task_watchers for delete to authenticated
  using (user_id = (select auth.uid()) or coalesce(private.space_level(space_id),0) >= 3);

create policy "read attachments" on public.attachments for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);
create policy "editors attach" on public.attachments for insert to authenticated with check (coalesce(private.space_level(space_id),0) >= 3 and uploaded_by = (select auth.uid()));
create policy "uploader or full removes attachment" on public.attachments for delete to authenticated
  using (uploaded_by = (select auth.uid()) or coalesce(private.space_level(space_id),0) >= 4);

create policy "read activity" on public.activity_log for select to authenticated using (coalesce(private.space_level(space_id),0) >= 1);

-- Private storage bucket; path = <space_id>/<task_id>/<file>
insert into storage.buckets (id, name, public, file_size_limit) values ('attachments', 'attachments', false, 10485760)
  on conflict (id) do nothing;
create policy "read attachment files" on storage.objects for select to authenticated
  using (bucket_id = 'attachments' and coalesce(private.space_level(((storage.foldername(name))[1])::uuid),0) >= 1);
create policy "upload attachment files" on storage.objects for insert to authenticated
  with check (bucket_id = 'attachments' and coalesce(private.space_level(((storage.foldername(name))[1])::uuid),0) >= 3);
create policy "delete attachment files" on storage.objects for delete to authenticated
  using (bucket_id = 'attachments' and (owner_id = (select auth.uid())::text or coalesce(private.space_level(((storage.foldername(name))[1])::uuid),0) >= 4));

alter publication supabase_realtime add table public.comments, public.checklist_items;

-- Invite-only accounts, enforced in the database (works whatever the dashboard's sign-up toggle says).
-- invite-member (service role) puts the email on this list just before creating the account.
create table public.signup_allowlist (
  email text primary key check (email = lower(email)),
  created_at timestamptz not null default now()
);
alter table public.signup_allowlist enable row level security;
-- No policies: only the service role (edge functions) and SQL can read or write it.
revoke all on public.signup_allowlist from anon, authenticated;

create or replace function private.block_self_signup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.signup_allowlist where email = lower(new.email);
  if not found then
    raise exception 'Sign-up is invite-only' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function private.block_self_signup();

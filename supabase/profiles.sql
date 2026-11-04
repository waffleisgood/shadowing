-- Korean Waffle Shadowing · member profiles (run once in Supabase SQL Editor)
-- 이름(display_name)과 아이디(username). Login stays email + password or Google.
-- username_available() answers only yes/no, so a username can never reveal an email address.

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique check (username ~ '^[a-z0-9_]{4,20}$'),
  display_name text check (display_name is null or char_length(display_name) between 1 and 40),
  created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name) on public.profiles to authenticated;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (auth.uid() = id);

drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);

-- Create the profile on sign-up. A taken or invalid username never blocks sign-up:
-- the row is saved without it and the site asks for a username after login.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uname text := lower(new.raw_user_meta_data ->> 'username');
  dname text := left(coalesce(new.raw_user_meta_data ->> 'display_name',
                              new.raw_user_meta_data ->> 'full_name',
                              new.raw_user_meta_data ->> 'name'), 40);
begin
  begin
    insert into public.profiles (id, username, display_name) values (new.id, uname, nullif(dname, ''));
  exception when unique_violation or check_violation then
    insert into public.profiles (id, display_name) values (new.id, nullif(dname, ''))
    on conflict (id) do nothing;
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Yes/no availability check for the sign-up form
create or replace function public.username_available(candidate text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.profiles where username = lower(candidate));
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
revoke all on function public.handle_new_user() from public;

-- Existing members (no username yet; the site will ask after login)
insert into public.profiles (id, display_name)
select id, nullif(left(coalesce(raw_user_meta_data ->> 'full_name', raw_user_meta_data ->> 'name'), 40), '')
from auth.users
on conflict (id) do nothing;

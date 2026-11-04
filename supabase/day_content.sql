-- Korean Waffle Shadowing · gated Day content (run once in Supabase SQL Editor)
-- Day 6+ lives here instead of the public repository.
-- Only signed-in users can read, and only Days whose publish date has arrived.
-- Writes happen with the server-side secret key (data/scripts/upload_days.py), which bypasses RLS.

create table if not exists public.day_content (
  day          integer primary key check (day > 0),
  publish_date date not null,
  lesson       jsonb not null,
  updated_at   timestamptz not null default now()
);

alter table public.day_content enable row level security;

revoke all on public.day_content from anon, authenticated;
grant select on public.day_content to authenticated;

drop policy if exists "signed-in users read released days" on public.day_content;
create policy "signed-in users read released days" on public.day_content
  for select to authenticated
  using (publish_date <= (now() at time zone 'Asia/Seoul')::date);

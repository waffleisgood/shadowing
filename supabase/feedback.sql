-- Korean Waffle Shadowing · feedback table (run once in Supabase SQL Editor)
-- Anyone can submit. Nobody can read through the site: there is no SELECT policy.
-- Read feedback in Supabase → Table Editor → feedback.

create table if not exists public.feedback (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  category   text not null default 'etc' check (category in ('bug', 'idea', 'content', 'etc')),
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  contact    text check (contact is null or char_length(contact) <= 200),
  page       text check (page is null or char_length(page) <= 300),
  is_read    boolean not null default false
);

alter table public.feedback enable row level security;

revoke all on public.feedback from anon, authenticated;
grant insert (category, body, contact, page) on public.feedback to anon, authenticated;

drop policy if exists "anyone can send feedback" on public.feedback;
create policy "anyone can send feedback" on public.feedback
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());

create index if not exists feedback_created_at on public.feedback (created_at desc);

-- Korean Waffle Shadowing · Supabase schema (run once in SQL Editor)
-- Each user can only read/write their own rows (Row Level Security).

create table if not exists public.pouch_items (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  key        text not null,                 -- videoId:setIndex:phrase
  data       jsonb not null,                -- phrase, meaning, examples, source sentence ...
  learned    boolean not null default false,
  deleted    boolean not null default false, -- soft delete so removals sync across devices
  saved_at   timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists public.progress (
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  set_key      text not null,               -- videoId:setIndex
  completed_at timestamptz not null default now(),
  primary key (user_id, set_key)
);

alter table public.pouch_items enable row level security;
alter table public.progress    enable row level security;

drop policy if exists "own pouch" on public.pouch_items;
create policy "own pouch" on public.pouch_items
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own progress" on public.progress;
create policy "own progress" on public.progress
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists pouch_items_user_updated on public.pouch_items (user_id, updated_at);

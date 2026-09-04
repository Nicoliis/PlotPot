-- ============================================================================
-- Worldbuilding social schema — run once in Supabase → SQL Editor.
-- Safe to re-run: uses IF NOT EXISTS / DROP POLICY IF EXISTS.
-- ============================================================================

-- ── Profiles: public-readable author info ──────────────────────────────────
create table if not exists profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text unique,
  display_name  text,
  bio           text,
  avatar_url    text,
  favorite_tags text[] default '{}',
  created_at    timestamptz default now()
);

alter table profiles enable row level security;

drop policy if exists "profiles readable by all" on profiles;
create policy "profiles readable by all" on profiles
  for select using (true);

drop policy if exists "users edit own profile" on profiles;
create policy "users edit own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

-- ── Worlds: one row per world; public ones visible to everyone ─────────────
create table if not exists worlds (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references profiles(id) on delete cascade,
  title       text not null,
  description text default '',
  tags        text[] default '{}',
  is_public   boolean default false,
  data        jsonb default '{}'::jsonb,   -- { home, groups } — the world content
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create index if not exists worlds_owner_idx  on worlds (owner_id);
create index if not exists worlds_public_idx on worlds (is_public) where is_public;

alter table worlds enable row level security;

drop policy if exists "public or own worlds readable" on worlds;
create policy "public or own worlds readable" on worlds
  for select using (is_public = true or owner_id = auth.uid());

drop policy if exists "users write own worlds" on worlds;
create policy "users write own worlds" on worlds
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

-- ── Follows: a user can follow a world and/or a person ─────────────────────
create table if not exists world_follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  world_id    uuid not null references worlds(id)   on delete cascade,
  created_at  timestamptz default now(),
  primary key (follower_id, world_id)
);
create index if not exists world_follows_world_idx on world_follows (world_id);
alter table world_follows enable row level security;

drop policy if exists "world_follows readable by all" on world_follows;
create policy "world_follows readable by all" on world_follows
  for select using (true);

drop policy if exists "users manage own world_follows" on world_follows;
create policy "users manage own world_follows" on world_follows
  for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

create table if not exists user_follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  created_at  timestamptz default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index if not exists user_follows_followee_idx on user_follows (followee_id);
alter table user_follows enable row level security;

drop policy if exists "user_follows readable by all" on user_follows;
create policy "user_follows readable by all" on user_follows
  for select using (true);

drop policy if exists "users manage own user_follows" on user_follows;
create policy "users manage own user_follows" on user_follows
  for all using (auth.uid() = follower_id) with check (auth.uid() = follower_id);

-- ── Language (required category) + muted tags ──────────────────────────────
alter table worlds   add column if not exists language   text not null default 'en';
alter table profiles add column if not exists muted_tags text[] default '{}';

-- Per-element update timestamps { elementKey: ISO } for granular "new" tracking.
alter table worlds add column if not exists element_updates jsonb default '{}'::jsonb;

-- ── Likes ──────────────────────────────────────────────────────────────────
create table if not exists world_likes (
  user_id    uuid not null references profiles(id) on delete cascade,
  world_id   uuid not null references worlds(id)   on delete cascade,
  created_at timestamptz default now(),
  primary key (user_id, world_id)
);
create index if not exists world_likes_world_idx on world_likes (world_id);
alter table world_likes enable row level security;

drop policy if exists "world_likes readable by all" on world_likes;
create policy "world_likes readable by all" on world_likes for select using (true);

drop policy if exists "users manage own likes" on world_likes;
create policy "users manage own likes" on world_likes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Notifications ───────────────────────────────────────────────────────────
-- Inserted only via SECURITY DEFINER functions (e.g. propose_tag); recipients
-- read/update their own rows.
create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,  -- recipient
  type       text not null,
  actor_id   uuid references profiles(id) on delete set null,          -- who triggered it
  world_id   uuid references worlds(id)   on delete cascade,
  data       jsonb default '{}'::jsonb,
  read       boolean default false,
  created_at timestamptz default now()
);
create index if not exists notifications_user_idx on notifications (user_id, read);
alter table notifications enable row level security;

drop policy if exists "users read own notifications" on notifications;
create policy "users read own notifications" on notifications
  for select using (auth.uid() = user_id);

drop policy if exists "users update own notifications" on notifications;
create policy "users update own notifications" on notifications
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "users delete own notifications" on notifications;
create policy "users delete own notifications" on notifications
  for delete using (auth.uid() = user_id);

-- Propose a tag on someone else's world → notifies the owner. Runs as definer
-- so it can write a notification to another user (RLS would otherwise block it).
create or replace function public.propose_tag(p_world_id uuid, p_tag text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_actor uuid := auth.uid();
  v_tag   text := lower(trim(p_tag));
begin
  if v_actor is null then raise exception 'not authenticated'; end if;
  if v_tag = ''      then raise exception 'empty tag'; end if;
  select owner_id into v_owner from worlds where id = p_world_id;
  if v_owner is null then raise exception 'world not found'; end if;
  if v_owner = v_actor then return; end if;             -- no self-suggestions
  -- skip if this tag is already on the world
  if exists (select 1 from worlds where id = p_world_id and v_tag = any(tags)) then return; end if;
  -- skip duplicate pending suggestion
  if exists (
    select 1 from notifications
    where user_id = v_owner and type = 'tag_suggestion' and world_id = p_world_id
      and read = false and data->>'tag' = v_tag
  ) then return; end if;
  insert into notifications (user_id, type, actor_id, world_id, data)
  values (v_owner, 'tag_suggestion', v_actor, p_world_id, jsonb_build_object('tag', v_tag));
end; $$;

-- ── Per-user "seen" state (cross-device "visited" tracking) ─────────────────
-- One jsonb-per-(user,world) row mirroring the old localStorage shape
-- { elementKey: ISO }. localStorage stays as an offline cache; this row is the
-- canonical copy so the "new content" dots follow the user across devices.
create table if not exists element_seen (
  user_id    uuid not null references auth.users(id) on delete cascade,
  world_id   uuid not null references worlds(id)     on delete cascade,
  seen       jsonb not null default '{}'::jsonb,     -- { elementKey: ISO }
  updated_at timestamptz not null default now(),
  primary key (user_id, world_id)
);
alter table element_seen enable row level security;

drop policy if exists "users manage own seen" on element_seen;
create policy "users manage own seen" on element_seen
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── Optional: auto-create a profile row on signup ──────────────────────────
-- The app also creates the profile on first load (Cloud.ensureProfile), so this
-- trigger is a convenience, not a requirement.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'user_name',
             new.raw_user_meta_data->>'preferred_username',
             split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

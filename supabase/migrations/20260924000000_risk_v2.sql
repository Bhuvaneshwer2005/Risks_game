-- Risk Online v2.
--
-- One JSON game document per room (rooms.public_state) guarded by a version
-- number, so every action is a single atomic compare-and-swap. Hidden
-- information (the deck, the discard pile, each player's hand) lives in
-- tables clients can't read, apart from their own hand.
--
-- Clients only ever SELECT (and subscribe to realtime). Every write goes
-- through the `game` Edge Function using the service role.

-- ---------- drop the v1 schema ----------

drop table if exists public.moves_log cascade;
drop table if exists public.cards cascade;
drop table if exists public.territory_state cascade;
drop table if exists public.players cascade;
drop table if exists public.rooms cascade;
drop function if exists public.is_member_of_room cascade;

-- ---------- tables ----------

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'lobby' check (status in ('lobby', 'in_progress', 'finished')),
  settings jsonb not null default '{"fortifyRule": "adjacent", "cardMode": "progressive", "turnSeconds": 120}',
  public_state jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.room_players (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  seat smallint not null check (seat between 0 and 5),
  name text not null check (char_length(name) between 1 and 20),
  color text not null check (color ~ '^#[0-9a-f]{6}$'),
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id),
  unique (room_id, seat),
  unique (room_id, color)
);

create table public.room_private (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  deck jsonb not null default '[]',
  discard jsonb not null default '[]'
);

create table public.player_hands (
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  cards jsonb not null default '[]',
  primary key (room_id, user_id)
);

create table public.game_events (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms (id) on delete cascade,
  seq integer not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique (room_id, seq)
);

create index room_players_user_idx on public.room_players (user_id);
create index player_hands_user_idx on public.player_hands (user_id);

-- ---------- row level security ----------

create or replace function public.is_room_member(p_room uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.room_players rp where rp.room_id = p_room and rp.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_room_member(uuid) from public, anon;
grant execute on function public.is_room_member(uuid) to authenticated;

alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.room_private enable row level security;
alter table public.player_hands enable row level security;
alter table public.game_events enable row level security;

create policy "members can read their rooms" on public.rooms
  for select to authenticated using (public.is_room_member(id));

create policy "members can read the seats in their rooms" on public.room_players
  for select to authenticated using (public.is_room_member(room_id));

create policy "players can read only their own hand" on public.player_hands
  for select to authenticated using (user_id = (select auth.uid()));

create policy "members can read their rooms' events" on public.game_events
  for select to authenticated using (public.is_room_member(room_id));

-- room_private deliberately has no policies: only the service role reads it.

revoke insert, update, delete on public.rooms, public.room_players, public.room_private, public.player_hands, public.game_events
  from anon, authenticated;
revoke select on public.room_private from anon, authenticated;

-- ---------- functions used by the Edge Function (service role only) ----------

-- Atomically stores the result of one game action. Fails with
-- 'version_conflict' if someone else committed first; the caller reloads and
-- retries. Returns the new version and the seq given to the first event.
create or replace function public.commit_game(
  p_room uuid,
  p_expected_version integer,
  p_status text,
  p_public jsonb,
  p_deck jsonb,
  p_discard jsonb,
  p_hands jsonb,
  p_events jsonb
)
returns table (new_version integer, first_seq integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version integer;
  v_seq integer;
begin
  update public.rooms
     set public_state = p_public,
         status = p_status,
         version = version + 1,
         updated_at = now()
   where id = p_room and version = p_expected_version
  returning version into v_version;

  if not found then
    raise exception 'version_conflict';
  end if;

  insert into public.room_private (room_id, deck, discard)
  values (p_room, p_deck, p_discard)
  on conflict (room_id) do update set deck = excluded.deck, discard = excluded.discard;

  insert into public.player_hands (room_id, user_id, cards)
  select p_room, h.key::uuid, h.value
    from jsonb_each(p_hands) h
   where h.key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  on conflict (room_id, user_id) do update set cards = excluded.cards
   where public.player_hands.cards is distinct from excluded.cards;

  select coalesce(max(seq), 0) into v_seq from public.game_events where room_id = p_room;

  insert into public.game_events (room_id, seq, type, payload)
  select p_room, v_seq + e.ordinality::integer, e.value ->> 'type', e.value
    from jsonb_array_elements(p_events) with ordinality as e (value, ordinality);

  return query select v_version, v_seq + 1;
end;
$$;

-- Seats a player, serialized per room so the 6-seat limit and unique colors
-- hold under concurrent joins. Rejoining returns the existing seat.
create or replace function public.join_room(p_code text, p_user uuid, p_name text, p_color text)
returns table (joined_room uuid, joined_seat smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_seat smallint;
begin
  select * into v_room from public.rooms r where r.code = upper(p_code) for update;
  if not found then
    raise exception 'No game with that code';
  end if;

  select rp.seat into v_seat from public.room_players rp where rp.room_id = v_room.id and rp.user_id = p_user;
  if found then
    return query select v_room.id, v_seat;
    return;
  end if;

  if v_room.status <> 'lobby' then
    raise exception 'That game has already started';
  end if;
  if (select count(*) from public.room_players rp where rp.room_id = v_room.id) >= 6 then
    raise exception 'That game is full';
  end if;
  if exists (select 1 from public.room_players rp where rp.room_id = v_room.id and rp.color = p_color) then
    raise exception 'That color is taken, pick another';
  end if;

  select min(s)::smallint into v_seat
    from generate_series(0, 5) s
   where s not in (select rp.seat from public.room_players rp where rp.room_id = v_room.id);

  insert into public.room_players (room_id, user_id, seat, name, color)
  values (v_room.id, p_user, v_seat, p_name, p_color);

  return query select v_room.id, v_seat;
end;
$$;

revoke all on function public.commit_game(uuid, integer, text, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.join_room(text, uuid, text, text) from public, anon, authenticated;

-- ---------- realtime ----------

alter publication supabase_realtime add table public.rooms, public.room_players, public.player_hands, public.game_events;

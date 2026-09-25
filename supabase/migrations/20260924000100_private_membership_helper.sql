-- Move the RLS membership helper out of the API-exposed public schema, so it
-- can't be called directly as /rest/v1/rpc/is_room_member (Supabase security
-- advisor 0029). Policies still use it.

create schema if not exists private;
grant usage on schema private to authenticated;

create or replace function private.is_room_member(p_room uuid)
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

revoke all on function private.is_room_member(uuid) from public, anon;
grant execute on function private.is_room_member(uuid) to authenticated;

alter policy "members can read their rooms" on public.rooms using (private.is_room_member(id));
alter policy "members can read the seats in their rooms" on public.room_players using (private.is_room_member(room_id));
alter policy "members can read their rooms' events" on public.game_events using (private.is_room_member(room_id));

drop function public.is_room_member(uuid);

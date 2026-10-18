-- Security hardening, phase 1. See SECURITY_REVIEW.md (findings S1-S3, S7).
--
-- Safe to apply while the current site is live: the browser keeps reading and PATCHing public.app_state with the
-- publishable (anon) key exactly as before. Nothing here changes what a normal save looks like. It adds:
--   1. no INSERT and no changing `id` from the API (the site only ever PATCHes existing rows);
--   2. a write guard that rejects API writes that would wipe or bloat the league / predictions in one request;
--   3. a per-row write rate limit;
--   4. a server-side history of earlier versions of the 'main' row, in a schema the API cannot see, plus a
--      restore function the owner runs from the SQL Editor after vandalism or a bad restore;
--   5. a second, small row id = 'live' for the planned live-scoring feature (see "Rows" below).
--
-- Rows:
--   'main' — the league (league.uidLeague), predictions (predictions.uidPredictions) and Dummy scores (dummy, which
--            uses dummy.rev as its own lock and never touches updated_at). Full guard + history.
--   'live' — live point-by-point scores, written up to ~1 write / 2 s per scoring device. Small JSON only (64 KB cap),
--            generous rate limit, no shape checks and NO history (it would push real league versions out of history).
--
-- It does NOT stop someone with the anon key from editing the row in small, well-formed steps (e.g. making
-- themselves admin, changing a score). That needs phase 2 (supabase/migrations/20261019140000_server_auth.sql),
-- which moves writes behind PIN-checked RPC functions and needs a matching client change.
--
-- Requires 20260919163000_create_shared_state.sql. Re-running this file is safe.
-- Undo: see the "rollback" block at the end of this file.

-- The Dummy page's column (20261017120000_add_dummy_state.sql); repeated here so the grants below never fail.
alter table public.app_state
  add column if not exists dummy jsonb not null default '{}'::jsonb;

-- 5. The live-scoring row. Created here, while this script still runs as the owner, before INSERT is revoked below.
-- Every column is NOT NULL with a '{}' default, so the live data is never null: an idle row is '{}'.
insert into public.app_state (id, league, predictions, dummy, updated_at)
values ('live', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())
on conflict (id) do nothing;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.app_state_history (
  history_id  bigint generated always as identity primary key,
  row_id      text not null,
  operation   text not null,
  -- Previous value of each column, stored only when that column changed in this write (NULL = unchanged). A Dummy
  -- save therefore stores a few KB, not another copy of the league with everyone's pictures.
  league      jsonb,
  predictions jsonb,
  dummy       jsonb,
  updated_at  timestamptz,                    -- updated_at of the version that was replaced
  changed_at  timestamptz not null default now(),
  db_role     text,                           -- anon / authenticated / postgres / service_role
  client_ip   text,
  user_agent  text
);
alter table private.app_state_history add column if not exists dummy jsonb;
create index if not exists app_state_history_row_changed_idx on private.app_state_history (row_id, changed_at desc);
revoke all on table private.app_state_history from public, anon, authenticated;

-- Fixed one-minute write window per row (the rate limit). Cheaper than counting history, and also covers 'live',
-- which has no history.
create table if not exists private.app_state_rate (
  row_id       text primary key,
  window_start timestamptz not null,
  writes       integer not null
);
revoke all on table private.app_state_rate from public, anon, authenticated;

-- 1. Grants and policies: the site only SELECTs and PATCHes league / predictions / dummy / updated_at of existing rows.
revoke insert on table public.app_state from anon, authenticated;
drop policy if exists "shared state can be initialized" on public.app_state;
revoke update on table public.app_state from anon, authenticated;
grant update (league, predictions, dummy, updated_at) on table public.app_state to anon, authenticated;

drop policy if exists "shared state is readable" on public.app_state;
create policy "shared state is readable"
on public.app_state for select
to anon, authenticated
using (id in ('main', 'live'));

drop policy if exists "shared state can be updated" on public.app_state;
create policy "shared state can be updated"
on public.app_state for update
to anon, authenticated
using (id in ('main', 'live'))
with check (id in ('main', 'live'));

-- True for requests coming through the Supabase Data API with the anon/publishable key or a user JWT.
-- False in the SQL Editor (session_user = postgres) and for the service_role key, so the owner is never blocked.
create or replace function private.is_api_client()
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  claims_role text;
begin
  begin
    claims_role := nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role';
  exception when others then
    claims_role := null;
  end;
  return session_user::text = 'authenticator' and coalesce(claims_role, 'anon') in ('anon', 'authenticated');
end;
$$;

-- Size of a JSON array / object; 0 for anything else (the row is attacker-writable, so never assume a type).
create or replace function private.json_size(value jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(value)
    when 'array' then jsonb_array_length(value)
    when 'object' then (select count(*)::integer from jsonb_object_keys(value))
    else 0
  end;
$$;

create or replace function private.request_header(name text)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  return left(nullif(current_setting('request.headers', true), '')::jsonb ->> name, 200);
exception when others then
  return null;
end;
$$;

-- 2 + 3. Write guard (BEFORE UPDATE).
--
-- Limits, and why (see SECURITY_REVIEW.md, "Phase 1 limits"):
--   'main' league       5 MB   Profiles carry pictures as data URLs (avatar <= 12 KB, banner <= 40 KB in-row fallback,
--                              bank QR <= 20 KB): ~72 KB a player at most, ~0.9 MB for 12 players, before rankHistory,
--                              seasonArchives (~5-10 KB a season) and auditLog (200 entries). 2 MB left too little room.
--   'main' predictions  2 MB   Bets are kept forever (~200 B each).
--   'main' dummy        1 MB   Card-game rounds; small in practice.
--   'main' rate       300/min  Score entry (400 ms debounce), predictions, Dummy saves (frequent, same row), profile
--                              saves, and up to LOCK_TRIES = 6 retries per save (a refused optimistic-lock PATCH matches
--                              no row and is not counted). Also leaves room if live scoring writes here.
--   'live' size        64 KB   Live scores of the matches in progress only.
--   'live' rate       600/min  ~1 write / 2 s per scoring device = 30/min each; room for many devices.
create or replace function private.app_state_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_league jsonb := old.league -> 'uidLeague';
  new_league jsonb := new.league -> 'uidLeague';
  old_pred jsonb := old.predictions -> 'uidPredictions';
  new_pred jsonb := new.predictions -> 'uidPredictions';
  is_live boolean := old.id = 'live';
  max_writes integer;
  recent integer;
  field text;
begin
  if not private.is_api_client() then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'app_state: id cannot change' using errcode = 'check_violation';
  end if;

  if is_live then
    max_writes := 600;
    if coalesce(octet_length(new.league::text), 0) + coalesce(octet_length(new.predictions::text), 0)
       + coalesce(octet_length(new.dummy::text), 0) > 65536 then
      raise exception 'app_state: live payload too large' using errcode = 'check_violation';
    end if;
  else
    max_writes := 300;
    -- Today's row is far below these; they only stop someone filling the database through the API.
    if octet_length(new.league::text) > 5000000 or octet_length(new.predictions::text) > 2000000
       or octet_length(new.dummy::text) > 1000000 then
      raise exception 'app_state: payload too large' using errcode = 'check_violation';
    end if;

    -- League: once the row holds a real league, every write must still be a league, and must keep most of it.
    -- A part keeps its JSON type only if the old row already had it in that type, so odd live data never blocks saves.
    -- Dummy-only saves send no league at all, so new.league = old.league and these checks pass.
    if jsonb_typeof(old_league -> 'profiles') = 'object' then
      if jsonb_typeof(new_league -> 'profiles') is distinct from 'object'
         or (jsonb_typeof(old_league -> 'seasonPlayerIds') = 'array' and jsonb_typeof(new_league -> 'seasonPlayerIds') is distinct from 'array')
         or (jsonb_typeof(old_league -> 'rounds') = 'array' and jsonb_typeof(new_league -> 'rounds') is distinct from 'array')
         or (jsonb_typeof(old_league -> 'results') = 'object' and jsonb_typeof(new_league -> 'results') is distinct from 'object') then
        raise exception 'app_state: league shape rejected' using errcode = 'check_violation';
      end if;
      -- Accounts are deactivated, never deleted, by the site. Allow small drops (restoring an older backup).
      if private.json_size(new_league -> 'profiles') = 0
         or private.json_size(new_league -> 'profiles') * 2 < private.json_size(old_league -> 'profiles') then
        raise exception 'app_state: too many accounts removed in one write' using errcode = 'check_violation';
      end if;
      foreach field in array array['rankHistory', 'seasonArchives'] loop
        if private.json_size(old_league -> field) >= 3
           and private.json_size(new_league -> field) * 2 < private.json_size(old_league -> field) then
          raise exception 'app_state: too much % removed in one write', field using errcode = 'check_violation';
        end if;
      end loop;
    end if;

    -- Predictions: bets are only ever appended or updated by the site, never removed.
    if jsonb_typeof(old_pred) = 'object' then
      if jsonb_typeof(new_pred) is distinct from 'object'
         or (old_pred ? 'bets' and jsonb_typeof(new_pred -> 'bets') is distinct from 'array') then
        raise exception 'app_state: predictions shape rejected' using errcode = 'check_violation';
      end if;
      if private.json_size(old_pred -> 'bets') >= 3
         and private.json_size(new_pred -> 'bets') * 2 < private.json_size(old_pred -> 'bets') then
        raise exception 'app_state: too many bets removed in one write' using errcode = 'check_violation';
      end if;
    end if;
  end if;

  -- Rate limit per row: fixed one-minute window. A refused write rolls this count back with it.
  insert into private.app_state_rate as r (row_id, window_start, writes)
  values (old.id, now(), 1)
  on conflict (row_id) do update
    set window_start = case when r.window_start <= now() - interval '1 minute' then now() else r.window_start end,
        writes = case when r.window_start <= now() - interval '1 minute' then 1 else r.writes + 1 end
  returning writes into recent;
  if recent > max_writes then
    raise exception 'app_state: too many writes, try again in a minute' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- 4. History (AFTER UPDATE / AFTER DELETE, not for 'live'): keep the previous value of each column that changed.
create or replace function private.app_state_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_delete boolean := tg_op = 'DELETE';
begin
  insert into private.app_state_history (row_id, operation, league, predictions, dummy, updated_at, db_role, client_ip, user_agent)
  values (
    old.id, tg_op,
    case when is_delete or old.league is distinct from new.league then old.league end,
    case when is_delete or old.predictions is distinct from new.predictions then old.predictions end,
    case when is_delete or old.dummy is distinct from new.dummy then old.dummy end,
    old.updated_at,
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text),
    coalesce(private.request_header('cf-connecting-ip'), private.request_header('x-forwarded-for')),
    private.request_header('user-agent')
  );

  -- Retention: the newest 100 versions, plus the first version replaced on each of the last 14 days (a daily restore
  -- point that a burst of junk writes cannot push out). A league version with pictures can be ~1 MB, so this keeps
  -- the history table to roughly 100-150 MB in the worst case.
  delete from private.app_state_history h
  where h.row_id = old.id
    and h.history_id < (
      select min(t.history_id) from (
        select x.history_id from private.app_state_history x
        where x.row_id = old.id order by x.history_id desc limit 100
      ) t)
    and (h.changed_at < now() - interval '14 days'
      or h.history_id not in (
        select min(d.history_id) from private.app_state_history d
        where d.row_id = old.id group by (d.changed_at at time zone 'Asia/Bangkok')::date));

  return null;
end;
$$;

drop trigger if exists app_state_guard on public.app_state;
create trigger app_state_guard
before update on public.app_state
for each row execute function private.app_state_guard();

drop trigger if exists app_state_history on public.app_state;
drop trigger if exists app_state_history_update on public.app_state;
create trigger app_state_history_update
after update on public.app_state
for each row
when (old.id <> 'live' and (old.league is distinct from new.league or old.predictions is distinct from new.predictions
      or old.dummy is distinct from new.dummy))
execute function private.app_state_record_history();

drop trigger if exists app_state_history_delete on public.app_state;
create trigger app_state_history_delete
after delete on public.app_state
for each row
when (old.id <> 'live')
execute function private.app_state_record_history();

-- Owner-only restore, run from the SQL Editor:
--   select history_id, changed_at, db_role, client_ip,
--          octet_length(league::text) as league_bytes, predictions is not null as pred, dummy is not null as dummy
--   from private.app_state_history order by history_id desc limit 50;
--   select private.restore_app_state(<history_id>);
-- Puts the row back the way it was just before write <history_id>. A history entry holds only the columns that write
-- changed, so each column is taken from the first entry at or after <history_id> that holds it (or is left as is).
create or replace function private.restore_app_state(p_history_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  target text;
  restored_at timestamptz;
begin
  select h.row_id into target from private.app_state_history h where h.history_id = p_history_id;
  if target is null then
    raise exception 'history_id % not found', p_history_id;
  end if;
  update public.app_state s
  set league = coalesce((select h.league from private.app_state_history h
                         where h.row_id = target and h.history_id >= p_history_id and h.league is not null
                         order by h.history_id limit 1), s.league),
      predictions = coalesce((select h.predictions from private.app_state_history h
                              where h.row_id = target and h.history_id >= p_history_id and h.predictions is not null
                              order by h.history_id limit 1), s.predictions),
      dummy = coalesce((select h.dummy from private.app_state_history h
                        where h.row_id = target and h.history_id >= p_history_id and h.dummy is not null
                        order by h.history_id limit 1), s.dummy),
      updated_at = now()
  where s.id = target
  returning s.updated_at into restored_at;
  if restored_at is null then
    raise exception 'row % no longer exists', target;
  end if;
  return restored_at;
end;
$$;

-- Functions are executable by PUBLIC by default; none of these are meant to be called through the API.
revoke all on function private.is_api_client() from public, anon, authenticated;
revoke all on function private.json_size(jsonb) from public, anon, authenticated;
revoke all on function private.request_header(text) from public, anon, authenticated;
revoke all on function private.app_state_guard() from public, anon, authenticated;
revoke all on function private.app_state_record_history() from public, anon, authenticated;
revoke all on function private.restore_app_state(bigint) from public, anon, authenticated;

-- Rollback (run manually if this migration causes trouble; the history table is kept unless you drop it too):
--   drop trigger if exists app_state_guard on public.app_state;
--   drop trigger if exists app_state_history_update on public.app_state;
--   drop trigger if exists app_state_history_delete on public.app_state;
--   grant insert, update on table public.app_state to anon, authenticated;
--   create policy "shared state can be initialized" on public.app_state for insert to anon, authenticated with check (id = 'main');
-- (The 'live' row and the widened select/update policies can stay; they only matter to the live-scoring page.)

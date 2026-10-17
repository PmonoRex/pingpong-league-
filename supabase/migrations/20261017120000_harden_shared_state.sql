-- Security hardening, phase 1. See SECURITY_REVIEW.md (findings S1-S3, S7).
--
-- Safe to apply while the current site is live: the browser keeps reading and PATCHing public.app_state with the
-- publishable (anon) key exactly as before. Nothing here changes what a normal save looks like. It adds:
--   1. no INSERT and no changing `id` from the API (the site only ever PATCHes the existing 'main' row);
--   2. a write guard that rejects API writes that would wipe or bloat the league / predictions in one request;
--   3. a per-row write rate limit;
--   4. a server-side history of every previous version of the row, in a schema the API cannot see, plus a
--      restore function the owner runs from the SQL Editor after vandalism or a bad restore.
--
-- It does NOT stop someone with the anon key from editing the row in small, well-formed steps (e.g. making
-- themselves admin, changing a score). That needs phase 2 (supabase/proposed/phase2_server_side_auth.sql),
-- which moves writes behind PIN-checked RPC functions and needs a matching client change.
--
-- Undo: see the "rollback" block at the end of this file.

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.app_state_history (
  history_id  bigint generated always as identity primary key,
  row_id      text not null,
  operation   text not null,
  league      jsonb,
  predictions jsonb,
  updated_at  timestamptz,                    -- updated_at of the version that was replaced
  changed_at  timestamptz not null default now(),
  db_role     text,                           -- anon / authenticated / postgres / service_role
  client_ip   text,
  user_agent  text
);
create index if not exists app_state_history_row_changed_idx on private.app_state_history (row_id, changed_at desc);
revoke all on table private.app_state_history from public, anon, authenticated;

-- 1. Grants: the site only SELECTs and PATCHes league / predictions / updated_at of the existing row.
revoke insert on table public.app_state from anon, authenticated;
drop policy if exists "shared state can be initialized" on public.app_state;
revoke update on table public.app_state from anon, authenticated;
grant update (league, predictions, updated_at) on table public.app_state to anon, authenticated;

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
  recent integer;
  field text;
begin
  if not private.is_api_client() then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'app_state: id cannot change' using errcode = 'check_violation';
  end if;

  -- Today's row is far below these; they only stop someone filling the database through the API.
  if octet_length(new.league::text) > 2000000 or octet_length(new.predictions::text) > 1000000 then
    raise exception 'app_state: payload too large' using errcode = 'check_violation';
  end if;

  -- League: once the row holds a real league, every write must still be a league, and must keep most of it.
  -- A part keeps its JSON type only if the old row already had it in that type, so odd live data never blocks saves.
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

  -- Rate limit per row. Normal score entry is a few writes per match (400 ms debounce).
  select count(*) into recent
  from private.app_state_history h
  where h.row_id = old.id and h.changed_at > now() - interval '1 minute';
  if recent >= 90 then
    raise exception 'app_state: too many writes, try again in a minute' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- 4. History (AFTER UPDATE OR DELETE): keep the version that was just replaced.
create or replace function private.app_state_record_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.app_state_history (row_id, operation, league, predictions, updated_at, db_role, client_ip, user_agent)
  values (
    old.id, tg_op, old.league, old.predictions, old.updated_at,
    coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', session_user::text),
    coalesce(private.request_header('cf-connecting-ip'), private.request_header('x-forwarded-for')),
    private.request_header('user-agent')
  );

  -- Retention: the newest 500 versions, plus the first version replaced on each day (a daily restore point that a
  -- burst of junk writes cannot push out).
  delete from private.app_state_history h
  where h.row_id = old.id
    and h.history_id < (
      select min(t.history_id) from (
        select x.history_id from private.app_state_history x
        where x.row_id = old.id order by x.history_id desc limit 500
      ) t)
    and h.history_id not in (
      select min(d.history_id) from private.app_state_history d
      where d.row_id = old.id group by (d.changed_at at time zone 'Asia/Bangkok')::date);

  return null;
end;
$$;

drop trigger if exists app_state_guard on public.app_state;
create trigger app_state_guard
before update on public.app_state
for each row execute function private.app_state_guard();

drop trigger if exists app_state_history on public.app_state;
create trigger app_state_history
after update or delete on public.app_state
for each row execute function private.app_state_record_history();

-- Owner-only restore, run from the SQL Editor:
--   select history_id, changed_at, db_role, client_ip, octet_length(league::text) as league_bytes
--   from private.app_state_history order by history_id desc limit 50;
--   select private.restore_app_state(<history_id>);
create or replace function private.restore_app_state(p_history_id bigint)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  restored_at timestamptz;
begin
  update public.app_state s
  set league = h.league, predictions = h.predictions, updated_at = now()
  from private.app_state_history h
  where h.history_id = p_history_id and s.id = h.row_id
  returning s.updated_at into restored_at;
  if restored_at is null then
    raise exception 'history_id % not found', p_history_id;
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
--   drop trigger if exists app_state_history on public.app_state;
--   grant insert, update on table public.app_state to anon, authenticated;
--   create policy "shared state can be initialized" on public.app_state for insert to anon, authenticated with check (id = 'main');

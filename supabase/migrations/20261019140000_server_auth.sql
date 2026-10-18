-- Security hardening, phase 2: server-side PIN check, session tokens, and authorization enforced in Postgres.
-- See SECURITY_REVIEW.md ("Phase 2") and docs/security-phase2.md (owner guide, Thai).
--
-- Requires 20261018130000_harden_shared_state.sql (phase 1) and 20261019120000_club_row.sql. Safe to run more than once.
--
-- Running this file changes NOTHING for the site that is live today:
--   * it adds private.credentials / private.sessions, copies every account's current PIN or PIN hash from the public
--     row into private.credentials (and keeps following PIN changes the old site still writes into the row),
--   * it adds the pp_* RPC functions that the new site (shared.js, ?v=20261019-sec2) uses when they exist,
--   * private.settings.enforce starts as FALSE: direct PATCH with the publishable key keeps working (phase 1).
--
-- The switch (run in the SQL Editor once everyone uses the new site and has logged in again):
--     update private.settings set enforce = true;
--   -> imports any last PIN changes from the row, strips pin / pinHash / mustChangePin / pinChangedAt from the public
--      row, revokes UPDATE on public.app_state from anon/authenticated (SELECT stays), and from then on every write must
--      come through a pp_save_* function with a valid session token.
-- Roll back:
--     update private.settings set enforce = false;
--   -> re-grants the phase 1 column UPDATE so direct PATCH works again. The new site keeps using the RPCs either way.
--
-- Authorization (who may change what; derived from what the site does today):
--   league (main.league.uidLeague)  admin: anything (phase 1 shape/size guard still applies).
--                                   player: only their own displayName, tagline, avatar, avatarHd, banner, promptpay,
--                                   payQr (profile-me.js), plus up to 5 new auditLog entries with their own actorId.
--                                   Credential fields are never taken from the client: PINs change only through
--                                   pp_change_pin / pp_reset_pin, or an admin setting profiles[id].pinResetAt (resetPin).
--   predictions                     admin: anything. dealer: markets, settleLog, nextBetId, and status/net/settledAt of
--                                   existing bets; cannot change the dealer, remove bets or bet. player: may only append
--                                   pending bets in their own name on an open market, not on their own match, once per
--                                   match, with a whole positive stake; nothing else.
--   dummy                           any signed-in active account (shared score sheet, own lock dummy.rev).
--   live                            admin: anything. player: may add/change/remove a live match only when they are one
--                                   of its two players or its scorer (`by`), and may remove anyone's entry that is
--                                   stale (> 6 h), which live.js does when it saves.
--   club                            admin: anything. player: matches / challenges / tournaments items they create must
--                                   name them as owner (by / from / by); they may change or remove only items they own
--                                   or take part in (a, b, to, teamA, teamB, entrants); reactions, MVP votes and
--                                   check-ins only under their own user key; comments only their own (others' may only
--                                   drop off the 300 cap). Other keys: signed-in member + 1 MB cap (residual risk).

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- 1. Tables (private schema: not reachable through the Data API)
------------------------------------------------------------------------------------------------------------------
create table if not exists private.settings (
  id         boolean primary key default true check (id),
  enforce    boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into private.settings (id) values (true) on conflict (id) do nothing;

create table if not exists private.credentials (
  user_id         text primary key,
  pin_bcrypt      text,             -- extensions.crypt(pin, gen_salt('bf', 10))
  legacy_pbkdf2   text,             -- the browser-made pinHash; replaced by bcrypt on first successful login
  must_change     boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  row_fp          text,             -- fingerprint of the row's pin fields last imported (see import_row_credentials)
  updated_at      timestamptz not null default now()
);
alter table private.credentials add column if not exists row_fp text;

create table if not exists private.sessions (
  token_hash text primary key,      -- sha256 of the token; the token itself only lives in the user's browser
  user_id    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_user_idx on private.sessions (user_id);

create table if not exists private.login_attempts (
  ip text,
  at timestamptz not null default now()
);
create index if not exists login_attempts_ip_at_idx on private.login_attempts (ip, at desc);

revoke all on table private.settings, private.credentials, private.sessions, private.login_attempts
  from public, anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- 2. Helpers
------------------------------------------------------------------------------------------------------------------
create or replace function private.enforced()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.enforce from private.settings s where s.id), false);
$$;

-- PBKDF2-HMAC-SHA256, one 32-byte block: verifies the hashes the browser wrote ("pbkdf2-sha256$<iter>$<salt>$<hash>").
create or replace function private.pbkdf2_sha256_hex(p_password text, p_salt_hex text, p_iterations integer)
returns text
language plpgsql
immutable
strict
set search_path = ''
as $$
declare
  pass bytea := convert_to(p_password, 'UTF8');
  u bytea := extensions.hmac(decode(p_salt_hex, 'hex') || '\x00000001'::bytea, pass, 'sha256');
  t bit(256) := ('x' || encode(u, 'hex'))::bit(256);
  hex text := '';
begin
  for i in 2..p_iterations loop
    u := extensions.hmac(u, pass, 'sha256');
    t := t # ('x' || encode(u, 'hex'))::bit(256);
  end loop;
  for i in 0..7 loop
    hex := hex || lpad(to_hex(substring(t from i * 32 + 1 for 32)::bit(32)::integer), 8, '0');
  end loop;
  return hex;
end;
$$;

create or replace function private.pin_policy_ok(p_pin text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  steps integer[] := '{}';
begin
  if p_pin is null or p_pin !~ '^\d{4,6}$' or p_pin = '1234' or p_pin ~ '^(\d)\1+$' then
    return false;
  end if;
  for i in 2..length(p_pin) loop
    steps := steps || ((substr(p_pin, i, 1)::integer - substr(p_pin, i - 1, 1)::integer + 10) % 10);
  end loop;
  return not (steps <@ array[1] or steps <@ array[9]);
end;
$$;

create or replace function private.verify_pin(p_cred private.credentials, p_pin text)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_pin is null or p_pin = '' then return false; end if;
  if p_cred.pin_bcrypt is not null and extensions.crypt(p_pin, p_cred.pin_bcrypt) = p_cred.pin_bcrypt then
    return true;
  end if;
  -- Never NULL: callers test "if not verify_pin(...)", and NULL would let a wrong PIN through.
  if p_cred.legacy_pbkdf2 is null
     or p_cred.legacy_pbkdf2 !~ '^pbkdf2-sha256\$[0-9]{5,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$'
     or split_part(p_cred.legacy_pbkdf2, '$', 2)::integer not between 10000 and 1000000 then
    return false;
  end if;
  return coalesce(private.pbkdf2_sha256_hex(p_pin, split_part(p_cred.legacy_pbkdf2, '$', 3),
                    split_part(p_cred.legacy_pbkdf2, '$', 2)::integer) = split_part(p_cred.legacy_pbkdf2, '$', 4), false);
end;
$$;

create or replace function private.profile(p_user_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select league #> array['uidLeague', 'profiles', p_user_id] from public.app_state where id = 'main';
$$;

create or replace function private.is_admin(p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.profile(p_user_id) ->> 'role' = 'admin' and coalesce(private.profile(p_user_id) ->> 'active', 'true') <> 'false', false);
$$;

-- Resolves a session token to an active account id, or raises 'session expired' (the client then asks for the PIN).
create or replace function private.session_user_id(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid text;
begin
  select s.user_id into uid from private.sessions s
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expires_at > now();
  if uid is null or private.profile(uid) is null or coalesce(private.profile(uid) ->> 'active', 'true') = 'false' then
    raise exception 'session expired' using errcode = '28000';
  end if;
  return uid;
end;
$$;

-- Marks this transaction as an RPC write, so the auth guard lets it through when enforce is on.
create or replace function private.begin_rpc_write()
returns void
language sql
set search_path = ''
as $$
  select set_config('pp.rpc', 'on', true);
$$;

create or replace function private.cred_fields()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['pin', 'pinHash', 'mustChangePin', 'pinChangedAt'];
$$;

-- profiles object with the credential fields removed from every profile.
create or replace function private.strip_profiles(p_profiles jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_profiles) = 'object' then coalesce((
    select jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'object' then e.value - private.cred_fields() else e.value end)
    from jsonb_each(p_profiles) as e), '{}'::jsonb) else p_profiles end;
$$;

-- The credential fields of one profile (to carry the row's values over while enforce is off).
create or replace function private.cred_part(p_profile jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_profile) = 'object' then coalesce((
    select jsonb_object_agg(e.key, e.value) from jsonb_each(p_profile) as e where e.key = any(private.cred_fields())), '{}'::jsonb)
  else '{}'::jsonb end;
$$;

create or replace function private.reset_credentials(p_user_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into private.credentials (user_id, pin_bcrypt, must_change)
  values (p_user_id, extensions.crypt('1234', extensions.gen_salt('bf', 10)), true)
  on conflict (user_id) do update
  set pin_bcrypt = excluded.pin_bcrypt, legacy_pbkdf2 = null, must_change = true,
      failed_attempts = 0, locked_until = null, updated_at = now();
  delete from private.sessions s where s.user_id = p_user_id;
$$;

-- Copies PINs / PIN hashes the (old) site wrote into the public row into private.credentials. Only profiles whose pin
-- fields changed since the last import are touched (row_fp), so a PIN changed through pp_change_pin is not overwritten
-- by the stale hash that is still in the row. Runs once below, after every 'main' league write while enforce is off,
-- and one last time when enforce is switched on.
create or replace function private.import_row_credentials()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  fp text;
  n integer := 0;
begin
  for r in
    select e.key as uid, e.value as p
    from public.app_state s, jsonb_each(case when jsonb_typeof(s.league #> '{uidLeague,profiles}') = 'object'
                                             then s.league #> '{uidLeague,profiles}' else '{}'::jsonb end) as e
    where s.id = 'main'
  loop
    continue when jsonb_typeof(r.p) is distinct from 'object' or not (r.p ? 'pin' or r.p ? 'pinHash');
    fp := md5(jsonb_build_object('pin', r.p -> 'pin', 'pinHash', r.p -> 'pinHash', 'must', r.p -> 'mustChangePin')::text);
    continue when exists (select 1 from private.credentials c where c.user_id = r.uid and c.row_fp is not distinct from fp);
    insert into private.credentials as c (user_id, pin_bcrypt, legacy_pbkdf2, must_change, row_fp)
    values (
      r.uid,
      case when jsonb_typeof(r.p -> 'pin') = 'string' then extensions.crypt(r.p ->> 'pin', extensions.gen_salt('bf', 10)) end,
      case when jsonb_typeof(r.p -> 'pinHash') = 'string' then r.p ->> 'pinHash' end,
      coalesce(r.p -> 'mustChangePin' = 'true'::jsonb, false) or jsonb_typeof(r.p -> 'pinHash') is distinct from 'string',
      fp)
    on conflict (user_id) do update
    set pin_bcrypt = excluded.pin_bcrypt, legacy_pbkdf2 = excluded.legacy_pbkdf2, must_change = excluded.must_change,
        row_fp = excluded.row_fp, updated_at = now();
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Strings anywhere inside a value (player ids in a / b / pair / teamA / entrants ...).
create or replace function private.json_strings(p_value jsonb)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(v #>> '{}'), '{}')
  from jsonb_path_query(coalesce(p_value, 'null'::jsonb), 'lax $.** ? (@.type() == "string")') as v;
$$;

create or replace function private.try_ts(p_text text)
returns timestamptz
language plpgsql
immutable
set search_path = ''
as $$
begin
  return p_text::timestamptz;
exception when others then
  return null;
end;
$$;

-- The client's normalizeLeague() adds these when missing; compare leagues as the client would have written them.
create or replace function private.league_norm(p_league jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select p_league
    || jsonb_build_object(
         'rankHistory', case when jsonb_typeof(p_league -> 'rankHistory') = 'array' then p_league -> 'rankHistory' else '[]'::jsonb end,
         'seasonArchives', case when jsonb_typeof(p_league -> 'seasonArchives') = 'array' then p_league -> 'seasonArchives' else '[]'::jsonb end,
         'auditLog', case when jsonb_typeof(p_league -> 'auditLog') = 'array' then p_league -> 'auditLog' else '[]'::jsonb end,
         'schemaVersion', case when jsonb_typeof(p_league -> 'schemaVersion') = 'number' and (p_league ->> 'schemaVersion')::numeric >= 2
                               then p_league -> 'schemaVersion' else '2'::jsonb end);
$$;

-- Elements [p_from, p_from + p_count) of an array (0-based), as an array.
create or replace function private.json_slice(p_arr jsonb, p_from integer, p_count integer)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(e.v order by e.i), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_arr) = 'array' then p_arr else '[]'::jsonb end) with ordinality as e(v, i)
  where e.i - 1 >= p_from and e.i - 1 < p_from + p_count;
$$;

------------------------------------------------------------------------------------------------------------------
-- 3. Authorization rules (each returns NULL when allowed, or the reason it is refused)
------------------------------------------------------------------------------------------------------------------
-- p_old / p_new: uidLeague with credential fields stripped.
create or replace function private.league_change_denied(p_uid text, p_admin boolean, p_old jsonb, p_new jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  allowed text[] := array['displayName', 'tagline', 'avatar', 'avatarHd', 'banner', 'promptpay', 'payQr'];
  o jsonb := private.league_norm(coalesce(p_old, '{}'::jsonb));
  n jsonb := private.league_norm(p_new);
  old_log jsonb := o -> 'auditLog';
  new_log jsonb := n -> 'auditLog';
  new_len integer := jsonb_array_length(n -> 'auditLog');
  log_ok boolean := false;
  own_old jsonb := o #> array['profiles', p_uid];
  own_new jsonb := n #> array['profiles', p_uid];
  name text;
begin
  if p_admin then return null; end if;
  -- auditLog: up to 5 new entries at the top, all by this player; the rest is the old log (cut at 200).
  for k in 0..least(5, new_len) loop
    if (select bool_and(new_log -> i ->> 'actorId' = p_uid) from generate_series(0, k - 1) as i) is not false
       and private.json_slice(new_log, k, new_len - k) = private.json_slice(old_log, 0, new_len - k)
       and (new_len - k = jsonb_array_length(old_log) or new_len = 200) then
      log_ok := true; exit;
    end if;
  end loop;
  if not log_ok then return 'players cannot rewrite the audit log'; end if;
  if (n - 'auditLog' - 'profiles') is distinct from (o - 'auditLog' - 'profiles') then
    return 'only an admin can change the league';
  end if;
  if (n -> 'profiles') - p_uid is distinct from (o -> 'profiles') - p_uid then
    return 'players can only edit their own profile';
  end if;
  if own_new is null or jsonb_typeof(own_new) <> 'object' or (own_new - allowed) is distinct from (own_old - allowed) then
    return 'players can only change their name, picture, tagline and payment details';
  end if;
  name := btrim(coalesce(own_new ->> 'displayName', ''));
  if name = '' or char_length(name) > 30 then return 'display name rejected'; end if;
  if exists (select 1 from jsonb_each(n -> 'profiles') as e
             where e.key <> p_uid and lower(e.value ->> 'displayName') = lower(name)) then
    return 'display name already used';
  end if;
  if octet_length(own_new::text) > 200000 then return 'profile too large'; end if;
  return null;
end;
$$;

-- p_old / p_new: uidPredictions. p_dealer_old: the dealer before this write.
create or replace function private.predictions_change_denied(p_uid text, p_admin boolean, p_old jsonb, p_new jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  o jsonb := coalesce(p_old, '{}'::jsonb);
  old_bets jsonb := case when jsonb_typeof(o -> 'bets') = 'array' then o -> 'bets' else '[]'::jsonb end;
  new_bets jsonb := p_new -> 'bets';
  old_count integer := jsonb_array_length(case when jsonb_typeof(o -> 'bets') = 'array' then o -> 'bets' else '[]'::jsonb end);
  is_dealer boolean := (o ->> 'dealerId') is not distinct from p_uid;
  settle_keys text[] := array['status', 'net', 'settledAt'];
  b jsonb;
  market jsonb;
begin
  if jsonb_typeof(p_new) is distinct from 'object' or jsonb_typeof(new_bets) is distinct from 'array' then
    return 'predictions shape rejected';
  end if;
  if p_admin then return null; end if;
  if (p_new -> 'dealerId') is distinct from (o -> 'dealerId') then return 'only an admin can change the dealer'; end if;
  if jsonb_array_length(new_bets) < old_count then return 'bets cannot be removed'; end if;
  if is_dealer then
    -- Settlement: only the result fields of existing bets change.
    if exists (select 1 from generate_series(0, old_count - 1) as i
               where (new_bets -> i) - settle_keys is distinct from (old_bets -> i) - settle_keys) then
      return 'the dealer can only settle existing bets';
    end if;
  else
    if (p_new - 'bets' - 'nextBetId') is distinct from (o - 'bets' - 'nextBetId') then
      return 'only the dealer can manage markets';
    end if;
    if private.json_slice(new_bets, 0, old_count) is distinct from old_bets then
      return 'players cannot change existing bets';
    end if;
  end if;
  -- New bets (anyone but an admin): pending, own name, open market, not own match, once per match.
  for b in select e.v from jsonb_array_elements(new_bets) with ordinality as e(v, i) where e.i > old_count loop
    if is_dealer then return 'the dealer cannot bet'; end if;
    market := o #> array['markets', 's' || coalesce(b ->> 'season', '') || ':' || coalesce(b ->> 'matchId', '')];
    if b ->> 'userId' is distinct from p_uid then return 'players can only bet in their own name'; end if;
    if b ->> 'status' is distinct from 'pending' or coalesce(b ->> 'net', '0') <> '0'
       or jsonb_typeof(b -> 'stake') is distinct from 'number' or (b ->> 'stake')::numeric <= 0
       or (b ->> 'stake')::numeric <> trunc((b ->> 'stake')::numeric) or (b ->> 'stake')::numeric > 1000000 then
      return 'bet rejected';
    end if;
    if market -> 'open' is distinct from 'true'::jsonb
       or (b -> 'favoriteId') is distinct from (market -> 'favoriteId') or (b -> 'handicap') is distinct from (market -> 'handicap') then
      return 'this market is not open';
    end if;
    if p_uid = any(private.json_strings(b -> 'pair')) or not ((b ->> 'sideId') = any(private.json_strings(b -> 'pair'))) then
      return 'bet rejected';
    end if;
    if exists (select 1 from jsonb_array_elements(new_bets) with ordinality as x(v, i)
               where x.v ->> 'userId' = p_uid and x.v -> 'season' = b -> 'season' and x.v -> 'matchId' = b -> 'matchId'
               and x.v is distinct from b) then
      return 'already bet on this match';
    end if;
  end loop;
  return null;
end;
$$;

-- p_old / p_new: the live row's league column { matches: { key: match } }.
create or replace function private.live_change_denied(p_uid text, p_admin boolean, p_old jsonb, p_new jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  om jsonb := case when jsonb_typeof(p_old -> 'matches') = 'object' then p_old -> 'matches' else '{}'::jsonb end;
  nm jsonb := p_new -> 'matches';
  k text;
  o jsonb;
  n jsonb;
begin
  if jsonb_typeof(p_new) is distinct from 'object' or (p_new - 'matches') <> '{}'::jsonb
     or (nm is not null and jsonb_typeof(nm) <> 'object') then
    return 'live shape rejected';
  end if;
  if p_admin then return null; end if;
  nm := coalesce(nm, '{}'::jsonb);
  for k in select jsonb_object_keys(om) union select jsonb_object_keys(nm) loop
    o := om -> k; n := nm -> k;
    continue when o is not distinct from n;
    continue when p_uid = any(private.json_strings(jsonb_build_array(o -> 'pair', o -> 'by', n -> 'pair', n -> 'by')));
    continue when n is null and coalesce(private.try_ts(o ->> 'at'), '-infinity') < now() - interval '6 hours';
    return 'only the players of a match can score it live';
  end loop;
  return null;
end;
$$;

-- Lists of items with an id. Added items must name the player as p_owner; changed / removed items must involve them.
-- p_trim_at: others' items may drop off when the list is at that cap (comments). p_owner_fixed: the owner field may not
-- change (club.matches.by means "last recorded by", so it may). p_tournaments: an item with a tournamentId may also be
-- changed / removed by that tournament's creator or entrants (tournament.js rewrites and prunes its club.matches).
drop function if exists private.items_denied(text, jsonb, jsonb, text, text[], integer);
create or replace function private.items_denied(p_uid text, p_old jsonb, p_new jsonb, p_owner text, p_people text[],
                                                p_trim_at integer default 0, p_owner_fixed boolean default true,
                                                p_tournaments jsonb default null)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  om jsonb;
  nm jsonb;
  k text;
  o jsonb;
  n jsonb;
begin
  if p_new is not null and jsonb_typeof(p_new) <> 'array' then return 'club list shape rejected'; end if;
  select coalesce(jsonb_object_agg(coalesce(e ->> 'id', md5(e::text)), e), '{}'::jsonb) into om
  from jsonb_array_elements(case when jsonb_typeof(p_old) = 'array' then p_old else '[]'::jsonb end) as e;
  select coalesce(jsonb_object_agg(coalesce(e ->> 'id', md5(e::text)), e), '{}'::jsonb) into nm
  from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) as e;
  for k in select jsonb_object_keys(om) union select jsonb_object_keys(nm) loop
    o := om -> k; n := nm -> k;
    continue when o is not distinct from n;
    if o is null then
      if n ->> p_owner is distinct from p_uid then return 'new items must be your own'; end if;
      continue;
    end if;
    if n is null and p_trim_at > 0 and jsonb_array_length(coalesce(p_new, '[]'::jsonb)) >= p_trim_at then continue; end if;
    if not (p_uid = any(private.json_strings((select jsonb_agg(o -> f) from unnest(p_people) as f))))
       and not (o ->> 'tournamentId' is not null and exists (
         select 1 from jsonb_array_elements(case when jsonb_typeof(p_tournaments) = 'array' then p_tournaments else '[]'::jsonb end) as t
         where t ->> 'id' = o ->> 'tournamentId' and p_uid = any(private.json_strings(jsonb_build_array(t -> 'by', t -> 'entrants'))))) then
      return 'you can only change items you own or play in';
    end if;
    if p_owner_fixed and n is not null and (n -> p_owner) is distinct from (o -> p_owner) then return 'the owner of an item cannot change'; end if;
  end loop;
  return null;
end;
$$;

-- { outerKey: { userId: value } }: only the player's own inner key may change. Whole outer keys below p_prune_before
-- (dates, for check-ins) may be dropped by anyone, as social.js does to keep the row small.
drop function if exists private.map2_denied(text, jsonb, jsonb);
create or replace function private.map2_denied(p_uid text, p_old jsonb, p_new jsonb, p_prune_before text default null)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  om jsonb := case when jsonb_typeof(p_old) = 'object' then p_old else '{}'::jsonb end;
  nm jsonb := coalesce(p_new, '{}'::jsonb);
  k text;
  o jsonb;
  n jsonb;
begin
  if jsonb_typeof(nm) <> 'object' then return 'club map shape rejected'; end if;
  for k in select jsonb_object_keys(om) union select jsonb_object_keys(nm) loop
    o := coalesce(om -> k, '{}'::jsonb); n := coalesce(nm -> k, '{}'::jsonb);
    continue when o = n;
    continue when nm -> k is null and p_prune_before is not null and k < p_prune_before;
    if jsonb_typeof(o) <> 'object' or jsonb_typeof(n) <> 'object' or (o - p_uid) <> (n - p_uid) then
      return 'you can only change your own entry';
    end if;
  end loop;
  return null;
end;
$$;

-- p_old / p_new: the club object (docs/club-data.md).
create or replace function private.club_change_denied(p_uid text, p_admin boolean, p_old jsonb, p_new jsonb)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  o jsonb := case when jsonb_typeof(p_old) = 'object' then p_old else '{}'::jsonb end;
  why text;
begin
  if jsonb_typeof(p_new) is distinct from 'object' then return 'club shape rejected'; end if;
  if octet_length(p_new::text) > 1000000 then return 'club data too large'; end if;
  if p_admin then return null; end if;
  if p_new -> 'social' is not null and jsonb_typeof(p_new -> 'social') <> 'object' then return 'club shape rejected'; end if;
  why := coalesce(
    private.items_denied(p_uid, o -> 'matches', p_new -> 'matches', 'by', array['by', 'a', 'b'], 0, false,
      coalesce(case when jsonb_typeof(o -> 'tournaments') = 'array' then o -> 'tournaments' end, '[]'::jsonb)
      || coalesce(case when jsonb_typeof(p_new -> 'tournaments') = 'array' then p_new -> 'tournaments' end, '[]'::jsonb)),
    private.items_denied(p_uid, o -> 'challenges', p_new -> 'challenges', 'from', array['from', 'to', 'teamA', 'teamB']),
    private.items_denied(p_uid, o -> 'tournaments', p_new -> 'tournaments', 'by', array['by', 'entrants']),
    private.items_denied(p_uid, o #> '{social,comments}', p_new #> '{social,comments}', 'by', array['by'], 300),
    private.map2_denied(p_uid, o #> '{social,reactions}', p_new #> '{social,reactions}'),
    private.map2_denied(p_uid, o -> 'mvp', p_new -> 'mvp'),
    private.map2_denied(p_uid, o -> 'checkin', p_new -> 'checkin',
      to_char((now() at time zone 'Asia/Bangkok')::date - 29, 'YYYY-MM-DD')));
  if why is null and ((p_new -> 'social') - 'comments' - 'reactions') is distinct from ((o -> 'social') - 'comments' - 'reactions')
     and o -> 'social' is not null then
    why := 'club shape rejected';
  end if;
  return why;
end;
$$;

------------------------------------------------------------------------------------------------------------------
-- 4. Triggers: block direct writes once enforced, follow old-site PIN changes until then
------------------------------------------------------------------------------------------------------------------
create or replace function private.app_state_auth_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_api_client() or not private.enforced() then
    return new;
  end if;
  if coalesce(current_setting('pp.rpc', true), '') <> 'on' then
    raise exception 'app_state: direct writes are disabled, reload the site' using errcode = '42501';
  end if;
  if new.id = 'main' and jsonb_typeof(new.league #> '{uidLeague,profiles}') = 'object'
     and exists (select 1 from jsonb_each(new.league #> '{uidLeague,profiles}') as e
                 where jsonb_typeof(e.value) = 'object' and e.value ?| private.cred_fields()) then
    raise exception 'app_state: credentials are not stored in the public row' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists app_state_auth_guard on public.app_state;
create trigger app_state_auth_guard
before update on public.app_state
for each row execute function private.app_state_auth_guard();

create or replace function private.app_state_follow_credentials()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.enforced() then
    perform private.import_row_credentials();
  end if;
  return null;
end;
$$;

drop trigger if exists app_state_follow_credentials on public.app_state;
create trigger app_state_follow_credentials
after update on public.app_state
for each row
when (old.id = 'main' and old.league is distinct from new.league)
execute function private.app_state_follow_credentials();

-- The switch. Runs when the owner changes private.settings.enforce.
create or replace function private.settings_apply()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  if new.enforce and not coalesce(old.enforce, false) then
    perform private.import_row_credentials();
    update public.app_state s
    set league = jsonb_set(s.league, '{uidLeague,profiles}', private.strip_profiles(s.league #> '{uidLeague,profiles}')),
        updated_at = now()
    where s.id = 'main' and jsonb_typeof(s.league #> '{uidLeague,profiles}') = 'object';
    revoke update on table public.app_state from anon, authenticated;
  elsif not new.enforce and coalesce(old.enforce, false) then
    grant update (league, predictions, dummy, updated_at) on table public.app_state to anon, authenticated;
  end if;
  return new;
end;
$$;

drop trigger if exists settings_apply on private.settings;
create trigger settings_apply
before update on private.settings
for each row execute function private.settings_apply();

------------------------------------------------------------------------------------------------------------------
-- 5. RPC functions (POST /rest/v1/rpc/<name>)
------------------------------------------------------------------------------------------------------------------
-- Cheap probe the site uses to decide between RPC writes and the old direct PATCH.
create or replace function public.pp_auth_version()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', 1, 'enforce', private.enforced());
$$;

-- Returns {token, user_id, role, must_change, expires_at} or {error[, retry_after_seconds]}. Failures are returned, not
-- raised, so the counters commit. 5 wrong PINs -> 15 minutes per account; 30 attempts per IP per 10 minutes.
create or replace function public.pp_login(p_user_id text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cred private.credentials;
  client_ip text := coalesce(private.request_header('cf-connecting-ip'), private.request_header('x-forwarded-for'), 'unknown');
  token text;
  expires timestamptz := now() + interval '30 days';
begin
  if (select count(*) from private.login_attempts a where a.ip = client_ip and a.at > now() - interval '10 minutes') >= 30 then
    return jsonb_build_object('error', 'locked', 'retry_after_seconds', 600);
  end if;
  insert into private.login_attempts (ip) values (client_ip);
  delete from private.login_attempts a where a.at < now() - interval '1 day';

  select * into cred from private.credentials c where c.user_id = p_user_id for update;
  if cred.user_id is null or private.profile(p_user_id) is null
     or coalesce(private.profile(p_user_id) ->> 'active', 'true') = 'false' then
    return jsonb_build_object('error', 'wrong account or PIN');
  end if;
  if cred.locked_until > now() then
    return jsonb_build_object('error', 'locked', 'retry_after_seconds', ceil(extract(epoch from cred.locked_until - now())));
  end if;
  if not private.verify_pin(cred, p_pin) then
    update private.credentials c
    set failed_attempts = case when c.failed_attempts + 1 >= 5 then 0 else c.failed_attempts + 1 end,
        locked_until = case when c.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else c.locked_until end
    where c.user_id = p_user_id;
    if cred.failed_attempts + 1 >= 5 then
      return jsonb_build_object('error', 'locked', 'retry_after_seconds', 900);
    end if;
    return jsonb_build_object('error', 'wrong account or PIN');
  end if;

  update private.credentials c
  set failed_attempts = 0, locked_until = null,
      pin_bcrypt = case when c.legacy_pbkdf2 is not null and (c.pin_bcrypt is null or extensions.crypt(p_pin, c.pin_bcrypt) <> c.pin_bcrypt)
                        then extensions.crypt(p_pin, extensions.gen_salt('bf', 10)) else c.pin_bcrypt end,
      legacy_pbkdf2 = null
  where c.user_id = p_user_id;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sessions (token_hash, user_id, expires_at)
  values (encode(extensions.digest(token, 'sha256'), 'hex'), p_user_id, expires);
  delete from private.sessions s where s.expires_at < now();
  return jsonb_build_object('token', token, 'user_id', p_user_id, 'role', private.profile(p_user_id) ->> 'role',
                            'must_change', cred.must_change, 'expires_at', expires);
end;
$$;

create or replace function public.pp_logout(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from private.sessions s where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
$$;

-- {user_id, role, must_change, expires_at} for a valid token, or null (never raises).
create or replace function public.pp_whoami(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('user_id', s.user_id, 'role', private.profile(s.user_id) ->> 'role',
                            'must_change', coalesce(c.must_change, false), 'expires_at', s.expires_at)
  from private.sessions s left join private.credentials c on c.user_id = s.user_id
  where s.token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and s.expires_at > now()
    and private.profile(s.user_id) is not null and coalesce(private.profile(s.user_id) ->> 'active', 'true') <> 'false';
$$;

-- Returns {ok: true} or {error: 'wrong current PIN' | 'PIN not allowed' | 'locked'}; raises only for an expired session.
-- A wrong current PIN counts towards the account lockout.
create or replace function public.pp_change_pin(p_token text, p_current_pin text, p_new_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  cred private.credentials;
begin
  select * into cred from private.credentials c where c.user_id = uid for update;
  if cred.locked_until > now() then
    return jsonb_build_object('error', 'locked', 'retry_after_seconds', ceil(extract(epoch from cred.locked_until - now())));
  end if;
  if not private.verify_pin(cred, p_current_pin) then
    update private.credentials c
    set failed_attempts = case when c.failed_attempts + 1 >= 5 then 0 else c.failed_attempts + 1 end,
        locked_until = case when c.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else c.locked_until end
    where c.user_id = uid;
    return jsonb_build_object('error', 'wrong current PIN');
  end if;
  if not private.pin_policy_ok(p_new_pin) or p_new_pin = p_current_pin then
    return jsonb_build_object('error', 'PIN not allowed');
  end if;
  update private.credentials c
  set pin_bcrypt = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)), legacy_pbkdf2 = null,
      must_change = false, failed_attempts = 0, locked_until = null, updated_at = now()
  where c.user_id = uid;
  -- Other devices of this account must log in again with the new PIN.
  delete from private.sessions s where s.user_id = uid and s.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex');
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.pp_reset_pin(p_token text, p_target text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
begin
  if not private.is_admin(uid) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if private.profile(p_target) is null then
    raise exception 'no such account' using errcode = 'check_violation';
  end if;
  perform private.reset_credentials(p_target);
end;
$$;

-- League save (admin: anything; player: own profile fields). Optimistic lock like the old PATCH: returns the new
-- updated_at, or null when the row is no longer at p_expected (another device saved first).
create or replace function public.pp_save_league(p_token text, p_league jsonb, p_expected timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  admin boolean := private.is_admin(uid);
  enforce boolean := private.enforced();
  row_league jsonb;
  row_at timestamptz;
  old_league jsonb;
  clean jsonb;
  why text;
  saved timestamptz;
begin
  perform private.begin_rpc_write();
  if jsonb_typeof(p_league) is distinct from 'object' or jsonb_typeof(p_league -> 'profiles') is distinct from 'object' then
    raise exception 'league shape rejected' using errcode = 'check_violation';
  end if;
  select s.league, s.updated_at into row_league, row_at from public.app_state s where s.id = 'main' for update;
  if p_expected is not null and row_at is distinct from p_expected then return null; end if;
  old_league := coalesce(row_league -> 'uidLeague', '{}'::jsonb);
  clean := jsonb_set(p_league, '{profiles}', private.strip_profiles(p_league -> 'profiles'));
  if old_league ? 'profiles' then
    why := private.league_change_denied(uid, admin,
      old_league || jsonb_build_object('profiles', private.strip_profiles(old_league -> 'profiles')), clean);
    if why is not null then raise exception '%', why using errcode = '42501'; end if;
  elsif not admin then
    raise exception 'only an admin can change the league' using errcode = '42501';
  end if;

  if admin then
    -- New accounts start on the default PIN 1234 and must change it.
    insert into private.credentials (user_id, pin_bcrypt, must_change)
    select e.key, extensions.crypt('1234', extensions.gen_salt('bf', 10)), true
    from jsonb_each(clean -> 'profiles') as e
    where not (old_league -> 'profiles' ? e.key)
    on conflict (user_id) do nothing;
    -- resetPin() marks a reset with a new profiles[id].pinResetAt.
    perform private.reset_credentials(e.key)
    from jsonb_each(clean -> 'profiles') as e
    where old_league -> 'profiles' ? e.key and jsonb_typeof(e.value -> 'pinResetAt') = 'string'
      and (e.value -> 'pinResetAt') is distinct from (old_league #> array['profiles', e.key, 'pinResetAt']);
  end if;

  -- Until enforce is on, keep the row's PIN fields as they are, so the old site keeps working beside the new one.
  if not enforce then
    clean := jsonb_set(clean, '{profiles}', (
      select coalesce(jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'object'
                                                   then e.value || private.cred_part(old_league #> array['profiles', e.key])
                                                   else e.value end), '{}'::jsonb)
      from jsonb_each(clean -> 'profiles') as e));
  end if;

  update public.app_state s
  set league = jsonb_set(s.league, '{uidLeague}', clean), updated_at = now()
  where s.id = 'main'
  returning s.updated_at into saved;
  return saved;
end;
$$;

create or replace function public.pp_save_predictions(p_token text, p_predictions jsonb, p_expected timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  row_pred jsonb;
  row_at timestamptz;
  why text;
  saved timestamptz;
begin
  perform private.begin_rpc_write();
  select s.predictions, s.updated_at into row_pred, row_at from public.app_state s where s.id = 'main' for update;
  if p_expected is not null and row_at is distinct from p_expected then return null; end if;
  why := private.predictions_change_denied(uid, private.is_admin(uid), row_pred -> 'uidPredictions', p_predictions);
  if why is not null then raise exception '%', why using errcode = '42501'; end if;
  update public.app_state s
  set predictions = jsonb_set(s.predictions, '{uidPredictions}', p_predictions), updated_at = now()
  where s.id = 'main'
  returning s.updated_at into saved;
  return saved;
end;
$$;

-- Dummy sheet: any signed-in account. Lock on dummy.rev (0 = no rev yet), never touches updated_at.
-- Returns the saved object, or null when another device saved first.
create or replace function public.pp_save_dummy(p_token text, p_dummy jsonb, p_expected_rev integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  cur text;
begin
  perform private.begin_rpc_write();
  if jsonb_typeof(p_dummy) is distinct from 'object' then
    raise exception 'dummy shape rejected' using errcode = 'check_violation';
  end if;
  select s.dummy ->> 'rev' into cur from public.app_state s where s.id = 'main' for update;
  if not found then return null; end if;
  if (coalesce(p_expected_rev, 0) = 0 and cur is not null) or (coalesce(p_expected_rev, 0) <> 0 and cur is distinct from p_expected_rev::text) then
    return null;
  end if;
  update public.app_state s set dummy = p_dummy where s.id = 'main';
  return p_dummy;
end;
$$;

create or replace function public.pp_save_live(p_token text, p_live jsonb, p_expected timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  row_live jsonb;
  row_at timestamptz;
  why text;
  saved timestamptz;
begin
  perform private.begin_rpc_write();
  select s.league, s.updated_at into row_live, row_at from public.app_state s where s.id = 'live' for update;
  if not found then raise exception 'live row missing' using errcode = 'check_violation'; end if;
  if p_expected is not null and row_at is distinct from p_expected then return null; end if;
  why := private.live_change_denied(uid, private.is_admin(uid), row_live, p_live);
  if why is not null then raise exception '%', why using errcode = '42501'; end if;
  update public.app_state s set league = p_live, updated_at = now() where s.id = 'live'
  returning s.updated_at into saved;
  return saved;
end;
$$;

create or replace function public.pp_save_club(p_token text, p_club jsonb, p_expected timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  row_league jsonb;
  row_at timestamptz;
  why text;
  saved timestamptz;
begin
  perform private.begin_rpc_write();
  select s.league, s.updated_at into row_league, row_at from public.app_state s where s.id = 'club' for update;
  if not found then raise exception 'club row missing' using errcode = 'check_violation'; end if;
  if p_expected is not null and row_at is distinct from p_expected then return null; end if;
  why := private.club_change_denied(uid, private.is_admin(uid), row_league -> 'club', p_club);
  if why is not null then raise exception '%', why using errcode = '42501'; end if;
  update public.app_state s set league = jsonb_set(coalesce(s.league, '{}'::jsonb), '{club}', p_club), updated_at = now()
  where s.id = 'club'
  returning s.updated_at into saved;
  return saved;
end;
$$;

------------------------------------------------------------------------------------------------------------------
-- 6. Grants
------------------------------------------------------------------------------------------------------------------
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname in ('enforced', 'pbkdf2_sha256_hex', 'pin_policy_ok', 'verify_pin', 'profile',
      'is_admin', 'session_user_id', 'begin_rpc_write', 'cred_fields', 'strip_profiles', 'cred_part', 'reset_credentials',
      'import_row_credentials', 'json_strings', 'try_ts', 'league_norm', 'json_slice', 'league_change_denied',
      'predictions_change_denied', 'live_change_denied', 'items_denied', 'map2_denied', 'club_change_denied',
      'app_state_auth_guard', 'app_state_follow_credentials', 'settings_apply')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end;
$$;

revoke all on function public.pp_auth_version(), public.pp_login(text, text), public.pp_logout(text), public.pp_whoami(text),
  public.pp_change_pin(text, text, text), public.pp_reset_pin(text, text),
  public.pp_save_league(text, jsonb, timestamptz), public.pp_save_predictions(text, jsonb, timestamptz),
  public.pp_save_dummy(text, jsonb, integer), public.pp_save_live(text, jsonb, timestamptz),
  public.pp_save_club(text, jsonb, timestamptz) from public;
grant execute on function public.pp_auth_version(), public.pp_login(text, text), public.pp_logout(text), public.pp_whoami(text),
  public.pp_change_pin(text, text, text), public.pp_reset_pin(text, text),
  public.pp_save_league(text, jsonb, timestamptz), public.pp_save_predictions(text, jsonb, timestamptz),
  public.pp_save_dummy(text, jsonb, integer), public.pp_save_live(text, jsonb, timestamptz),
  public.pp_save_club(text, jsonb, timestamptz) to anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- 7. First import of every account's PIN / PIN hash (the row keeps them until enforce is switched on).
--    Re-running the file only imports what changed. If enforce is already on, re-assert the revoke (re-running the
--    phase 1 file would grant UPDATE again; the auth guard trigger refuses direct writes even then).
------------------------------------------------------------------------------------------------------------------
select private.import_row_credentials();
do $$
begin
  if private.enforced() then
    revoke update on table public.app_state from anon, authenticated;
  end if;
end;
$$;

-- Full removal (back to phase 1 only; sessions and credentials are dropped, the old site needs the PINs in the row,
-- which enforce = true removed, so only do this before switching enforce on):
--   update private.settings set enforce = false;
--   drop trigger if exists app_state_auth_guard on public.app_state;
--   drop trigger if exists app_state_follow_credentials on public.app_state;
--   drop function if exists public.pp_auth_version();   -- the site falls back to direct PATCH when this is gone

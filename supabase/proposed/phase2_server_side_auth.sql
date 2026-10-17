-- PROPOSED — security hardening phase 2: server-side PIN check and RPC-only writes. See SECURITY_REVIEW.md.
--
-- DO NOT RUN THIS YET. It is deliberately outside supabase/migrations/ so `supabase db push` will not pick it up.
-- Section D revokes direct UPDATE on public.app_state, which breaks every save in the current browser code.
-- Apply it only together with the client change described in SECURITY_REVIEW.md ("Phase 2"): login through
-- pp_login, a session token instead of pp_user_id, and saves through pp_save_league / pp_save_predictions.
-- Requires phase 1 (20261017120000_harden_shared_state.sql) to be applied first.
--
-- Running this file as-is only applies sections A and C, which are additive (nothing calls them yet), so the new client
-- can be tested against the live project first. Sections B and D are commented out: they are the cut-over.

------------------------------------------------------------------------------------------------------------------
-- A. Credentials and sessions, in the private schema (not reachable through the Data API)
------------------------------------------------------------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;

create table if not exists private.credentials (
  user_id         text primary key,
  pin_bcrypt      text,             -- extensions.crypt(pin, gen_salt('bf', 10))
  legacy_pbkdf2   text,             -- the client-side pinHash copied at cutover; replaced by bcrypt on first login
  must_change     boolean not null default false,
  failed_attempts integer not null default 0,
  locked_until    timestamptz,
  updated_at      timestamptz not null default now()
);
create table if not exists private.sessions (
  token_hash text primary key,      -- sha256 of the token; the token itself is only ever in the user's browser
  user_id    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create table if not exists private.login_attempts (
  ip text,
  at timestamptz not null default now()
);
create index if not exists login_attempts_ip_at_idx on private.login_attempts (ip, at desc);
revoke all on table private.credentials, private.sessions, private.login_attempts from public, anon, authenticated;

-- PBKDF2-HMAC-SHA256, one 32-byte block: verifies the hashes the phase-0 browser code writes
-- ("pbkdf2-sha256$<iterations>$<salt hex>$<hash hex>"), so nobody has to reset their PIN at cutover.
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

create or replace function private.profile(p_user_id text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select league #> array['uidLeague', 'profiles', p_user_id] from public.app_state where id = 'main';
$$;

-- Resolves a session token to an active account id, or raises.
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
  if uid is null or coalesce(private.profile(uid) ->> 'active', 'true') = 'false' then
    raise exception 'session expired' using errcode = '28000';
  end if;
  return uid;
end;
$$;

------------------------------------------------------------------------------------------------------------------
-- B. Cut-over step 1 (run in the same SQL Editor session as D, right after the new client is deployed):
--    copy every account's current PIN / pinHash into private.credentials, then strip them from the public row.
--    Not run earlier, because the old client keeps changing PINs in the row until the new one is live.
------------------------------------------------------------------------------------------------------------------
-- insert into private.credentials (user_id, pin_bcrypt, legacy_pbkdf2, must_change)
-- select e.key,
--        case when e.p ? 'pin' then extensions.crypt(e.p ->> 'pin', extensions.gen_salt('bf', 10)) end,
--        e.p ->> 'pinHash',
--        coalesce((e.p ->> 'mustChangePin')::boolean, false) or not (e.p ? 'pinHash')
-- from public.app_state s, jsonb_each(s.league #> '{uidLeague,profiles}') as e(key, p)
-- where s.id = 'main' and jsonb_typeof(s.league #> '{uidLeague,profiles}') = 'object'
-- on conflict (user_id) do nothing;

-- update public.app_state s
-- set league = jsonb_set(s.league, '{uidLeague,profiles}', (
--   select jsonb_object_agg(e.key, e.p - 'pin' - 'pinHash' - 'mustChangePin' - 'pinChangedAt')
--   from jsonb_each(s.league #> '{uidLeague,profiles}') as e(key, p)))
-- where s.id = 'main' and jsonb_typeof(s.league #> '{uidLeague,profiles}') = 'object';

------------------------------------------------------------------------------------------------------------------
-- C. RPC functions the new client calls (POST /rest/v1/rpc/<name>)
------------------------------------------------------------------------------------------------------------------
-- Returns {"token", "must_change", "expires_at"} or {"error"}: failures are returned, not raised, so the attempt and
-- failure counters commit. Lockout: 5 wrong PINs -> 15 minutes, per account, server-side.
-- Throttle: 30 attempts per IP per 10 minutes.
create or replace function public.pp_login(p_user_id text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cred private.credentials;
  client_ip text := coalesce(private.request_header('cf-connecting-ip'), private.request_header('x-forwarded-for'), 'unknown');
  ok boolean := false;
  token text;
  expires timestamptz := now() + interval '30 days';
begin
  if (select count(*) from private.login_attempts a where a.ip = client_ip and a.at > now() - interval '10 minutes') >= 30 then
    raise exception 'too many attempts, wait 10 minutes' using errcode = '28000';
  end if;
  insert into private.login_attempts (ip) values (client_ip);
  delete from private.login_attempts a where a.at < now() - interval '1 day';

  select * into cred from private.credentials c where c.user_id = p_user_id for update;
  if cred.user_id is null or coalesce(private.profile(p_user_id) ->> 'active', 'true') = 'false' then
    return jsonb_build_object('error', 'wrong account or PIN');
  end if;
  if cred.locked_until > now() then
    return jsonb_build_object('error', 'locked', 'retry_after_seconds', ceil(extract(epoch from cred.locked_until - now())));
  end if;

  if cred.pin_bcrypt is not null and extensions.crypt(coalesce(p_pin, ''), cred.pin_bcrypt) = cred.pin_bcrypt then
    ok := true;
  elsif cred.legacy_pbkdf2 ~ '^pbkdf2-sha256\$[0-9]{5,7}\$[0-9a-f]{32}\$[0-9a-f]{64}$'
        and split_part(cred.legacy_pbkdf2, '$', 2)::integer between 10000 and 1000000
        and private.pbkdf2_sha256_hex(coalesce(p_pin, ''), split_part(cred.legacy_pbkdf2, '$', 3),
                                      split_part(cred.legacy_pbkdf2, '$', 2)::integer) = split_part(cred.legacy_pbkdf2, '$', 4) then
    ok := true;
    update private.credentials c
    set pin_bcrypt = extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), legacy_pbkdf2 = null, updated_at = now()
    where c.user_id = p_user_id;
  end if;

  if not ok then
    update private.credentials c
    set failed_attempts = case when c.failed_attempts + 1 >= 5 then 0 else c.failed_attempts + 1 end,
        locked_until = case when c.failed_attempts + 1 >= 5 then now() + interval '15 minutes' else c.locked_until end
    where c.user_id = p_user_id;
    return jsonb_build_object('error', 'wrong account or PIN');
  end if;

  update private.credentials c set failed_attempts = 0, locked_until = null where c.user_id = p_user_id;
  token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sessions (token_hash, user_id, expires_at)
  values (encode(extensions.digest(token, 'sha256'), 'hex'), p_user_id, expires);
  delete from private.sessions s where s.expires_at < now();
  return jsonb_build_object('token', token, 'user_id', p_user_id, 'must_change', cred.must_change, 'expires_at', expires);
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

create or replace function public.pp_change_pin(p_token text, p_current_pin text, p_new_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  cred private.credentials;
begin
  select * into cred from private.credentials c where c.user_id = uid for update;
  if not (cred.pin_bcrypt is not null and extensions.crypt(coalesce(p_current_pin, ''), cred.pin_bcrypt) = cred.pin_bcrypt) then
    raise exception 'wrong current PIN' using errcode = '28000';
  end if;
  if not private.pin_policy_ok(p_new_pin) or p_new_pin = p_current_pin then
    raise exception 'PIN not allowed' using errcode = 'check_violation';
  end if;
  update private.credentials c
  set pin_bcrypt = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 10)), legacy_pbkdf2 = null,
      must_change = false, updated_at = now()
  where c.user_id = uid;
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
  if private.profile(uid) ->> 'role' is distinct from 'admin' then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into private.credentials (user_id, pin_bcrypt, must_change)
  values (p_target, extensions.crypt('1234', extensions.gen_salt('bf', 10)), true)
  on conflict (user_id) do update
  set pin_bcrypt = excluded.pin_bcrypt, legacy_pbkdf2 = null, must_change = true,
      failed_attempts = 0, locked_until = null, updated_at = now();
  delete from private.sessions s where s.user_id = p_target;
end;
$$;

-- Admin-only league save with the same optimistic lock the client uses today. Returns the new updated_at, or null
-- when another device saved first (the client then reloads, exactly as on an empty PATCH result today).
create or replace function public.pp_save_league(p_token text, p_league jsonb, p_expected timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  clean jsonb;
  saved timestamptz;
begin
  if private.profile(uid) ->> 'role' is distinct from 'admin' then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_league -> 'profiles') is distinct from 'object' then
    raise exception 'league shape rejected' using errcode = 'check_violation';
  end if;
  -- Credentials never live in the public row.
  clean := jsonb_set(p_league, '{profiles}', (
    select jsonb_object_agg(e.key, e.p - 'pin' - 'pinHash' - 'mustChangePin' - 'pinChangedAt')
    from jsonb_each(p_league -> 'profiles') as e(key, p)));
  -- Accounts created by this save start on the default PIN and must change it.
  insert into private.credentials (user_id, pin_bcrypt, must_change)
  select e.key, extensions.crypt('1234', extensions.gen_salt('bf', 10)), true
  from jsonb_object_keys(clean -> 'profiles') as e(key)
  on conflict (user_id) do nothing;

  update public.app_state s
  set league = jsonb_set(s.league, '{uidLeague}', clean), updated_at = now()
  where s.id = 'main' and s.updated_at = p_expected
  returning s.updated_at into saved;
  return saved;
end;
$$;

-- Prediction save for any logged-in player. A player may only append bets in their own name; markets, the dealer and
-- existing bets can only be changed by the dealer or an admin, and only an admin can change who the dealer is.
create or replace function public.pp_save_predictions(p_token text, p_predictions jsonb, p_expected timestamptz)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
  is_admin boolean := private.profile(uid) ->> 'role' = 'admin';
  old_pred jsonb;
  old_bets jsonb;
  new_bets jsonb := p_predictions -> 'bets';
  old_count integer;
  saved timestamptz;
begin
  select coalesce(s.predictions -> 'uidPredictions', '{}'::jsonb) into old_pred from public.app_state s where s.id = 'main';
  old_bets := coalesce(old_pred -> 'bets', '[]'::jsonb);
  old_count := jsonb_array_length(old_bets);
  if jsonb_typeof(p_predictions) is distinct from 'object' or jsonb_typeof(new_bets) is distinct from 'array' then
    raise exception 'predictions shape rejected' using errcode = 'check_violation';
  end if;
  if (p_predictions -> 'dealerId') is distinct from (old_pred -> 'dealerId') and not is_admin then
    raise exception 'only an admin can change the dealer' using errcode = '42501';
  end if;
  if not is_admin and (old_pred ->> 'dealerId') is distinct from uid then
    if (p_predictions -> 'markets') is distinct from (old_pred -> 'markets')
       or jsonb_array_length(new_bets) < old_count
       or coalesce((select jsonb_agg(b.e order by b.i) from jsonb_array_elements(new_bets) with ordinality as b(e, i)
                    where b.i <= old_count), '[]'::jsonb) is distinct from old_bets
       or exists (select 1 from jsonb_array_elements(new_bets) with ordinality as b(e, i)
                  where b.i > old_count and b.e ->> 'userId' is distinct from uid) then
      raise exception 'players can only add their own bets' using errcode = '42501';
    end if;
  end if;

  update public.app_state s
  set predictions = jsonb_set(s.predictions, '{uidPredictions}', p_predictions), updated_at = now()
  where s.id = 'main' and s.updated_at = p_expected
  returning s.updated_at into saved;
  return saved;
end;
$$;

revoke all on function private.pbkdf2_sha256_hex(text, text, integer) from public, anon, authenticated;
revoke all on function private.pin_policy_ok(text) from public, anon, authenticated;
revoke all on function private.profile(text) from public, anon, authenticated;
revoke all on function private.session_user_id(text) from public, anon, authenticated;
revoke all on function public.pp_login(text, text), public.pp_logout(text), public.pp_change_pin(text, text, text),
  public.pp_reset_pin(text, text), public.pp_save_league(text, jsonb, timestamptz),
  public.pp_save_predictions(text, jsonb, timestamptz) from public;
grant execute on function public.pp_login(text, text), public.pp_logout(text), public.pp_change_pin(text, text, text),
  public.pp_reset_pin(text, text), public.pp_save_league(text, jsonb, timestamptz),
  public.pp_save_predictions(text, jsonb, timestamptz) to anon, authenticated;

------------------------------------------------------------------------------------------------------------------
-- D. Cut-over: run only after the new client is live. Afterwards the anon key can read the row but not write it.
------------------------------------------------------------------------------------------------------------------
-- (run both statements of section B first)
-- revoke update on table public.app_state from anon, authenticated;
-- drop policy if exists "shared state can be updated" on public.app_state;

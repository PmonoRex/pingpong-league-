-- Server-side PIN login, sessions and role-checked writes.
-- After this migration anon/authenticated can only SELECT public.app_state; every write goes through
-- SECURITY DEFINER RPCs that check a session token and the caller's role.

begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

create table if not exists private.credentials (
  profile_id text primary key,
  pin_hash text not null,
  must_change boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists private.sessions (
  token_hash text primary key,
  profile_id text not null references private.credentials(profile_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists sessions_profile_idx on private.sessions (profile_id);

alter table private.credentials enable row level security;
alter table private.sessions enable row level security;
revoke all on table private.credentials, private.sessions from public, anon, authenticated;

-- ---------- private helpers (not callable by anon) ----------

create or replace function private.token_hash(p_token text) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

create or replace function private.current_league() returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(s.league -> 'uidLeague', '{}'::jsonb) from public.app_state s where s.id = 'main'
$$;

create or replace function private.is_active(p_league jsonb, p_id text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_league -> 'profiles' -> p_id) = 'object'
    and (p_league -> 'profiles' -> p_id -> 'active') is distinct from 'false'::jsonb, false)
$$;

create or replace function private.is_admin(p_league jsonb, p_id text) returns boolean
language sql immutable set search_path = '' as $$
  select private.is_active(p_league, p_id) and coalesce(p_league -> 'profiles' -> p_id ->> 'role', '') = 'admin'
$$;

create or replace function private.is_int(p_value jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(jsonb_typeof(p_value) = 'number' and (p_value #>> '{}')::numeric = trunc((p_value #>> '{}')::numeric), false)
$$;

create or replace function private.valid_score(p_score jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select private.is_int(p_score -> 'a') and private.is_int(p_score -> 'b')
    and (p_score ->> 'a')::numeric >= 0 and (p_score ->> 'b')::numeric >= 0
$$;

-- rounds[r].m[m] for a match id like "r0m2", or null.
create or replace function private.match_pair(p_league jsonb, p_match_id text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_parts text[] := regexp_match(coalesce(p_match_id, ''), '^r([0-9]+)m([0-9]+)$'); v_pair jsonb;
begin
  if v_parts is null then return null; end if;
  v_pair := p_league -> 'rounds' -> (v_parts[1]::int) -> 'm' -> (v_parts[2]::int);
  if jsonb_typeof(v_pair) <> 'array' or jsonb_array_length(v_pair) <> 2 then return null; end if;
  return v_pair;
end $$;

-- Mirrors LeagueShared.settlementOutcome + predictionOutcome: 'won' | 'lost' | 'push' | null.
create or replace function private.settlement(p_league jsonb, p_bet jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare v_pair jsonb; v_score jsonb; v_hcp numeric; v_a numeric; v_b numeric; v_winner jsonb;
begin
  if (p_bet -> 'season') is distinct from (p_league -> 'currentSeason') or p_bet ->> 'status' is distinct from 'pending' then return null; end if;
  v_pair := private.match_pair(p_league, p_bet ->> 'matchId');
  if v_pair is null or (p_bet -> 'pair') is distinct from v_pair or not (v_pair @> jsonb_build_array(p_bet -> 'favoriteId')) then return null; end if;
  v_score := p_league -> 'results' -> (p_bet ->> 'matchId');
  if not private.valid_score(v_score) or jsonb_typeof(p_bet -> 'handicap') is distinct from 'number' then return null; end if;
  v_hcp := (p_bet ->> 'handicap')::numeric;
  if v_hcp < 0 then return null; end if;
  v_a := (v_score ->> 'a')::numeric - case when p_bet -> 'favoriteId' = v_pair -> 0 then v_hcp else 0 end;
  v_b := (v_score ->> 'b')::numeric - case when p_bet -> 'favoriteId' = v_pair -> 1 then v_hcp else 0 end;
  if v_a = v_b then return 'push'; end if;
  v_winner := case when v_a > v_b then v_pair -> 0 else v_pair -> 1 end;
  return case when v_winner = p_bet -> 'sideId' then 'won' else 'lost' end;
end $$;

create or replace function private.strip_pins(p_league jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select case when jsonb_typeof(p_league -> 'profiles') = 'object'
    then jsonb_set(p_league, '{profiles}', coalesce((select jsonb_object_agg(e.key, case when jsonb_typeof(e.value) = 'object' then e.value - 'pin' else e.value end)
      from jsonb_each(p_league -> 'profiles') e), '{}'::jsonb))
    else p_league end
$$;

create or replace function private.append_audit(p_league jsonb, p_action text, p_actor text, p_meta jsonb) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_set(p_league, '{auditLog}', (
    select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb)
    from jsonb_array_elements(jsonb_build_array(jsonb_build_object(
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'action', p_action, 'actorId', p_actor, 'meta', p_meta))
      || case when jsonb_typeof(p_league -> 'auditLog') = 'array' then p_league -> 'auditLog' else '[]'::jsonb end) with ordinality e(value, ord)
    where e.ord <= 200))
$$;

-- Resolves a session token to its profile id or raises. 28000 = log in again, 28P01 = PIN change required.
create or replace function private.session_profile(p_token text, p_allow_pin_change boolean default false) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_pid text; v_must boolean;
begin
  select s.profile_id, c.must_change into v_pid, v_must
  from private.sessions s join private.credentials c on c.profile_id = s.profile_id
  where s.token_hash = private.token_hash(p_token) and s.expires_at > now();
  if v_pid is null or not private.is_active(private.current_league(), v_pid) then
    raise exception 'เซสชันหมดอายุหรือบัญชีถูกปิดใช้งาน กรุณาเข้าสู่ระบบใหม่' using errcode = '28000';
  end if;
  if v_must and not p_allow_pin_change then raise exception 'กรุณาเปลี่ยน PIN ก่อนใช้งาน' using errcode = '28P01'; end if;
  return v_pid;
end $$;

-- Owner-only recovery from the SQL editor: select private.set_pin('<profile id>', '<pin>');  (user must change it at next login)
create or replace function private.set_pin(p_profile_id text, p_pin text) returns void
language sql security definer set search_path = '' as $$
  insert into private.credentials (profile_id, pin_hash, must_change) values (p_profile_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), true)
  on conflict (profile_id) do update set pin_hash = excluded.pin_hash, must_change = true, failed_attempts = 0, locked_until = null, updated_at = now();
  delete from private.sessions where profile_id = p_profile_id;
$$;

-- ---------- public RPCs ----------

create or replace function public.login(p_profile_id text, p_pin text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_cred private.credentials%rowtype; v_token text;
begin
  delete from private.sessions where expires_at <= now();
  select * into v_cred from private.credentials where profile_id = p_profile_id for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'locked', true, 'retry_after_ms', ceil(extract(epoch from v_cred.locked_until - now()) * 1000));
  end if;
  if not private.is_active(private.current_league(), p_profile_id)
     or v_cred.pin_hash is distinct from extensions.crypt(coalesce(p_pin, ''), v_cred.pin_hash) then
    if v_cred.failed_attempts + 1 >= 5 then
      update private.credentials set failed_attempts = 0, locked_until = now() + interval '60 seconds' where profile_id = p_profile_id;
      return jsonb_build_object('ok', false, 'locked', true, 'retry_after_ms', 60000);
    end if;
    update private.credentials set failed_attempts = failed_attempts + 1 where profile_id = p_profile_id;
    return jsonb_build_object('ok', false);
  end if;
  update private.credentials set failed_attempts = 0, locked_until = null where profile_id = p_profile_id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into private.sessions (token_hash, profile_id, expires_at) values (private.token_hash(v_token), p_profile_id, now() + interval '30 days');
  return jsonb_build_object('ok', true, 'token', v_token, 'profile_id', p_profile_id, 'must_change', v_cred.must_change);
end $$;

create or replace function public.logout(p_token text) returns void
language sql security definer set search_path = '' as $$
  delete from private.sessions where token_hash = private.token_hash(p_token);
$$;

create or replace function public.change_pin(p_token text, p_old_pin text, p_new_pin text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_uid text := private.session_profile(p_token, true); v_cred private.credentials%rowtype;
begin
  select * into v_cred from private.credentials where profile_id = v_uid for update;
  if v_cred.locked_until > now() then return false; end if;
  if v_cred.pin_hash is distinct from extensions.crypt(coalesce(p_old_pin, ''), v_cred.pin_hash) then
    update private.credentials set failed_attempts = case when failed_attempts + 1 >= 5 then 0 else failed_attempts + 1 end,
      locked_until = case when failed_attempts + 1 >= 5 then now() + interval '60 seconds' else locked_until end
    where profile_id = v_uid;
    return false;
  end if;
  if coalesce(p_new_pin, '') !~ '^[0-9]{4,6}$' or p_new_pin = '1234' or p_new_pin = p_old_pin then
    raise exception 'PIN ใหม่ต้องเป็นตัวเลข 4-6 หลัก ห้ามใช้ 1234 หรือ PIN เดิม' using errcode = '22023';
  end if;
  update private.credentials set pin_hash = extensions.crypt(p_new_pin, extensions.gen_salt('bf', 8)), must_change = false,
    failed_attempts = 0, locked_until = null, updated_at = now() where profile_id = v_uid;
  delete from private.sessions where profile_id = v_uid and token_hash <> private.token_hash(p_token);
  return true;
end $$;

-- Admin only. Sets a random 6-digit temporary PIN, signs the user out everywhere and returns the PIN once.
create or replace function public.reset_pin(p_token text, p_profile_id text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_uid text := private.session_profile(p_token); v_league jsonb; v_bytes bytea := extensions.gen_random_bytes(4); v_pin text;
begin
  select coalesce(s.league -> 'uidLeague', '{}'::jsonb) into v_league from public.app_state s where s.id = 'main' for update;
  if not private.is_admin(v_league, v_uid) then raise exception 'เฉพาะ Admin เท่านั้น' using errcode = '42501'; end if;
  if jsonb_typeof(v_league -> 'profiles' -> p_profile_id) is distinct from 'object' then raise exception 'ไม่พบบัญชีนี้' using errcode = '22023'; end if;
  v_pin := lpad((((get_byte(v_bytes, 0)::bigint << 24) + (get_byte(v_bytes, 1) << 16) + (get_byte(v_bytes, 2) << 8) + get_byte(v_bytes, 3)) % 1000000)::text, 6, '0');
  perform private.set_pin(p_profile_id, v_pin);
  update public.app_state as s set league = jsonb_set(s.league, '{uidLeague}', private.append_audit(v_league, 'pin_reset', v_uid, jsonb_build_object('target', p_profile_id))),
    updated_at = now() where s.id = 'main';
  return v_pin;
end $$;

-- Admin only (same as the client rule in index.js / admin.js / backup.js). Returns [{updated_at}] or [] on a stale expected_updated_at.
create or replace function public.save_league(p_token text, p_league jsonb, p_expected_updated_at timestamptz default null)
returns table (updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_uid text := private.session_profile(p_token); v_row public.app_state%rowtype;
begin
  if jsonb_typeof(p_league) is distinct from 'object' or jsonb_typeof(p_league -> 'profiles') is distinct from 'object' then
    raise exception 'ข้อมูลลีกไม่ถูกต้อง' using errcode = '22023';
  end if;
  select * into v_row from public.app_state s where s.id = 'main' for update;
  if not found then raise exception 'ไม่พบข้อมูลลีก' using errcode = 'P0002'; end if;
  if not private.is_admin(coalesce(v_row.league -> 'uidLeague', '{}'::jsonb), v_uid) then raise exception 'เฉพาะ Admin เท่านั้น' using errcode = '42501'; end if;
  if p_expected_updated_at is not null and v_row.updated_at <> p_expected_updated_at then return; end if;
  return query update public.app_state as s
    set league = coalesce(s.league, '{}'::jsonb) || jsonb_build_object('uidLeague', private.strip_pins(p_league)), updated_at = now()
    where s.id = 'main' returning s.updated_at;
end $$;

-- Mirrors predictions.js: admin appoints the dealer, only the current dealer edits markets and settles,
-- any active non-dealer appends their own bet on an open market outside their own match.
create or replace function public.save_predictions(p_token text, p_predictions jsonb, p_expected_updated_at timestamptz default null)
returns table (updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := private.session_profile(p_token);
  v_row public.app_state%rowtype; v_league jsonb; v_old jsonb; v_new jsonb := p_predictions;
  v_admin boolean; v_dealer boolean; v_season jsonb;
  v_old_markets jsonb; v_new_markets jsonb; v_old_bets jsonb; v_new_bets jsonb;
  v_key text; v_market jsonb; v_match_id text; v_pair jsonb; v_ob jsonb; v_nb jsonb; v_expect text; v_net numeric; v_i int;
begin
  if jsonb_typeof(v_new) is distinct from 'object' then raise exception 'ข้อมูลการทายไม่ถูกต้อง' using errcode = '22023'; end if;
  select * into v_row from public.app_state s where s.id = 'main' for update;
  if not found then raise exception 'ไม่พบข้อมูลลีก' using errcode = 'P0002'; end if;
  if p_expected_updated_at is not null and v_row.updated_at <> p_expected_updated_at then return; end if;
  v_league := coalesce(v_row.league -> 'uidLeague', '{}'::jsonb);
  v_old := coalesce(v_row.predictions -> 'uidPredictions', '{}'::jsonb);
  v_admin := private.is_admin(v_league, v_uid);
  v_dealer := (v_old ->> 'dealerId') is not distinct from v_uid;
  v_season := v_league -> 'currentSeason';

  if nullif(v_new -> 'dealerId', 'null'::jsonb) is distinct from nullif(v_old -> 'dealerId', 'null'::jsonb) then
    if not v_admin then raise exception 'เฉพาะ Admin เท่านั้นที่ตั้งเจ้ามือได้' using errcode = '42501'; end if;
    if jsonb_typeof(v_new -> 'dealerId') is distinct from 'string' or not private.is_active(v_league, v_new ->> 'dealerId') then
      raise exception 'เจ้ามือต้องเป็นบัญชีที่เปิดใช้งาน' using errcode = '22023';
    end if;
  end if;

  v_old_markets := coalesce(nullif(v_old -> 'markets', 'null'::jsonb), '{}'::jsonb);
  v_new_markets := coalesce(nullif(v_new -> 'markets', 'null'::jsonb), '{}'::jsonb);
  if jsonb_typeof(v_new_markets) <> 'object' then raise exception 'ข้อมูลตลาดไม่ถูกต้อง' using errcode = '22023'; end if;
  if v_new_markets <> v_old_markets then
    if not v_dealer then raise exception 'เฉพาะเจ้ามือปัจจุบันเท่านั้น' using errcode = '42501'; end if;
    for v_key, v_market in select e.key, e.value from jsonb_each(v_new_markets) e loop
      continue when (v_old_markets -> v_key) = v_market;
      v_match_id := substring(v_key from '^s[^:]*:(r[0-9]+m[0-9]+)$');
      v_pair := private.match_pair(v_league, v_match_id);
      if v_pair is null or v_key <> 's' || coalesce(v_season #>> '{}', '') || ':' || v_match_id then
        raise exception 'ตารางแข่งเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่' using errcode = '22023';
      end if;
      if jsonb_typeof(v_market) <> 'object' or not (v_pair @> jsonb_build_array(v_market -> 'favoriteId'))
         or jsonb_typeof(v_market -> 'handicap') is distinct from 'number' or (v_market ->> 'handicap')::numeric < 0
         or ((v_market ->> 'handicap')::numeric * 2) <> trunc((v_market ->> 'handicap')::numeric * 2)
         or jsonb_typeof(v_market -> 'open') is distinct from 'boolean'
         or (v_market -> 'open' = 'true'::jsonb and private.valid_score(v_league -> 'results' -> v_match_id)) then
        raise exception 'ผู้ต่อหรือแต้มต่อไม่ถูกต้อง' using errcode = '22023';
      end if;
    end loop;
  end if;

  -- Bets are append-only (client pushes); existing entries keep their position.
  v_old_bets := case when jsonb_typeof(v_old -> 'bets') = 'array' then v_old -> 'bets' else '[]'::jsonb end;
  v_new_bets := coalesce(v_new -> 'bets', '[]'::jsonb);
  if jsonb_typeof(v_new_bets) <> 'array' or jsonb_array_length(v_new_bets) < jsonb_array_length(v_old_bets) then
    raise exception 'ลบรายการทายไม่ได้' using errcode = '42501';
  end if;
  for v_i in 0 .. jsonb_array_length(v_old_bets) - 1 loop
    v_ob := v_old_bets -> v_i; v_nb := v_new_bets -> v_i;
    continue when v_nb = v_ob;
    if not v_dealer then raise exception 'เฉพาะเจ้ามือปัจจุบันเท่านั้นที่สรุปผลได้' using errcode = '42501'; end if;
    v_expect := private.settlement(v_league, v_ob);
    v_net := case v_expect when 'won' then (v_ob ->> 'stake')::numeric when 'lost' then -(v_ob ->> 'stake')::numeric else 0 end;
    if jsonb_typeof(v_nb) is distinct from 'object' or (v_nb - 'status' - 'net') <> (v_ob - 'status' - 'net') or v_expect is null
       or v_nb ->> 'status' is distinct from v_expect or jsonb_typeof(v_nb -> 'net') is distinct from 'number'
       or (v_nb ->> 'net')::numeric <> v_net then
      raise exception 'ผลการสรุปยอดไม่ตรงกับคะแนน' using errcode = '22023';
    end if;
  end loop;
  for v_i in jsonb_array_length(v_old_bets) .. jsonb_array_length(v_new_bets) - 1 loop
    v_nb := v_new_bets -> v_i;
    if v_dealer then raise exception 'เจ้ามือไม่สามารถทายผลได้' using errcode = '42501'; end if;
    if jsonb_typeof(v_nb) is distinct from 'object' or v_nb ->> 'userId' is distinct from v_uid then raise exception 'ทายแทนคนอื่นไม่ได้' using errcode = '42501'; end if;
    v_match_id := v_nb ->> 'matchId';
    v_pair := private.match_pair(v_league, v_match_id);
    if (v_nb -> 'season') is distinct from v_season or v_pair is null or (v_nb -> 'pair') is distinct from v_pair then
      raise exception 'ตารางแข่งเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่' using errcode = '22023';
    end if;
    if v_pair @> jsonb_build_array(to_jsonb(v_uid)) then raise exception 'ทายคู่ตัวเองไม่ได้' using errcode = '42501'; end if;
    v_market := v_old_markets -> ('s' || coalesce(v_season #>> '{}', '') || ':' || v_match_id);
    if v_market is null or (v_market -> 'open') is distinct from 'true'::jsonb or private.valid_score(v_league -> 'results' -> v_match_id) then
      raise exception 'คู่นี้ไม่ได้เปิดรับทาย' using errcode = '22023';
    end if;
    if (v_nb -> 'favoriteId') is distinct from (v_market -> 'favoriteId') or (v_nb -> 'handicap') is distinct from (v_market -> 'handicap') then
      raise exception 'ราคาเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่' using errcode = '22023';
    end if;
    if not (v_pair @> jsonb_build_array(v_nb -> 'sideId')) or not private.is_int(v_nb -> 'stake') or (v_nb ->> 'stake')::numeric <= 0
       or v_nb ->> 'status' is distinct from 'pending' or (v_nb -> 'net') is distinct from '0'::jsonb then
      raise exception 'กรอกยอดให้ถูกต้อง' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(v_new_bets) e
        where (e.value -> 'season') = v_season and e.value ->> 'matchId' = v_match_id and e.value ->> 'userId' = v_uid) > 1 then
      raise exception 'คุณทายคู่นี้แล้ว' using errcode = '22023';
    end if;
  end loop;

  if (v_new - 'dealerId' - 'markets' - 'bets' - 'nextBetId') <> (v_old - 'dealerId' - 'markets' - 'bets' - 'nextBetId') and not v_admin then
    raise exception 'เฉพาะ Admin เท่านั้น' using errcode = '42501';
  end if;

  return query update public.app_state as s
    set predictions = coalesce(s.predictions, '{}'::jsonb) || jsonb_build_object('uidPredictions', v_new), updated_at = now()
    where s.id = 'main' returning s.updated_at;
end $$;

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.login(text, text), public.logout(text), public.change_pin(text, text, text), public.reset_pin(text, text),
  public.save_league(text, jsonb, timestamptz), public.save_predictions(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.login(text, text), public.logout(text), public.change_pin(text, text, text), public.reset_pin(text, text),
  public.save_league(text, jsonb, timestamptz), public.save_predictions(text, jsonb, timestamptz) to anon, authenticated;

-- ---------- move existing PINs out of the public JSON ----------
-- Every PIN was publicly readable until now, so all migrated PINs must be changed at next login.

insert into private.credentials (profile_id, pin_hash, must_change)
select p.key, extensions.crypt(p.value ->> 'pin', extensions.gen_salt('bf', 8)), true
from public.app_state s, jsonb_each(case when jsonb_typeof(s.league -> 'uidLeague' -> 'profiles') = 'object' then s.league -> 'uidLeague' -> 'profiles' else '{}'::jsonb end) p
where s.id = 'main' and coalesce(p.value ->> 'pin', '') <> ''
on conflict (profile_id) do nothing;

update public.app_state s set league = jsonb_set(s.league, '{uidLeague}', private.strip_pins(s.league -> 'uidLeague')), updated_at = now()
where s.id = 'main' and jsonb_typeof(s.league -> 'uidLeague' -> 'profiles') = 'object';

-- ---------- lock the table down to read-only ----------

drop policy if exists "shared state can be initialized" on public.app_state;
drop policy if exists "shared state can be updated" on public.app_state;
revoke all on table public.app_state from anon, authenticated;
grant select on table public.app_state to anon, authenticated;

commit;

notify pgrst, 'reload schema';

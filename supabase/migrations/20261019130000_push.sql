-- Web Push subscriptions (docs/push-notifications.md).
--
-- NOTE: pp_push_subscribe below trusts p_user_id. 20261020120000_push_session.sql replaces it with a version that takes
-- a session token; run that file after this one. Re-running this file afterwards keeps the token version.
--
-- One row per browser/phone that turned on แจ้งเตือน: the push service URL (endpoint) and its encryption keys, and the
-- league player id it belongs to. The Edge Function supabase/functions/push-notify reads these with the service key
-- when public.app_state changes and sends the notifications.
--
-- The browser never touches the table: it calls two small functions with the publishable (anon) key.
--   pp_push_subscribe(endpoint, p256dh, auth, user_id)   add or update this device
--   pp_push_unsubscribe(endpoint)                         remove this device
-- The endpoint is a long random URL only that browser knows, so it works as the capability for its own row.
-- Nobody can list or read subscriptions through the API (no table grants, RLS on, no policies).
--
-- Limits: endpoint must be a real browser push service (Google/Mozilla/Apple/Microsoft) over https; key sizes checked;
-- the player must be an active profile in the 'main' row; at most 10 devices per player (oldest dropped);
-- at most 5000 rows; at most 120 subscribe/unsubscribe calls a minute for the whole site.
--
-- Run after 20261018130000_harden_shared_state.sql. Safe to run more than once. Undo: block at the end.

create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default clock_timestamp(),
  last_ok_at  timestamptz,
  fail_count  integer not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from public, anon, authenticated;
grant select, update, delete on table public.push_subscriptions to service_role;

-- Same rate table as the app_state guard (created there; repeated so this file never fails on its own).
create schema if not exists private;
create table if not exists private.app_state_rate (
  row_id       text primary key,
  window_start timestamptz not null,
  writes       integer not null
);
revoke all on table private.app_state_rate from public, anon, authenticated;

create or replace function private.push_rate_check()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent integer;
begin
  insert into private.app_state_rate as r (row_id, window_start, writes)
  values ('push', now(), 1)
  on conflict (row_id) do update
    set window_start = case when r.window_start <= now() - interval '1 minute' then now() else r.window_start end,
        writes = case when r.window_start <= now() - interval '1 minute' then 1 else r.writes + 1 end
  returning writes into recent;
  if recent > 120 then
    raise exception 'push: too many requests, try again in a minute' using errcode = 'check_violation';
  end if;
end;
$$;

-- Skipped once 20261020120000_push_session.sql has replaced it with the session-token version, so re-running this file
-- never brings the trusting p_user_id version back.
do $do$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
             where n.nspname = 'public' and p.proname = 'pp_push_subscribe' and 'p_token' = any(coalesce(p.proargnames, '{}'))) then
    return;
  end if;
  execute $create$
  create or replace function public.pp_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_id text)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $fn$
  begin
    if p_endpoint is null or length(p_endpoint) > 1000
       or p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[!-~]+$' then
      raise exception 'push: endpoint not allowed' using errcode = 'check_violation';
    end if;
    if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{86,88}=?$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{21,24}={0,2}$' then
      raise exception 'push: bad keys' using errcode = 'check_violation';
    end if;
    if p_user_id is null or p_user_id !~ '^[A-Za-z0-9_-]{1,64}$' or not exists (
         select 1 from public.app_state s
         where s.id = 'main'
           and jsonb_typeof(s.league -> 'uidLeague' -> 'profiles' -> p_user_id) = 'object'
           and coalesce(s.league -> 'uidLeague' -> 'profiles' -> p_user_id ->> 'active', 'true') <> 'false') then
      raise exception 'push: unknown player' using errcode = 'check_violation';
    end if;
    perform private.push_rate_check();
    if (select count(*) from public.push_subscriptions) >= 5000
       and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint) then
      raise exception 'push: subscription table full' using errcode = 'check_violation';
    end if;

    insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
    values (p_endpoint, p_user_id, p_p256dh, p_auth)
    on conflict (endpoint) do update
      set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fail_count = 0, created_at = clock_timestamp();

    -- At most 10 devices per player: drop the oldest.
    delete from public.push_subscriptions d
    where d.user_id = p_user_id
      and d.endpoint not in (select x.endpoint from public.push_subscriptions x
                             where x.user_id = p_user_id order by x.created_at desc limit 10);
    return true;
  end;
  $fn$;
  $create$;
end;
$do$;

create or replace function public.pp_push_unsubscribe(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if p_endpoint is null or length(p_endpoint) > 1000 then
    return false;
  end if;
  perform private.push_rate_check();
  delete from public.push_subscriptions where endpoint = p_endpoint;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

-- Edge Function only (service key): delivery results. ok = delivered, gone = 404/410 from the push service (the
-- browser dropped it), failed = other errors; a device that failed 10 times in a row is removed.
create or replace function public.pp_push_report(p_ok text[], p_gone text[], p_failed text[])
returns void
language sql
security definer
set search_path = ''
as $$
  update public.push_subscriptions set last_ok_at = now(), fail_count = 0 where endpoint = any(coalesce(p_ok, '{}'));
  delete from public.push_subscriptions where endpoint = any(coalesce(p_gone, '{}'));
  update public.push_subscriptions set fail_count = fail_count + 1 where endpoint = any(coalesce(p_failed, '{}'));
  delete from public.push_subscriptions where fail_count >= 10;
$$;

-- Edge Function only: the bits of the league the club-row notifications need (season, schedule, names), without
-- the pictures that make the full row large.
create or replace function public.pp_push_league_brief()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'currentSeason', l -> 'currentSeason',
    'rounds', coalesce(l -> 'rounds', '[]'::jsonb),
    'profiles', coalesce((select jsonb_object_agg(k, jsonb_build_object('displayName', v -> 'displayName', 'active', v -> 'active'))
                          from jsonb_each(case when jsonb_typeof(l -> 'profiles') = 'object' then l -> 'profiles' else '{}'::jsonb end) e(k, v)),
                         '{}'::jsonb))
  from (select s.league -> 'uidLeague' as l from public.app_state s where s.id = 'main') m;
$$;

revoke all on function private.push_rate_check() from public, anon, authenticated;
revoke all on function public.pp_push_subscribe(text, text, text, text) from public;
revoke all on function public.pp_push_unsubscribe(text) from public;
revoke all on function public.pp_push_report(text[], text[], text[]) from public, anon, authenticated;
revoke all on function public.pp_push_league_brief() from public, anon, authenticated;
grant execute on function public.pp_push_subscribe(text, text, text, text) to anon, authenticated;
grant execute on function public.pp_push_unsubscribe(text) to anon, authenticated;
grant execute on function public.pp_push_report(text[], text[], text[]) to service_role;
grant execute on function public.pp_push_league_brief() to service_role;

-- Rollback (run manually):
--   drop function if exists public.pp_push_subscribe(text, text, text, text);
--   drop function if exists public.pp_push_unsubscribe(text);
--   drop function if exists public.pp_push_report(text[], text[], text[]);
--   drop function if exists public.pp_push_league_brief();
--   drop function if exists private.push_rate_check();
--   drop table if exists public.push_subscriptions;
-- and delete the Database Webhook "push-notify" (Database -> Webhooks).

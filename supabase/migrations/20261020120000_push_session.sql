-- Web Push: register a device only for the account that is signed in on it (docs/push-notifications.md).
--
-- 20261019130000_push.sql had pp_push_subscribe(p_endpoint, p_p256dh, p_auth, p_user_id), which believed the user id it
-- was given: anyone with the publishable key could register their own phone under another player's id and receive that
-- player's notifications. This file replaces it with
--   pp_push_subscribe(p_token, p_endpoint, p_p256dh, p_auth)
-- where the player is the account of a valid session token from pp_login (20261019140000_server_auth.sql). An unknown,
-- logged-out or expired token is refused with 'session expired' (errcode 28000), like every other pp_* call. The old
-- p_user_id version is dropped, so it cannot be called any more (PostgREST answers 404 for the old argument names).
--
-- pp_push_unsubscribe(p_endpoint) stays as it was: the endpoint is a long random URL only that browser knows, so it is the
-- capability for its own row. Same checks as before: push service allowlist, key sizes, 10 devices per player,
-- 5000 rows, 120 calls a minute for the whole site. The Edge Function (service role) is unchanged.
--
-- Requires 20261019130000_push.sql and 20261019140000_server_auth.sql. Safe to run more than once.
-- Undo (back to the old, trusting version): re-run 20261019130000_push.sql after
--   drop function if exists public.pp_push_subscribe(text, text, text, text);

do $$
begin
  if to_regprocedure('private.session_user_id(text)') is null then
    raise exception 'push_session: run 20261019140000_server_auth.sql first';
  end if;
  if to_regclass('public.push_subscriptions') is null or to_regprocedure('private.push_rate_check()') is null then
    raise exception 'push_session: run 20261019130000_push.sql first';
  end if;
end;
$$;

-- The old and the new function have the same argument types (four text), so the old one has to go before the new one
-- can be created. Only drop it while it is still the p_user_id version, so re-running this file keeps the new one.
do $$
declare
  f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'pp_push_subscribe' and 'p_user_id' = any(coalesce(p.proargnames, '{}'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('drop function %s', f);
  end loop;
end;
$$;

create or replace function public.pp_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid text;
begin
  if p_endpoint is null or length(p_endpoint) > 1000
     or p_endpoint !~ '^https://(fcm\.googleapis\.com|android\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9.-]+\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[!-~]+$' then
    raise exception 'push: endpoint not allowed' using errcode = 'check_violation';
  end if;
  if p_p256dh is null or p_p256dh !~ '^[A-Za-z0-9_-]{86,88}=?$' or p_auth is null or p_auth !~ '^[A-Za-z0-9_-]{21,24}={0,2}$' then
    raise exception 'push: bad keys' using errcode = 'check_violation';
  end if;
  perform private.push_rate_check();
  -- Active account of a valid session, or 'session expired' (28000).
  uid := private.session_user_id(p_token);
  if (select count(*) from public.push_subscriptions) >= 5000
     and not exists (select 1 from public.push_subscriptions where endpoint = p_endpoint) then
    raise exception 'push: subscription table full' using errcode = 'check_violation';
  end if;

  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, uid, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fail_count = 0, created_at = clock_timestamp();

  -- At most 10 devices per player: drop the oldest.
  delete from public.push_subscriptions d
  where d.user_id = uid
    and d.endpoint not in (select x.endpoint from public.push_subscriptions x
                           where x.user_id = uid order by x.created_at desc limit 10);
  return true;
end;
$$;

revoke all on function public.pp_push_subscribe(text, text, text, text) from public;
grant execute on function public.pp_push_subscribe(text, text, text, text) to anon, authenticated;
-- Unchanged, re-asserted.
revoke all on function public.pp_push_unsubscribe(text) from public;
grant execute on function public.pp_push_unsubscribe(text) to anon, authenticated;

-- Dopdep trade dashboard — run once in Supabase → SQL Editor (project shared with pingpong-league).
-- Creates separate trade_* tables; does not touch pingpong's app_state.
-- Access model:
--   * Only users listed in trade_admins (signed in with Supabase Auth) can read the dashboard or change config.
--   * The PC agent writes trade_state with the service_role key (bypasses RLS); anon can do nothing.

create table if not exists public.trade_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

create table if not exists public.trade_state (
  id text primary key,                         -- 'demo'
  summary jsonb not null default '{}'::jsonb,  -- written by the PC agent every few minutes
  updated_at timestamptz not null default now()
);

create table if not exists public.trade_config (
  id text primary key,                         -- 'demo'
  enabled jsonb not null default '{}'::jsonb,  -- {"MAIN": true, "FAST_M15": false, ...}
  version integer not null default 1,          -- bumped on every admin save; agent applies when it changes
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

create or replace function public.is_trade_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.trade_admins where user_id = auth.uid());
$$;

alter table public.trade_admins enable row level security;
alter table public.trade_state  enable row level security;
alter table public.trade_config enable row level security;

revoke all on public.trade_admins, public.trade_state, public.trade_config from anon;
grant select on public.trade_admins, public.trade_state, public.trade_config to authenticated;
grant update on public.trade_config to authenticated;

drop policy if exists trade_admins_self on public.trade_admins;
create policy trade_admins_self on public.trade_admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists trade_state_read on public.trade_state;
create policy trade_state_read on public.trade_state
  for select to authenticated using (public.is_trade_admin());

drop policy if exists trade_config_read on public.trade_config;
create policy trade_config_read on public.trade_config
  for select to authenticated using (public.is_trade_admin());

-- admins may only change the enabled map; version/updated_* are set by the trigger below
drop policy if exists trade_config_write on public.trade_config;
create policy trade_config_write on public.trade_config
  for update to authenticated using (public.is_trade_admin()) with check (public.is_trade_admin());

create or replace function public.trade_config_bump()
returns trigger language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists trade_config_bump on public.trade_config;
create trigger trade_config_bump before update on public.trade_config
  for each row execute function public.trade_config_bump();

insert into public.trade_state (id) values ('demo') on conflict (id) do nothing;
insert into public.trade_config (id) values ('demo') on conflict (id) do nothing;

-- After creating your admin user in Authentication → Users, run (replace the e-mail):
--   insert into public.trade_admins (user_id)
--   select id from auth.users where email = 'YOUR-EMAIL@example.com';

create table if not exists public.app_state (
  id text primary key,
  league jsonb not null default '{}'::jsonb,
  predictions jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_state enable row level security;

revoke all on table public.app_state from anon, authenticated;
grant select, insert, update on table public.app_state to anon, authenticated;

drop policy if exists "shared state is readable" on public.app_state;
create policy "shared state is readable"
on public.app_state for select
to anon, authenticated
using (id = 'main');

drop policy if exists "shared state can be initialized" on public.app_state;
create policy "shared state can be initialized"
on public.app_state for insert
to anon, authenticated
with check (id = 'main');

drop policy if exists "shared state can be updated" on public.app_state;
create policy "shared state can be updated"
on public.app_state for update
to anon, authenticated
using (id = 'main')
with check (id = 'main');

insert into public.app_state (id, league, predictions)
values (
  'main',
  '{"players":["พี่โช็ค","กิฟท์","กอล์ฟ","มังกร","พฤษ","เฟิร์น","มอส"],"rounds":[{"rest":"เฟิร์น","m":[["กอล์ฟ","มังกร"],["พฤษ","พี่โช็ค"],["กิฟท์","มอส"]]},{"rest":"พฤษ","m":[["กอล์ฟ","พี่โช็ค"],["มังกร","มอส"],["กิฟท์","เฟิร์น"]]},{"rest":"พี่โช็ค","m":[["กอล์ฟ","มอส"],["มังกร","เฟิร์น"],["พฤษ","กิฟท์"]]},{"rest":"กอล์ฟ","m":[["มอส","เฟิร์น"],["พี่โช็ค","กิฟท์"],["มังกร","พฤษ"]]},{"rest":"กิฟท์","m":[["กอล์ฟ","เฟิร์น"],["มอส","พฤษ"],["พี่โช็ค","มังกร"]]},{"rest":"มังกร","m":[["กอล์ฟ","กิฟท์"],["เฟิร์น","พฤษ"],["มอส","พี่โช็ค"]]},{"rest":"มอส","m":[["กอล์ฟ","พฤษ"],["กิฟท์","มังกร"],["เฟิร์น","พี่โช็ค"]]}],"results":{}}'::jsonb,
  '{}'::jsonb
)
on conflict (id) do nothing;

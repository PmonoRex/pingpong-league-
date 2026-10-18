-- Third row of public.app_state: id = 'club', for the features around the league that are not league scores:
-- challenges (ท้าดวล), tournaments and playoffs (singles and doubles), MVP votes, reactions and comments on results,
-- and the day's check-in. Kept out of 'main' so a reaction or a vote never re-downloads everyone's pictures and never
-- races a score save. The site keeps the club data in the `league` column as { club: {...} } (docs/club-data.md).
--
-- Run after 20261018130000_harden_shared_state.sql. Safe to run more than once.
-- The guard trigger from that file already covers this row: 300 writes/min, 5 MB cap, and its league/prediction
-- shape checks do not apply (the row has no uidLeague / uidPredictions). History is kept like 'main'.

insert into public.app_state (id, league, predictions, dummy, updated_at)
values ('club', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, now())
on conflict (id) do nothing;

drop policy if exists "shared state is readable" on public.app_state;
create policy "shared state is readable"
on public.app_state for select
to anon, authenticated
using (id in ('main', 'live', 'club'));

drop policy if exists "shared state can be updated" on public.app_state;
create policy "shared state can be updated"
on public.app_state for update
to anon, authenticated
using (id in ('main', 'live', 'club'))
with check (id in ('main', 'live', 'club'));

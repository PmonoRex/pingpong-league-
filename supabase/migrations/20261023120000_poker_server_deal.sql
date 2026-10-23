-- Poker: แจกจากเซิร์ฟเวอร์ (poker.html). The server shuffles and keeps the deck where no browser can read it.
-- Needs 20261019140000_server_auth.sql (sessions, private.session_user_id, private.profile). Run once in the SQL
-- editor; until then the poker page offers ไพ่จริง and แจกในแอป only. Safe to run again.
--
-- A hand is identified by the poker night id and the id of its deal event (made by the phone that deals).
-- Seats are the players' display names, as the poker page uses them.
--   pp_poker_deal     shuffle and store the deck for a new hand (caller must be one of the seats)
--   pp_poker_my_cards the caller's own two cards, to nobody else
--   pp_poker_board    turn the board over up to N cards (only ever forward; everyone sees the same cards)
--   pp_poker_show     the caller shows their own cards to the table
--   pp_poker_hand     what the table may see: board cards turned so far and the hands shown
-- Board cards and shown hands come from here, not from the shared row, so nobody can fake them.

create schema if not exists private;

create table if not exists private.poker_decks (
  night_id    text not null,
  hand_id     text not null,
  seats       text[] not null,
  deck        smallint[] not null,          -- 52 cards, 0..51 (rank * 4 + suit)
  board_shown smallint not null default 0,  -- how many board cards the table has seen (0, 3, 4, 5)
  shown       text[] not null default '{}', -- seats that showed their cards
  dealt_by    text not null,
  created_at  timestamptz not null default now(),
  primary key (night_id, hand_id)
);
revoke all on table private.poker_decks from public, anon, authenticated;

-- The caller's name as the poker page writes it (trimmed, inner spaces collapsed, at most 30 characters).
create or replace function private.poker_me(p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid text := private.session_user_id(p_token);
begin
  return left(regexp_replace(btrim(coalesce(private.profile(uid) ->> 'displayName', '')), '\s+', ' ', 'g'), 30);
end;
$$;

-- Public view of a hand: board cards turned so far and every shown hand. Raises if the caller is not seated.
create or replace function private.poker_state(p_night text, p_hand text, p_me text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d private.poker_decks;
  n int;
  shown jsonb := '{}'::jsonb;
  who text;
  i int;
begin
  select * into d from private.poker_decks where night_id = p_night and hand_id = p_hand;
  if not found then return null; end if;
  if not (p_me = any(d.seats)) then raise exception 'not seated' using errcode = '42501'; end if;
  n := array_length(d.seats, 1);
  foreach who in array d.shown loop
    i := array_position(d.seats, who);
    shown := shown || jsonb_build_object(who, jsonb_build_array(d.deck[i], d.deck[i + n]));
  end loop;
  return jsonb_build_object(
    'board', coalesce((select jsonb_agg(d.deck[2 * n + k] order by k) from generate_series(1, d.board_shown) k), '[]'::jsonb),
    'shown', shown, 'by', d.dealt_by, 'seats', to_jsonb(d.seats));
end;
$$;

create or replace function public.pp_poker_deal(p_token text, p_night text, p_hand text, p_seats text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := private.poker_me(p_token);
  n int := coalesce(array_length(p_seats, 1), 0);
begin
  if p_night !~ '^[A-Za-z0-9_-]{1,40}$' or p_hand !~ '^[A-Za-z0-9_-]{1,40}$' or n < 2 or n > 10
     or (select count(distinct s) from unnest(p_seats) s) <> n then
    raise exception 'deal rejected' using errcode = '22023';
  end if;
  if not (me = any(p_seats)) then raise exception 'not seated' using errcode = '42501'; end if;
  -- Hands are only needed while they are played; keep two days.
  delete from private.poker_decks where created_at < now() - interval '2 days';
  insert into private.poker_decks (night_id, hand_id, seats, deck, dealt_by)
  values (p_night, p_hand, p_seats,
          (select array_agg(c::smallint order by extensions.gen_random_bytes(16)) from generate_series(0, 51) c), me);
  return private.poker_state(p_night, p_hand, me);
exception when unique_violation then
  raise exception 'hand already dealt' using errcode = '23505';
end;
$$;

create or replace function public.pp_poker_my_cards(p_token text, p_night text, p_hand text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  me text := private.poker_me(p_token);
  d private.poker_decks;
  i int;
begin
  select * into d from private.poker_decks where night_id = p_night and hand_id = p_hand;
  if not found then return null; end if;
  i := array_position(d.seats, me);
  if i is null then raise exception 'not seated' using errcode = '42501'; end if;
  return jsonb_build_array(d.deck[i], d.deck[i + array_length(d.seats, 1)]);
end;
$$;

create or replace function public.pp_poker_board(p_token text, p_night text, p_hand text, p_count int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := private.poker_me(p_token);
begin
  if p_count not in (0, 3, 4, 5) then raise exception 'board count rejected' using errcode = '22023'; end if;
  update private.poker_decks set board_shown = greatest(board_shown, p_count)
  where night_id = p_night and hand_id = p_hand and me = any(seats);
  return private.poker_state(p_night, p_hand, me);
end;
$$;

create or replace function public.pp_poker_show(p_token text, p_night text, p_hand text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  me text := private.poker_me(p_token);
begin
  update private.poker_decks set shown = array_append(shown, me)
  where night_id = p_night and hand_id = p_hand and me = any(seats) and not (me = any(shown));
  return private.poker_state(p_night, p_hand, me);
end;
$$;

create or replace function public.pp_poker_hand(p_token text, p_night text, p_hand text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return private.poker_state(p_night, p_hand, private.poker_me(p_token));
end;
$$;

revoke all on function private.poker_me(text), private.poker_state(text, text, text) from public, anon, authenticated;
revoke all on function public.pp_poker_deal(text, text, text, text[]), public.pp_poker_my_cards(text, text, text),
  public.pp_poker_board(text, text, text, int), public.pp_poker_show(text, text, text), public.pp_poker_hand(text, text, text)
  from public;
grant execute on function public.pp_poker_deal(text, text, text, text[]), public.pp_poker_my_cards(text, text, text),
  public.pp_poker_board(text, text, text, int), public.pp_poker_show(text, text, text), public.pp_poker_hand(text, text, text)
  to anon, authenticated;

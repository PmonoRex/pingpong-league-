-- Settlement rules for PR #6 (bet-settle.js / predictions-realtime.js) on top of 20261015120000_server_side_auth.sql.
-- Replaces public.save_predictions so the current dealer can: settle pending bets, re-settle after a score edit,
-- revert a bet to pending when its score is cleared, void a pending bet (refund), stamp settledAt and append settleLog.
-- Outcomes are recomputed here from league.uidLeague (current Season) or league.uidLeague.seasonArchives (finished Seasons).

begin;

-- JavaScript Number() for the values bets carry: missing -> null (NaN), JSON null/''/false -> 0, numeric strings parsed.
create or replace function private.js_num(p_value jsonb) returns numeric
language sql immutable set search_path = '' as $$
  select case jsonb_typeof(p_value)
    when 'number' then (p_value #>> '{}')::numeric
    when 'null' then 0
    when 'boolean' then case when p_value = 'true'::jsonb then 1 else 0 end
    when 'string' then case when btrim(p_value #>> '{}') = '' then 0
      when btrim(p_value #>> '{}') ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$' then btrim(p_value #>> '{}')::numeric end
  end
$$;

-- Mirrors BetSettle.resolve (bet-settle.js): 'won' | 'lost' | 'push' | 'pending' (score cleared) | null (leave as is).
create or replace function private.resolve_bet(p_league jsonb, p_markets jsonb, p_bet jsonb) returns text
language plpgsql immutable set search_path = '' as $$
declare
  v_season numeric := private.js_num(p_bet -> 'season');
  v_parts text[] := regexp_match(coalesce(p_bet ->> 'matchId', ''), '^r([0-9]+)m([0-9]+)$');
  v_src jsonb; v_pair jsonb; v_score jsonb; v_same boolean; v_fav jsonb; v_hcp numeric; v_market jsonb; v_a numeric; v_b numeric; v_winner jsonb;
begin
  if jsonb_typeof(p_bet) is distinct from 'object' or p_bet ->> 'status' = 'void' or v_parts is null or v_season is null then return null; end if;
  if v_season = private.js_num(p_league -> 'currentSeason') then v_src := p_league;
  else
    select a.value into v_src
    from jsonb_array_elements(case when jsonb_typeof(p_league -> 'seasonArchives') = 'array' then p_league -> 'seasonArchives' else '[]'::jsonb end) with ordinality a(value, ord)
    where private.js_num(a.value -> 'season') = v_season order by a.ord limit 1;
  end if;
  if v_src is null then return null; end if;
  v_pair := v_src -> 'rounds' -> (v_parts[1]::int) -> 'm' -> (v_parts[2]::int);
  if jsonb_typeof(v_pair) is distinct from 'array' or jsonb_array_length(v_pair) <> 2 then return null; end if;
  -- Array.isArray(bet.pair) && bet.pair.every((id, i) => id === match.pair[i])
  v_same := jsonb_typeof(p_bet -> 'pair') = 'array' and not exists (
    select 1 from jsonb_array_elements(p_bet -> 'pair') with ordinality e(value, ord) where e.value is distinct from v_pair -> (e.ord::int - 1));
  v_score := v_src -> 'results' -> (p_bet ->> 'matchId');
  if not private.valid_score(v_score) then return case when v_same then 'pending' end; end if;
  if not v_same or jsonb_array_length(p_bet -> 'pair') <> 2 then return null; end if;
  -- Legacy bets without a complete market snapshot fall back to the stored market (same as BetSettle.outcome).
  v_fav := p_bet -> 'favoriteId';
  v_hcp := private.js_num(p_bet -> 'handicap');
  v_market := p_markets -> ('s' || coalesce(p_bet #>> '{season}', '') || ':' || (p_bet ->> 'matchId'));
  if not (v_pair @> jsonb_build_array(v_fav)) and v_pair @> jsonb_build_array(v_market -> 'favoriteId') then v_fav := v_market -> 'favoriteId'; end if;
  if v_hcp is null then v_hcp := private.js_num(v_market -> 'handicap'); end if;
  if not (v_pair @> jsonb_build_array(v_fav)) or v_hcp is null or v_hcp < 0 then return null; end if;
  v_a := (v_score ->> 'a')::numeric - case when v_fav = v_pair -> 0 then v_hcp else 0 end;
  v_b := (v_score ->> 'b')::numeric - case when v_fav = v_pair -> 1 then v_hcp else 0 end;
  if v_a = v_b then return 'push'; end if;
  v_winner := case when v_a > v_b then v_pair -> 0 else v_pair -> 1 end;
  return case when v_winner = p_bet -> 'sideId' then 'won' else 'lost' end;
end $$;

-- Mirrors predictions.js / predictions-realtime.js: admin appoints the dealer; only the current dealer edits markets,
-- settles, re-settles, reverts and voids; any active non-dealer appends their own bet on an open market outside their match.
create or replace function public.save_predictions(p_token text, p_predictions jsonb, p_expected_updated_at timestamptz default null)
returns table (updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_uid text := private.session_profile(p_token);
  v_row public.app_state%rowtype; v_league jsonb; v_old jsonb; v_new jsonb := p_predictions;
  v_admin boolean; v_dealer boolean; v_season jsonb;
  v_old_markets jsonb; v_new_markets jsonb; v_old_bets jsonb; v_new_bets jsonb; v_old_log jsonb; v_new_log jsonb;
  v_key text; v_market jsonb; v_match_id text; v_pair jsonb; v_ob jsonb; v_nb jsonb; v_to text; v_expect text; v_net numeric; v_i int; v_k int;
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

  -- Bets are append-only (client pushes); existing entries keep their position and only their result may change.
  v_old_bets := case when jsonb_typeof(v_old -> 'bets') = 'array' then v_old -> 'bets' else '[]'::jsonb end;
  v_new_bets := coalesce(v_new -> 'bets', '[]'::jsonb);
  if jsonb_typeof(v_new_bets) <> 'array' or jsonb_array_length(v_new_bets) < jsonb_array_length(v_old_bets) then
    raise exception 'ลบรายการทายไม่ได้' using errcode = '42501';
  end if;
  for v_i in 0 .. jsonb_array_length(v_old_bets) - 1 loop
    v_ob := v_old_bets -> v_i; v_nb := v_new_bets -> v_i;
    continue when v_nb = v_ob;
    if not v_dealer then raise exception 'เฉพาะเจ้ามือปัจจุบันเท่านั้นที่สรุปผลได้' using errcode = '42501'; end if;
    if jsonb_typeof(v_nb) is distinct from 'object' or jsonb_typeof(v_ob) is distinct from 'object'
       or (v_nb - 'status' - 'net' - 'settledAt') <> (v_ob - 'status' - 'net' - 'settledAt') then
      raise exception 'แก้ไขรายการทายได้เฉพาะผลการคำนวณ' using errcode = '42501';
    end if;
    v_to := v_nb ->> 'status';
    if v_to = 'void' then
      -- Refund at the dealer's discretion; only a bet that is still waiting can be voided, and void is final.
      if v_ob ->> 'status' is distinct from 'pending' then raise exception 'ยกเลิกได้เฉพาะรายการที่รอผล' using errcode = '22023'; end if;
      v_net := 0;
    else
      v_expect := private.resolve_bet(v_league, v_old_markets, v_ob);
      if v_expect is null or v_to is distinct from v_expect then raise exception 'ผลการสรุปยอดไม่ตรงกับคะแนน' using errcode = '22023'; end if;
      v_net := case v_expect when 'won' then private.js_num(v_ob -> 'stake') when 'lost' then -private.js_num(v_ob -> 'stake') else 0 end;
    end if;
    if v_net is null or jsonb_typeof(v_nb -> 'net') is distinct from 'number' or (v_nb ->> 'net')::numeric <> v_net then
      raise exception 'ยอดสุทธิไม่ตรงกับผล' using errcode = '22023';
    end if;
    -- settledAt: removed on revert (predictions-realtime.js deletes it), otherwise optional but a string when present.
    if (v_to = 'pending' and v_nb ? 'settledAt') or (v_nb ? 'settledAt' and jsonb_typeof(v_nb -> 'settledAt') is distinct from 'string') then
      raise exception 'เวลาคำนวณผลไม่ถูกต้อง' using errcode = '22023';
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
       or v_nb ->> 'status' is distinct from 'pending' or (v_nb -> 'net') is distinct from '0'::jsonb or v_nb ? 'settledAt' then
      raise exception 'กรอกยอดให้ถูกต้อง' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_array_elements(v_new_bets) e
        where (e.value -> 'season') = v_season and e.value ->> 'matchId' = v_match_id and e.value ->> 'userId' = v_uid) > 1 then
      raise exception 'คุณทายคู่นี้แล้ว' using errcode = '22023';
    end if;
  end loop;

  -- settleLog: newest first, capped at 200 (SETTLE_LOG_LIMIT). Only the dealer may prepend their own entries;
  -- the rest must be the previous log unchanged (oldest entries may fall off the end).
  v_old_log := case when jsonb_typeof(v_old -> 'settleLog') = 'array' then v_old -> 'settleLog' else '[]'::jsonb end;
  v_new_log := coalesce(nullif(v_new -> 'settleLog', 'null'::jsonb), '[]'::jsonb);
  if v_new_log <> v_old_log then
    if not v_dealer then raise exception 'เฉพาะเจ้ามือปัจจุบันเท่านั้น' using errcode = '42501'; end if;
    if jsonb_typeof(v_new_log) <> 'array' or jsonb_array_length(v_new_log) > 200 then raise exception 'บันทึกการคำนวณไม่ถูกต้อง' using errcode = '22023'; end if;
    select k into v_k from generate_series(0, jsonb_array_length(v_new_log)) k
    where jsonb_array_length(v_new_log) = least(200, k + jsonb_array_length(v_old_log))
      and not exists (select 1 from generate_series(0, jsonb_array_length(v_new_log) - k - 1) i where v_new_log -> (k + i) is distinct from v_old_log -> i)
      and not exists (select 1 from generate_series(0, k - 1) j
        where jsonb_typeof(v_new_log -> j) is distinct from 'object' or v_new_log -> j ->> 'actorId' is distinct from v_uid
          or coalesce(v_new_log -> j ->> 'action', '') not in ('bet_resettle', 'bet_revert', 'bet_void'))
    order by k limit 1;
    if v_k is null then raise exception 'แก้ไขบันทึกการคำนวณย้อนหลังไม่ได้' using errcode = '42501'; end if;
  end if;

  if (v_new - 'dealerId' - 'markets' - 'bets' - 'nextBetId' - 'settleLog') <> (v_old - 'dealerId' - 'markets' - 'bets' - 'nextBetId' - 'settleLog') and not v_admin then
    raise exception 'เฉพาะ Admin เท่านั้น' using errcode = '42501';
  end if;

  return query update public.app_state as s
    set predictions = coalesce(s.predictions, '{}'::jsonb) || jsonb_build_object('uidPredictions', v_new), updated_at = now()
    where s.id = 'main' returning s.updated_at;
end $$;

-- Superseded by private.resolve_bet.
drop function if exists private.settlement(jsonb, jsonb);

revoke all on all functions in schema private from public, anon, authenticated;
revoke all on function public.save_predictions(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.save_predictions(text, jsonb, timestamptz) to anon, authenticated;

commit;

notify pgrst, 'reload schema';

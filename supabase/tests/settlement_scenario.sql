-- Run as anon after both migrations (see run-local.sh). Every rejected call must print an ERROR.
\set VERBOSITY terse
set role anon;
-- tokens (temporary PIN change first)
select public.change_pin(public.login('a','1111')->>'token','1111','111222') as a_changed;
select public.change_pin(public.login('b','2222')->>'token','2222','222333') as b_changed;
select public.change_pin(public.login('d','4444')->>'token','4444','444555') as d_changed;
select public.login('a','111222')->>'token' as adm \gset
select public.login('b','222333')->>'token' as ply \gset
select public.login('d','444555')->>'token' as dlr \gset
\set P '(select predictions->''uidPredictions'' from public.app_state)'
\set T '"2026-10-16T00:00:00.000Z"'

\echo '=== 1. settle: bet1 won +500 (current), bet2 lost -100 (archive S2), bet4 legacy (market fallback) lost -20'
\echo '--- admin (not dealer) rejected'
select public.save_predictions(:'adm', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"won"'),'{bets,0,net}','500'),'{bets,0,settledAt}',:'T'), null);
\echo '--- player rejected'
select public.save_predictions(:'ply', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"won"'),'{bets,0,net}','500'),'{bets,0,settledAt}',:'T'), null);
\echo '--- dealer wrong outcome rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"lost"'),'{bets,0,net}','-500'),'{bets,0,settledAt}',:'T'), null);
\echo '--- dealer wrong net rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"won"'),'{bets,0,net}','50'),'{bets,0,settledAt}',:'T'), null);
\echo '--- dealer settles with a non-string settledAt rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"won"'),'{bets,0,net}','500'),'{bets,0,settledAt}','123'), null);
\echo '--- dealer changes stake while settling rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"won"'),'{bets,0,net}','900'),'{bets,0,stake}','900'),'{bets,0,settledAt}',:'T'), null);
\echo '--- dealer settles S1 bet with no archive rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,2,status}','"won"'),'{bets,2,net}','50'),'{bets,2,settledAt}',:'T'), null);
\echo '--- dealer correct settlement ok (1 row)'
select count(*) from public.save_predictions(:'dlr',
  jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(:P,
   '{bets,0,status}','"won"'),'{bets,0,net}','500'),'{bets,0,settledAt}',:'T'),
   '{bets,1,status}','"lost"'),'{bets,1,net}','-100'),'{bets,1,settledAt}',:'T'),
   '{bets,3,status}','"lost"'),'{bets,3,net}','-20'),'{bets,3,settledAt}',:'T'), null);

\echo '=== 2. re-settle after score edit (admin sets 9-11): bet1 won->lost with settleLog'
select count(*) from public.save_league(:'adm', (select jsonb_set(league->'uidLeague','{results,r0m0}','{"a":9,"b":11}') from public.app_state), null);
\set LOG '[{"at":"2026-10-16T00:01:00.000Z","actorId":"d","action":"bet_resettle","betId":1,"season":3,"matchId":"r0m0","from":"won","to":"lost","oldNet":500,"newNet":-500}]'
\echo '--- log entry attributed to someone else rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"lost"'),'{bets,0,net}','-500'),'{settleLog}','[{"actorId":"a","action":"bet_resettle"}]'), null);
\echo '--- stale outcome (won kept as won with new score) is not a change; flipping bet2 (archive unchanged) rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(:P,'{bets,1,status}','"won"'),'{bets,1,net}','100'), null);
\echo '--- dealer re-settle ok (1 row)'
select count(*) from public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"lost"'),'{bets,0,net}','-500'),'{settleLog}',:'LOG'), null);
\echo '--- settleLog cannot be rewritten or truncated; player cannot append'
select public.save_predictions(:'dlr', jsonb_set(:P,'{settleLog}','[]'), null);
select public.save_predictions(:'dlr', jsonb_set(:P,'{settleLog,0,newNet}','0'), null);
select public.save_predictions(:'ply', jsonb_set(:P,'{settleLog}', (:P->'settleLog') || '[]'::jsonb || jsonb_build_array(jsonb_build_object('actorId','b','action','bet_void')) ), null);
select public.save_predictions(:'ply', jsonb_set(:P,'{settleLog}', jsonb_build_array(jsonb_build_object('actorId','b','action','bet_void')) || (:P->'settleLog')), null);

\echo '=== 3. revert to pending: only when the score is cleared'
\echo '--- score still there: revert rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(:P,'{bets,0,status}','"pending"'),'{bets,0,net}','0') #- '{bets,0,settledAt}', null);
select count(*) from public.save_league(:'adm', (select league->'uidLeague' #- '{results,r0m0}' from public.app_state), null);
\echo '--- score cleared but settledAt kept rejected'
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(:P,'{bets,0,status}','"pending"'),'{bets,0,net}','0'), null);
\echo '--- player cannot revert'
select public.save_predictions(:'ply', jsonb_set(jsonb_set(:P,'{bets,0,status}','"pending"'),'{bets,0,net}','0') #- '{bets,0,settledAt}', null);
\echo '--- dealer revert ok (1 row); archive bet2 cannot be reverted (archive still has score)'
select count(*) from public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,0,status}','"pending"'),'{bets,0,net}','0') #- '{bets,0,settledAt}','{settleLog}',
  jsonb_build_array(jsonb_build_object('at','2026-10-16T00:02:00.000Z','actorId','d','action','bet_revert','betId',1)) || (:P->'settleLog')), null);
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(:P,'{bets,1,status}','"pending"'),'{bets,1,net}','0') #- '{bets,1,settledAt}', null);

\echo '=== 4. void (refund)'
\echo '--- player cannot void; admin cannot void; void of a settled bet rejected; void with net<>0 rejected'
select public.save_predictions(:'ply', jsonb_set(jsonb_set(:P,'{bets,2,status}','"void"'),'{bets,2,settledAt}',:'T'), null);
select public.save_predictions(:'adm', jsonb_set(jsonb_set(:P,'{bets,2,status}','"void"'),'{bets,2,settledAt}',:'T'), null);
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,1,status}','"void"'),'{bets,1,net}','0'),'{bets,1,settledAt}',:'T'), null);
select public.save_predictions(:'dlr', jsonb_set(jsonb_set(jsonb_set(:P,'{bets,2,status}','"void"'),'{bets,2,net}','-50'),'{bets,2,settledAt}',:'T'), null);
\echo '--- dealer voids S1 bet3 with log ok (1 row)'
select count(*) from public.save_predictions(:'dlr', jsonb_set(jsonb_set(:P,'{bets,2,status}','"void"'),'{bets,2,settledAt}',:'T') || jsonb_build_object('settleLog',
  jsonb_build_array(jsonb_build_object('at','2026-10-16T00:03:00.000Z','actorId','d','action','bet_void','betId',3)) || (:P->'settleLog')), null);
\echo '--- void is final: back to pending rejected'
select public.save_predictions(:'dlr', jsonb_set(:P,'{bets,2,status}','"pending"') #- '{bets,2,settledAt}', null);

\echo '=== 5. players: new bet still works, other users bets are untouchable'
select count(*) from public.save_predictions(:'ply', jsonb_set(:P,'{bets}', (:P->'bets') || '[{"id":5,"season":3,"matchId":"r0m1","pair":["a","d"],"favoriteId":"a","handicap":0.5,"userId":"b","sideId":"a","stake":30,"status":"pending","net":0}]') || '{"nextBetId":6}', null);
select public.save_predictions(:'ply', jsonb_set(:P,'{bets,0,stake}','1'), null);
select public.save_predictions(:'ply', jsonb_set(:P,'{bets}', (:P->'bets') || '[{"id":6,"season":3,"matchId":"r0m1","pair":["a","d"],"favoriteId":"a","handicap":0.5,"userId":"b","sideId":"a","stake":30,"status":"won","net":30,"settledAt":"x"}]'), null);

\echo '=== 6. legacy settle without settledAt (old cached settleAll) ok: bet5 cannot (no result) -> reject; set r0m1 result then settle'
select count(*) from public.save_league(:'adm', (select jsonb_set(league->'uidLeague','{results,r0m1}','{"a":11,"b":3}') from public.app_state), null);
select count(*) from public.save_predictions(:'dlr', jsonb_set(jsonb_set(:P,'{bets,4,status}','"won"'),'{bets,4,net}','30'), null);
\echo '=== final state'
select string_agg(format('#%s %s %s %s', b->>'id', b->>'status', b->>'net', coalesce(b->>'settledAt','-')), ' | ' order by (b->>'id')::int) from public.app_state, jsonb_array_elements(predictions->'uidPredictions'->'bets') b;
select string_agg(e->>'action', ',') from public.app_state, jsonb_array_elements(predictions->'uidPredictions'->'settleLog') e;

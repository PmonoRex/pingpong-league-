-- Run as anon after both migrations (see run-local.sh). Every rejected call must print an ERROR.
\set VERBOSITY terse
set role anon;
\echo '--- direct writes must fail'
update public.app_state set league = '{}' where id = 'main';
insert into public.app_state (id) values ('x');
select count(*) from private.credentials;
select private.set_pin('mos', '0000');
\echo '--- login wrong / right, must_change'
select public.login('mos', '9999');
select public.login('mos', '1234') ->> 'must_change' as must_change;
select public.login('mos', '1234') ->> 'token' as mos_tmp \gset
select public.save_league(:'mos_tmp', '{"profiles":{}}', null);
select public.change_pin(:'mos_tmp', '1234', '1234');
select public.change_pin(:'mos_tmp', '0000', '482913');
select public.change_pin(:'mos_tmp', '1234', '482913');
\echo '--- the other two mos sessions were revoked'
select count(*) from (select 1) x;
select public.login('mos', '482913') ->> 'token' as mos \gset
\echo '--- lockout: 5 fails then even right PIN rejected'
select public.login('bob', '0'), public.login('bob', '0'), public.login('bob', '0'), public.login('bob', '0');
select public.login('bob', '0');
select public.login('bob', '2222');
\echo '--- inactive account cannot log in'
select public.login('eve', '3333');
\echo '--- save_league: admin ok, stale expected -> empty, pin stripped'
select updated_at as ts from public.app_state where id = 'main' \gset
select count(*) from public.save_league(:'mos', (select jsonb_set(jsonb_set(league->'uidLeague', '{results}', '{"r0m0":{"a":11,"b":9}}'), '{profiles,mos,pin}', '"7777"') from public.app_state), :'ts');
select count(*) as stale_rows from public.save_league(:'mos', (select league->'uidLeague' from public.app_state), :'ts');
select league::text like '%"pin"%' as pin_left, league->'uidLeague'->'results' as results, league->>'other' as other from public.app_state;
\echo '--- reset_pin for alice and gift returns 6 digits + audit'
select public.reset_pin(:'mos', 'alice') as alice_pin \gset
select public.reset_pin(:'mos', 'gift') as gift_pin \gset
select length(:'alice_pin') as len, (select league->'uidLeague'->'auditLog'->0->>'action' from public.app_state) as audit;
select public.login('alice', :'alice_pin') ->> 'token' as alice_tmp \gset
select public.change_pin(:'alice_tmp', :'alice_pin', '246810');
select public.login('alice', '246810') ->> 'token' as alice \gset
select public.login('gift', :'gift_pin') ->> 'token' as gift_tmp \gset
select public.change_pin(:'gift_tmp', :'gift_pin', '135790');
select public.login('gift', '135790') ->> 'token' as gift \gset
\echo '--- non-admin league edit rejected; non-admin reset rejected'
select public.save_league(:'alice', (select league->'uidLeague' from public.app_state), null);
select public.reset_pin(:'alice', 'mos');
\echo '--- predictions: reopen a fresh match without result for betting'
select count(*) from public.save_league(:'mos', (select jsonb_set(jsonb_set(league->'uidLeague', '{results}', '{}'), '{rounds}', '[{"rest":"gift","m":[["alice","bob"]]},{"rest":"bob","m":[["alice","gift"]]}]') from public.app_state), null);
\echo 'player cannot set dealer / markets'
select public.save_predictions(:'alice', '{"dealerId":"alice","markets":{},"bets":[],"nextBetId":1}', null);
select public.save_predictions(:'alice', '{"dealerId":"gift","markets":{"s2:r0m0":{"favoriteId":"alice","handicap":0.5,"open":true}},"bets":[],"nextBetId":1}', null);
\echo 'dealer opens market (bad handicap rejected, good ok)'
select public.save_predictions(:'gift', '{"dealerId":"gift","markets":{"s2:r0m0":{"favoriteId":"alice","handicap":0.3,"open":true}},"bets":[],"nextBetId":1}', null);
select count(*) from public.save_predictions(:'gift', '{"dealerId":"gift","markets":{"s2:r0m0":{"favoriteId":"alice","handicap":0.5,"open":true}},"bets":[],"nextBetId":1}', null);
\echo 'alice cannot bet own match; mos bets; mos duplicate rejected; mos cannot bet as bob'
select public.save_predictions(:'alice', '{"dealerId":"gift","markets":{"s2:r0m0":{"favoriteId":"alice","handicap":0.5,"open":true}},"bets":[{"id":1,"season":2,"matchId":"r0m0","pair":["alice","bob"],"favoriteId":"alice","handicap":0.5,"userId":"alice","sideId":"alice","stake":10,"status":"pending","net":0}],"nextBetId":2}', null);
select public.save_predictions(:'mos', '{"dealerId":"gift","markets":{"s2:r0m0":{"favoriteId":"alice","handicap":0.5,"open":true}},"bets":[{"id":1,"season":2,"matchId":"r0m0","pair":["alice","bob"],"favoriteId":"alice","handicap":0.5,"userId":"bob","sideId":"alice","stake":10,"status":"pending","net":0}],"nextBetId":2}', null);
select public.save_predictions(:'mos', '{"dealerId":"gift","markets":{"s2:r0m0":{"favoriteId":"alice","handicap":0.5,"open":true}},"bets":[{"id":1,"season":2,"matchId":"r0m0","pair":["alice","bob"],"favoriteId":"alice","handicap":0.5,"userId":"mos","sideId":"alice","stake":10,"status":"pending","net":0}],"nextBetId":2}', null);
select public.save_predictions(:'mos', (select jsonb_set(predictions->'uidPredictions', '{bets}', (predictions->'uidPredictions'->'bets') || '[{"id":2,"season":2,"matchId":"r0m0","pair":["alice","bob"],"favoriteId":"alice","handicap":0.5,"userId":"mos","sideId":"bob","stake":5,"status":"pending","net":0}]') from public.app_state), null);
\echo 'mos cannot settle; admin sets result; dealer wrong settlement rejected, right one ok'
select public.save_predictions(:'mos', (select jsonb_set(predictions->'uidPredictions', '{bets,0,status}', '"won"') from public.app_state), null);
select count(*) from public.save_league(:'mos', (select jsonb_set(league->'uidLeague', '{results}', '{"r0m0":{"a":11,"b":10}}') from public.app_state), null);
select public.save_predictions(:'gift', (select jsonb_set(jsonb_set(predictions->'uidPredictions', '{bets,0,status}', '"lost"'), '{bets,0,net}', '-10') from public.app_state), null);
select count(*) from public.save_predictions(:'gift', (select jsonb_set(jsonb_set(predictions->'uidPredictions', '{bets,0,status}', '"won"'), '{bets,0,net}', '10') from public.app_state), null);
\echo 'bets cannot be deleted; admin changes dealer ok'
select public.save_predictions(:'gift', (select jsonb_set(predictions->'uidPredictions', '{bets}', '[]') from public.app_state), null);
select count(*) from public.save_predictions(:'mos', (select jsonb_set(predictions->'uidPredictions', '{dealerId}', '"bob"') from public.app_state), null);
select predictions->'uidPredictions'->>'dealerId' as dealer, predictions->'uidPredictions'->'bets'->0->>'status' as bet_status from public.app_state;
\echo '--- deactivated user loses session; logout kills token'
select count(*) from public.save_league(:'mos', (select jsonb_set(league->'uidLeague', '{profiles,alice,active}', 'false') from public.app_state), null);
select public.save_predictions(:'alice', (select predictions->'uidPredictions' from public.app_state), null);
select public.logout(:'mos');
select public.save_league(:'mos', (select league->'uidLeague' from public.app_state), null);

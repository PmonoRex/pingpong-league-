-- Test data with legacy plain PINs, loaded before 20261015120000_server_side_auth.sql migrates them.
update public.app_state set league = '{"uidLeague":{"profiles":{
  "mos":{"id":"mos","displayName":"มอส","pin":"1234","role":"admin","active":true},
  "gift":{"id":"gift","displayName":"กิฟท์","pin":"5555","role":"player","active":true},
  "alice":{"id":"alice","displayName":"Alice","pin":"1111","role":"player","active":true},
  "bob":{"id":"bob","displayName":"Bob","pin":"2222","role":"player","active":true},
  "eve":{"id":"eve","displayName":"Eve","pin":"3333","role":"admin","active":false}},
  "seasonPlayerIds":["alice","bob","gift"],"rounds":[{"rest":"gift","m":[["alice","bob"]]}],"results":{},"currentSeason":2,"auditLog":[]},"other":"keep"}',
  predictions = '{"uidPredictions":{"dealerId":"gift","markets":{},"bets":[],"nextBetId":1}}' where id = 'main';

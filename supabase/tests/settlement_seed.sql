-- Test data with legacy plain PINs, loaded before 20261015120000_server_side_auth.sql migrates them.
update public.app_state set league = '{"uidLeague":{"profiles":{
  "a":{"id":"a","displayName":"Alice","pin":"1111","role":"admin","active":true},
  "b":{"id":"b","displayName":"Bob","pin":"2222","role":"player","active":true},
  "c":{"id":"c","displayName":"Cat","pin":"3333","role":"player","active":true},
  "d":{"id":"d","displayName":"Dealer","pin":"4444","role":"player","active":true}},
  "seasonPlayerIds":["a","b","c","d"],"currentSeason":3,
  "rounds":[{"rest":null,"m":[["b","c"],["a","d"]]}],"results":{"r0m0":{"a":11,"b":9}},
  "rankHistory":[],"seasonArchives":[{"season":2,"rounds":[{"m":[["a","b"]]}],"results":{"r0m0":{"a":11,"b":5}},"standings":[]}],"auditLog":[]}}',
  predictions = '{"uidPredictions":{"dealerId":"d","nextBetId":5,
  "markets":{"s3:r0m0":{"favoriteId":"b","handicap":0.5,"open":false},"s3:r0m1":{"favoriteId":"a","handicap":0.5,"open":true}},
  "bets":[
   {"id":1,"season":3,"matchId":"r0m0","pair":["b","c"],"favoriteId":"b","handicap":0.5,"userId":"a","sideId":"b","stake":500,"status":"pending","net":0},
   {"id":2,"season":2,"matchId":"r0m0","pair":["a","b"],"favoriteId":"a","handicap":1.5,"userId":"c","sideId":"b","stake":100,"status":"pending","net":0},
   {"id":3,"season":1,"matchId":"r0m0","pair":["b","c"],"favoriteId":"b","handicap":0.5,"userId":"b","sideId":"c","stake":50,"status":"pending","net":0},
   {"id":4,"season":3,"matchId":"r0m0","pair":["b","c"],"userId":"a","sideId":"c","stake":20,"status":"pending","net":0}]}}' where id = 'main';

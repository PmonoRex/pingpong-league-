// Sessions 3 + 8: automatic local snapshot and audit trail before destructive league actions.
(() => {
  const BK="pp_backup_center_v1";
  const clone=v=>JSON.parse(JSON.stringify(v));
  function backups(){try{return JSON.parse(localStorage.getItem(BK)||"[]")}catch{return[]}}
  function snapshot(reason){
    if(typeof state==="undefined"||!state?.profiles)return;
    const list=backups();list.unshift({id:`auto_${Date.now()}`,savedAt:new Date().toISOString(),reason,state:clone(state)});localStorage.setItem(BK,JSON.stringify(list.slice(0,30)));
  }
  function audit(action,meta={}){
    try{LeagueShared.audit(state,action,currentUserId,meta);LeagueShared.saveLocalLeague(state)}catch{}
  }
  function wrapButton(id,reason,action){
    const btn=document.getElementById(id);if(!btn||btn.dataset.safetyWrapped)return;const original=btn.onclick;if(typeof original!=="function")return;btn.dataset.safetyWrapped="1";btn.onclick=function(e){if(typeof isAdmin==="function"&&!isAdmin())return original.call(this,e);snapshot(reason);audit(action);return original.call(this,e)};
  }
  function boot(){wrapButton("applyRoster","ก่อนเปลี่ยนรายชื่อ Season","roster_change");wrapButton("clearScores","ก่อนล้างคะแนน","scores_clear");wrapButton("finishSeason","ก่อนจบ Season","season_finish");wrapButton("saveBtn","ก่อนบันทึกด้วยมือ","manual_save")}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(boot,80));else setTimeout(boot,80);
})();
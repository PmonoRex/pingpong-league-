// Multi-device guard for the league page. Merges independent score edits and blocks destructive stale overwrites.
(() => {
  if (typeof state === 'undefined' || typeof pushCloud !== 'function') return;
  const clone = value => JSON.parse(JSON.stringify(value));
  let syncBase = clone(state);
  let baseUpdatedAt = typeof lastCloudUpdate === 'string' ? lastCloudUpdate : '';

  const json = value => JSON.stringify(value ?? null);
  const structure = league => json({
    currentSeason: league?.currentSeason,
    seasonPlayerIds: league?.seasonPlayerIds,
    rounds: league?.rounds,
    rankHistory: league?.rankHistory,
    seasonArchives: league?.seasonArchives
  });
  function changedResultKeys(base, next){
    const a=base?.results||{},b=next?.results||{},keys=new Set([...Object.keys(a),...Object.keys(b)]),changed=[];
    keys.forEach(key=>{if(json(a[key])!==json(b[key]))changed.push(key)});return changed;
  }
  function applyResultDelta(base, local, target){
    const out=clone(target),localResults=local?.results||{};
    if(!out.results)out.results={};
    changedResultKeys(base,local).forEach(key=>{
      if(Object.prototype.hasOwnProperty.call(localResults,key))out.results[key]=clone(localResults[key]);
      else delete out.results[key];
    });
    return out;
  }
  function mergeLocalAudit(base,local,target){
    const baseIds=new Set((base?.auditLog||[]).map(x=>`${x.at}|${x.action}|${x.actorId}|${json(x.meta)}`));
    const localNew=(local?.auditLog||[]).filter(x=>!baseIds.has(`${x.at}|${x.action}|${x.actorId}|${json(x.meta)}`));
    if(localNew.length){target.auditLog=[...localNew,...(target.auditLog||[])].slice(0,200)}
    return target;
  }
  function saveConflict(local,reason){
    try{localStorage.setItem('pp_conflict_draft_v1',JSON.stringify({savedAt:new Date().toISOString(),reason,league:local}))}catch{}
  }
  function adoptRemote(remote,updatedAt,message){
    state=remote;syncBase=clone(remote);baseUpdatedAt=updatedAt||'';lastCloudUpdate=updatedAt||'';dirty=false;
    saveLocal();reconcileSession();renderLogin();render();setSync(message,'offline');
  }

  const originalPull = pullCloud;
  pullCloud = async function(){
    const before=lastCloudUpdate;
    await originalPull();
    if(!dirty&&!cloudSaving&&lastCloudUpdate!==before){syncBase=clone(state);baseUpdatedAt=lastCloudUpdate||''}
  };

  pushCloud = async function(){
    if(!cloudReady||cloudSaving||!dirty)return;
    cloudSaving=true;
    const startedVersion=changeVersion;
    let saved=false;
    try{
      const local=clone(state);
      const latest=(await cloudRequest())[0];
      const remote=latest?.league?.uidLeague;
      if(!remote?.profiles)throw new Error('ไม่พบข้อมูลล่าสุด');
      currentUserId=LeagueShared.sessionUserId(remote);
      if(!LeagueShared.isAdmin(remote,currentUserId)){
        adoptRemote(remote,latest?.updated_at,'สิทธิ์บัญชีเปลี่ยนแล้ว');return;
      }

      const remoteLeagueChanged=json(remote)!==json(syncBase);
      const localStructureChanged=structure(local)!==structure(syncBase);
      const localKeys=changedResultKeys(syncBase,local);
      const remoteKeys=changedResultKeys(syncBase,remote);
      const remoteKeySet=new Set(remoteKeys);
      const conflictingScore=localKeys.find(key=>remoteKeySet.has(key)&&json(local.results?.[key])!==json(remote.results?.[key]));

      if(remoteLeagueChanged&&localStructureChanged){
        saveConflict(local,'โครงสร้าง Season ถูกแก้จากหลายเครื่องพร้อมกัน');
        adoptRemote(remote,latest?.updated_at,'พบการแก้ไข Season จากอีกเครื่อง • เก็บ Draft ไว้ใน Backup');return;
      }
      if(conflictingScore){
        saveConflict(local,`คะแนน ${conflictingScore} ถูกแก้จากหลายเครื่องพร้อมกัน`);
        adoptRemote(remote,latest?.updated_at,'คะแนนคู่นี้ถูกแก้จากอีกเครื่อง • เก็บ Draft ไว้ใน Backup');return;
      }

      let next=remoteLeagueChanged?applyResultDelta(syncBase,local,remote):local;
      next=mergeLocalAudit(syncBase,local,next);
      const now=new Date().toISOString(),expected=latest?.updated_at||'',filter=expected?`updated_at=eq.${encodeURIComponent(expected)}`:'';
      const rows=await cloudRequest('PATCH',{league:{...(latest?.league||{}),uidLeague:next},updated_at:now},filter);
      if(!rows?.length){
        saveConflict(local,'ข้อมูลเปลี่ยนระหว่างกำลังบันทึก');
        const refreshed=(await cloudRequest())[0],newest=refreshed?.league?.uidLeague;
        if(newest?.profiles){adoptRemote(newest,refreshed?.updated_at,'มีข้อมูลใหม่จากอีกเครื่อง • เก็บ Draft ไว้ใน Backup');return}
        throw new Error('ข้อมูลถูกแก้จากอีกเครื่อง');
      }
      state=next;lastCloudUpdate=rows[0]?.updated_at||now;baseUpdatedAt=lastCloudUpdate;syncBase=clone(next);
      dirty=changeVersion!==startedVersion;saved=true;saveLocal();setSync('ออนไลน์ • บันทึกแล้ว','online');
    }catch(error){console.error(error);setSync('ออฟไลน์ • เก็บในเครื่อง','offline')}
    finally{cloudSaving=false;if(saved&&dirty)saveTimer=setTimeout(pushCloud,400)}
  };

  setInterval(()=>{
    if(!dirty&&!cloudSaving&&lastCloudUpdate&&lastCloudUpdate!==baseUpdatedAt){syncBase=clone(state);baseUpdatedAt=lastCloudUpdate}
  },1200);
})();
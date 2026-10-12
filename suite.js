// Sessions 5,6,7,8: shared workflow, export, feedback and integrity helpers.
(() => {
  const qs=(s,r=document)=>r.querySelector(s), qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  function toast(message,type="",detail=""){
    let stack=qs("#toastStack");
    if(!stack){stack=document.createElement("div");stack.id="toastStack";stack.className="toast-stack";document.body.appendChild(stack)}
    const el=document.createElement("div");el.className=`toast ${type}`;el.innerHTML=`<b>${LeagueShared.escapeHtml(message)}</b>${detail?`<small>${LeagueShared.escapeHtml(detail)}</small>`:""}`;stack.appendChild(el);
    setTimeout(()=>{el.style.opacity="0";el.style.transform="translateY(-6px)";setTimeout(()=>el.remove(),180)},3200);
  }
  window.LeagueToast=toast;
  if(!window.__leagueNativeAlert){window.__leagueNativeAlert=window.alert.bind(window);window.alert=msg=>toast(String(msg),"good")}

  function pulseNumbers(){
    const obs=new MutationObserver(records=>records.forEach(r=>{const el=r.target;if(el instanceof HTMLElement&&/^-?[+]?\d[\d,]*(\.\d+)?$/.test(el.textContent.trim())){el.classList.remove("number-pulse");void el.offsetWidth;el.classList.add("number-pulse")}}));
    qsa(".stat b,.profile-metric b,.rank-rp,.points").forEach(el=>obs.observe(el,{childList:true,characterData:true,subtree:true}));
  }
  function leagueState(){try{return typeof state!=="undefined"?state:LeagueShared.readLocalLeague()}catch{return LeagueShared.readLocalLeague()}}
  function validateLeague(l){
    const issues=[];if(!l?.profiles||typeof l.profiles!=="object")issues.push("profiles missing");if(!Array.isArray(l?.seasonPlayerIds))issues.push("seasonPlayerIds invalid");if(!Array.isArray(l?.rounds))issues.push("rounds invalid");if(!l?.results||typeof l.results!=="object")issues.push("results invalid");
    (l?.seasonPlayerIds||[]).forEach(id=>{if(!l.profiles?.[id])issues.push(`missing profile ${id}`)});
    Object.entries(l?.results||{}).forEach(([id,s])=>{if(s?.a!=null&&(!Number.isInteger(s.a)||s.a<0))issues.push(`invalid score ${id}.a`);if(s?.b!=null&&(!Number.isInteger(s.b)||s.b<0))issues.push(`invalid score ${id}.b`)});
    return issues;
  }
  function addHealthBadge(){const l=leagueState();if(!l)return;const issues=validateLeague(l);const rules=qs(".rules");if(!rules||qs("#healthBadge"))return;const b=document.createElement("span");b.id="healthBadge";b.className=`health-pill ${issues.length?"warn":"good"}`;b.textContent=issues.length?`⚠️ Data ${issues.length}`:"✓ Data OK";b.title=issues.join("\n")||"โครงสร้างข้อมูลปกติ";rules.appendChild(b)}
  function currentMatchStats(l){let played=0,total=0;(l?.rounds||[]).forEach((r,ri)=>(r.m||[]).forEach((p,mi)=>{total++;const s=l.results?.[`r${ri}m${mi}`];if(Number.isInteger(s?.a)&&Number.isInteger(s?.b))played++}));return{played,total,remain:Math.max(0,total-played)}}
  function pendingPredictions(){try{const p=JSON.parse(localStorage.getItem(LeagueShared.PRED_KEY)||"null");return (p?.bets||[]).filter(b=>b.status==="pending").length}catch{return 0}}
  function addWorkflowCard(){const l=leagueState();if(!l||!qs("#competition")||qs("#workflowCard"))return;const m=currentMatchStats(l),pending=pendingPredictions(),admin=(()=>{try{return typeof isAdmin==="function"&&isAdmin()}catch{return false}})();const card=document.createElement("section");card.id="workflowCard";card.className="workflow-card suite-section";card.innerHTML=`<div class="workflow-title"><b>🔔 League Assistant</b><a class="btn secondary" href="dashboard.html">Dashboard</a></div><div class="workflow-items"><div class="workflow-item ${m.remain?"warn":"good"}"><span>${m.remain?`เหลือ ${m.remain} คู่ยังไม่มีผล`:"กรอกผลครบแล้ว"}</span><b>${m.played}/${m.total}</b></div><div class="workflow-item ${pending?"warn":"good"}"><span>${pending?`มี ${pending} รายการทายรอผล`:"ไม่มีรายการทายรอผล"}</span><a href="predictions.html">เปิด</a></div>${admin&&m.total&&m.remain===0?'<div class="workflow-item good"><span>Season พร้อมปิดและบันทึกแรงค์</span><b>พร้อม ✓</b></div>':""}</div>`;qs("#competition").before(card)}
  function standingsCsv(){const rows=qsa("#standings tr").map(tr=>qsa("td",tr).map(td=>`"${td.textContent.trim().replace(/"/g,'""')}"`).join(","));return ["อันดับ,ผู้เล่น,แข่ง,ชนะ,เสมอ,แพ้,ได้,เสีย,+/-,แต้ม",...rows].join("\n")}
  function download(name,text,type="text/plain;charset=utf-8") {const blob=new Blob(["\ufeff"+text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  async function shareStandings(){const l=leagueState();const lines=qsa("#standings tr").slice(0,8).map(tr=>qsa("td",tr)).filter(x=>x.length).map(x=>`${x[0].textContent}. ${x[1].textContent.trim()} — ${x[9].textContent} แต้ม`);const text=`🏓 ตารางคะแนน Season ${l?.currentSeason||"-"}\n${lines.join("\n")}`;if(navigator.share)await navigator.share({title:"ตารางคะแนนปิงปอง",text});else{await navigator.clipboard?.writeText(text);toast("คัดลอกสรุปแล้ว","good")}}
  function addExportTools(){const host=qs("#standingsCard .actions");if(!host||qs("#exportLeagueCsv"))return;const csv=document.createElement("button");csv.id="exportLeagueCsv";csv.className="secondary";csv.textContent="⬇️ CSV";csv.onclick=()=>download(`pingpong-season-${leagueState()?.currentSeason||"current"}.csv`,standingsCsv(),"text/csv;charset=utf-8");const share=document.createElement("button");share.className="secondary";share.textContent="📤 แชร์ตาราง";share.onclick=()=>shareStandings().catch(()=>toast("แชร์ไม่สำเร็จ","bad"));host.append(csv,share)}
  function addQuickLinks(){const hero=qs(".hero .actions");if(!hero||qs("#suiteQuickLinks"))return;const wrap=document.createElement("span");wrap.id="suiteQuickLinks";wrap.style.display="contents";wrap.innerHTML='<a class="btn secondary" href="dashboard.html">📊 Dashboard</a><a class="btn secondary" href="stats.html">👤 Stats</a><a class="btn secondary" href="backup.html">🛡 Backup</a>';hero.appendChild(wrap)}
  function markSchema(){const l=leagueState();if(!l)return;if(!l.schemaVersion)l.schemaVersion=2;try{LeagueShared.saveLocalLeague(l)}catch{}}
  function boot(){pulseNumbers();addHealthBadge();addWorkflowCard();addExportTools();addQuickLinks();markSchema();}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(boot,100));else setTimeout(boot,100);
})();

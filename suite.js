// Sessions 5,6,7,8: shared workflow, export, feedback and integrity helpers.
(() => {
  const qs=(s,r=document)=>r.querySelector(s), qsa=(s,r=document)=>[...r.querySelectorAll(s)];
  const page=(location.pathname.split("/").pop()||"index.html").toLowerCase();
  const reduceMotion=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Toasts: tap or swipe sideways to dismiss; hover/touch pauses the timer; thin bar shows the time left.
  function toast(message,type="",detail="",ms=3200){
    let stack=qs("#toastStack");
    if(!stack){stack=document.createElement("div");stack.id="toastStack";stack.className="toast-stack";stack.setAttribute("role","status");stack.setAttribute("aria-live","polite");stack.setAttribute("aria-live","polite");document.body.appendChild(stack)}
    const el=document.createElement("div");el.className=`toast ${type}`;el.setAttribute("role","status");el.title="แตะหรือปัดเพื่อปิด";el.style.setProperty("--toast-ms",`${ms}ms`);
    el.innerHTML=`<b>${LeagueShared.escapeHtml(message)}</b>${detail?`<small>${LeagueShared.escapeHtml(detail)}</small>`:""}<i class="toast-progress" aria-hidden="true"></i>`;stack.appendChild(el);
    let remain=ms,started=0,timer=0,gone=false,startX=0,dx=0,dragging=false;
    const close=(x=0)=>{if(gone)return;gone=true;clearTimeout(timer);el.classList.add("leaving");if(x)el.style.transform=`translateX(${x>0?"":"-"}115%)`;setTimeout(()=>el.remove(),200)};
    const run=()=>{if(gone)return;started=Date.now();el.classList.remove("paused");clearTimeout(timer);timer=setTimeout(()=>close(),remain)};
    const pause=()=>{if(gone||el.classList.contains("paused"))return;clearTimeout(timer);remain=Math.max(400,remain-(Date.now()-started));el.classList.add("paused")};
    const reset=()=>{dragging=false;el.classList.remove("dragging");el.style.transform="";el.style.opacity=""};
    el.addEventListener("pointerdown",e=>{pause();dragging=true;dx=0;startX=e.clientX;el.classList.add("dragging");try{el.setPointerCapture(e.pointerId)}catch{}});
    el.addEventListener("pointermove",e=>{if(!dragging)return;dx=e.clientX-startX;el.style.transform=`translateX(${dx}px)`;el.style.opacity=String(Math.max(.25,1-Math.abs(dx)/220))});
    el.addEventListener("pointerup",()=>{if(!dragging)return;dragging=false;el.classList.remove("dragging");if(Math.abs(dx)>64)return close(dx);if(Math.abs(dx)<6)return close();reset();run()});
    el.addEventListener("pointercancel",()=>{reset();run()});
    el.addEventListener("mouseenter",pause);el.addEventListener("mouseleave",()=>{if(!dragging)run()});
    run();return el;
  }
  window.LeagueToast=toast;
  if(!window.__leagueNativeAlert){window.__leagueNativeAlert=window.alert.bind(window);window.alert=msg=>toast(String(msg),"good")}

  // Numbers: count up from the old value to the new one (RP, match counts, dashboard stats). Reduced motion keeps a plain pulse.
  const NUM_SEL=".stat b,.profile-metric b,.rank-rp,.points,.workflow-item b",NUM_RE=/^([+-]?)(\d[\d,]*)(\s*[^\d\s][^\d]*)?$/,written=new WeakMap();
  function parseNum(text){const m=String(text).trim().match(NUM_RE);if(!m)return null;return{n:Number(m[2].replace(/,/g,""))*(m[1]==="-"?-1:1),plus:m[1]==="+",commas:m[2].includes(","),suffix:m[3]||""}}
  const fmtNum=(v,p)=>`${v<0?"-":p.plus&&v>0?"+":""}${p.commas?Math.abs(v).toLocaleString("en-US"):Math.abs(v)}${p.suffix}`;
  function pulse(el){el.classList.remove("number-pulse");void el.offsetWidth;el.classList.add("number-pulse")}
  function countUp(el,fromText){
    // Any new write by the page cancels an animation still running toward an older value,
    // including a write of the same text the animation happens to show (its text node is then replaced).
    const run=el.__countRun=(el.__countRun||0)+1;let node=null;
    const final=el.textContent,to=parseNum(final),from=parseNum(fromText);
    if(String(fromText).trim()===final.trim()||!to)return;
    if(!from||from.n===to.n||reduceMotion()||document.hidden)return pulse(el);
    const fmt={...to,plus:to.plus||from.plus,commas:to.commas||from.commas},diff=to.n-from.n,duration=Math.min(900,380+Math.abs(diff)*18),t0=performance.now();
    const step=now=>{if(el.__countRun!==run||(node&&el.firstChild!==node))return;const k=Math.min(1,Math.max(0,now-t0)/duration),text=k<1?fmtNum(Math.round(from.n+diff*(1-Math.pow(1-k,3))),fmt):final;written.set(el,text);el.textContent=text;node=el.firstChild;if(k<1)requestAnimationFrame(step)};
    pulse(el);step(t0);
  }
  const numKey=el=>{const row=el.closest(".rank-row,tr,.stat,.profile-metric,.workflow-item");return`${row?.querySelector("strong,td.name,small,span")?.textContent.trim()||""}|${el.className||el.tagName}`};
  const numsIn=node=>node instanceof Element?[...(node.matches(NUM_SEL)?[node]:[]),...node.querySelectorAll(NUM_SEL)]:[];
  function watchNumbers(){
    new MutationObserver(records=>{
      if(document.documentElement.classList.contains("cloud-loading"))return;
      const old=new Map(),changed=new Map(),added=[];
      records.forEach(r=>{
        const target=r.type==="characterData"?r.target.parentElement:r.target;
        if(target instanceof Element&&target.matches(NUM_SEL)){
          if(!changed.has(target))changed.set(target,r.type==="characterData"?r.oldValue:[...r.removedNodes].map(n=>n.textContent).join(""));return;
        }
        r.removedNodes.forEach(n=>numsIn(n).forEach(el=>{const k=numKey(el);if(!old.has(k))old.set(k,el.textContent)}));
        r.addedNodes.forEach(n=>added.push(...numsIn(n)));
      });
      changed.forEach((before,el)=>{if(written.get(el)!==el.textContent&&!el.closest(".skeleton"))countUp(el,before)});
      added.forEach(el=>{const before=old.get(numKey(el));if(before!=null&&el.isConnected&&!el.closest(".skeleton"))countUp(el,before)});
    }).observe(document.body,{childList:true,characterData:true,characterDataOldValue:true,subtree:true});
  }

  // Cloud wait: the button that started a Supabase request gets spinner + disabled + aria-busy until the request settles.
  const isCloud=url=>/\/rest\/v1\/|supabase\.co/.test(String(url?.url||url||""));
  let lastPress=null;
  document.addEventListener("click",e=>{const b=e.target.closest?.("button");lastPress=b&&!b.disabled?{b,at:Date.now()}:null},true);
  function busyStart(b){
    b.__busy=(b.__busy||0)+1;if(b.__busy>1)return;
    b.__busyOwnsDisabled=!b.disabled;
    if(b.__busyOwnsDisabled){b.disabled=true;b.__busyWatch=new MutationObserver(()=>{b.__busyOwnsDisabled=false});b.__busyWatch.observe(b,{attributes:true,attributeFilter:["disabled"]})}
    b.__busyTimer=setTimeout(()=>b.setAttribute("aria-busy","true"),120);
  }
  function busyEnd(b){
    if(--b.__busy>0)return;
    clearTimeout(b.__busyTimer);b.__busyWatch?.disconnect();b.removeAttribute("aria-busy");
    if(b.__busyOwnsDisabled)b.disabled=false;b.__busyOwnsDisabled=false;
  }
  const nativeFetch=window.fetch.bind(window);
  window.fetch=function(input,init){
    const request=nativeFetch(input,init),press=lastPress;
    if(press&&Date.now()-press.at<1500&&press.b.isConnected&&isCloud(input)){press.at=Date.now();busyStart(press.b);request.then(()=>{},()=>{}).then(()=>setTimeout(()=>busyEnd(press.b),250))}
    return request;
  };

  // First cloud load on dashboard/stats/archive: skeletons instead of local data that is about to be replaced.
  const SKELETONS={"dashboard.html":".stat b,#top3,#hotForm","stats.html":".stat b,#playerTitle,#recentForm,#rival,.wrap","archive.html":"#seasonList,#summaryCards,.table-wrap,#archiveMatches"};
  function cloudSkeleton(){
    const sel=SKELETONS[page],main=qs("main");if(!sel||!main)return;
    const cloudEntry=list=>list.some(e=>isCloud(e.name));
    if(cloudEntry(performance.getEntriesByType?.("resource")||[]))return;
    const els=qsa(sel),root=document.documentElement;let done=false,obs=null;
    els.forEach(el=>{el.classList.add("skeleton");if(!el.textContent.trim())el.classList.add("skeleton-block");if(el.matches(NUM_SEL))el.dataset.countFrom=el.textContent});
    root.classList.add("cloud-loading");main.setAttribute("aria-busy","true");
    const finish=()=>{if(done)return;done=true;obs?.disconnect();clearTimeout(fallback);setTimeout(()=>{
      root.classList.remove("cloud-loading");main.removeAttribute("aria-busy");
      els.forEach(el=>{el.classList.remove("skeleton","skeleton-block");if(el.dataset.countFrom!=null){const from=el.dataset.countFrom;delete el.dataset.countFrom;countUp(el,from)}});
    },60)};
    const fallback=setTimeout(finish,6000);
    try{obs=new PerformanceObserver(list=>{if(cloudEntry(list.getEntries()))finish()});obs.observe({type:"resource",buffered:true})}catch{finish()}
  }
  function leagueState(){try{return typeof state!=="undefined"?state:LeagueShared.readLocalLeague()}catch{return LeagueShared.readLocalLeague()}}
  function validateLeague(l){return LeagueShared.validateLeague?LeagueShared.validateLeague(l):[]}
  function addHealthBadge(){const l=leagueState();if(!l)return;const issues=validateLeague(l),rules=qs(".rules");if(!rules||qs("#healthBadge"))return;const b=document.createElement("span");b.id="healthBadge";b.className=`health-pill ${issues.length?"warn":"good"}`;b.textContent=issues.length?`⚠️ Data ${issues.length}`:"✓ Data OK";b.title=issues.join("\n")||"โครงสร้างข้อมูลปกติ";rules.appendChild(b)}
  function currentMatchStats(l){let played=0,total=0;(l?.rounds||[]).forEach((r,ri)=>(r.m||[]).forEach((p,mi)=>{total++;const s=l.results?.[`r${ri}m${mi}`];if(Number.isInteger(s?.a)&&Number.isInteger(s?.b))played++}));return{played,total,remain:Math.max(0,total-played)}}
  function pendingPredictions(){try{const p=JSON.parse(localStorage.getItem(LeagueShared.PRED_KEY)||"null");return (p?.bets||[]).filter(b=>b.status==="pending").length}catch{return 0}}
  function addWorkflowCard(){const l=leagueState();if(!l||!qs("#competition")||qs("#workflowCard"))return;const m=currentMatchStats(l),pending=pendingPredictions(),admin=(()=>{try{return typeof isAdmin==="function"&&isAdmin()}catch{return false}})();const card=document.createElement("section");card.id="workflowCard";card.className="workflow-card suite-section";card.innerHTML=`<div class="workflow-title"><b>League Assistant</b><a class="btn secondary" href="dashboard.html">Dashboard</a></div><div class="workflow-items"><div class="workflow-item ${m.remain?"warn":"good"}"><span>${m.remain?`เหลือ ${m.remain} คู่ยังไม่มีผล`:"กรอกผลครบแล้ว"}</span><b>${m.played}/${m.total}</b></div><div class="workflow-item ${pending?"warn":"good"}"><span>${pending?`มี ${pending} รายการทายรอผล`:"ไม่มีรายการทายรอผล"}</span><a href="predictions.html">เปิด</a></div>${admin&&m.total&&m.remain===0?'<div class="workflow-item good"><span>Season พร้อมปิดและบันทึกแรงค์</span><b>พร้อม ✓</b></div>':""}</div>`;qs("#competition").before(card)}
  // Avatars (player-ui.js) and banter stamps (banter.js) sit inside the name cell; exports keep the plain name.
  const cellText=td=>{const c=td.cloneNode(true);c.querySelectorAll(".pa,.banter-stamp").forEach(x=>x.remove());return c.textContent.trim()};
  function tableRows(){return qsa("#standings tr").map(tr=>qsa("td",tr).map(cellText)).filter(x=>x.length)}
  function standingsCsv(){return ["อันดับ,ผู้เล่น,แข่ง,ชนะ,เสมอ,แพ้,ได้,เสีย,+/-,แต้ม",...tableRows().map(r=>r.map(v=>`"${v.replace(/"/g,'""')}"`).join(","))].join("\n")}
  function download(name,text,type="text/plain;charset=utf-8"){const blob=new Blob(["\ufeff"+text],{type}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  function downloadPng(){const rows=tableRows(),l=leagueState(),w=1080,rowH=54,h=170+(rows.length+1)*rowH,canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;const c=canvas.getContext("2d");c.fillStyle="#07111f";c.fillRect(0,0,w,h);c.fillStyle="#f7fbff";c.font="700 36px sans-serif";c.fillText(`ตารางคะแนน Season ${l?.currentSeason||"-"}`,42,58);c.font="20px sans-serif";c.fillStyle="#91a4be";c.fillText("ตีให้สุด หยุดที่เบ้าตา",42,94);const headers=["#","ผู้เล่น","แข่ง","ชนะ","เสมอ","แพ้","ได้","เสีย","+/-","แต้ม"],xs=[42,95,420,500,580,660,740,820,900,980];c.font="700 18px sans-serif";c.fillStyle="#cfe1fb";headers.forEach((x,i)=>c.fillText(x,xs[i],145));c.font="18px sans-serif";rows.forEach((r,ri)=>{const y=145+(ri+1)*rowH;c.fillStyle=ri%2?"#0b1728":"#10203a";c.fillRect(30,y-34,w-60,rowH-4);c.fillStyle="#f7fbff";r.forEach((v,i)=>c.fillText(v,xs[i],y))});const a=document.createElement("a");a.download=`standings-season-${l?.currentSeason||"current"}.png`;a.href=canvas.toDataURL("image/png");a.click();toast("สร้างรูปตารางคะแนนแล้ว","good")}
  function printPdf(){const card=qs("#standingsCard");if(!card)return;const win=window.open("","_blank");win.document.write(`<html><head><title>Standings</title><style>body{font-family:sans-serif;padding:24px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:7px;text-align:center}h1{margin:0 0 16px}</style></head><body><h1>ตารางคะแนน Season ${LeagueShared.escapeHtml(leagueState()?.currentSeason||"-")}</h1>${card.querySelector(".wrap")?.innerHTML||""}<script>window.onload=()=>window.print()<\/script></body></html>`);win.document.close()}
  async function shareStandings(){const l=leagueState(),lines=tableRows().slice(0,8).map(x=>`${x[0]}. ${x[1]} — ${x[9]} แต้ม`),text=`🏓 ตารางคะแนน Season ${l?.currentSeason||"-"}\n${lines.join("\n")}`;if(navigator.share)await navigator.share({title:"ตารางคะแนนปิงปอง",text});else{await navigator.clipboard?.writeText(text);toast("คัดลอกสรุปแล้ว","good")}}
  function addExportTools(){const host=qs("#standingsCard .actions");if(!host||qs("#exportLeagueCsv"))return;const mk=(id,text,fn)=>{const b=document.createElement("button");b.id=id;b.className="secondary";b.textContent=text;b.onclick=fn;host.appendChild(b)};mk("exportLeagueCsv","CSV",()=>download(`pingpong-season-${leagueState()?.currentSeason||"current"}.csv`,standingsCsv(),"text/csv;charset=utf-8"));mk("exportLeaguePng","PNG",downloadPng);mk("exportLeaguePdf","PDF/Print",printPdf);mk("shareLeague","แชร์ตาราง",()=>shareStandings().catch(()=>toast("แชร์ไม่สำเร็จ","bad")))}
  const pathOf=href=>{try{return new URL(href,location.href).pathname.split("/").pop().toLowerCase()||"index.html"}catch{return""}};
  function addQuickLinks(){const hero=qs(".hero .actions");if(!hero||qs("#suiteQuickLinks"))return;const have=new Set([page,...qsa(".hero a[href]").map(a=>pathOf(a.getAttribute("href"))),...(page==="index.html"?[]:["index.html","dashboard.html","predictions.html","stats.html"])]);const links=[["dashboard.html","Dashboard"],["stats.html","Stats"],["backup.html","Backup"]].filter(([href])=>!have.has(href));if(!links.length)return;const wrap=document.createElement("span");wrap.id="suiteQuickLinks";wrap.style.display="contents";wrap.innerHTML=links.map(([href,text])=>`<a class="btn secondary" href="${href}">${text}</a>`).join("");hero.appendChild(wrap)}
  function markSchema(){const l=leagueState();if(!l)return;try{LeagueShared.normalizeLeague?.(l);LeagueShared.saveLocalLeague(l)}catch{}}
  function boot(){watchNumbers();addHealthBadge();addWorkflowCard();addExportTools();addQuickLinks();markSchema()}
  cloudSkeleton();
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(boot,100));else setTimeout(boot,100);
})();

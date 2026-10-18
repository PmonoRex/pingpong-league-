const KEY=LeagueShared.LEAGUE_KEY;
const LEGACY_KEYS=["pp_league_v5","pp_league_v4"];
const ADMIN_NAME="มอส";

let state={profiles:{},seasonPlayerIds:[],rounds:[],results:{},rankHistory:[],currentSeason:1};
let currentUserId="";
let cloudReady=false,cloudSaving=false,dirty=false,lastCloudUpdate="",saveTimer=null,changeVersion=0;

const esc=LeagueShared.escapeHtml;
const valid=v=>Number.isInteger(v)&&v>=0;
const profile=id=>LeagueShared.profile(state,id);
const activeProfiles=()=>LeagueShared.activeProfiles(state);
const seasonProfiles=()=>state.seasonPlayerIds.map(id=>profile(id)).filter(Boolean);
const seasonNames=()=>seasonProfiles().map(p=>p.displayName);
const totalMatches=()=>state.seasonPlayerIds.length*(state.seasonPlayerIds.length-1)/2;
const isAdmin=()=>LeagueShared.isAdmin(state,currentUserId);
const mid=(r,m)=>`r${r}m${m}`;
const BANTER=typeof LeagueBanter!=="undefined"?LeagueBanter:null;

function deterministicId(name,i){return `legacy_${i+1}_${encodeURIComponent(name).replace(/%/g,"").slice(0,12)}`}
function migrateLegacy(){
 let legacy=null;
 for(const k of LEGACY_KEYS){try{const x=JSON.parse(localStorage.getItem(k)||"null");if(x&&x.players){legacy=x;break}}catch(e){}}
 const names=legacy?.players?.length?legacy.players:["พี่โช็ค","กิฟท์","กอล์ฟ","มังกร","พฤษ","เฟิร์น","มอส"];
 names.forEach((name,i)=>{const id=deterministicId(name,i);state.profiles[id]={id,displayName:name,pin:"1234",role:name===ADMIN_NAME?"admin":"player",active:true,createdAt:new Date().toISOString()}});
 state.seasonPlayerIds=names.map((n,i)=>deterministicId(n,i));
 state.rounds=legacy?.rounds||makeRoundRobin(state.seasonPlayerIds);
 state.results=legacy?.results||{};
 state.rankHistory=legacy?.rankHistory||[];
 state.currentSeason=legacy?.currentSeason||1;
 saveLocal();
}
function loadLocal(){const saved=LeagueShared.readLocalLeague();if(saved){state=saved;return}migrateLegacy()}
function saveLocal(){LeagueShared.saveLocalLeague(state)}
function makeRoundRobin(ids){
 const a=[...ids];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}if(a.length%2)a.push(null);
 const out=[],size=a.length;
 for(let r=0;r<size-1;r++){let rest=null,m=[];for(let i=0;i<size/2;i++){const x=a[i],y=a[size-1-i];if(x&&y)m.push(r%2?[y,x]:[x,y]);else rest=x||y}out.push({rest,m});a.splice(1,0,a.pop())}
 return out;
}
function setSync(text,status=""){const e=document.getElementById("syncStatus");e.textContent=text;e.className=`pill sync ${status}`}
const cloudRequest=(method="GET",body=null,extraQuery="")=>LeagueShared.cloudRequest("league,updated_at",method,body,extraQuery);
function cloudPayload(){return {uidLeague:state}}
function saveState(){if(!isAdmin())return;saveLocal();if(!cloudReady)return;dirty=true;changeVersion++;setSync("กำลังบันทึก…");clearTimeout(saveTimer);saveTimer=setTimeout(pushCloud,400)}
async function pushCloud(){
 if(!cloudReady||cloudSaving||!dirty)return;
 cloudSaving=true;
 const startedVersion=changeVersion;
 let saved=false;
 try{
  const latest=(await cloudRequest())[0];
  const remote=latest?.league?.uidLeague;
  if(remote?.profiles){
   state.profiles=remote.profiles;
   reconcileSession();
   if(!isAdmin()){
    state=remote;saveLocal();dirty=false;renderLogin();render();setSync("สิทธิ์บัญชีเปลี่ยนแล้ว","offline");return;
   }
  }
  const now=new Date().toISOString();
  const expected=latest?.updated_at||"";
  const filter=expected?`updated_at=eq.${encodeURIComponent(expected)}`:"";
  const rows=await cloudRequest("PATCH",{league:{...(latest?.league||{}),...cloudPayload()},updated_at:now},filter);
  if(!rows?.length){
   try{localStorage.setItem("pp_conflict_draft_v1",JSON.stringify({savedAt:now,league:state}))}catch{}
   const refreshed=(await cloudRequest())[0];
   const newest=refreshed?.league?.uidLeague;
   if(newest?.profiles){state=newest;lastCloudUpdate=refreshed?.updated_at||"";dirty=false;saveLocal();reconcileSession();renderLogin();render();setSync("มีข้อมูลใหม่จากอีกเครื่อง • โหลดล่าสุดแล้ว","offline");return}
   throw new Error("ข้อมูลถูกแก้จากอีกเครื่อง");
  }
  lastCloudUpdate=rows[0]?.updated_at||now;dirty=changeVersion!==startedVersion;saved=true;saveLocal();setSync("ออนไลน์ • บันทึกแล้ว","online");
 }catch(e){setSync("ออฟไลน์ • เก็บในเครื่อง","offline")}finally{cloudSaving=false;if(saved&&dirty)saveTimer=setTimeout(pushCloud,400)}
}
function reconcileSession(){currentUserId=LeagueShared.sessionUserId(state);document.getElementById("auth").classList.toggle("hidden",Boolean(currentUserId))}
async function initCloud(){try{const rows=await cloudRequest(),row=rows[0];cloudReady=true;const remote=row?.league?.uidLeague;if(remote?.profiles){state=remote;saveLocal()}lastCloudUpdate=row?.updated_at||"";reconcileSession();renderLogin();render();setSync("ออนไลน์ • ซิงก์แล้ว","online");setInterval(pullCloud,3000)}catch(e){setSync("ออฟไลน์ • ใช้ข้อมูลในเครื่อง","offline")}}
// Each poll asks only for updated_at; the whole league (with everyone's pictures) is fetched only when it changed.
async function pullCloud(){if(!cloudReady||dirty||cloudSaving||document.hidden)return;try{const stamp=(await LeagueShared.cloudRequest("updated_at"))[0];if(!stamp||stamp.updated_at===lastCloudUpdate)return;const rows=await cloudRequest(),row=rows[0];if(!row||row.updated_at===lastCloudUpdate)return;lastCloudUpdate=row.updated_at||"";const remote=row.league?.uidLeague;if(remote?.profiles){state=remote;saveLocal();reconcileSession();renderLogin();render()}}catch(e){}}

function renderLogin(){LeagueShared.renderLoginOptions(document.getElementById("loginUser"),state,currentUserId)}
function login(){const id=document.getElementById("loginUser").value,pin=document.getElementById("loginPin").value;if(!LeagueShared.login(state,id,pin)){alert("PIN ไม่ถูกต้องหรือบัญชีถูกปิดใช้งาน");return}document.getElementById("loginPin").value="";reconcileSession();render()}
function logout(){LeagueShared.logout();reconcileSession();renderLogin();render()}
function renderHeader(){const p=profile(currentUserId);document.getElementById("whoami").textContent=p?.displayName||"-";document.getElementById("adminBadge").style.display=isAdmin()?"inline-flex":"none";document.getElementById("adminLink").style.display=isAdmin()?"inline-flex":"none";document.getElementById("leagueInfo").textContent=`ซีซั่น ${state.currentSeason} • ${state.seasonPlayerIds.length} คน • ${totalMatches()} แมตช์`}
function renderRoster(){
 const box=document.getElementById("rosterList");const selected=new Set(state.seasonPlayerIds);
 box.innerHTML=activeProfiles().map(p=>`<label class="roster-item ${isAdmin()?"":"locked"}"><input type="checkbox" data-roster="${esc(p.id)}" ${selected.has(p.id)?"checked":""} ${isAdmin()?"":"disabled"}><div><strong>${esc(p.displayName)}</strong>${p.role==="admin"?"<small>แอดมิน</small>":""}</div></label>`).join("");
 document.getElementById("applyRoster").style.display=isAdmin()?"inline-flex":"none";document.getElementById("addAccountLink").style.display=isAdmin()?"inline-flex":"none";
}
function applyRoster(){if(!isAdmin())return;const ids=[...document.querySelectorAll("[data-roster]:checked")].map(x=>x.dataset.roster);if(ids.length<2){alert("ต้องเลือกอย่างน้อย 2 คน");return}if(Object.keys(state.results).length&&!confirm("การเปลี่ยนผู้เล่นจะล้างผลซีซั่นปัจจุบัน ยืนยันหรือไม่?"))return;state.seasonPlayerIds=ids;state.rounds=makeRoundRobin(ids);state.results={};saveState();render()}
function renderSchedule(){
 const box=document.getElementById("schedule");box.innerHTML="";
 state.rounds.forEach((r,ri)=>{const sec=document.createElement("div");sec.className="round";sec.innerHTML=`<div class="rh"><b>รอบ ${ri+1}</b><span class="rest">${r.rest?`พัก: ${esc(profile(r.rest)?.displayName||r.rest)}`:"แข่งครบ"}</span></div>`;
  r.m.forEach((pair,mi)=>{const id=mid(ri,mi),x=state.results[id]||{},a=profile(pair[0]),b=profile(pair[1]);const row=document.createElement("div");row.className="match";row.id=`match-${id}`;row.innerHTML=`<div class="pair"><b class="left">${esc(a?.displayName||pair[0])}</b><div class="score-control"><button class="minus" ${isAdmin()?"":"disabled"} data-score="${id}:a:-1" aria-label="ลดคะแนน ${esc(a?.displayName||pair[0])}">−</button><input id="${id}a" inputmode="numeric" type="number" min="0" aria-label="คะแนน ${esc(a?.displayName||pair[0])}" ${isAdmin()?"":"disabled"} value="${esc(x.a??"")}"><button class="plus" ${isAdmin()?"":"disabled"} data-score="${id}:a:1" aria-label="เพิ่มคะแนน ${esc(a?.displayName||pair[0])}">+</button></div><span class="vs">VS</span><div class="score-control"><button class="minus" ${isAdmin()?"":"disabled"} data-score="${id}:b:-1" aria-label="ลดคะแนน ${esc(b?.displayName||pair[1])}">−</button><input id="${id}b" inputmode="numeric" type="number" min="0" aria-label="คะแนน ${esc(b?.displayName||pair[1])}" ${isAdmin()?"":"disabled"} value="${esc(x.b??"")}"><button class="plus" ${isAdmin()?"":"disabled"} data-score="${id}:b:1" aria-label="เพิ่มคะแนน ${esc(b?.displayName||pair[1])}">+</button></div><b>${esc(b?.displayName||pair[1])}</b></div><div class="rivalry" id="${id}r" hidden></div><div class="status" id="${id}s"></div><button type="button" class="share-poster-btn" data-share-match="${id}" aria-label="แชร์ผลคู่นี้เป็นโปสเตอร์" title="แชร์ไป LINE"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1"/></svg></button>`;sec.appendChild(row)});box.appendChild(sec)});
 box.querySelectorAll("[data-share-match]").forEach(btn=>btn.onclick=()=>shareMatchPoster(btn.dataset.shareMatch,btn));
 box.querySelectorAll("[data-score]").forEach(btn=>btn.onclick=()=>{if(!isAdmin())return;const [id,side,delta]=btn.dataset.score.split(":");const inp=document.getElementById(id+side),v=inp.value===""?0:Number(inp.value);inp.value=Math.max(0,v+Number(delta));updateFromInputs(id)});
 state.rounds.forEach((r,ri)=>r.m.forEach((p,mi)=>["a","b"].forEach(side=>document.getElementById(mid(ri,mi)+side).oninput=()=>updateFromInputs(mid(ri,mi)))));
 updateLabels();renderRoundTabs();
}
// Round picker: the schedule shows one round at a time so the page stays short. It opens on the round being played
// and then stays where the user put it (finishing a round does not yank it away mid-stamp); "ทั้งหมด" shows every round.
let roundView=null;
function roundDone(ri){return (state.rounds[ri]?.m||[]).every((p,mi)=>{const x=state.results[mid(ri,mi)];return x&&[x.a,x.b].every(v=>Number.isInteger(v)&&v>=0)})}
function showRound(v){roundView=v;renderRoundTabs()}
function renderRoundTabs(){
 const bar=document.getElementById("roundTabs"),box=document.getElementById("schedule");if(!bar||!box?.querySelectorAll)return;
 const rounds=[...box.querySelectorAll(".round")];
 if(rounds.length<2){bar.hidden=true;rounds.forEach(r=>r.hidden=false);return}
 if(roundView===null||(roundView!=="all"&&roundView>=rounds.length)){const n=LeagueShared.nextUpMatches(state.rounds,state.results,1)[0];roundView=n?n.round-1:rounds.length-1}
 bar.hidden=false;
 bar.innerHTML=state.rounds.map((r,ri)=>`<button type="button" role="tab" class="round-tab${roundDone(ri)?" done":""}" aria-selected="${roundView===ri}" aria-label="รอบ ${ri+1}${roundDone(ri)?" (ครบแล้ว)":""}" data-round="${ri}">${ri+1}</button>`).join("")+`<button type="button" role="tab" class="round-tab all" aria-selected="${roundView==="all"}" data-round="all">ทั้งหมด</button>`;
 rounds.forEach((r,ri)=>r.hidden=roundView!=="all"&&roundView!==ri);
 bar.querySelectorAll("[data-round]").forEach(b=>b.onclick=()=>showRound(b.dataset.round==="all"?"all":Number(b.dataset.round)));
}
// Every meeting so far, told from the side that leads; while this Season's meeting is unplayed the last loser gets a ศึกล้างตา stamp.
function rivalryStrip(pair){const r=BANTER?.matchRivalry(state,pair);if(!r)return"";const nm=id=>profile(id)?.displayName||id;const revenge=r.revengeBy?`${BANTER.stampHtml({...BANTER.REVENGE,fact:`${nm(r.revengeBy)} แพ้นัดล่าสุด (S${r.last.season})`})}<small>${esc(nm(r.revengeBy))} ขอแก้มือ</small>`:"";return `<span>${esc(BANTER.rivalryLine(r,pair[0],pair[1],nm))}</span>${revenge}`}
function updateFromInputs(id){if(!isAdmin())return;const a=document.getElementById(id+"a").value,b=document.getElementById(id+"b").value;if(a===""&&b==="")delete state.results[id];else state.results[id]={a:a===""?null:Number(a),b:b===""?null:Number(b)};saveState();updateLabels();calc();renderNextUp();renderRoundTabs();offerShare(id)}
// "คิวต่อไป": the next 1-2 unplayed matches as a mini fight bill, each with a button down to its match card.
function renderNextUp(){
 const box=document.getElementById("nextUp");if(!box)return;
 const next=LeagueShared.nextUpMatches(state.rounds,state.results,2);
 if(!totalMatches()){box.hidden=true;box.innerHTML="";return}
 box.hidden=false;
 const name=id=>profile(id)?.displayName||id;
 box.innerHTML=`<div class="next-up-head"><h2>คิวต่อไป</h2></div>`+(next.length?`<ol class="next-up-list">${next.map((m,i)=>`<li class="next-up-item"><div class="next-up-tag">${i?"เตรียมตัว":"ขึ้นโต๊ะ"} • รอบ ${m.round}</div><div class="next-up-bill"><b class="nu-red">${esc(name(m.pair[0]))}</b><span class="nu-vs" aria-label="พบ">VS</span><b class="nu-blue">${esc(name(m.pair[1]))}</b></div><button type="button" class="secondary next-up-go" data-goto="${esc(m.id)}" aria-label="ไปที่คู่ ${esc(name(m.pair[0]))} พบ ${esc(name(m.pair[1]))}">ไปที่คู่นี้</button></li>`).join("")}</ol>`:`<div class="next-up-done">แข่งครบทุกคู่แล้ว${isAdmin()?" • กดจบซีซั่นที่ตารางคะแนน":" • รอแอดมินจบซีซั่น"}</div>`);
 box.querySelectorAll("[data-goto]").forEach(btn=>btn.onclick=()=>{const ri=Number(/^r(\d+)m/.exec(btn.dataset.goto)?.[1]);if(roundView!=="all"&&Number.isInteger(ri)&&ri!==roundView)showRound(ri);const card=document.getElementById(`match-${btn.dataset.goto}`);if(!card)return;LeagueShared.smoothScrollTo(card);card.classList.remove("cued");void card.offsetWidth;card.classList.add("cued");setTimeout(()=>card.classList.remove("cued"),1800)});
}
// The "ชนะ" stamp is struck (with stamp-sound.js's thunk and buzz) only when a match's result changes while the page is open (typed here or synced from a friend),
// never for results that were already there when the page loaded.
const stampSeen=new Map();
function strikeStamp(row,id,w){const prev=stampSeen.get(id);stampSeen.set(id,w);if(prev===undefined||prev===w||w==="d"||!row.classList)return;row.classList.remove("stamp-in");void row.offsetWidth;row.classList.add("stamp-in");if(typeof StampSound!=="undefined")StampSound.strike?.();const done=e=>{if(e.target!==row||e.animationName!=="billJolt")return;row.classList.remove("stamp-in");row.removeEventListener("animationend",done)};row.addEventListener("animationend",done)}
function updateLabels(){state.rounds.forEach((r,ri)=>r.m.forEach((pair,mi)=>{const id=mid(ri,mi),x=state.results[id],el=document.getElementById(id+"s"),riv=document.getElementById(id+"r");if(riv){riv.innerHTML=rivalryStrip(pair);riv.hidden=!riv.innerHTML}if(!el)return;const row=el.closest?.(".match");if(!x||!valid(x.a)||!valid(x.b)){el.textContent="ยังไม่กรอกผล";if(row)delete row.dataset.win;stampSeen.set(id,"");return}if(row){const w=x.a>x.b?"a":x.b>x.a?"b":"d";row.dataset.win=w;strikeStamp(row,id,w)}const an=profile(pair[0])?.displayName||pair[0],bn=profile(pair[1])?.displayName||pair[1];el.textContent=x.a>x.b?`${an} ชนะ ${x.a}-${x.b}`:x.b>x.a?`${bn} ชนะ ${x.b}-${x.a}`:`เสมอ ${x.a}-${x.b}`}) ) }
// Once a typed score has settled for a few seconds, offer the result poster in a pill above the tab bar (one at a time).
let shareOfferTimer=0;
function offerShare(id){clearTimeout(shareOfferTimer);document.querySelector(".share-offer")?.remove();const x=state.results[id];if(!x||![x.a,x.b].every(v=>Number.isInteger(v)&&v>=0)||x.a===x.b&&x.a===0||!window.SharePoster)return;
 shareOfferTimer=setTimeout(()=>{const [,ri,mi]=/^r(\d+)m(\d+)$/.exec(id)||[],pair=state.rounds[ri]?.m?.[mi],now=state.results[id];if(!pair||!now||now.a!==x.a||now.b!==x.b)return;
  const n=k=>profile(k)?.displayName||k,pill=document.createElement("div");pill.className="share-offer";
  pill.innerHTML=`<button type="button" class="share-offer-go"><span>${esc(n(pair[0]))} ${x.a}–${x.b} ${esc(n(pair[1]))}</span><b>แชร์ผลเข้า LINE</b></button><button type="button" class="share-offer-x" aria-label="ปิด">×</button>`;
  pill.querySelector(".share-offer-go").onclick=e=>{shareMatchPoster(id,e.currentTarget);setTimeout(()=>pill.remove(),400)};
  pill.querySelector(".share-offer-x").onclick=()=>pill.remove();
  document.body.appendChild(pill);setTimeout(()=>pill.remove(),15000)},3500)}
function shareMatchPoster(id,btn){const [,ri,mi]=/^r(\d+)m(\d+)$/.exec(id)||[],pair=state.rounds[ri]?.m?.[mi],x=state.results[id];if(!pair||!x||!window.SharePoster)return;window.SharePoster.shareMatch({id,season:state.currentSeason,aId:pair[0],bId:pair[1],aName:profile(pair[0])?.displayName||pair[0],bName:profile(pair[1])?.displayName||pair[1],a:x.a,b:x.b},btn)}
function shareStandingsPoster(btn){if(!window.SharePoster)return;const {arr,played}=standingsData();window.SharePoster.shareStandings({season:state.currentSeason,played,total:totalMatches(),rows:arr.map(x=>({name:profile(x.id)?.displayName||x.id,pts:x.pts,w:x.w,d:x.d,l:x.l,gd:x.gd}))},btn)}
function standingsData(){const s={};state.seasonPlayerIds.forEach(id=>s[id]={id,p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0});let played=0;state.rounds.forEach((r,ri)=>r.m.forEach((pair,mi)=>{const x=state.results[mid(ri,mi)];if(!x||!valid(x.a)||!valid(x.b))return;played++;const A=s[pair[0]],B=s[pair[1]];if(!A||!B)return;A.p++;B.p++;A.gf+=x.a;A.ga+=x.b;B.gf+=x.b;B.ga+=x.a;if(x.a>x.b){A.w++;A.pts+=3;B.l++}else if(x.b>x.a){B.w++;B.pts+=3;A.l++}else{A.d++;B.d++;A.pts++;B.pts++}}));Object.values(s).forEach(x=>x.gd=x.gf-x.ga);const arr=Object.values(s).sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf||b.w-a.w||(profile(a.id)?.displayName||"").localeCompare(profile(b.id)?.displayName||"","th"));return {arr,played}}
function calc(){const {arr,played}=standingsData(),badges=BANTER?BANTER.streakBadges(BANTER.seasonMatches(state.rounds,state.results),state.seasonPlayerIds):{};document.getElementById("standings").innerHTML=arr.map((x,i)=>`<tr><td>${i+1}</td><td class="name${i===0&&played?" champ":""}">${esc(profile(x.id)?.displayName||x.id)}${BANTER?BANTER.stampHtml(badges[x.id]):""}</td><td>${x.p}</td><td>${x.w}</td><td>${x.d}</td><td>${x.l}</td><td>${x.gf}</td><td>${x.ga}</td><td>${x.gd>0?"+":""}${x.gd}</td><td class="points">${x.pts}</td></tr>`).join("");document.getElementById("played").textContent=played;document.getElementById("remain").textContent=totalMatches()-played;document.getElementById("leader").textContent=played?(profile(arr[0]?.id)?.displayName||"-"):"-";const btn=document.getElementById("finishSeason");btn.disabled=!isAdmin()||played!==totalMatches();document.getElementById("finishHint").textContent=played===totalMatches()?(isAdmin()?"พร้อมบันทึกแรงค์":"รอแอดมินจบซีซั่น"):`เหลือ ${totalMatches()-played} แมตช์`}
const RP=[100,80,65,50,40,30,20,10,5];const tier=rp=>rp>=1000?"มาสเตอร์":rp>=700?"เพชร":rp>=450?"แพลทินัม":rp>=250?"ทอง":rp>=100?"เงิน":"ทองแดง";
function rankingProfiles(){const m={};Object.keys(state.profiles).forEach(id=>m[id]={id,rp:0,seasons:0,titles:0,best:null});state.rankHistory.forEach(season=>(season.standings||[]).forEach(row=>{const id=row.userId||Object.keys(state.profiles).find(k=>state.profiles[k].displayName===row.name);if(!id)return;if(!m[id])m[id]={id,rp:0,seasons:0,titles:0,best:null};m[id].rp+=row.rpAward||0;m[id].seasons++;m[id].best=m[id].best===null?row.rank:Math.min(m[id].best,row.rank);if(row.rank===1)m[id].titles++}));return Object.values(m).sort((a,b)=>b.rp-a.rp||b.titles-a.titles)}
function renderRanking(){document.getElementById("rankingList").innerHTML=rankingProfiles().filter(x=>x.seasons||state.seasonPlayerIds.includes(x.id)).map((x,i)=>`<div class="rank-row"><div class="rank-pos">${i+1}</div><div><strong>${esc(profile(x.id)?.displayName||x.id)}</strong><div class="tier">${x.seasons} ซีซั่น • ดีสุด ${x.best?`#${esc(x.best)}`:"-"} • ${tier(x.rp)}</div></div><div class="rank-rp">${esc(x.rp)} RP</div></div>`).join("")}
function finishSeason(){if(!isAdmin())return;const {arr,played}=standingsData();if(played!==totalMatches())return;if(!confirm(`จบซีซั่น ${state.currentSeason} และบันทึกแรงค์?`))return;state.rankHistory.push({season:state.currentSeason,finishedAt:new Date().toISOString(),standings:arr.map((x,i)=>({userId:x.id,name:profile(x.id)?.displayName||x.id,rank:i+1,rpAward:RP[i]??5,pts:x.pts,gd:x.gd}))});state.currentSeason++;state.rounds=makeRoundRobin(state.seasonPlayerIds);state.results={};saveState();render()}
function render(){renderHeader();renderRoster();renderSchedule();calc();renderNextUp();renderRanking();document.getElementById("saveBtn").disabled=!isAdmin();document.getElementById("clearScores").disabled=!isAdmin()}
document.getElementById("applyRoster").onclick=applyRoster;document.getElementById("saveBtn").onclick=()=>{if(!isAdmin())return alert("เฉพาะแอดมิน");saveState();alert("บันทึกแล้ว")};document.getElementById("clearScores").onclick=()=>{if(!isAdmin()){alert("เฉพาะแอดมิน");return}if(confirm("ล้างคะแนนทั้งหมด?")){state.results={};saveState();render()}};document.getElementById("finishSeason").onclick=finishSeason;document.getElementById("shareStandingsPoster").onclick=e=>shareStandingsPoster(e.currentTarget);document.getElementById("loginBtn").onclick=login;document.getElementById("loginPin").onkeydown=e=>{if(e.key==="Enter")login()};document.getElementById("logout").onclick=logout;
loadLocal();reconcileSession();renderLogin();render();initCloud();
window.addEventListener("storage",event=>{if(event.key===LeagueShared.SESSION_KEY){reconcileSession();renderLogin();render()}});
document.querySelectorAll('.bottom-nav a[href^="#"]').forEach(link=>link.addEventListener("click",event=>{
 const target=document.querySelector(link.getAttribute("href"));
 if(!target)return;
 event.preventDefault();
 history.replaceState(null,"",link.getAttribute("href"));
 LeagueShared.smoothScrollTo(target);
 document.querySelectorAll('.bottom-nav a[href^="#"]').forEach(item=>item.classList.toggle("active",item===link));
}));
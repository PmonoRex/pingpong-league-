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
const cloudRequest=(method="GET",body=null)=>LeagueShared.cloudRequest("league,updated_at",method,body);
function cloudPayload(){return {uidLeague:state}}
function saveState(){if(!isAdmin())return;saveLocal();if(!cloudReady)return;dirty=true;changeVersion++;setSync("กำลังบันทึก...");clearTimeout(saveTimer);saveTimer=setTimeout(pushCloud,400)}
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
  const rows=await cloudRequest("PATCH",{league:{...(latest?.league||{}),...cloudPayload()},updated_at:now});
  if(!rows?.length)throw new Error("บันทึกไม่สำเร็จ");
  lastCloudUpdate=rows[0]?.updated_at||now;dirty=changeVersion!==startedVersion;saved=true;saveLocal();setSync("ออนไลน์ • บันทึกแล้ว","online");
 }catch(e){setSync("ออฟไลน์ • เก็บในเครื่อง","offline")}finally{cloudSaving=false;if(saved&&dirty)saveTimer=setTimeout(pushCloud,400)}
}
function reconcileSession(){currentUserId=LeagueShared.sessionUserId(state);document.getElementById("auth").classList.toggle("hidden",Boolean(currentUserId))}
async function initCloud(){try{const rows=await cloudRequest(),row=rows[0];cloudReady=true;const remote=row?.league?.uidLeague;if(remote?.profiles){state=remote;saveLocal()}lastCloudUpdate=row?.updated_at||"";reconcileSession();renderLogin();render();setSync("ออนไลน์ • ซิงก์แล้ว","online");setInterval(pullCloud,3000)}catch(e){setSync("ออฟไลน์ • ใช้ข้อมูลในเครื่อง","offline")}}
async function pullCloud(){if(!cloudReady||dirty||cloudSaving)return;try{const rows=await cloudRequest(),row=rows[0];if(!row||row.updated_at===lastCloudUpdate)return;lastCloudUpdate=row.updated_at||"";const remote=row.league?.uidLeague;if(remote?.profiles){state=remote;saveLocal();reconcileSession();renderLogin();render()}}catch(e){}}

function renderLogin(){LeagueShared.renderLoginOptions(document.getElementById("loginUser"),state,currentUserId)}
function login(){const id=document.getElementById("loginUser").value,pin=document.getElementById("loginPin").value;if(!LeagueShared.login(state,id,pin)){alert("PIN ไม่ถูกต้องหรือบัญชีถูกปิดใช้งาน");return}document.getElementById("loginPin").value="";reconcileSession();render()}
function logout(){LeagueShared.logout();reconcileSession();renderLogin();render()}
function renderHeader(){const p=profile(currentUserId);document.getElementById("whoami").textContent=p?.displayName||"-";document.getElementById("adminBadge").style.display=isAdmin()?"inline-flex":"none";document.getElementById("adminLink").style.display=isAdmin()?"inline-flex":"none";document.getElementById("leagueInfo").textContent=`Season ${state.currentSeason} • ${state.seasonPlayerIds.length} คน • ${totalMatches()} แมตช์`}
function renderRoster(){
 const box=document.getElementById("rosterList");const selected=new Set(state.seasonPlayerIds);
 box.innerHTML=activeProfiles().map(p=>`<label class="roster-item ${isAdmin()?"":"locked"}"><input type="checkbox" data-roster="${p.id}" ${selected.has(p.id)?"checked":""} ${isAdmin()?"":"disabled"}><div><strong>${esc(p.displayName)}</strong><small>${p.id}${p.role==="admin"?" • Admin":""}</small></div></label>`).join("");
 document.getElementById("applyRoster").style.display=isAdmin()?"inline-flex":"none";document.getElementById("addAccountLink").style.display=isAdmin()?"inline-flex":"none";
}
function applyRoster(){if(!isAdmin())return;const ids=[...document.querySelectorAll("[data-roster]:checked")].map(x=>x.dataset.roster);if(ids.length<2){alert("ต้องเลือกอย่างน้อย 2 คน");return}if(Object.keys(state.results).length&&!confirm("การเปลี่ยนผู้เล่นจะล้างผล Season ปัจจุบัน ยืนยันหรือไม่?"))return;state.seasonPlayerIds=ids;state.rounds=makeRoundRobin(ids);state.results={};saveState();render()}
function renderSchedule(){
 const box=document.getElementById("schedule");box.innerHTML="";
 state.rounds.forEach((r,ri)=>{const sec=document.createElement("div");sec.className="round";sec.innerHTML=`<div class="rh"><b>รอบ ${ri+1}</b><span class="rest">${r.rest?`พัก: ${esc(profile(r.rest)?.displayName||r.rest)}`:"แข่งครบ"}</span></div>`;
  r.m.forEach((pair,mi)=>{const id=mid(ri,mi),x=state.results[id]||{},a=profile(pair[0]),b=profile(pair[1]);const row=document.createElement("div");row.className="match";row.innerHTML=`<div class="pair"><b class="left">${esc(a?.displayName||pair[0])}</b><div class="score-control"><button class="minus" ${isAdmin()?"":"disabled"} data-score="${id}:a:-1">−</button><input id="${id}a" inputmode="numeric" type="number" min="0" ${isAdmin()?"":"disabled"} value="${x.a??""}"><button class="plus" ${isAdmin()?"":"disabled"} data-score="${id}:a:1">+</button></div><span class="vs">VS</span><div class="score-control"><button class="minus" ${isAdmin()?"":"disabled"} data-score="${id}:b:-1">−</button><input id="${id}b" inputmode="numeric" type="number" min="0" ${isAdmin()?"":"disabled"} value="${x.b??""}"><button class="plus" ${isAdmin()?"":"disabled"} data-score="${id}:b:1">+</button></div><b>${esc(b?.displayName||pair[1])}</b></div><div class="status" id="${id}s"></div>`;sec.appendChild(row)});box.appendChild(sec)});
 box.querySelectorAll("[data-score]").forEach(btn=>btn.onclick=()=>{if(!isAdmin())return;const [id,side,delta]=btn.dataset.score.split(":");const inp=document.getElementById(id+side),v=inp.value===""?0:Number(inp.value);inp.value=Math.max(0,v+Number(delta));updateFromInputs(id)});
 state.rounds.forEach((r,ri)=>r.m.forEach((p,mi)=>["a","b"].forEach(side=>document.getElementById(mid(ri,mi)+side).oninput=()=>updateFromInputs(mid(ri,mi)))));
 updateLabels();
}
function updateFromInputs(id){if(!isAdmin())return;const a=document.getElementById(id+"a").value,b=document.getElementById(id+"b").value;if(a===""&&b==="")delete state.results[id];else state.results[id]={a:a===""?null:Number(a),b:b===""?null:Number(b)};saveState();updateLabels();calc()}
function updateLabels(){state.rounds.forEach((r,ri)=>r.m.forEach((pair,mi)=>{const id=mid(ri,mi),x=state.results[id],el=document.getElementById(id+"s");if(!el)return;if(!x||!valid(x.a)||!valid(x.b)){el.textContent="ยังไม่กรอกผล";return}const an=profile(pair[0])?.displayName||pair[0],bn=profile(pair[1])?.displayName||pair[1];el.textContent=x.a>x.b?`${an} ชนะ ${x.a}-${x.b}`:x.b>x.a?`${bn} ชนะ ${x.b}-${x.a}`:`เสมอ ${x.a}-${x.b}`}) ) }
function standingsData(){const s={};state.seasonPlayerIds.forEach(id=>s[id]={id,p:0,w:0,d:0,l:0,gf:0,ga:0,gd:0,pts:0});let played=0;state.rounds.forEach((r,ri)=>r.m.forEach((pair,mi)=>{const x=state.results[mid(ri,mi)];if(!x||!valid(x.a)||!valid(x.b))return;played++;const A=s[pair[0]],B=s[pair[1]];if(!A||!B)return;A.p++;B.p++;A.gf+=x.a;A.ga+=x.b;B.gf+=x.b;B.ga+=x.a;if(x.a>x.b){A.w++;A.pts+=3;B.l++}else if(x.b>x.a){B.w++;B.pts+=3;A.l++}else{A.d++;B.d++;A.pts++;B.pts++}}));Object.values(s).forEach(x=>x.gd=x.gf-x.ga);const arr=Object.values(s).sort((a,b)=>b.pts-a.pts||b.gd-a.gd||b.gf-a.gf||b.w-a.w||(profile(a.id)?.displayName||"").localeCompare(profile(b.id)?.displayName||"","th"));return {arr,played}}
function calc(){const {arr,played}=standingsData();document.getElementById("standings").innerHTML=arr.map((x,i)=>`<tr><td>${i+1}</td><td class="name">${i===0&&played?"👑 ":""}${esc(profile(x.id)?.displayName||x.id)}</td><td>${x.p}</td><td>${x.w}</td><td>${x.d}</td><td>${x.l}</td><td>${x.gf}</td><td>${x.ga}</td><td>${x.gd>0?"+":""}${x.gd}</td><td class="points">${x.pts}</td></tr>`).join("");document.getElementById("played").textContent=played;document.getElementById("remain").textContent=totalMatches()-played;document.getElementById("leader").textContent=played?(profile(arr[0]?.id)?.displayName||"-"):"-";const btn=document.getElementById("finishSeason");btn.disabled=!isAdmin()||played!==totalMatches();document.getElementById("finishHint").textContent=played===totalMatches()?(isAdmin()?"พร้อมบันทึกแรงค์":"รอ Admin จบ Season"):`เหลือ ${totalMatches()-played} แมตช์`}
const RP=[100,80,65,50,40,30,20,10,5];const tier=rp=>rp>=1000?"Master":rp>=700?"Diamond":rp>=450?"Platinum":rp>=250?"Gold":rp>=100?"Silver":"Bronze";
function rankingProfiles(){const m={};Object.keys(state.profiles).forEach(id=>m[id]={id,rp:0,seasons:0,titles:0,best:null});state.rankHistory.forEach(season=>(season.standings||[]).forEach(row=>{const id=row.userId||Object.keys(state.profiles).find(k=>state.profiles[k].displayName===row.name);if(!id)return;if(!m[id])m[id]={id,rp:0,seasons:0,titles:0,best:null};m[id].rp+=row.rpAward||0;m[id].seasons++;m[id].best=m[id].best===null?row.rank:Math.min(m[id].best,row.rank);if(row.rank===1)m[id].titles++}));return Object.values(m).sort((a,b)=>b.rp-a.rp||b.titles-a.titles)}
function renderRanking(){document.getElementById("rankingList").innerHTML=rankingProfiles().filter(x=>x.seasons||state.seasonPlayerIds.includes(x.id)).map((x,i)=>`<div class="rank-row"><div class="rank-pos">${i+1}</div><div><strong>${esc(profile(x.id)?.displayName||x.id)}</strong><div class="tier">${x.seasons} Season • ดีสุด ${x.best?`#${x.best}`:"-"} • ${tier(x.rp)}</div></div><div class="rank-rp">${x.rp} RP</div></div>`).join("")}
function finishSeason(){if(!isAdmin())return;const {arr,played}=standingsData();if(played!==totalMatches())return;if(!confirm(`จบ Season ${state.currentSeason} และบันทึกแรงค์?`))return;state.rankHistory.push({season:state.currentSeason,finishedAt:new Date().toISOString(),standings:arr.map((x,i)=>({userId:x.id,name:profile(x.id)?.displayName||x.id,rank:i+1,rpAward:RP[i]??5,pts:x.pts,gd:x.gd}))});state.currentSeason++;state.rounds=makeRoundRobin(state.seasonPlayerIds);state.results={};saveState();render()}
function render(){renderHeader();renderRoster();renderSchedule();calc();renderRanking();document.getElementById("saveBtn").disabled=!isAdmin();document.getElementById("clearScores").disabled=!isAdmin()}
document.getElementById("applyRoster").onclick=applyRoster;document.getElementById("saveBtn").onclick=()=>{if(!isAdmin())return alert("เฉพาะ Admin");saveState();alert("บันทึกแล้ว")};document.getElementById("clearScores").onclick=()=>{if(!isAdmin()){alert("เฉพาะ Admin");return}if(confirm("ล้างคะแนนทั้งหมด?")){state.results={};saveState();render()}};document.getElementById("finishSeason").onclick=finishSeason;document.getElementById("loginBtn").onclick=login;document.getElementById("loginPin").onkeydown=e=>{if(e.key==="Enter")login()};document.getElementById("logout").onclick=logout;
loadLocal();reconcileSession();renderLogin();render();initCloud();
window.addEventListener("storage",event=>{if(event.key===LeagueShared.SESSION_KEY){reconcileSession();renderLogin();render()}});

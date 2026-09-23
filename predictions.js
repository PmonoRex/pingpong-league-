const LEAGUE_KEY="pp_league_v7_uid",PRED_KEY="pp_predictions_v3_uid";
const SUPABASE_URL="https://gqlfqoeejgtjpsdvngbh.supabase.co",SUPABASE_KEY="sb_publishable_A26ocTxGPkLry2Y2iBY2mA_kTWNRI4Z",CLOUD_ENDPOINT=`${SUPABASE_URL}/rest/v1/app_state?id=eq.main`;
let league=loadLeague(),pred=loadPred(),currentUserId=localStorage.getItem("pp_user_id")||"",cloudReady=false,lastCloudUpdate="";
const esc=v=>String(v).replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[ch]));
const profile=id=>league.profiles?.[id],isAdmin=()=>profile(currentUserId)?.role==="admin",isDealer=()=>Boolean(currentUserId&&pred.dealerId&&currentUserId===pred.dealerId),canManageMarket=()=>isAdmin()||isDealer(),valid=v=>Number.isInteger(v)&&v>=0,mid=(r,m)=>`r${r}m${m}`;
function loadLeague(){try{return JSON.parse(localStorage.getItem(LEAGUE_KEY)||"null")||{profiles:{},seasonPlayerIds:[],rounds:[],results:{}}}catch(e){return {profiles:{},seasonPlayerIds:[],rounds:[],results:{}}}}
function freshPred(){return {dealerId:null,markets:{},bets:[],nextBetId:1}}
function loadPred(){try{return Object.assign(freshPred(),JSON.parse(localStorage.getItem(PRED_KEY)||"null")||{})}catch(e){return freshPred()}}
function savePred(){localStorage.setItem(PRED_KEY,JSON.stringify(pred));if(cloudReady)cloudRequest("PATCH",{predictions:{uidPredictions:pred},updated_at:new Date().toISOString()}).catch(()=>{})}
async function cloudRequest(method="GET",body=null){const o={method,headers:{apikey:SUPABASE_KEY,Authorization:`Bearer ${SUPABASE_KEY}`}};if(body){o.headers["Content-Type"]="application/json";o.headers.Prefer="return=representation";o.body=JSON.stringify(body)}const r=await fetch(`${CLOUD_ENDPOINT}&select=league,predictions,updated_at`,o);if(!r.ok)throw new Error(r.status);return r.json()}
function setSync(t,s=""){const e=document.getElementById("syncStatus");e.textContent=t;e.className=`sync ${s}`}
async function initCloud(){try{const rows=await cloudRequest(),row=rows[0];cloudReady=true;const remote=row?.league?.uidLeague;if(remote?.profiles){league=remote;localStorage.setItem(LEAGUE_KEY,JSON.stringify(league))}const rp=row?.predictions?.uidPredictions;if(rp){pred=Object.assign(freshPred(),rp);localStorage.setItem(PRED_KEY,JSON.stringify(pred))}lastCloudUpdate=row?.updated_at||"";renderLogin();render();setSync("ออนไลน์ • ซิงก์แล้ว","online");setInterval(pull,3000)}catch(e){setSync("ออฟไลน์ • ใช้ข้อมูลในเครื่อง","offline")}}
async function pull(){try{const rows=await cloudRequest(),row=rows[0];if(!row||row.updated_at===lastCloudUpdate)return;lastCloudUpdate=row.updated_at||"";const remote=row.league?.uidLeague;if(remote?.profiles){league=remote;localStorage.setItem(LEAGUE_KEY,JSON.stringify(league))}const rp=row.predictions?.uidPredictions;if(rp){pred=Object.assign(freshPred(),rp);localStorage.setItem(PRED_KEY,JSON.stringify(pred))}renderLogin();render()}catch(e){}}
function activeProfiles(){return Object.values(league.profiles||{}).filter(p=>p.active!==false)}
function renderLogin(){const sel=document.getElementById("loginUser"),list=activeProfiles();sel.innerHTML=list.length?list.map(p=>`<option value="${p.id}">${esc(p.displayName)}${p.role==="admin"?" • Admin":""}</option>`).join(""):'<option value="">ไม่มีบัญชีผู้เล่น</option>';if(currentUserId&&profile(currentUserId))sel.value=currentUserId}
function login(){const id=document.getElementById("loginUser").value,pin=document.getElementById("loginPin").value;if(!id||!profile(id)){alert("ยังไม่มีบัญชีผู้เล่น กรุณาให้ Admin เพิ่มบัญชีก่อน");return}if(profile(id).pin!==pin){alert("PIN ไม่ถูกต้อง");return}currentUserId=id;localStorage.setItem("pp_user_id",id);document.getElementById("auth").classList.add("hidden");render()}
function logout(){currentUserId="";localStorage.removeItem("pp_user_id");document.getElementById("auth").classList.remove("hidden");renderLogin()}
function allMatches(){const out=[];(league.rounds||[]).forEach((r,ri)=>r.m.forEach((pair,mi)=>out.push({id:mid(ri,mi),ri,mi,pair,score:(league.results||{})[mid(ri,mi)]})));return out}
function hasResult(m){return m.score&&valid(m.score.a)&&valid(m.score.b)}
function outcome(match,market){if(!hasResult(match))return null;let a=match.score.a,b=match.score.b;if(market.favoriteId===match.pair[0])a-=market.handicap;else b-=market.handicap;if(a===b)return {type:"push"};return {type:"win",winnerId:a>b?match.pair[0]:match.pair[1]}}
function credits(v){return Number(v||0).toLocaleString("th-TH")}

const RP_TABLE=[100,80,65,50,40,30,20,10,5];
function playerRankProfile(userId){
  const seasons=(league.rankHistory||[]).map(s=>{
    const row=(s.standings||[]).find(r=>r.userId===userId || (!r.userId && r.name===profile(userId)?.displayName));
    return row?{season:s.season,rank:row.rank,rp:row.rpAward??RP_TABLE[row.rank-1]??5,date:s.finishedAt}:null;
  }).filter(Boolean);
  const rp=seasons.reduce((sum,x)=>sum+(Number(x.rp)||0),0);
  const titles=seasons.filter(x=>x.rank===1).length;
  const best=seasons.length?Math.min(...seasons.map(x=>x.rank)):null;
  const avg=seasons.length?seasons.reduce((s,x)=>s+x.rank,0)/seasons.length:null;
  return {rp,titles,best,avg,seasons};
}
function openProfile(userId){
  const p=profile(userId);if(!p)return;
  const r=playerRankProfile(userId);
  document.getElementById("profileName").textContent=p.displayName;
  document.getElementById("profileMeta").textContent=`${p.role==="admin"?"Admin":"Player"} • ${p.id}`;
  document.getElementById("profileRp").textContent=r.rp;
  document.getElementById("profileTitles").textContent=r.titles;
  document.getElementById("profileBest").textContent=r.best?`#${r.best}`:"-";
  document.getElementById("profileAvg").textContent=r.avg?r.avg.toFixed(2):"-";
  document.getElementById("profileHistory").innerHTML=r.seasons.length?r.seasons.slice().reverse().map(x=>`<div class="profile-history-row"><div><b>S${x.season}</b><br><small>${x.date?new Date(x.date).toLocaleDateString("th-TH"):""}</small></div><div><b>อันดับ #${x.rank}</b><br><small>${p.displayName}</small></div><div class="positive">+${x.rp} RP</div></div>`).join(""):'<div class="empty">ยังไม่มีประวัติ Season</div>';
  document.getElementById("profileBackdrop").classList.add("open");
  document.body.style.overflow="hidden";
}
function closeProfile(){document.getElementById("profileBackdrop").classList.remove("open");document.body.style.overflow=""}
function bindProfileLinks(){
  document.querySelectorAll("[data-profile]").forEach(el=>{
    if(el.dataset.bound)return;el.dataset.bound="1";
    el.addEventListener("click",()=>openProfile(el.dataset.profile));
  });
}
function renderDealerSelect(){
  if(!isAdmin())return;
  const sel=document.getElementById("dealerSelect");if(!sel)return;
  const current=pred.dealerId;
  sel.innerHTML=activeProfiles().map(p=>`<option value="${p.id}">${esc(p.displayName)}${p.role==="admin"?" • Admin":""}</option>`).join("");
  if(current&&profile(current))sel.value=current;
  const hint=document.getElementById("dealerHint");
  if(hint)hint.textContent=current&&profile(current)?`เจ้ามือปัจจุบัน: ${profile(current).displayName}`:"ยังไม่ได้เลือกเจ้ามือ";
}

function renderHeader(){const p=profile(currentUserId);document.getElementById("whoami").textContent=p?.displayName||"-";document.getElementById("adminBadge").classList.toggle("hidden",!isAdmin());document.getElementById("adminLink").style.display=isAdmin()?"inline-flex":"none";if(!pred.dealerId&&isAdmin())pred.dealerId=currentUserId;document.getElementById("dealerName").innerHTML=pred.dealerId&&profile(pred.dealerId)?`<button type="button" class="profile-link" data-profile="${pred.dealerId}">${esc(profile(pred.dealerId).displayName)}</button>`:"ยังไม่ตั้ง"}
function renderSummary(){
 const invested=pred.bets.filter(b=>b.userId===currentUserId).reduce((s,b)=>s+b.stake,0);
 document.getElementById("invested").textContent=credits(invested);
 document.getElementById("pending").textContent=pred.bets.filter(b=>b.userId===currentUserId&&b.status==="pending").length;
 const currentIsDealer=currentUserId===pred.dealerId;
 document.getElementById("dealerPanel").classList.remove("hidden");
 document.getElementById("bettingPanel").classList.toggle("hidden",currentIsDealer);
 const dealerNav=document.getElementById("dealerNav");
 if(dealerNav) dealerNav.style.display="flex";
 document.body.classList.toggle("is-admin",isAdmin());document.body.classList.toggle("can-manage-market",canManageMarket());
 const publicDealer=document.getElementById("dealerCurrentPublic");
 if(publicDealer) publicDealer.innerHTML=pred.dealerId&&profile(pred.dealerId)
   ? `<button type="button" class="profile-link" data-profile="${pred.dealerId}">${esc(profile(pred.dealerId).displayName)}</button>`
   : "ยังไม่ได้ตั้ง";
}
function marketDesc(m,market){return `${profile(market.favoriteId)?.displayName||"-"} ต่อ ${market.handicap} ลูก`}
function renderDealer(){const box=document.getElementById("dealerMarkets");if(!box||!canManageMarket())return;box.innerHTML="";allMatches().forEach(m=>{const market=pred.markets[m.id]||{favoriteId:m.pair[0],handicap:.5,open:false};const c=document.createElement("div");c.className="market";c.innerHTML=`<div class="market-head"><div><div class="market-title">รอบ ${m.ri+1} • ${esc(profile(m.pair[0])?.displayName||m.pair[0])} vs ${esc(profile(m.pair[1])?.displayName||m.pair[1])}</div><div class="handicap">${esc(marketDesc(m,market))}</div></div><span class="tag ${market.open&&!hasResult(m)?"":"closed"}">${hasResult(m)?"มีผลแล้ว":market.open?"เปิดรับ":"ปิดรับ"}</span></div><div class="market-controls"><div class="field"><label>ผู้ต่อ</label><select id="fav-${m.id}"><option value="${m.pair[0]}">${esc(profile(m.pair[0])?.displayName||m.pair[0])}</option><option value="${m.pair[1]}">${esc(profile(m.pair[1])?.displayName||m.pair[1])}</option></select></div><div class="field"><label>แต้มต่อ</label><input id="hcp-${m.id}" type="number" min="0" step=".5" value="${market.handicap}"></div><div class="field"><label>สถานะ</label><select id="open-${m.id}"><option value="1">เปิดรับ</option><option value="0">ปิดรับ</option></select></div></div><div class="actions"><button class="primary" data-save="${m.id}">บันทึกคู่นี้</button></div>`;box.appendChild(c);document.getElementById(`fav-${m.id}`).value=market.favoriteId;document.getElementById(`open-${m.id}`).value=market.open&&!hasResult(m)?"1":"0"});box.querySelectorAll("[data-save]").forEach(b=>b.onclick=()=>saveMarket(b.dataset.save))}
function saveMarket(id){if(!canManageMarket())return alert("เฉพาะ Admin หรือเจ้ามือปัจจุบันเท่านั้น");const m=allMatches().find(x=>x.id===id);if(!m)return;pred.markets[id]={favoriteId:document.getElementById(`fav-${id}`).value,handicap:Number(document.getElementById(`hcp-${id}`).value),open:document.getElementById(`open-${id}`).value==="1"&&!hasResult(m)};savePred();render()}
function renderBetting(){
 const box=document.getElementById("bettingMarkets");box.innerHTML="";
 if(currentUserId===pred.dealerId){
   box.innerHTML='<div class="locked">คุณเป็นเจ้ามือของรอบนี้ จึงไม่สามารถทายผลได้</div>';
   return;
 }
 let n=0;allMatches().forEach(m=>{const market=pred.markets[m.id];if(!market||!market.open||hasResult(m))return;n++;const own=m.pair.includes(currentUserId),existing=pred.bets.find(b=>b.matchId===m.id&&b.userId===currentUserId);const c=document.createElement("div");c.className="market";let controls=own?'<div class="locked">คุณเป็นผู้เล่นในคู่นี้ จึงทายไม่ได้</div>':existing?`<div class="locked">ทายแล้ว: ${esc(profile(existing.sideId)?.displayName||existing.sideId)} • ${credits(existing.stake)}</div>`:`<div class="bet-row"><select id="side-${m.id}"><option value="${m.pair[0]}">${esc(profile(m.pair[0])?.displayName||m.pair[0])}</option><option value="${m.pair[1]}">${esc(profile(m.pair[1])?.displayName||m.pair[1])}</option></select><input id="stake-${m.id}" type="number" min="1" inputmode="numeric" placeholder="ยอด"><button class="green" data-bet="${m.id}">ยืนยัน</button></div><div class="quick"><button data-q="${m.id}:10">+10</button><button data-q="${m.id}:50">+50</button><button data-q="${m.id}:100">+100</button><button data-q="${m.id}:500">+500</button></div>`;c.innerHTML=`<div class="market-head"><div><div class="market-title">รอบ ${m.ri+1} • ${esc(profile(m.pair[0])?.displayName||m.pair[0])} vs ${esc(profile(m.pair[1])?.displayName||m.pair[1])}</div><div class="handicap">${esc(marketDesc(m,market))}</div></div><span class="tag">เปิดรับ</span></div>${controls}`;box.appendChild(c)});if(!n)box.innerHTML='<div class="empty">ยังไม่มีคู่ที่เปิดให้ทาย</div>';box.querySelectorAll("[data-bet]").forEach(b=>b.onclick=()=>placeBet(b.dataset.bet));box.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{const [id,a]=b.dataset.q.split(":");const e=document.getElementById(`stake-${id}`);e.value=(Number(e.value)||0)+Number(a)})}
function placeBet(id){
 const m=allMatches().find(x=>x.id===id),market=pred.markets[id];
 if(!m||!market?.open)return;
 if(currentUserId===pred.dealerId)return alert("เจ้ามือไม่สามารถทายผลได้");
 if(m.pair.includes(currentUserId))return alert("ทายคู่ตัวเองไม่ได้");const sideId=document.getElementById(`side-${id}`).value,stake=Number(document.getElementById(`stake-${id}`).value);if(!Number.isInteger(stake)||stake<=0)return alert("กรอกยอดให้ถูกต้อง");pred.bets.push({id:pred.nextBetId++,matchId:id,userId:currentUserId,sideId,stake,status:"pending",net:0,createdAt:new Date().toISOString()});savePred();render()}
function saveDealer(){
 if(!isAdmin())return alert("เฉพาะ Admin เท่านั้น");
 const id=document.getElementById("dealerSelect").value;
 if(!id||!profile(id))return;
 if(pred.bets.some(b=>b.status==="pending") && pred.dealerId && pred.dealerId!==id){
   if(!confirm("มีรายการทายที่ยังรอผลอยู่ เปลี่ยนเจ้ามือจะมีผลต่อการสรุปยอด ยืนยันหรือไม่?"))return;
 }
 pred.dealerId=id;savePred();render();alert(`ตั้ง ${profile(id).displayName} เป็นเจ้ามือแล้ว`);
}
function settleAll(){if(!canManageMarket())return alert("เฉพาะ Admin หรือเจ้ามือปัจจุบันเท่านั้น");let count=0;pred.bets.forEach(b=>{if(b.status!=="pending")return;const m=allMatches().find(x=>x.id===b.matchId),market=pred.markets[b.matchId],r=m&&market?outcome(m,market):null;if(!r)return;if(r.type==="push"){b.status="push";b.net=0}else if(r.winnerId===b.sideId){b.status="won";b.net=b.stake}else{b.status="lost";b.net=-b.stake}count++});savePred();render();alert(count?`คำนวณแล้ว ${count} รายการ`:"ยังไม่มีรายการพร้อมคำนวณ")}
function renderSettlement(){let receive=0,pay=0;const rows=activeProfiles().filter(p=>p.id!==pred.dealerId).map(p=>{const bs=pred.bets.filter(b=>b.userId===p.id&&b.status!=="pending"),cost=bs.reduce((s,b)=>s+b.stake,0),won=bs.filter(b=>b.status==="won").reduce((s,b)=>s+b.stake,0),lost=bs.filter(b=>b.status==="lost").reduce((s,b)=>s+b.stake,0),net=won-lost;receive+=lost;pay+=won;return `<tr><td><button type="button" class="profile-link" data-profile="${p.id}">${esc(p.displayName)}</button></td><td>${credits(cost)}</td><td>${credits(won)}</td><td>${credits(lost)}</td><td class="${net>0?"positive":net<0?"negative":""}">${net>0?"+":""}${credits(net)}</td></tr>`}).join("");document.getElementById("dealerReceives").textContent=credits(receive);document.getElementById("dealerPays").textContent=credits(pay);const net=receive-pay,e=document.getElementById("dealerNet");e.textContent=`${net>0?"+":""}${credits(net)}`;e.className=net>0?"positive":net<0?"negative":"";document.getElementById("settlement").innerHTML=rows||'<tr><td colspan="5" class="empty">ยังไม่มีข้อมูล</td></tr>'}
function statusText(s){return {pending:"รอผล",won:"ชนะ",lost:"แพ้",push:"คืนยอด"}[s]||s}
function renderHistory(){const list=canManageMarket()?pred.bets:pred.bets.filter(b=>b.userId===currentUserId);document.getElementById("history").innerHTML=list.slice().reverse().map(b=>{const m=allMatches().find(x=>x.id===b.matchId),pair=m?`${profile(m.pair[0])?.displayName}–${profile(m.pair[1])?.displayName}`:"ตารางเดิม";return `<tr><td>${b.id}</td><td><button type="button" class="profile-link" data-profile="${b.userId}">${esc(profile(b.userId)?.displayName||b.userId)}</button></td><td>${esc(pair)}</td><td>${esc(profile(b.sideId)?.displayName||b.sideId)}</td><td>${credits(b.stake)}</td><td>${statusText(b.status)}</td><td class="${b.net>0?"positive":b.net<0?"negative":""}">${b.status==="pending"?"–":`${b.net>0?"+":""}${credits(b.net)}`}</td></tr>`}).join("")||'<tr><td colspan="7" class="empty">ยังไม่มีประวัติ</td></tr>'}
function render(){
 renderHeader();renderSummary();renderDealerSelect();renderDealer();renderBetting();renderSettlement();renderHistory();bindProfileLinks();
}
document.getElementById("loginBtn").onclick=login;document.getElementById("loginPin").onkeydown=e=>{if(e.key==="Enter")login()};document.getElementById("logout").onclick=logout;
document.getElementById("settleAll").onclick=settleAll;
document.getElementById("saveDealer").onclick=saveDealer;
document.getElementById("profileClose").onclick=closeProfile;
document.getElementById("profileBackdrop").addEventListener("click",e=>{if(e.target.id==="profileBackdrop")closeProfile()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeProfile()});
renderLogin();if(currentUserId&&profile(currentUserId))document.getElementById("auth").classList.add("hidden");render();initCloud();

const predNavItems=[...document.querySelectorAll(".bottom-nav [data-scroll]")];
predNavItems.forEach(item=>item.addEventListener("click",e=>{
  e.preventDefault();
  const target=document.getElementById(item.dataset.scroll);
  if(!target || target.classList.contains("hidden")){
    return;
  }
  target.scrollIntoView({behavior:"smooth",block:"start"});
}));
if("IntersectionObserver" in window){
  const navObs=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting&&!e.target.classList.contains("hidden")).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(!visible)return;
    predNavItems.forEach(item=>item.classList.toggle("active",item.dataset.scroll===visible.target.id));
  },{rootMargin:"-20% 0px -58% 0px",threshold:[.05,.2,.45]});
  ["bettingPanel","dealerPanel","historySection"].forEach(id=>{const el=document.getElementById(id);if(el)navObs.observe(el)});
}


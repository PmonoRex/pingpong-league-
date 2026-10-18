const LEAGUE_KEY=LeagueShared.LEAGUE_KEY,PRED_KEY=LeagueShared.PRED_KEY;
let league=loadLeague(),pred=loadPred(),currentUserId="",cloudReady=false,lastCloudUpdate="",predSaving=false;
const esc=LeagueShared.escapeHtml;
const marketKey=id=>LeagueShared.marketKey(league.currentSeason,id);
const profile=id=>LeagueShared.profile(league,id),isAdmin=()=>LeagueShared.isAdmin(league,currentUserId),isDealer=()=>LeagueShared.isDealer(league,pred,currentUserId),canManageMarket=()=>LeagueShared.canManageMarket(league,pred,currentUserId),valid=v=>Number.isInteger(v)&&v>=0,mid=(r,m)=>`r${r}m${m}`;
function loadLeague(){return LeagueShared.readLocalLeague()||{profiles:{},seasonPlayerIds:[],rounds:[],results:{}}}
function freshPred(){return {dealerId:null,markets:{},bets:[],nextBetId:1}}
function loadPred(){try{return Object.assign(freshPred(),JSON.parse(localStorage.getItem(PRED_KEY)||"null")||{})}catch(e){return freshPred()}}
async function mutatePred(change){
 if(predSaving)return false;
 predSaving=true;
 try{
  // Someone else saved first (a bet, a score, a market): re-read and re-apply this change to the newer copy, then retry.
  for(let attempt=0;;attempt++){
  const row=(await cloudRequest())[0];
  const freshLeague=row?.league?.uidLeague;
  if(!freshLeague?.profiles)throw new Error("ไม่พบข้อมูลบัญชีล่าสุด");
  league=freshLeague;
  pred=Object.assign(freshPred(),row?.predictions?.uidPredictions||{});
  LeagueShared.saveLocalLeague(league);
  reconcileSession();
  renderLogin();
  if(change()===false){render();return false}
  setSync("กำลังบันทึก…");
  const now=new Date().toISOString();
  const expected=row?.updated_at||"";
  const filter=expected?`updated_at=eq.${encodeURIComponent(expected)}`:"";
  const saved=await cloudRequest("PATCH",{predictions:{...(row.predictions||{}),uidPredictions:pred},updated_at:now},filter);
  if(!saved?.length){
   if(attempt<LeagueShared.LOCK_TRIES-1){setSync("มีคนบันทึกพร้อมกัน • กำลังลองใหม่…");await LeagueShared.lockBackoff(attempt);continue}
   throw new Error("มีคนบันทึกพร้อมกันหลายครั้ง กรุณาลองใหม่อีกครั้ง");
  }
  localStorage.setItem(PRED_KEY,JSON.stringify(pred));
  lastCloudUpdate=saved[0]?.updated_at||now;
  render();setSync("ออนไลน์ • บันทึกแล้ว","online");
  return true;
  }
 }catch(error){league=loadLeague();pred=loadPred();reconcileSession();renderLogin();render();setSync("บันทึกไม่ได้ • โปรดลองใหม่","offline");alert(`บันทึกไม่ได้: ${error.message}`);return false}
 finally{predSaving=false}
}
const cloudRequest=(method="GET",body=null,extraQuery="")=>LeagueShared.cloudRequest("league,predictions,updated_at",method,body,extraQuery);
function setSync(t,s=""){const e=document.getElementById("syncStatus");e.textContent=t;e.className=`sync ${s}`}
function reconcileSession(){currentUserId=LeagueShared.sessionUserId(league);document.getElementById("auth").classList.toggle("hidden",Boolean(currentUserId))}
async function initCloud(){try{const rows=await cloudRequest(),row=rows[0];cloudReady=true;const remote=row?.league?.uidLeague;if(remote?.profiles){league=remote;LeagueShared.saveLocalLeague(league)}const rp=row?.predictions?.uidPredictions;if(rp){pred=Object.assign(freshPred(),rp);localStorage.setItem(PRED_KEY,JSON.stringify(pred))}lastCloudUpdate=row?.updated_at||"";reconcileSession();renderLogin();render();setSync("ออนไลน์ • ซิงก์แล้ว","online");askPinChange();setInterval(pull,3000)}catch(e){setSync("ออฟไลน์ • ใช้ข้อมูลในเครื่อง","offline")}}
// Each poll asks only for updated_at; the whole row is fetched only when it changed.
async function pull(){if(predSaving||document.hidden)return;try{const stamp=(await LeagueShared.cloudRequest("updated_at"))[0];if(predSaving||!stamp||stamp.updated_at===lastCloudUpdate)return;const rows=await cloudRequest(),row=rows[0];if(predSaving||!row||row.updated_at===lastCloudUpdate)return;lastCloudUpdate=row.updated_at||"";const remote=row.league?.uidLeague;if(remote?.profiles){league=remote;LeagueShared.saveLocalLeague(league)}const rp=row.predictions?.uidPredictions;if(rp){pred=Object.assign(freshPred(),rp);localStorage.setItem(PRED_KEY,JSON.stringify(pred))}reconcileSession();renderLogin();render()}catch(e){}}
function activeProfiles(){return LeagueShared.activeProfiles(league)}
function renderLogin(){LeagueShared.renderLoginOptions(document.getElementById("loginUser"),league,currentUserId)}
async function login(){const id=document.getElementById("loginUser").value,pin=document.getElementById("loginPin").value;if(!(await LeagueShared.login(league,id,pin))){alert(loginFailMessage(id));return}document.getElementById("loginPin").value="";reconcileSession();render();askPinChange(pin)}
function loginFailMessage(id){const g=LeagueShared.loginGuardStatus(id);return g.locked?`ใส่ PIN ผิดหลายครั้ง • ลองใหม่ใน ${Math.ceil(g.remainingMs/1000)} วินาที`:"PIN ไม่ถูกต้องหรือบัญชีถูกปิดใช้งาน"}
function askPinChange(knownPin=""){if(typeof PinChange!=="undefined")PinChange.enforce(league,currentUserId,{knownPin,onSaved:()=>pull(),onCancel:logout})}
function logout(){LeagueShared.logout();reconcileSession();renderLogin();render()}
function allMatches(){const out=[];(league.rounds||[]).forEach((r,ri)=>r.m.forEach((pair,mi)=>out.push({id:mid(ri,mi),season:league.currentSeason,ri,mi,pair,score:(league.results||{})[mid(ri,mi)]})));return out}
function hasResult(m){return m.score&&valid(m.score.a)&&valid(m.score.b)}
let creditFmt=null; // one number formatter for every row (building one per call is slow on a phone)
function credits(v){return (creditFmt||=new Intl.NumberFormat("th-TH")).format(Number(v||0))}

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
  document.getElementById("profileMeta").textContent=p.role==="admin"?"แอดมิน":"Player";
  document.getElementById("profileRp").textContent=r.rp;
  document.getElementById("profileTitles").textContent=r.titles;
  document.getElementById("profileBest").textContent=r.best?`#${r.best}`:"-";
  document.getElementById("profileAvg").textContent=r.avg?r.avg.toFixed(2):"-";
  document.getElementById("profileHistory").innerHTML=r.seasons.length?r.seasons.slice().reverse().map(x=>`<div class="profile-history-row"><div><b>S${esc(x.season)}</b><br><small>${x.date?new Date(x.date).toLocaleDateString("th-TH"):""}</small></div><div><b>อันดับ #${esc(x.rank)}</b><br><small>${esc(p.displayName)}</small></div><div class="positive">+${esc(x.rp)} RP</div></div>`).join(""):'<div class="empty">ยังไม่มีประวัติซีซั่น</div>';
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
  sel.innerHTML=activeProfiles().map(p=>`<option value="${esc(p.id)}">${esc(p.displayName)}${p.role==="admin"?" • แอดมิน":""}</option>`).join("");
  if(current&&profile(current))sel.value=current;
  const hint=document.getElementById("dealerHint");
  if(hint)hint.textContent=current&&profile(current)?`เจ้ามือปัจจุบัน: ${profile(current).displayName}`:"ยังไม่ได้เลือกเจ้ามือ";
}

function renderHeader(){const p=LeagueShared.activeProfile(league,currentUserId);document.getElementById("whoami").textContent=p?.displayName||"-";document.getElementById("adminBadge").classList.toggle("hidden",!isAdmin());document.getElementById("adminLink").style.display=isAdmin()?"inline-flex":"none";document.getElementById("dealerName").innerHTML=pred.dealerId&&profile(pred.dealerId)?`<button type="button" class="profile-link" data-profile="${esc(pred.dealerId)}">${esc(profile(pred.dealerId).displayName)}</button>`:"ยังไม่ตั้ง"}
function renderSummary(){
 const invested=pred.bets.filter(b=>b.userId===currentUserId).reduce((s,b)=>s+b.stake,0);
 document.getElementById("invested").textContent=credits(invested);
 document.getElementById("pending").textContent=pred.bets.filter(b=>b.userId===currentUserId&&b.status==="pending").length;
 const currentIsDealer=isDealer();
 document.getElementById("dealerPanel").classList.remove("hidden");
 document.getElementById("bettingPanel").classList.toggle("hidden",currentIsDealer);
 const dealerNav=document.getElementById("dealerNav");
 if(dealerNav) dealerNav.style.display="flex";
 document.body.classList.toggle("is-admin",isAdmin());document.body.classList.toggle("is-dealer",isDealer());
 const publicDealer=document.getElementById("dealerCurrentPublic");
 if(publicDealer) publicDealer.innerHTML=pred.dealerId&&profile(pred.dealerId)
   ? `<button type="button" class="profile-link" data-profile="${esc(pred.dealerId)}">${esc(profile(pred.dealerId).displayName)}</button>`
   : "ยังไม่ได้ตั้ง";
}
function marketDesc(m,market){return `${profile(market.favoriteId)?.displayName||"-"} ต่อ ${market.handicap} ลูก`}
function renderDealer(){const box=document.getElementById("dealerMarkets");if(!box)return;box.innerHTML="";if(!canManageMarket())return;allMatches().forEach(m=>{const market=pred.markets[marketKey(m.id)]||{favoriteId:m.pair[0],handicap:.5,open:false};const c=document.createElement("div");c.className="market";c.innerHTML=`<div class="market-head"><div><div class="market-title">รอบ ${m.ri+1} • ${esc(profile(m.pair[0])?.displayName||m.pair[0])} vs ${esc(profile(m.pair[1])?.displayName||m.pair[1])}</div><div class="handicap">${esc(marketDesc(m,market))}</div></div><span class="tag ${market.open&&!hasResult(m)?"":"closed"}">${hasResult(m)?"มีผลแล้ว":market.open?"เปิดรับ":"ปิดรับ"}</span></div>${boardHtml(m)}<div class="market-controls"><div class="field"><label for="fav-${m.id}">ผู้ต่อ</label><select id="fav-${m.id}"><option value="${esc(m.pair[0])}">${esc(profile(m.pair[0])?.displayName||m.pair[0])}</option><option value="${esc(m.pair[1])}">${esc(profile(m.pair[1])?.displayName||m.pair[1])}</option></select></div><div class="field"><label for="hcp-${m.id}">แต้มต่อ</label><input id="hcp-${m.id}" type="number" min="0" step=".5" value="${esc(market.handicap)}"></div><div class="field"><label for="open-${m.id}">สถานะ</label><select id="open-${m.id}"><option value="1">เปิดรับ</option><option value="0">ปิดรับ</option></select></div></div><div class="actions"><button class="primary" data-save="${m.id}">บันทึกคู่นี้</button></div>`;box.appendChild(c);document.getElementById(`fav-${m.id}`).value=market.favoriteId;document.getElementById(`open-${m.id}`).value=market.open&&!hasResult(m)?"1":"0"});box.querySelectorAll("[data-save]").forEach(b=>b.onclick=()=>saveMarket(b.dataset.save))}
function saveMarket(id){
 const displayedMatch=allMatches().find(item=>item.id===id);
 const favoriteId=document.getElementById(`fav-${id}`).value;
 const handicap=Number(document.getElementById(`hcp-${id}`).value);
 const open=document.getElementById(`open-${id}`).value==="1";
 return mutatePred(()=>{
  if(!canManageMarket()){alert("เฉพาะเจ้ามือปัจจุบันเท่านั้น");return false}
  const match=allMatches().find(item=>item.id===id);
  if(match?.season!==displayedMatch?.season||!match?.pair.every((userId,index)=>userId===displayedMatch.pair[index])){alert("ตารางแข่งเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่");return false}
  if(!match||!match.pair.includes(favoriteId)||!Number.isFinite(handicap)||handicap<0||handicap*2%1!==0){alert("ผู้ต่อหรือแต้มต่อไม่ถูกต้อง");return false}
  pred.markets[marketKey(id)]={favoriteId,handicap,open:open&&!hasResult(match)};
 });
}
// Fight-bill markets: one-tap corner picks, stake chips and the live กระดานทาย (PredBoard in predictions-board.js).
// betDraft keeps a half-made pick (corner + typed stake) across the re-render that every cloud pull triggers.
const betDraft={};
const nameOf=id=>profile(id)?.displayName||id;
const roundOf=matchId=>{const r=/^r(\d+)m\d+$/.exec(matchId||"");return r?Number(r[1])+1:"-"};
function boardHtml(m){
 const t=PredBoard.tally(pred.bets,league.currentSeason,m.id,m.pair);
 const side=(c,cls)=>`<div class="board-side ${cls}"><b>${c.count}</b> คน<span>${credits(c.stake)}</span></div>`;
 return `<div class="board" aria-label="กระดานทาย: ${esc(nameOf(m.pair[0]))} ${t.corners[0].count} คน ${credits(t.corners[0].stake)}, ${esc(nameOf(m.pair[1]))} ${t.corners[1].count} คน ${credits(t.corners[1].stake)}"><div class="board-head"><span>กระดานทาย</span><span>${t.count?`${t.count} คน • รวม ${credits(t.stake)}`:"ยังไม่มีใครกล้า"}</span></div><div class="board-bar" style="--red:${t.redShare}%"><i></i></div><div class="board-sides">${side(t.corners[0],"is-red")}${side(t.corners[1],"is-blue")}</div></div>`;
}
function cornerHtml(m,o,cls,mode,picked){
 const inner=`<span class="corner-tag">มุม${cls==="is-red"?"แดง":"น้ำเงิน"}</span><b class="corner-name">${esc(nameOf(o.id))}</b><span class="corner-odds ${o.role}">${esc(o.label)} <small>${esc(o.num)}</small></span>${picked?`<span class="corner-pick">${mode==="bet"?"เลือกมุมนี้":"ทายมุมนี้"}</span>`:""}`;
 return mode==="bet"
  ?`<button type="button" class="corner ${cls}${picked?" picked":""}" data-pick="${m.id}" data-side="${esc(o.id)}" aria-pressed="${picked}">${inner}</button>`
  :`<div class="corner ${cls}${picked?" picked":""}">${inner}</div>`;
}
function billHtml(m,market,mode,pickedId,body){
 const o=PredBoard.odds(m.pair,market);
 return `<div class="bill-head"><span class="bill-round">รอบ ${m.ri+1}</span><span class="tag">เปิดรับ</span></div><div class="bill-corners">${cornerHtml(m,o[0],"is-red",mode,pickedId===m.pair[0])}<span class="bill-vs" aria-hidden="true">VS</span>${cornerHtml(m,o[1],"is-blue",mode,pickedId===m.pair[1])}</div>${boardHtml(m)}${body}`;
}
function slipLabel(id){
 const d=betDraft[id]||{},stake=Number(d.stake)||0;
 if(!d.side)return "แตะมุมที่จะทายก่อน";
 return stake>0?`ลง ${credits(stake)} ให้ ${nameOf(d.side)}`:`ใส่ยอดให้ ${nameOf(d.side)}`;
}
function renderBetting(){
 const box=document.getElementById("bettingMarkets");box.innerHTML="";
 if(isDealer()){
   box.innerHTML='<div class="locked">คุณเป็นเจ้ามือของรอบนี้ จึงไม่สามารถทายผลได้</div>';
   return;
 }
 let n=0;allMatches().forEach(m=>{const market=pred.markets[marketKey(m.id)];if(!market||!market.open||hasResult(m))return;n++;const own=m.pair.includes(currentUserId),existing=pred.bets.find(b=>b.season===league.currentSeason&&b.matchId===m.id&&b.userId===currentUserId);const c=document.createElement("div");c.className="market bill";
  if(own||existing){delete betDraft[m.id];c.innerHTML=billHtml(m,market,"view",existing?.sideId,own?'<div class="locked">คุณเป็นผู้เล่นในคู่นี้ จึงทายไม่ได้ • ไปตีให้ชนะแทน</div>':`<div class="locked">ทายแล้ว: ${esc(nameOf(existing.sideId))} • ${credits(existing.stake)}</div>`)}
  else{
   const d=betDraft[m.id]||(betDraft[m.id]={side:"",stake:""});
   if(d.side&&!m.pair.includes(d.side))d.side="";
   c.innerHTML=billHtml(m,market,"bet",d.side,`<div class="slip"><div class="chips" role="group" aria-label="เพิ่มยอดเร็ว">${PredBoard.STAKE_CHIPS.map(v=>`<button type="button" data-q="${m.id}:${v}">+${v}</button>`).join("")}</div><div class="slip-row"><label class="slip-stake"><span>ยอด</span><input id="stake-${m.id}" type="number" min="1" inputmode="numeric" placeholder="0" value="${esc(d.stake)}"></label><button type="button" class="chip-clear" data-clear="${m.id}" aria-label="ล้างยอด">ล้าง</button><button class="green slip-go" data-bet="${m.id}">${esc(slipLabel(m.id))}</button></div></div>`);
  }
  box.appendChild(c)});
 if(!n)box.innerHTML='<div class="empty">ยังไม่มีคู่ที่เปิดให้ทาย • รอเจ้ามือตั้งราคา</div>';
 const refresh=id=>{const b=box.querySelector(`[data-bet="${id}"]`);if(b)b.textContent=slipLabel(id)};
 box.querySelectorAll("[data-bet]").forEach(b=>b.onclick=()=>placeBet(b.dataset.bet));
 box.querySelectorAll("[data-pick]").forEach(b=>b.onclick=()=>{const id=b.dataset.pick;betDraft[id].side=b.dataset.side;box.querySelectorAll(`[data-pick="${id}"]`).forEach(x=>{const on=x===b;x.classList.toggle("picked",on);x.setAttribute("aria-pressed",String(on));x.querySelector(".corner-pick")?.remove();if(on)x.insertAdjacentHTML("beforeend",'<span class="corner-pick">เลือกมุมนี้</span>')});refresh(id);const e=document.getElementById(`stake-${id}`);if(e&&!Number(e.value))e.focus({preventScroll:true})});
 box.querySelectorAll("[data-q]").forEach(b=>b.onclick=()=>{const [id,a]=b.dataset.q.split(":");const e=document.getElementById(`stake-${id}`);e.value=PredBoard.addStake(e.value,a);betDraft[id].stake=e.value;refresh(id)});
 box.querySelectorAll("[data-clear]").forEach(b=>b.onclick=()=>{const id=b.dataset.clear,e=document.getElementById(`stake-${id}`);e.value="";betDraft[id].stake="";refresh(id)});
 box.querySelectorAll('input[id^="stake-"]').forEach(e=>e.oninput=()=>{const id=e.id.slice(6);if(betDraft[id])betDraft[id].stake=e.value;refresh(id)});
}
// ใครได้ ใครเสีย: settled markets of this Season. Winners get the ได้เงิน stamp, losers a friendly tease (PredBoard lines).
// A match that settles while the page is open gets the stamp struck in; ones already settled at load just sit there.
let seenSettled=null;
function renderSettled(){
 const panel=document.getElementById("settledPanel"),box=document.getElementById("settledBoard");if(!panel||!box)return;
 const season=league.currentSeason,groups=PredBoard.settledMatches(pred.bets,season,b=>BetSettle.effective(league,pred,b).status).slice(0,8);
 panel.classList.toggle("hidden",!groups.length);
 const fresh=new Set(groups.map(g=>g.matchId)),first=seenSettled===null;
 const row=(b,kind)=>{const mine=b.userId===currentUserId,who=`<button type="button" class="profile-link" data-profile="${esc(b.userId)}">${esc(nameOf(b.userId))}</button>${mine?' <small>(คุณ)</small>':""}`,pickTxt=`ทาย ${esc(nameOf(b.sideId))} • ${credits(b.stake)}`;
  if(kind==="won")return `<li class="payout won"><div class="payout-who">${who}<small>${pickTxt}</small></div><span class="paid-stamp">${PredBoard.WIN_STAMP}</span><span class="payout-amt positive">+${credits(b.stake)}</span><p class="payout-line">${esc(PredBoard.winLine(b.id))}</p></li>`;
  if(kind==="lost")return `<li class="payout lost"><div class="payout-who">${who}<small>${pickTxt}</small></div><span class="payout-amt negative">-${credits(b.stake)}</span><p class="payout-line">${esc(PredBoard.teaseLine(b.id))}</p></li>`;
  return `<li class="payout push"><div class="payout-who">${who}<small>${pickTxt}</small></div><span class="payout-amt">0</span><p class="payout-line">${esc(PredBoard.pushLine(b.id))}</p></li>`};
 box.innerHTML=groups.map(g=>{const pair=Array.isArray(g.pair)?g.pair:[],m=allMatches().find(x=>x.id===g.matchId),score=m&&hasResult(m)&&m.pair.every((id,i)=>id===pair[i])?`${esc(m.score.a)} – ${esc(m.score.b)}`:"";const strike=!first&&!seenSettled.has(g.matchId);
  return `<div class="market bill settled${strike?" stamp-in":""}"><div class="bill-head"><span class="bill-round">รอบ ${esc(roundOf(g.matchId))}</span><span class="tag closed">ตัดสินแล้ว</span></div><div class="settled-pair"><b class="nu-red">${esc(nameOf(pair[0]))}</b><span class="settled-score">${score||"VS"}</span><b class="nu-blue">${esc(nameOf(pair[1]))}</b></div><ul class="payouts">${[...g.won.map(b=>row(b,"won")),...g.lost.map(b=>row(b,"lost")),...g.push.map(b=>row(b,"push"))].join("")}</ul></div>`}).join("");
 seenSettled=fresh;
}
function placeBet(id){
 const displayedMatch=allMatches().find(item=>item.id===id);
 const sideId=betDraft[id]?.side||"";
 if(!sideId){alert("แตะเลือกมุมที่จะทายก่อน");return false}
 const stake=Number(document.getElementById(`stake-${id}`).value);
 return mutatePred(()=>{
  const match=allMatches().find(item=>item.id===id);
  if(match?.season!==displayedMatch?.season||!match?.pair.every((userId,index)=>userId===displayedMatch.pair[index])){alert("ตารางแข่งเปลี่ยนแล้ว กรุณาโหลดหน้าใหม่");return false}
  const eligibility=LeagueShared.betEligibility(league,pred,currentUserId,match&&{...match,hasResult:Boolean(hasResult(match))});
  if(!eligibility.allowed){alert(eligibility.reason);return false}
  if(!match.pair.includes(sideId)||!Number.isInteger(stake)||stake<=0){alert("กรอกยอดให้ถูกต้อง");return false}
  const market=pred.markets[marketKey(id)];
  pred.bets.push({id:pred.nextBetId++,season:league.currentSeason,matchId:id,pair:[...match.pair],favoriteId:market.favoriteId,handicap:market.handicap,userId:currentUserId,sideId,stake,status:"pending",net:0,createdAt:new Date().toISOString()});
 });
}
async function saveDealer(){
 const id=document.getElementById("dealerSelect").value;
 const saved=await mutatePred(()=>{
  if(!isAdmin()){alert("เฉพาะแอดมินเท่านั้น");return false}
  if(!id||!LeagueShared.activeProfile(league,id))return false;
  if(pred.bets.some(b=>b.season===league.currentSeason&&b.status==="pending")&&pred.dealerId&&pred.dealerId!==id){
   if(!confirm("มีรายการทายที่ยังรอผลอยู่ เปลี่ยนเจ้ามือจะมีผลต่อการสรุปยอด ยืนยันหรือไม่?"))return false;
  }
  pred.dealerId=id;
 });
 if(saved)alert(`ตั้ง ${profile(id).displayName} เป็นเจ้ามือแล้ว`);
}
async function settleAll(){
 let count=null;
 const saved=await mutatePred(()=>{
  if(!canManageMarket()){alert("เฉพาะเจ้ามือปัจจุบันเท่านั้น");return false}
  count=0;
  pred.bets.forEach(b=>{const m=allMatches().find(x=>x.id===b.matchId),r=LeagueShared.settlementOutcome(league.currentSeason,b,m);if(!r)return;if(r.type==="push"){b.status="push";b.net=0}else if(r.winnerId===b.sideId){b.status="won";b.net=b.stake}else{b.status="lost";b.net=-b.stake}count++});
  return count>0;
 });
 if(saved)alert(`คำนวณแล้ว ${count} รายการ`);
 else if(count===0)alert("ยังไม่มีรายการพร้อมคำนวณ");
}
// QA P1/P2: the table and export follow the current score (BetSettle.effective) and any Season with bets can be shown.
let settlementPick=null,staleToastKey="";
function settlementSeasonShown(){return BetSettle.seasons(league,pred).includes(settlementPick)?settlementPick:Number(league.currentSeason)||1}
function betPairText(b){return b.pair?.length===2?`${profile(b.pair[0])?.displayName||b.pair[0]}–${profile(b.pair[1])?.displayName||b.pair[1]}`:"ตารางเดิม"}
// "โอน" on a settlement row: a player in the red pays the dealer, a player in the green is paid by the dealer (profile-me.js shows the QR).
function payButton(r){const dealer=pred.dealerId&&profile(pred.dealerId);if(!window.LeagueProfile?.openPay||!dealer||!r.net)return"";const [toId,from]=r.net<0?[pred.dealerId,r.name]:[r.id,dealer.displayName];const to=profile(toId)?.displayName||toId;return ` <button type="button" class="secondary pay-go" data-pay-to-id="${esc(toId)}" data-pay-from="${esc(from)}" data-pay-amount="${esc(Math.abs(r.net))}" aria-label="${esc(from)} โอนให้ ${esc(to)} ${credits(Math.abs(r.net))}">โอน</button>`}
function renderSettlement(){
 const season=settlementSeasonShown(),sum=BetSettle.summary(league,pred,season),old=pred.bets.filter(b=>BetSettle.isOldPending(league,b)),staff=isAdmin()||isDealer();
 document.getElementById("settlementSeason").textContent=season;
 const sel=document.getElementById("settlementSeasonSelect");
 if(sel){sel.innerHTML=BetSettle.seasons(league,pred).map(s=>`<option value="${s}">ซีซั่น ${s}${s===Number(league.currentSeason)?" (ปัจจุบัน)":""}${old.some(b=>Number(b.season)===s)?" • มีรายการค้าง":""}</option>`).join("");sel.value=String(season);sel.onchange=()=>{settlementPick=Number(sel.value);renderSettlement();bindProfileLinks()}}
 const rows=sum.rows.map(r=>`<tr><td><button type="button" class="profile-link" data-profile="${esc(r.id)}">${esc(r.name)}</button>${r.inactive?' <small class="muted">ปิดบัญชีแล้ว</small>':""}${r.pending?` <small class="muted">รอผล ${r.pending}</small>`:""}</td><td>${credits(r.cost)}</td><td>${credits(r.won)}</td><td>${credits(r.lost)}</td><td class="${r.net>0?"positive":r.net<0?"negative":""}">${r.net>0?"+":""}${credits(r.net)}${payButton(r)}</td></tr>`).join("");
 document.getElementById("dealerReceives").textContent=credits(sum.receive);document.getElementById("dealerPays").textContent=credits(sum.pay);const e=document.getElementById("dealerNet");e.textContent=`${sum.net>0?"+":""}${credits(sum.net)}`;e.className=sum.net>0?"positive":sum.net<0?"negative":"";document.getElementById("settlement").innerHTML=rows||'<tr><td colspan="5" class="empty">ยังไม่มีข้อมูล</td></tr>';
 const staleAll=pred.bets.filter(b=>BetSettle.effective(league,pred,b).stale).length,notes=[];
 if(staleAll)notes.push(`⚠️ คะแนนถูกแก้/ลบหลังคำนวณ ${staleAll} รายการ • ตารางและยอดส่งออกแสดงตามคะแนนล่าสุดแล้ว${staff?" • กด \"ดึงคะแนนล่าสุด + คำนวณผล\" เพื่อบันทึก":" • รอเจ้ามือยืนยัน"}`);
 if(old.length)notes.push(`⚠️ มีรายการทายค้างจากซีซั่นก่อน ${old.length} รายการ (ซีซั่น ${[...new Set(old.map(b=>b.season))].map(Number).join(", ")}) • คำนวณจากคลังด้วยปุ่มคำนวณ หรือยกเลิกและคืนยอดทีละรายการ`);
 const alertBox=document.getElementById("settleAlert");if(alertBox){alertBox.textContent=notes.join("\n");alertBox.classList.toggle("hidden",!notes.length)}
 const key=`${staleAll}:${old.length}`;if(!notes.length)staleToastKey="";else if(staff&&key!==staleToastKey&&window.LeagueToast){window.LeagueToast(notes[0],"bad");staleToastKey=key}
 const box=document.getElementById("settlementPending");if(!box)return;
 const waiting=season===Number(league.currentSeason)?[]:sum.pending;
 box.innerHTML=waiting.map(b=>`<div class="locked old-bet"><span>#${esc(b.id)} • ${esc(profile(b.userId)?.displayName||b.userId)} • S${esc(b.season)} ${esc(betPairText(b))} • เลือก ${esc(profile(b.sideId)?.displayName||b.sideId)} • ${credits(b.stake)}${BetSettle.matchFor(league,b)?" • มีในคลัง":" • ไม่มีในคลัง"}</span>${staff?`<button type="button" class="danger" data-void="${esc(b.id)}">ยกเลิก • คืนยอด</button>`:""}</div>`).join("");
 box.querySelectorAll("[data-void]").forEach(x=>x.onclick=()=>voidOldBet(x.dataset.void));
}
function statusText(s){return esc({pending:"รอผล",won:"ชนะ",lost:"แพ้",push:"คืนยอด",void:"ยกเลิก • คืนยอด"}[s]||s)}
function renderHistory(){const list=isAdmin()||isDealer()?pred.bets:pred.bets.filter(b=>b.userId===currentUserId);document.getElementById("history").innerHTML=list.slice().reverse().map(b=>{const e=BetSettle.effective(league,pred,b),net=e.net;return `<tr><td>${esc(b.id)}</td><td><button type="button" class="profile-link" data-profile="${esc(b.userId)}">${esc(profile(b.userId)?.displayName||b.userId)}</button></td><td>${esc(`S${b.season??"เดิม"} • ${betPairText(b)}`)}</td><td>${esc(profile(b.sideId)?.displayName||b.sideId)}</td><td>${credits(b.stake)}</td><td>${statusText(e.status)}${e.stale?' <span title="คะแนนถูกแก้หลังคำนวณ รอเจ้ามือยืนยัน">⚠️</span>':""}</td><td class="${net>0?"positive":net<0?"negative":""}">${e.status==="pending"?"–":`${net>0?"+":""}${credits(net)}`}</td></tr>`}).join("")||'<tr><td colspan="7" class="empty">ยังไม่มีประวัติ</td></tr>'}
function render(){
 renderHeader();renderSummary();renderDealerSelect();renderDealer();renderBetting();renderSettled();renderSettlement();renderHistory();window.PredRankUI?.render(league,pred,currentUserId);bindProfileLinks();
}
document.getElementById("loginBtn").onclick=login;document.getElementById("loginPin").onkeydown=e=>{if(e.key==="Enter")login()};document.getElementById("logout").onclick=logout;
document.getElementById("settleAll").onclick=settleAll;
document.getElementById("saveDealer").onclick=saveDealer;
document.getElementById("profileClose").onclick=closeProfile;
document.getElementById("profileBackdrop").addEventListener("click",e=>{if(e.target.id==="profileBackdrop")closeProfile()});
document.addEventListener("keydown",e=>{if(e.key==="Escape")closeProfile()});
reconcileSession();renderLogin();render();initCloud();

const predNavItems=[...document.querySelectorAll(".bottom-nav [data-scroll]")];
predNavItems.forEach(item=>item.addEventListener("click",e=>{
  e.preventDefault();
  const target=document.getElementById(item.dataset.scroll);
  if(!target || target.classList.contains("hidden")){
    return;
  }
  history.replaceState(null,"",item.getAttribute("href"));
  LeagueShared.smoothScrollTo(target);
  predNavItems.forEach(navItem=>navItem.classList.toggle("active",navItem===item));
}));
if("IntersectionObserver" in window){
  const navObs=new IntersectionObserver(entries=>{
    const visible=entries.filter(e=>e.isIntersecting&&!e.target.classList.contains("hidden")).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];
    if(!visible)return;
    predNavItems.forEach(item=>item.classList.toggle("active",item.dataset.scroll===visible.target.id));
  },{rootMargin:"-20% 0px -58% 0px",threshold:[.05,.2,.45]});
  ["bettingPanel","dealerPanel","historySection"].forEach(id=>{const el=document.getElementById(id);if(el)navObs.observe(el)});
}
window.addEventListener("storage",event=>{if(event.key===LeagueShared.SESSION_KEY){reconcileSession();renderLogin();render()}});
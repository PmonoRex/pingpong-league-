function latestOutcomeForBet(bet){
  if(bet?.season!==league.currentSeason)return null;
  const match=allMatches().find(item=>item.id===bet.matchId&&item.season===bet.season);
  if(!match||!hasResult(match))return null;
  if(!Array.isArray(bet.pair)||bet.pair.length!==2||!bet.pair.every((id,index)=>id===match.pair?.[index]))return null;

  let favoriteId=bet.favoriteId;
  let handicap=Number(bet.handicap);
  const currentMarket=pred.markets?.[LeagueShared.marketKey(bet.season,bet.matchId)];

  // Legacy bets may not contain a complete market snapshot. Only then fall back to the current market.
  if(!match.pair.includes(favoriteId)&&match.pair.includes(currentMarket?.favoriteId))favoriteId=currentMarket.favoriteId;
  if(!Number.isFinite(handicap)&&Number.isFinite(Number(currentMarket?.handicap)))handicap=Number(currentMarket.handicap);
  if(!match.pair.includes(favoriteId)||!Number.isFinite(handicap)||handicap<0)return null;

  return LeagueShared.predictionOutcome(match.pair,match.score,{favoriteId,handicap});
}

async function refreshLeagueAndSettle(){
  if(!(isAdmin()||isDealer()))return alert("เฉพาะ Admin หรือเจ้ามือปัจจุบันเท่านั้น");
  const btn=document.getElementById("settleAll");
  const status=document.getElementById("realtimeState");
  if(!btn||!status)return;
  const oldText=btn.textContent;
  btn.disabled=true;
  btn.textContent="กำลังดึงคะแนนล่าสุด...";
  status.textContent="กำลังซิงก์คะแนนจากฐานข้อมูลแบบเรียลไทม์...";
  status.className="realtime-state loading";
  try{
    const rows=await cloudRequest();
    const row=rows?.[0];
    const remote=row?.league?.uidLeague;
    if(!remote?.profiles)throw new Error("ไม่พบข้อมูลการแข่งขันล่าสุด");
    league=remote;
    LeagueShared.saveLocalLeague(league);
    const remotePred=row?.predictions?.uidPredictions;
    if(remotePred){
      pred=Object.assign(freshPred(),remotePred);
      localStorage.setItem(PRED_KEY,JSON.stringify(pred));
    }
    lastCloudUpdate=row?.updated_at||new Date().toISOString();
    reconcileSession();
    renderLogin();
    render();

    let checked=0,settledNew=0,corrected=0;
    const saved=await mutatePred(()=>{
      if(!(isAdmin()||isDealer())){alert("เฉพาะ Admin หรือเจ้ามือปัจจุบันเท่านั้น");return false}

      pred.bets.forEach(b=>{
        const r=latestOutcomeForBet(b);
        if(!r)return;
        checked++;

        const oldStatus=b.status;
        const oldNet=Number(b.net)||0;
        let nextStatus="push",nextNet=0;
        if(r.type!=="push"){
          if(r.winnerId===b.sideId){nextStatus="won";nextNet=b.stake}
          else{nextStatus="lost";nextNet=-b.stake}
        }

        if(oldStatus==="pending")settledNew++;
        if(oldStatus!=="pending"&&(oldStatus!==nextStatus||oldNet!==nextNet))corrected++;

        b.status=nextStatus;
        b.net=nextNet;
        b.settledAt=new Date().toISOString();
      });

      return checked>0;
    });
    if(saved===false&&checked>0)throw new Error("บันทึกผลไม่สำเร็จ");

    const completed=allMatches().filter(hasResult).length;
    status.textContent=`อัปเดตแล้ว • มีผล ${completed} คู่ • ตรวจ ${checked} รายการ • ใหม่ ${settledNew} • แก้ผล ${corrected}`;
    status.className="realtime-state ok";

    if(corrected>0)alert(`อัปเดตคะแนนล่าสุดแล้ว และแก้ผลทายที่เคยคำนวณผิด/คะแนนถูกแก้ ${corrected} รายการ`);
    else if(!checked)alert("ดึงคะแนนล่าสุดแล้ว แต่ยังไม่มีรายการทายที่มีผลการแข่งขัน");
  }catch(error){
    console.error(error);
    status.textContent="ดึงคะแนนล่าสุดไม่สำเร็จ กรุณาตรวจการเชื่อมต่อแล้วลองอีกครั้ง";
    status.className="realtime-state error";
    alert(`ดึงคะแนนล่าสุดไม่สำเร็จ: ${error.message||error}`);
  }finally{
    btn.disabled=false;
    btn.textContent=oldText;
  }
}

function markRealtimeSync(){
  const status=document.getElementById("realtimeState");
  if(!status)return;
  const time=new Date().toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
  status.textContent=`คะแนนล่าสุดซิงก์เมื่อ ${time}`;
  status.className="realtime-state ok";
}

const settleButton=document.getElementById("settleAll");
if(settleButton){
  settleButton.onclick=refreshLeagueAndSettle;
}

window.addEventListener("focus",async()=>{
  if(typeof pull==="function"){
    await pull();
    markRealtimeSync();
  }
});
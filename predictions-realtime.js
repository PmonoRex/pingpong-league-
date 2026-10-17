// The settle button below is the live path (it replaces settleAll from predictions.js); the rules live in bet-settle.js.
// Covers the current Season and finished Seasons that have a seasonArchives entry (QA P1/P2).
function latestOutcomeForBet(bet){return BetSettle.outcome(league,pred,bet)}

const SETTLE_LOG_LIMIT=200;
function logSettle(entry){
  pred.settleLog=Array.isArray(pred.settleLog)?pred.settleLog:[];
  pred.settleLog.unshift({at:new Date().toISOString(),actorId:currentUserId,...entry});
  pred.settleLog=pred.settleLog.slice(0,SETTLE_LOG_LIMIT);
}

async function refreshLeagueAndSettle(){
  if(!(isAdmin()||isDealer()))return alert("เฉพาะแอดมินหรือเจ้ามือปัจจุบันเท่านั้น");
  const btn=document.getElementById("settleAll");
  const status=document.getElementById("realtimeState");
  if(!btn||!status)return;
  const oldText=btn.textContent;
  btn.disabled=true;
  btn.textContent="กำลังดึงคะแนนล่าสุด…";
  status.textContent="กำลังซิงก์คะแนนจากฐานข้อมูลแบบเรียลไทม์…";
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

    let checked=0,settledNew=0,corrected=0,reverted=0,changed=0;
    const saved=await mutatePred(()=>{
      if(!(isAdmin()||isDealer())){alert("เฉพาะแอดมินหรือเจ้ามือปัจจุบันเท่านั้น");return false}
      checked=settledNew=corrected=reverted=changed=0;

      pred.bets.forEach(b=>{
        const next=BetSettle.resolve(league,pred,b);
        if(!next)return;
        checked++;
        const oldStatus=b.status,oldNet=Number(b.net)||0;
        if(oldStatus===next.status&&oldNet===next.net)return;
        if(oldStatus==="pending")settledNew++;
        else if(next.status==="pending")reverted++;
        else corrected++;
        changed++;
        // A settled bet whose score was edited or cleared is logged so the dealer can see what moved and from what.
        if(oldStatus!=="pending")logSettle({action:next.status==="pending"?"bet_revert":"bet_resettle",betId:b.id,season:b.season,matchId:b.matchId,from:oldStatus,to:next.status,oldNet,newNet:next.net});
        b.status=next.status;
        b.net=next.net;
        if(next.status==="pending")delete b.settledAt;
        else b.settledAt=new Date().toISOString();
      });

      return changed>0;
    });
    if(saved===false&&changed>0)throw new Error("บันทึกผลไม่สำเร็จ");

    const completed=allMatches().filter(hasResult).length;
    status.textContent=`อัปเดตแล้ว • มีผล ${completed} คู่ • ตรวจ ${checked} รายการ • ใหม่ ${settledNew} • แก้ผล ${corrected} • กลับเป็นรอผล ${reverted}`;
    status.className="realtime-state ok";

    if(corrected>0||reverted>0)alert(`อัปเดตคะแนนล่าสุดแล้ว • แก้ผลตามคะแนนที่ถูกแก้ ${corrected} รายการ • คะแนนถูกลบจึงกลับเป็นรอผล ${reverted} รายการ`);
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

// QA P2: a pending bet from a finished Season that has no archive to settle against is voided (stake returned) explicitly.
async function voidOldBet(betId){
  if(!(isAdmin()||isDealer()))return alert("เฉพาะแอดมินหรือเจ้ามือปัจจุบันเท่านั้น");
  const shown=pred.bets.find(b=>String(b.id)===String(betId));
  if(!shown||!BetSettle.isOldPending(league,shown))return;
  if(!confirm(`ยกเลิกรายการทาย #${shown.id} ของซีซั่น ${shown.season} และคืนยอด ${credits(shown.stake)}?`))return;
  const saved=await mutatePred(()=>{
    if(!(isAdmin()||isDealer())){alert("เฉพาะแอดมินหรือเจ้ามือปัจจุบันเท่านั้น");return false}
    const b=pred.bets.find(x=>String(x.id)===String(betId));
    if(!b||!BetSettle.isOldPending(league,b)){alert("รายการนี้ถูกคำนวณหรือยกเลิกไปแล้ว");return false}
    b.status="void";b.net=0;b.settledAt=new Date().toISOString();
    logSettle({action:"bet_void",betId:b.id,season:b.season,matchId:b.matchId,from:"pending",to:"void",oldNet:0,newNet:0});
  });
  if(saved)alert(`ยกเลิกรายการ #${shown.id} และคืนยอดแล้ว`);
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

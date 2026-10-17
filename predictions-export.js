// Export/share the net settlement for the Season shown in the settlement card (QA P1/P2: follows the current score,
// includes players closed since and lists bets still waiting from a finished Season).
(function(){
  const button=document.getElementById("exportSettlement");
  const hint=document.getElementById("exportSettlementHint");
  if(!button)return;

  function authorized(){
    return typeof isAdmin==="function"&&typeof isDealer==="function"&&(isAdmin()||isDealer());
  }

  const shownSeason=()=>typeof settlementSeasonShown==="function"?settlementSeasonShown():league.currentSeason;
  function settlementRows(){
    return BetSettle.summary(league,pred,shownSeason()).rows.map(row=>({...row,name:row.inactive?`${row.name} (ปิดบัญชีแล้ว)`:row.name}));
  }

  function makeText(){
    const season=shownSeason();
    const dealer=profile(pred.dealerId)?.displayName||"ยังไม่ได้ตั้ง";
    const rows=settlementRows();
    const dealerPays=rows.filter(row=>row.net>0);
    const dealerReceives=rows.filter(row=>row.net<0);
    const payTotal=dealerPays.reduce((sum,row)=>sum+row.net,0);
    const receiveTotal=dealerReceives.reduce((sum,row)=>sum+Math.abs(row.net),0);
    const dealerNet=receiveTotal-payTotal;
    const summary=BetSettle.summary(league,pred,season),pending=summary.pending.length;
    const lines=[
      `🏓 สรุปยอดชำระซีซั่น ${season}`,
      `เจ้ามือ: ${dealer}`,
      "",
      "📤 เจ้ามือต้องจ่าย"
    ];
    if(dealerPays.length){
      dealerPays.sort((a,b)=>b.net-a.net).forEach(row=>lines.push(`• ${row.name}: ${credits(row.net)}`));
    }else lines.push("• ไม่มี");
    lines.push(`รวมจ่าย: ${credits(payTotal)}`);
    lines.push("");
    lines.push("📥 ผู้เล่นต้องจ่ายเจ้ามือ");
    if(dealerReceives.length){
      dealerReceives.sort((a,b)=>a.net-b.net).forEach(row=>lines.push(`• ${row.name}: ${credits(Math.abs(row.net))}`));
    }else lines.push("• ไม่มี");
    lines.push(`รวมรับ: ${credits(receiveTotal)}`);
    lines.push("");
    lines.push(`💰 สุทธิเจ้ามือ: ${dealerNet>0?"+":""}${credits(dealerNet)}`);
    if(pending>0)lines.push(`⚠️ ยังมีรายการรอผล ${pending} รายการ`);
    if(Number(season)!==Number(league.currentSeason))summary.pending.forEach(bet=>lines.push(`  • #${bet.id} ${profile(bet.userId)?.displayName||bet.userId}: ${credits(bet.stake)} (${bet.matchId})`));
    if(summary.stale>0)lines.push(`⚠️ คะแนนถูกแก้หลังคำนวณ ${summary.stale} รายการ (ยอดนี้คิดตามคะแนนล่าสุดแล้ว)`);
    lines.push(`อัปเดต: ${new Date().toLocaleString("th-TH")}`);
    return lines.join("\n");
  }

  async function exportSettlement(){
    if(!authorized()){
      alert("เฉพาะแอดมินหรือเจ้ามือปัจจุบันเท่านั้นที่ส่งออกยอดชำระได้");
      return;
    }
    const text=makeText();
    const title=`สรุปยอดชำระซีซั่น ${shownSeason()}`;
    try{
      if(navigator.share){
        await navigator.share({title,text});
        return;
      }
      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
        alert("คัดลอกสรุปยอดชำระแล้ว");
        return;
      }
      const blob=new Blob([text],{type:"text/plain;charset=utf-8"});
      const url=URL.createObjectURL(blob);
      const link=document.createElement("a");
      link.href=url;link.download=`settlement-season-${shownSeason()}.txt`;
      document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(url);
    }catch(error){
      if(error?.name!=="AbortError")alert(`ส่งออกไม่สำเร็จ: ${error?.message||error}`);
    }
  }

  function refreshVisibility(){
    const show=authorized();
    button.style.display=show?"inline-flex":"none";
    if(hint)hint.style.display=show?"block":"none";
  }

  button.addEventListener("click",exportSettlement);
  refreshVisibility();
  const observer=new MutationObserver(refreshVisibility);
  observer.observe(document.body,{attributes:true,attributeFilter:["class"]});
  window.addEventListener("storage",refreshVisibility);
})();

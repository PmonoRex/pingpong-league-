// Export/share the net settlement for the current Season.
(function(){
  const button=document.getElementById("exportSettlement");
  const hint=document.getElementById("exportSettlementHint");
  if(!button)return;

  function authorized(){
    return typeof isAdmin==="function"&&typeof isDealer==="function"&&(isAdmin()||isDealer());
  }

  function settlementRows(){
    const season=league.currentSeason;
    return activeProfiles()
      .filter(person=>person.id!==pred.dealerId)
      .map(person=>{
        const bets=pred.bets.filter(bet=>bet.season===season&&bet.userId===person.id&&bet.status!=="pending");
        const won=bets.filter(bet=>bet.status==="won").reduce((sum,bet)=>sum+Number(bet.stake||0),0);
        const lost=bets.filter(bet=>bet.status==="lost").reduce((sum,bet)=>sum+Number(bet.stake||0),0);
        return {id:person.id,name:person.displayName,won,lost,net:won-lost};
      });
  }

  function makeText(){
    const season=league.currentSeason;
    const dealer=profile(pred.dealerId)?.displayName||"ยังไม่ได้ตั้ง";
    const rows=settlementRows();
    const dealerPays=rows.filter(row=>row.net>0);
    const dealerReceives=rows.filter(row=>row.net<0);
    const payTotal=dealerPays.reduce((sum,row)=>sum+row.net,0);
    const receiveTotal=dealerReceives.reduce((sum,row)=>sum+Math.abs(row.net),0);
    const dealerNet=receiveTotal-payTotal;
    const pending=pred.bets.filter(bet=>bet.season===season&&bet.status==="pending").length;
    const lines=[
      `🏓 สรุปยอดชำระ Season ${season}`,
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
    lines.push(`อัปเดต: ${new Date().toLocaleString("th-TH")}`);
    return lines.join("\n");
  }

  async function exportSettlement(){
    if(!authorized()){
      alert("เฉพาะ Admin หรือเจ้ามือปัจจุบันเท่านั้นที่ส่งออกยอดชำระได้");
      return;
    }
    const text=makeText();
    const title=`สรุปยอดชำระ Season ${league.currentSeason}`;
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
      link.href=url;link.download=`settlement-season-${league.currentSeason}.txt`;
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

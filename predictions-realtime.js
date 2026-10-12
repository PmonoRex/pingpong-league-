async function refreshLeagueAndSettle(){
  if(!isAdmin())return alert("เฉพาะ Admin เท่านั้น");
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
    const count=await settleAll();
    const completed=allMatches().filter(hasResult).length;
    status.textContent=`อัปเดตแล้ว • มีผลการแข่งขัน ${completed} คู่ • ตัดสินรายการใหม่ ${Number(count)||0} รายการ`;
    status.className="realtime-state ok";
    if(!count)alert("ดึงคะแนนล่าสุดแล้ว แต่ยังไม่มีรายการทายที่พร้อมตัดสินผล");
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

let league=LeagueShared.readLocalLeague()||{profiles:{},rankHistory:[],seasonArchives:[]};
const esc=LeagueShared.escapeHtml;
const profileName=(archive,id)=>archive?.profileNames?.[id]||league.profiles?.[id]?.displayName||id;
const validScore=x=>Number.isInteger(x?.a)&&x.a>=0&&Number.isInteger(x?.b)&&x.b>=0;
const cloudRequest=()=>LeagueShared.cloudRequest("league,updated_at");

function synthesizedArchives(){
 const full=Array.isArray(league.seasonArchives)?league.seasonArchives:[];
 const bySeason=new Map(full.map(a=>[Number(a.season),a]));
 (league.rankHistory||[]).forEach(h=>{
  const season=Number(h.season);
  if(bySeason.has(season))return;
  bySeason.set(season,{season,finishedAt:h.finishedAt,standings:h.standings||[],rounds:[],results:{},profileNames:{},legacySummaryOnly:true});
 });
 return [...bySeason.values()].sort((a,b)=>Number(b.season)-Number(a.season));
}
function archiveMatches(archive){
 const out=[];
 (archive.rounds||[]).forEach((round,ri)=>{
  (round.m||[]).forEach((pair,mi)=>{
   const score=archive.results?.[`r${ri}m${mi}`];
   if(validScore(score))out.push({round:ri+1,pair,score});
  });
 });
 return out;
}
function renderSeasonList(selectedSeason=null){
 const list=synthesizedArchives();
 const box=document.getElementById("seasonList");
 document.getElementById("archiveStatus").textContent=list.length?`${list.length} Season ที่บันทึกไว้`:"ยังไม่มี Season ที่จบแล้ว";
 if(!list.length){box.innerHTML='<div class="empty">ยังไม่มีข้อมูล Season เก่า</div>';renderDetail(null);return}
 const active=selectedSeason??Number(list[0].season);
 box.innerHTML=list.map(a=>{
  const champ=a.standings?.[0];
  return `<button class="season-btn ${Number(a.season)===Number(active)?"active":""}" data-season="${a.season}"><b>Season ${a.season}</b><small>${champ?`แชมป์: ${esc(champ.name||profileName(a,champ.userId))}`:"ไม่มีอันดับ"}${a.legacySummaryOnly?" • สรุปอันดับเท่านั้น":""}</small></button>`;
 }).join("");
 box.querySelectorAll("[data-season]").forEach(btn=>btn.onclick=()=>{const season=Number(btn.dataset.season);renderSeasonList(season);renderDetail(list.find(a=>Number(a.season)===season))});
 renderDetail(list.find(a=>Number(a.season)===Number(active))||list[0]);
}
function renderDetail(archive){
 const title=document.getElementById("detailTitle"),meta=document.getElementById("detailMeta"),summary=document.getElementById("summaryCards"),body=document.getElementById("archiveStandings"),matchesBox=document.getElementById("archiveMatches"),matchCount=document.getElementById("matchCount");
 if(!archive){title.textContent="เลือก Season";meta.textContent="-";summary.innerHTML="";body.innerHTML="";matchesBox.innerHTML='<div class="empty">ไม่มีข้อมูล</div>';matchCount.textContent="";return}
 title.textContent=`Season ${archive.season}`;
 meta.textContent=archive.finishedAt?`จบเมื่อ ${new Date(archive.finishedAt).toLocaleString("th-TH")}`:"ไม่ทราบวันที่จบ";
 const standings=archive.standings||[],matches=archiveMatches(archive),champ=standings[0];
 summary.innerHTML=`<div class="stat"><b>${standings.length}</b><small>ผู้เล่น</small></div><div class="stat"><b>${matches.length}</b><small>ผลการแข่งขันที่เก็บไว้</small></div><div class="stat"><b>${champ?esc(champ.name||profileName(archive,champ.userId)):"-"}</b><small>แชมป์</small></div>`;
 body.innerHTML=standings.length?standings.map(row=>`<tr><td>${row.rank}</td><td style="text-align:left;font-weight:800">${row.rank===1?"👑 ":""}${esc(row.name||profileName(archive,row.userId))}</td><td>${row.pts??"-"}</td><td>${row.gd!=null?(row.gd>0?"+":"")+row.gd:"-"}</td><td class="points">${row.rpAward??"-"}</td></tr>`).join(""):'<tr><td colspan="5" class="empty">ไม่มีตารางอันดับ</td></tr>';
 matchCount.textContent=archive.legacySummaryOnly?"Season เก่าชุดนี้ไม่มีสกอร์รายคู่ที่ถูกเก็บ":"";
 matchesBox.innerHTML=matches.length?matches.map(m=>`<div class="match-row"><div class="round-label">รอบ ${m.round}</div><div class="left">${esc(profileName(archive,m.pair[0]))}</div><div class="score">${m.score.a} - ${m.score.b}</div><div>${esc(profileName(archive,m.pair[1]))}</div></div>`).join(""):'<div class="empty">ไม่มีสกอร์รายคู่ใน Archive นี้</div>';
}
async function init(){
 renderSeasonList();
 try{
  const row=(await cloudRequest())[0];
  const remote=row?.league?.uidLeague;
  if(remote?.profiles){league=remote;LeagueShared.saveLocalLeague(league);renderSeasonList()}
 }catch{}
}
init();

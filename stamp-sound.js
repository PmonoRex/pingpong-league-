/* Sound and haptics for the focal moment: when index.js strikes the "ชนะ" stamp, a short synthesized thunk and an
   18ms buzz land with it (~55% into the 420ms strike). No audio files; Web Audio is unlocked on the first gesture (iOS).
   Never on page load (index.js only strikes on a change) and never while the page is hidden (results synced in the background).
   The toggle lives in the เครื่องมือ menu; the choice is kept in localStorage, default on unless the device asks for reduced motion. */
const StampSound=(()=>{
 const STORE="pp_stamp_sound";
 const HIT_DELAY_MS=231;   // 55% of the 420ms stampStrike, where the stamp meets paper
 const BATCH_MS=150;       // several results arriving in one sync get one thunk, not a drum roll
 const VIBRATE_MS=18;
 // The hit: a sine dropping in pitch for the body plus a tiny filtered noise slap for the paper. Seconds, gains 0..1.
 const THUNK={duration:.12,body:{from:150,to:52,gain:.32,decay:.11},slap:{gain:.16,cutoff:1400,decay:.03},master:.6};

 // Pure: a stored "1"/"0" wins; with nothing stored, sound is on unless reduced motion is asked for.
 function initialEnabled(stored,reducedMotion){if(stored==="1")return true;if(stored==="0")return false;return!reducedMotion}
 // Pure: what to do for one strike.
 function decide({enabled,hidden,unlocked,canVibrate,now,lastAt}){
  const fire=Boolean(enabled)&&!hidden&&!(Number.isFinite(lastAt)&&now-lastAt<BATCH_MS);
  return{sound:fire&&Boolean(unlocked),haptic:fire&&Boolean(canVibrate)};
 }

 if(typeof window==="undefined")return{STORE,HIT_DELAY_MS,BATCH_MS,VIBRATE_MS,THUNK,initialEnabled,decide};

 const read=()=>{try{return localStorage.getItem(STORE)}catch(e){return null}};
 const write=v=>{try{localStorage.setItem(STORE,v?"1":"0")}catch(e){}};
 const reduced=()=>Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
 let enabled=initialEnabled(read(),reduced());
 let ctx=null,lastAt=NaN;
 const AC=window.AudioContext||window.webkitAudioContext;

 function unlock(){
  if(!enabled||!AC)return;
  try{
   if(!ctx)ctx=new AC();
   if(ctx.state==="suspended")ctx.resume();
   // iOS only opens the output once a sound starts inside a gesture; a one-sample silent buffer does it.
   const src=ctx.createBufferSource();src.buffer=ctx.createBuffer(1,1,22050);src.connect(ctx.destination);src.start(0);
  }catch(e){ctx=null}
 }
 const unlocked=()=>Boolean(ctx&&ctx.state==="running");

 function thunk(){
  const t=ctx.currentTime,T=THUNK;
  const out=ctx.createGain();out.gain.value=T.master;out.connect(ctx.destination);
  const osc=ctx.createOscillator(),og=ctx.createGain();osc.type="sine";
  osc.frequency.setValueAtTime(T.body.from,t);osc.frequency.exponentialRampToValueAtTime(T.body.to,t+T.body.decay);
  og.gain.setValueAtTime(T.body.gain,t);og.gain.exponentialRampToValueAtTime(.0001,t+T.body.decay);
  osc.connect(og).connect(out);osc.start(t);osc.stop(t+T.duration);
  const len=Math.ceil(ctx.sampleRate*T.slap.decay),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);
  for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*(1-i/len);
  const noise=ctx.createBufferSource(),lp=ctx.createBiquadFilter(),ng=ctx.createGain();
  noise.buffer=buf;lp.type="lowpass";lp.frequency.value=T.slap.cutoff;ng.gain.value=T.slap.gain;
  noise.connect(lp).connect(ng).connect(out);noise.start(t);
 }

 // Called by index.js at the moment it adds .stamp-in.
 function strike(){
  const now=performance.now();
  const d=decide({enabled,hidden:document.hidden,unlocked:unlocked(),canVibrate:typeof navigator.vibrate==="function",now,lastAt});
  if(!d.sound&&!d.haptic)return;
  lastAt=now;
  setTimeout(()=>{
   if(document.hidden)return;
   if(d.sound&&unlocked())try{thunk()}catch(e){}
   if(d.haptic)try{navigator.vibrate(VIBRATE_MS)}catch(e){}
  },HIT_DELAY_MS);
 }

 function paint(btn){btn.setAttribute("aria-pressed",String(enabled));btn.textContent=enabled?"เสียงตีตรา: เปิด":"เสียงตีตรา: ปิด"}
 function setup(){
  ["pointerdown","keydown","touchend"].forEach(type=>document.addEventListener(type,unlock,{capture:true,passive:true}));
  const btn=document.getElementById("soundToggle");if(!btn)return;
  paint(btn);
  btn.addEventListener("click",()=>{enabled=!enabled;write(enabled);paint(btn);if(enabled)unlock()});
 }
 if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",setup);else setup();

 return{STORE,HIT_DELAY_MS,BATCH_MS,VIBRATE_MS,THUNK,initialEnabled,decide,strike};
})();
if(typeof module!=="undefined")module.exports=StampSound;

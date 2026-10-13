(() => {
  const qs=(s,r=document)=>r.querySelector(s);
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const HERO_CACHE_KEY='pp_hero_data_20261013';

  function ensureStyles(){
    const required=[['mobile-fit.css?v=20261013-1','mobileFit'],['final-polish.css?v=20261013-1','finalPolish']];
    required.forEach(([href,key])=>{
      if(document.querySelector(`link[data-${key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase())}]`)) return;
      const link=document.createElement('link');
      link.rel='stylesheet';link.href=href;link.dataset[key]='1';document.head.appendChild(link);
    });
  }

  ensureStyles();
  document.body.classList.add('sport-redesign',`sport-page-${page.replace(/\W+/g,'-')}`);

  function league(){try{return window.LeagueShared?.readLocalLeague?.()||null}catch{return null}}

  async function loadEmbeddedHero(){
    try{const cached=sessionStorage.getItem(HERO_CACHE_KEY);if(cached?.startsWith('data:image/jpeg;base64,'))return cached}catch{}
    const urls=['hero_b64_1.txt?v=20261012-4','hero_b64_2.txt?v=20261012-4','hero_b64_3.txt?v=20261012-4','hero_b64_4.txt?v=20261012-4'];
    const parts=await Promise.all(urls.map(async url=>{
      const response=await fetch(url,{cache:'force-cache'});
      if(!response.ok) throw new Error(`Hero part failed ${response.status}`);
      return (await response.text()).trim();
    }));
    const src=`data:image/jpeg;base64,${parts.join('')}`;
    try{sessionStorage.setItem(HERO_CACHE_KEY,src)}catch{}
    return src;
  }

  function addHeroPhoto(){
    if(!['index.html','dashboard.html'].includes(page)) return;
    const hero=qs('.hero');
    if(!hero||qs('.hero-player-photo',hero)) return;
    const img=document.createElement('img');
    img.className='hero-player-photo';
    img.alt='นักกีฬาปิงปองกำลังตีลูก';
    img.decoding='async';
    img.fetchPriority='high';
    img.style.opacity='0';
    img.addEventListener('load',()=>{img.style.opacity='1';hero.classList.add('hero-photo-ready')},{once:true});
    img.addEventListener('error',()=>{img.remove();hero.classList.add('hero-photo-error')},{once:true});
    hero.prepend(img);
    loadEmbeddedHero().then(src=>{img.src=src}).catch(error=>{
      console.error('Hero image load failed',error);
      img.remove();
      hero.classList.add('hero-photo-error');
    });
  }

  function addBrand(){
    const hero=qs('.hero'); if(!hero||qs('.sport-brand',hero)) return;
    const brand=document.createElement('div');
    brand.className='sport-brand';
    brand.innerHTML='<div class="sport-mark">🏓</div><div><b>ตีให้สุด หยุดที่เบ้าตา</b><small>THAI PING PONG LEAGUE</small></div>';
    const photo=qs('.hero-player-photo',hero);
    if(photo) photo.insertAdjacentElement('afterend',brand); else hero.insertBefore(brand,hero.firstChild);
    const l=league();
    if(page==='index.html'&&l){
      const badge=document.createElement('div');badge.className='sport-season-badge';badge.innerHTML=`SEASON <span>${Number(l.currentSeason)||1}</span><small>LIVE LEAGUE</small>`;
      const title=qs('h1',hero); if(title) title.insertAdjacentElement('afterend',badge);
    }
  }

  function setupMobileTools(){
    if(page!=='index.html') return;
    const bar=qs('.account-bar'),actions=bar&&qs('.actions',bar);
    if(!bar||!actions||qs('.sport-tools-toggle',bar))return;
    actions.classList.add('sport-tools-actions');
    const toggle=document.createElement('button');
    toggle.type='button';toggle.className='secondary sport-tools-toggle';toggle.textContent='☰ เครื่องมือ';
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','เปิดเมนูเครื่องมือ');
    bar.insertBefore(toggle,actions);
    const close=()=>{actions.classList.remove('open');toggle.setAttribute('aria-expanded','false')};
    toggle.addEventListener('click',event=>{event.stopPropagation();const open=actions.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open))});
    actions.addEventListener('click',event=>event.stopPropagation());
    document.addEventListener('click',()=>{if(matchMedia('(max-width:640px)').matches)close()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
    matchMedia('(min-width:641px)').addEventListener?.('change',event=>{if(event.matches)close()});
  }

  function restyleExistingTabs(){
    const nav=qs('.bottom-nav'); if(!nav) return;
    const links=[...nav.querySelectorAll('a')];
    if(page==='index.html'&&links.length>=4){
      const labels=[['⌂','Home'],['🏆','Ranking'],['📈','Rating'],['🎯','Predict']];
      links.slice(0,4).forEach((a,i)=>{a.innerHTML=`<span>${labels[i][0]}</span>${labels[i][1]}`});
    }
    if(page==='predictions.html'&&links.length>=4){
      const labels=[['⌂','Home'],['🎯','Predict'],['🛠','Dealer'],['▤','History']];
      links.slice(0,4).forEach((a,i)=>{a.innerHTML=`<span>${labels[i][0]}</span>${labels[i][1]}`});
    }
  }

  function addUniversalTabs(){
    if(qs('.bottom-nav,.sport-tabbar')) return;
    const active=page==='stats.html'?'profile':page==='dashboard.html'?'home':'';
    const nav=document.createElement('nav');nav.className='sport-tabbar';nav.setAttribute('aria-label','เมนูหลัก');
    nav.innerHTML=`<a class="${active==='home'?'active':''}" href="dashboard.html"><span>⌂</span>Home</a><a href="index.html#standingsCard"><span>🏆</span>Ranking</a><a href="predictions.html"><span>🎯</span>Predict</a><a class="${active==='profile'?'active':''}" href="stats.html"><span>●</span>Profile</a>`;
    document.body.appendChild(nav);
  }

  function ripple(){
    if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;
    document.addEventListener('pointerdown',e=>{
      const el=e.target.closest('button,a.btn,.bottom-nav a,.sport-tabbar a,.quick-tile');
      if(!el||el.disabled) return;
      el.animate([{transform:'scale(1)'},{transform:'scale(.965)'},{transform:'scale(1)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
    },{passive:true});
  }

  function elevateImportantCards(){
    ['#standingsCard','#bettingPanel','#dealerPanel','.rank-card'].forEach(sel=>qs(sel)?.classList.add('sport-feature-card'));
  }

  function boot(){addHeroPhoto();addBrand();setupMobileTools();restyleExistingTabs();addUniversalTabs();elevateImportantCards();ripple();document.body.classList.add('sport-ready')}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,40));else setTimeout(boot,40);
})();
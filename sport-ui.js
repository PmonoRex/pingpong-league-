(() => {
  const qs=(s,r=document)=>r.querySelector(s);
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const HERO_SRC='hero-player.jpg?v=20261015-ux';
  const HERO_PAGES=new Set(['index.html','dashboard.html','predictions.html','stats.html','archive.html','backup.html','admin.html']);

  function ensureStyles(){
    const required=[
      ['theme.css?v=20261015-design','theme.css'],
      ['motion.css?v=20261015-ux','motion.css']
    ];
    required.forEach(([href,file])=>{
      if([...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>(link.getAttribute('href')||'').includes(file)))return;
      const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);
    });
  }

  ensureStyles();
  // Full hero only on the league home; every other page gets a compact header (same view-transition name).
  document.body.classList.add('sport-redesign',`sport-page-${page.replace(/\W+/g,'-')}`,page==='index.html'?'hero-full':'hero-compact');

  function league(){try{return window.LeagueShared?.readLocalLeague?.()||null}catch{return null}}

  try{sessionStorage.removeItem('pp_hero_data_20261013')}catch{}

  function addHeroPhoto(){
    if(!HERO_PAGES.has(page))return;
    const hero=qs('.hero');
    if(!hero||qs('.hero-player-photo',hero))return;
    const img=document.createElement('img');
    img.className='hero-player-photo';
    img.alt='นักกีฬาปิงปองกำลังตีลูก';
    img.decoding='async';img.fetchPriority='high';img.style.opacity='0';
    const ready=()=>{img.style.opacity='1';hero.classList.add('hero-photo-ready')};
    img.addEventListener('load',ready,{once:true});
    img.addEventListener('error',()=>{img.remove();hero.classList.add('hero-photo-error')},{once:true});
    img.src=HERO_SRC;hero.prepend(img);
    if(img.complete&&img.naturalWidth){img.style.transition='none';ready();requestAnimationFrame(()=>img.style.transition='')}
  }

  function addBrand(){
    const hero=qs('.hero');if(!hero||qs('.sport-brand',hero))return;
    const brand=document.createElement('div');brand.className='sport-brand';
    brand.innerHTML='<div class="sport-mark">🏓</div><div><b>ตีให้สุด หยุดที่เบ้าตา</b><small>THAI PING PONG LEAGUE</small></div>';
    const photo=qs('.hero-player-photo',hero);
    if(photo)photo.insertAdjacentElement('afterend',brand);else hero.insertBefore(brand,hero.firstChild);
    const l=league();
    if(page==='index.html'&&l){
      const badge=document.createElement('div');badge.className='sport-season-badge';badge.innerHTML=`SEASON <span>${Number(l.currentSeason)||1}</span><small>LIVE LEAGUE</small>`;
      const title=qs('h1',hero);if(title)title.insertAdjacentElement('afterend',badge);
    }
  }

  function setupMobileTools(){
    if(page!=='index.html')return;
    const bar=qs('.account-bar'),actions=bar&&qs('.actions',bar);
    if(!bar||!actions||qs('.sport-tools-toggle',bar))return;
    actions.classList.add('sport-tools-actions');
    const toggle=document.createElement('button');toggle.type='button';toggle.className='secondary sport-tools-toggle';toggle.textContent='☰ เครื่องมือ';
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','เปิดเมนูเครื่องมือ');bar.insertBefore(toggle,actions);
    const close=()=>{actions.classList.remove('open');toggle.setAttribute('aria-expanded','false')};
    toggle.addEventListener('click',event=>{event.stopPropagation();const open=actions.classList.toggle('open');toggle.setAttribute('aria-expanded',String(open))});
    actions.addEventListener('click',event=>event.stopPropagation());
    document.addEventListener('click',()=>{if(matchMedia('(max-width:640px)').matches)close()});
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
    matchMedia('(min-width:641px)').addEventListener?.('change',event=>{if(event.matches)close()});
  }

  function restyleExistingTabs(){
    const nav=qs('.bottom-nav');if(!nav)return;const links=[...nav.querySelectorAll('a')];
    if(page==='index.html'&&links.length>=4){const labels=[['🏓','Matches'],['🏆','Table'],['🏅','Ranking'],['🎯','Predict']];links.slice(0,4).forEach((a,i)=>{a.innerHTML=`<span>${labels[i][0]}</span>${labels[i][1]}`})}
    if(page==='predictions.html'&&links.length>=4){const labels=[['⌂','Home'],['🎯','Predict'],['🛠','Dealer'],['🧾','History']];links.slice(0,4).forEach((a,i)=>{a.innerHTML=`<span>${labels[i][0]}</span>${labels[i][1]}`})}
  }

  // "Home" is always index.html (as on the index/predictions tab bars); the active tab is the one whose link is this page.
  function addUniversalTabs(){
    if(qs('.bottom-nav,.sport-tabbar'))return;
    const nav=document.createElement('nav');nav.className='sport-tabbar';nav.setAttribute('aria-label','เมนูหลัก');
    nav.innerHTML='<a href="index.html"><span>⌂</span>Home</a><a href="dashboard.html"><span>📊</span>Dashboard</a><a href="predictions.html"><span>🎯</span>Predict</a><a href="stats.html"><span>📈</span>Stats</a>';
    document.body.appendChild(nav);
  }
  function markActiveNav(){
    document.querySelectorAll('.bottom-nav a,.sport-tabbar a').forEach(a=>{
      const href=a.getAttribute('href')||'',file=href.split('#')[0].split('?')[0].toLowerCase();
      if(!file)return;
      const here=file===page&&!href.includes('#');a.classList.toggle('active',here);
      if(here)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');
    });
  }

  function elevateImportantCards(){['#standingsCard','#bettingPanel','#dealerPanel','.rank-card'].forEach(sel=>qs(sel)?.classList.add('sport-feature-card'))}
  // Hero, brand and tab bar go in before first paint so cross-page view transitions keep them in place.
  addHeroPhoto();addBrand();restyleExistingTabs();addUniversalTabs();markActiveNav();
  function boot(){setupMobileTools();elevateImportantCards();document.body.classList.add('sport-ready')}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,40));else setTimeout(boot,40);
})();
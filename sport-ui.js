(() => {
  const qs=(s,r=document)=>r.querySelector(s);
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();

  function ensureMobileFit(){
    if(document.querySelector('link[data-mobile-fit]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='mobile-fit.css?v=20261012-1';
    link.dataset.mobileFit='1';
    document.head.appendChild(link);
  }

  ensureMobileFit();
  document.body.classList.add('sport-redesign',`sport-page-${page.replace(/\W+/g,'-')}`);

  function league(){try{return window.LeagueShared?.readLocalLeague?.()||null}catch{return null}}

  async function loadEmbeddedHero(){
    const urls=['hero_b64_1.txt?v=20261012-4','hero_b64_2.txt?v=20261012-4','hero_b64_3.txt?v=20261012-4','hero_b64_4.txt?v=20261012-4'];
    const parts=await Promise.all(urls.map(async url=>{
      const response=await fetch(url,{cache:'no-store'});
      if(!response.ok) throw new Error(`Hero part failed ${response.status}`);
      return (await response.text()).trim();
    }));
    return `data:image/jpeg;base64,${parts.join('')}`;
  }

  function addHeroPhoto(){
    if(page!=='index.html') return;
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
    const nav=document.createElement('nav');nav.className='sport-tabbar';
    nav.innerHTML=`<a class="${active==='home'?'active':''}" href="dashboard.html"><span>⌂</span>Home</a><a href="index.html#standingsCard"><span>🏆</span>Ranking</a><a href="predictions.html"><span>🎯</span>Predict</a><a class="${active==='profile'?'active':''}" href="stats.html"><span>●</span>Profile</a>`;
    document.body.appendChild(nav);
  }

  function ripple(){
    document.addEventListener('pointerdown',e=>{
      const el=e.target.closest('button,a.btn,.bottom-nav a,.sport-tabbar a,.quick-tile');
      if(!el||el.disabled) return;
      el.animate([{transform:'scale(1)'},{transform:'scale(.965)'},{transform:'scale(1)'}],{duration:180,easing:'cubic-bezier(.2,.8,.2,1)'});
    },{passive:true});
  }

  function elevateImportantCards(){
    ['#standingsCard','#bettingPanel','#dealerPanel','.rank-card'].forEach(sel=>qs(sel)?.classList.add('sport-feature-card'));
  }

  function boot(){addHeroPhoto();addBrand();restyleExistingTabs();addUniversalTabs();elevateImportantCards();ripple();document.body.classList.add('sport-ready')}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,60));else setTimeout(boot,60);
})();
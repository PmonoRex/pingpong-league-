(() => {
  const qs=(s,r=document)=>r.querySelector(s);
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const HERO_SRC='hero-player.jpg?v=20261015-ux';
  // The fight-poster masthead carries no photo.
  const HERO_PAGES=new Set();

  function ensureStyles(){
    const required=[
      ['theme.css?v=20261018-thai','theme.css'],
      ['motion.css?v=20261018-arena','motion.css'],
      ['arena.css?v=20261018-drawer2','arena.css']
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
    brand.innerHTML='<div class="sport-mark" aria-label="ตีให้สุด หยุดที่เบ้าตา">ศึก</div>';
    const photo=qs('.hero-player-photo',hero);
    if(photo)photo.insertAdjacentElement('afterend',brand);else hero.insertBefore(brand,hero.firstChild);
    const l=league();
    if(page==='index.html'&&l){
      const badge=document.createElement('div');badge.className='sport-season-badge';badge.innerHTML=`SEASON <span>${Number(l.currentSeason)||1}</span><small>LIVE LEAGUE</small>`;
      const title=qs('h1',hero);if(title)title.insertAdjacentElement('afterend',badge);
    }
  }

  // เครื่องมือ: the account bar's buttons live in a drawer that slides in from the right edge (every width).
  // The first open moves the buttons' container to <body> (ids and listeners travel with it, and suite.js has already
  // added its links by then), so the panel sits above the whole page; arena.css styles it as a fixed side panel.
  function setupMobileTools(){
    if(page!=='index.html'&&page!=='predictions.html')return;
    const bar=qs('.account-bar'),actions=bar&&qs('.actions',bar);
    if(!bar||!actions||qs('.sport-tools-toggle',bar))return;
    actions.classList.add('sport-tools-actions');actions.id='toolsDrawer';
    actions.setAttribute('role','dialog');actions.setAttribute('aria-modal','true');actions.setAttribute('aria-label','เครื่องมือ');
    const head=document.createElement('div');head.className='tools-head';
    head.innerHTML='<div><b>เครื่องมือ</b><small class="tools-who"></small></div><button type="button" class="tools-close" aria-label="ปิดเมนูเครื่องมือ"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    actions.prepend(head);
    const toggle=document.createElement('button');toggle.type='button';toggle.className='secondary sport-tools-toggle';
    toggle.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h10M4 17h16"/></svg>เครื่องมือ';
    toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','toolsDrawer');bar.insertBefore(toggle,actions);
    const shade=document.createElement('div');shade.className='tools-backdrop';shade.setAttribute('aria-hidden','true');document.body.appendChild(shade);
    const isOpen=()=>actions.classList.contains('open');
    const open=()=>{if(actions.parentElement!==document.body){document.body.appendChild(actions);void actions.offsetWidth}const who=qs('#whoami');qs('.tools-who',head).textContent=who?[...who.childNodes].filter(n=>!n.classList?.contains('pa')).map(n=>n.textContent).join('').trim():'';actions.classList.add('open');document.body.classList.add('tools-open');toggle.setAttribute('aria-expanded','true');
      setTimeout(()=>qs('.tools-close',head)?.focus({preventScroll:true}),60)};
    const close=(back=true)=>{if(!isOpen())return;actions.classList.remove('open');document.body.classList.remove('tools-open');toggle.setAttribute('aria-expanded','false');if(back)toggle.focus({preventScroll:true})};
    toggle.addEventListener('click',()=>isOpen()?close():open());
    qs('.tools-close',head).addEventListener('click',()=>close());
    shade.addEventListener('click',()=>close());
    document.addEventListener('keydown',event=>{if(event.key==='Escape')close()});
    // A tap on a destination closes the drawer; the sound switch stays so its new state can be seen.
    actions.addEventListener('click',event=>{const hit=event.target.closest('a,button');if(hit&&!hit.closest('.tools-head')&&hit.id!=='soundToggle')close(false)});
    // Keep Tab inside the open drawer.
    actions.addEventListener('keydown',event=>{
      if(event.key!=='Tab'||!isOpen())return;
      const f=[...actions.querySelectorAll('a[href],button:not(:disabled)')].filter(el=>el.getClientRects().length);if(!f.length)return;
      if(event.shiftKey&&document.activeElement===f[0]){event.preventDefault();f[f.length-1].focus()}
      else if(!event.shiftKey&&document.activeElement===f[f.length-1]){event.preventDefault();f[0].focus()}
    });
  }

  function restyleExistingTabs(){
    const nav=qs('.bottom-nav');if(!nav)return;const links=[...nav.querySelectorAll('a')];
    if(page==='index.html'&&links.length>=4){const labels=[['🏓','คู่ชก'],['🏆','ตาราง'],['🏅','แรงค์'],['🎯','ทายผล']];links.slice(0,4).forEach((a,i)=>{a.innerHTML=`<span>${labels[i][0]}</span>${labels[i][1]}`})}
    if(page==='predictions.html'&&links.length>=4){const labels=[['⌂','หน้าแรก'],['🎯','ทายผล'],['🛠','เจ้ามือ'],['🧾','ประวัติ']];links.slice(0,4).forEach((a,i)=>{a.innerHTML=`<span>${labels[i][0]}</span>${labels[i][1]}`})}
  }

  // "Home" is always index.html (as on the index/predictions tab bars); the active tab is the one whose link is this page.
  function addUniversalTabs(){
    if(qs('.bottom-nav,.sport-tabbar'))return;
    const nav=document.createElement('nav');nav.className='sport-tabbar';nav.setAttribute('aria-label','เมนูหลัก');
    nav.innerHTML='<a href="index.html"><span>⌂</span>หน้าแรก</a><a href="dashboard.html"><span>📊</span>ภาพรวม</a><a href="predictions.html"><span>🎯</span>ทายผล</a><a href="stats.html"><span>📈</span>สถิติ</a>';
    document.body.appendChild(nav);
  }
  // Every tab bar (page-owned or universal) ends with the Dummy score keeper.
  function addDummyTab(){
    document.querySelectorAll('.bottom-nav,.sport-tabbar').forEach(nav=>{
      if(nav.querySelector('a[href="dummy.html"]'))return;
      const a=document.createElement('a');a.href='dummy.html';a.innerHTML='<span>🃏</span>ดัมมี่';nav.appendChild(a);
    });
  }
  // One drawn icon set for every tab bar (replaces the emoji glyphs): 24px grid, 1.8 stroke, round caps.
  const ICON_PATHS={
    home:'<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z"/>',
    dashboard:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="4" rx="1.5"/><rect x="13" y="10" width="7" height="10" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/>',
    predict:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
    stats:'<path d="M4 20h16"/><path d="M5 16l4.5-5 3.5 3 6-7"/><path d="M15 7h4v4"/>',
    dummy:'<rect x="3.5" y="6" width="10" height="14" rx="2" transform="rotate(-8 8.5 13)"/><rect x="10.5" y="4" width="10" height="14" rx="2" transform="rotate(8 15.5 11)"/>',
    matches:'<path d="M3 12h18"/><path d="M12 8.5V12"/><path d="M5.5 12v7M18.5 12v7"/><circle cx="17" cy="5.5" r="1.8" fill="currentColor" stroke="none"/>',
    table:'<path d="M8 4h8v5a4 4 0 0 1-8 0z"/><path d="M8 6H5v1.5A3 3 0 0 0 8 10.5M16 6h3v1.5a3 3 0 0 1-3 3"/><path d="M12 13v4M8.5 20h7"/>',
    ranking:'<circle cx="12" cy="14" r="5"/><path d="M9 9.5 6.5 3h4L12 7M15 9.5 17.5 3h-4"/><path d="m12 12 .9 1.6 1.7.3-1.3 1.2.3 1.7-1.6-.8-1.6.8.3-1.7-1.3-1.2 1.7-.3z" fill="currentColor" stroke="none"/>',
    dealer:'<rect x="4" y="8" width="16" height="11" rx="2"/><path d="M9 8V6a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 6v2M4 13h16"/>',
    history:'<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9 8.5h6M9 12h6"/>'
  };
  const TAB_KEYS={'index.html':'home','dashboard.html':'dashboard','predictions.html':'predict','stats.html':'stats','dummy.html':'dummy',
    '#competition':'matches','#standingsCard':'table','#rankCard':'ranking','#bettingPanel':'predict','#dealerPanel':'dealer','#historySection':'history'};
  // Picture icons (the owner's Gemini art, img/icons/<name>-96.webp). A key listed here shows its picture instead of the
  // drawn line icon; every other key keeps the line icon until its picture arrives.
  const ICON_IMAGES={home:'paddle',matches:'paddle'};
  function drawTabIcons(){
    document.querySelectorAll('.bottom-nav a,.sport-tabbar a').forEach(a=>{
      const href=a.getAttribute('href')||'',i=href.indexOf('#');
      const key=TAB_KEYS[i>=0?href.slice(i):href.split('?')[0].toLowerCase()];
      const span=a.querySelector('span');if(!key||!span||span.dataset.icon)return;
      span.dataset.icon=key;span.setAttribute('aria-hidden','true');
      const pic=ICON_IMAGES[key];
      span.innerHTML=pic?`<img class="tab-pic" src="img/icons/${pic}-96.webp" width="28" height="28" alt="" decoding="async">`:`<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[key]}</svg>`;
    });
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
  // iOS Safari only shows :active press states once the page listens for touches.
  document.addEventListener('touchstart',()=>{},{passive:true});
  // Keyboard users can jump past the masthead straight to the page content.
  function addSkipLink(){const main=qs('main');if(!main||qs('.skip-link'))return;if(!main.id)main.id='main-content';main.setAttribute('tabindex','-1');const a=document.createElement('a');a.className='skip-link';a.href='#'+main.id;a.textContent='ข้ามไปที่เนื้อหา';document.body.prepend(a)}
  addSkipLink();
  addHeroPhoto();addBrand();restyleExistingTabs();addUniversalTabs();addDummyTab();drawTabIcons();markActiveNav();
  // On touch screens the fixed tab bar floats above the on-screen keyboard and covers the fields, so hide it while typing.
  function hideTabsWhileTyping(){
    if(!matchMedia('(pointer:coarse)').matches)return;
    const typing=el=>el&&el.matches?.('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]),textarea,select');
    document.addEventListener('focusin',e=>{if(typing(e.target))document.body.classList.add('sport-typing')});
    document.addEventListener('focusout',()=>setTimeout(()=>{if(!typing(document.activeElement))document.body.classList.remove('sport-typing')},60));
  }
  hideTabsWhileTyping();
  // A stat with nothing to show ("-") drops out of the bill instead of printing a dash at headline size.
  function markEmptyStats(){document.querySelectorAll('.stat').forEach(s=>{const v=(s.querySelector('b')?.textContent||'').trim();s.classList.toggle('stat-empty',v==='-'||v==='–'||v==='')})}
  let statTimer=0;
  new MutationObserver(()=>{clearTimeout(statTimer);statTimer=setTimeout(markEmptyStats,60)}).observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  function boot(){setupMobileTools();markEmptyStats();elevateImportantCards();document.body.classList.add('sport-ready')}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,40));else setTimeout(boot,40);
  // Installable app: sw.js keeps the shell (pages, css, js, fonts) on the phone; league data still comes live from Supabase.
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}),{once:true});
})();
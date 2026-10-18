(() => {
  const qs=(s,r=document)=>r.querySelector(s);
  const page=(location.pathname.split('/').pop()||'index.html').toLowerCase();
  const HERO_SRC='hero-player.jpg?v=20261015-ux';
  // The fight-poster masthead carries no photo.
  const HERO_PAGES=new Set();

  function ensureStyles(){
    const required=[
      ['theme.css?v=20261018-thai','theme.css'],
      ['motion.css?v=20261018-video3','motion.css'],
      ['arena.css?v=20261018-card3','arena.css']
    ];
    required.forEach(([href,file])=>{
      if([...document.querySelectorAll('link[rel="stylesheet"]')].some(link=>(link.getAttribute('href')||'').includes(file)))return;
      const link=document.createElement('link');link.rel='stylesheet';link.href=href;document.head.appendChild(link);
    });
  }

  ensureStyles();
  // Full hero only on the league home; every other page gets a compact header (same view-transition name).
  document.body.classList.add('sport-redesign',`sport-page-${page.replace(/\W+/g,'-')}`,page==='index.html'?'hero-full':'hero-compact');

  // shared.js declares LeagueShared with const, so it is a global binding but not a window property.
  const LS=()=>typeof LeagueShared!=='undefined'?LeagueShared:window.LeagueShared;
  function league(){try{return LS()?.readLocalLeague?.()||null}catch{return null}}

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


  // One navigation for every page. The bottom bar is the same five tabs everywhere (หน้าแรก, ทายผล, ดัมมี่, สถิติ, เมนู);
  // everything else (other pages, account, admin) lives in the เมนู drawer that slides in from the right. Page-owned
  // tab bars, the hero link rows and the account-bar buttons are retired (the buttons stay in the DOM, hidden, so the
  // scripts that wire them keep working; the drawer drives them by clicking them).
  const TABS=[['index.html','home','หน้าแรก'],['predictions.html','predict','ทายผล'],['dummy.html','dummy','ดัมมี่'],['stats.html','stats','สถิติ']];
  function buildTabs(){
    document.querySelectorAll('.bottom-nav').forEach(n=>n.remove());
    let nav=qs('.sport-tabbar');
    if(!nav){nav=document.createElement('nav');nav.className='sport-tabbar';nav.setAttribute('aria-label','เมนูหลัก');document.body.appendChild(nav)}
    nav.innerHTML=TABS.map(([href,,label])=>`<a href="${href}"><span></span>${label}</a>`).join('')+
      '<button type="button" class="tab-menu" aria-haspopup="dialog" aria-controls="siteMenu" aria-expanded="false"><span></span>เมนู</button>';
  }
  const MENU_ICONS={
    dashboard:'<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="4" rx="1.5"/><rect x="13" y="10" width="7" height="10" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/>',
    archive:'<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
    profile:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    pin:'<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2"/>',
    sound:'<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/>',
    admin:'<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
    backup:'<path d="M7 18a5 5 0 0 1-.6-10A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9z"/><path d="M12 11v6M9.5 13.5 12 11l2.5 2.5"/>',
    logout:'<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4M6 12h10"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  const svg=(d,w=20)=>`<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  // After a PIN change: let the page's own poll pick up the new row (index.js pullCloud, predictions.js pull).
  function refreshPage(){['pullCloud','pull'].forEach(fn=>{try{if(typeof window[fn]==='function')window[fn]()}catch{}})}
  function signedIn(){const l=league();try{const id=l&&LS()?.sessionUserId?.(l);return id?{id,name:l.profiles?.[id]?.displayName||'',admin:!!LS()?.isAdmin?.(l,id)}:null}catch{return null}}
  function menuItems(){
    const me=signedIn(),item=(ico,label,attrs)=>`<${attrs.href?'a':'button type="button"'} class="menu-item" ${Object.entries(attrs).map(([k,v])=>`${k}="${v}"`).join(' ')}${attrs.href&&attrs.href===page?' aria-current="page"':''}><i class="mi">${svg(MENU_ICONS[ico])}</i><span>${label}</span></${attrs.href?'a':'button'}>`;
    let html='<p class="menu-sec">หน้าอื่น</p>'+item('dashboard','ภาพรวมลีก',{href:'dashboard.html'})+item('archive','คลังซีซั่น',{href:'archive.html'});
    const account=[];
    if(me&&window.LeagueProfile?.openMine)account.push(item('profile','โปรไฟล์ของฉัน',{'data-act':'profile'}));
    if(me&&typeof PinChange!=='undefined')account.push(item('pin','เปลี่ยน PIN',{'data-act':'pin'}));
    const sound=qs('#soundToggle');if(sound)account.push(item('sound',sound.textContent.trim()||'เสียงตีตรา',{'data-act':'sound','aria-pressed':sound.getAttribute('aria-pressed')||'true'}));
    if(account.length)html+='<p class="menu-sec">บัญชี</p>'+account.join('');
    if(me?.admin)html+='<p class="menu-sec">แอดมิน</p>'+item('admin','ห้องแอดมิน',{href:'admin.html'})+item('backup','สำรองข้อมูล',{href:'backup.html'});
    if(me)html+=item('logout','ออกจากระบบ',{'data-act':'logout'});
    return {html,me};
  }
  function setupMenu(){
    const toggle=qs('.sport-tabbar .tab-menu');if(!toggle||qs('#siteMenu'))return;
    const panel=document.createElement('div');panel.id='siteMenu';panel.className='sport-tools-actions site-menu';
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-label','เมนู');
    const shade=document.createElement('div');shade.className='tools-backdrop';shade.setAttribute('aria-hidden','true');
    document.body.append(shade,panel);
    const isOpen=()=>panel.classList.contains('open');
    const fill=()=>{const {html,me}=menuItems();
      panel.innerHTML=`<div class="tools-head"><div><b>เมนู</b><small class="tools-who"></small></div><button type="button" class="tools-close" aria-label="ปิดเมนู">${svg('<path d="M6 6l12 12M18 6 6 18"/>')}</button></div>${html}`};
    const open=()=>{fill();const me=signedIn();qs('.tools-who',panel).textContent=me?me.name:'ยังไม่ได้เข้าสู่ระบบ';panel.classList.add('open');document.body.classList.add('tools-open');toggle.setAttribute('aria-expanded','true');setTimeout(()=>qs('.tools-close',panel)?.focus({preventScroll:true}),60)};
    const close=(back=true)=>{if(!isOpen())return;panel.classList.remove('open');document.body.classList.remove('tools-open');toggle.setAttribute('aria-expanded','false');if(back)toggle.focus({preventScroll:true})};
    toggle.addEventListener('click',()=>isOpen()?close():open());
    shade.addEventListener('click',()=>close());
    document.addEventListener('keydown',e=>{if(e.key==='Escape')close()});
    panel.addEventListener('click',e=>{
      if(e.target.closest('.tools-close'))return close();
      const hit=e.target.closest('.menu-item');if(!hit)return;
      const act=hit.dataset.act;
      if(act==='sound'){const s=qs('#soundToggle');s?.click();qs('span',hit).textContent=s?.textContent.trim()||'';hit.setAttribute('aria-pressed',s?.getAttribute('aria-pressed')||'true');return}
      close(false);
      if(act==='profile')window.LeagueProfile?.openMine?.();
      if(act==='pin'){const me=signedIn();if(me&&typeof PinChange!=='undefined')PinChange.run({userId:me.id,name:me.name,onSaved:refreshPage})}
      if(act==='logout'){const b=qs('#logout');if(b)b.click();else{LS()?.logout?.();location.reload()}}
    });
    panel.addEventListener('keydown',e=>{
      if(e.key!=='Tab'||!isOpen())return;
      const f=[...panel.querySelectorAll('a[href],button:not(:disabled)')];if(!f.length)return;
      if(e.shiftKey&&document.activeElement===f[0]){e.preventDefault();f[f.length-1].focus()}
      else if(!e.shiftKey&&document.activeElement===f[f.length-1]){e.preventDefault();f[0].focus()}
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
    history:'<path d="M6 3.5h12v17l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9 8.5h6M9 12h6"/>',
    menu:'<path d="M4 7h16M4 12h16M4 17h16"/>'
  };
  const TAB_KEYS={'menu':'menu','index.html':'home','dashboard.html':'dashboard','predictions.html':'predict','stats.html':'stats','dummy.html':'dummy',
    '#competition':'matches','#standingsCard':'table','#rankCard':'ranking','#bettingPanel':'predict','#dealerPanel':'dealer','#historySection':'history'};
  // Picture icons (the owner's Gemini art, img/icons/<name>-96.webp). A key listed here shows its picture instead of the
  // drawn line icon; every other key keeps the line icon until its picture arrives.
  const ICON_IMAGES={home:'paddle',matches:'paddle'};
  function drawTabIcons(){
    document.querySelectorAll('.sport-tabbar a,.sport-tabbar .tab-menu').forEach(a=>{
      const href=a.getAttribute('href')||'menu',i=href.indexOf('#');
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
  addHeroPhoto();buildTabs();drawTabIcons();markActiveNav();
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
  // Page changes (the red wipe and the video loader) live in transition.js, loaded in <head>.

  function boot(){setupMenu();markEmptyStats();elevateImportantCards();document.body.classList.add('sport-ready')}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(boot,40));else setTimeout(boot,40);
  // Installable app: sw.js keeps the shell (pages, css, js, fonts) on the phone; league data still comes live from Supabase.
  if('serviceWorker' in navigator&&/^https?:$/.test(location.protocol))window.addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}),{once:true});
})();
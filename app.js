'use strict';
const data=JSON.parse(document.querySelector('#site-data').textContent);
const nav=[...document.querySelectorAll('[data-panel]')];
let current=null,shopLoaded=false,tourLoaded=false;const position={music:0,video:0};
function changePanel(name){
 current=name===current?null:name;
 document.querySelectorAll('.panel').forEach(p=>{p.hidden=p.id!==current});
 nav.forEach(b=>b.setAttribute('aria-expanded',String(b.dataset.panel===current)));
 document.querySelector('#video-content').replaceChildren();
 document.querySelector('#music-content').replaceChildren();
 if(current==='music'||current==='video')render(current);
 if(current==='tour'&&!tourLoaded){tourLoaded=true;const s=document.createElement('script');s.src='https://widget-app.songkick.com/injector/8693968';s.async=true;document.body.append(s)}
 if(current==='shop'&&!shopLoaded){shopLoaded=true;const s=document.createElement('script');s.src='shop.js';s.async=true;document.body.append(s)}
 history.replaceState(null,'',current?'#'+current:location.pathname+location.search);
}
nav.forEach(b=>b.addEventListener('click',()=>changePanel(b.dataset.panel)));
document.querySelectorAll('.close').forEach(b=>b.addEventListener('click',()=>{const active=nav.find(n=>n.dataset.panel===current);changePanel(current);active?.focus()}));
document.querySelector('.wordmark').addEventListener('click',()=>{if(current)changePanel(current)});
function render(kind){
 const list=kind==='music'?data.music:data.videos, index=position[kind], item=list[index], container=document.querySelector('#'+kind+'-content');container.replaceChildren();
 const slide=document.createElement('div');slide.className='slide';
 if(kind==='video'||item.embed){const frame=document.createElement('iframe');frame.src=kind==='video'?item.url:item.embed;frame.title=item.title;frame.className=kind==='video'?'video-frame':'cover';frame.allow='autoplay; encrypted-media; picture-in-picture';frame.allowFullscreen=true;slide.append(frame)}
 else{const a=document.createElement('a');a.href=item.url;a.target='_blank';a.rel='noopener noreferrer';const img=document.createElement('img');img.src=item.image;img.alt=item.title+' cover artwork';img.className='cover';a.append(img);slide.append(a)}
 const title=document.createElement('h2');title.className='slide-title';const a=document.createElement('a');a.textContent=item.title;a.href=kind==='video'?item.url.replace('/embed/','/watch?v=').split('?rel=')[0]:(item.embed?item.embed.replace('/widget',''):item.url);a.target='_blank';a.rel='noopener noreferrer';title.append(a);slide.append(title);container.append(slide);
 const dots=document.createElement('div');dots.className='dots';dots.setAttribute('aria-label','Choose '+kind);
 list.forEach((entry,i)=>{const dot=document.createElement('button');dot.className='dot';dot.setAttribute('aria-label',entry.title);dot.setAttribute('aria-current',String(i===index));dot.onclick=()=>{position[kind]=i;render(kind);document.querySelectorAll('#'+kind+'-content .dot')[i].focus()};dots.append(dot)});container.append(dots);
 document.querySelectorAll('#'+kind+' .arrow').forEach(b=>b.disabled=b.dataset.direction==='-1'?index===0:index===list.length-1);
}
function move(kind,delta){const length=kind==='music'?data.music.length:data.videos.length;position[kind]=Math.max(0,Math.min(length-1,position[kind]+delta));render(kind)}
document.querySelectorAll('.arrow').forEach(b=>b.onclick=()=>move(b.closest('.panel').id,Number(b.dataset.direction)));
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,select'))return;if(e.key==='Escape'&&current)changePanel(current);if(['music','video'].includes(current)&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();move(current,e.key==='ArrowRight'?1:-1)}});
let touchX=0;document.querySelectorAll('.carousel').forEach(c=>{c.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX},{passive:true});c.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>50)move(c.closest('.panel').id,dx<0?1:-1)},{passive:true})});
const bg=document.querySelector('.backdrop'),motion=document.querySelector('.motion');
function updateMotion(){motion.textContent=bg.paused?'Play background':'Pause background';motion.setAttribute('aria-pressed',String(!bg.paused))}bg.addEventListener('play',updateMotion);bg.addEventListener('pause',updateMotion);motion.onclick=()=>{if(bg.paused)bg.play().catch(()=>{});else bg.pause()};if(matchMedia('(prefers-reduced-motion: reduce)').matches){bg.removeAttribute('autoplay');bg.pause()}updateMotion();
document.querySelector('.join').onsubmit=e=>{e.preventDefault();document.querySelector('.signup-note').hidden=false};document.querySelector('.signup-note button').onclick=()=>document.querySelector('.signup-note').hidden=true;
if(nav.some(n=>n.dataset.panel===location.hash.slice(1)))changePanel(location.hash.slice(1));

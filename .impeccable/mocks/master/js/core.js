// Core: one shared state rendered into the desktop and the phone frames, routing,
// overlays, actions, and the UI pieces every epic reuses (track row, key label, joins).
// Each epic file registers its screens (SCR), overlays (OV) and actions (ACT).

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SCR={},OV={},ACT={},RESET=[];

const S={route:{v:'tracks'},hist:[],ov:null,toast:'',theory:'plain',tags:true,story:null,view:'proto',tip:true,seen:{}};
/** Domain state each epic seeds through RESET, so "Reset prototype" restores every demo. */
function resetDomain(){RESET.forEach(f=>f())}

function nav(v,p={}){S.hist.push(S.route);S.route={v,...p};S.ov=null}
function open(k,o={}){S.ov={k,...o}}
function toast(m){S.toast=m;clearTimeout(toast.t);toast.t=setTimeout(()=>{S.toast='';renderDevices()},1900)}
ACT.nav=d=>nav(d.v,d.p?JSON.parse(d.p):{});
ACT.back=()=>{if(S.ov){S.ov=null;return}S.route=S.hist.pop()||{v:'tracks'}};
ACT.close=()=>{S.ov=null};
ACT.open=d=>open(d.k,d.o?JSON.parse(d.o):{});
ACT.story=d=>{S.story=S.story===d.id?null:d.id;if(S.story)PLAN.reveal(S.story)};
ACT.noop=()=>false;

// ---------- glyphs ----------
const ic={
 home:'<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>',media:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/>',search:'<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
 music:'<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',lib:'<path d="M4 4h4v16H4zM10 4h4v16h-4zM16 5l3.5-1 3 15-3.5 1z"/>',
 gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',x:'<path d="M6 6l12 12M18 6 6 18"/>',r:'<path d="M9 6l6 6-6 6"/>',l:'<path d="M15 6l-6 6 6 6"/>',dn:'<path d="M6 9l6 6 6-6"/>',
 play:'<path d="M7 5l12 7-12 7z" fill="currentColor"/>',pause:'<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>',
 dots:'<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>',
 grip:'<circle cx="9" cy="6" r="1.4" fill="currentColor"/><circle cx="15" cy="6" r="1.4" fill="currentColor"/><circle cx="9" cy="12" r="1.4" fill="currentColor"/><circle cx="15" cy="12" r="1.4" fill="currentColor"/><circle cx="9" cy="18" r="1.4" fill="currentColor"/><circle cx="15" cy="18" r="1.4" fill="currentColor"/>',
 fork:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 4-12 7"/>',check:'<path d="M5 12l5 5 9-10"/>',
 cols:'<rect x="4" y="4" width="6" height="16" rx="1.5"/><rect x="14" y="4" width="6" height="16" rx="1.5"/>',one:'<rect x="6" y="4" width="12" height="16" rx="1.5"/>',
 wand:'<path d="M4 20 16 8M14 4v3M19 9h3M18 4l1.5 1.5M12 2l.01 0"/>',arc:'<path d="M3 18c4-12 14-12 18 0"/>',link:'<path d="M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1"/>',
 swap:'<path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4"/>',shuf:'<path d="M3 6h4l10 12h4M3 18h4l3-3.6M14 9.6 17 6h4M18 3l3 3-3 3M18 15l3 3-3 3"/>',
 bolt:'<path d="M13 3 5 14h6l-1 7 8-11h-6z"/>',map:'<circle cx="7" cy="8" r="2"/><circle cx="16" cy="6" r="2"/><circle cx="12" cy="16" r="2"/><circle cx="19" cy="17" r="1.5"/>',
 book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>',help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01"/>',
 headph:'<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>',
 list:'<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',save:'<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8"/>',bell:'<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>'};
const I=(k,cls='')=>`<svg class="i ${cls}" viewBox="0 0 24 24">${ic[k]}</svg>`;

// ---------- small UI ----------
/** The story badge: shows which user story owns the element next to it. */
const tg=id=>S.tags?`<b class="stag${S.story===id?' on':''}" data-a="story" data-id="${id}" title="${esc((STORY[id]||{}).title||id)}">${id}</b>`:'';
const att=o=>Object.entries(o).map(([k,v])=>` data-${k}="${esc(typeof v==='object'?JSON.stringify(v):v)}"`).join('');
const btn=(label,a,o={},cls='')=>`<span class="btn ${cls}"${att({a,...o})}>${label}</span>`;
const seg=(opts,cur,a,key='val',extra={})=>`<span class="seg">${opts.map(([v,l])=>`<span class="${String(cur)===String(v)?'on':''}"${att({a,[key]:v,...extra})}>${l}</span>`).join('')}</span>`;
const mdot=t=>`<i class="md" style="background:${t.col}"></i>`;
const emeter=t=>`<span class="em" title="Energy: ${ELVL(t.e)}">${[1,2,3,4].map(k=>`<i class="${k<=eLvlN(t.e)?'on':''}"></i>`).join('')}</span>`;
const fitDot=(cls,lbl)=>`<i class="fd f-${cls}" title="${lbl}"></i>`;

/** A track's harmony as the theory level shows it: a mood word, a key name, or a word you tap for the key card. */
function keyLabel(t){
 if(t.analysing)return `<span class="klab an"><i class="spin"></i>Analysing…</span>`;
 const q=t.unsure?'?':'';
 if(S.theory==='theory')return `<span class="klab kn${t.unsure?' uns':''}" data-a="${t.unsure?'unsure':'key'}" data-i="${t.id}">${mdot(t)}${name(t)}${q}</span>`;
 return `<span class="klab${S.theory==='tap'?' tap':''}${t.unsure?' uns':''}" style="--mc:${t.col}" ${S.theory==='tap'||t.unsure?`data-a="${t.unsure?'unsure':'key'}" data-i="${t.id}"`:''}>${mdot(t)}${t.word}${q}</span>`}

/** The line between two tracks: harmony, energy step, and any genre or tempo change. */
function joinLine(a,b,{fix=null,cmp=false,a2=null}={}){if(!a||!b)return '';const j=joinInfo(a,b);
 const tempo=j.tj?`<span class="tj">${cmp?'':'tempo '}${a.bpm}→${b.bpm}</span>`:'';const gen=j.gc?`<span class="gch">${GS[a.genre]} → ${GS[b.genre]}</span>`:'';
 return `<div class="jn f-${j.cls}"${a2?att(a2):''}><i class="fd"></i><span class="lbl">${j.lbl}</span>${cmp?'':`<span class="mut">· energy ${j.e}</span>`}${gen}${tempo}${fix&&j.cls==='clash'?`<span class="fix"${att(fix)}>Fix</span>`:''}</div>`}

/** The common track row. `tail` is extra HTML at the right; `a` makes the whole row an action. */
function trow(t,{tail='',a=null,cls='',drag=null,meta=true,num=null}={}){
 return `<div class="tr ${cls}"${a?att(a):''}${drag?` draggable="true" data-drag="${drag}"`:''}>${num!=null?`<span class="num tab">${num}</span>`:''}${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>
 ${meta?`<span class="kcol">${keyLabel(t)}</span><span class="ecol">${emeter(t)}</span>${gchip(t.genre)}<span class="bpm tab">${t.bpm}</span>`:''}${tail}</div>`}

// ---------- frames ----------
const NAVD=[['home','Home'],['media','Media'],['search','Search'],['music','Music'],['lib','Library']];
const MUSIC_ROUTES=['tracks','set','explore','builder','player'];
function deskFrame(){const r=S.route,sc=SCR[r.v],slim=sc.slim;
 const side=`<aside class="side${slim?' slim':''}"><div class="logo">${slim?'s':'sestudio'}</div>${NAVD.map(([k,l])=>`<span class="nv${(k==='music'&&MUSIC_ROUTES.includes(r.v))?' on':''}" ${k==='music'?'data-a="nav" data-v="tracks"':''}>${I(k)}${slim?'':l}</span>`).join('')}<span style="flex:1"></span><span class="nv${r.v==='settings'||r.v==='learn'?' on':''}" data-a="nav" data-v="settings">${I('gear')}${slim?'':'Settings'}</span></aside>`;
 const o=S.ov&&OV[S.ov.k],ov=o&&o.d?`<div class="scrim" data-a="close"></div><div class="modal ${o.wide?'wide':''}">${o.d(S.ov)}</div>`:'';
 return `<div class="dk">${side}<div class="dmain">${sc.d(r)}</div>${r.v!=='player'?miniPlayer(slim?'d slim':'d'):''}${ov}${S.toast?`<div class="toast">${S.toast}</div>`:''}</div>`}
function phoneFrame(){const r=S.route,sc=SCR[r.v],deep=sc.deep;
 const top=deep?`<div class="ptop"><span class="ib" data-a="back">${I('l')}</span><b>${sc.title?sc.title(r):''}</b><span style="flex:1"></span>${sc.pact?sc.pact(r):''}</div>`
  :`<div class="ptop"><span class="logo">sestudio</span><span style="flex:1"></span><span class="ib">${I('bell')}</span><span class="ib" data-a="nav" data-v="settings">${I('gear')}</span></div>`;
 const tabs=sc.noTabs?'':`<nav class="ptabs">${NAVD.map(([k,l])=>`<span class="${(k==='music'&&MUSIC_ROUTES.includes(r.v))?'on':''}" ${k==='music'?'data-a="nav" data-v="tracks"':''}>${I(k)}<em>${l}</em></span>`).join('')}</nav>`;
 const o=S.ov&&OV[S.ov.k];const ov=o?`<div class="scrim" data-a="close"></div><div class="sheet ${o.full?'full':''}"><div class="hnd" data-a="close"></div>${(o.p||o.d)(S.ov)}</div>`:'';
 return `<div class="pk"><div class="pstat"><span>21:52</span><span>●●● ▮</span></div>${top}<div class="pbody">${sc.p(r)}</div>${sc.noTabs||r.v==='player'?'':miniPlayer('p')}${tabs}${ov}${S.toast?`<div class="toast">${S.toast}</div>`:''}</div>`}
function miniPlayer(dev){const t=QUEUE_NOW();if(!t)return '';
 return `<div class="mini ${dev}" data-a="nav" data-v="player">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${esc(t.artist)} · ${keyLabel(t)}</span></div>${tg('E7.4')}<span class="ib">${I('pause')}</span></div>`}

// ---------- render ----------
let dragging=false;
function renderDevices(){const f=document.activeElement?.dataset?.id,pos=document.activeElement?.selectionStart;
 const keep={};document.querySelectorAll('[data-keep]').forEach(el=>keep[el.dataset.keep]=[el.scrollTop,el.scrollLeft]);
 $('#desk').innerHTML=deskFrame();$('#ph').innerHTML=phoneFrame();
 document.querySelectorAll('[data-keep]').forEach(el=>{const k=keep[el.dataset.keep];if(k){el.scrollTop=k[0];el.scrollLeft=k[1]}});
 if(f){const el=document.querySelector(`[data-id="${f}"]`);if(el){el.focus();try{el.setSelectionRange(pos,pos)}catch(e){}}}}
function render(){renderDevices();if(!dragging)PLAN.render()}
const $=s=>document.querySelector(s);

document.addEventListener('click',e=>{const el=e.target.closest('[data-a]');if(!el)return;const fn=ACT[el.dataset.a];if(!fn){console.warn('no action',el.dataset.a);return}
 e.stopPropagation();const dev=el.closest('#ph')?'p':el.closest('#desk')?'d':null;if(fn(el.dataset,el,dev,e)!==false)render()});
// Desktop drag and drop: a source carries data-drag="kind:..."; a target data-drop="kind:...".
// DROP[targetKind](dragParts, dropParts) applies it.
const DROP={};let DRAG=null;
document.addEventListener('dragstart',e=>{const el=e.target.closest('[data-drag]');if(!el)return;DRAG=el.dataset.drag.split(':');e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',el.dataset.drag)});
const clearOver=()=>document.querySelectorAll('.over').forEach(x=>x.classList.remove('over'));
document.addEventListener('dragover',e=>{clearOver();const el=e.target.closest('[data-drop]');if(!el||!DRAG)return;e.preventDefault();el.classList.add('over')});
document.addEventListener('drop',e=>{const el=e.target.closest('[data-drop]');if(!el||!DRAG)return;e.preventDefault();const p=el.dataset.drop.split(':');DROP[p[0]]&&DROP[p[0]](DRAG,p);DRAG=null;clearOver();render()});
document.addEventListener('dragend',()=>{DRAG=null;clearOver()});
document.addEventListener('input',e=>{const k=e.target.dataset.input;if(k&&ACT[k]){ACT[k](e.target.value,e.target.dataset);render()}});

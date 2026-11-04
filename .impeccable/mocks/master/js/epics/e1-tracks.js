// E1 Harmony on every track · E2 Harmonic search · E10 edge states (analysing, unsure, nothing fits).
// Screens: Music › Tracks (with "Fits after" mode), the Music shell (crates column, tabs),
// overlays: key card, row menu, unsure-mode check, phone crates sheet.

let TR;
RESET.push(()=>{Object.assign(FILTER_DEF,{strict:'6',mood:'any',energy:'any',genre:'same',tempo:'near'});TR={q:'',ref:null,f:{...FILTER_DEF},smart:false};const u=LIB.find(t=>t.title.startsWith('Untitled'));u.analysing=true;
 const p=by('Pure Hope');Object.assign(p,T('Pure Hope','neuro soundcloud',172,240,0,'mixolydian',.55),{id:p.id,genre:p.genre,curve:p.curve,unsure:{alt:'aeolian',altT:9}})});

// ---------- Music shell (desktop crates column + header) ----------
function cratesCol(){const r=S.route;const it=(lbl,a,on,id='',ico='list')=>`<div class="cr${on?' on':''}"${att(a)}>${I(ico)}<span>${lbl}</span>${id?tg(id):''}</div>`;
 return `<div class="cap">Libraries</div>${it('All music',{a:'nav',v:'tracks'},r.v==='tracks'&&!TR.smart,'','music')}
 <div class="cap">Playlists</div>${SETS.map((s,k)=>it(s.name,{a:'nav',v:'set',p:{id:k}},r.v==='set'&&r.id===k,k?'':'E3.1')).join('')}
 <div class="cap">Mixes ${tg('E5.1')}</div>${it('Friday drafts',{a:'nav',v:'builder',p:{mode:'A'}},r.v==='builder'&&BLD.mode==='A','','cols')}${it('Friday branches',{a:'nav',v:'builder',p:{mode:'B'}},r.v==='builder'&&BLD.mode==='B','','fork')}
 <div class="cap">Smart lists</div>${it('Dark & driving',{a:'smart'},TR.smart,'E2.6','bolt')}`}
const MTABS=[['albums','Albums'],['artists','Artists'],['tracks','Tracks'],['explore','Explore']];
function musicShell(tab,content){
 return `<div class="mus"><div class="crates scroll" data-keep="crates">${cratesCol()}</div><div class="mcont"><div class="mhead"><h2>Music</h2>
 <div class="mtabs">${MTABS.map(([k,l])=>`<span class="${tab===k?'on':''}" ${k==='tracks'||k==='explore'?`data-a="nav" data-v="${k}"`:''}>${l}${k==='explore'?tg('E8.1'):''}</span>`).join('')}</div><span style="flex:1"></span>
 ${btn(I('cols')+'New mix','nav',{v:'builder',p:{mode:'A'}})}${tg('E5.1')}${btn(I('wand')+'Build a set','wiz',{},'solid')}${tg('E6.1')}</div>${content}</div></div>`}
function phoneMusicHead(tab){return `<div class="pmh"><div class="chips">${MTABS.map(([k,l])=>`<span class="chip ${tab===k?'on':''}" ${k==='tracks'||k==='explore'?`data-a="nav" data-v="${k}"`:''}>${l}</span>`).join('')}<span class="chip" data-a="open" data-k="crates">${I('list')}Playlists</span></div></div>`}

// ---------- Tracks / Fits after ----------
function trackResults(){const q=TR.q.trim().toLowerCase(),ref=TR.ref!=null?LIB[TR.ref]:null;
 let list=ref?rankAfter(ref,TR.f):LIB.slice();
 if(TR.smart)list=list.filter(t=>!t.analysing&&t.br<0&&t.e>=.65);
 if(q)list=list.filter(t=>[t.title,t.artist,name(t),t.mode,t.word,t.genre,GS[t.genre],t.bpm,ELVL(t.e)].join(' ').toLowerCase().includes(q));
 return{ref,list}}
function filterBar(){const f=TR.f,c=(k,opts)=>seg(opts,f[k],'tf','val',{k});
 return `<div class="fbar">${tg('E2.3')}<span class="fl">Harmony</span>${c('strict',[['7','Same notes'],['6','Close'],['any','Any']])}<span class="fl">Mood</span>${c('mood',[['any','Any'],['up','Brighter'],['same','Same'],['down','Darker']])}
 <span class="fl">Energy</span>${c('energy',[['any','Any'],['lift','Lift'],['hold','Hold'],['ease','Ease off']])}<span class="fl">Genre</span>${c('genre',[['same','Same'],['any','Any']])}<span class="fl">Tempo</span>${c('tempo',[['near','±6%'],['any','Any']])}</div>`}
function nothingFits(ref){const f=TR.f;return `<div class="empty">${tg('E10.3')}<b>Nothing fits after ${esc(ref.title)} with these filters</b><p>The closest tracks need a looser rule. Loosen one:</p>
 <div class="row-btns">${f.strict!=='any'?btn(f.strict==='7'?'Allow close keys (6 of 7 notes)':'Allow any key','loosen',{k:'strict',val:f.strict==='7'?'6':'any'}):''}${f.genre==='same'?btn('Any genre','loosen',{k:'genre',val:'any'}):''}${f.tempo==='near'?btn('Any tempo','loosen',{k:'tempo',val:'any'}):''}${f.energy!=='any'?btn('Any energy','loosen',{k:'energy',val:'any'}):''}${f.mood!=='any'?btn('Any mood','loosen',{k:'mood',val:'any'}):''}</div></div>`}
function refHeader(ref,dev){return `<div class="refh">${tg('E2.2')}${tg('E0.5')}<span class="mut">Fits after</span><span class="refchip">${mdot(ref)}${esc(ref.title)}<span data-a="unref">${I('x')}</span></span>${dev==='d'?`<span class="mut sm">Ranked by shared notes, then tempo, genre and energy. ${keyLabel(ref)}</span>`:''}</div>`}
function whyTail(ref,t){const j=joinInfo(ref,t);return `<span class="why f-${j.cls}" title="${j.n} of 7 notes shared">${fitDot(j.cls,j.lbl)}${j.lbl}<em>· energy ${j.e}</em>${j.tj?'<em class="tj">· tempo jump</em>':''}</span>${S.route.v==='tracks'?tg('E2.4'):''}`}
function searchField(dev){return `<label class="srch">${I('search')}<input data-id="trq${dev}" data-input="trq" value="${esc(TR.q)}" placeholder="Search title, artist, key, mood, genre, tempo…">${tg('E2.5')}</label>`}

SCR.tracks={
 d:()=>{const{ref,list}=trackResults();
  const head=`<div class="thead"><span style="width:14px"></span><span style="flex:1">Title ${tg('E1.1')}</span><span class="kcol">${S.theory==='theory'?'Key':'Mood'}</span><span class="ecol">Energy ${tg('E1.3')}</span><span style="width:58px">Genre ${tg('E1.4')}</span><span class="bpm">BPM</span><span style="width:${ref?236:28}px"></span></div>`;
  const rows=list.map(t=>trow(t,{a:{a:'open',k:'rowmenu',o:{i:t.id}},tail:(ref?whyTail(ref,t):'')+`<span class="ib sm" data-a="open" data-k="rowmenu" data-o='{"i":${t.id}}'>${I('dots')}</span>`})).join('');
  return musicShell('tracks',`<div class="tracks">${searchField('d')}${ref?refHeader(ref,'d')+filterBar():TR.smart?`<div class="refh">${tg('E2.6')}<b>Dark & driving</b><span class="mut sm">Smart list · mood darker than Smooth, energy Driving or more</span></div>`:''}
  ${head}<div class="scroll tl" data-keep="trl">${ref&&!list.length?nothingFits(ref):rows}</div></div>`)},
 p:()=>{const{ref,list}=trackResults();
  return `${phoneMusicHead('tracks')}<div class="ppad">${searchField('p')}</div>${ref?refHeader(ref,'p')+`<div class="hscroll">${filterBar()}</div>`:''}
  <div class="plist">${ref&&!list.length?nothingFits(ref):list.map(t=>`<div class="tr ph" data-a="open" data-k="rowmenu" data-o='{"i":${t.id}}'>${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${esc(t.artist)} · ${t.bpm} · ${GS[t.genre]}</span></div><div class="pk2">${keyLabel(t)}${ref?whyTail(ref,t):emeter(t)}</div></div>`).join('')}</div>`}};

ACT.trq=v=>{TR.q=v};
ACT.tf=d=>{TR.f[d.k]=d.val};
ACT.loosen=d=>{TR.f[d.k]=d.val};
ACT.unref=()=>{TR.ref=null};
ACT.fitsafter=d=>{TR.ref=+d.i;TR.smart=false;TR.q='';nav('tracks')};
ACT.smart=()=>{TR.smart=!TR.smart;TR.ref=null;nav('tracks')};

// ---------- overlays ----------
/** One octave, the scale's notes lit, the tonic ringed; `cmp` lights a second set to show what changes. */
function kbd(pcs,tonic,{w=280,cmp=null,lbl=true}={}){const wk=[0,2,4,5,7,9,11],bk=[1,3,6,8,10],ww=w/7;let s=`<svg class="kbd" width="${w}" height="${ww*2.6}" viewBox="0 0 ${w} ${ww*2.6}">`;
 const fill=p=>{const a=pcs.includes(p),b=cmp&&cmp.includes(p);return cmp?(a&&b?'var(--great)':a?'var(--warn)':b?'var(--p)':null):(a?(p===tonic?'var(--p)':'oklch(80% .08 230)'):null)};
 wk.forEach((p,k)=>{const f=fill(p);s+=`<rect x="${k*ww+1}" y="0" width="${ww-2}" height="${ww*2.5}" rx="4" fill="${f||'#cfd6dd'}" opacity="${f?1:.25}"/>${lbl?`<text x="${k*ww+ww/2}" y="${ww*2.3}" text-anchor="middle" font-size="10" fill="#06101a">${NOTE[p]}</text>`:''}${p===tonic?`<circle cx="${k*ww+ww/2}" cy="${ww*1.8}" r="4" fill="none" stroke="#06101a" stroke-width="2"/>`:''}`});
 bk.forEach(p=>{const k=[0,1,3,4,5][bk.indexOf(p)],x=(k+1)*ww-ww*.3,f=fill(p);s+=`<rect x="${x}" y="0" width="${ww*.6}" height="${ww*1.5}" rx="3" fill="${f||'#1b2530'}" stroke="#06101a"/>${p===tonic?`<circle cx="${x+ww*.3}" cy="${ww*1.15}" r="3.5" fill="none" stroke="#fff" stroke-width="2"/>`:''}`});
 return s+'</svg>'}
function ladder(t){return `<div class="ladder">${MOODS.map(b=>`<span class="${t.br===b?'on':''}" style="--mc:${COL[b]}">${WORD[b]}</span>`).join('')}</div>`}
function curveSvg(t,w=260,h=34){const c=t.curve,bw=w/c.length;return `<svg width="${w}" height="${h}" class="curve">${c.map((v,k)=>`<rect x="${k*bw}" y="${h-v*h}" width="${bw-1}" height="${v*h}" fill="${t.col}" opacity=".75"/>`).join('')}</svg>`}
OV.keycard={d:o=>{const t=LIB[o.i];const fam=family(t);
 return `<div class="ovh"><b>${esc(t.title)}</b>${tg('E1.5')}<span style="flex:1"></span><span class="ib" data-a="close">${I('x')}</span></div>
 <div class="kc"><div class="kcl"><div class="big" style="color:${t.col}">${t.word}</div><div class="mut">${name(t)} · ${t.bpm} BPM · ${GS[t.genre]}</div>${kbd(t.pcs,t.t)}
 <div class="row-btns">${btn(I('play')+'Play the scale','playscale',{i:t.id},'solid')}${tg('E9.2')}${btn('Fits after this','fitsafter',{i:t.id})}${btn(I('book')+'What is a mode?','nav',{v:'learn',p:{step:2}})}${tg('E9.3')}</div></div>
 <div class="kcr"><div class="cap">Mood ladder ${tg('E1.2')}</div>${ladder(t)}<div class="cap">Same 7 notes, other centres</div><div class="fam">${fam.map(f=>`<span class="${f.t===t.t?'on':''}" style="--mc:${COL[f.br]}">${NOTE[f.t]} ${f.mode}</span>`).join('')||'<span class="mut sm">Harmonic minor has no modal family</span>'}</div>
 <div class="cap">Energy across the track ${tg('E1.3')}</div>${curveSvg(t)}<div class="mut sm">${ELVL(t.e)} · intro and outro are where mixes overlap</div></div></div>`}};
OV.rowmenu={d:o=>{const t=LIB[o.i];const it=(l,a,id='')=>`<div class="mi"${att(a)}>${l}${id?tg(id):''}</div>`;
 return `<div class="ovh">${mdot(t)}<b>${esc(t.title)}</b><span class="mut sm">${keyLabel(t)}</span><span style="flex:1"></span><span class="ib" data-a="close">${I('x')}</span></div>
 ${t.analysing?`<div class="note">${tg('E10.1')}Analysing its notes and energy. Harmony actions turn on when it's done (about a minute per track).</div>`:''}
 <div class="menu">${it(I('play')+'Play now',{a:'playnow',i:t.id})}${it(I('plus')+'Add to queue',{a:'queueadd',i:t.id})}${it(I('list')+'Add to Friday set',{a:'setadd',i:t.id})}
 ${t.analysing?'':it(I('link')+'Fits after this',{a:'fitsafter',i:t.id},'E2.1')+it(I('music')+'Key card',{a:'open',k:'keycard',o:{i:t.id}},'E1.5')+it(I('wand')+'Build a set from this',{a:'wiz',kind:'seed',seed:t.id},'E6.2')}</div>`}};
OV.unsure={d:o=>{const t=LIB[o.i],u=t.unsure,alt=T(t.title,t.artist,t.bpm,t.dur,u.altT,u.alt,t.e);
 const opt=(x,which)=>`<div class="uopt"><div class="big" style="color:${x.col}">${x.word}</div><div class="mut">${name(x)}</div>${kbd(x.pcs,x.t,{w:220})}<div class="row-btns">${btn(I('play')+'Listen','playpcs',{t:x.t,m:x.mode})}${btn('This one','confirm',{i:t.id,which},'solid')}</div></div>`;
 return `<div class="ovh"><b>Which one sounds right?</b>${tg('E10.2')}<span style="flex:1"></span><span class="ib" data-a="close">${I('x')}</span></div>
 <p class="mut sm" style="margin:0 0 10px">The analysis hesitates between two modes for <b>${esc(t.title)}</b>. Play both and pick the one that matches the track. Your answer is kept and used for every match.</p>
 <div class="uopts">${opt(t,'a')}${opt(alt,'b')}</div><div class="row-btns" style="justify-content:flex-end">${btn('Not sure, leave it','confirm',{i:t.id,which:'skip'})}</div>`}};
OV.crates={p:()=>`<div class="ovh"><b>Playlists</b><span style="flex:1"></span></div><div class="crates ph">${cratesCol()}</div>`};

ACT.key=d=>open('keycard',{i:+d.i});
ACT.unsure=d=>open('unsure',{i:+d.i});
ACT.playscale=d=>{playTrack(LIB[+d.i]);return false};
ACT.playpcs=d=>{playPcs(+d.t,scale(+d.t,d.m));return false};
ACT.confirm=d=>{const t=LIB[+d.i];if(d.which==='b'){const u=t.unsure;Object.assign(t,T(t.title,t.artist,t.bpm,t.dur,u.altT,u.alt,t.e),{id:t.id,genre:t.genre,curve:t.curve})}
 if(d.which!=='skip')delete t.unsure;S.ov=null;toast(d.which==='skip'?'Kept as unsure: it still shows with a ?':`Saved: ${esc(t.title)} is ${name(t)}`)};

// E7 Build while listening: the player's queue is the set. The crate gains a "Fits next" tab,
// the transition popover gains a harmony section, and Autopilot keeps the queue going along an arc.

let PQ;
RESET.push(()=>{PQ={tr:['Farewell','No Way Out','These Days','Wanna','Noir','Statues'].map(ix),now:2,crate:'fits',ap:false,apPreset:0,mix:32}});
const QUEUE_NOW=()=>PQ&&LIB[PQ.tr[PQ.now]];
const qTracks=()=>PQ.tr.map(i=>LIB[i]);
function apGhosts(){if(!PQ.ap)return[];const arc=PRESETS[PQ.apPreset][1],last=LIB[PQ.tr.at(-1)];return buildArc(arc,14,last,PQ.tr).slice(1,4)}
function crateList(){const t=LIB[PQ.tr.at(-1)];return PQ.crate==='fits'?rankAfter(t,{...FILTER_DEF,genre:'any',tempo:'any'},PQ.tr).slice(0,12):POOL().filter(x=>!PQ.tr.includes(x.id)).slice(0,12)}
function timeline(w,dev){const tr=qTracks().slice(PQ.now),tot=tr.reduce((s,t)=>s+t.dur,0);let x=0,s=`<svg class="tline" width="${w}" height="70">`;const pos=[];
 tr.forEach((t,k)=>{const x0=x/tot*w,x1=(x+t.dur)/tot*w;s+=`<rect x="${x0+1}" y="14" width="${x1-x0-2}" height="44" rx="6" fill="${t.col}" opacity="${k?.28:.5}"/>`;
  const c=t.curve,bw=(x1-x0-2)/c.length;s+=c.map((v,q)=>`<rect x="${x0+1+q*bw}" y="${58-v*40}" width="${Math.max(.5,bw-.6)}" height="${v*40}" fill="${t.col}" opacity=".55"/>`).join('');
  s+=`<text x="${x0+6}" y="10" class="lt">${esc(t.title.slice(0,dev==='d'?22:12))}</text>`;if(k)pos.push([x0,PQ.now+k]);x+=t.dur});
 s+=`<rect x="${w*.08}" y="10" width="2" height="52" fill="var(--tx)"/>`;
 pos.forEach(([px,j])=>{const a=LIB[PQ.tr[j-1]],b=LIB[PQ.tr[j]],ji=joinInfo(a,b);s+=`<circle cx="${px}" cy="36" r="${dev==='d'?8:10}" fill="var(--bg)" stroke="var(--${ji.cls==='clash'?'warn':ji.cls})" stroke-width="2.5" data-a="open" data-k="pjoin" data-o='{"j":${j}}' style="cursor:pointer"/>`});
 return s+'</svg>'}
function nowCard(dev){const t=QUEUE_NOW();return `<div class="now"><div class="art" style="background:linear-gradient(135deg,${t.col},#0b1520)"></div><div><div class="cap">Now playing</div><h2>${esc(t.title)}</h2><div class="mut">${esc(t.artist)} · ${t.bpm} BPM · ${GS[t.genre]}</div><div style="margin-top:6px">${keyLabel(t)} ${emeter(t)}</div></div></div>`}
function queueCol(dev){const tr=qTracks();let h='';tr.forEach((t,k)=>{if(k<PQ.now)return;if(k>PQ.now)h+=joinLine(tr[k-1],t,{cmp:dev==='p',a2:{a:'open',k:'pjoin',o:{j:k}}});h+=trow(t,{meta:false,cls:k===PQ.now?'sel':'',tail:`<span class="k2">${keyLabel(t)}</span>`})});
 const g=apGhosts();let prev=tr.at(-1);g.forEach(t=>{h+=joinLine(prev,t,{cmp:true})+trow(t,{meta:false,cls:'ghost2',tail:'<span class="mut sm">Autopilot</span>'});prev=t});
 return `<div class="qh"><b>Queue</b><span style="flex:1"></span><span class="sw2 ${PQ.ap?'on':''}" data-a="apt"></span><span class="sm">Autopilot</span>${tg('E7.3')}</div>
 ${PQ.ap?`<div class="chips wrap" style="padding:0 0 8px">${PRESETS.map(([n],k)=>`<span class="chip ${PQ.apPreset===k?'on':''}" data-a="apP" data-k="${k}">${n}</span>`).join('')}</div>`:''}<div class="scroll qlist" data-keep="q${dev}">${h}</div>`}
function crate(dev){const list=crateList(),last=LIB[PQ.tr.at(-1)];
 return `<div class="crate"><div class="crh">${seg([['lib','Library'],['fits','Fits next']],PQ.crate,'crt')}${tg('E7.1')}<span class="mut sm">${PQ.crate==='fits'?`after ${esc(last.title)}, the last in the queue`:'all tracks'}</span></div>
 <div class="${dev==='d'?'shelf':'scroll'}" ${dev==='p'?'style="max-height:330px"':''} data-keep="cr${dev}">${list.map(t=>{const j=joinInfo(last,t);return dev==='d'?`<div class="card" data-a="qadd" data-i="${t.id}"><div class="cart" style="background:linear-gradient(160deg,${t.col},#0b1520)">${PQ.crate==='fits'?`<span class="why f-${j.cls}">${fitDot(j.cls)}${j.lbl}</span>`:''}</div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>`
  :`<div class="tr ph" data-a="qadd" data-i="${t.id}">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${PQ.crate==='fits'?`${fitDot(j.cls)}${j.lbl} · energy ${j.e}`:esc(t.artist)}</span></div><span class="add">${I('plus')}</span></div>`}).join('')}</div></div>`}
SCR.player={slim:true,deep:true,noTabs:true,title:()=>'Playing',
 d:()=>`<div class="plr"><div class="plm">${nowCard('d')}<div class="tlw">${timeline(760,'d')}${tg('E7.2')}<div class="mut sm">Circles are the joins: green flows, blue next door, amber clashes. Click one for the transition.</div></div>
  <div class="transport">${I('l')}<span class="pbtn">${I('pause')}</span>${I('r')}</div>${crate('d')}</div><div class="plq">${queueCol('d')}</div></div>`,
 p:()=>`<div class="ppad">${nowCard('p')}</div><div class="ppad">${timeline(350,'p')}${tg('E7.2')}</div><div class="transport">${I('l')}<span class="pbtn">${I('pause')}</span>${I('r')}</div>
  <div class="row-btns ppad">${btn(I('list')+'Queue','open',{k:'pqueue'})}${btn(I('plus')+'Add','open',{k:'pcrate'},'solid')}${tg('E7.1')}</div>`};
OV.pqueue={p:()=>queueCol('p')};
OV.pcrate={p:()=>crate('p')};
OV.pjoin={d:o=>{const a=LIB[PQ.tr[o.j-1]],b=LIB[PQ.tr[o.j]],j=joinInfo(a,b);const alt=rankAfter(a,{...FILTER_DEF,genre:'any'},PQ.tr).slice(0,3);
 return `<div class="ovh"><b>${esc(a.title)} → ${esc(b.title)}</b>${tg('E7.2')}<span style="flex:1"></span><span class="ib" data-a="close">${I('x')}</span></div>
 <div class="cap">Mix (existing)</div><div class="opts"><span class="fl">Length</span>${seg([[16,'16 bars'],[32,'32 bars'],[64,'64 bars']],PQ.mix,'pmix')}<span class="fl">Beat sync</span><span class="sw2 on"></span></div>
 <div class="cap">Harmony (new)</div><div class="hj f-${j.cls}"><b style="color:var(--fc)">${j.lbl}</b> · ${j.n} of 7 notes · ${a.word} → ${b.word} · energy ${j.e}${j.tj?' · <span class="tj">tempo jump</span>':''}</div>
 ${kbd(a.pcs,a.t,{cmp:b.pcs,w:260})}${j.cls!=='great'?`<div class="cap">Smoother next tracks</div>${alt.map(t=>`<div class="cand">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${fitDot(kind(a,t).cls)}${kind(a,t).lbl}</span></div>${btn('Use instead','qswap',{j:o.j,i:t.id})}</div>`).join('')}`:''}
 <div class="row-btns">${btn(I('headph')+'Hear the change','hear',{a:a.id,b:b.id})}</div>`}};
ACT.crt=d=>{PQ.crate=d.val};ACT.apt=()=>{PQ.ap=!PQ.ap};ACT.apP=d=>{PQ.apPreset=+d.k};ACT.pmix=d=>{PQ.mix=+d.val};
ACT.qadd=d=>{PQ.tr.push(+d.i);toast(`Queued ${esc(LIB[+d.i].title)}`)};
ACT.qswap=d=>{PQ.tr[+d.j]=+d.i;S.ov=null;toast('Swapped in the queue')};
ACT.playnow=d=>{PQ.tr.splice(PQ.now+1,0,+d.i);PQ.now++;S.ov=null;toast(`Playing ${esc(LIB[+d.i].title)}`)};
ACT.queueadd=d=>{PQ.tr.push(+d.i);S.ov=null;toast(`Queued ${esc(LIB[+d.i].title)}`)};

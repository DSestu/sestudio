// E3 Joins in the set editor · E4 "Fits next" inspector.
// Extends the existing PlaylistView (sets) with join lines, join details, clash fixes,
// a three-lane set curve and a harmonic auto-order; the inspector is a panel on desktop, a sheet on phone.

let SETS,SE;
RESET.push(()=>{SETS=[{name:'Friday set',tr:['Farewell','No Way Out','These Days','Wanna','Noir','Statues','Suicide Bassline VIP','Supersonic'].map(ix),allow:[]},
 {name:'Sunday chill',tr:['Farewell','You left me','Hear The Lies','Elysium','Stargazer'].map(ix),allow:[]}];SE={sel:null,join:null,insp:true,tab:'fits'}});
const curSet=()=>SETS[S.route.id??0];
const setTracks=s=>s.tr.map(i=>LIB[i]);
function setTarget(){const s=curSet(),tr=setTracks(s);
 if(SE.join!=null&&SE.join>0&&SE.join<tr.length)return{kind:'between',a:tr[SE.join-1],b:tr[SE.join],at:SE.join};
 const j=SE.sel??tr.length-1;return{kind:'after',a:tr[j],at:j+1}}

/** Energy (solid), mood (dashed) and genre (ribbon) across the set, with clashes marked. */
function setCurve(list,w,{h=96,mark=true}={}){if(!list.length)return '';const tot=list.reduce((s,t)=>s+t.dur,0);let x=0;const pts=[],mp=[],blocks=[],ticks=[];
 const yE=v=>6+(1-v)*46,yM=b=>58+(3-b)/6*20;
 list.forEach((t,k)=>{const x0=x/tot*w,x1=(x+t.dur)/tot*w,xm=(x0+x1)/2;pts.push(`${xm.toFixed(1)},${yE(t.e).toFixed(1)}`);mp.push(`${xm.toFixed(1)},${yM(t.br).toFixed(1)}`);
  blocks.push(`<rect x="${x0+.5}" y="${h-12}" width="${Math.max(1,x1-x0-1)}" height="9" rx="3" fill="${GCOL[t.genre]}" opacity=".55"/>`);
  if(k&&mark){const j=joinInfo(list[k-1],t);if(j.cls==='clash'||j.tj)ticks.push(`<line x1="${x0}" x2="${x0}" y1="2" y2="${h-14}" stroke="var(--warn)" stroke-dasharray="2 3"/>`)}x+=t.dur});
 return `<svg class="scurve" width="${w}" height="${h}">${ticks.join('')}<polyline points="${pts.join(' ')}" fill="none" stroke="var(--tx)" stroke-width="2"/>
 <polyline points="${mp.join(' ')}" fill="none" stroke="oklch(78% .13 330)" stroke-width="1.6" stroke-dasharray="4 3"/>${blocks.join('')}
 <text x="2" y="12" class="lt">Energy</text><text x="2" y="62" class="lt">Mood</text><text x="2" y="${h-15}" class="lt">Genre</text></svg>`}

function harmonicOrder(ids){const rest=ids.map(i=>LIB[i]),out=[rest.shift()];while(rest.length){const a=out.at(-1);rest.sort((x,y)=>score(a,x)-score(a,y));out.push(rest.shift())}return out.map(t=>t.id)}
function setRows(dev){const s=curSet(),tr=setTracks(s);let h='';
 tr.forEach((t,j)=>{if(j){const allowed=s.allow.includes(j);h+=`<div class="jwrap${SE.join===j?' on':''}">${joinLine(tr[j-1],t,{fix:allowed?null:{a:'open',k:'fix',o:{j}},a2:{a:'open',k:'join',o:{j}}})}${allowed?'<span class="mut sm">allowed</span>':''}<span class="jins" data-a="between" data-j="${j}" title="Fits between">${I('plus')}</span>${j===1?tg('E3.1')+tg('E4.2'):''}${j===5?tg('E3.3'):''}</div>`}
  h+=`<div data-drop="set:${j}">${trow(t,{num:j+1,cls:SE.sel===j&&SE.join==null?'sel':'',a:{a:'selrow',j},drag:dev==='d'?`set:${j}`:null,meta:dev==='d',tail:`<span class="d tab mut">${fmt(t.dur)}</span><span class="ib sm" data-a="rmset" data-j="${j}">${I('x')}</span>`})}</div>`});
 return h}
DROP.set=(d,p)=>{if(d[0]!=='set')return;const s=curSet(),from=+d[1];let to=+p[1];const [x]=s.tr.splice(from,1);if(from<to)to--;s.tr.splice(to,0,x)};

function inspBody(dev){const tgt=setTarget(),s=curSet(),inSet=s.tr;
 const tabs=seg([['fits','Fits next'],['notes','Notes'],['vibe','Vibe']],SE.tab,'itab');
 const head=tgt.kind==='between'?`<div class="ih">${tg('E4.2')}Fits between <b>${esc(tgt.a.title)}</b> and <b>${esc(tgt.b.title)}</b><span class="lnk" data-a="unjoin">after the selection instead</span></div>`
  :`<div class="ih">Fits after <b>${esc(tgt.a.title)}</b> <span class="mut">· select a row or a join to change</span></div>`;
 let body='';
 if(SE.tab==='fits'){const c=tgt.kind==='between'?bridges(tgt.a,tgt.b,inSet):rankAfter(tgt.a,{...FILTER_DEF,genre:'any',tempo:'any'},inSet);
  body=c.slice(0,dev==='d'?14:10).map(t=>{const j1=joinInfo(tgt.a,t),j2=tgt.b?joinInfo(t,tgt.b):null;
   return `<div class="cand">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${fitDot(j1.cls,j1.lbl)}${j1.lbl}${j2?` · then ${fitDot(j2.cls,j2.lbl)}${j2.lbl}`:` · energy ${j1.e}`}${j1.tj?' · <em class="tj">tempo</em>':''}</span></div>${keyLabel(t)}<span class="add" data-a="insert" data-i="${t.id}" data-at="${tgt.at}">${I('plus')}</span></div>`}).join('')||`<div class="empty">${tg('E10.3')}<b>Nothing fits both sides.</b><p>Try a two-track bridge.</p>${btn(I('link')+'Bridge with 2 tracks','wiz',{kind:'bridge'})}</div>`}
 else if(SE.tab==='notes'){const t=tgt.a,fam=family(t);body=`${tg('E4.3')}<div class="big" style="color:${t.col}">${t.word} <span class="mut sm">${name(t)}</span></div>${kbd(t.pcs,t.t,{w:dev==='d'?260:330})}
  <div class="cap">Same notes, other centres</div><div class="fam">${fam.map(f=>`<span style="--mc:${COL[f.br]}">${NOTE[f.t]} ${f.mode}</span>`).join('')}</div>
  <div class="cap">In your library</div><div class="sm">${POOL().filter(x=>shared(x,t)===7).length} tracks share all 7 notes · ${POOL().filter(x=>shared(x,t)===6).length} share 6</div>`}
 else{body=`${tg('E4.4')}${vibeMini(setTracks(s),tgt.a,dev==='d'?262:330)}<div class="mut sm">Across: mood, from Unstable to Floating. Up: energy. The line is the set; ringed is the selection; faint dots fit after it.</div>`}
 return `<div class="insp-in"><div style="display:flex;gap:6px;align-items:center">${tabs}${tg('E4.1')}</div>${head}<div class="scroll ib2" data-keep="insp${dev}">${body}</div></div>`}
function vibeMini(list,sel,w){const h=w*.7,X=b=>12+(b+3)/6*(w-24),Y=e=>h-10-e*(h-20);const fits=rankAfter(sel,{...FILTER_DEF,genre:'any',tempo:'any'}).slice(0,10);
 return `<svg width="${w}" height="${h}" class="vmini"><rect x="0" y="0" width="${w}" height="${h}" rx="10" fill="rgba(255,255,255,.03)"/>${fits.map(t=>`<circle cx="${X(t.br)+jit(t.id)*10-5}" cy="${Y(t.e)}" r="4" fill="${t.col}" opacity=".35"/>`).join('')}
 <polyline points="${list.map(t=>`${X(t.br)+jit(t.id)*10-5},${Y(t.e)}`).join(' ')}" fill="none" stroke="rgba(227,234,240,.5)" stroke-width="1.4"/>${list.map(t=>`<circle cx="${X(t.br)+jit(t.id)*10-5}" cy="${Y(t.e)}" r="4.5" fill="${t.col}"/>`).join('')}
 <circle cx="${X(sel.br)+jit(sel.id)*10-5}" cy="${Y(sel.e)}" r="8" fill="none" stroke="var(--p)" stroke-width="2"/></svg>`}

function setHead(dev){const s=curSet(),st=setStats(setTracks(s));
 return `<div class="sh"><div><h2>${esc(s.name)}</h2><div class="mut sm tab">${st.n} tracks · ${fmt(st.d)} · ${st.cl?`<span class="tj">${st.cl} clash${st.cl>1?'es':''}</span>`:'no clash'}${st.tj?` · <span class="tj">${st.tj} tempo jump${st.tj>1?'s':''}</span>`:''}</div></div><span style="flex:1"></span>
 ${dev==='d'?`<span class="mut sm">Auto-order</span>${seg([['harm','Harmonic path'],['tempo','Tempo'],['energy','Energy']],SE.order||'','order')}${tg('E3.5')}${btn(I('cols')+'Open in mix builder','tobuilder')}${tg('E5.9')}${btn(I('wand')+'Build…','wiz',{},'solid')}${btn(I('help'),'nav',{v:'learn',p:{step:0}},'sq')}${btn(I('list')+(SE.insp?'Hide':'Show')+' inspector','toginsp')}`:''}</div>`}
function firstTip(){const tr=setTracks(curSet());if(!S.tip||!tr.some((t,k)=>k&&kind(tr[k-1],t).cls==='clash'))return '';
 return `<div class="tip">${tg('E9.3')}<b>Amber joins clash.</b> The two tracks share 5 notes or fewer, so the overlap can sound off. Tap <b>Fix</b> for a bridge track, or keep it if you like the tension.<div class="row-btns">${btn('Got it','tipoff')}${btn(I('book')+'Why?','nav',{v:'learn',p:{step:4}})}</div></div>`}
SCR.set={deep:true,noTabs:true,title:()=>esc(curSet().name),pact:()=>`<span class="ib" data-a="open" data-k="setmenu">${I('dots')}</span>`,
 d:()=>musicShell('tracks',`<div class="setv${SE.insp?' wi':''}"><div class="setm">${setHead('d')}${firstTip()}<div class="curvewrap">${tg('E3.4')}${setCurve(setTracks(curSet()),SE.insp?500:800)}</div><div class="scroll setl" data-keep="setl">${setRows('d')}</div></div>
  ${SE.insp?`<div class="insp">${inspBody('d')}</div>`:''}</div>`),
 p:()=>`<div class="ppad">${setHead('p')}</div>${firstTip()}<div class="ppad">${tg('E3.4')}${setCurve(setTracks(curSet()),350,{h:80})}</div><div class="plist" style="padding-bottom:70px">${setRows('p')}</div>
  <div class="pbar2">${btn(I('link')+'Fits next','open',{k:'insp'},'solid')}${tg('E4.1')}${btn(I('wand')+'Build','wiz')}${btn(I('cols')+'Mix builder','tobuilder')}</div>`};
OV.insp={full:false,p:()=>inspBody('p')};
OV.setmenu={p:()=>`<div class="ovh"><b>${esc(curSet().name)}</b></div><div class="menu"><div class="mi">${tg('E3.5')}Auto-order</div><div style="padding:0 12px 10px">${seg([['harm','Harmonic path'],['tempo','Tempo'],['energy','Energy']],SE.order||'','order')}</div>
 <div class="mi" data-a="nav" data-v="learn" data-p='{"step":0}'>${I('book')}Harmony basics</div><div class="mi" data-a="tobuilder">${I('cols')}Open in mix builder</div></div>`};

OV.join={d:o=>{const tr=setTracks(curSet()),a=tr[o.j-1],b=tr[o.j],j=joinInfo(a,b);const onlyA=a.pcs.filter(p=>!b.pcs.includes(p)),onlyB=b.pcs.filter(p=>!a.pcs.includes(p));
 const eo=a.curve.at(-1),ei=b.curve[0];
 return `<div class="ovh"><b>${esc(a.title)} → ${esc(b.title)}</b>${tg('E3.2')}<span style="flex:1"></span><span class="ib" data-a="close">${I('x')}</span></div>
 <div class="jd"><div><div class="big f-${j.cls}" style="color:var(--fc)">${j.lbl}</div><div class="mut sm">${j.n} of 7 notes shared${onlyA.length?` · ${onlyA.map(p=>NOTE[p]).join(', ')} in ${esc(a.title)} becomes ${onlyB.map(p=>NOTE[p]).join(', ')}`:''}</div>
 ${kbd(a.pcs,a.t,{cmp:b.pcs,w:300})}<div class="legend sm"><i style="background:var(--great)"></i>shared <i style="background:var(--warn)"></i>only in ${esc(a.title)} <i style="background:var(--p)"></i>only in ${esc(b.title)}</div></div>
 <div class="jdr"><div class="cap">Mood</div><div>${a.word} → ${b.word} <span class="mut sm">(${name(a)} → ${name(b)})</span></div><div class="cap">Energy where they overlap</div>
 <div class="eo"><span>outro</span><i style="width:${eo*100}%"></i></div><div class="eo"><span>intro</span><i style="width:${ei*100}%"></i></div><div class="mut sm">Energy ${j.e} across the join</div>
 <div class="cap">Genre and tempo</div><div>${j.gc?`${GS[a.genre]} → ${GS[b.genre]}`:GS[a.genre]} · ${a.bpm} → ${b.bpm} BPM ${j.tj?'<span class="tj">tempo jump</span>':''}</div></div></div>
 <div class="row-btns">${btn(I('headph')+'Hear the change','hear',{a:a.id,b:b.id})}${j.cls==='clash'?btn('Fix this join','open',{k:'fix',o:{j:o.j}},'solid')+tg('E3.3'):''}${btn(I('book')+'Why does this clash?','nav',{v:'learn',p:{step:4}})}</div>`}};
OV.fix={d:o=>{const s=curSet(),tr=setTracks(s),a=tr[o.j-1],b=tr[o.j];const br=bridges(a,b,s.tr).slice(0,3);
 const trySwap=()=>{const out=[];[[o.j,o.j+1],[o.j-1,o.j-2]].forEach(([x,y])=>{if(y<0||y>=tr.length)return;const ids=[...s.tr];[ids[x],ids[y]]=[ids[y],ids[x]];out.push({x,y,cl:setStats(ids.map(i=>LIB[i])).cl})});return out.sort((p,q)=>p.cl-q.cl)[0]};
 const sw=trySwap(),cl=setStats(tr).cl;
 let best=null;for(let k=1;k<=tr.length;k++){if(k===o.j||k===o.j+1)continue;const ids=s.tr.filter((_,q)=>q!==o.j);ids.splice(k>o.j?k-1:k,0,s.tr[o.j]);const c=setStats(ids.map(i=>LIB[i])).cl;if(!best||c<best.c)best={k,c,ids}}
 return `<div class="ovh"><b>Fix ${esc(a.title)} → ${esc(b.title)}</b>${tg('E3.3')}<span style="flex:1"></span><span class="ib" data-a="close">${I('x')}</span></div>
 <div class="fixo"><div class="cap">Put a bridge between them</div>${br.map(t=>`<div class="cand">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${fitDot(kind(a,t).cls)}${kind(a,t).lbl} · then ${fitDot(kind(t,b).cls)}${kind(t,b).lbl}</span></div>${keyLabel(t)}${btn('Insert','insert',{i:t.id,at:o.j},'solid')}</div>`).join('')||'<div class="mut sm">No single track bridges these two.</div>'}
 <div class="cap">Or reorder</div>${sw?`<div class="cand"><div class="tt"><b>Swap ${esc(LIB[s.tr[sw.x]].title)} and ${esc(LIB[s.tr[sw.y]].title)}</b><span>${cl} → ${sw.cl} clashes</span></div>${btn(I('swap')+'Swap','swap',{x:sw.x,y:sw.y})}</div>`:''}
 ${best?`<div class="cand"><div class="tt"><b>Move ${esc(b.title)} to position ${best.k+1}</b><span>${cl} → ${best.c} clashes</span></div>${btn('Move','moveto',{ids:best.ids.join(',')})}</div>`:''}
 <div class="cap">Or keep the tension</div><div class="cand"><div class="tt"><b>Keep this join</b><span>It stops being flagged; the builder won't change it</span></div>${btn('Keep','allow',{j:o.j})}</div></div>`}};

ACT.selrow=d=>{SE.sel=+d.j;SE.join=null};
ACT.between=(d,el,dev)=>{SE.join=+d.j;SE.tab='fits';if(dev==='p')open('insp')};
ACT.unjoin=()=>{SE.join=null};
ACT.itab=d=>{SE.tab=d.val};
ACT.toginsp=()=>{SE.insp=!SE.insp};
ACT.insert=d=>{const s=S.route.v==='set'?curSet():SETS[0];s.tr.splice(+d.at,0,+d.i);S.ov=null;SE.sel=+d.at;SE.join=null;toast(`Inserted ${esc(LIB[+d.i].title)}`)};
ACT.rmset=d=>{curSet().tr.splice(+d.j,1);SE.sel=null};
ACT.swap=d=>{const s=curSet();[s.tr[+d.x],s.tr[+d.y]]=[s.tr[+d.y],s.tr[+d.x]];S.ov=null;toast('Swapped')};
ACT.moveto=d=>{curSet().tr=d.ids.split(',').map(Number);S.ov=null;toast('Moved')};
ACT.allow=d=>{curSet().allow.push(+d.j);S.ov=null;toast('Kept: this join is no longer flagged')};
ACT.order=d=>{const s=curSet();SE.order=d.val;s.tr=d.val==='harm'?harmonicOrder(s.tr):d.val==='tempo'?[...s.tr].sort((a,b)=>LIB[a].bpm-LIB[b].bpm):[...s.tr].sort((a,b)=>LIB[a].e-LIB[b].e);S.ov=null;toast(`Ordered by ${d.val==='harm'?'harmonic path':d.val}: ${setStats(setTracks(s)).cl} clashes`)};
ACT.hear=d=>{playPcs(LIB[+d.a].t,LIB[+d.a].pcs,{chord:true});setTimeout(()=>playPcs(LIB[+d.b].t,LIB[+d.b].pcs,{chord:true}),1200);return false};
ACT.tipoff=()=>{S.tip=false};
ACT.setadd=d=>{SETS[0].tr.push(+d.i);S.ov=null;toast(`Added to ${SETS[0].name}`)};

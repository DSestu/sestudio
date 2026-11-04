// E6 Build a set: one dialog (desktop) / full sheet (phone) with four ways in:
// from a track, draw the arcs (energy, mood, genre), bridge two tracks, fill a gap.
// Every way ends on the same result panel: try another, add after, replace, or send to a flow.

let WZ,ARCDRAG=null;
RESET.push(()=>{WZ={kind:null,seed:null,len:45,arc:clone(PRESETS[0][1]),preset:0,a:null,b:null,steps:1,gap:null,flow:null,q:''}});
const APAD=22;
const wzTarget=()=>WZ.flow!=null?`${esc(bc().lanes[WZ.flow].name)}`:esc(SETS[0].name);
function wzResult(){if(WZ.kind==='seed'&&WZ.seed!=null)return buildArc(WZ.arc,WZ.len,LIB[WZ.seed]);
 if(WZ.kind==='arcs')return buildArc(WZ.arc,WZ.len);
 if(WZ.kind==='bridge'&&WZ.a!=null&&WZ.b!=null){const a=LIB[WZ.a],b=LIB[WZ.b];return [a,...bridgePath(a,b,WZ.steps),b]}
 if(WZ.kind==='gap'&&WZ.gap!=null){const s=SETS[0],a=LIB[s.tr[WZ.gap-1]],b=LIB[s.tr[WZ.gap]];return [a,...bridgePath(a,b,WZ.steps,s.tr),b]}
 return []}
const KINDS=[['seed','From a track','Pick one track, a length and a shape. The set grows from it.','E6.2',I('music')],['arcs','Draw the arcs','Draw energy, mood and genre over time. The set follows your lines.','E6.3',I('arc')],
 ['bridge','Bridge two tracks','Pick where you are and where you want to land. Get the smoothest path.','E6.6',I('link')],['gap','Fill a gap','Pick a clashing join in your set and fill it with tracks that fit both sides.','E6.7',I('plus')]];
function chooser(){return `<div class="kinds">${KINDS.map(([k,t,d,id,i])=>`<div class="kind" data-a="wkind" data-kind="${k}">${i}<b>${t}</b><span>${d}</span>${tg(id)}</div>`).join('')}</div>`}
const lenSeg=()=>`<span class="fl">Length</span>${seg([[30,'30 min'],[45,'45 min'],[60,'60 min']],WZ.len,'wlen')}`;
const presetChips=()=>`<div class="chips wrap">${tg('E6.4')}${PRESETS.map(([n],k)=>`<span class="chip ${WZ.preset===k?'on':''}" data-a="wpreset" data-k="${k}">${n}</span>`).join('')}<span class="chip ${WZ.preset<0?'on':''}">Custom</span></div>`;
function arcEditor(dev){const w=dev==='d'?600:346,X=x=>APAD+x*(w-2*APAD),{E,M,G}=WZ.arc,res=wzResult(),tot=res.reduce((s,t)=>s+t.dur,0)||1,Lx=Math.max(tot,WZ.len*60);
 const yE=v=>14+(1-v)*96,yM=b=>128+(3-b)/6*60;let s=`<svg class="arcsvg" data-arcsvg="${dev}" width="${w}" height="246" viewBox="0 0 ${w} 246">`;
 [['ENERGY',14,96],['MOOD',128,60],['GENRE',204,28]].forEach(([l,y,h])=>{s+=`<rect x="${APAD}" y="${y}" width="${w-2*APAD}" height="${h}" rx="8" fill="rgba(255,255,255,.035)"/><text x="${APAD+6}" y="${y+12}" class="lt">${l}</text>`});
 [3,0,-3].forEach(b=>{s+=`<text x="${w-APAD-4}" y="${yM(b)+3}" text-anchor="end" class="lt">${WORD[b]}</text>`});
 let x=0;res.forEach(t=>{const x0=X(x/Lx),x1=X((x+t.dur)/Lx);s+=`<rect x="${x0+1}" y="${yE(t.e)}" width="${Math.max(2,x1-x0-2)}" height="${110-yE(t.e)}" rx="3" fill="rgba(227,234,240,.12)"/><rect x="${x0+1}" y="${yM(t.br)-3}" width="${Math.max(2,x1-x0-2)}" height="6" rx="3" fill="${t.col}" opacity=".85"/><rect x="${x0+1}" y="236" width="${Math.max(2,x1-x0-2)}" height="5" rx="2" fill="${GCOL[t.genre]}"/>`;x+=t.dur});
 s+=`<polyline points="${E.map((v,k)=>`${X(k/6)},${yE(v)}`).join(' ')}" fill="none" stroke="var(--tx)" stroke-width="2.2"/><polyline points="${M.map((v,k)=>`${X(k/6)},${yM(v)}`).join(' ')}" fill="none" stroke="oklch(78% .13 330)" stroke-width="2" stroke-dasharray="5 4"/>`;
 E.forEach((v,k)=>{s+=`<circle cx="${X(k/6)}" cy="${yE(v)}" r="${dev==='d'?7:9}" fill="var(--bg)" stroke="var(--tx)" stroke-width="2.2" data-arc="E:${k}" class="hdl"/>`});
 M.forEach((v,k)=>{s+=`<circle cx="${X(k/6)}" cy="${yM(v)}" r="${dev==='d'?6:8}" fill="var(--bg)" stroke="oklch(78% .13 330)" stroke-width="2" data-arc="M:${k}" class="hdl"/>`});
 let g0=0;G.forEach((sg,k)=>{s+=`<rect x="${X(g0)+1}" y="206" width="${Math.max(4,X(sg.x1)-X(g0)-2)}" height="24" rx="6" fill="${GCOL[sg.g]}" opacity=".3" data-a="gcycle" data-k="${k}" style="cursor:pointer"/><text x="${(X(g0)+X(sg.x1))/2}" y="222" text-anchor="middle" class="gt" pointer-events="none">${GS[sg.g]}</text>`;
  if(k<G.length-1)s+=`<rect x="${X(sg.x1)-4}" y="202" width="8" height="32" rx="3" fill="var(--tx)" data-arc="G:${k}" class="hdl" style="cursor:ew-resize"/>`;g0=sg.x1});
 return s+'</svg>'}
function resultPanel(dev){const res=wzResult();if(!res.length)return '';const st=setStats(res);
 const apply=WZ.kind==='gap'?btn('Insert into '+esc(SETS[0].name),'wapply',{m:'gap'},'solid'):WZ.flow!=null?btn('Fill '+wzTarget(),'wapply',{m:'flow'},'solid'):
  `${btn(dev==='d'?'Add after '+esc(SETS[0].name):'Append','wapply',{m:'append'})}${btn(dev==='d'?'Replace '+esc(SETS[0].name):'Replace','wapply',{m:'replace'})}${btn(dev==='d'?'New flow in mix builder':'New flow','wapply',{m:'newflow'},'solid')}`;
 return `<div class="wres"><div class="sm mut tab">${tg('E6.5')}${tg('E0.6')}${st.n} tracks · ${fmt(st.d)} · ${st.cl?`<span class="tj">${st.cl} clash${st.cl>1?'es':''}</span>`:'no clash'}${st.tj?` · <span class="tj">${st.tj} tempo jump${st.tj>1?'s':''} at genre changes</span>`:''}</div>
 <div class="scroll wlist" data-keep="wl${dev}">${res.map((t,k)=>(k?joinLine(res[k-1],t,{cmp:dev==='p'}):'')+`<div class="tr sm3">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>${keyLabel(t)}${gchip(t.genre)}</div>`).join('')}</div>
 <div class="row-btns">${WZ.kind==='seed'||WZ.kind==='arcs'?btn(I('shuf')+(dev==='d'?'Try another':''),'wshuf'):''}<span style="flex:1"></span>${apply}${tg('E6.8')}</div></div>`}
function pickList(sel,act,dev){const q=WZ.q.toLowerCase();return `<label class="srch sm2">${I('search')}<input data-id="wq${dev}" data-input="wq" value="${esc(WZ.q)}" placeholder="Search a track…"></label><div class="scroll plk" data-keep="wpk${dev}">${POOL().filter(t=>!q||t.title.toLowerCase().includes(q)||t.artist.toLowerCase().includes(q)).slice(0,30).map(t=>`<div class="tr sm3${sel===t.id?' sel':''}" data-a="${act}" data-i="${t.id}">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>${keyLabel(t)}</div>`).join('')}</div>`}
function wzBody(dev){const back=`<span class="lnk" data-a="wkind" data-kind="">${I('l')} Ways to build</span>`;
 const head=(t,id)=>`<div class="ovh">${WZ.kind?back:''}<b>${t}</b>${tg(id)}<span style="flex:1"></span>${WZ.flow!=null?`<span class="mut sm">for ${wzTarget()}</span>`:''}<span class="ib" data-a="close">${I('x')}</span></div>`;
 if(!WZ.kind)return head('Build a set','E6.1')+chooser();
 if(WZ.kind==='arcs')return head('Draw the arcs','E6.3')+`${presetChips()}<div class="opts">${lenSeg()}<span class="btn xs" data-a="gadd">${I('plus')}Genre change</span><span class="mut sm">Drag the dots · click a genre block to change it</span></div>
  <div class="${dev==='d'?'wgrid':''}"><div>${arcEditor(dev)}</div>${resultPanel(dev)}</div>`;
 if(WZ.kind==='seed'){const t=WZ.seed!=null?LIB[WZ.seed]:null;return head('From a track','E6.2')+(t?`<div class="seedh">${mdot(t)}<b>${esc(t.title)}</b>${keyLabel(t)}<span class="lnk" data-a="wseed" data-i="">change</span></div><div class="opts">${lenSeg()}<span class="fl">Shape</span>${seg(PRESETS.map(([n],k)=>[k,n.split(' ')[0]==='Warm-up'?'Peak':n]),WZ.preset,'wpreset','k')}</div>${resultPanel(dev)}`:`<div class="mut sm">Start from…</div>${pickList(null,'wseed',dev)}`)}
 if(WZ.kind==='bridge'){const a=WZ.a!=null?LIB[WZ.a]:null,b=WZ.b!=null?LIB[WZ.b]:null;
  return head('Bridge two tracks','E6.6')+`<div class="opts"><span class="refchip${WZ.pick==='a'?' on':''}" data-a="wpick" data-w="a">From: ${a?esc(a.title):'pick'}</span>${I('r')}<span class="refchip${WZ.pick==='b'?' on':''}" data-a="wpick" data-w="b">To: ${b?esc(b.title):'pick'}</span><span class="fl">Tracks between</span>${seg([[1,'1'],[2,'2'],[3,'3']],WZ.steps,'wsteps')}</div>
  ${WZ.pick?pickList(WZ.pick==='a'?WZ.a:WZ.b,'wab',dev):a&&b?(wzResult().length>2?resultPanel(dev):`<div class="empty">${tg('E10.3')}<b>No path with ${WZ.steps} track${WZ.steps>1?'s':''}.</b><p>Try more tracks between.</p></div>`):''}`}
 if(WZ.kind==='gap'){const s=SETS[0],tr=setTracks(s),gaps=tr.map((t,k)=>k&&kind(tr[k-1],t).cls==='clash'?k:0).filter(Boolean);
  return head('Fill a gap','E6.7')+`<div class="mut sm">Clashing joins in ${esc(s.name)}</div><div class="chips wrap">${gaps.map(k=>`<span class="chip ${WZ.gap===k?'on':''}" data-a="wgap" data-k="${k}">${esc(tr[k-1].title)} → ${esc(tr[k].title)}</span>`).join('')||'<span class="mut sm">No clash left. Nice.</span>'}</div>
  ${WZ.gap!=null?`<div class="opts"><span class="fl">Fill with</span>${seg([[1,'1 track'],[2,'2 tracks'],[3,'3 tracks']],WZ.steps,'wsteps')}</div>${resultPanel(dev)}`:''}`}}
OV.wizard={wide:true,full:true,d:()=>wzBody('d'),p:()=>wzBody('p')};

ACT.wiz=d=>{WZ.kind=d.kind||null;WZ.flow=d.flow!=null&&d.flow!==''?+d.flow:null;WZ.seed=d.seed!=null&&d.seed!==''?+d.seed:WZ.seed;WZ.pick=null;WZ.q='';
 if(WZ.kind==='bridge'&&WZ.a==null){WZ.a=ix('Noir');WZ.b=ix('Statues')}open('wizard')};
ACT.wkind=d=>{WZ.kind=d.kind||null;WZ.pick=null;if(WZ.kind==='bridge'&&WZ.a==null){WZ.a=ix('Noir');WZ.b=ix('Statues')}if(WZ.kind==='gap'&&WZ.gap==null){const tr=setTracks(SETS[0]);WZ.gap=tr.findIndex((t,k)=>k&&kind(tr[k-1],t).cls==='clash');if(WZ.gap<1)WZ.gap=null}};
ACT.wlen=d=>{WZ.len=+d.val};
ACT.wpreset=d=>{WZ.preset=+d.k;WZ.arc=clone(PRESETS[+d.k][1])};
ACT.wshuf=()=>{hashSeed++};
ACT.wseed=d=>{WZ.seed=d.i===''?null:+d.i};
ACT.wq=v=>{WZ.q=v};
ACT.wpick=d=>{WZ.pick=WZ.pick===d.w?null:d.w;WZ.q=''};
ACT.wab=d=>{WZ[WZ.pick]=+d.i;WZ.pick=null};
ACT.wsteps=d=>{WZ.steps=+d.val};
ACT.wgap=d=>{WZ.gap=+d.k};
ACT.gcycle=d=>{const sg=WZ.arc.G[+d.k];sg.g=GENRES[(GENRES.indexOf(sg.g)+1)%GENRES.length];WZ.preset=-1};
ACT.gadd=()=>{const G=WZ.arc.G;let k=0,best=0,g0=0;G.forEach((s,i)=>{const w=s.x1-(i?G[i-1].x1:0);if(w>best){best=w;k=i;g0=i?G[i-1].x1:0}});const mid=g0+best/2;G.splice(k,0,{g:G[k].g,x1:mid});G[k+1].g=GENRES[(GENRES.indexOf(G[k].g)+1)%GENRES.length];WZ.preset=-1};
ACT.wapply=d=>{const res=wzResult(),ids=res.map(t=>t.id),s=SETS[0];
 if(d.m==='append'){ids.forEach(i=>{if(!s.tr.includes(i))s.tr.push(i)});nav('set',{id:0});toast(`Added ${ids.length} tracks after ${esc(s.name)}`)}
 else if(d.m==='replace'){s.tr=ids;nav('set',{id:0});toast(`${esc(s.name)} replaced`)}
 else if(d.m==='gap'){s.tr.splice(WZ.gap,0,...ids.slice(1,-1));WZ.gap=null;nav('set',{id:0});toast('Gap filled')}
 else if(d.m==='flow'){bc().lanes[WZ.flow].tr=ids;bc().act=WZ.flow;S.ov=null;toast(`Filled ${esc(bc().lanes[WZ.flow].name)}`)}
 else{BLD.mode='A';BLD.A.lanes.push({name:WZ.kind==='arcs'&&WZ.preset>=0?PRESETS[WZ.preset][0].split(' ')[0]:WZ.kind==='bridge'?'Bridge':'Built set',tr:ids});BLD.A.act=BLD.A.lanes.length-1;nav('builder',{mode:'A'});toast('Sent to the mix builder as a new flow')}};

// Arc handles: drag on either device; the SVG is redrawn on every move, so the drag keeps its lane and index, not the element.
document.addEventListener('pointerdown',e=>{const h=e.target.closest('[data-arc]');if(!h)return;e.preventDefault();const svg=h.closest('svg');ARCDRAG={p:h.dataset.arc.split(':'),dev:svg.dataset.arcsvg};dragging=true});
document.addEventListener('pointermove',e=>{if(!ARCDRAG)return;const svg=document.querySelector(`[data-arcsvg="${ARCDRAG.dev}"]`);if(!svg)return;const pt=new DOMPoint(e.clientX,e.clientY).matrixTransform(svg.getScreenCTM().inverse());
 const w=+svg.getAttribute('width'),[lane,k]=[ARCDRAG.p[0],+ARCDRAG.p[1]],A=WZ.arc;
 if(lane==='E')A.E[k]=Math.max(.1,Math.min(1,1-(pt.y-14)/96));else if(lane==='M')A.M[k]=Math.max(-3,Math.min(3,3-(pt.y-128)/60*6));
 else{const x=(pt.x-APAD)/(w-2*APAD),lo=(k?A.G[k-1].x1:0)+.05,hi=A.G[k+1].x1-.05;A.G[k].x1=Math.max(lo,Math.min(hi,x))}WZ.preset=-1;renderDevices()});
document.addEventListener('pointerup',()=>{if(ARCDRAG){ARCDRAG=null;dragging=false;render()}});

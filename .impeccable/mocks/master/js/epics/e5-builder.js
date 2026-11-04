// E5 Mix builder: a music picker beside parallel vertical flows.
// Mode A: separate mixes side by side. Mode B: branches forking from one set, keep one.
// Desktop: picker column + flow columns with drag and drop. Phone: one flow or side by side, picker in a sheet.

let BLD;
const mkLane=(n,list)=>({name:n,tr:list.map(ix)});
RESET.push(()=>{BLD={mode:'A',q:'',g:'All',fitOnly:false,sort:'fit',pv:'one',
 A:{trunk:[],lanes:[mkLane('Peak time',['These Days','Wanna','Noir','Suicide Bassline VIP']),mkLane('Liquid warm-up',['Farewell','No Way Out','You left me','Hear The Lies']),mkLane('Dubstep detour',['Statues',"Sh*t's On F*re","I'm Back"])],act:0},
 B:{trunk:['Farewell','No Way Out','These Days','Wanna','Noir'].map(ix),lanes:[mkLane('Stay DnB',['Suicide Bassline VIP','Supersonic']),mkLane('Dubstep turn',['The First Time','Statues']),mkLane('Pull back',['Stargazer'])],act:0}}});
const LCOL=['oklch(74% .14 230)','oklch(78% .14 150)','oklch(78% .15 60)','oklch(72% .15 320)','oklch(76% .12 20)'];
const bc=()=>BLD[BLD.mode];
const ltail=l=>{const L=bc().lanes[l];return L.tr.length?LIB[L.tr.at(-1)]:bc().trunk.length?LIB[bc().trunk.at(-1)]:null};
const inAnyLane=i=>bc().lanes.findIndex(L=>L.tr.includes(i));
function pfit(a,b){if(!a)return{cls:'great',lbl:'Opens the flow',n:7};return kind(a,b)}
function pickResults(){const q=BLD.q.trim().toLowerCase(),t=ltail(bc().act);
 let r=POOL().filter(x=>{if(BLD.g!=='All'&&x.genre!==BLD.g)return false;if(q&&![x.title,x.artist,name(x),x.word,x.genre,GS[x.genre],x.bpm].join(' ').toLowerCase().includes(q))return false;if(BLD.fitOnly&&t&&kind(t,x).cls==='clash')return false;return !bc().trunk.includes(x.id)});
 if(BLD.sort==='fit')r.sort((a,b)=>score(t,a)-score(t,b));else if(BLD.sort==='bpm')r.sort((a,b)=>a.bpm-b.bpm);else r.sort((a,b)=>a.title.localeCompare(b.title));return r}
function fitSquares(x){return `<span class="fits">${bc().lanes.map((L,l)=>{const f=pfit(ltail(l),x);return `<i class="f-${f.cls}${l===bc().act?' act':''}" title="${esc(L.name)}: ${f.lbl}">${l+1}</i>`}).join('')}</span>`}
function pickRow(x){return `<div class="res${inAnyLane(x.id)>=0?' in':''}" draggable="true" data-drag="lib:${x.id}">${mdot(x)}<div class="tt"><b>${esc(x.title)}</b><span>${esc(x.artist)} · ${S.theory==='theory'?name(x):x.word} · ${x.bpm}</span></div>${gchip(x.genre)}${fitSquares(x)}<span class="add" data-a="badd" data-i="${x.id}">${I('plus')}</span></div>`}
function pickTop(dev){const L=bc().lanes[bc().act];
 return `<label class="srch sm2">${I('search')}<input data-id="bq${dev}" data-input="bq" value="${esc(BLD.q)}" placeholder="Search title, artist, key, mood…">${tg('E5.2')}</label>
 <div class="chips">${['All',...GENRES].map(g=>`<span class="chip ${BLD.g===g?'on':''}" data-a="bg" data-g="${g}">${g==='All'?'All genres':GS[g]}</span>`).join('')}<span class="chip ${BLD.fitOnly?'on':''}" data-a="bfit">Fits ${esc(L.name)}</span></div>
 <div class="sm mut" style="display:flex;align-items:center;gap:8px">Sort ${seg([['fit','Best next'],['bpm','Tempo'],['az','A–Z']],BLD.sort,'bsort')}</div>`}
const legend=()=>`<div class="legend2">${tg('E5.3')}<span class="fits"><i class="f-great">1</i></span>flows well <span class="fits"><i class="f-good">1</i></span>next door <span class="fits"><i class="f-clash">1</i></span>clash · number = flow · faded = already in a flow</div>`;
function bspark(list,w){if(!list.length)return `<svg width="${w}" height="20"></svg>`;const bw=w/Math.max(list.length,6);return `<svg width="${w}" height="20">${list.map((t,k)=>`<rect x="${k*bw+1}" y="${20-t.e*18}" width="${bw-2}" height="${t.e*18}" rx="2" fill="${t.col}" opacity=".85"/>`).join('')}</svg>`}
function flowCol(l,cmp,dev){const c=bc(),L=c.lanes[l],lc=LCOL[l%5],tr=L.tr.map(i=>LIB[i]),fork=BLD.mode==='B'&&c.trunk.length?LIB[c.trunk.at(-1)]:null,st=setStats(fork?[fork,...tr]:tr);
 let prev=fork,body=fork?`<div class="tr trunk">${mdot(fork)}<div class="tt"><b>${esc(fork.title)}</b><span>fork point</span></div></div>`:'';
 tr.forEach((t,j)=>{body+=joinLine(prev,t,{cmp})+`<div data-drop="flow:${l}:${j}">${trow(t,{meta:false,drag:dev==='d'?`fl:${l}:${j}`:null,tail:cmp?'':`<span class="k2">${keyLabel(t)}<em>${t.bpm} · ${GS[t.genre]}</em></span><span class="ib sm x" data-a="brm" data-l="${l}" data-j="${j}">${I('x')}</span>`})}</div>`;prev=t});
 const t=ltail(l),best=POOL().filter(x=>!L.tr.includes(x.id)&&!c.trunk.includes(x.id)).sort((a,b)=>score(t,a)-score(t,b))[0];
 body+=tr.length||fork?`<div class="ghost" data-a="baddto" data-l="${l}" data-i="${best.id}"><span class="add">${I('plus')}</span><div class="tt"><em class="cap">Best next</em><b>${esc(best.title)}</b></div>${l===0?tg('E5.6'):''}</div>`:`<div class="drop">${dev==='d'?'Drag tracks here':'Add from the search below'}</div>`;
 return `<div class="flow${l===c.act?' act':''}" style="--lc:${lc}" data-drop="flow:${l}"><div class="fh" data-a="bact" data-l="${l}"><div class="nm"><i class="bar"></i><span class="tt">${esc(L.name)}</span>${l===0?tg('E5.5'):''}
 ${BLD.mode==='B'?`<span class="btn xs" data-a="bkeep" data-l="${l}">${I('check')}${cmp?'':'Keep'}</span>${l===0?tg('E5.7'):''}`:''}${cmp?'':`<span class="btn xs" data-a="wiz" data-kind="arcs" data-flow="${l}" title="Fill from arcs">${I('arc')}</span>${l===0?tg('E5.10'):''}`}</div>
 <div class="st tab"><span>${st.n-(fork?1:0)} tracks</span>${cmp?'':`<span>${fmt(tr.reduce((s,t)=>s+t.dur,0))}</span>`}${st.cl?`<span class="tj">${st.cl} clash${st.cl>1?'es':''}</span>`:'<span>no clash</span>'}${st.tj&&!cmp?`<span class="tj">${st.tj} tempo</span>`:''}</div>${bspark(tr,cmp?140:216)}</div>
 <div class="flb scroll" data-keep="fl${dev}${l}">${body}</div></div>`}
function trunkBar(){const c=bc();return `<div class="trunkbar">${tg('E5.7')}<span class="cap">Set so far</span>${c.trunk.map((i,k)=>`${k?I('r','arrow'):''}<span class="tc${k===c.trunk.length-1?' fork':''}">${mdot(LIB[i])}${esc(LIB[i].title)}${k===c.trunk.length-1?I('fork'):''}</span>`).join('')}</div>`}
const modeSeg=()=>seg([['A','Mixes side by side'],['B','Branches from one set']],BLD.mode,'bmode');
SCR.builder={slim:true,deep:true,noTabs:true,title:()=>'Mix builder',
 pact:()=>`${seg([['one',I('one')],['cmp',I('cols')]],BLD.pv,'bpv')}${tg('E5.8')}`,
 d:r=>{if(r.mode&&r.mode!==BLD.mode){BLD.mode=r.mode}const c=bc(),res=pickResults();
  return `<div class="bld"><div class="bhead"><span class="ib" data-a="back">${I('l')}</span><h2>Mix builder</h2>${modeSeg()}${tg('E5.1')}<span class="mut sm">Drag from the picker into a flow, or between flows</span>${tg('E5.4')}<span style="flex:1"></span><span class="mut sm">${I('check')} Saved to your account</span>${tg('E0.7')}${btn(I('save')+'Save '+esc(c.lanes[c.act].name)+' as a set','saveflow',{},'solid')}${tg('E5.9')}</div>
  <div class="bgrid"><div class="pick"><div class="ptopd">${pickTop('d')}</div><div class="sm mut" style="padding:0 14px 6px">${res.length} tracks · ranked for <b style="color:${LCOL[c.act%5]}">${esc(c.lanes[c.act].name)}</b></div>
  <div class="scroll" style="flex:1;padding:0 6px" data-keep="pick">${res.map(pickRow).join('')}</div><div style="padding:10px 14px;border-top:1px solid var(--line)">${legend()}</div></div>
  <div class="bright">${BLD.mode==='B'?trunkBar():''}<div class="flows scroll" data-keep="flows">${c.lanes.map((_,l)=>flowCol(l,false,'d')).join('')}<div class="newf" data-a="bnew">${I('plus')} New ${BLD.mode==='A'?'mix':'branch'}</div></div></div></div></div>`},
 p:r=>{if(r.mode&&r.mode!==BLD.mode){BLD.mode=r.mode}const c=bc();
  return `<div class="ppad" style="padding-bottom:6px;display:flex;align-items:center;gap:6px">${modeSeg()}${tg('E0.7')}</div>${BLD.mode==='B'?`<div class="sm mut ppad" style="padding-top:0">${I('fork')} After <b style="color:var(--tx)">${esc(LIB[c.trunk.at(-1)].title)}</b> · ${c.trunk.length} tracks before</div>`:''}
  <div class="chips ppad" style="padding-top:0">${c.lanes.map((L,l)=>`<span class="chip ${l===c.act?'on':''}" style="--lc:${LCOL[l%5]}" data-a="bact" data-l="${l}"><i class="sw"></i>${esc(L.name)} · ${L.tr.length}</span>`).join('')}<span class="chip" data-a="bnew">${I('plus')}</span></div>
  <div class="pflows ${BLD.pv==='one'?'one':'cmp'}" data-keep="pflows">${BLD.pv==='one'?flowCol(c.act,false,'p'):c.lanes.map((_,l)=>flowCol(l,true,'p')).join('')}</div>
  <div class="pbar"><label class="srch" data-a="open" data-k="picker">${I('search')}<span class="mut">Search tracks to add…</span></label>${tg('E5.8')}<span class="btn sq solid" data-a="saveflow" title="Save as set">${I('save')}</span></div>`}};
OV.picker={p:()=>{const c=bc(),L=c.lanes[c.act];return `<div style="display:grid;gap:9px;padding:0 14px 8px">${pickTop('p')}<div class="sm mut">Adding to <span class="chip on" style="--lc:${LCOL[c.act%5]};height:22px" data-a="bcycle"><i class="sw"></i>${esc(L.name)} ${I('r')}</span>${tg('E5.8')}</div></div>
 <div class="scroll" style="max-height:430px;padding:0 6px 10px" data-keep="ppick">${pickResults().map(pickRow).join('')}</div>`}};

function baddTo(l,i,at=null){const L=bc().lanes[l],j=L.tr.indexOf(i);if(j>=0)L.tr.splice(j,1);if(at==null||at>L.tr.length)L.tr.push(i);else L.tr.splice(at,0,i)}
DROP.flow=(d,p)=>{const l=+p[1],c=bc();let at=p[2]!=null?+p[2]:null,i;
 if(d[0]==='lib')i=+d[1];else if(d[0]==='fl'){const fl=+d[1],j=+d[2];i=c.lanes[fl].tr[j];c.lanes[fl].tr.splice(j,1);if(fl===l&&at!=null&&j<at)at--}else return;baddTo(l,i,at);c.act=l};
ACT.bq=v=>{BLD.q=v};ACT.bg=d=>{BLD.g=d.g};ACT.bfit=()=>{BLD.fitOnly=!BLD.fitOnly};ACT.bsort=d=>{BLD.sort=d.val};
ACT.bmode=d=>{BLD.mode=d.val;S.route={...S.route,mode:d.val}};ACT.bpv=d=>{BLD.pv=d.val};
ACT.bact=d=>{bc().act=+d.l};ACT.bcycle=()=>{const c=bc();c.act=(c.act+1)%c.lanes.length};
ACT.badd=(d,el,dev)=>{baddTo(bc().act,+d.i);toast(`Added to ${esc(bc().lanes[bc().act].name)}`)};
ACT.baddto=d=>{baddTo(+d.l,+d.i);bc().act=+d.l};
ACT.brm=d=>{bc().lanes[+d.l].tr.splice(+d.j,1)};
ACT.bnew=()=>{const c=bc();c.lanes.push({name:BLD.mode==='A'?`Mix ${c.lanes.length+1}`:`Branch ${c.lanes.length+1}`,tr:[]});c.act=c.lanes.length-1};
ACT.bkeep=d=>{const c=bc(),L=c.lanes[+d.l],n=L.tr.length;c.trunk.push(...L.tr);c.lanes.forEach(x=>x.tr=[]);c.act=+d.l;toast(`Kept ${esc(L.name)}: ${n} tracks added, the fork moves to ${esc(LIB[c.trunk.at(-1)].title)}`)};
ACT.saveflow=()=>{const c=bc(),L=c.lanes[c.act];SETS.push({name:L.name,tr:[...c.trunk,...L.tr],allow:[]});nav('set',{id:SETS.length-1});toast(`Saved ${esc(L.name)} as a set`)};
ACT.tobuilder=()=>{const s=curSet();BLD.mode='A';const A=BLD.A;let k=A.lanes.findIndex(L=>L.name===s.name);if(k<0){A.lanes.unshift({name:s.name,tr:[...s.tr]});k=0}A.act=k;nav('builder',{mode:'A'})};

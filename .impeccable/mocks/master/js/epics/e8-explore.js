// E8 Explore: Music › Explore, a map of the library. Vibe = mood across × energy up;
// Notes = the circle of note sets (neighbours share 6 notes), mood as the radius. Tap a dot for its card.

let EX;
RESET.push(()=>{EX={view:'vibe',g:'All',path:true,sel:null}});
function exPos(t,w,h){const j=jit(t.id),j2=jit(t.id+50);
 if(EX.view==='vibe')return[24+((t.br+3)/6)*(w-48)+(j-.5)*28,h-22-t.e*(h-44)+(j2-.5)*10];
 const set=t.set||1,a=(set-1)/12*Math.PI*2-Math.PI/2,R=Math.min(w,h)/2-26,r=R*(.32+(t.br+3)/6*.62)+(j-.5)*10;return[w/2+Math.cos(a)*r,h/2+Math.sin(a)*r]}
function exMap(w,h){const pts=POOL().filter(t=>EX.g==='All'||t.genre===EX.g);let s=`<svg class="exmap" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="14" fill="rgba(255,255,255,.025)"/>`;
 if(EX.view==='vibe'){s+=`<text x="24" y="${h-6}" class="lt">Unstable · dark</text><text x="${w-24}" y="${h-6}" text-anchor="end" class="lt">bright · Floating</text><text x="8" y="16" class="lt">Intense ↑</text><text x="8" y="${h-26}" class="lt">Calm</text>`}
 else{const R=Math.min(w,h)/2-26;for(let k=0;k<12;k++){const a=k/12*Math.PI*2-Math.PI/2;s+=`<line x1="${w/2}" y1="${h/2}" x2="${w/2+Math.cos(a)*R}" y2="${h/2+Math.sin(a)*R}" stroke="rgba(255,255,255,.05)"/><text x="${w/2+Math.cos(a)*(R+14)}" y="${h/2+Math.sin(a)*(R+14)+3}" text-anchor="middle" class="lt">${NOTE[(k*7)%12]}</text>`}
  s+=`<circle cx="${w/2}" cy="${h/2}" r="${R*.32}" fill="none" stroke="rgba(255,255,255,.06)"/><circle cx="${w/2}" cy="${h/2}" r="${R*.94}" fill="none" stroke="rgba(255,255,255,.06)"/>`}
 if(EX.path){const tr=setTracks(SETS[0]);s+=`<polyline points="${tr.map(t=>exPos(t,w,h).join(',')).join(' ')}" fill="none" stroke="rgba(227,234,240,.45)" stroke-width="1.5" stroke-dasharray="4 3"/>`}
 pts.forEach(t=>{const[x,y]=exPos(t,w,h),on=EX.sel===t.id,c=EX.view==='vibe'?GCOL[t.genre]:t.col;s+=`<circle cx="${x}" cy="${y}" r="${on?9:6}" fill="${c}" ${on?'stroke="#fff" stroke-width="2"':''} data-a="exsel" data-i="${t.id}" style="cursor:pointer"><title>${esc(t.title)}</title></circle>`});
 if(EX.sel!=null){const t=LIB[EX.sel];rankAfter(t,{...FILTER_DEF,genre:'any',tempo:'any'}).slice(0,5).forEach(c=>{const[a,b]=exPos(t,w,h),[x,y]=exPos(c,w,h);s+=`<line x1="${a}" y1="${b}" x2="${x}" y2="${y}" stroke="var(--great)" stroke-opacity=".5"/>`})}
 return s+'</svg>'}
function exBar(){return `<div class="opts">${tg('E8.1')}${seg([['vibe','Vibe'],['notes','Notes']],EX.view,'exv')}${tg('E8.2')}<div class="chips">${['All',...GENRES].map(g=>`<span class="chip ${EX.g===g?'on':''}" data-a="exg" data-g="${g}">${g==='All'?'All':GS[g]}</span>`).join('')}</div><span class="chip ${EX.path?'on':''}" data-a="expath">${esc(SETS[0].name)} path</span>${tg('E8.4')}</div>`}
function dotCard(){if(EX.sel==null)return `<div class="mut sm" style="padding:14px">Pick a dot. Green lines go to the tracks that fit after it.</div>`;const t=LIB[EX.sel];
 return `<div class="dcard">${tg('E8.3')}<div class="art sm" style="background:linear-gradient(135deg,${t.col},#0b1520)"></div><b>${esc(t.title)}</b><div class="mut sm">${esc(t.artist)} · ${t.bpm} · ${GS[t.genre]}</div><div>${keyLabel(t)} ${emeter(t)}</div>
 <div class="menu">${['Play now:playnow','Fits after this:fitsafter','Add to '+esc(BLD.A.lanes[BLD.A.act].name)+':exflow','Add to '+esc(SETS[0].name)+':setadd'].map(x=>{const[l,a]=x.split(':');return `<div class="mi" data-a="${a}" data-i="${t.id}">${l}</div>`}).join('')}<div class="mi" data-a="open" data-k="keycard" data-o='{"i":${t.id}}'>Key card</div></div></div>`}
SCR.explore={
 d:()=>musicShell('explore',`<div class="exv">${exBar()}<div class="exg"><div>${exMap(600,470)}</div><div class="exside">${dotCard()}</div></div></div>`),
 p:()=>`${phoneMusicHead('explore')}<div class="ppad">${exBar()}</div><div class="ppad">${tg('E8.1')}${exMap(358,420)}</div>`};
OV.dot={p:()=>dotCard()};
ACT.exv=d=>{EX.view=d.val};ACT.exg=d=>{EX.g=d.g};ACT.expath=()=>{EX.path=!EX.path};
ACT.exsel=(d,el,dev)=>{EX.sel=+d.i;if(dev==='p')open('dot')};
ACT.exflow=d=>{BLD.A.lanes[BLD.A.act].tr.push(+d.i);S.ov=null;toast(`Added to ${esc(BLD.A.lanes[BLD.A.act].name)}`)};

// The plan around the prototype: story rail and cards, story map, navigation flows, issue export.

const PF={rel:'All',plat:'All',q:'',open:{},exp:'md',expRel:'All',flowDev:'d',done:JSON.parse(localStorage.getItem('mp-done')||'{}')};
const RELS=['MVP','R2','R3'];
const platLbl=p=>({both:'Desktop + phone',phone:'Phone',desktop:'Desktop',backend:'Backend'})[p]||p;
const storiesOf=e=>ST_LIST.filter(s=>s.id.split('.')[0]===e);
const visible=s=>(PF.rel==='All'||s.rel===PF.rel)&&(PF.plat==='All'||s.plat===PF.plat||(PF.plat!=='backend'&&s.plat==='both'))&&(!PF.q||(s.id+' '+s.title+' '+s.story).toLowerCase().includes(PF.q.toLowerCase()));
const relPill=r=>`<span class="rel r-${r}">${r}</span>`;

const PLAN={
 render(){$('#phead').innerHTML=head();['proto','pmap','pflows','pexport'].forEach(k=>$('#'+k).style.display=S.view===(k==='proto'?'proto':k.slice(1))?'':'none');
  if(S.view==='proto'){const r=$('#rail'),st=r.scrollTop;r.innerHTML=rail();r.scrollTop=st}
  if(S.view==='map')$('#pmap').innerHTML=storyMap();if(S.view==='flows')$('#pflows').innerHTML=flows();if(S.view==='export')$('#pexport').innerHTML=exporter()},
 reveal(id){const e=id.split('.')[0];PF.open[e]=true;S.view='proto';setTimeout(()=>{const el=document.querySelector(`#rail [data-sid="${id}"]`);el&&el.scrollIntoView({block:'nearest',behavior:'smooth'})},30)}};

function head(){const c=RELS.map(r=>`${relPill(r)} ${ST_LIST.filter(s=>s.rel===r).length}`).join(' ');
 return `<div class="ph1"><b>Harmony &amp; mixes · master plan</b><span class="mut sm">${EPICS.length} epics · ${ST_LIST.length} stories · ${c}</span></div>
 <div class="ph2">${seg([['proto','Prototype'],['map','Story map'],['flows','Navigation flows'],['export','Issues export']],S.view,'pview')}<span style="flex:1"></span>
 <label class="tgl"><span class="sw2 ${S.tags?'on':''}" data-a="ptags"></span>Story tags</label><span class="mut sm">Theory level</span>${seg([['plain','Plain'],['theory','Theory'],['tap','Plain + tap']],S.theory,'theory')}${btn('Reset prototype','preset')}</div>`}

function card(s){const done=PF.done;return `<div class="scard">
 <p class="us">${esc(s.story)}</p>
 <div class="meta">${relPill(s.rel)}<span>Size ${s.size}</span><span>${platLbl(s.plat)}</span></div>
 ${s.ext?`<div class="kv"><b>Builds on</b><code>${esc(s.ext)}</code></div>`:''}
 ${s.deps.length?`<div class="kv"><b>Depends on</b>${s.deps.map(d=>`<span class="dep" data-a="pick" data-id="${d}">${d}</span>`).join('')}</div>`:''}
 <div class="kv col"><b>Acceptance criteria</b>${s.ac.map((a,k)=>`<label class="ac"><input type="checkbox" data-a="pac" data-k="${s.id}:${k}" ${done[s.id+':'+k]?'checked':''}>${esc(a)}</label>`).join('')}</div>
 ${s.d?`<div class="kv"><b>Desktop</b>${esc(s.d)}</div>`:''}${s.p?`<div class="kv"><b>Phone</b>${esc(s.p)}</div>`:''}
 <div class="row-btns">${btn(I('play')+'Show in prototype','pick',{id:s.id,force:1},'solid')}${btn('Copy as issue','pcopy1',{id:s.id})}</div></div>`}
function rail(){const f=`<div class="rf"><label class="srch sm2">${I('search')}<input data-id="pq" data-input="pq" value="${esc(PF.q)}" placeholder="Filter stories…"></label>
 <div class="chips wrap">${['All',...RELS].map(r=>`<span class="chip ${PF.rel===r?'on':''}" data-a="prel" data-r="${r}">${r==='All'?'All releases':r}</span>`).join('')}</div>
 <div class="chips wrap">${[['All','All'],['both','Desktop + phone'],['phone','Phone only'],['backend','Backend']].map(([k,l])=>`<span class="chip ${PF.plat===k?'on':''}" data-a="pplat" data-p="${k}">${l}</span>`).join('')}</div>
 <div class="mut sm">Click a story to drive both devices to it. Blue badges in the devices are story IDs: click one to open its story.</div></div>`;
 return f+EPICS.map(e=>{const list=storiesOf(e.id).filter(visible);if(!list.length)return '';const open=PF.open[e.id]||PF.q||(S.story&&S.story.startsWith(e.id+'.'));
  return `<div class="ep"><div class="eph" data-a="pepic" data-e="${e.id}"><b>${e.id}</b><span>${esc(e.title)}</span><em>${list.length}</em>${I(open?'dn':'r')}</div>${open?`<div class="epg">${esc(e.goal)}</div>`+list.map(s=>`<div class="si${S.story===s.id?' on':''}" data-sid="${s.id}"><div class="sih" data-a="pick" data-id="${s.id}"><b>${s.id}</b><span>${esc(s.title)}</span>${relPill(s.rel)}</div>${S.story===s.id?card(s):''}</div>`).join(''):''}</div>`}).join('')}

function storyMap(){return `<div class="smap"><div class="smh"><span></span>${EPICS.map(e=>`<div class="smc"><b>${e.id}</b>${esc(e.title)}</div>`).join('')}</div>
 ${RELS.map(r=>`<div class="smr"><div class="smrl">${relPill(r)}<span class="mut sm">${r==='MVP'?'Harmony you can see and search':r==='R2'?'Building: inspector, builder, wizard, player':'Arcs, Autopilot, Explore, Learn'}</span></div>${EPICS.map(e=>`<div class="smcell">${storiesOf(e.id).filter(s=>s.rel===r).map(s=>`<div class="smcard r-${r}" data-a="pick" data-id="${s.id}" data-force="1"><b>${s.id}</b>${esc(s.title)}<em>${s.size} · ${platLbl(s.plat)}</em></div>`).join('')}</div>`).join('')}</div>`).join('')}
 <p class="mut sm" style="margin:14px 4px">Columns are epics (parent issues), cards are stories (sub-issues), rows are release slices. Each row is shippable on its own: MVP needs only the analysis, labels, search and set joins.</p></div>`}

// ---------- navigation flows ----------
const FN=[
 ['settings',40,60,'Settings › Harmony','E9.4','screen'],['tracks',40,420,'Music › Tracks','E1.1','screen'],['unsure',40,240,{d:'Unsure check (dialog)',p:'Unsure check (sheet)'},'E10.2','ov'],['explore',40,660,'Music › Explore','E8.1','screen'],
 ['keycard',270,60,{d:'Key card (dialog)',p:'Key card (sheet)'},'E1.5','ov'],['rowmenu',270,240,{d:'Row menu (popover)',p:'Row menu (sheet)'},'E2.1','ov'],['fitsafter',270,420,'Fits after results','E2.2','screen'],['dotcard',270,660,{d:'Dot card (side)',p:'Dot card (sheet)'},'E8.3','ov'],
 ['learn',500,60,'Harmony basics','E9.1','screen'],['join',500,240,{d:'Join details (dialog)',p:'Join details (sheet)'},'E3.2','ov'],['fix',730,240,{d:'Fix a clash (dialog)',p:'Fix a clash (sheet)'},'E3.3','ov'],['set',500,420,'Set editor','E3.1','screen'],
 ['insp',500,600,{d:'Inspector (right panel)',p:'Fits next (sheet)'},'E4.1','ov'],['wizard',730,600,{d:'Build a set (dialog)',p:'Build a set (full sheet)'},'E6.1','ov'],['seed',960,560,'From a track','E6.2','ov'],['arcs',960,680,'Draw the arcs','E6.3','ov'],['bridge',960,800,'Bridge two tracks','E6.6','ov'],['gap',730,780,'Fill a gap','E6.7','ov'],
 ['builder',730,420,'Mix builder','E5.1','screen'],['picker',960,300,{d:'Picker (column)',p:'Picker (sheet)'},'E5.2','ov'],['branches',960,440,'Branches mode','E5.7','screen'],
 ['mini',730,60,'Mini-player','E7.4','screen'],['player',960,60,'Player','E7.1','screen'],['pjoin',1190,20,{d:'Transition popover',p:'Transition sheet'},'E7.2','ov'],['crate',1190,150,{d:'Crate shelf · Fits next',p:'Crate sheet · Fits next'},'E7.1','ov']];
const FE=[['tracks','rowmenu','tap row'],['tracks','keycard','tap label'],['rowmenu','keycard','Key card'],['rowmenu','fitsafter','Fits after this'],['keycard','fitsafter','Fits after'],['rowmenu','wizard','Build from this'],
 ['tracks','unsure','tap “?”'],['settings','unsure','Review'],['tracks','explore','Explore tab'],['explore','dotcard','tap dot'],['dotcard','fitsafter','Fits after'],['tracks','set','Playlists › set'],
 ['set','join','tap join'],['join','fix','Fix'],['set','insp',{d:'Show inspector',p:'Fits next'}],['set','wizard','Build…'],['set','builder','Open in mix builder'],['tracks','builder','New mix'],['tracks','wizard','Build a set'],
 ['wizard','seed',''],['wizard','arcs',''],['wizard','bridge',''],['wizard','gap',''],['seed','set','Add / Replace'],['arcs','builder','New flow'],['builder','picker',{d:'always visible',p:'search bar'}],['builder','branches','mode'],
 ['builder','arcs','arc button'],['builder','set','Save as set'],['mini','player','tap'],['player','pjoin','join circle'],['player','crate',{d:'under timeline',p:'Add'}],
 ['keycard','learn','What is a mode?'],['join','learn','Why?'],['settings','learn','Harmony basics'],['tracks','settings','gear']];
function flows(){const dev=PF.flowDev,W=1380,H=860,pos=Object.fromEntries(FN.map(n=>[n[0],n]));const lbl=v=>typeof v==='object'?v[dev]:v;
 let s=`<svg class="fsvg" viewBox="0 0 ${W} ${H}" width="100%"><defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" fill="rgba(227,234,240,.45)"/></marker></defs>`;
 FE.forEach(([a,b,l])=>{const A=pos[a],B=pos[b];const x1=A[1]+80,y1=A[2]+20,x2=B[1]+80,y2=B[2]+20,mx=(x1+x2)/2,my=(y1+y2)/2-18;
  s+=`<path d="M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}" fill="none" stroke="rgba(227,234,240,.28)" stroke-width="1.4" marker-end="url(#ah)"/>${lbl(l)?`<text x="${mx}" y="${my+4}" text-anchor="middle" class="fel">${esc(lbl(l))}</text>`:''}`});
 FN.forEach(([k,x,y,l,st,kind])=>{s+=`<g data-a="pick" data-id="${st}" data-force="1" style="cursor:pointer"><rect x="${x}" y="${y}" width="160" height="40" rx="10" class="fn ${kind}"/><text x="${x+80}" y="${y+18}" text-anchor="middle" class="fnt">${esc(lbl(l))}</text><text x="${x+80}" y="${y+32}" text-anchor="middle" class="fns">${st}</text></g>`});
 return `<div class="fl1"><div class="opts">${seg([['d','Desktop'],['p','Phone']],dev,'pflowdev')}<span class="mut sm">Solid: screens (routes). Dashed: dialogs, panels and sheets. Click a box to open it in the prototype.</span></div>${s}</svg>
 <div class="fnotes">${dev==='d'?`<b>Desktop.</b> The sidebar keeps Music active for Tracks, Explore, sets, the mix builder and the player. The crates column (libraries, playlists, mixes, smart lists) stays visible in Music. The mix builder and the player slim the sidebar to icons to make room for columns. Dialogs are centred with a scrim. The inspector is a panel inside the set editor, not a dialog.`
 :`<b>Phone.</b> Music's tabs become chips, and playlists live in a sheet. The set editor, mix builder, player, basics and settings are full screens with a back arrow, and the set editor, builder and player hide the tab bar. Every dialog becomes a bottom sheet. Build a set is a full-height sheet. The picker, inspector and crate open from a bottom bar.`}</div></div>`}

// ---------- export ----------
const expStories=()=>ST_LIST.filter(s=>PF.expRel==='All'||s.rel===PF.expRel);
function storyMd(s,level='###'){return `${level} [${s.id}] ${s.title}\n\n${s.story}\n\n**Release:** ${s.rel} · **Size:** ${s.size} · **Platforms:** ${platLbl(s.plat)}${s.ext?`\n**Builds on:** ${s.ext}`:''}${s.deps.length?`\n**Depends on:** ${s.deps.join(', ')}`:''}\n\n**Acceptance criteria**\n${s.ac.map(a=>`- [ ] ${a}`).join('\n')}${s.d?`\n\n**Desktop:** ${s.d}`:''}${s.p?`\n**Phone:** ${s.p}`:''}\n\n**Prototype:** \`.impeccable/mocks/master/index.html#${s.id}\`\n`}
function epicMd(e,list){return `## [${e.id}] ${e.title}\n\n${e.goal}\n\n**Sub-issues**\n${list.map(s=>`- [ ] ${s.id} ${s.title} (${s.rel} · ${s.size})`).join('\n')}\n`}
function md(){const list=expStories();return `# Harmony & mixes · master plan\n\n${EPICS.map(e=>{const l=list.filter(s=>s.id.split('.')[0]===e.id);return l.length?epicMd(e,l)+'\n'+l.map(s=>storyMd(s)).join('\n'):''}).filter(Boolean).join('\n---\n\n')}`}
function json(){const list=expStories();return JSON.stringify({epics:EPICS.map(e=>({...e,stories:list.filter(s=>s.id.split('.')[0]===e.id).map(({go,...s})=>s)})).filter(e=>e.stories.length)},null,1)}
function gh(){const list=expStories();let o=`#!/usr/bin/env bash\n# Creates one issue per epic and one sub-issue per story, linked as GitHub sub-issues.\n# Usage: REPO=owner/name bash create-issues.sh   (review before running)\nset -euo pipefail\n: "\${REPO:?set REPO=owner/name}"\n`;
 o+=`for l in epic story MVP R2 R3 backend; do gh label create "$l" -R "$REPO" --force >/dev/null; done\nnum() { grep -oE '[0-9]+$'; }\nlink() { gh api -X POST "repos/$REPO/issues/$1/sub_issues" -F sub_issue_id="$(gh api "repos/$REPO/issues/$2" --jq .id)" >/dev/null; }\n\n`;
 EPICS.forEach(e=>{const l=list.filter(s=>s.id.split('.')[0]===e.id);if(!l.length)return;const v='EP_'+e.id;
  o+=`${v}=$(gh issue create -R "$REPO" -t ${JSON.stringify(`[${e.id}] ${e.title}`)} -l epic -F - <<'BODY_${e.id}' | num\n${epicMd(e,l)}BODY_${e.id}\n)\n`;
  l.forEach(s=>{const sv='ST_'+s.id.replace('.','_');o+=`${sv}=$(gh issue create -R "$REPO" -t ${JSON.stringify(`[${s.id}] ${s.title}`)} -l story -l ${s.rel}${s.plat==='backend'?' -l backend':''} -F - <<'BODY_${sv}' | num\n${storyMd(s,'##')}BODY_${sv}\n)\nlink "$${v}" "$${sv}"\n`});o+='\n'});
 return o+`echo "Done."\n`}
function exporter(){const txt=PF.exp==='md'?md():PF.exp==='json'?json():gh();
 return `<div class="exp"><div class="opts">${seg([['md','Markdown'],['json','JSON'],['gh','gh script']],PF.exp,'pexp')}<span class="fl">Release</span>${seg([['All','All'],...RELS.map(r=>[r,r])],PF.expRel,'pexprel')}<span style="flex:1"></span>${btn('Copy','pcopy',{},'solid')}${btn('Download','pdl')}</div>
 <p class="mut sm">${PF.exp==='gh'?'Creates epics as parent issues and stories as GitHub sub-issues (labels: epic, story, release, backend). Nothing runs from here: review the script, then run it with REPO=owner/name.':PF.exp==='json'?'Structured: epics with their stories, for any tracker import.':'One section per epic with its sub-issue checklist, then each story as an issue body.'}</p>
 <textarea id="exptxt" readonly>${esc(txt)}</textarea></div>`}

ACT.pview=d=>{S.view=d.val};ACT.ptags=()=>{S.tags=!S.tags};
ACT.preset=()=>{resetDomain();S.route={v:'tracks'};S.hist=[];S.ov=null;S.story=null;S.tip=true;toast('Prototype reset')};
ACT.pick=d=>{const s=STORY[d.id];if(!s)return;if(S.story===d.id&&!d.force){S.story=null;return}S.story=d.id;S.view='proto';PF.open[s.epic]=true;resetDomain();s.go();history.replaceState(null,'','#'+d.id);PLAN.reveal(d.id)};
ACT.pepic=d=>{PF.open[d.e]=!PF.open[d.e]};ACT.prel=d=>{PF.rel=d.r};ACT.pplat=d=>{PF.plat=d.p};ACT.pq=v=>{PF.q=v};
ACT.pac=(d,el)=>{PF.done[d.k]=el.checked;localStorage.setItem('mp-done',JSON.stringify(PF.done));return false};
ACT.pexp=d=>{PF.exp=d.val};ACT.pexprel=d=>{PF.expRel=d.val};ACT.pflowdev=d=>{PF.flowDev=d.val};
ACT.pcopy=()=>{navigator.clipboard.writeText($('#exptxt').value);toast('Copied');return false};
ACT.pcopy1=d=>{navigator.clipboard.writeText(storyMd(STORY[d.id],'##'));toast(`Copied ${d.id}`);return false};
ACT.pdl=()=>{const ext={md:'md',json:'json',gh:'sh'}[PF.exp],a=document.createElement('a');a.href=URL.createObjectURL(new Blob([$('#exptxt').value],{type:'text/plain'}));a.download=`harmony-master-plan.${ext}`;a.click();return false};

function fitDevices(){const railW=S.view==='proto'?340:0,avail=window.innerWidth-railW-56,ps=.8,pw=390*ps;let dw=avail-pw-24;const stack=dw<640;if(stack)dw=avail;const s=Math.min(1,dw/1280);
 const d=$('#dDesk');d.style.width=1280*s+'px';d.style.height=800*s+'px';$('#desk').style.transform=`scale(${s})`;
 const p=$('#dPh');p.style.width=pw+'px';p.style.height=844*ps+'px';$('#ph').style.transform=`scale(${ps})`;$('#stage').classList.toggle('stack',stack)}
window.addEventListener('resize',fitDevices);
function boot(){resetDomain();const h=location.hash.slice(1);if(STORY[h]){S.story=h;PF.open[STORY[h].epic]=true;STORY[h].go()}else{PF.open.E5=true}fitDevices();render();if(STORY[h])PLAN.reveal(h)}

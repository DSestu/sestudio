// E9 Learn and settings: Harmony basics (eight short steps, every example playable),
// Settings › Music › Harmony (theory level, strictness, Autopilot default),
// and the analysis card that surfaces the engine work (E0): progress, energy scale, unsure tracks, lab check.

let LRN,AN;
RESET.push(()=>{LRN={step:0,cmp:'pivot',mode:'dorian'};AN={running:false,done:42,lab:{}}});
const STEPS=[
 ['Notes and scales','Music uses 12 notes. A scale picks 7 of them, and most tracks stay inside one scale. The ringed key is the centre, the note the track feels like home.'],
 ['Shared notes make smooth mixes','When two tracks use the same notes, their overlap sounds like one piece. Each note they don\'t share is a chance for the blend to sound off.'],
 ['Modes are moods','Start the same 7 notes from a different centre and the mood changes. From the brightest (lydian) to the darkest (locrian), on G:'],
 ['Same notes, different centre','C ionian and A aeolian use exactly the same notes. One sounds bright, the other dark, and they mix perfectly: a pivot.'],
 ['Clashes, and how to fix them','A clash is a join where the tracks share 5 notes or fewer. Put a bridge track between them that shares 6 or 7 notes with both, or keep it if you want the tension.'],
 ['Mood isn\'t energy','Mood comes from the notes. Energy comes from loudness, density and drums. A dark track can be calm, and a bright one intense.'],
 ['Mix in the calm parts','Transitions overlap an outro with an intro, usually the calmer bars. The energy shown at a join compares those two parts, not the drops.'],
 ['Genres and tempo','Drum & bass runs near 172 BPM, dubstep near 150. Inside a genre, keep the tempo within about 6%. A genre change can jump tempo; it is flagged, not forbidden.']];
function learnWidget(k,dev){const w=dev==='d'?300:320;
 if(k===0){const t=by('Noir');return `${kbd(t.pcs,t.t,{w})}<div class="row-btns">${btn(I('play')+'Play G phrygian','playscale',{i:t.id},'solid')}${tg('E9.2')}</div>`}
 if(k===1){const a=by('Noir'),b=LRN.cmp==='pivot'?by('Stargazer'):by('Statues'),j=kind(a,b);return `${seg([['pivot','Noir → Stargazer'],['clash','Noir → Statues']],LRN.cmp,'lcmp')}${kbd(a.pcs,a.t,{cmp:b.pcs,w})}<div class="f-${j.cls}" style="color:var(--fc);font-weight:600">${j.n} of 7 shared: ${j.lbl}</div>${btn(I('headph')+'Hear it','hear',{a:a.id,b:b.id})}`}
 if(k===2)return `${tg('E9.2')}<div class="modes">${Object.keys(MODES).map(m=>`<span class="mode${LRN.mode===m?' on':''}" style="--mc:${COL[MODES[m][1]]}" data-a="lmode" data-m="${m}">${I('play')}<b>${WORD[MODES[m][1]]}</b><em>G ${m}</em></span>`).join('')}</div>${kbd(scale(7,LRN.mode),7,{w})}`;
 if(k===3)return `<div class="row-btns">${btn(I('play')+'C ionian · Bright','playpcs',{t:0,m:'ionian'})}${btn(I('play')+'A aeolian · Dark','playpcs',{t:9,m:'aeolian'})}</div>${kbd(scale(0,'ionian'),0,{w,cmp:scale(9,'aeolian')})}`;
 if(k===4){const a=by('Noir'),b=by('Statues'),br=bridges(a,b)[0];return `<div class="mini3">${[a,br,b].map((t,q)=>`${q?joinLine([a,br,b][q-1],t,{cmp:true}):''}<div class="tr sm3">${mdot(t)}<div class="tt"><b>${esc(t.title)}</b><span>${name(t)}</span></div></div>`).join('')}</div>`}
 if(k===5)return `<div class="row-btns">${btn('Calm and dark','lenergy',{v:'calm'})}${btn('Intense and dark','lenergy',{v:'int'},'solid')}</div><div class="mut sm">Same notes (G phrygian), different energy.</div>`;
 if(k===6){const a=by('Noir'),b=by('Stargazer');return `<div class="ovl">${curveSvg(a,w,30)}<div style="margin-left:${w*.72}px">${curveSvg(b,w*.6,30)}</div><div class="mut sm">The last bars of ${esc(a.title)} overlap the first of ${esc(b.title)}.</div></div>`}
 return `<div class="sm">${joinLine(by('Noir'),by('Statues'))}</div>`}
SCR.learn={deep:true,noTabs:true,title:()=>'Harmony basics',
 d:r=>{if(r.step!=null){LRN.step=r.step;r.step=null}const k=LRN.step;return `<div class="lrn"><div class="lnav"><h2>Harmony basics ${tg('E9.1')}</h2>${STEPS.map(([t],q)=>`<div class="ls${q===k?' on':''}" data-a="lstep" data-k="${q}"><i>${q+1}</i>${t}</div>`).join('')}</div>
  <div class="lbody"><div class="cap">Step ${k+1} of ${STEPS.length}</div><h2>${STEPS[k][0]}</h2><p>${STEPS[k][1]}</p>${learnWidget(k,'d')}<div class="row-btns" style="margin-top:22px">${k?btn(I('l')+'Back','lstep',{k:k-1}):''}${k<STEPS.length-1?btn('Next'+I('r'),'lstep',{k:k+1},'solid'):btn('Done','back',{},'solid')}</div></div></div>`},
 p:r=>{if(r.step!=null){LRN.step=r.step;r.step=null}const k=LRN.step;return `<div class="ppad">${tg('E9.1')}<div class="dots">${STEPS.map((_,q)=>`<i class="${q===k?'on':''}" data-a="lstep" data-k="${q}"></i>`).join('')}</div><div class="cap">Step ${k+1} of ${STEPS.length}</div><h2>${STEPS[k][0]}</h2><p class="sm">${STEPS[k][1]}</p>${learnWidget(k,'p')}
  <div class="row-btns" style="margin-top:18px">${k?btn(I('l')+'Back','lstep',{k:k-1}):''}<span style="flex:1"></span>${k<STEPS.length-1?btn('Next'+I('r'),'lstep',{k:k+1},'solid'):btn('Done','back',{},'solid')}</div></div>`}};
ACT.lstep=d=>{LRN.step=+d.k};ACT.lcmp=d=>{LRN.cmp=d.val};ACT.lmode=d=>{LRN.mode=d.m;playPcs(7,scale(7,d.m))};
ACT.lenergy=d=>{const g=by('Noir');if(d.v==='calm')playPcs(g.t,g.pcs,{wave:'sine',dur:.5,gap:.45});else playPcs(g.t,[...g.pcs,...g.pcs],{wave:'sawtooth',dur:.09,gap:.08});return false};

// ---------- settings ----------
function harmonyCard(){const unsure=LIB.filter(t=>t.unsure),an=LIB.filter(t=>t.analysing);
 return `<div class="card2"><h3>Harmony ${tg('E9.4')}</h3>
 <div class="srow"><div><b>How keys are shown</b><span>Plain shows mood words. Theory shows key names. Plain + tap shows words, and a tap opens the key card.</span></div>${seg([['plain','Plain'],['theory','Theory'],['tap','Plain + tap']],S.theory,'theory')}</div>
 <div class="srow"><div><b>Default harmony rule</b><span>Used by Fits next, the builder and Autopilot.</span></div>${seg([['7','Same notes'],['6','Close'],['any','Any']],FILTER_DEF.strict,'strictdef')}</div>
 <div class="srow"><div><b>Mood words</b><span>From the brightest mode to the darkest.</span></div><div class="ladder">${MOODS.map(b=>`<span style="--mc:${COL[b]}">${WORD[b]}</span>`).join('')}</div></div>
 <div class="srow"><div><b>Autopilot follows</b><span>The arc Autopilot uses when the queue runs out.</span></div>${seg(PRESETS.map(([n],k)=>[k,n.split(' ')[0]]),PQ.apPreset,'apP','k')}</div>
 <div class="srow"><div><b>Learn</b><span>Eight short steps, each with sound.</span></div>${btn(I('book')+'Harmony basics','nav',{v:'learn',p:{step:0}})}</div></div>
 <div class="card2"><h3>Analysis ${tg('E0.2')}</h3>
 <div class="srow"><div><b>Notes and modes</b><span>${AN.running?`Analysing… ${AN.done} of ${LIB.length}`:`${LIB.length-an.length} of ${LIB.length} tracks analysed${an.length?` · ${an.length} in progress`:''}`}</span><div class="pbar3"><i style="width:${(LIB.length-an.length)/LIB.length*100}%"></i></div></div>${btn(AN.running?'Analysing…':'Re-analyse library','reanalyse')}</div>
 <div class="srow"><div><b>Unsure modes ${tg('E0.3')}</b><span>${unsure.length?`${unsure.length} track${unsure.length>1?'s':''} where the analysis hesitates between two modes.`:'None left.'}</span></div>${unsure.length?btn('Review '+esc(unsure[0].title),'unsure',{i:unsure[0].id}):''}</div>
 <div class="srow"><div><b>Energy scale ${tg('E0.4')}</b><span>Library-wide, in 8 bands, so energy compares across tracks (not per-track loudness).</span></div><span class="okb">${I('check')} Library-wide</span></div>
 <div class="srow col"><div><b>Lab: judge mode detection by ear ${tg('E0.1')}</b><span>Play each scale against the track. If most sound right, the detector ships.</span></div>
 ${['Noir','Farewell','Dune','The Hole','Mesmer'].map(n=>{const t=by(n),v=AN.lab[t.id];return `<div class="labr">${mdot(t)}<b>${esc(t.title)}</b><span class="mut">${name(t)}</span><span style="flex:1"></span>${btn(I('play'),'playscale',{i:t.id},'sq')}<span class="btn xs${v===true?' solid':''}" data-a="lab" data-i="${t.id}" data-v="1">Right</span><span class="btn xs${v===false?' warnb':''}" data-a="lab" data-i="${t.id}" data-v="0">Wrong</span></div>`}).join('')}
 <div class="mut sm">${Object.values(AN.lab).filter(Boolean).length} right · ${Object.values(AN.lab).filter(v=>v===false).length} wrong</div></div></div>`}
const SNAV=['General','Playback','Downloads','Music','Devices','About'];
SCR.settings={deep:true,title:()=>'Settings',
 d:()=>`<div class="setp"><div class="snav"><h2>Settings</h2>${SNAV.map(s=>`<div class="ls${s==='Music'?' on':''}">${s}</div>`).join('')}</div><div class="sbody scroll" data-keep="sb"><div class="cap">Music</div>${harmonyCard()}</div></div>`,
 p:()=>`<div class="ppad"><div class="cap">Settings › Music</div>${harmonyCard()}</div>`};
ACT.theory=d=>{S.theory=d.val};ACT.strictdef=d=>{FILTER_DEF.strict=d.val;TR.f.strict=d.val};
ACT.lab=d=>{AN.lab[+d.i]=d.v==='1'};
ACT.reanalyse=()=>{if(AN.running)return false;AN.running=true;AN.done=30;const u=LIB.find(t=>t.analysing);const tick=()=>{AN.done++;if(AN.done>=LIB.length){AN.running=false;if(u)u.analysing=false;toast('Analysis done: every track has its notes and mode')}else setTimeout(tick,120);render()};setTimeout(tick,120)};

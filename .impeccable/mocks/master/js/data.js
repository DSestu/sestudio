// Music model shared by every epic: tracks, note sets, modes, moods, energy, genres, joins, ranking, arcs, sound.
// Keys and tempos come from the real library; modes and energy are illustrative until the analysis epic (E0) lands.
const NOTE=['C','C♯','D','E♭','E','F','F♯','G','A♭','A','B♭','B'];
const MAJ=[0,2,4,5,7,9,11];
const MODES={lydian:[3,3],ionian:[0,2],mixolydian:[4,1],dorian:[1,0],aeolian:[5,-1],phrygian:[2,-2],locrian:[6,-3]};
const WORD={3:'Floating',2:'Bright',1:'Warm',0:'Smooth','-1':'Dark','-2':'Menacing','-3':'Unstable'};
const COL={3:'oklch(88% .12 95)',2:'oklch(83% .13 75)',1:'oklch(77% .13 45)',0:'oklch(72% .13 10)','-1':'oklch(66% .15 340)','-2':'oklch(62% .17 310)','-3':'oklch(56% .18 290)'};
const scale=(t,m)=>m==='harmonic minor'?[0,2,3,5,7,8,11].map(x=>(t+x)%12):MAJ.map(x=>(t+x-MAJ[MODES[m][0]]+12)%12);
function T(title,artist,bpm,dur,t,mode,e){const hm=mode==='harmonic minor';const br=hm?-1:MODES[mode][1];
 const parent=hm?null:(t-MAJ[MODES[mode][0]]+12)%12;
 return {title,artist,bpm,dur,t,mode,e,pcs:scale(t,mode),br,set:hm?null:((parent*7)%12+7)%12+1,word:hm?'Exotic':WORD[br],col:hm?'oklch(70% .14 200)':COL[br]}}
const LIB=[
 T('Farewell','neuro soundcloud',172,239,7,'dorian',.32),T('These Days','Emperor',172,268,7,'aeolian',.62),T('Wanna','Kumarion',172,220,7,'aeolian',.7),
 T('All I Ever Wanted','Emperor',172,297,7,'aeolian',.66),T('No Way Out','feat. Mira Lu Kovacs',175,245,7,'dorian',.58),T('Noir','Teddy Killerz',174,226,7,'phrygian',.88),
 T('Suicide Bassline VIP','Mefjus',172,174,7,'phrygian',.92),T('Stargazer','Skylark',172,201,0,'aeolian',.6),T('Pray For Me','feat. Joe Killington',175,245,0,'dorian',.72),
 T('Sinkhole','neuro soundcloud',172,313,5,'aeolian',.8),T('You left me','Eluun',174,213,5,'aeolian',.55),T('Dune','neuro soundcloud',174,127,5,'harmonic minor',.75),
 T('Hear The Lies','Eluun',172,235,5,'dorian',.6),T('If I Could','neuro soundcloud',172,253,5,'aeolian',.7),T('Concussion (Mefjus Remix)','Noisia',172,226,5,'phrygian',.9),
 T('Elysium','Fade Black',175,247,2,'aeolian',.68),T('Mesmer','Sota, Circadian, Mila Falls',174,281,10,'aeolian',.64),T('Supersonic','Skrillex, Noisia',172,165,9,'aeolian',.95),
 T('Physically','Mefjus',172,112,4,'phrygian',.9),T('Nonplus','neuro soundcloud',172,233,4,'dorian',.78),T('Pure Action','Kumarion',174,203,4,'aeolian',.85),
 T('Twerp','Waeys, Bensley & Hoax',175,220,3,'aeolian',.9),T('Perseverance','neuro soundcloud',172,232,3,'dorian',.74),T('Dopamine Hits','Mefjus & Maksim MC',172,190,3,'phrygian',.86),
 T('Left','Maysev',172,192,3,'aeolian',.7),T('Sunder','Emperor',174,276,3,'aeolian',.8),T('The Hole','neuro soundcloud',172,315,5,'lydian',.66),
 T('The First Time','Virtual Riot, Tokyo Machine',145,190,7,'mixolydian',.72),T('Before You','Maysev & The Caracal Project',165,224,1,'aeolian',.5),
 T('Black Bloc','neuro soundcloud',172,251,1,'phrygian',.84),T('Hear Me','neuro soundcloud',172,249,11,'aeolian',.6),T('Aurora (Justin Hawkes Remix)','feat. Metrik',175,231,5,'aeolian',.7),
 T('A Taste Of Hope','Emperor',172,314,5,'aeolian',.67),T('Systematic V4','D_Minds & Mefjus',172,271,5,'phrygian',.88),T('Pure Hope','neuro soundcloud',172,240,0,'mixolydian',.55)];
// dubstep tracks from the test library (keys and tempos are real; modes and energy illustrative)
LIB.push(T('Statues','Virtual Riot',150,243,2,'phrygian',.85),T('Found You','Virtual Riot, Dodge & Fuski',150,247,4,'aeolian',.8),T('Nightmare','Virtual Riot & Autodrive',145,254,4,'phrygian',.9),
 T("I'm Back",'Dodge & Fuski',150,200,3,'aeolian',.88),T("Sh*t's On F*re",'neuro soundcloud',150,245,2,'aeolian',.92),T('So Sorry (RANKZ Remix)','Virtual Riot',145,159,3,'dorian',.78),T('Scorched Earth','Virtual Riot',135,281,3,'phrygian',.9));
const DUB=new Set(['The First Time','Statues','Found You','Nightmare',"I'm Back","Sh*t's On F*re",'So Sorry (RANKZ Remix)','Scorched Earth']);
LIB.forEach(t=>t.genre=t.title==='Farewell'?'Ambient':DUB.has(t.title)?'Dubstep':'Drum & Bass');
const GENRES=['Drum & Bass','Dubstep','Ambient'];
const GCOL={'Drum & Bass':'oklch(74% .11 185)','Dubstep':'oklch(80% .15 128)','Ambient':'oklch(78% .06 265)'};
const GS={'Drum & Bass':'DnB','Dubstep':'Dubstep','Ambient':'Ambient'};
const gchip=g=>`<span class="gchip" style="--gc:${GCOL[g]}">${GS[g]}</span>`;
const tempoJump=(a,b)=>Math.abs(a.bpm-b.bpm)>a.bpm*.06;
// energy per bar: intro / build / drop / break / build / drop / outro
const ESHAPE=[[4,.35],[4,'up'],[8,1],[4,.45],[2,'up'],[6,1],[4,.35]];
LIB.forEach((t,j)=>{const c=[];let last=.35;ESHAPE.forEach(([n,v])=>{for(let i=0;i<n;i++){const lv=v==='up'?last+(1-last)*(i+1)/n:v;c.push(Math.min(1,t.e*lv*(1+.06*Math.sin(j*3+c.length*1.7))))}last=v==='up'?1:v});t.curve=c});

// ---------- library extras ----------
LIB.forEach((t,i)=>{t.id=i});
LIB.push(Object.assign(T('Untitled (new download)','Kumarion',174,231,5,'aeolian',.7),{id:LIB.length,genre:'Drum & Bass',analysing:true}));
LIB.at(-1).curve=LIB[0].curve;
LIB.find(t=>t.title==='Pure Hope').unsure={alt:'aeolian',altT:9};
const by=n=>LIB.find(x=>x.title===n);
const ix=n=>by(n).id;
const POOL=()=>LIB.filter(t=>!t.analysing);
const fmt=s=>`${Math.floor(s/60)}:${String(Math.round(s%60)).padStart(2,'0')}`;
const fmtMin=s=>`${Math.round(s/60)} min`;
const name=t=>`${NOTE[t.t]} ${t.mode}`;
const shared=(a,b)=>a.pcs.filter(x=>b.pcs.includes(x)).length;
const ELVL=e=>e<.45?'Calm':e<.65?'Steady':e<.8?'Driving':'Intense';
const eLvlN=e=>e<.45?1:e<.65?2:e<.8?3:4;
const eStep=(a,b)=>{const d=b.e-a.e;return d>.08?'lifts':d<-.08?'eases off':'holds'};
const MOODS=[3,2,1,0,-1,-2,-3];

/** How two tracks join, harmonically: what the shared notes mean and how safe it is. */
function kind(a,b){const n=shared(a,b),same=a.t===b.t;
 if(n===7&&same)return{k:'same',lbl:'Same key',n,cls:'great'};
 if(n===7)return{k:'pivot',lbl:'Same notes',n,cls:'great'};
 if(n===6&&same)return{k:'shift',lbl:'One note changes',n,cls:'good'};
 if(n===6)return{k:'next',lbl:'Next door',n,cls:'good'};
 return{k:'clash',lbl:'Clash',n,cls:'clash'}}
function joinInfo(a,b){return{...kind(a,b),e:eStep(a,b),tj:tempoJump(a,b),gc:a.genre!==b.genre}}

/** The modes that use the same seven notes as a track, with their tonic. */
function family(t){if(t.mode==='harmonic minor')return[];return t.pcs.map(tt=>{const m=Object.keys(MODES).find(m=>{const p=scale(tt,m);return p.every(x=>t.pcs.includes(x))});return{t:tt,mode:m,br:MODES[m][1]}}).sort((a,b)=>b.br-a.br)}

const FILTER_DEF={strict:'6',mood:'any',energy:'any',genre:'same',tempo:'near'};
function passes(a,c,f){const k=kind(a,c);
 if(f.strict==='7'&&k.n<7)return false;if(f.strict==='6'&&k.n<6)return false;
 if(f.mood==='up'&&c.br<=a.br)return false;if(f.mood==='same'&&c.br!==a.br)return false;if(f.mood==='down'&&c.br>=a.br)return false;
 const st=eStep(a,c);if(f.energy==='lift'&&st!=='lifts')return false;if(f.energy==='hold'&&st!=='holds')return false;if(f.energy==='ease'&&st!=='eases off')return false;
 if(f.genre==='same'&&c.genre!==a.genre)return false;if(f.tempo==='near'&&tempoJump(a,c))return false;return true}
function score(a,c){if(!a)return Math.abs(c.e-.5);const k=kind(a,c);return({great:0,good:1,clash:6})[k.cls]+(tempoJump(a,c)?3:0)+(a.genre!==c.genre?1.5:0)+Math.abs(c.e-a.e)*2+Math.abs(c.br-a.br)*.15}
/** Library tracks ranked to follow `a`, after the filters; `skip` holds ids to leave out. */
function rankAfter(a,f=FILTER_DEF,skip=[]){return POOL().filter(c=>c!==a&&!skip.includes(c.id)&&(!a||passes(a,c,f))).sort((x,y)=>score(a,x)-score(a,y))}
/** Tracks that join well on both sides of a clashing pair. */
function bridges(a,b,skip=[]){return POOL().filter(c=>c!==a&&c!==b&&!skip.includes(c.id)&&kind(a,c).cls!=='clash'&&kind(c,b).cls!=='clash').sort((x,y)=>score(a,x)+score(x,b)-score(a,y)-score(y,b))}
/** Shortest chain of 1–3 tracks from a to b where every join is safe. */
function bridgePath(a,b,steps,skip=[]){let best=null;const pool=POOL().filter(c=>c!==a&&c!==b&&!skip.includes(c.id));
 const rec=(cur,path)=>{if(path.length===steps){if(kind(cur,b).cls!=='clash'){const s=[a,...path,b].reduce((s,t,i,arr)=>i?s+score(arr[i-1],t):0,0);if(!best||s<best.s)best={s,path:[...path]}}return}
  for(const c of pool.filter(c=>!path.includes(c)&&kind(cur,c).cls!=='clash').sort((x,y)=>score(cur,x)-score(cur,y)).slice(0,6))rec(c,[...path,c])};
 rec(a,[]);return best?best.path:[]}

// ---------- arcs ----------
const lerp=(arr,x)=>{const p=x*(arr.length-1),i=Math.min(arr.length-2,Math.floor(p)),f=p-i;return arr[i]*(1-f)+arr[i+1]*f};
const genreAt=(G,x)=>(G.find(s=>x<=s.x1)||G.at(-1)).g;
const PRESETS=[
 ['Warm-up → peak → cool-down',{E:[.35,.5,.7,.9,.95,.7,.4],M:[0,-1,-1,-2,-2,-1,0],G:[{g:'Drum & Bass',x1:1}]}],
 ['Slow burn',{E:[.3,.38,.48,.58,.7,.82,.92],M:[0,0,-1,-1,-1,-2,-2],G:[{g:'Drum & Bass',x1:1}]}],
 ['Dubstep interlude',{E:[.6,.75,.85,.9,.85,.8,.7],M:[-1,-1,-2,-2,-2,-1,-1],G:[{g:'Drum & Bass',x1:.4},{g:'Dubstep',x1:.7},{g:'Drum & Bass',x1:1}]}],
 ['Flat out',{E:[.9,.9,.92,.92,.92,.9,.9],M:[-2,-2,-2,-2,-2,-2,-2],G:[{g:'Drum & Bass',x1:1}]}]];
const clone=o=>JSON.parse(JSON.stringify(o));
let hashSeed=0;const jit=i=>((Math.sin((i+1)*12.9898+hashSeed*78.233)*43758.5453)%1+1)%1;
/** Greedy fill: each slot takes the unused track closest to the arcs at that point, never a hard clash when avoidable. */
function buildArc(arc,len,seed=null,skip=[]){const total=len*60,out=seed?[seed]:[],used=new Set([...skip,...out.map(t=>t.id)]);let tt=seed?seed.dur:0,prev=seed;
 while(tt<total&&out.length<30){const x=Math.min(1,(tt+120)/total),e=lerp(arc.E,x),m=lerp(arc.M,x),g=genreAt(arc.G,x);
  const c=POOL().filter(c=>!used.has(c.id)).map(c=>[c,(c.genre!==g?6:0)+(prev?({great:0,good:1,clash:8})[kind(prev,c).cls]:0)+(prev&&prev.genre===c.genre&&tempoJump(prev,c)?3:0)+Math.abs(c.e-e)*5+Math.abs(c.br-m)*.6+jit(c.id)*.8]).sort((a,b)=>a[1]-b[1])[0];
  if(!c)break;out.push(c[0]);used.add(c[0].id);tt+=c[0].dur;prev=c[0]}
 return out}
function setStats(list){let cl=0,tj=0;for(let k=1;k<list.length;k++){if(kind(list[k-1],list[k]).cls==='clash')cl++;if(tempoJump(list[k-1],list[k]))tj++}return{n:list.length,d:list.reduce((s,t)=>s+t.dur,0),cl,tj}}

// ---------- sound ----------
let AC=null;
/** Plays a scale (or a list of pitch classes) up from the tonic, so modes can be judged by ear. */
function playPcs(tonic,pcs,{wave='triangle',dur=.26,gap=.24,chord=false}={}){AC=AC||new (window.AudioContext||window.webkitAudioContext)();const now=AC.currentTime+.03;
 const order=[...pcs].map(p=>(p-tonic+12)%12).sort((a,b)=>a-b);if(!chord)order.push(12);
 order.forEach((st,k)=>{const o=AC.createOscillator(),g=AC.createGain();o.type=wave;o.frequency.value=220*Math.pow(2,(tonic+st-9)/12);const t0=now+(chord?0:k*gap);
  g.gain.setValueAtTime(0,t0);g.gain.linearRampToValueAtTime(chord?.08:.16,t0+.02);g.gain.exponentialRampToValueAtTime(.001,t0+(chord?1.6:dur+.2));o.connect(g).connect(AC.destination);o.start(t0);o.stop(t0+(chord?1.7:dur+.25))})}
const playTrack=t=>playPcs(t.t,t.pcs);

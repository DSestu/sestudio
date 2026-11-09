import { useState } from 'react'
import { MOOD_LADDER } from '../../../harmony'
import type { MusicTrack } from '../../../musicLibrary'
import type { LibraryStatus } from '../../../musicLibraries'
import { itemsOf, usePlaylists } from '../../../musicPlaylists'
import { fmtTime } from '../format'
import { coarseBands, useFullAnalysis, type Section } from './analysisFull'
import type { Facts } from './facts'
import { Ic } from './icons'
import { trackColor, type Colour } from './sigil'

// The track info panel at the top of the right column (SPEC-music-library §2.5): the selected
// track, else the playing one; × returns to playing, ^ folds it to the title.

const PCS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const FLAT: Record<string, string> = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#', Cb: 'B', Fb: 'E' }
const sharp = (n: string) => FLAT[n] ?? n
const SHADE: Record<string, number> = { intro: 30, buildup: 50, build: 50, drop: 72, break: 38, breakdown: 38, outro: 28, verse: 45, chorus: 65 }

export default function TrackInfo({ track, selected, facts, colour, libraries, onClear, onPlay, action }: {
  track: MusicTrack
  /** The track is the selection (else it is what plays). */
  selected: boolean
  facts: Facts
  colour: Colour
  libraries: LibraryStatus[]
  onClear: () => void
  onPlay: () => void
  /** The set action: label and handler (Add to / Remove from set). */
  action: { label: string; onClick: () => void }
}) {
  const [folded, setFolded] = useState(false)
  const f = facts(track.id)
  const c = trackColor(f, colour)
  const a = useFullAnalysis(track.id)
  const lists = usePlaylists().filter(n => itemsOf(n).some(i => i.track_id === track.id)).map(n => n.name)
  const path = track.path ?? [libraries.find(l => l.id === track.library)?.path, track.folder, track.title].filter(Boolean).join('\\')
  const h = f.key ? { tonic: sharp(f.key.split(' ')[0]), notes: new Set((f.notes ?? []).map(sharp)) } : undefined
  const sub = f.mode ? `${h?.tonic ?? ''} ${f.mode}` : ''
  return (
    <section className="flex flex-col gap-2.5 p-3 text-sm">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-base-content/50">
        <span>{selected ? 'Selected' : 'Playing'}</span>
        <span className="flex-1" />
        {selected && <button onClick={onClear} aria-label="Back to what's playing" className="grid size-6 place-items-center rounded-md hover:bg-white/10"><Ic name="close" size={13} /></button>}
        <button onClick={() => setFolded(v => !v)} aria-label={folded ? 'Show details' : 'Show less'} aria-expanded={!folded} className="grid size-6 place-items-center rounded-md hover:bg-white/10"><Ic name="up" size={13} className={`transition-transform ${folded ? 'rotate-180' : ''}`} /></button>
      </div>
      <div>
        <h3 className="text-base font-semibold leading-tight">{track.title}</h3>
        <p className="text-xs text-base-content/60">{[track.artist, track.album || track.albumName].filter(Boolean).join(' · ')}</p>
      </div>
      {!folded && <>
        <p className="flex items-center gap-1 truncate text-[11px] text-base-content/45" title={path}><Ic name="folder" size={11} />{path}</p>
        <Block label="Energy and sections"><Sections curve={f.curve} sections={a?.structure} colour={c} /></Block>
        <Block label="Spectrum" hint="low → high, over time">{a?.bands ? <Spectrum bands={a.bands} colour={c} /> : <p className="text-[11px] text-base-content/40">Reading…</p>}</Block>
        <div className="grid grid-cols-3 gap-x-3 gap-y-2">
          <Fact k="Tempo" v={f.bpm ? `${Math.round(f.bpm)} BPM` : '?'} />
          <Fact k="Key" v={f.key ?? '?'} sub={f.camelot} />
          <Fact k="Mood" v={<><i className="mr-1 inline-block size-2 rounded-full align-middle" style={{ background: f.mood?.color ?? c }} />{f.mood?.word ?? '?'}</>} sub={sub} />
          <Fact k="Energy" v={<>{f.level ?? '?'} <span className="tabular-nums text-base-content/60">{f.energy ?? ''}</span></>} sub={f.energyIn != null && f.energyOut != null ? `in ${f.energyIn} → out ${f.energyOut}` : ''} />
          <Fact k="Genre" v={f.genre ?? '?'} />
          <Fact k="Length" v={fmtTime(track.duration)} />
        </div>
        <Block label="Balance">
          <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1 text-[11px]">
            {(['Bass', 'Mids', 'Highs'] as const).map((k, i) => {
              const v = Math.round((f.balance?.[i] ?? 0) * 100)
              return <FragmentRow key={k} k={k} v={v} colour={c} />
            })}
          </div>
        </Block>
        {h && (
          <Block label="Harmony" hint={f.notes?.join(' ')}>
            <div className="grid grid-cols-12 gap-0.5">
              {PCS.map(n => (
                <span key={n} className={`grid h-6 place-items-center rounded text-[10px] ${n === h.tonic ? 'font-semibold text-base-100' : h.notes.has(n) ? 'text-base-content' : 'text-base-content/30'}`} style={{ background: n === h.tonic ? c : h.notes.has(n) ? `color-mix(in oklch, ${c} 30%, transparent)` : 'rgb(255 255 255 / .04)' }}>{n}</span>
              ))}
            </div>
            <div className="mt-1 flex gap-0.5">
              {MOOD_LADDER.map(m => (
                <span key={m.mode} title={m.mode} className={`flex-1 truncate rounded px-0.5 text-center text-[9px] leading-5 ${m.mode === f.mode ? 'font-semibold text-base-100' : 'text-base-content/40'}`} style={{ background: m.mode === f.mode ? m.color : 'rgb(255 255 255 / .04)' }}>{m.word}</span>
              ))}
            </div>
          </Block>
        )}
        {lists.length > 0 && <p className="text-[11px] text-base-content/55">In {lists.join(', ')}</p>}
      </>}
      <div className="flex gap-2">
        <button onClick={onPlay} className="btn btn-primary btn-sm rounded-xl gap-1"><svg className="size-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>Play</button>
        <button onClick={action.onClick} className="btn btn-sm rounded-xl gap-1"><Ic name="plus" size={13} width={2.2} />{action.label}</button>
      </div>
    </section>
  )
}

function Block({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-base-content/50">{label}{hint && <small className="ml-1.5 text-base-content/35">{hint}</small>}</span>
      {children}
    </div>
  )
}

function Fact({ k, v, sub }: { k: string; v: React.ReactNode; sub?: string }) {
  return (
    <div className="min-w-0 leading-tight">
      <span className="block text-[10px] uppercase tracking-wider text-base-content/40">{k}</span>
      <b className="block truncate text-[13px] font-medium">{v}</b>
      {sub && <small className="block truncate text-[11px] text-base-content/50">{sub}</small>}
    </div>
  )
}

function FragmentRow({ k, v, colour }: { k: string; v: number; colour: string }) {
  return (
    <>
      <span className="text-base-content/55">{k}</span>
      <i className="block h-1.5 overflow-hidden rounded-full bg-white/8"><u className="block h-full rounded-full" style={{ width: `${v}%`, background: colour }} /></i>
      <b className="tabular-nums font-medium">{v}</b>
    </>
  )
}

/** The energy curve as a filled line, the sections as labelled bars under it. */
export function Sections({ curve, sections = [], colour, w = 296, h = 56 }: { curve?: number[]; sections?: Section[]; colour: string; w?: number; h?: number }) {
  const v = curve?.length ? curve : [20, 20]
  const n = v.length
  const pts = v.map((e, i) => `${((i / (n - 1)) * w).toFixed(1)},${(h - 4 - (e / 100) * (h - 8)).toFixed(1)}`)
  const end = Math.max(1, ...sections.map(s => s.end_bar))
  return (
    <svg viewBox={`0 0 ${w} ${h + 22}`} className="block w-full" style={{ aspectRatio: `${w} / ${h + 22}` }} aria-hidden="true">
      <path d={`M0,${h}L${pts.join('L')}L${w},${h}Z`} fill={colour} fillOpacity=".35" />
      <path d={`M${pts.join('L')}`} fill="none" stroke={colour} strokeWidth="1.6" />
      {sections.map((s, i) => {
        const x = (s.start_bar / end) * w
        const sw = Math.max(2, ((s.end_bar - s.start_bar) / end) * w - 2)
        return (
          <g key={i}>
            <rect x={x} y={h + 4} width={sw} height={14} rx={3} fill={`oklch(${SHADE[s.label] ?? 45}% .04 240)`} />
            {sw > 30 && <text x={x + 4} y={h + 14.5} fontSize="9.5" fill="oklch(92% .01 240)">{s.label}</text>}
          </g>
        )
      })}
    </svg>
  )
}

function Spectrum({ bands, colour }: { bands: number[][]; colour: string }) {
  const B = coarseBands(bands, 48)
  const rows = B.length, cols = B[0]?.length ?? 0
  const mx = Math.max(1, ...B.flat())
  const W = 296, H = 54, cw = W / cols, ch = H / rows
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" style={{ aspectRatio: `${W} / ${H}` }} aria-hidden="true">
      {B.map((row, r) => row.map((v, c) => (
        <rect key={`${r}-${c}`} x={(c * cw).toFixed(1)} y={((rows - 1 - r) * ch).toFixed(1)} width={(cw - 0.6).toFixed(1)} height={(ch - 0.6).toFixed(1)} rx={1} fill={colour} fillOpacity={(0.06 + (0.94 * v) / mx).toFixed(2)} />
      )))}
    </svg>
  )
}

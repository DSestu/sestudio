import { useState, type ReactNode } from 'react'
import Keyboard from './Keyboard'
import { MODES, NOTE, modeNotes, modeOf, shared, type ModeName } from './scales'

const C_MAJOR = modeNotes(0, 'ionian')
const G_MAJOR = modeNotes(7, 'ionian')

/** Bars of energy as a strip of columns, 0..1 each. */
function Strip({ bars, label, className = 'bg-primary' }: { bars: number[]; label: string; className?: string }) {
  return (
    <div>
      <div className="flex h-10 items-end gap-0.5" role="img" aria-label={label}>
        {bars.map((v, i) => <i key={i} className={`flex-1 rounded-sm ${className}`} style={{ height: `${Math.max(8, v * 100)}%`, opacity: 0.4 + v * 0.6 }} />)}
      </div>
      <div className="mt-1 text-xs text-base-content/60">{label}</div>
    </div>
  )
}

const CALM = [0.2, 0.25, 0.2, 0.3, 0.25, 0.2, 0.3, 0.25, 0.2, 0.25, 0.3, 0.2]
const INTENSE = [0.7, 0.9, 0.8, 1, 0.85, 0.95, 0.8, 1, 0.9, 0.85, 1, 0.9]
const FADE_OUT = [0.9, 0.8, 0.7, 0.55, 0.4, 0.28, 0.2, 0.2]
const FADE_IN = [0.2, 0.2, 0.28, 0.4, 0.55, 0.7, 0.85, 0.95]

const P = ({ children }: { children: ReactNode }) => <p className="text-[15px] leading-relaxed text-base-content/80">{children}</p>

function Scale() {
  return (
    <>
      <P>Music uses 12 notes, the keys of one octave. Most tracks lean on just 7 of them: the <b>scale</b>. The ringed key is the <b>home note</b>, the one the track feels like it rests on.</P>
      <Keyboard notes={C_MAJOR} home={0} />
    </>
  )
}

function Shared() {
  const n = shared(C_MAJOR, G_MAJOR)
  return (
    <>
      <P>During a mix both tracks play at once. The more notes they share, the cleaner the blend: 7 are seamless, 6 smooth, 5 or fewer rub. Each note they don&apos;t share is a chance for the blend to sound off.</P>
      <Keyboard notes={C_MAJOR} other={G_MAJOR} />
      <div className="text-sm font-medium text-primary">{n} of 7 shared: smooth</div>
      <div className="text-xs text-base-content/50">Solid: in both. A: only the first track. B: only the second.</div>
    </>
  )
}

function Home() {
  return (
    <>
      <P>Keep the same 7 notes but move the <b>home note</b> and the mood changes. Each home is a <b>mode</b>. C ionian and A aeolian use exactly the same notes; one sounds bright, the other dark, and they mix perfectly: a pivot.</P>
      <Keyboard notes={C_MAJOR} other={modeNotes(9, 'aeolian')} />
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg bg-base-200 p-2"><b>C ionian</b><div className="text-xs text-base-content/60">{modeOf('ionian').word}</div></div>
        <div className="rounded-lg bg-base-200 p-2"><b>A aeolian</b><div className="text-xs text-base-content/60">{modeOf('aeolian').word}</div></div>
      </div>
    </>
  )
}

function Ladder() {
  const [mode, setMode] = useState<ModeName>('phrygian')
  return (
    <>
      <P>Keep the home note and move one note: lower darkens, higher lifts. From the brightest to the darkest, one note at a time, on G.</P>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {MODES.map(m => (
          <button
            key={m.name}
            aria-pressed={mode === m.name}
            onClick={() => setMode(m.name)}
            className={`flex items-baseline justify-between rounded-lg px-3 py-2 text-sm ${mode === m.name ? 'bg-primary/20 text-primary' : 'bg-base-200 hover:bg-base-300'}`}
          >
            <b>{m.word}</b><span className="text-xs opacity-70">G {m.name}</span>
          </button>
        ))}
      </div>
      <Keyboard notes={modeNotes(7, mode)} home={7} />
    </>
  )
}

function Energy() {
  return (
    <>
      <P>Mood comes from the notes. <b>Energy</b> is how hard the track hits: loudness, density and drums, bar by bar. A dark track can be calm, and a bright one intense.</P>
      <Strip bars={CALM} label="G phrygian · calm" />
      <Strip bars={INTENSE} label="G phrygian · intense" />
    </>
  )
}

function Calm() {
  return (
    <>
      <P>A mix overlaps one track&apos;s outro with the next one&apos;s intro, usually the calmer bars. The energy shown at a join compares those two parts, not the drops.</P>
      <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-0">
        <Strip bars={FADE_OUT} label="End of the first track" />
        <div className="h-10 w-px bg-primary/60" aria-hidden="true" />
        <Strip bars={FADE_IN} label="Start of the next" />
      </div>
    </>
  )
}

function Genres() {
  return (
    <>
      <P>Genres come with their own tempo. Inside a genre, keep the tempo within about 6%. A genre change can jump tempo; it is flagged, not forbidden.</P>
      <ul className="flex flex-col gap-1.5 text-sm">
        <li className="flex justify-between rounded-lg bg-base-200 px-3 py-2"><b>Drum &amp; bass</b><span className="tabular-nums">172–175 BPM</span></li>
        <li className="flex justify-between rounded-lg bg-base-200 px-3 py-2"><b>Dubstep</b><span className="tabular-nums">140–150 BPM</span></li>
        <li className="flex justify-between rounded-lg bg-base-200 px-3 py-2"><b>Ambient</b><span>slow, free</span></li>
      </ul>
      <div className="text-xs text-base-content/50">Smoothest way across: let the outro finish, or mix over a breakdown, then start the next intro at its own tempo.</div>
    </>
  )
}

function Join() {
  return (
    <>
      <P>Between two tracks sits one line: dots for the shared notes, the move, the mood arrow and the energy.</P>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-base-200 px-3 py-2 text-sm">
        <span className="flex gap-0.5" role="img" aria-label="7 of 7 shared notes">{Array.from({ length: 7 }, (_, i) => <i key={i} className="size-2 rounded-full bg-primary" />)}</span>
        <span>same notes · {NOTE[7]} → {NOTE[7]} darker</span>
        <span className="text-base-content/60">calm → driving</span>
      </div>
      <div className="text-xs text-base-content/50">Tap any join for the keyboard and both energy shapes.</div>
    </>
  )
}

const BODIES = [Scale, Shared, Home, Ladder, Energy, Calm, Genres, Join]

/** The content of one step of the explainer. */
export default function StepBody({ k }: { k: number }) {
  const Body = BODIES[k]
  return <Body />
}

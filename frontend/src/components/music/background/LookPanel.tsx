import { useEffect, useRef, useState } from 'react'
import { PALETTES, oklch, type PaletteName } from '../timeline/palette'
import { liveBands } from './bands'
import { bandColour } from './color'
import {
  BLUR_DEFAULT, DEFAULTS, PRESETS, SPD, STYLES, TLD, TL_DEFAULTS, applyPreset, bgPalette, getLook, setLook, useLook,
  type BgPalette, type Look, type Params, type SKey, type Style, type TKey,
} from './settings'

// The lab's review aid (SPEC-music-player Appendix): every background and timeline knob, live.

const fmt = (v: number, step: number, unit: string) => `${(+v).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0).replace(/\.0+$/, '')}${unit}`

function Slider({ label, v, min, max, step, unit, def, on }: { label: string; v: number; min: number; max: number; step: number; unit: string; def: number; on: (v: number) => void }) {
  return (
    <label className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-2 min-h-7 text-xs">
      <span className="truncate text-base-content/70">{label}</span>
      <input type="range" className="range range-xs range-primary" min={min} max={max} step={step} value={v} onChange={e => on(+e.target.value)} onDoubleClick={() => on(def)} />
      <output className="text-right tabular-nums">{fmt(v, step, unit)}</output>
    </label>
  )
}

function Chips({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5 mt-1">{children}</div>
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-semibold ${on ? 'bg-primary/25 text-primary' : 'bg-base-content/7 text-base-content/80'}`}>
      {children}
    </button>
  )
}

function Swatches({ name }: { name: PaletteName }) {
  const P = PALETTES[name]
  return <span className="flex">{[P.lo, P.mi, P.hi].map((c, i) => <i key={i} className="w-2.5 h-4.5 rounded-sm mr-0.5" style={{ background: oklch(c) }} />)}</span>
}

const Head = ({ children }: { children: React.ReactNode }) => <h4 className="mt-3 mb-1 text-[11px] uppercase tracking-wider text-base-content/45">{children}</h4>

/** The live band meter. */
function Meter() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const cv = ref.current!
    const g = cv.getContext('2d')!
    let id = 0
    const frame = () => {
      id = requestAnimationFrame(frame)
      const look = getLook()
      const p = { ...look.s, cmap: 0, rx: 0 }
      const pal = bgPalette(look)
      const dpr = devicePixelRatio || 1
      const w = (cv.width = cv.clientWidth * dpr)
      const h = (cv.height = cv.clientHeight * dpr)
      const bw = w / p.nb
      for (let i = 0; i < p.nb; i++) {
        const e = Math.min(1, liveBands.SE[i])
        const c = bandColour(0, i, p, pal)
        g.fillStyle = `oklch(${c.L}% ${Math.max(0.08, p.ch)} ${c.hue})`
        g.fillRect(i * bw + 1, h - e * h, bw - 2, e * h)
      }
      g.fillStyle = 'rgba(255,255,255,.5)'
      g.font = `${10 * dpr}px system-ui`
      g.fillText(`${p.lo} Hz`, 2, 10 * dpr)
      g.textAlign = 'right'
      g.fillText(`${(p.hi / 1000).toFixed(1)} kHz`, w - 2, 10 * dpr)
      g.textAlign = 'left'
    }
    id = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(id)
  }, [])
  return <canvas ref={ref} aria-hidden="true" className="w-full h-11 rounded-md bg-black/25" />
}

function Background({ look }: { look: Look }) {
  const cur = PRESETS.find(p => p.id === look.preset)
  const custom = (l: Look): Look => ({ ...l, preset: null })
  const set = (k: SKey, v: number) => setLook(custom({ ...look, s: { ...look.s, [k]: v } }))
  const row = (d: (typeof SPD)[number]) => (
    <Slider key={d[0]} label={d[1]} v={look.s[d[0]]} min={d[2]} max={d[3]} step={d[4]} unit={d[7]} def={DEFAULTS[d[0]]} on={v => set(d[0], v)} />
  )
  return (
    <>
      <Meter />
      <Head>Colours</Head>
      <Chips>
        <Chip on={look.bgPal === 'same'} onClick={() => setLook({ ...look, bgPal: 'same' })}>Same as timeline</Chip>
        {(Object.keys(PALETTES) as PaletteName[]).map(id => (
          <Chip key={id} on={look.bgPal === id} onClick={() => setLook({ ...look, bgPal: id as BgPalette })}><Swatches name={id} />{id}</Chip>
        ))}
      </Chips>
      <Head>Presets</Head>
      <Chips>
        {PRESETS.map(p => <Chip key={p.id} on={look.preset === p.id} onClick={() => { liveBands.reset(); setLook(applyPreset(look, p.id)) }}>{p.name}</Chip>)}
      </Chips>
      <p className="mt-2 min-h-7 text-[11px] text-base-content/60">{cur ? cur.desc : 'Custom: your own values. Pick a preset to start again.'}</p>
      <Head>Style</Head>
      <Chips>
        {STYLES.map((s: Style) => <Chip key={s} on={look.style === s} onClick={() => setLook({ ...look, style: s, preset: null })}>{s}</Chip>)}
      </Chips>
      <Head>Audio reactivity</Head>
      {SPD.filter(d => d[6] === 'a').map(row)}
      <Head>Look · {look.style}</Head>
      <Slider label="Blur" v={look.blur[look.style]} min={0} max={120} step={1} unit=" px" def={BLUR_DEFAULT[look.style]} on={v => setLook(custom({ ...look, blur: { ...look.blur, [look.style]: v } }))} />
      {SPD.filter(d => d[6] === 'v').map(row)}
    </>
  )
}

function Timeline({ look }: { look: Look }) {
  return (
    <>
      <Head>Palette</Head>
      <Chips>
        {(Object.keys(PALETTES) as PaletteName[]).map(id => <Chip key={id} on={look.tlPal === id} onClick={() => setLook({ ...look, tlPal: id })}><Swatches name={id} />{id}</Chip>)}
      </Chips>
      <Head>Shape</Head>
      {TLD.map(d => (
        <Slider key={d[0]} label={d[1]} v={look.tl[d[0]]} min={d[2]} max={d[3]} step={d[4]} unit={d[6]} def={TL_DEFAULTS[d[0]]} on={v => setLook({ ...look, tl: { ...look.tl, [d[0] as TKey]: v } })} />
      ))}
    </>
  )
}

/** The changed values as JSON, for pasting into a spec or a chat. */
function lookDiff(look: Look) {
  const s = Object.fromEntries(Object.entries(look.s).filter(([k, v]) => v !== DEFAULTS[k as keyof Params]))
  const tl = Object.fromEntries(Object.entries(look.tl).filter(([k, v]) => v !== TL_DEFAULTS[k as TKey]))
  return { style: look.style, blur: look.blur[look.style], ...s, background: look.bgPal, palette: look.tlPal, timeline: tl }
}

export default function LookPanel() {
  const look = useLook()
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'bg' | 'tl'>('bg')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 't' && !(e.target as HTMLElement).closest('input, textarea')) setOpen(o => !o)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const copy = () => {
    void navigator.clipboard?.writeText(JSON.stringify(lookDiff(look)))
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  const reset = () => {
    liveBands.reset()
    setLook(tab === 'tl' ? { ...look, tl: TL_DEFAULTS, tlPal: 'reef' } : applyPreset({ ...look, bgPal: 'abyss' }, 'roll'))
  }

  return (
    <>
      <button onClick={() => setOpen(o => !o)} className="fixed left-3 top-3 z-80 glass rounded-xl px-3 py-1.5 text-xs font-semibold" aria-label="Background and timeline look">Look</button>
      {open && (
        <div role="dialog" aria-label="Background tuning" className="fixed z-80 left-3 top-14 w-85 max-h-[calc(100vh-4.5rem)] max-md:inset-x-0 max-md:left-0 max-md:bottom-0 max-md:top-auto max-md:w-auto max-md:max-h-[58vh] flex flex-col overflow-hidden rounded-2xl glass text-xs">
          <div className="flex items-center gap-1.5 px-3 py-2">
            <span className="flex flex-1 gap-0.5">
              {(['bg', 'tl'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} className={`px-2 py-1 rounded-md text-[13px] font-semibold ${tab === t ? 'bg-base-content/10' : 'text-base-content/50'}`}>{t === 'bg' ? 'Background' : 'Timeline'}</button>
              ))}
            </span>
            <button onClick={copy} className="px-2 py-1 rounded-lg bg-base-content/8">{copied ? 'Copied' : 'Copy'}</button>
            <button onClick={reset} className="px-2 py-1 rounded-lg bg-base-content/8">Reset</button>
            <button onClick={() => setOpen(false)} aria-label="Close" className="px-2 py-1 rounded-lg bg-base-content/8">×</button>
          </div>
          <div className="overflow-auto px-3 pb-2">{tab === 'bg' ? <Background look={look} /> : <Timeline look={look} />}</div>
          <p className="px-3 pb-2 text-[11px] text-base-content/60">Double-click a slider to reset it · T toggles this panel</p>
        </div>
      )}
    </>
  )
}

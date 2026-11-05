import { MOOD_LADDER, moodOf } from '../../../harmony'
import { openFitsFor } from '../../../musicFits'
import { genreColor, genreShort, useSummary } from '../../../musicMeta'
import { useModalBack } from '../../../useModalBack'
import ResponsiveModal from '../../ResponsiveModal'
import { fmtBpm } from '../format'
import { rawOf, useAnalyses } from '../mix/analysis'
import { openHarmonyBasics } from './store'
import Keyboard from './Keyboard'
import { closeKeyCard, useKeyCard } from './keyCardStore'
import { NOTE, family, parseReading } from './scales'

/** E1.5: one place that explains a track's harmony. Mount once (App); open with openKeyCard(). */
export default function KeyCard() {
  const target = useKeyCard()
  useModalBack(!!target, closeKeyCard)
  return target ? <Card id={target.id} title={target.title} /> : null
}

/** The energy curve across the track as bars, in the mood's colour. */
function EnergyShape({ curve, color }: { curve: number[]; color: string }) {
  const w = 260
  const h = 34
  const bw = w / curve.length
  return (
    <svg role="img" aria-label="Energy across the track" viewBox={`0 0 ${w} ${h}`} width="100%" style={{ maxWidth: w }}>
      {curve.map((v, i) => {
        const bh = Math.max(1, (Math.min(100, v) / 100) * h)
        return <rect key={i} x={i * bw} y={h - bh} width={Math.max(0.5, bw - 0.6)} height={bh} fill={color} fillOpacity={0.75} />
      })}
    </svg>
  )
}

function Card({ id, title }: { id: string; title: string }) {
  const s = useSummary(id)
  useAnalyses([id])
  const h = s?.harmony?.track
  const reading = h && parseReading(`${h.tonic} ${h.mode}`)
  const mood = moodOf(h?.mode)
  const curve = rawOf(id)?.energy
  const mates = reading ? family(reading.notes) : []
  const color = mood?.color ?? 'var(--color-primary)'
  return (
    <ResponsiveModal onClose={closeKeyCard} boxClassName="flex max-w-3xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-center">
        <h2 className="flex-1 truncate text-lg font-semibold">{title}</h2>
        <button onClick={closeKeyCard} aria-label="Close" className="btn btn-ghost btn-sm btn-circle">✕</button>
      </div>
      {reading ? (
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <div className="text-3xl font-bold" style={{ color }}>{mood?.word}</div>
            <div className="text-sm text-base-content/60">
              {reading.tonic} {reading.mode.toLowerCase()}
              {s?.bpm ? ` · ${fmtBpm(s.bpm)} BPM` : ''}
              {s?.genre && <> · <span style={{ color: genreColor(s.genre) }}>{genreShort(s.genre)}</span></>}
            </div>
            <Keyboard notes={reading.notes} home={reading.home} />
            <div className="flex flex-wrap gap-2">
              <button onClick={() => { closeKeyCard(); openFitsFor(id) }} className="btn btn-sm">Fits next</button>
              <button onClick={() => { closeKeyCard(); openHarmonyBasics(2) }} className="btn btn-sm btn-ghost">What is a mode?</button>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <div>
              <div className="mb-1 text-xs font-semibold text-base-content/50">Mood ladder</div>
              <div className="flex flex-wrap gap-1.5">
                {MOOD_LADDER.map(m => (
                  <span
                    key={m.word}
                    aria-current={m.word === mood?.word || undefined}
                    className={`rounded-full px-2.5 py-1 text-xs ${m.word === mood?.word ? 'font-semibold text-neutral' : 'text-base-content/55 ring-1 ring-white/15'}`}
                    style={m.word === mood?.word ? { background: m.color } : undefined}
                  >
                    {m.word}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-base-content/50">Same 7 notes, other centres</div>
              {mates.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {mates.map(m => (
                    <span
                      key={m.mode}
                      aria-current={m.tonic === reading.home || undefined}
                      className={`rounded-full px-2.5 py-1 text-xs ${m.tonic === reading.home ? 'bg-white/15 font-semibold' : 'text-base-content/55 ring-1 ring-white/15'}`}
                    >
                      {NOTE[m.tonic]} {m.mode}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-base-content/50">Harmonic minor has no modal family.</p>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-semibold text-base-content/50">Energy across the track</div>
              {curve?.length ? <EnergyShape curve={curve} color={color} /> : <p className="text-sm text-base-content/50">Not analysed yet.</p>}
              <p className="mt-1 text-xs text-base-content/50">{s?.energyLevel ? `${s.energyLevel} · ` : ''}intro and outro are where mixes overlap</p>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-sm text-base-content/60">This track has no key yet: its analysis is not done.</p>
      )}
    </ResponsiveModal>
  )
}

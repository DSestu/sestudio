import { useState } from 'react'
import { refreshSummary, useSummary } from '../../../musicMeta'
import { useModalBack } from '../../../useModalBack'
import ResponsiveModal from '../../ResponsiveModal'
import { toast } from '../toast'
import Keyboard from './Keyboard'
import { parseReading } from './scales'
import { closeUnsure, saveMode, useUnsure } from './unsure'

/** E10.2: the analysis hesitates between two modes; play both and pick one. Mount once (App); open with openUnsure(). */
export default function UnsureMode() {
  const target = useUnsure()
  useModalBack(!!target, closeUnsure)
  return target ? <Settle id={target.id} title={target.title} /> : null
}

function Settle({ id, title }: { id: string; title: string }) {
  const track = useSummary(id)?.harmony?.track
  const [busy, setBusy] = useState(false)
  const options = [track && parseReading(`${track.tonic} ${track.mode}`), track?.alt ? parseReading(track.alt) : undefined]
  const pick = (label: string, tonic: string, mode: string) => {
    setBusy(true)
    saveMode(id, tonic, mode).then(
      () => { refreshSummary(id); toast(`Saved: ${title} is ${label}`); closeUnsure() },
      e => { setBusy(false); window.alert((e as Error).message) },
    )
  }
  return (
    <ResponsiveModal onClose={closeUnsure} boxClassName="flex max-w-2xl flex-col gap-3 p-4 sm:p-6">
      <div className="flex items-center">
        <h2 className="flex-1 text-lg font-semibold">Which one sounds right?</h2>
        <button onClick={closeUnsure} aria-label="Close" className="btn btn-ghost btn-sm btn-circle">✕</button>
      </div>
      <p className="text-sm text-base-content/60">
        The analysis hesitates between two modes for <b className="text-base-content">{title}</b>. Play both and pick the one that matches the track. Your answer is kept and used for every match.
      </p>
      {options[0] && options[1] ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {options.map(o => o && (
            <div key={`${o.tonic} ${o.mode}`} className="flex flex-col gap-2 rounded-box bg-base-200 p-3">
              <div className="text-xl font-semibold text-primary">{o.word}</div>
              <div className="text-sm text-base-content/60">{o.tonic} {o.mode.toLowerCase()}</div>
              <Keyboard notes={o.notes} home={o.home} width={220} listen="Listen" />
              <button disabled={busy} onClick={() => pick(`${o.tonic} ${o.mode.toLowerCase()}`, o.tonic, o.mode)} className="btn btn-primary btn-sm">This one</button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-base-content/60">This track has no second reading to compare (it may be settled already).</p>
      )}
      <div className="flex justify-end">
        <button onClick={() => { toast('Kept as unsure: it still shows with a ?'); closeUnsure() }} className="btn btn-ghost btn-sm">Not sure, leave it</button>
      </div>
    </ResponsiveModal>
  )
}

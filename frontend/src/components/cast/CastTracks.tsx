import { useEffect, useState } from 'react'
import { castSetTracks, castTracks, type CastTracks as Tracks } from '../../api'
import { castSetTextTrack, useCastState } from '../../cast'
import { dlnaSeek } from '../../dlnaControl'

/** The audio track and captions of what is cast, as dropdowns.
 *
 * A Chromecast's captions are its own, switched on the receiver; its audio,
 * and a DLNA TV's both, come from the server and change in place, as the
 * quality does — or, for a TV still playing the file itself, by moving it to
 * the re-encoded stream once, put back where it was. */
export default function CastTracks({ target, position }: {
  target: 'dlna' | 'chromecast'
  /** Where the cast plays: a TV restarted for a change resumes there. */
  position: number
}) {
  const cast = useCastState()
  // A Chromecast's from its playlist, when that is the server's own.
  const url = target === 'chromecast' ? cast.mediaUrl : undefined
  const ladder = target === 'dlna' || Boolean(cast.liveId)
  const [tracks, setTracks] = useState<Tracks | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!ladder) return
    let live = true
    void castTracks(url).then(found => { if (live) setTracks(found) })
    return () => { live = false }
  }, [ladder, url])

  async function change(next: { audio?: number; lang?: string }) {
    const id = target === 'dlna' ? 'dlna' : cast.liveId
    const at = position
    setBusy(true)
    try {
      setTracks(t => t && {
        ...t,
        audio_now: next.audio ?? t.audio_now,
        lang_now: next.lang === undefined ? t.lang_now : next.lang || null,
      })
      if (await castSetTracks(id, next)) {
        await new Promise(r => setTimeout(r, 1500)) // let the renderer load
        await dlnaSeek(at)
      }
    } catch {
      // the dropdown keeps the pick; the cast plays on as it was
    } finally {
      setBusy(false)
    }
  }

  const voices = tracks?.audio ?? []
  // One entry a language: a TV's captions are burnt in by language.
  const langs = [...new Map((tracks?.subtitles ?? []).map(s => [s.lang, s])).values()]
  const chromecastCaptions = target === 'chromecast' && cast.textTracks.length > 0
  if (voices.length < 2 && !chromecastCaptions && !(target === 'dlna' && langs.length)) return null

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {voices.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-base-content/60">Audio</span>
          <select
            className="select select-sm select-bordered"
            disabled={busy}
            value={tracks!.audio_now}
            onChange={e => void change({ audio: Number(e.target.value) })}
          >
            {voices.map(v => <option key={v.index} value={v.index}>{v.label}</option>)}
          </select>
        </label>
      )}
      {chromecastCaptions && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-base-content/60">Captions</span>
          <select
            className="select select-sm select-bordered"
            value={cast.activeTextTrackId ?? ''}
            onChange={e => castSetTextTrack(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">Off</option>
            {cast.textTracks.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      )}
      {target === 'dlna' && langs.length > 0 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="text-base-content/60">Captions</span>
          <select
            className="select select-sm select-bordered"
            disabled={busy}
            value={tracks!.lang_now ?? ''}
            onChange={e => void change({ lang: e.target.value })}
          >
            <option value="">Off</option>
            {langs.map(s => <option key={s.lang} value={s.lang}>{s.label}</option>)}
          </select>
        </label>
      )}
    </div>
  )
}

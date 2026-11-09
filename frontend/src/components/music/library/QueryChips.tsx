import { useMusicQuery } from '../../../musicQuery'
import { parseQuery } from './searchWords'

/** The sound words of the Music search as chips in front of the field (SPEC-music-library §2.3). */
export default function QueryChips() {
  const q = parseQuery(useMusicQuery())
  return (
    <>
      {q.moods.map(m => <span key={m} className="shrink-0 rounded-md bg-primary/15 px-1.5 text-xs leading-6 text-primary"><i className="mr-1 not-italic text-primary/60">mood</i>{m}</span>)}
      {q.bpm !== undefined && <span className="shrink-0 rounded-md bg-primary/15 px-1.5 text-xs leading-6 text-primary"><i className="mr-1 not-italic text-primary/60">tempo</i>{q.bpm}</span>}
    </>
  )
}

import { setGenre } from '../mix/analysis'
import { GENRES } from './setBuilder'

const blur = () => (document.activeElement as HTMLElement | null)?.blur()

const ORIGIN: Record<string, string> = {
  tag: "From the file's tag",
  source: "From the source's metadata",
  model: 'Detected by the AI model',
  rules: 'Guessed from tempo and sound',
  user: 'Set by you',
}

/** A track's genre: dashed with its confidence when doubtful; one click confirms it or picks another. */
export default function GenreTag({ id, genre, conf, source, onChange }: { id: string; genre: string; conf: number; source?: string; onChange: () => void }) {
  // The model's best style rarely tops 0.5 even when right: its doubt starts lower than the rules'.
  const doubtful = conf < (source === 'model' ? 0.2 : 0.7)
  const pick = (g: string | null) => {
    blur()
    setGenre(id, g).then(onChange, e => window.alert((e as Error).message))
  }
  return (
    <div className="dropdown dropdown-end">
      <button
        tabIndex={0}
        title={`${ORIGIN[source ?? 'rules'] ?? ''}${doubtful ? ' — not sure: confirm or change it' : ' — click to change'}`}
        className={`rounded-full px-2 py-0.5 text-[11px] leading-none ${doubtful ? 'border border-dashed border-white/30 text-base-content/60' : 'bg-white/8 text-base-content/80'}`}
      >
        {genre}{doubtful && ` ${Math.round(conf * 100)}%`}
      </button>
      <ul tabIndex={0} className="dropdown-content menu menu-sm z-30 max-h-72 w-52 flex-nowrap overflow-y-auto rounded-xl bg-base-200 p-1 shadow-lg">
        {doubtful && <li><button onClick={() => pick(genre)}>Confirm {genre}</button></li>}
        {GENRES.filter(g => g !== genre).map(g => <li key={g}><button onClick={() => pick(g)}>{g}</button></li>)}
      </ul>
    </div>
  )
}

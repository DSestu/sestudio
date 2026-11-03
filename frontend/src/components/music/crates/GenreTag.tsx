import { setGenre } from '../mix/analysis'
import { GENRES } from './setBuilder'

const blur = () => (document.activeElement as HTMLElement | null)?.blur()

/** A track's genre: dashed with its confidence when doubtful; one click confirms it or picks another. */
export default function GenreTag({ id, genre, conf, onChange }: { id: string; genre: string; conf: number; onChange: () => void }) {
  const doubtful = conf < 0.7
  const pick = (g: string | null) => {
    blur()
    setGenre(id, g).then(onChange, e => window.alert((e as Error).message))
  }
  return (
    <div className="dropdown dropdown-end">
      <button
        tabIndex={0}
        title={doubtful ? 'Not sure about this genre: confirm or change it' : 'Change the genre'}
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

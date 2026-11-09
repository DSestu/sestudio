import { setMusicQuery, useMusicQuery } from '../../musicQuery'
import { SEARCH_FIELD } from '../../titleSearch'
import { SearchIcon } from '../search/SearchParts'
import QueryChips from './library/QueryChips'

/** The header card's field on the Music page: it searches the libraries and online, or takes a pasted link. */
export default function MusicHeaderSearch() {
  const query = useMusicQuery()
  return (
    <div className="relative flex-1 min-w-[30rem] max-w-[53.75rem]">
      <div className={SEARCH_FIELD}>
        <SearchIcon />
        <QueryChips />
        <input
          type="search"
          value={query}
          onChange={e => setMusicQuery(e.target.value)}
          aria-label="Search your libraries"
          placeholder="Search names or sounds: “dark 128”, “deadmau5”, or paste a link"
          className="grow bg-transparent outline-none text-sm min-w-0"
        />
      </div>
    </div>
  )
}

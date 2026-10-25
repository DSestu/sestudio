import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import type { CatalogInfo, SeasonCard } from '../../api'
import type { Kind, MergeOptions, RecentSearch } from '../../titleSearch'
import { PREVIEW_ROWS, SEARCH_FIELD, clearRecentSearches, useRecentSearches, useTitleSearch } from '../../titleSearch'
import { KindChips, OptionsButton, RecentSearchList, SearchIcon, TitleResults } from './SearchParts'

interface Props {
  catalogs: CatalogInfo[]
  merge: MergeOptions
  /** The results page's query and kind, which the bar shows; '' elsewhere. */
  query: string
  kind: Kind
  /** No bar (the player): only Ctrl K brings the search up, over the page. */
  barless?: boolean
  onOpenCard: (card: SeasonCard) => void
  onSearch: (term: string, kind: Kind) => void
}

const RESULTS_ID = 'desktop-search-results'
const RECENT_ID = 'desktop-search-recent'

/**
 * The desktop's search: a bar pinned above every page that opens in place —
 * the field grows a panel downward. Empty, it lists recent searches; typed, its
 * first row is the full results page (what Enter does), then a few titles.
 */
export default function DesktopSearch({ catalogs, merge, query, kind: pageKind, barless = false, onOpenCard, onSearch }: Props) {
  const [text, setText] = useState(query)
  const [kind, setKind] = useState<Kind>(pageKind)
  const [open, setOpen] = useState(false)
  // Typed: 0 is the results page, i the (i-1)th title. Empty: the ith recent.
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const q = text.trim()
  const search = useTitleSearch(open ? q : '', kind, merge, catalogs.some(c => c.id === 'tmdb'))
  const recent = useRecentSearches()
  const rowCount = q ? 1 + Math.min(search.cards.length, PREVIEW_ROWS) : recent.length

  // Ctrl K (or Ctrl F, which used to focus the old bar) from anywhere.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !['k', 'f'].includes(e.key.toLowerCase())) return
      if (!window.matchMedia('(min-width: 768px)').matches) return
      e.preventDefault()
      setOpen(true)
      // The field may only now be mounted (no bar on the player).
      requestAnimationFrame(() => { input.current?.focus(); input.current?.select() })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const close = () => { setOpen(false); input.current?.blur() }
  const seeAll = () => { if (q) { close(); onSearch(q, kind) } }
  const openCard = (card: SeasonCard) => { close(); onOpenCard(card) }
  const pickRecent = (r: RecentSearch) => { close(); onSearch(r.term, r.kind) }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') { e.preventDefault(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, rowCount - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (!q) { if (recent[active]) pickRecent(recent[active]); return }
      const card = active > 0 ? search.cards[active - 1] : undefined
      if (card && !e.ctrlKey && !e.metaKey) openCard(card)
      else seeAll()
    }
  }

  const onResults = query !== ''
  if (barless && !open) return null

  const field = (
    <div className={`relative ${barless ? 'w-[min(36rem,90vw)]' : 'flex-1 max-w-xl'}`}>
      <div className={`${SEARCH_FIELD} ${open ? 'rounded-b-none border-b-base-300' : ''}`}>
        <SearchIcon />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={q ? RESULTS_ID : RECENT_ID}
          aria-activedescendant={open && active < rowCount ? `${q ? RESULTS_ID : RECENT_ID}-${active}` : undefined}
          aria-label="Search films, series and anime on every source"
          placeholder="Search films, series and anime"
          value={text}
          onChange={e => { setText(e.target.value); setActive(0); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="grow bg-transparent outline-none text-sm min-w-0"
        />
        <kbd className="kbd kbd-sm">{open ? 'Esc' : 'Ctrl K'}</kbd>
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full z-10 max-h-[70dvh] overflow-y-auto overscroll-contain rounded-b-box border-2 border-t-0 border-primary/80 bg-base-200 p-2 shadow-2xl">
          {q ? (
            <TitleResults
              search={search}
              query={q}
              kind={kind}
              onKind={k => { setKind(k); setActive(0); input.current?.focus() }}
              listId={RESULTS_ID}
              active={active}
              onActive={setActive}
              onOpen={openCard}
              onSeeAll={seeAll}
              enterHint
              footer={
                <span className="flex items-center gap-3 text-xs text-base-content/50">
                  <span><kbd className="kbd kbd-xs">↓</kbd> titles</span>
                  <span><kbd className="kbd kbd-xs">Enter</kbd> open</span>
                </span>
              }
            />
          ) : (
            <RecentSearchList
              items={recent}
              listId={RECENT_ID}
              active={active}
              onActive={setActive}
              onPick={pickRecent}
              onClear={() => { clearRecentSearches(); input.current?.focus() }}
            />
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      {open && (
        <div aria-hidden="true" onClick={close} className="fixed inset-0 z-0 bg-black/45" />
      )}
      {barless ? (
        <div className="fixed inset-x-0 top-6 z-10 flex justify-center">{field}</div>
      ) : (
        <div className="relative z-10 flex items-center gap-4 h-16">
          {field}
          {onResults ? (
            <>
              <KindChips value={pageKind} onChange={k => onSearch(query, k)} />
              <OptionsButton />
            </>
          ) : (
            <span className="text-xs text-base-content/40">
              on {catalogs.filter(c => c.id !== 'tmdb').length} sources{catalogs.some(c => c.id === 'tmdb') ? ' + TMDB' : ''}
            </span>
          )}
        </div>
      )}
    </>
  )
}

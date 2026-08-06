import { useEffect, useRef, useState } from 'react'
import type { AppSettings } from '../api'
import type { CollectionEntry } from '../collections'
import {
  entries as collectionEntries,
  moveMany,
  refKey,
  unsaveMany,
  useCollections,
} from '../collections'
import EmptyState from '../components/EmptyState'
import { matchesAllGenres } from '../genreFilter'
import GenreChips from '../components/GenreChips'
import LayoutToggle from '../components/LayoutToggle'
import SelectionBar, { type BulkAction } from '../components/library/SelectionBar'
import { sheetIcon } from '../components/library/sheetIcons'
import TitleRow from '../components/library/TitleRow'
import WatchingRow from '../components/library/WatchingRow'
import PosterGrid from '../components/PosterGrid'
import { setLibraryLayout, useLibraryLayout, type LayoutTab } from '../libraryLayout'
import type { View } from '../nav'
import { cardFor, openWatching, savedItems, watchingItems, type OpenTitle } from '../rowItems'
import { setSelectionActive } from '../selectionMode'
import { useTitlesMeta, type TitleRef } from '../useTitlesMeta'
import { dismissMany, setWatched, useWatchState, watching, type WatchingItem } from '../watchState'

const TABS = [
  { id: 'watching', label: 'Watching' },
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'favourites', label: 'Favourites' },
] as const

interface Props {
  settings: AppSettings
  onOpen: OpenTitle
  onNavigate: (v: View) => void
}

const EMPTY_COPY: Record<LayoutTab, { title: string; message: string }> = {
  watching: {
    title: 'Nothing in progress',
    message: 'Episodes you start show up here so you can pick them back up.',
  },
  watchlist: {
    title: 'Your watchlist is empty',
    message: 'Use the ☆ control on any title to save it for later.',
  },
  favourites: {
    title: 'No favourites yet',
    message: 'Use the ♥ control on any title you love to keep it here.',
  },
}

/** Everything the user has saved or started, as three tabs with a layout choice. */
export default function LibraryView({ settings, onOpen, onNavigate }: Props) {
  const [tab, setTab] = useState<LayoutTab>('watching')
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Per tab: the genres on offer differ between them, so a selection carried
  // across would silently hide everything on the tab you just opened.
  const [pickedGenres, setPickedGenres] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const collections = useCollections()
  const watch = useWatchState()
  const layouts = useLibraryLayout()
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([])

  // AppShell yields the mobile tab bar's slot while this is up.
  useEffect(() => {
    setSelectionActive(selecting)
    return () => setSelectionActive(false)
  }, [selecting])

  function exitSelection() {
    setSelecting(false)
    setPicked(new Set())
    setError(null)
  }

  function changeTab(next: LayoutTab) {
    setTab(next)
    setPickedGenres(new Set())
    // Selection is per tab, so switching tabs discards it.
    if (selecting) exitSelection()
  }

  function toggleGenre(genre: string) {
    setPickedGenres(prev => {
      const next = new Set(prev)
      if (next.has(genre)) next.delete(genre)
      else next.add(genre)
      return next
    })
  }

  function togglePicked(key: string) {
    setPicked(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const inProgress = watching(watch)
  const saved: Record<'watchlist' | 'favourites', CollectionEntry[]> = {
    watchlist: collectionEntries('watchlist', collections),
    favourites: collectionEntries('favourites', collections),
  }

  const counts: Record<LayoutTab, number> = {
    watching: inProgress.length,
    watchlist: saved.watchlist.length,
    favourites: saved.favourites.length,
  }

  const layout = layouts[tab]
  const openTitle = (entry: CollectionEntry) =>
    onOpen(cardFor(entry.series, entry.season, entry.poster_url, entry.page_url, entry.source), 0, entry.lang || settings.lang)

  // A saved title carries no year or kind flag of its own, so season 0 stands for
  // "film" here exactly as it does where titles are saved.
  // Narrowed once: `saved` has no watching list, and `tab` includes it.
  const savedOnTab: CollectionEntry[] = tab === 'watching' ? [] : saved[tab]

  const titles: TitleRef[] = tab === 'watching'
    ? inProgress.map(i => ({ key: `w-${i.series}-${i.season}`, name: i.series, isFilm: i.season === 0 }))
    : savedOnTab.map(e => ({ key: refKey(e), name: e.series, isFilm: e.season === 0 }))

  const metas = useTitlesMeta(titles, settings.tmdb_configured)

  // Only genres something on this tab actually has — see GenreChips.
  const availableGenres = [...new Set([...metas.values()].flatMap(m => m.genres))].sort()

  const matchesGenres = (key: string) =>
    matchesAllGenres(metas.get(key)?.genres, pickedGenres)

  const visibleWatching = inProgress.filter(i => matchesGenres(`w-${i.series}-${i.season}`))
  const visibleSaved = savedOnTab.filter(e => matchesGenres(refKey(e)))
  const visibleCount = tab === 'watching' ? visibleWatching.length : visibleSaved.length
  // savedItems keys its cards `${list}-${series}-${season}`, not by refKey.
  const visibleGridKeys = new Set(visibleSaved.map(e => `${tab}-${e.series}-${e.season}`))

  /** Every selectable key on the active tab — filtered, so select-all cannot
   *  reach a title the genre filter is hiding. */
  const keysOnTab = tab === 'watching'
    ? visibleWatching.map(i => `w-${i.series}-${i.season}`)
    : visibleSaved.map(refKey)

  const allPicked = keysOnTab.length > 0 && picked.size === keysOnTab.length
  const somePicked = picked.size > 0 && !allPicked

  function toggleAll() {
    setPicked(allPicked ? new Set() : new Set(keysOnTab))
  }

  /** Run a bulk mutation, surfacing failure since the store rolls itself back. */
  async function runBulk(mutate: () => Promise<void>) {
    setError(null)
    try {
      await mutate()
      exitSelection()
    } catch {
      setError('That change could not be saved. Nothing was applied.')
    }
  }

  /** Watching keys are prefixed for the grid; map back to the series they name. */
  const pickedWatching = (): WatchingItem[] =>
    inProgress.filter(i => picked.has(`w-${i.series}-${i.season}`))

  const bulkActions: BulkAction[] = tab === 'watching'
    ? [
        {
          id: 'watched',
          label: 'Mark watched',
          icon: sheetIcon.watched,
          onSelect: () =>
            runBulk(async () => {
              for (const item of pickedWatching()) {
                setWatched(
                  {
                    number: item.resume.number,
                    title: item.resume.title,
                    embed_urls: {},
                    series_name: item.series,
                    season: item.season,
                    poster_url: item.poster_url,
                    page_url: item.page_url,
                    lang: item.lang,
                    source: item.source,
                  },
                  true,
                )
              }
            }),
        },
        {
          id: 'remove',
          label: 'Remove',
          icon: sheetIcon.remove,
          destructive: true,
          // Same watermark as the single-item action, so both mean the same thing.
          onSelect: () => runBulk(() => dismissMany(pickedWatching())),
        },
      ]
    : [
        ...(tab === 'watchlist'
          ? [
              {
                id: 'favourite',
                label: 'Move to favourites',
                icon: sheetIcon.favourite,
                onSelect: () =>
                  runBulk(() => moveMany('watchlist', 'favourites', [...picked])),
              },
            ]
          : []),
        {
          id: 'remove',
          label: 'Remove',
          icon: sheetIcon.remove,
          destructive: true,
          onSelect: () => runBulk(() => unsaveMany(tab, [...picked])),
        },
      ]

  /** Arrow keys move between tabs, as the tablist role promises. */
  function onTabKey(e: React.KeyboardEvent, index: number) {
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = (index + delta + TABS.length) % TABS.length
    changeTab(TABS[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xl font-semibold tracking-tight">Library</h2>
        <div className="flex items-center gap-2">
          <LayoutToggle layout={layout} onChange={next => setLibraryLayout(tab, next)} />
          <button
            onClick={() => (selecting ? exitSelection() : setSelecting(true))}
            aria-pressed={selecting}
            disabled={counts[tab] === 0}
            className={`btn btn-sm ${selecting ? 'btn-active' : 'btn-ghost'}`}
          >
            {selecting ? 'Done' : 'Select'}
          </button>
        </div>
      </div>

      <div role="tablist" aria-label="Library" className="tabs tabs-box w-full sm:w-fit">
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={el => { tabRefs.current[i] = el }}
            role="tab"
            id={`library-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`library-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => changeTab(t.id)}
            onKeyDown={e => onTabKey(e, i)}
            className={`tab flex-1 sm:flex-none gap-2 ${tab === t.id ? 'tab-active' : ''}`}
          >
            {t.label}
            <span className="badge badge-ghost badge-sm">{counts[t.id]}</span>
          </button>
        ))}
      </div>

      {/* Below the tabs, above the list: the filter belongs to the tab it acts
          on, and it only appears once TMDB has told us what is in there. */}
      {counts[tab] > 0 && (
        <GenreChips
          available={availableGenres}
          selected={pickedGenres}
          onToggle={toggleGenre}
          onClear={() => setPickedGenres(new Set())}
        />
      )}

      <div
        role="tabpanel"
        id={`library-panel-${tab}`}
        aria-labelledby={`library-tab-${tab}`}
        tabIndex={0}
      >
        {/* Select-all lives in the content, not the action bar: as a text link
            down beside the counter it was too easy to miss. Same indeterminate
            checkbox idiom as the playlist's "select all for download". */}
        {selecting && counts[tab] > 0 && (
          <label className="flex items-center gap-2.5 mb-3 px-3 py-2.5 rounded-box bg-base-200/60 ring-1 ring-base-300 cursor-pointer text-sm font-medium">
            <input
              type="checkbox"
              checked={allPicked}
              ref={el => { if (el) el.indeterminate = somePicked }}
              onChange={toggleAll}
              className="checkbox checkbox-primary checkbox-sm"
            />
            {allPicked ? 'Select none' : 'Select all'}
            <span className="text-base-content/50 font-normal">({keysOnTab.length})</span>
          </label>
        )}

        {counts[tab] === 0 ? (
          <EmptyState
            title={EMPTY_COPY[tab].title}
            message={EMPTY_COPY[tab].message}
            action={{ label: 'Search', onClick: () => onNavigate('search') }}
          />
        ) : visibleCount === 0 ? (
          // Filtered to nothing, which is a different situation from an empty
          // tab and needs a way back rather than a prompt to go and search.
          <EmptyState
            title="No titles match those genres"
            message="A title has to carry every genre you pick. Try dropping one."
            action={{ label: 'Clear genres', onClick: () => setPickedGenres(new Set()) }}
          />
        ) : tab === 'watching' ? (
          layout === 'detail' ? (
            <div className="flex flex-col gap-2">
              {visibleWatching.map(item => {
                const key = `w-${item.series}-${item.season}`
                return (
                  <WatchingRow
                    key={key}
                    item={item}
                    onOpen={openWatching(onOpen)}
                    meta={metas.get(key)}
                    selection={
                      selecting
                        ? { selected: picked.has(key), onToggle: () => togglePicked(key) }
                        : undefined
                    }
                  />
                )
              })}
            </div>
          ) : (
            <PosterGrid
              items={watchingItems(visibleWatching, onOpen)}
              selection={selecting ? { keys: picked, onToggle: togglePicked } : undefined}
            />
          )
        ) : layout === 'detail' ? (
          <div className="flex flex-col gap-2">
            {visibleSaved.map(entry => {
              const key = refKey(entry)
              return (
                <TitleRow
                  key={key}
                  entry={entry}
                  onOpen={openTitle}
                  meta={metas.get(key)}
                  selection={
                    selecting
                      ? { selected: picked.has(key), onToggle: () => togglePicked(key) }
                      : undefined
                  }
                />
              )
            })}
          </div>
        ) : (
          <PosterGrid
            // savedItems reads the store itself and keys cards its own way, so
            // the filter is applied to what it produced rather than to its input.
            items={savedItems(tab, collections, onOpen, settings.lang).filter(i =>
              visibleGridKeys.has(i.key),
            )}
            selection={selecting ? { keys: picked, onToggle: togglePicked } : undefined}
          />
        )}
      </div>

      {selecting && (
        <SelectionBar
          count={picked.size}
          onCancel={exitSelection}
          actions={bulkActions}
          error={error}
        />
      )}
    </div>
  )
}

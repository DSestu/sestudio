import { useMemo, useState } from 'react'
import type { AppSettings, DownloadedFile, DownloadedTitle, SeasonCard } from '../../api'
import {
  DOWNLOADED_SOURCE, deleteDownloadedFile, downloadedPageUrl, downloadedThumbUrl,
} from '../../api'
import { fmtSize, refreshDownloadedLibrary, useDownloadedLibrary } from '../../downloadedLibrary'
import { matchesAllGenres } from '../../genreFilter'
import GenreChips from '../GenreChips'
import ResponsiveModal from '../ResponsiveModal'
import DownloadedBrowser from './DownloadedBrowser'
import DownloadedTree from './DownloadedTree'
import { setLibraryLayout, useLibraryLayout } from '../../libraryLayout'
import { useMergedCards } from '../../useMergedCards'
import type { SortKey } from '../../sortItems'
import { SORTS_FOR, defaultSortFor, sortItems } from '../../sortItems'
import { useTitlesMeta, type TitleRef } from '../../useTitlesMeta'
import DetailRow from '../library/DetailRow'
import EmptyState from '../EmptyState'
import LayoutToggle from '../LayoutToggle'
import PosterGrid from '../PosterGrid'
import SortSelect from '../SortSelect'
import ToolbarToggle from '../ToolbarToggle'
import DownloadedFilesModal from './DownloadedFilesModal'

/** One shelf entry: the merged card, and every downloaded season behind it. */
interface Group {
  key: string
  card: SeasonCard
  /** Lowest season first — the one that opens. */
  parts: DownloadedTitle[]
}

/**
 * A downloaded title as a search-result card, so the same merge can run over it.
 *
 * `newsid` is the title's own key, which is what maps the merged card back to
 * the seasons it came from.
 */
function toCard(title: DownloadedTitle): SeasonCard {
  return {
    newsid: title.key,
    title: title.series,
    series_name: title.series,
    season_number: title.season,
    poster_url: title.poster_url,
    page_url: title.page_url || downloadedPageUrl(title.series, title.season),
    is_film: title.is_film,
    is_anime: false,
    // Always the shelf, never the site it came from. `titleKey` scopes identity
    // by source so same-name titles on two sites never merge by accident — but
    // here there is one shelf and one disk, and a show whose S1 came from
    // fstream and S2 from senpai is still one show.
    source: DOWNLOADED_SOURCE,
  }
}

/** "S1–S3 · 24 files · VF, VOSTFR · 41.2 GB" — the whole shelf entry at a glance. */
function summarise(parts: DownloadedTitle[]): string {
  const files = parts.reduce((n, p) => n + p.files.length, 0)
  const size = parts.reduce((n, p) => n + p.size, 0)
  const langs = [...new Set(parts.flatMap(p => p.langs))].sort()
  const seasons = parts.filter(p => !p.is_film).map(p => p.season).sort((a, b) => a - b)

  const span = seasons.length > 1
    ? `S${seasons[0]}–S${seasons[seasons.length - 1]}`
    : seasons.length === 1
      ? `Season ${seasons[0]}`
      : 'Film'
  return [
    span,
    `${files} ${files === 1 ? 'file' : 'files'}`,
    langs.map(l => l.toUpperCase()).join(', '),
    fmtSize(size),
  ].filter(Boolean).join(' · ')
}

interface Props {
  /** Open a downloaded title in the watch view, exactly as any other title.
   *  With a file, deep-link to the episode and language that file holds. */
  onOpenTitle: (title: DownloadedTitle, file?: DownloadedFile) => void
  settings: AppSettings
  /** Save a grouping setting — the toolbar owns the same two search offers. */
  onUpdateSettings: (patch: Partial<AppSettings>) => void | Promise<void>
  /** Trimmed down for embedding under another view. */
  compact?: boolean
}

/**
 * What has been downloaded, as a shelf of titles.
 *
 * Grouped and merged exactly like search results: the same TMDB-identity and
 * collapse-seasons settings apply, so a show whose seasons landed in separate
 * folders — or under differently-spelled names — is one card here too, rather
 * than one card per folder.
 *
 * Dressed in TMDB artwork for the same reason: what a download leaves on disk
 * is a sanitised folder name at best, which makes for a poor shelf. Opening a
 * title goes to the ordinary watch view. Deleting lives one level down, in
 * DownloadedFilesModal: a card here can be a whole show.
 */
export default function DownloadedLibrary({
  onOpenTitle, settings, onUpdateSettings, compact,
}: Props) {
  const titles = useDownloadedLibrary()
  const layout = useLibraryLayout().downloaded
  const [sort, setSort] = useState<SortKey>(defaultSortFor('saved'))
  const [managing, setManaging] = useState<string | null>(null)
  const [pickedGenres, setPickedGenres] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [confirming, setConfirming] = useState<{ title: DownloadedTitle; file: DownloadedFile } | null>(null)

  const cards = useMemo(() => titles.map(toCard), [titles])
  // The very same merge search uses, under the very same settings — including
  // folding a show's seasons into one card.
  const [merged, regrouping] = useMergedCards(
    cards,
    settings.tmdb_configured && settings.tmdb_merge,
    undefined,
    settings.collapse_seasons !== false,
  )

  // Back from a merged card to the seasons it stands for. `seasons` holds the
  // folded ones and `alts` other pages of the same season; both are ours.
  const merges: Group[] = useMemo(() => {
    const byKey = new Map(titles.map(t => [t.key, t]))
    return merged.map(card => ({
      key: card.newsid,
      card,
      parts: [card, ...(card.seasons ?? []), ...(card.alts ?? [])]
        .map(c => byKey.get(c.newsid))
        .filter((t): t is DownloadedTitle => t !== undefined)
        .sort((a, b) => a.season - b.season),
    }))
  }, [merged, titles])

  const groups: Group[] = merges

  // Resolved from the title's name, the same way the library tabs do it, so a
  // downloaded title carries the poster, rating and genres the rest of the app
  // shows. Shared cache: titles seen elsewhere cost nothing here.
  const refs: TitleRef[] = groups.map(g => ({
    key: g.key,
    name: g.card.series_name,
    isFilm: g.card.is_film,
  }))
  const metas = useTitlesMeta(refs, settings.tmdb_configured)

  // Genres come from TMDB, so only matched titles have any; the rest are shown
  // as folders below, where a genre would mean nothing anyway.
  const availableGenres = [...new Set(
    groups.flatMap(g => metas.get(g.key)?.genres ?? []),
  )].sort()

  /** Matches the toolbar's filter, by shown name or by any of its filenames. */
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return groups
    return groups.filter(g => {
      // The shown name first, then the files themselves: on a shelf this size
      // you often remember what a file is called, not what TMDB renamed it to.
      const name = (metas.get(g.key)?.title || g.card.series_name).toLowerCase()
      if (name.includes(needle)) return true
      return g.parts.some(p => p.files.some(f => f.path.toLowerCase().includes(needle)))
    })
  }, [groups, metas, query])

  // The split the shelf is built around. A title TMDB answered for has a name,
  // artwork and genres, and belongs on a shelf; one it has never heard of has
  // only a path, and belongs in the folders it actually sits in. Showing both
  // the same way is what made this a wall of near-blank cards.
  const [matched, unmatched] = useMemo(() => {
    const yes: Group[] = []
    const no: Group[] = []
    for (const group of searched) (metas.get(group.key) ? yes : no).push(group)
    return [yes, no]
  }, [searched, metas])

  const unmatchedTitles = useMemo(
    () => unmatched.flatMap(g => g.parts),
    [unmatched],
  )

  const sorted = useMemo(
    () =>
      sortItems(
        matched
          .filter(g => matchesAllGenres(metas.get(g.key)?.genres, pickedGenres))
          .map(g => ({
            g,
            // TMDB's title when it matched: the folder name can be mangled.
            title: metas.get(g.key)?.title || g.card.series_name,
            year: metas.get(g.key)?.year,
            rating: metas.get(g.key)?.rating,
            // "Recently added" is the default here: a file's mtime is when the
            // download landed, and a show is as recent as its newest season.
            addedAt: Math.max(...g.parts.map(p => p.mtime), 0),
          })),
        sort,
      ).map(row => row.g),
    [matched, sort, metas, pickedGenres],
  )

  function toggleGenre(genre: string) {
    setPickedGenres(prev => {
      const next = new Set(prev)
      if (next.has(genre)) next.delete(genre)
      else next.add(genre)
      return next
    })
  }

  async function removeFile(file: DownloadedFile) {
    try {
      await deleteDownloadedFile(file.path)
      await refreshDownloadedLibrary()
    } finally {
      setConfirming(null)
    }
  }

  if (titles.length === 0) {
    return (
      <EmptyState
        title="Nothing downloaded yet"
        message="Episodes you download are kept here, ready to play without the source site."
      />
    )
  }

  const managed = groups.find(g => g.key === managing)

  /**
   * TMDB's artwork, then whatever was recorded at download time, then a frame
   * from the file itself — most of a collection that predates this tool is on
   * no database, and a blank card tells you nothing about what it is.
   */
  const posterFor = (g: Group) => {
    const known = metas.get(g.key)?.poster_url || g.parts.find(p => p.poster_url)?.poster_url
    if (known) return known
    const first = g.parts.find(p => p.files.length)?.files[0]
    return first ? downloadedThumbUrl(first.path) : ''
  }
  const nameFor = (g: Group) => metas.get(g.key)?.title || g.card.series_name

  // Headings only earn their space when both halves are on screen; with just
  // one, they label the obvious.
  const showHeadings = !compact && sorted.length > 0 && unmatchedTitles.length > 0

  /** The matched titles, in whichever card layout is picked. */
  function renderMatched() {
    if (layout === 'grid' && !compact) {
      return (
          <PosterGrid
            items={sorted.map(g => ({
              key: g.key,
              title: nameFor(g),
              subtitle: summarise(g.parts),
              poster_url: posterFor(g),
              rating: metas.get(g.key)?.rating,
              genres: metas.get(g.key)?.genres,
              onClick: () => onOpenTitle(g.parts[0]),
              actions: (
                <button
                  onClick={e => { e.stopPropagation(); setManaging(g.key) }}
                  aria-label={`Manage files for ${nameFor(g)}`}
                  title="Files on disk"
                  className="btn btn-ghost btn-square btn-sm text-base-content/40 hover:text-base-content"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h10" />
                  </svg>
                </button>
              ),
            }))}
          />
      )
    }
    return (
        <div className="flex flex-col gap-2">
          {sorted.map(g => {
            const meta = metas.get(g.key)
            return (
              <DetailRow
                key={g.key}
                poster_url={posterFor(g)}
                title={nameFor(g)}
                meta={summarise(g.parts)}
                submeta={
                  g.parts.length > 1
                    ? `${g.parts.length} seasons downloaded`
                    : undefined
                }
                rating={meta?.rating}
                genres={meta?.genres}
                synopsis={compact ? undefined : meta?.overview}
                onOpen={() => onOpenTitle(g.parts[0])}
                actions={
                  <button onClick={() => setManaging(g.key)} className="btn btn-sm btn-ghost">
                    Files
                  </button>
                }
              />
            )
          })}
        </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {!compact && (
        <div className="flex items-center gap-3 flex-wrap">
          {/* A shelf this size is searched, not scanned. Filters what is already
              loaded, so it costs nothing and answers on every keystroke. */}
          <label className="relative">
            <span className="sr-only">Filter downloaded titles</span>
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Filter…"
              className="input input-sm input-bordered w-40 sm:w-56"
            />
          </label>
          <span className="text-base-content/40 text-sm">
            {query || pickedGenres.size
              ? `${sorted.length} matched of ${groups.length}`
              : `${groups.length} ${groups.length === 1 ? 'title' : 'titles'} on disk`}
            {regrouping && <span className="ml-2 text-base-content/30">regrouping…</span>}
          </span>
          {/* The same offers search makes, on the same settings — grouping is
              one behaviour, so it is controlled the same way wherever it
              applies rather than only where you first meet it. */}
          <div className="ml-auto flex items-center gap-3 flex-wrap justify-end">
            <SortSelect options={SORTS_FOR.saved} value={sort} onChange={setSort} />
            <ToolbarToggle
              label="One card per show"
              title="Fold a show's seasons into a single card, with the seasons listed behind it. Off lists every downloaded season separately."
              checked={settings.collapse_seasons !== false}
              onChange={v => void onUpdateSettings({ collapse_seasons: v })}
            />
            {settings.tmdb_configured && (
              <ToolbarToggle
                label="Group by TMDB match"
                title="Identify a title by its TMDB match rather than its folder name, so seasons stored under differently-spelled names group together."
                checked={settings.tmdb_merge}
                onChange={v => void onUpdateSettings({ tmdb_merge: v })}
                // Regrouping waits on a lookup per title, so it is not instant.
                busy={regrouping}
              />
            )}
            <LayoutToggle
              layout={layout}
              onChange={next => setLibraryLayout('downloaded', next)}
              only={['grid', 'detail', 'folders', 'tree']}
            />
          </div>
        </div>
      )}

      {/* Below the toolbar, above the shelf — as in the library. Only offered
          once TMDB has said what is in there, and never in the tree, which is
          about where files sit rather than what they are. */}
      {!compact && layout !== 'tree' && availableGenres.length > 0 && (
        <div className="flex flex-col gap-1">
          <GenreChips
            available={availableGenres}
            selected={pickedGenres}
            onToggle={toggleGenre}
            onClear={() => setPickedGenres(new Set())}
          />
          {pickedGenres.size > 0 && unmatched.length > 0 && (
            // Said plainly rather than left to be noticed: a genre cannot apply
            // to a title TMDB never answered for, so the folders below stay put.
            <p className="text-xs text-base-content/40">
              A genre only narrows the matched titles — the folders below are
              unaffected.
            </p>
          )}
        </div>
      )}

      {/* Browse and tree both show every folder, matched or not, so each
          replaces the split rather than sitting inside it: the split answers
          "what do I have", these two answer "what is actually on the disk". */}
      {layout === 'folders' && !compact ? (
        <DownloadedBrowser
          titles={titles}
          filter={query}
          onPlay={(title, file) => onOpenTitle(title, file)}
          onDelete={(title, file) => setConfirming({ title, file })}
        />
      ) : layout === 'tree' && !compact ? (
        <DownloadedTree
          titles={titles}
          filter={query}
          onPlay={(title, file) => onOpenTitle(title, file)}
          onDelete={(title, file) => setConfirming({ title, file })}
        />
      ) : sorted.length === 0 && (compact || unmatchedTitles.length === 0) ? (
        <EmptyState
          title="Nothing matches"
          message={
            query
              ? `Nothing downloaded matches “${query}”.`
              : 'No downloaded title carries every genre you picked.'
          }
          action={{
            label: 'Clear filters',
            onClick: () => { setQuery(''); setPickedGenres(new Set()) },
          }}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {sorted.length > 0 && (
            <section className="flex flex-col gap-3">
              {showHeadings && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                  Matched titles
                  <span className="ml-2 font-normal normal-case text-base-content/40">
                    {sorted.length}
                  </span>
                </h3>
              )}
              {renderMatched()}
            </section>
          )}

          {/* Everything TMDB could not name, in the folders it actually sits
              in. Grouping it into cards was the mess: with no artwork and no
              real title, a card says nothing a folder name does not say better. */}
          {!compact && unmatchedTitles.length > 0 && (
            <section className="flex flex-col gap-3">
              {showHeadings && (
                <h3 className="text-xs font-semibold uppercase tracking-wide text-base-content/50">
                  Not on TMDB — by folder
                  <span className="ml-2 font-normal normal-case text-base-content/40">
                    {unmatchedTitles.reduce((n, t) => n + t.files.length, 0)} files
                  </span>
                </h3>
              )}
              <DownloadedBrowser
                titles={unmatchedTitles}
                filter={query}
                onPlay={(title, file) => onOpenTitle(title, file)}
                onDelete={(title, file) => setConfirming({ title, file })}
              />
            </section>
          )}

          {/* On the Downloads page the folders are left out, so say what is
              missing rather than quietly under-reporting the shelf. */}
          {compact && unmatchedTitles.length > 0 && (
            <p className="text-xs text-base-content/40">
              {unmatchedTitles.length} more not matched to TMDB — see Downloaded.
            </p>
          )}
        </div>
      )}

      {/* The tree deletes in place rather than through the files modal, so it
          carries its own confirmation — deleting a file is the one thing here
          that cannot be undone. */}
      {confirming && (
        <ResponsiveModal onClose={() => setConfirming(null)} boxClassName="max-w-md">
          <h3 className="font-semibold text-lg">Delete this file?</h3>
          <p className="text-sm text-base-content/60 mt-2 break-all font-mono">
            {confirming.file.path}
          </p>
          <p className="text-sm text-base-content/60 mt-2">
            {fmtSize(confirming.file.size)} — removed from disk for good.
          </p>
          <div className="modal-action">
            <button onClick={() => setConfirming(null)} className="btn btn-sm">Cancel</button>
            <button
              onClick={() => void removeFile(confirming.file)}
              className="btn btn-sm btn-error"
            >
              Delete
            </button>
          </div>
        </ResponsiveModal>
      )}

      {managed && (
        <DownloadedFilesModal
          name={nameFor(managed)}
          titles={managed.parts}
          onClose={() => setManaging(null)}
          onPlay={(title, file) => {
            setManaging(null)
            // Same destination as the card: the watch view, deep-linked to the
            // episode the file holds.
            onOpenTitle(title, file)
          }}
        />
      )}
    </div>
  )
}

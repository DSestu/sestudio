import { useState } from 'react'
import { addWatcher, updateWatcher, useWatchers, watcherForPage } from '../../watchers'

/**
 * A dashed card under the sources for each language this title has somewhere
 * that no site (nor the disk) has for the episode on screen
 * (docs/SPEC-below-player.md, Missing version): what's missing, where it does
 * exist when known, **Tell me when it lands**, and the way to carry on in the
 * language playing. The button asks the page's watcher to report that language
 * (`title_lang` for a series, `film_available` for a film); a watcher with no
 * language filter already covers every language, so it reads as watching.
 */
export default function MissingVersions({ langs, episode, activeLang, where, watch, onKeep }: {
  langs: string[]
  /** "S1 · E02", or null for a film. */
  episode: string | null
  activeLang: string
  /** Where each language does exist, when known ("In this season: E05–E07"). */
  where: Record<string, string | null>
  /** What a watcher needs; null where none applies (a video). */
  watch: { pageUrl: string; source: string; seriesName: string; posterUrl: string; isFilm: boolean } | null
  /** Carry on in the language playing (the card goes away until the next episode). */
  onKeep: (lang: string) => void
}) {
  const watchers = useWatchers()
  const [busy, setBusy] = useState<string | null>(null)
  if (!langs.length) return null
  const existing = watch ? watcherForPage(watchers, watch.pageUrl) : undefined
  const filter = (existing?.config.langs as string[] | undefined) ?? []
  const covers = (lang: string) => !!existing && (filter.length === 0 || filter.includes(lang))

  async function tellMe(lang: string) {
    if (!watch) return
    setBusy(lang)
    try {
      if (existing) {
        await updateWatcher(existing.id, { config: { ...existing.config, langs: [...filter, lang] } })
      } else {
        await addWatcher({
          kind: watch.isFilm ? 'film_available' : 'title_lang',
          label: watch.seriesName,
          config: {
            page_url: watch.pageUrl,
            source: watch.source,
            langs: [lang],
            series_name: watch.seriesName,
            poster_url: watch.posterUrl,
          },
        })
      }
    } catch {
      // Nothing changed server-side, and the store still shows the real state.
    } finally {
      setBusy(null)
    }
  }

  return (
    <ul className="mt-2.5 flex flex-col gap-2.5">
      {langs.map(lang => {
        const code = lang.toUpperCase()
        return (
          <li key={lang} className="rounded-box border border-dashed border-base-content/25 px-4 py-4 text-center animate-[sheet-fade_250ms_ease-out] motion-reduce:animate-none">
            <p className="font-semibold tracking-tight">No site has {code} for {episode ?? 'this film'}</p>
            {where[lang] && <p className="mt-1 text-sm text-base-content/60">{where[lang]}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
              {watch && (covers(lang) ? (
                <span className="btn btn-sm btn-disabled gap-1.5 !text-base-content/80">
                  <svg className="w-4 h-4 text-success" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  Watching for {code}
                </span>
              ) : (
                <button type="button" disabled={busy !== null} onClick={() => void tellMe(lang)} className="btn btn-sm btn-primary gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                  </svg>
                  Tell me when {code} lands
                </button>
              ))}
              {lang !== activeLang && (
                <button type="button" onClick={() => onKeep(lang)} className="btn btn-sm btn-ghost text-primary">
                  Keep watching in {activeLang.toUpperCase()}
                </button>
              )}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

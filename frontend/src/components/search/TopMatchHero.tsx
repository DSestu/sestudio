import type { ReactNode } from 'react'
import type { SeasonCard, TmdbMeta } from '../../api'
import RatingBadge from '../RatingBadge'
import SaveToggles from '../SaveToggles'
import SourcesBadge from '../SourcesBadge'
import { kindLabel, saveEntry, seasonsLabel } from '../resultMeta'

interface Props {
  card: SeasonCard
  meta: TmdbMeta | null
  /** Let the TMDB poster stand in for the source's own, as the grid does. */
  posters: boolean
  onOpen: (card: SeasonCard) => void
  /** Set when the title is on disk: what is there, and Play picks it up from disk. */
  disk?: { line: string; play: string; onPlay: () => void }
  /** Under the card: the seasons and episodes on disk. */
  children?: ReactNode
}

/** The skeleton the hero slot holds while it waits on votes, at the same
 *  height, so nothing below jumps when the card lands or the slot goes. */
export function TopMatchSkeleton() {
  return (
    <div aria-busy="true" aria-label="Finding the best match" className="h-44 sm:h-56 rounded-box bg-base-200 animate-pulse motion-reduce:animate-none" />
  )
}

/**
 * The search's top match, shown big with Play next to it, over a blurred copy
 * of its own artwork. Only drawn when one result is clearly the one meant.
 */
export default function TopMatchHero({ card, meta, posters, onOpen, disk, children }: Props) {
  const poster = (posters ? meta?.poster_url : '') || card.poster_url
  const backdrop = meta?.backdrop_url || poster
  const year = meta?.year || card.year || 0
  const facts = [kindLabel(card), seasonsLabel(card), year ? String(year) : '', ...(meta?.genres ?? []).slice(0, 2)].filter(Boolean)

  return (
    <section
      aria-label={`Top match: ${card.series_name}`}
      className="relative overflow-hidden rounded-box border border-base-300 bg-base-200 animate-rise motion-reduce:animate-none"
    >
      {backdrop && (
        <img src={backdrop} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-2xl" />
      )}
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-base-100 via-base-100/70 to-base-100/20" />
      <div className="group relative flex gap-4 sm:gap-6 p-4 sm:p-6 cursor-pointer">
        <div aria-hidden="true" className="absolute inset-0 bg-primary/0 transition-colors duration-200 ease-smooth group-hover:bg-primary/6" />
        <button
          type="button"
          onClick={disk ? disk.onPlay : () => onOpen(card)}
          aria-label={`${disk ? disk.play : 'Play'}: ${card.series_name}`}
          className="absolute inset-0 z-0 rounded-box focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary"
        />
        <div className="pointer-events-none relative w-24 sm:w-36 shrink-0 self-start rounded-box overflow-hidden ring-1 ring-base-300 group-hover:ring-primary transition">
          {poster
            ? <img src={poster} alt="" className="w-full aspect-[2/3] object-cover" />
            : <div className="w-full aspect-[2/3] bg-base-300" />}
          <span className="absolute inset-0 flex items-center justify-center bg-base-100/40 opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100 [@media(hover:none)]:bg-transparent transition-opacity">
            <span className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full bg-primary text-primary-content shadow-lg">
              <svg className="w-4 h-4 sm:w-5 sm:h-5 translate-x-px" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </span>
        </div>
        <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-base-content/60">Top match</span>
          <h2 className="text-2xl sm:text-3xl font-bold leading-tight transition-colors group-hover:text-primary">{card.series_name}</h2>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-base-content/70">
            {facts.join(' · ')}
            {meta && <RatingBadge rating={meta.rating} />}
          </div>
          {disk && (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 1.1.9 2 2 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H6a2 2 0 00-2 2z" />
              </svg>
              <span><span className="font-semibold">On disk</span> · {disk.line}</span>
            </p>
          )}
          {meta?.overview && (
            <p className="hidden sm:block max-w-2xl text-sm leading-relaxed text-base-content/70 line-clamp-3">{meta.overview}</p>
          )}
          <div className="pointer-events-auto relative z-10 mt-auto flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={disk ? disk.onPlay : () => onOpen(card)} className="btn btn-primary btn-sm gap-1.5">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
              {disk ? disk.play : 'Play'}
            </button>
            <SaveToggles size="sm" entry={saveEntry(card, poster)} className="rounded-box bg-base-100/60" />
            <SourcesBadge card={card} onOpen={onOpen} />
          </div>
        </div>
      </div>
      {children && <div className="relative px-1 pb-4 sm:px-3 sm:pb-5">{children}</div>}
    </section>
  )
}

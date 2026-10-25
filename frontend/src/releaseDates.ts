// Release-date arithmetic, shared by the filter UI, the browse panel and the
// API layer — which is why it lives outside any component.

/** A release window as ISO `YYYY-MM-DD` bounds. '' on either side means "open",
 *  so `{from:'',to:''}` is "any date". */
export interface DateRange {
  from: string
  to: string
}

export const ANY_DATES: DateRange = { from: '', to: '' }

export function isAnyDates(r: DateRange): boolean {
  return !r.from && !r.to
}

/** The year an ISO bound falls in, 0 when the bound is open. */
export function yearOf(iso: string): number {
  return Number(iso.slice(0, 4)) || 0
}

/** Local date as `YYYY-MM-DD` — not toISOString(), which shifts across UTC. */
function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function todayIso(): string {
  return iso(new Date())
}

export function monthsAgo(months: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - months)
  return iso(d)
}

/** Is this release date still in the future? ISO dates compare as strings.
 *
 *  An empty date is *not* upcoming: TMDB leaves it blank for old titles it
 *  never dated, so treating "undated" as "announced" would file them wrongly. */
export function isUpcoming(releaseDate: string | undefined): boolean {
  return Boolean(releaseDate) && releaseDate! > todayIso()
}

/** "since 2026-07-17", "2020-01-01 – 2024-12-31", "up to 1999-12-31". */
export function rangeLabel(r: DateRange): string {
  if (isAnyDates(r)) return 'any date'
  if (r.from && r.to) return `${r.from} – ${r.to}`
  if (r.from) return `since ${r.from}`
  return `up to ${r.to}`
}

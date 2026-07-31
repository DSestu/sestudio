export type ProviderStatus = 'idle' | 'loading' | 'ok' | 'failed'

// Preferred order, mirroring the backend resolve fallback.
const ORDER = ['uqload', 'vidzy', 'netu']

/** Sort a provider list into preference order (known providers first). */
export function orderProviders(list: string[]): string[] {
  const known = ORDER.filter(p => list.includes(p))
  return [...known, ...list.filter(p => !ORDER.includes(p))]
}

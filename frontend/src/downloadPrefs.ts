/** The shipped ranking, and what "reset" goes back to. Mirrors the backend's
 *  DEFAULT_DOWNLOAD_ORDER: senpai first because it serves its own files, so
 *  there is no third-party host to be down, then the most reliable hosts.
 *  The server sends its own copy as `default_hosts`; this is the fallback for
 *  a client that asked before settings arrived. */
export const DEFAULT_HOST_ORDER = ['senpai', 'premium', 'uqload', 'vidzy', 'netu', 'voe']

/**
 * The host to download an episode from: the viewer's ranking first, then the
 * built-in order, then whatever the site happens to have.
 *
 * Only picks the *first* attempt — the server keeps every other host as
 * fallback (and re-ranks those the same way), so a preference can slow a
 * download down but never lose it.
 */
export function pickHost(
  embedUrls: Record<string, string>,
  preferred: string[] = [],
): { provider: string; embed_url: string } {
  for (const host of [...preferred, ...DEFAULT_HOST_ORDER]) {
    if (embedUrls[host]) return { provider: host, embed_url: embedUrls[host] }
  }
  const [provider = '', embed_url = ''] = Object.entries(embedUrls)[0] ?? []
  return { provider, embed_url }
}

/**
 * Move `value` to the end of a ranking, or drop it when it is already ranked.
 *
 * That is the whole interaction of the ranked chips: clicking an unranked chip
 * appends it (so clicking three in order ranks them 1-2-3), clicking a ranked
 * one takes it back out.
 */
export function toggleRank(order: string[], value: string): string[] {
  return order.includes(value)
    ? order.filter(v => v !== value)
    : [...order, value]
}

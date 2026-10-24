/** What to call a frame rate in a menu: a whole number unless it is not
 *  (23.976 reads as 23.98). */
export function fpsLabel(fps: number): string {
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`
}

/** Outline and glow, in the AI mark's colours, on a picked rate whose AI
 *  frames are on screen; eased in and out as they come and go. */
export const LIVE_GLOW = 'ring-2 ring-fuchsia-500 ring-offset-1 ring-offset-base-100 shadow-[0_0_14px_2px_rgba(219,39,119,0.55)]'
export const GLOW_EASE = 'transition-shadow duration-500'

/** Whether *fps* is drawn by AI from a *source* that has fewer frames. */
export function isDrawn(fps: number, source: number): boolean {
  return source > 0 && fps > source + 0.5
}

/** *url* — one of the server's quality ladders — at *fps*, 0 for the source's own. */
export function withFps(url: string, fps: number): string {
  const [path, query = ''] = url.split('?')
  const params = new URLSearchParams(query)
  params.delete('fps')
  if (fps) params.set('fps', String(fps))
  return `${path}?${params}`
}

/** The server's re-encoded playlist a source plays from, if it does: only those
 *  can be sent at another frame rate. */
export function ladderUrlOf(source: { kind: string; proxy_url: string } | null | undefined): string | null {
  return source?.kind === 'hls' && /\/api\/(downloaded|stream)\/hls\?/.test(source.proxy_url)
    ? source.proxy_url
    : null
}

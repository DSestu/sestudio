// Google Cast (Chromecast) Web Sender integration.
//
// The Cast framework only initialises in a *secure context* (HTTPS, or
// localhost) — over http://<lan-ip> it silently reports unavailable. When it
// works, the Chromecast fetches the media URL itself, so we hand it an absolute
// URL; Chromecast plays HLS natively (unlike most DLNA TVs).

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Cast SDK is untyped
type Cast = any

const CAST_SDK = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

let castReady: Promise<boolean> | null = null

/** Load and initialise the Cast SDK once. Resolves false if unavailable. */
export function loadCast(): Promise<boolean> {
  if (castReady) return castReady
  castReady = new Promise<boolean>(resolve => {
    if (!window.isSecureContext) return resolve(false)
    const w = window as Cast
    w.__onGCastApiAvailable = (available: boolean) => {
      if (!available) return resolve(false)
      w.cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
      })
      resolve(true)
    }
    const s = document.createElement('script')
    s.src = CAST_SDK
    s.onerror = () => resolve(false)
    document.head.appendChild(s)
  })
  return castReady
}

/** Open the Chromecast device picker and load the media onto the chosen device. */
export async function castToChromecast(url: string, contentType: string, title: string): Promise<void> {
  const ok = await loadCast()
  if (!ok) throw new Error('Chromecast is only available over HTTPS')
  const w = window as Cast
  const context = w.cast.framework.CastContext.getInstance()
  await context.requestSession()
  const session = context.getCurrentSession()
  if (!session) throw new Error('No Chromecast session')
  const mediaInfo = new w.chrome.cast.media.MediaInfo(url, contentType)
  mediaInfo.metadata = new w.chrome.cast.media.GenericMediaMetadata()
  mediaInfo.metadata.title = title
  await session.loadMedia(new w.chrome.cast.media.LoadRequest(mediaInfo))
}

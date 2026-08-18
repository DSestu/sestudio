import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { DownloadJob, DownloadedFile, DownloadedTitle, SeasonCard, WatcherEvent } from './api'
import { DOWNLOADED_SOURCE, downloadedPageUrl } from './api'
import { loadCast } from './cast'
import { refreshDlna } from './dlnaControl'
import AppShell from './components/AppShell'
import NowCastingBar from './components/cast/NowCastingBar'
import MiniPlayer from './components/watch/MiniPlayer'
import DownloadedLibrary from './components/downloaded/DownloadedLibrary'
import { hydrateLibrary } from './hydrateLibrary'
import { DocumentPiPPortal } from './documentPiP'
import { usePiPWindow } from './pipSession'
import { createPortalNode } from './portalNode'
import { useRoute, type Navigate } from './nav'
import { clearPullback, usePullback } from './pullback'
import { useDownloadJobs } from './useDownloadJobs'
import { useSettings } from './useSettings'
import { refreshNotifications, useUnreadCount, watchParamsForEvent } from './notifications'
import DownloadsView from './views/DownloadsView'
import HomeView from './views/HomeView'
import LibraryView from './views/LibraryView'
import NotificationsView from './views/NotificationsView'
import PersonView from './views/PersonView'
import SearchView from './views/SearchView'
import SettingsView from './views/SettingsView'
import WatchView from './views/WatchView'

type WatchFields = Record<string, string | number | undefined>

/** Field-by-field equality for the open-watch record. */
function sameWatch(a: WatchFields | null, b: WatchFields): boolean {
  if (!a) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

export default function App() {
  const [route, rawNavigate] = useRoute()
  const [settings, updateSettings] = useSettings()

  const [downloadTick, setDownloadTick] = useState(0)
  const [skippedJobs, setSkippedJobs] = useState<DownloadJob[]>([])

  // The watch view stays mounted while a title is open so its player keeps
  // playing when you browse away (mini-player, #20). The shared node hosts the
  // relocatable <video>.
  //
  // Two titles can be open at once: `browseWatch` is the one the watch route
  // shows, `playingWatch` the one that owns the player. They are the same title
  // unless "play on open" is off, in which case opening a title only browses it
  // and whatever was playing keeps playing until you press play.
  type WatchRecord = Record<string, string | number | undefined>
  const [browseWatch, setBrowseWatch] = useState<WatchRecord | null>(null)
  const [playingWatch, setPlayingWatch] = useState<WatchRecord | null>(null)
  const [playerNode] = useState(createPortalNode)
  // While a PiP window holds the player, no in-page mount point may claim it.
  const pipWindow = usePiPWindow()

  // Morph the player between the pane and the mini-player when navigating across
  // the watch boundary (#20). Falls back to an instant switch where View
  // Transitions aren't supported or the user prefers reduced motion.
  const navigate = useCallback<Navigate>((view, params) => {
    const crosses = (route.view === 'watch') !== (view === 'watch')
    const startVT = (document as Document & {
      startViewTransition?: (cb: () => void) => unknown
    }).startViewTransition
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (crosses && playingWatch && startVT && !reduce) {
      startVT.call(document, () => flushSync(() => rawNavigate(view, params)))
    } else {
      rawNavigate(view, params)
    }
  }, [route.view, playingWatch, rawNavigate])

  const downloads = useDownloadJobs(downloadTick, () => setSkippedJobs([]))
  const pullback = usePullback()
  // Subscribed here rather than only in the view, so the nav badge is live on
  // every screen — the whole point of a watcher is hearing about it unprompted.
  const unread = useUnreadCount()

  // On load: init the Cast SDK (rejoins an existing Chromecast session) and
  // check for an active DLNA session, so both control bars reappear after reload.
  useEffect(() => { loadCast(); refreshDlna(); void hydrateLibrary(); void refreshNotifications() }, [])

  // Cross-device freshness: re-pull the library when the tab regains focus, so
  // a change made on another device shows up here (#24). Watchers fire on the
  // server's own schedule with nothing pushing the result, so the timeline wants
  // the same treatment.
  useEffect(() => {
    const onFocus = () => { void hydrateLibrary(); void refreshNotifications() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Track the open watch title so the view (and its player) survives navigating
  // away (mini-player, #20). Derived during render — set only when the watch
  // URL actually changes, so it doesn't loop or remount unnecessarily.
  if (route.view === 'watch') {
    const u = route.params.get('u') ?? ''
    const opened: WatchRecord = {
      u,
      t: route.params.get('t') ?? '',
      p: route.params.get('p') ?? '',
      lang: route.params.get('lang') || settings.lang,
      ep: route.params.has('ep') ? Number(route.params.get('ep')) : undefined,
      alt: route.params.get('alt') ?? undefined,
      src: route.params.get('src') ?? undefined,
      altsrc: route.params.get('altsrc') ?? undefined,
    }
    // Every field, not just the URL. Switching source by clicking a language
    // badge can land on the same page_url with a different lang, and comparing
    // `u` alone dropped that navigation entirely — the hash changed and the
    // view did not. Comparing the whole record is also what stops this from
    // looping, since it only sets state when something actually differs.
    if (u && !sameWatch(browseWatch, opened)) {
      setBrowseWatch(opened)
      // Play on open, but never over something: whatever is already playing
      // keeps the player until it is closed, and this title is only browsed.
      // Off, nothing is ever claimed automatically.
      if (settings.autoplay_on_open !== false && !playingWatch) setPlayingWatch(opened)
    }
  }

  // Both records point at the same title unless a second one is being browsed.
  const browsingPlaying = !!playingWatch && !!browseWatch && playingWatch.u === browseWatch.u
  // One keyed list, so promoting the browsed title to the playing one reuses
  // its mounted view (and its selected episode) instead of remounting it.
  const watchViews: { rec: WatchRecord; owner: boolean; visible: boolean }[] = [
    ...(playingWatch
      ? [{ rec: playingWatch, owner: true, visible: route.view === 'watch' && browsingPlaying }]
      : []),
    ...(browseWatch && !browsingPlaying
      ? [{ rec: browseWatch, owner: false, visible: route.view === 'watch' }]
      : []),
  ]

  /** Open a title in the watch view. Identity travels in the URL so the route
   *  is self-contained (SeasonDetail carries no series name or poster). */
  function openTitle(card: SeasonCard, episode: number, lang: string) {
    // `alt` and `altsrc` are paired positionally, so both come from `alts`.
    const alts = card.alts?.length ? card.alts : undefined
    navigate('watch', {
      u: card.page_url,
      t: card.series_name,
      p: card.poster_url,
      lang,
      ep: episode || undefined,
      src: card.source,
      alt: alts ? alts.map(a => a.page_url).join('|') : undefined,
      altsrc: alts ? alts.map(a => a.source ?? 'fstream').join('|') : undefined,
    })
  }

  // TV → browser pull-back: land in the watch view on the same episode, which
  // resumes from the position the cast controller saved.
  useEffect(() => {
    if (!pullback) return
    const ep = pullback.episodes[pullback.index]
    clearPullback()
    if (!ep) return
    navigate('watch', {
      u: ep.page_url, t: ep.series_name, p: ep.poster_url, lang: ep.lang, ep: ep.number,
      src: ep.source,
    })
    // navigate is stable enough for this one-shot handoff; re-running on every
    // render would fight the user's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullback])

  /** Open the title a watcher event points at, at that episode and language.
   *  Shared by the Activity feed and Home's peek. */
  function openEvent(event: WatcherEvent) {
    navigate('watch', watchParamsForEvent(event, settings.lang))
  }

  /** Run a source search for a title (browse rows, discover, similar titles).
   *  The query travels in the URL, so back returns to where it was clicked.
   *
   *  A known release year travels with it as a release window, so searching
   *  for a remake doesn't surface the original under the same name. The window
   *  is a year either side: sources date a listing by its local release, which
   *  routinely lands a year off, while a remake is decades away. It shows in
   *  the search view's filter row and can be cleared there. */
  function searchFor(term: string, year?: number) {
    navigate('search', {
      q: term,
      ...(year ? { from: `${year - 1}-01-01`, to: `${year + 1}-12-31` } : {}),
    })
  }

  /** Open a downloaded title on its own page, so the full episode list and the
   *  language switcher come with it; the local copy is preferred there. */
  function openDownloadedTitle(title: DownloadedTitle, file?: DownloadedFile) {
    // A title downloaded before its page was recorded has no site page to go
    // back to, so it opens on a stand-in URL the season is built from the files
    // for. Either way this is the ordinary watch route: same episode list, same
    // player, and the copy on disk is what gets played.
    const remote = Boolean(title.page_url)
    navigate('watch', {
      u: remote ? title.page_url : downloadedPageUrl(title.series, title.season),
      t: title.series,
      p: title.poster_url,
      lang: file?.lang || title.langs[0] || settings.lang,
      ep: file?.number || undefined,
      src: remote ? title.source || undefined : DOWNLOADED_SOURCE,
    })
  }

  // Built once and handed to each surface that shows it: its own view, a
  // Library tab, and a section under the download queue.
  const downloadedLibrary = (
    <DownloadedLibrary
      onOpenTitle={openDownloadedTitle}
      settings={settings}
      onUpdateSettings={updateSettings}
    />
  )

  const allJobs = [
    ...downloads.jobs,
    ...skippedJobs.filter(s => !downloads.jobs.some(j => j.episode_name === s.episode_name)),
  ]

  return (
    <>
      <AppShell
        view={route.view}
        onNavigate={navigate}
        downloadBadge={downloads.activeCount}
        unreadBadge={unread}
        onOpenSettings={() => navigate('settings')}
      >
        {route.view === 'home' && (
          <HomeView
            settings={settings}
            onOpen={openTitle}
            onNavigate={navigate}
            onSearchTerm={searchFor}
            onDiscoverGenre={id => navigate('search', { g: id })}
            onOpenEvent={openEvent}
          />
        )}
        {route.view === 'search' && (
          <SearchView
            // Remount when the query in the URL changes (navigation, back),
            // so the view re-seeds itself from the URL. Typing only rewrites
            // the current entry and never remounts.
            key={route.params.get('q') ?? ''}
            settings={settings}
            params={route.params}
            onOpenDetail={card => openTitle(card, 0, settings.lang)}
            onUpdateSettings={updateSettings}
            onSearchTerm={searchFor}
            onOpenPerson={id => navigate('person', { id })}
            onOpenDownloaded={openDownloadedTitle}
            onJobsCreated={() => setDownloadTick(t => t + 1)}
            onSkipped={jobs => setSkippedJobs(prev => [...prev, ...jobs])}
          />
        )}
        {route.view === 'person' && (
          <PersonView
            key={route.params.get('id') ?? ''}
            personId={Number(route.params.get('id'))}
            navigate={navigate}
          />
        )}
        {route.view === 'library' && (
          <LibraryView
            settings={settings}
            onOpen={openTitle}
            onNavigate={navigate}
            downloadedLibrary={downloadedLibrary}
          />
        )}
        {route.view === 'downloaded' && downloadedLibrary}
        {route.view === 'notifications' && (
          <NotificationsView
            tmdbConfigured={settings.tmdb_configured}
            onOpen={openEvent}
            navigate={navigate}
          />
        )}
        {route.view === 'settings' && (
          <SettingsView settings={settings} onUpdate={updateSettings} />
        )}
        {route.view === 'downloads' && (
          <DownloadsView
            jobs={allJobs}
            onCancel={downloads.cancel}
            onClearHistory={downloads.clear}
            onNavigate={navigate}
            downloadedLibrary={
              <DownloadedLibrary
                onOpenTitle={openDownloadedTitle}
                settings={settings}
                onUpdateSettings={updateSettings}
                compact
              />
            }
          />
        )}
        {/* Kept mounted (hidden off-route) so playback continues in the
            mini-player; remounts only when a different title is opened. */}
        {watchViews.map(({ rec, owner, visible }) => (
          <div key={String(rec.u)} hidden={!visible}>
            <WatchView
              pageUrl={String(rec.u ?? '')}
              source={rec.src ? String(rec.src) : undefined}
              altPageUrls={String(rec.alt ?? '').split('|').filter(Boolean)}
              altSources={String(rec.altsrc ?? '').split('|').filter(Boolean)}
              seriesName={String(rec.t ?? '')}
              posterUrl={String(rec.p ?? '')}
              lang={String(rec.lang || settings.lang)}
              episode={rec.ep !== undefined ? Number(rec.ep) : undefined}
              visible={visible}
              playerNode={owner ? playerNode : null}
              onRequestPlayback={ep => setPlayingWatch(ep === undefined ? rec : { ...rec, ep })}
              settings={settings}
              onUpdateSettings={updateSettings}
              navigate={navigate}
              onJobsCreated={() => setDownloadTick(t => t + 1)}
            />
          </div>
        ))}
      </AppShell>

      {/* One persistent Now-Casting surface, on every view. Renders nothing
          unless a cast (Chromecast or DLNA) is active. */}
      <NowCastingBar navigate={navigate} />

      {/* Minimised browser player — shown whenever the playing title is not the
          one on screen, which includes browsing a *different* title in the
          watch view ("play on open" off). */}
      {playingWatch && !pipWindow && !(route.view === 'watch' && browsingPlaying) && (
        <MiniPlayer
          node={playerNode}
          onOpen={() => navigate('watch', playingWatch)}
          onClose={() => setPlayingWatch(null)}
        />
      )}

      {/* Holds the player node while a Document PiP window is open. Every other
          mount point releases it above, since only one may hold the node. */}
      <DocumentPiPPortal node={playerNode} />
    </>
  )
}

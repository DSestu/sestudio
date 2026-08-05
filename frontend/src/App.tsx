import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import type { DownloadJob, SeasonCard } from './api'
import { loadCast } from './cast'
import { refreshDlna } from './dlnaControl'
import AppShell from './components/AppShell'
import NowCastingBar from './components/cast/NowCastingBar'
import MiniPlayer from './components/watch/MiniPlayer'
import { hydrateLibrary } from './hydrateLibrary'
import { createPortalNode } from './portalNode'
import { useRoute, type Navigate } from './nav'
import { clearPullback, usePullback } from './pullback'
import { useDownloadJobs } from './useDownloadJobs'
import { useSettings } from './useSettings'
import DownloadsView from './views/DownloadsView'
import HomeView from './views/HomeView'
import LibraryView from './views/LibraryView'
import PersonView from './views/PersonView'
import SearchView from './views/SearchView'
import SettingsView from './views/SettingsView'
import WatchView from './views/WatchView'

export default function App() {
  const [route, rawNavigate] = useRoute()
  const [settings, updateSettings] = useSettings()

  const [downloadTick, setDownloadTick] = useState(0)
  const [skippedJobs, setSkippedJobs] = useState<DownloadJob[]>([])

  // The watch view stays mounted while a title is open so its player keeps
  // playing when you browse away (mini-player, #20). `activeWatch` is the open
  // title; the shared node hosts the relocatable <video>.
  const [activeWatch, setActiveWatch] = useState<Record<string, string | number | undefined> | null>(null)
  const [playerNode] = useState(createPortalNode)

  // Morph the player between the pane and the mini-player when navigating across
  // the watch boundary (#20). Falls back to an instant switch where View
  // Transitions aren't supported or the user prefers reduced motion.
  const navigate = useCallback<Navigate>((view, params) => {
    const crosses = (route.view === 'watch') !== (view === 'watch')
    const startVT = (document as Document & {
      startViewTransition?: (cb: () => void) => unknown
    }).startViewTransition
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (crosses && activeWatch && startVT && !reduce) {
      startVT.call(document, () => flushSync(() => rawNavigate(view, params)))
    } else {
      rawNavigate(view, params)
    }
  }, [route.view, activeWatch, rawNavigate])

  const downloads = useDownloadJobs(downloadTick, () => setSkippedJobs([]))
  const pullback = usePullback()

  // On load: init the Cast SDK (rejoins an existing Chromecast session) and
  // check for an active DLNA session, so both control bars reappear after reload.
  useEffect(() => { loadCast(); refreshDlna(); void hydrateLibrary() }, [])

  // Cross-device freshness: re-pull the library when the tab regains focus, so
  // a change made on another device shows up here (#24).
  useEffect(() => {
    const onFocus = () => { void hydrateLibrary() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  // Track the open watch title so the view (and its player) survives navigating
  // away (mini-player, #20). Derived during render — set only when the watch
  // URL actually changes, so it doesn't loop or remount unnecessarily.
  if (route.view === 'watch') {
    const u = route.params.get('u') ?? ''
    if (u && activeWatch?.u !== u) {
      setActiveWatch({
        u,
        t: route.params.get('t') ?? '',
        p: route.params.get('p') ?? '',
        lang: route.params.get('lang') || settings.lang,
        ep: route.params.has('ep') ? Number(route.params.get('ep')) : undefined,
      })
    }
  }

  /** Open a title in the watch view. Identity travels in the URL so the route
   *  is self-contained (SeasonDetail carries no series name or poster). */
  function openTitle(card: SeasonCard, episode: number, lang: string) {
    navigate('watch', {
      u: card.page_url,
      t: card.series_name,
      p: card.poster_url,
      lang,
      ep: episode || undefined,
      alt: card.alt_page_urls?.length ? card.alt_page_urls.join('|') : undefined,
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
    })
    // navigate is stable enough for this one-shot handoff; re-running on every
    // render would fight the user's own navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pullback])

  /** Run a source search for a title (browse rows, discover, similar titles).
   *  The query travels in the URL, so back returns to where it was clicked. */
  function searchFor(term: string) {
    navigate('search', { q: term })
  }

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
        onOpenSettings={() => navigate('settings')}
      >
        {route.view === 'home' && (
          <HomeView
            settings={settings}
            onOpen={openTitle}
            onNavigate={navigate}
            onSearchTerm={searchFor}
            onDiscoverGenre={id => navigate('search', { g: id })}
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
          <LibraryView settings={settings} onOpen={openTitle} onNavigate={navigate} />
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
          />
        )}
        {/* Kept mounted (hidden off-route) so playback continues in the
            mini-player; remounts only when a different title is opened. */}
        {activeWatch && (
          <div hidden={route.view !== 'watch'}>
            <WatchView
              key={String(activeWatch.u)}
              pageUrl={String(activeWatch.u ?? '')}
              altPageUrls={String(activeWatch.alt ?? '').split('|').filter(Boolean)}
              seriesName={String(activeWatch.t ?? '')}
              posterUrl={String(activeWatch.p ?? '')}
              lang={String(activeWatch.lang || settings.lang)}
              episode={activeWatch.ep !== undefined ? Number(activeWatch.ep) : undefined}
              visible={route.view === 'watch'}
              playerNode={playerNode}
              settings={settings}
              navigate={navigate}
              onJobsCreated={() => setDownloadTick(t => t + 1)}
            />
          </div>
        )}
      </AppShell>

      {/* One persistent Now-Casting surface, on every view. Renders nothing
          unless a cast (Chromecast or DLNA) is active. */}
      <NowCastingBar navigate={navigate} />

      {/* Minimised browser player — shown only when a title is open and we're
          off the watch view. */}
      {activeWatch && route.view !== 'watch' && (
        <MiniPlayer
          node={playerNode}
          onOpen={() => navigate('watch', activeWatch)}
          onClose={() => setActiveWatch(null)}
        />
      )}
    </>
  )
}

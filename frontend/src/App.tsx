import { useEffect, useState } from 'react'
import type { DownloadJob, SeasonCard } from './api'
import { loadCast } from './cast'
import { refreshDlna } from './dlnaControl'
import AppShell from './components/AppShell'
import CastControls from './components/CastControls'
import DlnaControls from './components/DlnaControls'
import SettingsPanel from './components/SettingsPanel'
import { useRoute } from './nav'
import { clearPullback, usePullback } from './pullback'
import { useDownloadJobs } from './useDownloadJobs'
import { useSettings } from './useSettings'
import DownloadsView from './views/DownloadsView'
import HomeView from './views/HomeView'
import LibraryView from './views/LibraryView'
import SearchView from './views/SearchView'
import WatchView from './views/WatchView'

export default function App() {
  const [route, navigate] = useRoute()
  const [settings, updateSettings] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Set when a browse-row card is clicked, to drive the search box.
  const [searchTerm, setSearchTerm] = useState<string | null>(null)
  const [downloadTick, setDownloadTick] = useState(0)
  const [skippedJobs, setSkippedJobs] = useState<DownloadJob[]>([])

  const downloads = useDownloadJobs(downloadTick, () => setSkippedJobs([]))
  const pullback = usePullback()

  // On load: init the Cast SDK (rejoins an existing Chromecast session) and
  // check for an active DLNA session, so both control bars reappear after reload.
  useEffect(() => { loadCast(); refreshDlna() }, [])

  /** Open a title in the watch view. Identity travels in the URL so the route
   *  is self-contained (SeasonDetail carries no series name or poster). */
  function openTitle(card: SeasonCard, episode: number, lang: string) {
    navigate('watch', {
      u: card.page_url,
      t: card.series_name,
      p: card.poster_url,
      lang,
      ep: episode || undefined,
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

  function searchFor(term: string) {
    setSearchTerm(term)
    navigate('search')
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
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {route.view === 'home' && (
          <HomeView
            settings={settings}
            onOpen={openTitle}
            onNavigate={navigate}
            onSearchTerm={searchFor}
          />
        )}
        {route.view === 'search' && (
          <SearchView
            settings={settings}
            term={searchTerm}
            onOpenDetail={card => openTitle(card, 0, settings.lang)}
            onJobsCreated={() => setDownloadTick(t => t + 1)}
            onSkipped={jobs => setSkippedJobs(prev => [...prev, ...jobs])}
          />
        )}
        {route.view === 'library' && (
          <LibraryView settings={settings} onOpen={openTitle} onNavigate={navigate} />
        )}
        {route.view === 'downloads' && (
          <DownloadsView
            jobs={allJobs}
            onCancel={downloads.cancel}
            onClearHistory={downloads.clear}
            onNavigate={navigate}
          />
        )}
        {route.view === 'watch' && (
          <WatchView
            key={route.params.get('u') ?? ''}
            pageUrl={route.params.get('u') ?? ''}
            seriesName={route.params.get('t') ?? ''}
            posterUrl={route.params.get('p') ?? ''}
            lang={route.params.get('lang') || settings.lang}
            episode={route.params.has('ep') ? Number(route.params.get('ep')) : undefined}
            settings={settings}
            navigate={navigate}
            onJobsCreated={() => setDownloadTick(t => t + 1)}
          />
        )}
      </AppShell>

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          onUpdate={updateSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Floating controllers for a session started elsewhere — the watch view
          shows its own inline transport, so these hide while it's open. */}
      {route.view !== 'watch' && (
        <>
          <CastControls />
          <DlnaControls />
        </>
      )}
    </>
  )
}

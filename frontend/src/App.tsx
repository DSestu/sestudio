import { useEffect, useState } from 'react'
import type { DownloadJob, SeasonCard } from './api'
import { loadCast } from './cast'
import { refreshDlna } from './dlnaControl'
import AppShell from './components/AppShell'
import CastControls from './components/CastControls'
import DlnaControls from './components/DlnaControls'
import PlayerModal from './components/PlayerModal'
import SeasonTree from './components/SeasonTree'
import SettingsPanel from './components/SettingsPanel'
import { useView } from './nav'
import { clearPullback, usePullback } from './pullback'
import { useDownloadJobs } from './useDownloadJobs'
import { useSettings } from './useSettings'
import DownloadsView from './views/DownloadsView'
import HomeView from './views/HomeView'
import LibraryView from './views/LibraryView'
import SearchView from './views/SearchView'

export default function App() {
  const [view, navigate] = useView()
  const [settings, updateSettings] = useSettings()
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Title detail modal, plus the library deep-link that opens it on a given
  // episode / language rather than the defaults.
  const [selected, setSelected] = useState<SeasonCard | null>(null)
  const [autoPlayEpisode, setAutoPlayEpisode] = useState<number | undefined>(undefined)
  const [openLang, setOpenLang] = useState<string | null>(null)

  // Set when a browse-row card is clicked, to drive the search box.
  const [searchTerm, setSearchTerm] = useState<string | null>(null)
  const [downloadTick, setDownloadTick] = useState(0)
  const [skippedJobs, setSkippedJobs] = useState<DownloadJob[]>([])

  const downloads = useDownloadJobs(downloadTick, () => setSkippedJobs([]))
  const pullback = usePullback()

  // On load: init the Cast SDK (rejoins an existing Chromecast session) and
  // check for an active DLNA session, so both control bars reappear after reload.
  useEffect(() => { loadCast(); refreshDlna() }, [])

  function openTitle(card: SeasonCard, episode: number, lang: string) {
    setOpenLang(lang)
    setAutoPlayEpisode(episode)
    setSelected(card)
  }

  function closeDetail() {
    setSelected(null)
    setAutoPlayEpisode(undefined)
    setOpenLang(null)
  }

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
        view={view}
        onNavigate={navigate}
        downloadBadge={downloads.activeCount}
        onOpenSettings={() => setSettingsOpen(true)}
      >
        {view === 'home' && (
          <HomeView
            settings={settings}
            onOpen={openTitle}
            onNavigate={navigate}
            onSearchTerm={searchFor}
          />
        )}
        {view === 'search' && (
          <SearchView
            settings={settings}
            term={searchTerm}
            onOpenDetail={setSelected}
            onJobsCreated={() => setDownloadTick(t => t + 1)}
            onSkipped={jobs => setSkippedJobs(prev => [...prev, ...jobs])}
          />
        )}
        {view === 'library' && (
          <LibraryView settings={settings} onOpen={openTitle} onNavigate={navigate} />
        )}
        {view === 'downloads' && (
          <DownloadsView
            jobs={allJobs}
            onCancel={downloads.cancel}
            onClearHistory={downloads.clear}
            onNavigate={navigate}
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

      {selected && (
        <SeasonTree
          card={selected}
          lang={openLang ?? settings.lang}
          outputRoot={settings.output_root}
          downloadDestination={settings.download_destination}
          enrich={settings.tmdb_configured}
          onClose={closeDetail}
          onJobsCreated={() => setDownloadTick(t => t + 1)}
          autoPlayEpisode={autoPlayEpisode}
        />
      )}

      <CastControls />
      <DlnaControls />

      {/* TV → browser pull-back: play here, resuming from the saved position */}
      {pullback && (
        <PlayerModal
          episodes={pullback.episodes}
          startIndex={pullback.index}
          onClose={clearPullback}
        />
      )}
    </>
  )
}

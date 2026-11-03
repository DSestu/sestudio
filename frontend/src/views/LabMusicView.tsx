import LookPanel from '../components/music/background/LookPanel'
import PageHeader from '../components/PageHeader'

export default function LabMusicView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Music lab" />
      <p className="text-sm text-muted-foreground">The music player is built here behind the lab flag. The Look button (or T) tunes the spectral background and the timeline.</p>
      <LookPanel />
    </div>
  )
}

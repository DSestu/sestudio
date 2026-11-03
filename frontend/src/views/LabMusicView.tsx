import PageHeader from '../components/PageHeader'

export default function LabMusicView() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Music lab" />
      <p className="text-sm text-muted-foreground">The music player is built here behind the lab flag.</p>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useFlows } from '../../../musicFlows'
import type { MusicTrack } from '../../../musicLibrary'
import { usePlaylists } from '../../../musicPlaylists'
import { hitPayload, sourceLabel, useMusicSearch, type OnlineHit } from '../../../musicSearch'
import { addTracksToSet } from './setQueue'
import { dragProps } from '../edit/focus'
import { trackOfHit } from '../edit/onlineAnalysis'
import { fmtTime } from '../format'
import { playPayload } from '../player'
import { Lit, Row, TrackRow, type TreeHandlers } from './ExplorerTree'
import { DIMS, type Preset } from './grouping'
import { Ic } from './icons'
import type { Query } from './searchWords'

// The explorer while the search box has words (SPEC-music-library §2.2 Search mode): flat,
// Online first (per source, 5 then "N more"), then In your library (artists, albums, tracks
// with the words lit, 6 then "N more"), then the lists and flows that match.

const ONLINE_SOURCES = ['ytmusic', 'youtube', 'soundcloud'] as const
const ONLINE_SHOWN = 5
const TRACKS_SHOWN = 6
const GROUPS_SHOWN = 4
/** Online search waits for typing to pause this long. */
const ONLINE_DELAY = 550

export default function ExplorerSearch({ query, matched, h, onOpenAs, onList, onFlow }: {
  query: Query
  /** The library tracks that answer the query. */
  matched: MusicTrack[]
  h: TreeHandlers
  /** Open an artist or an album found here on the tape. */
  onOpenAs: (preset: Preset, key: string) => void
  onList: (id: string) => void
  onFlow: (id: string) => void
}) {
  const names = query.terms.join(' ')
  const online = useMusicSearch(names, 'all', ONLINE_DELAY)
  const [more, setMore] = useState<ReadonlySet<string>>(new Set())
  const grow = (k: string) => setMore(s => new Set(s).add(k))
  const hit = (s: string) => query.terms.every(w => s.toLowerCase().includes(w))
  const artists = useMemo(() => {
    const n = new Map<string, number>()
    for (const t of matched) if (hit(t.artist)) n.set(t.artist, (n.get(t.artist) ?? 0) + 1)
    return query.terms.length ? [...n].sort((a, b) => b[1] - a[1]).slice(0, GROUPS_SHOWN) : []
  }, [matched, query]) // eslint-disable-line react-hooks/exhaustive-deps -- `hit` reads `query`
  const albums = useMemo(() => {
    const n = new Map<string, { name: string; artist: string; count: number }>()
    for (const t of matched) {
      const name = DIMS.album.of(t, h.facts)
      if (!hit(name)) continue
      const a = n.get(name) ?? { name, artist: t.artist, count: 0 }
      a.count++
      n.set(name, a)
    }
    return query.terms.length ? [...n.values()].sort((a, b) => b.count - a.count).slice(0, GROUPS_SHOWN) : []
  }, [matched, query, h.facts]) // eslint-disable-line react-hooks/exhaustive-deps -- `hit` reads `query`
  const lists = usePlaylists().filter(n => n.kind !== 'folder' && query.terms.length && hit(n.name))
  const flows = useFlows().flows.filter(f => query.terms.length && hit(f.name))
  const hits = useMemo(() => {
    const seen = new Set<string>()
    return (online?.res.online ?? []).filter(x => !seen.has(x.track_id) && seen.add(x.track_id))
  }, [online])
  const errors = Object.entries(online?.res.errors ?? {}).filter(([k]) => k !== 'library')
  const shownTracks = more.has('lib') ? matched : matched.slice(0, TRACKS_SHOWN)
  return (
    <div className="flex flex-col gap-1">
      {names && (
        <Group title="Online" hint={!online ? 'searching…' : undefined}>
          {ONLINE_SOURCES.map(s => {
            const mine = hits.filter(x => x.source === s)
            const pending = !online || online.pending.includes(s)
            const shown = more.has(s) ? mine : mine.slice(0, ONLINE_SHOWN)
            return (
              <div key={s}>
                <Row depth={0} icon={<Ic name="search" size={13} />} label={sourceLabel(s)} count={pending ? <span className="loading loading-spinner loading-xs" /> : mine.length} dim={!pending && !mine.length} />
                {shown.map(x => <OnlineRow key={x.track_id} hit={x} />)}
                {mine.length > shown.length && <Row depth={1} icon={null} label={`${mine.length - shown.length} more on ${sourceLabel(s)}`} onClick={() => grow(s)} dim />}
              </div>
            )
          })}
          {errors.length > 0 && <p className="px-2 py-1 text-[11px] text-error/80">{errors.map(([k, v]) => `${sourceLabel(k)}: ${v}`).join(' · ')}</p>}
        </Group>
      )}
      <Group title="In your library" hint={`${matched.length} tracks`}>
        {artists.map(([name, n]) => (
          <Row key={`ar:${name}`} depth={0} icon={<Ic name="user" size={14} />} label={<><Lit text={name} terms={query.terms} /><i className="ml-1.5 text-[11px] not-italic text-base-content/45">artist</i></>} count={n} onClick={() => onOpenAs('artist', name)} />
        ))}
        {albums.map(a => (
          <Row key={`al:${a.name}`} depth={0} icon={<Ic name="album" size={14} />} label={<><Lit text={a.name} terms={query.terms} /><i className="ml-1.5 text-[11px] not-italic text-base-content/45">album · {a.artist}</i></>} count={a.count} onClick={() => onOpenAs('album', a.name)} />
        ))}
        {shownTracks.map(t => <TrackRow key={t.id} t={t} depth={0} list={matched} h={h} terms={query.terms} sub={t.album || t.albumName} />)}
        {matched.length > shownTracks.length && <Row depth={0} icon={null} label={`${matched.length - shownTracks.length} more tracks`} onClick={() => grow('lib')} dim />}
        {!matched.length && <p className="px-3 py-1.5 text-xs text-base-content/45">Nothing in your libraries</p>}
      </Group>
      {(lists.length > 0 || flows.length > 0) && (
        <Group title="Lists and flows">
          {lists.map(n => <Row key={n.id} depth={0} icon={<Ic name="list" size={14} />} label={<Lit text={n.name} terms={query.terms} />} onClick={() => onList(n.id)} />)}
          {flows.map(f => <Row key={f.id} depth={0} icon={<Ic name="flow" size={14} />} label={<Lit text={f.name} terms={query.terms} />} onClick={() => onFlow(f.id)} />)}
        </Group>
      )}
    </div>
  )
}

function Group({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="flex h-8 items-center gap-1.5 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-base-content/55">
        {title}{hint && <i className="font-normal normal-case tracking-normal not-italic text-base-content/45">{hint}</i>}
      </h3>
      {children}
    </section>
  )
}

/** An online result: click plays it, + queues it, drag carries it like a library track. */
function OnlineRow({ hit }: { hit: OnlineHit }) {
  const t = trackOfHit(hit)
  return (
    <Row
      depth={1}
      icon={hit.thumb ? <img src={hit.thumb} alt="" loading="lazy" className="size-5 rounded object-cover" /> : <Ic name="search" size={12} />}
      label={<>{hit.title}<i className="ml-1.5 text-[11px] not-italic text-base-content/50">{[hit.artist, hit.duration ? fmtTime(hit.duration) : '', hit.kind === 'video' ? 'video' : ''].filter(Boolean).join(' · ')}</i></>}
      onClick={() => void playPayload([hitPayload(hit)])}
      onAdd={() => { addTracksToSet([t], hit.title) }}
      drag={dragProps(t)}
    />
  )
}

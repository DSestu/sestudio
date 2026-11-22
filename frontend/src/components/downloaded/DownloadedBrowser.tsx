import { useState } from 'react'
import type { DownloadedFile, DownloadedTitle, StorageInfo } from '../../api'
import { downloadedThumbUrl } from '../../api'
import { fmtSize } from '../../downloadedLibrary'
import { buildFolders, folderAt, sortedChildren, type FolderNode } from '../../downloadedFolders'
import { currentParams, patchParams } from '../../nav'
import EmptyState from '../EmptyState'
import PosterGrid from '../PosterGrid'
import { folderEntries, leaves, parentOf, pickedEntries, relOf, tickState, type OnTransfer } from '../../transfers'
import TransferMenu from '../storage/TransferMenu'
import TransferBar, { SelectStrip } from '../storage/TransferBar'

/** The first file anywhere under a folder, for the folder's cover. */
function firstFile(node: FolderNode): DownloadedFile | null {
  if (node.files.length) return node.files[0].file
  for (const child of node.folders.values()) {
    const found = firstFile(child)
    if (found) return found
  }
  return null
}

interface Props {
  titles: DownloadedTitle[]
  /** Path filter from the toolbar; empty shows everything. */
  filter?: string
  onPlay: (title: DownloadedTitle, file: DownloadedFile) => void
  /** Left out when deleting is turned off in Settings. */
  onDelete?: (title: DownloadedTitle, file: DownloadedFile) => void
  /** With every storage shown at once, each is a top folder (SPEC-storage §8.1). */
  storages?: StorageInfo[]
  /** Copy or move to another storage (SPEC-storage §9, X2); `canSend` says which files can go. */
  onTransfer?: OnTransfer
  canSend?: (file: DownloadedFile) => boolean
}

/**
 * The download folder browsed as cards — a folder is a card, opening it shows
 * what is inside as cards, and so on down.
 *
 * For the part of a collection TMDB has never heard of, which is most of a
 * personal one. There is nothing to group it by and no artwork to show it with,
 * so the arrangement on disk is the only thing that makes sense of it — and a
 * still lifted from each file is the only picture there is. The tree view says
 * the same thing as an outline; this one is for looking rather than scanning.
 */
export default function DownloadedBrowser({ titles, filter = '', onPlay, onDelete, storages, onTransfer, canSend = () => true }: Props) {
  // Ticks are files, so a ticked folder stays ticked while you look elsewhere.
  const [picked, setPicked] = useState<Set<string> | null>(null)
  const toggle = (files: DownloadedFile[], on: boolean) => setPicked(prev => {
    const next = new Set(prev)
    for (const f of files) if (on) next.add(f.path); else next.delete(f.path)
    return next
  })
  // Kept in the URL, so coming back from playing a file (browser back) lands in
  // the folder it was opened from rather than at the top of the tree again.
  const [path, setPathState] = useState<string[]>(
    () => (currentParams().get('dir') ?? '').split('/').filter(Boolean),
  )
  function setPath(next: string[]) {
    setPathState(next)
    patchParams({ dir: next.join('/') || undefined })
  }
  const needle = filter.trim().toLowerCase()
  const root = buildFolders(
    titles,
    needle,
    storages && ((id: string) => storages.find(s => s.id === id)?.label ?? id),
  )

  // Filtering can prune the folder you were standing in; fall back to the root
  // rather than showing nothing with no way out.
  const node = folderAt(root, path) ?? root
  const here = folderAt(root, path) ? path : []
  const { folders, files } = sortedChildren(node)
  // Crumbs name each level; a storage's top folder is keyed by its id.
  const names = here.map((part, i) => folderAt(root, here.slice(0, i + 1))?.name ?? part)

  const byStorage = Boolean(storages)
  const send = onTransfer && leaves(root).some(canSend) ? onTransfer : undefined
  const menu = (name: string, go: (mode: 'copy' | 'move') => void) =>
    send && <TransferMenu name={name} onPick={go} />
  const filesOf = new Map<string, DownloadedFile[]>()

  const items = [
    ...folders.map(child => {
      const cover = firstFile(child)
      const mine = leaves(child).filter(canSend)
      filesOf.set(`dir:${child.path}`, mine)
      return {
        key: `dir:${child.path}`,
        title: child.name,
        subtitle: `${child.count} ${child.count === 1 ? 'file' : 'files'} · ${fmtSize(child.size)}`,
        poster_url: cover ? downloadedThumbUrl(cover.path) : '',
        // A folder borrows a still from the first file beneath it, so the mark
        // is what says "this opens" rather than "this plays".
        badge: (
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-label="Folder">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6L9 5H6a2 2 0 00-2 2z" />
          </svg>
        ),
        onClick: () => setPath([...here, child.path.split('/').pop() ?? child.name]),
        actions: mine.length > 0 && menu(child.name, mode => send?.({
          mode, name: child.name, entries: folderEntries(child, byStorage).filter(e => canSend(e.file)),
        })),
      }
    }),
    ...files.map(({ file, title }) => {
      if (canSend(file)) filesOf.set(`file:${file.path}`, [file])
      return {
      key: `file:${file.path}`,
      title: file.path.split('/').pop() ?? file.title,
      subtitle: fmtSize(file.size),
      poster_url: downloadedThumbUrl(file.path),
      onClick: () => onPlay(title, file),
      onRemove: onDelete && (() => onDelete(title, file)),
      actions: canSend(file) && menu(file.title, mode => send?.({
        mode, name: relOf(file).split('/').pop() ?? file.title, entries: [{ file, base: parentOf(relOf(file)) }],
      })),
      }
    }),
  ]
  const inView = [...filesOf.values()].flat()
  const chosen = picked && pickedEntries(root, picked, byStorage, canSend)

  return (
    <div className="flex flex-col gap-3">
      {/* Where you are, and the way back out. Every crumb is clickable, so
          climbing several levels does not mean pressing back several times. */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setPath(here.slice(0, -1))}
          disabled={here.length === 0}
          className="btn btn-sm btn-ghost gap-1"
          aria-label="Back to the folder above"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>

        <nav aria-label="Folder path" className="flex items-center gap-1 flex-wrap min-w-0">
          <button
            onClick={() => setPath([])}
            disabled={here.length === 0}
            className={`text-sm ${here.length === 0 ? 'text-base-content/50' : 'link link-hover'}`}
          >
            {storages ? 'All storages' : 'Download folder'}
          </button>
          {here.map((part, i) => (
            <span key={`${part}-${i}`} className="flex items-center gap-1 min-w-0">
              <span className="text-base-content/30">/</span>
              <button
                onClick={() => setPath(here.slice(0, i + 1))}
                disabled={i === here.length - 1}
                className={`text-sm truncate ${
                  i === here.length - 1 ? 'text-base-content/50' : 'link link-hover'
                }`}
              >
                {names[i]}
              </button>
            </span>
          ))}
        </nav>

        <span className="ml-auto text-xs text-base-content/40 shrink-0">
          {node.count} {node.count === 1 ? 'file' : 'files'} · {fmtSize(node.size)}
        </span>
      </div>

      {send && items.length > 0 && (
        <SelectStrip
          picking={picked !== null}
          count={picked?.size ?? 0}
          all={tickState(inView, picked ?? new Set())}
          onStart={() => setPicked(new Set())}
          onAll={on => toggle(inView, on)}
          onCancel={() => setPicked(null)}
        />
      )}

      {items.length === 0 ? (
        <EmptyState
          title={needle ? 'Nothing matches here' : 'This folder is empty'}
          message={
            needle
              ? `No file under this folder matches “${filter}”.`
              : 'Nothing playable sits in this folder.'
          }
        />
      ) : (
        <div className={picked ? 'mb-20' : undefined}>
          <PosterGrid
            items={items}
            selection={picked ? {
              keys: new Set([...filesOf].filter(([, f]) => f.length && f.every(x => picked.has(x.path))).map(([k]) => k)),
              onToggle: key => {
                const f = filesOf.get(key) ?? []
                if (f.length) toggle(f, !f.every(x => picked.has(x.path)))
              },
            } : undefined}
          />
        </div>
      )}
      {send && chosen && (
        <TransferBar
          names={chosen.names}
          entries={chosen.entries}
          onSend={mode => send({
            mode,
            name: chosen.names.length === 1 ? chosen.names[0] : `${chosen.entries.length} files`,
            entries: chosen.entries,
          })}
        />
      )}
    </div>
  )
}

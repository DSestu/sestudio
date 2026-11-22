import { useState } from 'react'
import type { DownloadedFile, DownloadedTitle } from '../../api'
import { deleteDownloadedFile } from '../../api'
import { fmtSize, refreshDownloadedLibrary } from '../../downloadedLibrary'
import { canSendFrom, parentOf, relOf, tickState, titleEntries, type OnTransfer } from '../../transfers'
import { useStorages } from '../../storageChoice'
import ResponsiveModal from '../ResponsiveModal'
import { useModalBack } from '../../useModalBack'
import TransferMenu, { COPY_ICON, MOVE_ICON, TransferIcon } from '../storage/TransferMenu'
import Check from '../storage/Check'

/** `E03 · VF` — how one stored file is named in a list. */
function label(title: DownloadedTitle, file: DownloadedFile): string {
  const number = title.is_film || !file.number
    ? ''
    : `E${String(file.number).padStart(2, '0')} · `
  return `${number}${file.lang ? file.lang.toUpperCase() : 'No language'}`
}

interface Props {
  /** The shelf entry's name — TMDB's when it matched, so it agrees with the card. */
  name: string
  /** Every downloaded season behind that card, lowest first. */
  titles: DownloadedTitle[]
  onClose: () => void
  /** Play one stored file, with the season it belongs to. */
  onPlay: (title: DownloadedTitle, file: DownloadedFile) => void
  /** Whether deleting is turned on in Settings. */
  canDelete: boolean
  /** Names the storage each file is on, once there is more than one. */
  storageLabel?: (id: string) => string
  /** Copy or move files to another storage (SPEC-storage §9, X2). */
  onTransfer?: OnTransfer
}

/**
 * The files a downloaded card actually consists of, and the only place they can
 * be deleted.
 *
 * Deletion is per file and confirmed: a card in the listing can stand for a
 * whole show, so a delete control up there would take out seasons at a time.
 */
export default function DownloadedFilesModal({ name, titles, onClose, onPlay, canDelete, storageLabel, onTransfer }: Props) {
  const [confirming, setConfirming] = useState<DownloadedFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Select mode (option B): checkboxes, and a bar that sends what is ticked.
  const [picked, setPicked] = useState<Set<string> | null>(null)
  useModalBack(true, onClose)

  const totalFiles = titles.reduce((n, t) => n + t.files.length, 0)
  const totalSize = titles.reduce((n, t) => n + t.size, 0)
  const list = useStorages()
  // Another sestudio's files are read only here: nothing to send them with.
  const sendable = (f: DownloadedFile) => canSendFrom(list, f.storage ?? 'local')
  const all = titles.flatMap(t => t.files).filter(sendable)
  const send = onTransfer && all.length > 0 ? onTransfer : undefined
  const chosen = picked ? all.filter(f => picked.has(f.path)) : []
  const toggle = (files: DownloadedFile[], on: boolean) => setPicked(prev => {
    const next = new Set(prev)
    for (const f of files) if (on) next.add(f.path); else next.delete(f.path)
    return next
  })
  const state = (files: DownloadedFile[]) => tickState(files, picked ?? new Set())
  // Every file the title holds lands under its own folder, seasons and all.
  const sendTitle = (mode: 'copy' | 'move', files: DownloadedFile[]) => send?.({
    mode,
    name: files.length === all.length ? name : `${files.length} files of ${name}`,
    entries: titleEntries(files),
  })
  const sendOne = (mode: 'copy' | 'move', file: DownloadedFile) => send?.({
    mode, name: file.title, entries: [{ file, base: parentOf(relOf(file)) }],
  })

  async function remove(file: DownloadedFile) {
    setBusy(true)
    setError(null)
    try {
      await deleteDownloadedFile(file.path)
      await refreshDownloadedLibrary()
      setConfirming(null)
    } catch {
      setError('Could not delete that file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ResponsiveModal onClose={onClose} boxClassName="max-w-lg">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-lg">{name}</h3>
          <p className="text-sm text-base-content/50">
            {totalFiles} {totalFiles === 1 ? 'file' : 'files'} · {fmtSize(totalSize)}
          </p>
        </div>
        {send && !picked && (
          <button onClick={() => setPicked(new Set())} className="btn btn-ghost btn-sm">Select</button>
        )}
      </div>

      {send && !picked && (
        <div className="flex gap-2 mt-3">
          <button onClick={() => sendTitle('copy', all)} className="btn btn-sm btn-outline gap-1.5"><TransferIcon d={COPY_ICON} /> Copy all to…</button>
          <button onClick={() => sendTitle('move', all)} className="btn btn-sm btn-outline gap-1.5"><TransferIcon d={MOVE_ICON} /> Move all to…</button>
        </div>
      )}
      {picked && (
        <div className="flex items-center gap-2 mt-3 px-2 py-1.5 rounded-box bg-base-300/50">
          <Check state={state(all)} label="Select all" onChange={on => toggle(all, on)} />
          <span className="text-sm">Select all</span>
          <span className="text-xs text-base-content/50 ml-auto">{picked.size} selected</span>
          <button onClick={() => setPicked(null)} className="btn btn-ghost btn-xs">Cancel</button>
        </div>
      )}
      <div className="mb-3" />

      {error && <p role="alert" className="text-error text-sm mb-2">{error}</p>}

      <ul className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
        {titles.map(title => (
          <li key={title.key}>
            {/* Headed per season, since a card can stand for a whole show. The
                heading is dropped for a lone season: it would only repeat the
                summary directly above it. */}
            {titles.length > 1 && (
              <p className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-base-content/40 px-2 pt-2">
                {picked && title.files.some(sendable) && (
                  <Check
                    state={state(title.files.filter(sendable))}
                    label={`Select ${title.is_film ? 'the film' : `season ${title.season}`}`}
                    onChange={on => toggle(title.files.filter(sendable), on)}
                  />
                )}
                {title.is_film ? 'Film' : `Season ${title.season}`}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {title.files.map(file => (
                <li
                  key={file.path}
                  className={`flex items-center gap-2 rounded-box px-2 py-2 hover:bg-base-300/60 ${picked?.has(file.path) ? 'bg-primary/10' : ''}`}
                >
                  {picked && (sendable(file)
                    ? <Check state={picked.has(file.path)} label={`Select ${file.title}`} onChange={on => toggle([file], on)} />
                    : <span className="w-4 shrink-0" />)}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{file.title}</p>
                    <p className="text-xs text-base-content/50 font-mono">
                      {label(title, file)} · {fmtSize(file.size)}
                      {storageLabel && ` · ${storageLabel(file.storage ?? 'local')}`}
                    </p>
                  </div>

                  {picked ? null : confirming?.path === file.path ? (
                    // Inline rather than a second modal: the thing being deleted
                    // stays on screen next to the confirmation.
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-base-content/60 mr-1">Delete?</span>
                      <button
                        onClick={() => void remove(file)}
                        disabled={busy}
                        className="btn btn-error btn-xs"
                      >
                        {busy ? '…' : 'Delete'}
                      </button>
                      <button
                        onClick={() => setConfirming(null)}
                        disabled={busy}
                        className="btn btn-ghost btn-xs"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => onPlay(title, file)}
                        aria-label={`Play ${file.title}`}
                        title="Play"
                        className="btn btn-ghost btn-square btn-sm"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </button>
                      {canDelete && <button
                        onClick={() => setConfirming(file)}
                        aria-label={`Delete ${file.title} from disk`}
                        title="Delete from disk"
                        className="btn btn-ghost btn-square btn-sm text-base-content/40 hover:text-error"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                        </svg>
                      </button>}
                      {send && sendable(file) && (
                        <TransferMenu name={file.title} onPick={mode => sendOne(mode, file)} />
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      {picked ? (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-base-300">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">
              {chosen.length} {chosen.length === 1 ? 'file' : 'files'} · {fmtSize(chosen.reduce((n, f) => n + f.size, 0))}
            </p>
            {storageLabel && chosen.length > 0 && (
              <p className="text-xs text-base-content/50 truncate">
                on {[...new Set(chosen.map(f => storageLabel(f.storage ?? 'local')))].join(' + ')}
              </p>
            )}
          </div>
          <button disabled={!chosen.length} onClick={() => sendTitle('copy', chosen)} className="btn btn-sm btn-primary gap-1.5"><TransferIcon d={COPY_ICON} /> Copy to…</button>
          <button disabled={!chosen.length} onClick={() => sendTitle('move', chosen)} className="btn btn-sm btn-outline gap-1.5"><TransferIcon d={MOVE_ICON} /> Move to…</button>
        </div>
      ) : (
        <div className="modal-action">
          <button onClick={onClose} className="btn btn-sm">Close</button>
        </div>
      )}
    </ResponsiveModal>
  )
}

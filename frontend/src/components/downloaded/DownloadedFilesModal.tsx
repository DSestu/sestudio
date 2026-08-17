import { useState } from 'react'
import type { DownloadedFile, DownloadedTitle } from '../../api'
import { deleteDownloadedFile } from '../../api'
import { fmtSize, refreshDownloadedLibrary } from '../../downloadedLibrary'
import ResponsiveModal from '../ResponsiveModal'
import { useModalBack } from '../../useModalBack'

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
}

/**
 * The files a downloaded card actually consists of, and the only place they can
 * be deleted.
 *
 * Deletion is per file and confirmed: a card in the listing can stand for a
 * whole show, so a delete control up there would take out seasons at a time.
 */
export default function DownloadedFilesModal({ name, titles, onClose, onPlay }: Props) {
  const [confirming, setConfirming] = useState<DownloadedFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useModalBack(true, onClose)

  const totalFiles = titles.reduce((n, t) => n + t.files.length, 0)
  const totalSize = titles.reduce((n, t) => n + t.size, 0)

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
      <h3 className="font-semibold text-lg">{name}</h3>
      <p className="text-sm text-base-content/50 mb-4">
        {totalFiles} {totalFiles === 1 ? 'file' : 'files'} · {fmtSize(totalSize)}
      </p>

      {error && <p role="alert" className="text-error text-sm mb-2">{error}</p>}

      <ul className="flex flex-col gap-1 max-h-[50vh] overflow-y-auto">
        {titles.map(title => (
          <li key={title.key}>
            {/* Headed per season, since a card can stand for a whole show. The
                heading is dropped for a lone season: it would only repeat the
                summary directly above it. */}
            {titles.length > 1 && (
              <p className="text-[10px] uppercase tracking-wide text-base-content/40 px-2 pt-2">
                {title.is_film ? 'Film' : `Season ${title.season}`}
              </p>
            )}
            <ul className="flex flex-col gap-1">
              {title.files.map(file => (
                <li
                  key={file.path}
                  className="flex items-center gap-2 rounded-box px-2 py-2 hover:bg-base-300/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate">{file.title}</p>
                    <p className="text-xs text-base-content/50 font-mono">
                      {label(title, file)} · {fmtSize(file.size)}
                    </p>
                  </div>

                  {confirming?.path === file.path ? (
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
                      <button
                        onClick={() => setConfirming(file)}
                        aria-label={`Delete ${file.title} from disk`}
                        title="Delete from disk"
                        className="btn btn-ghost btn-square btn-sm text-base-content/40 hover:text-error"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
                        </svg>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className="modal-action">
        <button onClick={onClose} className="btn btn-sm">Close</button>
      </div>
    </ResponsiveModal>
  )
}

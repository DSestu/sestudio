import type { DownloadedFile, DownloadedTitle } from '../../api'
import { fmtSize } from '../../downloadedLibrary'
import { buildFolders, sortedChildren, type FolderNode } from '../../downloadedFolders'

interface Props {
  titles: DownloadedTitle[]
  /** Path filter from the toolbar; empty shows everything. */
  filter?: string
  /**
   * Open the folders a filter left behind, so the matching files are on screen.
   * False keeps them shut, which is what search wants: the answer there is
   * "which folder has this", not a row per episode.
   */
  expandMatches?: boolean
  onPlay: (title: DownloadedTitle, file: DownloadedFile) => void
  /** Omitted where deleting would be out of place — the button is then absent. */
  onDelete?: (title: DownloadedTitle, file: DownloadedFile) => void
}

/** One folder and everything under it, shut until asked.
 *
 * A collection runs to thousands of files, so anything open by default buries
 * the top level it is meant to reveal. The count and size on each row are there
 * so a folder can be judged without opening it.
 */
function Folder({ node, expanded, onPlay, onDelete }: {
  node: FolderNode
  /** Filtering opens what is left, so the matches are on screen. */
  expanded: boolean
  onPlay: Props['onPlay']
  onDelete: Props['onDelete']
}) {
  // Shared with the card browser, so the two never disagree about order.
  const { folders, files } = sortedChildren(node)

  return (
    <ul className="flex flex-col gap-0.5">
      {folders.map(child => (
        <li key={child.path}>
          <details open={expanded} className="group">
            <summary className="flex items-center gap-2 px-2 py-1.5 rounded-box cursor-pointer hover:bg-base-300/60 list-none">
              <svg
                className="w-3.5 h-3.5 shrink-0 text-base-content/40 transition-transform group-open:rotate-90"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
              <svg className="w-4 h-4 shrink-0 text-base-content/40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10a2 2 0 002 2h12a2 2 0 002-2V9a2 2 0 00-2-2h-6L9 5H6a2 2 0 00-2 2z" />
              </svg>
              <span className="text-sm truncate">{child.name}</span>
              <span className="ml-auto text-xs text-base-content/40 tabular-nums shrink-0">
                {child.count} · {fmtSize(child.size)}
              </span>
            </summary>
            <div className="pl-4 border-l border-base-300 ml-3">
              <Folder node={child} expanded={expanded} onPlay={onPlay} onDelete={onDelete} />
            </div>
          </details>
        </li>
      ))}

      {files.map(({ file, title }) => (
        <li
          key={file.path}
          className="group/file flex items-center gap-2 px-2 py-1.5 rounded-box hover:bg-base-300/60"
        >
          <svg className="w-4 h-4 shrink-0 text-base-content/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <button
            onClick={() => onPlay(title, file)}
            className="min-w-0 flex-1 text-left"
            title={file.path}
          >
            <span className="block text-sm truncate">{file.path.split('/').pop()}</span>
          </button>
          <span className="text-xs text-base-content/40 tabular-nums shrink-0">
            {fmtSize(file.size)}
          </span>
          {onDelete && (
            <button
              onClick={() => onDelete(title, file)}
              aria-label={`Delete ${file.title} from disk`}
              title="Delete from disk"
              className="btn btn-ghost btn-square btn-xs shrink-0 text-base-content/30 hover:text-error opacity-100 [@media(hover:hover)]:opacity-0 group-hover/file:opacity-100 focus:opacity-100 transition-opacity"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7V4a1 1 0 011-1h4a1 1 0 011 1v3" />
              </svg>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

/** The download folder as a tree — every file, where it really lives. */
export default function DownloadedTree({
  titles, filter = '', expandMatches = true, onPlay, onDelete,
}: Props) {
  const needle = filter.trim().toLowerCase()
  const root = buildFolders(titles, needle)
  return (
    <div className="rounded-box border border-base-300 p-2">
      {root.count === 0 ? (
        <p className="text-sm text-base-content/50 px-2 py-6 text-center">
          No files match “{filter}”.
        </p>
      ) : (
        <Folder
          node={root}
          expanded={expandMatches && needle !== ''}
          onPlay={onPlay}
          onDelete={onDelete}
        />
      )}
    </div>
  )
}

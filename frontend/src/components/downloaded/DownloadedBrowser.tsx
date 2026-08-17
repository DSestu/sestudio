import { useState } from 'react'
import type { DownloadedFile, DownloadedTitle } from '../../api'
import { downloadedThumbUrl } from '../../api'
import { fmtSize } from '../../downloadedLibrary'
import { buildFolders, folderAt, sortedChildren, type FolderNode } from '../../downloadedFolders'
import EmptyState from '../EmptyState'
import PosterGrid from '../PosterGrid'

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
  onDelete: (title: DownloadedTitle, file: DownloadedFile) => void
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
export default function DownloadedBrowser({ titles, filter = '', onPlay, onDelete }: Props) {
  const [path, setPath] = useState<string[]>([])
  const needle = filter.trim().toLowerCase()
  const root = buildFolders(titles, needle)

  // Filtering can prune the folder you were standing in; fall back to the root
  // rather than showing nothing with no way out.
  const node = folderAt(root, path) ?? root
  const here = folderAt(root, path) ? path : []
  const { folders, files } = sortedChildren(node)

  const items = [
    ...folders.map(child => {
      const cover = firstFile(child)
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
        onClick: () => setPath([...here, child.name]),
      }
    }),
    ...files.map(({ file, title }) => ({
      key: `file:${file.path}`,
      title: file.path.split('/').pop() ?? file.title,
      subtitle: fmtSize(file.size),
      poster_url: downloadedThumbUrl(file.path),
      onClick: () => onPlay(title, file),
      onRemove: () => onDelete(title, file),
    })),
  ]

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
            Download folder
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
                {part}
              </button>
            </span>
          ))}
        </nav>

        <span className="ml-auto text-xs text-base-content/40 shrink-0">
          {node.count} {node.count === 1 ? 'file' : 'files'} · {fmtSize(node.size)}
        </span>
      </div>

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
        <PosterGrid items={items} />
      )}
    </div>
  )
}

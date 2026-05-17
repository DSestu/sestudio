import { useState } from 'react'
import type { DownloadItem } from '../api'

interface Props {
  items: DownloadItem[]
  outputRoot: string
  existingFiles: Set<string>
  onConfirm: () => Promise<void>
  onCancel: () => void
}

interface FileTree {
  [series: string]: {
    [season: string]: string[]
  }
}

function buildTree(items: DownloadItem[]): FileTree {
  const tree: FileTree = {}
  for (const item of items) {
    const season = item.season === 0 ? 'fstream_films' : `Season ${String(item.season).padStart(2, '0')}`
    const group = item.season === 0 ? 'Films' : item.series_name
    if (!tree[group]) tree[group] = {}
    if (!tree[group][season]) tree[group][season] = []
    tree[group][season].push(item.episode_name)
  }
  return tree
}

export default function ConfirmDownloadModal({ items, outputRoot, existingFiles, onConfirm, onCancel }: Props) {
  const [confirming, setConfirming] = useState(false)
  const tree = buildTree(items)
  const episodeCount = items.length
  const filmCount = items.filter(i => i.season === 0).length
  const episodeOnlyCount = episodeCount - filmCount
  const newCount = items.filter(i => !existingFiles.has(i.episode_name)).length
  const skippedCount = episodeCount - newCount
  const seasonCount = Object.values(tree).reduce((n, s) => n + Object.keys(s).length, 0)
  const seriesCount = Object.keys(tree).length

  function summaryLabel(): string {
    const parts: string[] = []
    if (filmCount > 0) parts.push(`${filmCount} film${filmCount !== 1 ? 's' : ''}`)
    if (episodeOnlyCount > 0) parts.push(`${episodeOnlyCount} episode${episodeOnlyCount !== 1 ? 's' : ''}`)
    return parts.join(' + ')
  }

  function downloadLabel(): string {
    const newFilms = items.filter(i => i.season === 0 && !existingFiles.has(i.episode_name)).length
    const newEps = newCount - newFilms
    const parts: string[] = []
    if (newFilms > 0) parts.push(`${newFilms} film${newFilms !== 1 ? 's' : ''}`)
    if (newEps > 0) parts.push(`${newEps} episode${newEps !== 1 ? 's' : ''}`)
    return `Download ${parts.join(' + ')}`
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={onCancel}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-700">
          <h2 className="text-white font-semibold text-lg">Confirm download</h2>
          <p className="text-zinc-400 text-sm mt-0.5">
            {summaryLabel()}
            {episodeOnlyCount > 0 && ` across ${seasonCount} season${seasonCount !== 1 ? 's' : ''}`}
            {seriesCount > 1 && episodeOnlyCount > 0 ? ` in ${seriesCount - (filmCount > 0 ? 1 : 0)} series` : ''}
            {skippedCount > 0 && (
              <span className="ml-2 text-amber-500">· {skippedCount} already downloaded</span>
            )}
          </p>
        </div>

        {/* Output path */}
        <div className="px-6 py-3 bg-zinc-950/50 border-b border-zinc-800 flex items-center gap-2">
          <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
          <span className="text-zinc-400 text-sm font-mono truncate">{outputRoot}</span>
        </div>

        {/* File tree */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
          {Object.entries(tree).map(([series, seasons]) => (
            <div key={series}>
              {/* Series */}
              <div className="flex items-center gap-2 mb-1">
                <svg className="w-4 h-4 text-violet-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
                <span className="text-white text-sm font-medium">{series}</span>
              </div>

              {Object.entries(seasons).map(([season, files]) => (
                <div key={season} className="ml-5 mb-2">
                  {/* Season */}
                  <div className="flex items-center gap-2 mb-1">
                    <svg className="w-4 h-4 text-zinc-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                    </svg>
                    <span className="text-zinc-300 text-sm">{season}</span>
                    <span className="text-zinc-600 text-xs">{files.length} file{files.length !== 1 ? 's' : ''}</span>
                  </div>

                  {/* Files */}
                  <div className="ml-5 space-y-0.5">
                    {files.map(f => {
                      const exists = existingFiles.has(f)
                      return (
                        <div key={f} className="flex items-center gap-2">
                          <svg className={`w-3.5 h-3.5 shrink-0 ${exists ? 'text-amber-600' : 'text-zinc-600'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className={`text-xs font-mono truncate ${exists ? 'line-through text-zinc-600' : 'text-zinc-400'}`}>
                            {f}
                          </span>
                          {exists && (
                            <span className="text-xs text-amber-600 shrink-0">exists</span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-700">
          <button
            onClick={onCancel}
            className="text-zinc-400 hover:text-white text-sm px-4 py-2 rounded-lg hover:bg-zinc-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={async () => { setConfirming(true); try { await onConfirm() } finally { setConfirming(false) } }}
            disabled={newCount === 0 || confirming}
            className="bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            {confirming ? 'Queuing…' : downloadLabel()}
          </button>
        </div>
      </div>
    </div>
  )
}

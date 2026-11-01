import { useState } from 'react'
import type { ImportResult } from '../api'
import { importFollows } from '../api'
import { refreshWatchers } from '../watchers'

/**
 * Bring your follows over without signing in anywhere: the subscriptions.csv
 * Google Takeout exports, and Twitch names pasted in.
 */
export default function ImportFollows() {
  const [file, setFile] = useState<File | null>(null)
  const [twitch, setTwitch] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState('')

  async function run() {
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const done = await importFollows({ youtube_csv: file ? await file.text() : '', twitch })
      setResult(done)
      setFile(null)
      setTwitch('')
      await refreshWatchers()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="import-takeout" className="text-sm text-base-content/60 mb-1 block">
          YouTube subscriptions
        </label>
        <input
          id="import-takeout"
          type="file"
          accept=".csv,text/csv"
          className="file-input file-input-bordered file-input-sm w-full"
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-base-content/50 mt-1">
          From <a href="https://takeout.google.com" target="_blank" rel="noreferrer" className="link">Google Takeout</a>:
          export only YouTube, then pick <span className="font-mono">subscriptions/subscriptions.csv</span>.
        </p>
      </div>
      <div>
        <label htmlFor="import-twitch" className="text-sm text-base-content/60 mb-1 block">
          Twitch channels
        </label>
        <textarea
          id="import-twitch"
          rows={3}
          value={twitch}
          onChange={e => setTwitch(e.target.value)}
          placeholder={'zerator\nhttps://www.twitch.tv/kameto'}
          className="textarea textarea-bordered w-full text-sm"
        />
        <p className="text-xs text-base-content/50 mt-1">Names or links, one per line.</p>
      </div>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || (!file && !twitch.trim())}
          onClick={run}
        >
          {busy ? 'Importing…' : 'Follow them'}
        </button>
        <p role="status" className="text-xs text-base-content/60">
          {result && [
            `${result.added} followed`,
            result.skipped ? `${result.skipped} already followed` : null,
            result.unknown.length ? `not found on Twitch: ${result.unknown.join(', ')}` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
      {error && <p role="alert" className="text-xs text-error">{error}</p>}
    </div>
  )
}

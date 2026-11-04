import { useEffect, useState } from 'react'
import RankRow from '../../components/RankRow'
import type { AppSettings, SiteInfo } from '../../api'
import { getSites } from '../../api'
import { DEFAULT_HOST_ORDER } from '../../downloadPrefs'
import type { SettingsProps } from './SettingsView'

/** Settings › Downloads: where files go, which sites and hosts are tried first, and deleting. */
export default function Downloads({ settings, onUpdate }: SettingsProps) {
  const [sites, setSites] = useState<SiteInfo[]>([])

  useEffect(() => { void getSites().then(setSites) }, [])

  return (
    <section aria-labelledby="settings-downloads" className="flex flex-col gap-4">
      <h3
        id="settings-downloads"
        className="text-xs font-semibold uppercase tracking-wide text-base-content/50"
      >
        Downloads
      </h3>

      <div>
        <label htmlFor="set-dest" className="text-sm text-base-content/60 mb-1 block">
          Download to
        </label>
        <select
          id="set-dest"
          className="select select-bordered w-full"
          value={settings.download_destination}
          onChange={e =>
            onUpdate({ download_destination: e.target.value as AppSettings['download_destination'] })
          }
        >
          <option value="server">Server</option>
          <option value="device">This device</option>
        </select>
        <p className="text-xs text-base-content/50 mt-1">
          “This device” streams the file through the server to your browser.
        </p>
      </div>

      <div>
        <span className="text-sm text-base-content/60 mb-1 block">Download order</span>
        <p className="text-xs text-base-content/50 mb-2 leading-snug">
          Click a chip to add it to the order — the first click is choice 1,
          the next is choice 2, and so on; click a numbered chip to take it
          out. A download tries your order from the top and moves to the next
          one whenever a site or host fails, so the order decides what is used
          first, never what is possible. Unnumbered entries are still tried,
          after the numbered ones.
        </p>
        <div className="flex flex-col gap-2">
          <RankRow
            label="Site"
            options={sites.map(site => ({ value: site.id, label: site.display_name }))}
            order={settings.preferred_sites ?? []}
            onChange={order => void onUpdate({ preferred_sites: order })}
          />
          <RankRow
            label="Host"
            options={(settings.known_hosts ?? []).map(h => ({ value: h, label: h }))}
            order={settings.preferred_hosts ?? []}
            onChange={order => void onUpdate({ preferred_hosts: order })}
          />
        </div>
        <button
          onClick={() =>
            void onUpdate({
              preferred_sites: ['fstream'],
              preferred_hosts: settings.default_hosts ?? DEFAULT_HOST_ORDER,
            })
          }
          className="btn btn-ghost btn-xs mt-2"
        >
          Reset order
        </button>
      </div>

      <div>
        <label htmlFor="set-output" className="text-sm text-base-content/60 mb-1 block">
          Download folder (server)
        </label>
        <input
          id="set-output"
          className="input input-bordered w-full"
          value={settings.output_root}
          onChange={e => onUpdate({ output_root: e.target.value })}
        />
        <p className="text-xs text-base-content/50 mt-1">
          {settings.download_destination === 'server'
            ? 'Where completed downloads are written on the server.'
            : 'Only used when downloading to the server.'}
        </p>
      </div>

      <div>
        <label className="flex items-center gap-3 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="toggle toggle-error toggle-sm"
            checked={settings.allow_file_deletion === true}
            onChange={e => onUpdate({ allow_file_deletion: e.target.checked })}
          />
          <span>Allow deleting downloaded files</span>
        </label>
        <p className="text-xs text-base-content/50 mt-1">
          Shows a delete button on files in the downloaded browser. Deleted files
          are removed from the server's disk for good — there is no undo.
        </p>
      </div>
    </section>
  )
}

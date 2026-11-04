import { useEffect, useState } from 'react'
import RankRow from '../../components/RankRow'
import type { AppSettings, SiteInfo } from '../../api'
import { getSites } from '../../api'
import { DEFAULT_HOST_ORDER } from '../../downloadPrefs'
import { Choice, SettingRow, SettingsGroup, ToggleRow } from './rows'
import type { SettingsProps } from './SettingsView'

const DESTINATIONS: { value: AppSettings['download_destination']; label: string }[] = [
  { value: 'server', label: 'Server' },
  { value: 'device', label: 'This device' },
]

/** Settings › Downloads: where files go, which sites and hosts are tried first, and deleting. */
export default function Downloads({ settings, onUpdate }: SettingsProps) {
  const [sites, setSites] = useState<SiteInfo[]>([])

  useEffect(() => { void getSites().then(setSites) }, [])

  const toServer = settings.download_destination === 'server'

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label="Download to"
          help={toServer ? 'Saved on the server, in the folder below' : 'Streamed through the server to this browser'}
        >
          <Choice
            label="Download to"
            value={settings.download_destination}
            options={DESTINATIONS}
            onChange={download_destination => onUpdate({ download_destination })}
          />
        </SettingRow>
        <SettingRow
          label="Folder on the server"
          htmlFor="set-output"
          help={toServer ? undefined : 'Only used when downloading to the server'}
          stacked
        >
          <input
            id="set-output"
            className="input input-sm h-9 w-full bg-base-100 border-0 font-mono"
            value={settings.output_root}
            onChange={e => onUpdate({ output_root: e.target.value })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup
        title="Try first"
        footnote={
          <>
            Tap to number. If one fails the next is tried, and unnumbered ones are still tried after.{' '}
            <button
              onClick={() =>
                void onUpdate({
                  preferred_sites: ['fstream'],
                  preferred_hosts: settings.default_hosts ?? DEFAULT_HOST_ORDER,
                })
              }
              className="text-primary font-medium"
            >
              Reset
            </button>
          </>
        }
      >
        <SettingRow label="Sites" stacked>
          <RankRow
            options={sites.map(site => ({ value: site.id, label: site.display_name }))}
            order={settings.preferred_sites ?? []}
            onChange={order => void onUpdate({ preferred_sites: order })}
          />
        </SettingRow>
        <SettingRow label="Hosts" stacked>
          <RankRow
            options={(settings.known_hosts ?? []).map(h => ({ value: h, label: h }))}
            order={settings.preferred_hosts ?? []}
            onChange={order => void onUpdate({ preferred_hosts: order })}
          />
        </SettingRow>
      </SettingsGroup>

      <SettingsGroup>
        <ToggleRow
          label="Allow deleting files"
          help="A delete button on downloaded files. Gone from the server's disk, no undo"
          danger
          checked={settings.allow_file_deletion === true}
          onChange={on => onUpdate({ allow_file_deletion: on })}
        />
      </SettingsGroup>
    </>
  )
}

import { useEffect, useState } from 'react'
import RankRow from '../../components/RankRow'
import type { AppSettings, SiteInfo } from '../../api'
import { getSites } from '../../api'
import { DEFAULT_HOST_ORDER } from '../../downloadPrefs'
import { useStorages } from '../../storageChoice'
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
  // Where they land is a storage, picked in Settings › Storage (SPEC-storage §8.2).
  const target = useStorages().find(s => s.download)

  return (
    <>
      <SettingsGroup>
        <SettingRow
          label="Download to"
          help={toServer ? 'Saved on the server, on the storage below' : 'Streamed through the server to this browser'}
        >
          <Choice
            label="Download to"
            value={settings.download_destination}
            options={DESTINATIONS}
            onChange={download_destination => onUpdate({ download_destination })}
          />
        </SettingRow>
        <SettingRow
          label={<>Saved on <span className="font-semibold">{target?.label ?? 'This PC'}</span></>}
          help={
            <span className="block font-mono truncate">
              {toServer ? target?.path ?? settings.output_root : 'Only used when downloading to the server'}
            </span>
          }
        >
          <a href="#/settings?s=storage" className="btn btn-ghost btn-sm">Storage ›</a>
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

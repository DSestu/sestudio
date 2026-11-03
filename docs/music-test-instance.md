# Music test instance

A second sestudio, on the Windows machine, for reviewing the music feature live with real audio
(SPEC-music §8). It has its own config, library DB and downloads dir, so it never touches the live
instance (HTTP 8080, HTTPS 8443).

## Settings it uses

| What | How |
|---|---|
| Config file | env `SESTUDIO_CONFIG` (its folder also holds the TLS cert and derived caches) |
| Library DB | env `SESTUDIO_DB` |
| Background watchers | env `SESTUDIO_WATCHERS=0` |
| Lab page `#/lab/music` | env `SESTUDIO_LAB=1` (off otherwise: the route falls back to home) |
| Downloads dir | `output_root` in the config file (also Settings > Downloads) |
| Ports | CLI `--http-port`, `--https-port` |

## One-time setup (PowerShell)

The test music is copied, so the review never touches the originals.

```powershell
$t = "D:\sestudio-music-test"
New-Item -ItemType Directory -Force "$t\music" | Out-Null
Copy-Item "R:\Musique\Android\neuro soundcloud\*" "$t\music"
@{ output_root = "$t\music" } | ConvertTo-Json | Set-Content -Encoding utf8 "$t\config.json"
```

## Start it

From the worktree under review, with its dependencies synced (`uv sync --all-extras`).
`--https-port 8444` is the URL the phone and the TV use; it does not change between iterations.
`--no-http` leaves 8080 to the live instance; `--no-resolve` skips the live-domain lookup.

```powershell
$t = "D:\sestudio-music-test"
$env:SESTUDIO_CONFIG = "$t\config.json"
$env:SESTUDIO_DB = "$t\library.db"
$env:SESTUDIO_WATCHERS = "0"
$env:SESTUDIO_LAB = "1"
uv run sestudio --no-http --https-port 8444 --no-resolve
```

Open `https://<LAN IP of the PC>:8444/#/lab/music`. The server prints the address; if the phone or
TV cannot reach it, allow Python through Windows Firewall for that network (the server says so).

## Chromecast

Chromecast needs the secure origin. The cert is self-signed and cached next to the config file in
`$t` (`cert.pem`, `key.pem`), covering the PC's LAN IPs. Trust it once on each device by opening
the HTTPS URL and accepting it. It is re-issued when the PC's LAN address changes.

## Rebuilding

The server serves the committed `frontend/dist`. After a frontend change run `npm run build` in
`frontend/` and reload the page; no restart needed. Restart only for Python changes (Ctrl-C, then
the same command).

## Reset

Stop the server and delete `$t\library.db` for an empty library; the music in `$t\music` is
rescanned.

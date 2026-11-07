# Spec: remote servers (one sestudio in front of another)

Status: approved, stories and screens (2026-11-07). Building.

## 1. Why

A sestudio on a phone, a laptop or a second PC should be able to show and play everything a
sestudio elsewhere holds, as if it were local: library, downloads, music, settings, and casting
to whatever TV is next to *this* machine. The remote one may be on another network, reached
over Tailscale. Today each instance only knows its own disk.

## 2. User stories

1. **Register.** In Settings I add a server with a name and a URL (`https://100.x.y.z:8443`).
   sestudio checks it right away: reachable or not, its version, round trip, and shows the result
   on the row. The server is remembered across restarts.
2. **Trust.** The first check shows the remote's certificate fingerprint and asks me to accept
   it. After that, a changed certificate blocks the server until I accept again.
3. **Retest.** Every server row has "Check again". Opening the Servers page checks them all.
   A server that is down shows since when it was last seen.
4. **Switch.** I pick a server: from then on this sestudio shows that server's library, downloads,
   music, watchers, history and settings. I pick "This machine" to come back. No restart, no
   reload beyond the page refreshing its data.
5. **Know where I am.** While switched, every page says so in one place (the top card), with the
   server's name, and one tap takes me to the Servers page.
6. **Cast from here.** While switched, Chromecast and DLNA use the TV next to this machine; the
   video bytes come from the remote through this sestudio.
7. **Phone.** On the Android app, the same Servers page registers my PC over Tailscale; nothing
   changes in the app's setup. On Wi-Fi away from home the TV plays my PC's media through the
   phone.
8. **It fails cleanly.** If the switched server stops answering, pages show the usual error
   state with the server's name and a "Switch back" action; nothing hangs.

Out of scope: merging two libraries into one view, syncing settings between servers, more than
one switched server at a time, accounts or passwords (Tailscale is the access control).

## 3. Design

### Where it lives

In the server, not in the app: `src/sestudio/web/routes/servers.py` and a forwarding layer in
`web/app.py`. The Android app needs no change: its server gets the feature with the next
`sestudio` release.

### Config

`config.json`: `servers: [{id, name, url, fingerprint | null}]`, `active_server: id | null`.
Saved like the rest of the config (`config.py`).

### Routes, always local

| Route | Does |
|---|---|
| `GET /api/servers` | list with the last check result of each (`reachable`, `version`, `rtt_ms`, `last_seen`, `fingerprint`, `trusted`) |
| `POST /api/servers` | add; runs a check; returns the row |
| `DELETE /api/servers/{id}` | remove; clears `active_server` if it was it |
| `POST /api/servers/{id}/check` | `GET <url>/api/health` with a 3 s timeout, pins the certificate on accept |
| `POST /api/servers/{id}/trust` | accept the fingerprint the last check saw |
| `PUT /api/servers/active` | `{id | null}`; sets `app.state.upstream` at once |

The check calls the remote's existing `/api/health` (`routes/health.py:124`) for version and
latency; nothing new on the remote side.

### Forwarding

A FastAPI middleware before the routers: when `app.state.upstream` is set and the path starts
with `/api/` and is not in the local set below, the request is forwarded with `httpx`
(already a dependency) as a streaming response: same method, query, body and headers, `Range`
included, no buffering (the music queue's `EventSource` at `musicQueue.ts:229` must stream).
The certificate is verified against the pinned fingerprint only.

Local set, never forwarded: `/api/servers*`, `/api/cast/dlna/*`, `/api/cast/http-port`,
`/api/server/lan`, `/api/tls-permission`, `/api/health`.

The frontend (`/`, `/assets`) is always served locally, so the Servers page and "switch back"
exist whatever the remote runs. A version mismatch is shown on the row and is a warning, not
a block.

### Why casting works unchanged

- Chromecast: the page builds the media URL from its own origin and `/api/cast/http-port`
  (`frontend/src/musicCast.ts:87`, `OutputSwitcher.tsx:141`), both local, so the TV fetches from
  this machine and the forwarder streams from the remote.
- DLNA: discovery and play run locally (`routes/cast.py`); the media URL is built on this
  machine's LAN IP (`_local_ip_for`) with the stream's path, which is forwarded. What the TV is
  sent (the file as it is, or re-encoded for a caption, a lighter quality, another frame rate)
  is decided where the files are: `POST /api/cast/plan` on the server in use (`plan_cast`),
  asked by the local play route when switched. Known limit: changing a DLNA cast's quality or
  caption mid-play while switched is refused (the remote has no TV session); cast again instead.
- Proven end to end by `tests/test_remote_servers_e2e.py` (not in CI): two real servers on this
  machine, the remote registered by its Tailscale address, a fake DLNA TV found by SSDP that
  fetches the media, a fake Chromecast fetching the page's URL, and the remote going away.
- Cast quality, fps and tracks (`/api/cast/tracks`, `/api/media/options`) are forwarded, so they
  describe the remote's files: the remote does the probing and transcoding.

### What the user accepts

- Media bytes cross this machine twice while casting (remote → here → TV). Away from home the
  remote's upload is the limit; the existing quality rungs apply.
- While switched, Settings pages other than Servers edit the *remote's* settings. The top card
  indicator makes that visible.
- Tailscale must be up on both ends. A down server is a row state, not a hang.

## 4. Screens

Mockups: `docs/proto/servers/mockup.html` (phone 390px and desktop 1280px, drawn on the app's
own palette). Approved 2026-11-07.

- **A · Settings › Servers**, in the **This server** group between Server and Share sestudio.
  Group "Using": first row is always "This machine" / "This phone" with an "In use" pill when
  local; one row per server with name, URL (mono), a state line (green Reachable · version ·
  round trip; red Not answering · last seen; amber Reachable but another version), and actions:
  "Use" (primary), "Check", "Remove" (desktop shows all three; the phone shows "Use" when
  reachable, "Check" otherwise, Remove by swipe or long press). "+ Add server" under the group.
  Group "This machine": this server's addresses (LAN, and Tailscale when up) with Copy, so the
  other side can add it. Opening the page checks every server.
- **B · Add server** sheet (dialog on desktop): Name, Address, "Check and add". A reachable
  server then shows the **Trust** sheet: state line, SHA-256 fingerprint to compare with the
  other machine's Servers page, "Trust and use" / "Not now". "Not now" keeps the row as "Not
  trusted" with a Trust button.
- **C · The "via <name>" chip** in the top card on every page while switched: phone under the
  title line, desktop before the "on N sources" text. Tapping it opens Settings › Servers.
- **D · Not answering**: pages that fail to load show one card, "<name> is not answering", last
  seen, a Tailscale hint, "Check again" and "Use this phone/machine". The chip stays, so a short
  drop recovers by itself.

## 5. Build plan

1. Server: config + `/api/servers` routes + check + trust (tests with `pytest-httpx`).
2. Server: forwarding middleware, streaming, local set, runtime switch (tests).
3. Frontend: Servers settings category, add sheet, check/retest, trust prompt.
4. Frontend: top card chip, error state "Switch back", data refetch on switch.
5. Test: PC → PC over Tailscale with Chromecast and LG DLNA; phone → PC on foreign Wi-Fi.

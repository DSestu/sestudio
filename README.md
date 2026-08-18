<div align="center">

# sestudio

**Watch, cast and download series and films from several streaming sites — from one library, on your own machine.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.11%20%7C%203.12-blue.svg)](https://www.python.org)
[![Run with uvx](https://img.shields.io/badge/run-uvx%20sestudio-purple.svg)](https://github.com/astral-sh/uv)

</div>

---

## Quick start

```bash
uvx sestudio
```

That is the whole install — [uv](https://github.com/astral-sh/uv) brings its own
Python, and ffmpeg ships in the wheel.

It prints two URLs:

| URL | Use it for |
| --- | --- |
| `http://<host>:8080` | Browsing, watching, downloading, DLNA |
| `https://<host>:8443` | Chromecast and AirPlay (they require HTTPS) |

The server keeps running in the terminal — downloads continue even after you
close the tab. Stop it with Ctrl-C.

> [!WARNING]
> There is no authentication. The default bind (`0.0.0.0`) makes the UI
> reachable from every device on your network, which is what casting needs — run
> it only on a network you trust, or pass `--host 127.0.0.1`.

---

## Contents

* [Why](#why)
* [Features](#features)
  * [Search across sites](#search-across-sites)
  * [Every version, from every source](#every-version-from-every-source)
  * [Watching](#watching)
  * [Watchers and notifications](#watchers-and-notifications)
  * [Downloading](#downloading)
  * [Your downloads, as a source](#your-downloads-as-a-source)
  * [Casting](#casting-1)
* [Sources and hosts](#sources-and-hosts)
* [Running it](#running-it)
* [Where it keeps things](#where-it-keeps-things)
* [Casting setup](#casting-setup)
  * [HTTPS and the certificate](#https-and-the-certificate)
  * [From a phone over Tailscale](#from-a-phone-over-tailscale)
  * [From outside your network (Funnel)](#from-outside-your-network-funnel)
* [Requirements](#requirements)
* [Development](#development)

---

## Why

Every streaming site carries a different slice of a title: one has the VF, one
has the VOSTFR that came out yesterday, one is simply up today. sestudio treats
them as one catalogue — it asks all of them, shows you what each has, and
switches between them for you when the version you want lives somewhere else.

---

## Features

### Search across sites

One query hits every enabled site, and listings of the same title from different
sites merge into one card. Sites can be turned off individually, and one can be
preferred so its listing wins a merge.

Seasons fold into a single result carrying the season count — a long-running
series takes one card, not twelve. The switch sits in the search toolbar and in
Settings.

### Every version, from every source

VF / VOSTFR / VO availability is collected from **all** the sites carrying a
title, not just the one you happen to be on — so a VOSTFR only one site has is
visible without going looking for it.

* The playlist marks each episode with the versions that exist, struck through
  where none does, and **lists episodes your language lacks** instead of hiding
  them.
* The sources panel shows every site as a row, with its versions and its hosts.
* Clicking a version plays it, moving to the site that has it if needed.
* When the open episode has nothing in the chosen language and another site does,
  it switches by itself — **language first**.

### Watching

Streams play through the server, so host referer/TLS quirks are handled for you.
Each episode is probed across every host it has, and a failing one falls back to
the next.

* The playlist shows the show's other **seasons as a tree**, loading only the one
  you open.
* **Watch state lives on the server** — position, watched flags, next-up — so it
  follows you between devices.
* Hosts carrying soft subtitles (vidzy, premium) hand them to the player as
  sidecar tracks. HLS alternate renditions (`#EXT-X-MEDIA`) are relayed
  untouched, so a multi-track stream exposes its menus by itself.

### Watchers and notifications

Saved criteria the server re-checks on a schedule. What it finds lands in
**Activity**, newest first, with an unread badge — and on Home, under *New for
you*.

Three ways to start one:

| Where | Watches |
|---|---|
| **Watch for new episodes**, next to a title | New episodes *and* new languages for that title |
| **Watch this search**, under the search bar | New results for those search words |
| **Watch for new releases…**, in Activity → Watchers | Genre + rating + vote count |

The language case is the point of the first one: a watcher reports **VF arriving
on an episode that already had VOSTFR**, because an item is identified by
*(episode, language)* rather than by episode alone.

**The first check never tells you anything.** It records what already exists, so
creating a watcher on a 200-episode series does not report 200 episodes — only
what turns up afterwards. Seen items are never un-seen either, so a listing that
briefly disappears and comes back is not reported twice.

**Genre/rating watchers wait until something can actually be watched.** A TMDB
match alone is not reported: a source has to carry the title first. Candidates
that nothing carries yet are parked and re-checked daily, so "any thriller rated
7+ with 500 votes" reports films you can watch, not films you can read about. A
vote floor does mean brand-new releases are reported a little later, once they
have been rated — which is why the release window defaults to three months rather
than a month.

Set **Download automatically** on a watcher and its findings are fetched as they
land. Those downloads run in a separate lane, capped well below the interactive
pool (`watcher_max_concurrent`, default 2), so background work never makes a
download you asked for wait.

Optionally, **WhatsApp** via [CallMeBot](https://www.callmebot.com/blog/free-api-whatsapp-messages/):
add a number and key under Settings → Notifications. One message per watcher per
check, listing what it found — a whole season arriving is a single message, not
twenty-four. Unofficial and rate-limited, but it needs no business account or
template approval. Activity records everything either way.

A watcher that keeps failing backs off, reports itself once, and switches off
after 20 consecutive failures rather than retrying forever. Senpai's rotating
domain is handled: item keys hold no hostname, and a stale page URL is re-pointed
at the current domain automatically.

Checks are spread out on purpose — at most five watchers per minute, sequentially,
and genre watchers confirm at most ten candidates per check. Set
`SESTUDIO_WATCHERS=0` to disable the background poller entirely; **Check now** in
the Watchers list still works.

### Downloading

To the server's disk, or straight to the device you are browsing from.

**The order to try is yours.** Rank sites and hosts by clicking them, in the
download window or in Settings: ranked entries are tried first, unranked ones
stay as fallback — an order changes what is *used*, never what is *possible*.
The shipped order is:

```
senpai › premium › uqload › vidzy › netu › voe
```

Senpai leads because it serves its own files, so there is no third-party host to
be down.

Files land in a per-language folder:

```
<output_root>/<Series Name>/Season 01/VOSTFR/S01E01 - Title.mp4
<output_root>/sestudio_films/VF/<Film Title>.mp4
```

The "already downloaded" check is per language, so the same episode in VF and in
VOSTFR are tracked separately.

### Your downloads, as a source

What is on disk is scanned into its own library and offered **beside** the
streaming sites — it plays straight from the file, with no host to resolve. A
file you placed by hand outside a language folder is listed under `other` rather
than being ignored.

### Casting

DLNA to any renderer on the network, plus Chromecast and AirPlay over HTTPS. The
player hands off both ways: cast from the position you are at, or pull a cast
back into the browser where the TV left off. See
[Casting setup](#casting-setup).

---

## Sources and hosts

**Sites** — where titles are found:

| Site | Id | Notes |
| --- | --- | --- |
| FStream | `fstream` | Live-action and anime |
| French-Manga | `french-manga` | Anime |
| Senpai Stream | `senpai` | Serves its own files — no third-party host to fail |

**Hosts** — where a stream is actually resolved from:

| Host | Resolved by |
| --- | --- |
| `uqload`, `vidzy`, `premium`, `netu`, `luluvid`, `filmoon`, `voe` | The shared provider registry |
| `senpai` | The site itself, as pre-signed files |

---

## Running it

```bash
uvx sestudio                       # no install
uvx sestudio --https_port 9443     # same, on another port
uv sync && uv run sestudio         # from a source checkout
```

`sestudio` starts the web UI — it is the only command.

| Flag | Default | Description |
| --- | --- | --- |
| `--host` | `0.0.0.0` | Bind address (`0.0.0.0` = reachable from your LAN) |
| `--http_port` | `8080` | HTTP port (browsing, DLNA, cast media fetch) |
| `--https_port` | `8443` | HTTPS port (Chromecast / AirPlay) |
| `--no_http` | off | Don't start the HTTP server |
| `--no_https` | off | Don't start the HTTPS server |
| `--no_resolve` | off | Skip live-domain auto-resolution |
| `-v`, `--verbose` | off | Debug logging |

---

## Where it keeps things

Everything lives in `~/.config/sestudio/`:

| File | Contents |
| --- | --- |
| `config.json` | Output folder, language, download destination, site and host ranking, TMDB key, notification channel |
| `library.db` | SQLite: watch state, watchlist and favourites, the downloaded-file manifest, watchers and their timeline |
| `tmdb_cache.json` | Metadata lookups, misses included |
| `cert.pem` | The self-signed HTTPS certificate |

> [!NOTE]
> **Metadata** — posters, ratings, synopses, cast and a "Trending this week" row
> come from [themoviedb.org](https://www.themoviedb.org). Released builds ship a
> default key, so `uvx sestudio` works with no setup. To use your own, set
> `TMDB_API_KEY` in the environment or save it in Settings; either takes
> precedence. Keys are free. The key is never sent to the browser, and builds
> from a source checkout have no default key — enrichment stays off there until
> you supply one.

---

## Casting setup

Start the server so other devices can reach it (this is the default):

```bash
uvx sestudio --host 0.0.0.0
```

| Target | Needs | Notes |
| --- | --- | --- |
| **DLNA** | Plain HTTP | The ⧉ button runs a ~4 s SSDP scan, then pushes the stream to the renderer you pick. Works with no extra flags. |
| **Chromecast / AirPlay** | HTTPS | The Cast Web Sender SDK refuses to run outside a secure context. Trust the certificate once, below. |

### HTTPS and the certificate

sestudio terminates HTTPS itself, with a self-signed certificate covering your
LAN IP — no reverse proxy needed.

```bash
uvx sestudio                # both: http://…:8080 and https://…:8443
uvx sestudio --no_https     # HTTP only
uvx sestudio --no_http      # HTTPS only
```

Trust `~/.config/sestudio/cert.pem` on whichever device uses the HTTPS site:

* **Desktop browser** — open the URL and accept the warning, or import the cert
  into the system trust store.
* **Android phone driving the cast** — install it as a user CA (Settings →
  Security → Encryption & credentials → Install a certificate → CA certificate).
  Until you do, the Cast button lists no devices.

### From a phone over Tailscale

Casting needs the TV to reach the sestudio server. If you are away from home and
reach the server over Tailscale, forward a port on the phone to the server's
Tailscale address and browse to the phone's LAN address: the TV connects to the
phone, and the phone forwards to the server.

1. Be connected to Tailscale.
2. Forward port `8443` from the phone's LAN IP to the server's Tailscale address.
3. Open `https://<phone-lan-ip>:8443` on the phone.

On Android, the phone's IP is behind a long press on the wifi widget, then the
"advanced info" icon next to the network name.

> [!TIP]
> [Funnel](#from-outside-your-network-funnel) avoids all of this — no port
> forwarding, no Tailscale on the phone or TV, and no self-signed cert.

### From outside your network (Funnel)

[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) publishes a port to the
public internet with a real, publicly-trusted certificate. Exposing the HTTPS
port is enough; the HTTP port need not be public.

```bash
# On the server, once: enable the funnel node attribute in the tailnet ACL
#   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]

tailscale funnel --bg --https=8443 https+insecure://localhost:8443
tailscale funnel status          # prints the public URL
```

Then open `https://<host>.<tailnet>.ts.net:8443` on the phone and cast as usual.

`https+insecure://` is required because sestudio's own certificate is
self-signed — it tells Funnel not to validate the upstream. Funnel presents its
own valid certificate outward, so clients see a clean HTTPS site.

> [!WARNING]
> Anyone with the URL can reach the server. There is no auth in front of it.

<details>
<summary><b>Things worth knowing before you fight it</b></summary>

* **Funnel only accepts public ports 443, 8443 and 10000.** Nothing else.
* `tailscale funnel 8443` means *public 443 → local 8443*, not 8443 → 8443. Pass
  `--https=8443` to preserve the port.
* `listener already exists for port 443` means that port has a `serve`
  (tailnet-only) entry. Inspect with `tailscale serve status`, clear it with
  `tailscale serve --https=443 off`. A port left as `serve` accepts the TCP
  connection from outside and then drops the TLS handshake — it looks like a
  broken certificate, but it is a missing funnel.
* Without `--bg` the proxy is foreground-only and dies with the command.

</details>

<details>
<summary><b>The public name does not resolve</b></summary>

Check it against more than one resolver before assuming the setup is wrong:

```bash
nslookup <host>.<tailnet>.ts.net 8.8.8.8
nslookup <host>.<tailnet>.ts.net 1.1.1.1
```

A resolver queried before the funnel existed can cache the `NXDOMAIN` for its
negative TTL while others answer correctly — `1.1.1.1` has been observed doing
this for well over an hour. Purge it at <https://1.1.1.1/purge-cache/> (A and
AAAA records), or use another resolver meanwhile.

</details>

---

## Requirements

[uv](https://github.com/astral-sh/uv) — that is the only thing you install.
Everything else is bundled: uv provides Python (3.11 or 3.12), and `yt-dlp` plus
a static `ffmpeg` ship as dependencies. A system `ffmpeg` on `PATH` is preferred
when present, giving a real `ffprobe` and fuller codecs. Node 18+ is only needed
to rebuild the frontend during development.

The wheel bundles a static ffmpeg, so it targets the platforms
[`imageio-ffmpeg`](https://github.com/imageio/imageio-ffmpeg) ships wheels for:

| OS | Arch |
| --- | --- |
| Linux | x86_64, arm64 |
| macOS | arm64 |
| Windows | x86_64 |

---

## Development

```bash
uv run pytest                      # backend tests
uv run sestudio --no_https         # backend for the dev proxy, HTTP on 8080

cd frontend
npm install
npm run dev                        # dev server, proxies /api to localhost:8080
npm run lint && npm test           # frontend checks
npm run build                      # commit the result — frontend/dist ships in the wheel
```

**Adding a site** means implementing `ContentSite` in `src/sestudio/sites/` and
registering it in `build_sites()`. Everything downstream — search, merging,
language detection, playback, downloads — works off that interface.

---

<div align="center">

MIT licensed · [LICENSE](LICENSE)

</div>

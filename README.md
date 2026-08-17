# sestudio

Download episodes from fstream — via CLI or a local web UI.

With astral uv installed, the server can be launched in a single command:

```bash
uvx sestudio
```

## Casting from a phone

Casting, in general, need the receiving TV to have access to the network address of the sestudio server.

If you are outside of your network, and use tailscale to access to your server, you will need to set up a port forwarding from your phone on your incoming wlan connections to your server's tailscale address.

> Simpler alternative: [Tailscale Funnel](#casting-from-outside-your-network-tailscale-funnel)
> gives the server a public HTTPS address, so neither the phone nor the TV needs
> Tailscale, port forwarding, or a trusted self-signed cert.

Then, you will have to connect on your phone browser to your your phone's local network address (that will be forwarded to your server).

By doing this, the TV will connect to your phone's local network address, and your phone will forward the stream to your server, making the cast work.

The server serves **HTTPS by default** (self-signed) on port `8443`, which is what
Chromecast/AirPlay require — no Caddy or reverse proxy needed. The certificate is
self-signed, so trust it once on the casting device (see [HTTPS built in](#https-built-in-default) below).

To sum this up, here are the steps to follow to have full casting functionality :

* Be connected to tailscale
* Having port `8443` forwarded from your phone lan ip to the server's tailscale address
* Connect to https://<phone-lan-ip>:8443 from your phone browser

The phone ip address can be easily found on Android by long pressing the wifi widget, and then clicking on "advanced info" icon next to the current wifi name.

## Casting from outside your network (Tailscale Funnel)

[Tailscale Funnel](https://tailscale.com/kb/1223/funnel) publishes a port on the
server to the public internet with a real, publicly-trusted TLS certificate. This
removes every awkward part of the phone-forwarding setup above: no port forwarding,
no Tailscale on the phone or TV, and **no self-signed cert to install** — the Cast
SDK gets the secure context it wants for free.

Exposing the HTTPS port is enough. Casting to a TV works with only `8443` funneled;
the HTTP port does not need to be public.

```bash
# On the server, once: enable the funnel node attribute in the tailnet ACL
#   "nodeAttrs": [{ "target": ["autogroup:member"], "attr": ["funnel"] }]

tailscale funnel --bg --https=8443 https+insecure://localhost:8443
tailscale funnel status          # prints the public URL
```

Then open `https://<host>.<tailnet>.ts.net:8443` on the phone and cast as usual.

`https+insecure://` is required because sestudio's own certificate is self-signed —
it tells Funnel not to validate the upstream. Funnel presents its own valid
certificate to the outside world, so clients see a clean HTTPS site regardless.

Things worth knowing before you fight it:

* **Funnel only accepts public ports 443, 8443 and 10000.** Nothing else.
* `tailscale funnel 8443` is shorthand for *public 443 → local 8443*, not
  8443 → 8443. Pass `--https=8443` explicitly if you want the port preserved.
* `listener already exists for port 443` means that port already has a
  `serve` (tailnet-only) entry. Inspect with `tailscale serve status` and clear it
  with `tailscale serve --https=443 off` before funneling it. A port left as
  `serve` rather than `funnel` accepts the TCP connection from outside and then
  drops the TLS handshake — it looks like a broken cert, but it is a missing funnel.
* Without `--bg` the proxy is foreground-only and dies with the command.
* **Anyone with the URL can reach the server.** There is no auth in front of it.

If the public name does not resolve, check it against more than one resolver before
assuming the setup is wrong:

```bash
nslookup <host>.<tailnet>.ts.net 8.8.8.8
nslookup <host>.<tailnet>.ts.net 1.1.1.1
```

A resolver that was queried before the funnel existed can cache the `NXDOMAIN` for
its negative TTL while others answer correctly — Cloudflare's `1.1.1.1` has been
observed doing this for well over an hour. Purge it at
<https://1.1.1.1/purge-cache/> (A and AAAA), or use another resolver meanwhile.

## Requirements

* [uv](https://github.com/astral-sh/uv) — that's the only thing you install.

Everything else is bundled: uv provides Python, and `yt-dlp` plus a static
`ffmpeg` ship as dependencies (a system `ffmpeg` on `PATH` is preferred when
present, giving a real `ffprobe` and fuller codecs). Node 18+ is only needed to
rebuild the frontend during development.

### Supported platforms

The wheel bundles a static ffmpeg, so it targets the platforms
[`imageio-ffmpeg`](https://github.com/imageio/imageio-ffmpeg) ships wheels for:

| OS | Arch |
| --- | --- |
| Linux | x86_64, arm64 |
| macOS | arm64 |
| Windows | x86_64 |

## Install / run

Run it directly, without installing (recommended):

```bash
uvx sestudio                  # web UI (default command)
uvx sestudio download <url>   # CLI
```

With no command, `sestudio` starts the web UI — `uvx sestudio --port 9000` is the
same as `uvx sestudio serve --port 9000`.

Or set up a source checkout for development:

```bash
uv sync
```

## Usage

### CLI — download a season

```bash
# All episodes, VF (default)
uv run sestudio download <season-page-url>

# Specific episodes, VOSTFR, custom output folder
uv run sestudio download <url> -e 1,3,5-8 --lang vostfr -o ~/Videos

# Dry-run: resolve URLs without downloading
uv run sestudio download <url> --dry-run
```

| Option | Default | Description |
| --- | --- | --- |
| `-e`, `--episodes` | all | Episodes to download, e.g. `1,3,5-8` |
| `--lang` | `vf` | Language (`vf` or `vostfr`) |
| `-o`, `--output` | `.` | Output directory |
| `-c`, `--concurrency` | `20` | Parallel downloads |
| `--provider` | `uqload` | Stream provider |
| `--dry-run` | off | Print resolved URLs, don't download |
| `--no-resolve` | off | Skip live-domain auto-resolution |
| `-v`, `--verbose` | off | Debug logging |

### Web UI

```bash
uv run sestudio serve
```

Starts **two servers** by default — `http://<host>:8080` and `https://<host>:8443` (self-signed cert). Open the **HTTP** one for hassle-free browsing and DLNA casting; open the **HTTPS** one for Chromecast/AirPlay (which require a secure context — trust the cert once, see below). The server keeps running in the terminal — downloads continue in the background even if you close the browser tab. Stop it with Ctrl-C.

| Option | Default | Description |
| --- | --- | --- |
| `--host` | `0.0.0.0` | Bind address (`0.0.0.0` = reachable from other devices on your LAN) |
| `--port` | `8443` | HTTPS port |
| `--http-port` | `8080` | HTTP port (DLNA / cast media fetch over plain HTTP) |
| `--no-http` | off | Don't start the HTTP server (HTTPS only) |
| `--no-https` | off | Don't start the HTTPS server (HTTP only) |
| `--no-resolve` | off | Skip live-domain auto-resolution |

> The default `0.0.0.0` binding makes the UI reachable from other devices on your network — needed for casting. There is no authentication, so run it only on a trusted home network. Pass `--host 127.0.0.1` to restrict it to the local machine.

**Features:**
* Search fstream, browse season cards with posters and language badges
* Expand seasons to episode level; cascading checkboxes (series → season → episode)
* Global language and output folder settings (persisted to `~/.config/sestudio/config.json`)
* Per-episode progress bars via SSE; downloads keep running after closing the browser tab
* **Play an episode in the browser** (▶ per row) — streams through the server, so provider referer/TLS quirks are handled for you, with automatic fallback across providers
* **Cast to a TV** (⧉ per row) — send an episode to any DLNA renderer on your network; Chromecast and AirPlay are available from the player when served over HTTPS (see below)
* **Continue Watching & Next Up** — the home screen resumes what you were watching (browser *or* cast progress counts), suggests the next episode per series, and marks watched episodes; remove an item with its ✕. Stored locally in the browser.
* **Web ↔ TV handoff** — the player's ⧉ button casts the current episode *from the current position*; "Watch here" on a cast pill pulls it back into the browser where the TV left off
* **Player niceties** — resume with "Start over", 5-second auto-next countdown with cancel, volume/speed remembered across episodes and reloads

* **Download to the server or to this device** — the confirm dialog offers both (default in
  Settings). Direct MP4 sources are relayed straight to the browser; HLS has no single file
  to relay, so it downloads as a normal server job (with full progress, provider fallback
  and retries) and the browser collects the finished file. Device files are staged in a
  temp dir and removed when you clear the download history.

> **Metadata:** results are enriched with posters, ratings, synopses, cast and a "Trending
> this week" row, via [themoviedb.org](https://www.themoviedb.org). Released builds ship a
> default TMDB key, so `uvx sestudio` works with no setup. To use your own key instead, set
> `TMDB_API_KEY=<your key>` in the environment or save it in Settings (it lands in
> `~/.config/sestudio/config.json`); either takes precedence over the built-in one. Keys are
> free. The key is never sent to the browser, and builds from a source checkout have no
> default key — there, enrichment stays off until you supply one.

> **Audio/subtitle tracks:** the streaming proxy passes HLS alternate renditions
> (`#EXT-X-MEDIA` audio/subtitle tracks) through untouched, so when a provider's
> stream carries multiple tracks the player's menus expose them automatically.
> In practice the current providers serve single-rendition streams, so the menus
> usually have nothing extra to show; side-loaded subtitles (e.g. OpenSubtitles)
> are not supported yet.

Downloads are organised automatically, with a per-language subfolder (VF / VOSTFR / VO):

```
<output_root>/<Series Name>/Season 01/VOSTFR/S01E01 - Title.mp4
<output_root>/sestudio_films/VF/<Film Title>.mp4
```

The "already downloaded" check is per-language, so the same episode in VF and VOSTFR
are tracked separately.

### Watch & cast on your network

Start the server so other devices can reach it (this is the default bind):

```bash
uvx sestudio serve --host 0.0.0.0
```

* **Google Cast (Chromecast)** and **AirPlay** need a **secure context (HTTPS)** — the Cast Web Sender SDK refuses to run over plain HTTP. sestudio serves HTTPS by default, so this works out of the box once you trust the cert (below).
* **In-browser player** and **DLNA "Cast to TV"** also work; the ⧉ button scans for renderers (a ~4 s SSDP scan) and pushes the stream to the one you pick. DLNA renderers fetch the media over plain HTTP, which the server always exposes on `--http-port` (8080) alongside HTTPS — so casting works without any extra flags.

#### HTTPS built in (default)

sestudio terminates HTTPS itself with a self-signed certificate covering your
LAN IP — no extra tools. By default it runs **both** an HTTP and an HTTPS server:

```bash
uvx sestudio serve                # both: http://…:8080 and https://…:8443
uvx sestudio serve --no-https     # HTTP only (:8080)
uvx sestudio serve --no-http      # HTTPS only (:8443)
```

The HTTPS certificate is self-signed (cached at `~/.config/sestudio/cert.pem`),
so a client that uses the HTTPS site must trust it once:

* **Desktop browser:** open the URL and accept the certificate warning, or import
  `~/.config/sestudio/cert.pem` into the system trust store.
* **Android phone driving the cast:** install `~/.config/sestudio/cert.pem` as a
  user CA (Settings → Security → Encryption & credentials → Install a certificate
  → CA certificate). Without trusting it, the Cast button won't list devices.

## Development

```bash
# Run tests
uv run pytest

# Backend for the dev proxy: plain HTTP on 8080 (the Vite proxy target)
uv run sestudio serve --no-https

# Frontend dev server (proxies /api to localhost:8080)
cd frontend && npm install && npm run dev

# Rebuild frontend (commit the result — frontend/dist ships in the wheel)
cd frontend && npm run build
```

## Providers

| Provider | Status |
| --- | --- |
| uqload | supported |
| vidzy | planned |
| netu / voe | out of scope (session-token protected) |

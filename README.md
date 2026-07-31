# fstream-dl

Download episodes from fstream — via CLI or a local web UI.

## Casting from a phone

Casting, in general, need the receiving TV to have access to the network address of the fstream-dl server.

If you are outside of your network, and use tailscale to access to your server, you will need to set up a port forwarding from your phone on your incoming wlan connections to your server's tailscale address.

Then, you will have to connect on your phone browser to your your phone's local network address (that will be forwarded to your server).

By doing this, the TV will connect to your phone's local network address, and your phone will forward the stream to your server, making the cast work.

DLNA casting works from the plain HTTP version of the server.

Chrome cast don't work from the plain HTTP version of the server. You will need to use the HTTPS version of the server.

Caddy can be used to create a small https reverse proxy on your server to its own local http port. It is launched if it is installed on your system.
The certificated won't be trusted by the browser, but at least the chrome cast feature will be available.

Currently, the `start.bat` script launch the http server on port 8081, and the https server on port 8443.

To sum this up, here are the steps to follow to have full casting functionality:

* Be connected to tailscale
* Having port 8081 and 8443 forwarded from your phone lan ip to the server's tailscale address
* Connect to https://<phone-lan-ip>:8443 from your phone browser

The phone ip address can be easily found on Android by long pressing the wifi widget, and then clicking on "advanced info" icon next to the current wifi name.

## Requirements

* Python 3.11+
* [uv](https://github.com/astral-sh/uv)
* [yt-dlp](https://github.com/yt-dlp/yt-dlp) in `PATH`
* Node 18+ (only needed to rebuild the frontend)

## Install

```bash
uv sync
```

## Usage

### CLI — download a season

```bash
# All episodes, VF (default)
uv run fstream-dl download <season-page-url>

# Specific episodes, VOSTFR, custom output folder
uv run fstream-dl download <url> -e 1,3,5-8 --lang vostfr -o ~/Videos

# Dry-run: resolve URLs without downloading
uv run fstream-dl download <url> --dry-run
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
uv run fstream-dl serve
```

Opens at `http://<host>:8080`. The server keeps running in the terminal — downloads continue in the background even if you close the browser tab. Stop it with Ctrl-C.

| Option | Default | Description |
| --- | --- | --- |
| `--host` | `0.0.0.0` | Bind address (`0.0.0.0` = reachable from other devices on your LAN) |
| `--port` | `8080` | Port |
| `--no-resolve` | off | Skip live-domain auto-resolution |

> The default `0.0.0.0` binding makes the UI reachable from other devices on your network — needed for casting. There is no authentication, so run it only on a trusted home network. Pass `--host 127.0.0.1` to restrict it to the local machine.

**Features:**
* Search fstream, browse season cards with posters and language badges
* Expand seasons to episode level; cascading checkboxes (series → season → episode)
* Global language and output folder settings (persisted to `~/.config/fstream-dl/config.json`)
* Per-episode progress bars via SSE; downloads keep running after closing the browser tab
* **Play an episode in the browser** (▶ per row) — streams through the server, so provider referer/TLS quirks are handled for you, with automatic fallback across providers
* **Cast to a TV** (⧉ per row) — send an episode to any DLNA renderer on your network; Chromecast and AirPlay are available from the player when served over HTTPS (see below)

Downloads are organised automatically:

```
<output_root>/<Series Name>/Season 01/S01E01 - Title.mp4
```

### Watch & cast on your network

Start the server so other devices can reach it (this is the default bind):

```bash
uv run fstream-dl serve --host 0.0.0.0
```

* **In-browser player** and **DLNA "Cast to TV"** work over plain HTTP on the LAN — nothing extra to set up. The ⧉ button scans for renderers (a ~4 s SSDP scan) and pushes the stream to the one you pick; the TV fetches it directly from this server.
* **Google Cast (Chromecast)** and **AirPlay** need a **secure context (HTTPS)** — the Cast Web Sender SDK refuses to run over plain HTTP. Put an HTTPS reverse proxy in front of the app.

#### HTTPS via Caddy (for Chromecast / AirPlay)

[Caddy](https://caddyserver.com/) can terminate HTTPS on your LAN IP with one command:

```bash
caddy reverse-proxy --from https://<lan-ip> --to 127.0.0.1:8080
```

Caddy mints a certificate from its own local CA. Browsers and cast devices won't trust it until that CA is installed:

* **On this machine:** `caddy trust` (adds Caddy's root CA to the system store).
* **On the casting device** (phone/laptop driving the cast, and where applicable the TV): install Caddy's root CA — find it at `caddy root-ca` / `$(caddy environ | grep XDG_DATA)/caddy/pki/authorities/local/root.crt` — and mark it trusted. Without this step the Cast button will not list devices.

Then open `https://<lan-ip>` instead of `http://<lan-ip>:8080`; the Cast and AirPlay controls appear in the player.

## Development

```bash
# Run tests
uv run pytest

# Frontend dev server (proxies /api to localhost:8080)
cd frontend && npm install && npm run dev

# Rebuild frontend
cd frontend && npm run build
```

## Providers

| Provider | Status |
| --- | --- |
| uqload | supported |
| vidzy | planned |
| netu / voe | out of scope (session-token protected) |

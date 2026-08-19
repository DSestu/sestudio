from __future__ import annotations

import logging
import sys
import threading

from fire import Fire
from rich.console import Console

from sestudio.logging_config import setup_logging
from sestudio.resolver import resolve_live_domain

console = Console()
logger = logging.getLogger(__name__)


def serve(
    host: str = "0.0.0.0",
    http_port: int = 8080,
    https_port: int = 8443,
    no_resolve: bool = False,
    verbose: bool = False,
    no_http: bool = False,
    no_https: bool = False,
) -> None:
    """Start the sestudio web UI as two full servers: plain HTTP and HTTPS.

    This is the default command: `sestudio` starts the web UI, and `sestudio -h`
    lists these options.

    By default both run on the same app — plain HTTP on --http-port and HTTPS
    (self-signed cert, covering the LAN IPs) on --https-port — so a client/renderer
    can use whichever it needs: DLNA and cast media fetch over HTTP, while
    Chromecast/AirPlay require the HTTPS site (trust the cert once; see README).
    Disable either side with --no-http or --no-https.
    """
    setup_logging(verbose)

    import uvicorn

    from sestudio.web.app import create_app

    live_domain: str | None = None
    if not no_resolve:
        try:
            live_domain = resolve_live_domain()
            logger.debug("Resolved live domain: %s", live_domain)
        except Exception as exc:
            logger.warning(
                "Domain resolution failed (%s), searches will use fstream.top", exc
            )

    app = create_app(live_domain=live_domain)
    shown = _display_host(host)

    # Both servers share one app so a proxy token minted on either site is
    # valid on the other. Cast media URLs prefer plain HTTP (renderers can't
    # use the self-signed cert), so point app.state.http_port at the HTTP one —
    # and leave it None when there is no HTTP server, so cast media falls back
    # to HTTPS rather than to an http:// URL on a TLS port that nothing can read.
    servers: list[tuple[str, uvicorn.Config]] = []
    app.state.http_port = None
    app.state.https_port = None
    if not no_http:
        servers.append(("http", uvicorn.Config(app, host=host, port=http_port)))
        app.state.http_port = http_port
    if not no_https:
        from sestudio.tls import ensure_cert

        cert_path, key_path = ensure_cert()
        servers.append(
            (
                "https",
                uvicorn.Config(
                    app,
                    host=host,
                    port=https_port,
                    ssl_certfile=str(cert_path),
                    ssl_keyfile=str(key_path),
                ),
            )
        )
        app.state.https_port = https_port

    if not servers:
        console.print("[red]Nothing to serve: --no-http and --no-https both set[/red]")
        sys.exit(1)

    for scheme, _cfg in servers:
        p = http_port if scheme == "http" else https_port
        console.print(
            f"[bold green]sestudio web UI[/bold green] → {scheme}://{shown}:{p}"
        )
    if not no_https:
        console.print(
            "[dim]HTTPS uses a self-signed cert — trust it on the casting device "
            "(see README). DLNA/plain browsing can use the HTTP site.[/dim]"
        )

    # Run all but the last server in daemon threads; the last runs in the main
    # thread so Ctrl-C (its signal handlers) stops the whole process.
    for _scheme, cfg in servers[:-1]:
        bg = uvicorn.Server(cfg)
        bg.install_signal_handlers = lambda: None
        threading.Thread(target=bg.run, daemon=True).start()
    uvicorn.Server(servers[-1][1]).run()


def _display_host(host: str) -> str:
    """A clickable host for the printed URL: a LAN IP when bound to all interfaces."""
    if host not in ("0.0.0.0", "::"):
        return host
    from sestudio.dlna import _local_ipv4s

    ips = _local_ipv4s()
    return ips[0] if ips else "localhost"


def main() -> None:
    argv = sys.argv[1:]
    # `serve` is the default (and only) command. Accept a leading `serve` token
    # as an optional, backward-compatible alias so `sestudio serve ...` and the
    # bare `sestudio` behave identically; otherwise Fire would bind the literal
    # "serve" to a positional flag (e.g. https_port="serve").
    if argv and argv[0] == "serve":
        argv = argv[1:]
    # Fire treats a bare `-h` as an ambiguous abbreviation of the h-prefixed
    # flags (host/http_port/https_port) rather than "help", so normalise it to
    # the unambiguous `--help`.
    argv = ["--help" if arg == "-h" else arg for arg in argv]
    Fire(serve, command=argv)

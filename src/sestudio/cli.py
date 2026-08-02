from __future__ import annotations

import logging
import sys
import threading
from pathlib import Path

from fire import Fire
from rich.console import Console
from rich.table import Table

from sestudio.downloader import check_yt_dlp, download_many
from sestudio.logging_config import setup_logging
from sestudio.models import Episode, StreamSource
from sestudio.providers.base import ProviderError
from sestudio.providers.uqload import UqloadProvider
from sestudio.resolver import rebase_url, resolve_live_domain
from sestudio.scraper import fetch_season

console = Console()
logger = logging.getLogger(__name__)


def parse_episodes(spec: str) -> set[int]:
    result: set[int] = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-", 1)
            result.update(range(int(start), int(end) + 1))
        else:
            result.add(int(part))
    return result


def _get_provider(name: str) -> UqloadProvider:
    if name == "uqload":
        return UqloadProvider()
    raise ValueError(f"Unknown provider: {name}. Available: uqload")


class Entrypoint:
    """sestudio — download and browse fstream episodes.

    Running `sestudio` with no command starts the web UI (`serve`).
    """

    def download(
        self,
        url: str,
        episodes: str | None = None,
        lang: str = "vf",
        output: str = ".",
        concurrency: int = 20,
        provider: str = "uqload",
        dry_run: bool = False,
        no_resolve: bool = False,
        verbose: bool = False,
    ) -> None:
        """Download episodes from an fstream season page URL."""
        if lang not in ("vf", "vostfr"):
            console.print(
                f"[red]Error:[/red] --lang must be 'vf' or 'vostfr', got '{lang}'"
            )
            sys.exit(1)

        setup_logging(verbose)

        if not dry_run:
            try:
                check_yt_dlp()
            except RuntimeError as exc:
                console.print(f"[red]Error:[/red] {exc}")
                sys.exit(1)

        output_dir = Path(output)
        output_dir.mkdir(parents=True, exist_ok=True)

        if not no_resolve:
            try:
                live_domain = resolve_live_domain()
                url = rebase_url(url, live_domain)
                logger.debug("Using live domain: %s", live_domain)
            except Exception as exc:
                logger.warning("Domain resolution failed (%s), using URL as-is", exc)

        console.print(f"[bold]Fetching season page…[/bold] {url}")
        try:
            season, all_episodes = fetch_season(url, lang=lang)
        except Exception as exc:
            console.print(f"[red]Error fetching season page:[/red] {exc}")
            sys.exit(1)

        console.print(
            f"Found [bold]{len(all_episodes)}[/bold] episodes for Season {season} ({lang.upper()})"
        )

        selected: list[Episode]
        if episodes:
            wanted = parse_episodes(episodes)
            selected = [ep for ep in all_episodes if ep.number in wanted]
            missing = wanted - {ep.number for ep in selected}
            if missing:
                console.print(
                    f"[yellow]Warning:[/yellow] episodes not found in {lang.upper()}: {sorted(missing)}"
                )
        else:
            selected = all_episodes

        if not selected:
            console.print("[yellow]No episodes to download.[/yellow]")
            sys.exit(0)

        stream_provider = _get_provider(provider)
        jobs: list[tuple[StreamSource, Path]] = []
        skipped = 0

        for ep in selected:
            embed_url = ep.embed_urls.get(provider)
            if not embed_url:
                console.print(
                    f"[yellow]Skip[/yellow] S{season:02d}E{ep.number:02d} — no {provider} URL"
                )
                skipped += 1
                continue
            try:
                source = stream_provider.get_stream_url(embed_url)
            except ProviderError as exc:
                console.print(
                    f"[yellow]Skip[/yellow] S{season:02d}E{ep.number:02d} — {exc}"
                )
                skipped += 1
                continue

            out_path = output_dir / ep.filename
            jobs.append((source, out_path))

        if dry_run:
            _print_dry_run_table(jobs)
            sys.exit(0)

        if not jobs:
            console.print("[yellow]Nothing to download.[/yellow]")
            sys.exit(0)

        console.print(
            f"\nDownloading [bold]{len(jobs)}[/bold] episode(s) with concurrency={concurrency}…\n"
        )
        results = download_many(jobs, concurrency=concurrency)

        ok = sum(1 for v in results.values() if v)
        fail = len(results) - ok
        console.print(f"\n[green]✓ {ok} downloaded[/green]", end="")
        if fail:
            console.print(f"  [red]✗ {fail} failed[/red]", end="")
        if skipped:
            console.print(f"  [yellow]⚠ {skipped} skipped[/yellow]", end="")
        console.print()

    def serve(
        self,
        host: str = "0.0.0.0",
        port: int = 8443,
        http_port: int = 8080,
        no_resolve: bool = False,
        verbose: bool = False,
        no_http: bool = False,
        no_https: bool = False,
    ) -> None:
        """Start the web UI as two full servers: plain HTTP and HTTPS.

        By default both run on the same app — plain HTTP on --http-port and HTTPS
        (self-signed cert, covering the LAN IPs) on --port — so a client/renderer
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
        # valid on the other. Cast media URLs must be plain HTTP (renderers can't
        # use the self-signed cert), so point app.state.http_port at the HTTP one.
        servers: list[tuple[str, uvicorn.Config]] = []
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
                        port=port,
                        ssl_certfile=str(cert_path),
                        ssl_keyfile=str(key_path),
                    ),
                )
            )
            if no_http:
                app.state.http_port = port

        if not servers:
            console.print(
                "[red]Nothing to serve: --no-http and --no-https both set[/red]"
            )
            sys.exit(1)

        for scheme, _cfg in servers:
            p = http_port if scheme == "http" else port
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


def default_argv(argv: list[str]) -> list[str]:
    """Insert the default `serve` command when none was given.

    Serving the web UI is the primary use, so `sestudio` and `sestudio --port
    9000` both start it. An explicit command still wins, and the bare help flags
    stay on the command group so `download` remains discoverable.
    """
    commands = [name for name in vars(Entrypoint) if not name.startswith("_")]
    if argv and (argv[0] in commands or argv[0] in ("-h", "--help")):
        return argv
    return ["serve", *argv]


def main() -> None:
    Fire(Entrypoint, command=default_argv(sys.argv[1:]))


def _print_dry_run_table(jobs: list[tuple[StreamSource, Path]]) -> None:
    table = Table(title="Dry run — resolved stream URLs")
    table.add_column("File", style="cyan")
    table.add_column("Provider", style="magenta")
    table.add_column("URL")
    for source, path in jobs:
        table.add_row(path.name, source.provider, source.url)
    console.print(table)

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
    """sestudio — download and browse fstream episodes."""

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
        no_resolve: bool = False,
        verbose: bool = False,
        no_https: bool = False,
        http_port: int = 8080,
    ) -> None:
        """Start the web UI server.

        Serves over HTTPS by default with a self-signed cert (cached, covering the
        LAN IPs) so Chromecast/AirPlay work with no extra tools; the casting device
        must trust the cert once (see the README). A plain-HTTP server also runs on
        --http-port because DLNA renderers fetch media over HTTP and can't use the
        self-signed cert. Pass --no-https to serve plain HTTP only, on --port.
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

        if no_https:
            app.state.http_port = port
            console.print(
                f"[bold green]sestudio web UI[/bold green] → http://{host}:{port}"
            )
            uvicorn.run(app, host=host, port=port)
            return

        from sestudio.tls import ensure_cert

        cert_path, key_path = ensure_cert()

        # DLNA renderers fetch the media over plain HTTP and can't use our
        # self-signed cert, so run an HTTP server alongside HTTPS and point cast
        # media URLs at it (app.state.http_port). Skip it only if the ports clash.
        if http_port != port:
            app.state.http_port = http_port
            http_server = uvicorn.Server(uvicorn.Config(app, host=host, port=http_port))
            # signal handlers only install in the main thread; the HTTPS server
            # (below) owns Ctrl-C and the process exits with it.
            http_server.install_signal_handlers = lambda: None
            threading.Thread(target=http_server.run, daemon=True).start()
        else:
            app.state.http_port = port
            logger.warning(
                "--http-port equals --port; DLNA casting needs a distinct HTTP port"
            )

        console.print(
            f"[bold green]sestudio web UI[/bold green] → https://{_display_host(host)}:{port}"
            + (
                f"  ·  media/DLNA on http://{_display_host(host)}:{http_port}"
                if http_port != port
                else ""
            )
        )
        console.print(
            "[dim]self-signed cert — trust it on the casting device (see README)[/dim]"
        )
        uvicorn.run(
            app,
            host=host,
            port=port,
            ssl_certfile=str(cert_path),
            ssl_keyfile=str(key_path),
        )


def _display_host(host: str) -> str:
    """A clickable host for the printed URL: a LAN IP when bound to all interfaces."""
    if host not in ("0.0.0.0", "::"):
        return host
    from sestudio.dlna import _local_ipv4s

    ips = _local_ipv4s()
    return ips[0] if ips else "localhost"


def main() -> None:
    Fire(Entrypoint)


def _print_dry_run_table(jobs: list[tuple[StreamSource, Path]]) -> None:
    table = Table(title="Dry run — resolved stream URLs")
    table.add_column("File", style="cyan")
    table.add_column("Provider", style="magenta")
    table.add_column("URL")
    for source, path in jobs:
        table.add_row(path.name, source.provider, source.url)
    console.print(table)

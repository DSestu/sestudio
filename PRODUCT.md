# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Responsive web app with a PWA manifest (`frontend/public/manifest.webmanifest`), used on both phones and desktop, plus casting to TVs.

## Users

Built for the maintainer's own use first, and published so others can self-host it with `uvx sestudio`. When the maintainer's needs and a general self-hoster's needs conflict, the maintainer's win.

Users run it on their own machine and reach it from devices on the same network (or over Tailscale): a phone on the couch, a desktop browser, a TV via DLNA / Chromecast / AirPlay.

## Product Purpose

sestudio treats several French-language streaming sites as one catalogue: it searches all of them, merges listings of the same title, shows which site has which version (VF / VOSTFR / VO), and plays, casts or downloads from whichever source has the version you want.

No single job dominates. A session can be any of:

- **Find and watch now:** search, pick the right version, play or cast right away.
- **Follow series:** next-up, resume across devices, watchers that report new episodes and new languages.
- **Build an offline library:** download to the server's disk or to the browsing device.

Success means the version you want plays without you hunting across sites for it.

## Positioning

Language-first aggregation across sites: availability is collected from every site carrying a title, an item is identified by (episode, language), and playback switches sites on its own to reach the chosen language. The local downloads library is offered as one more source beside the streaming sites.

## Operating Context

- Mostly evening use in a dim room: couch, TV, phone in hand.
- Streams are proxied through the server, which also handles host fallback, casting handoff (cast from the current position, pull back to the browser) and server-side watch state.
- Metadata (posters, ratings, cast, trending) comes from TMDB.
- Background watchers check on a schedule and land findings in Activity, optionally via WhatsApp (CallMeBot).

## Capabilities and Constraints

- Sites: FStream, French-Manga, KissKH (BFlix is listed in Discover). Hosts: uqload, vidzy, premium, netu, luluvid, filmoon, voe, kisskh.
- Users can rank sites and hosts; the ranking changes what is used first, never what is possible.
- No authentication today; trust is the network. The README warns about this.
- Terminology: **VF**, **VOSTFR**, **VO** for versions; **site** (where titles are found) vs **host** (where a stream is resolved from); **watcher**; **Activity**; **Next up**.
- Stack: Python server, React 19 + Vite + Tailwind 4 + daisyUI 5 frontend, Vidstack player. The server serves the committed `frontend/dist`.

## Brand Commitments

- Name: **sestudio** (lowercase). Assets: `frontend/public/sestudio-mark.svg`, `sestudio-wordmark.svg`, `favicon.svg`, app icons.
- Interface copy stays in English, even though the content is French-language.
- Dark-first: the dark theme is the primary one, designed for dim-room viewing.

## Evidence on Hand

- `README.md`: feature descriptions and rationale.
- `docs/RESEARCH-aggregator-ux.md`: market and feature study (Stremio, Jellyfin, Plex, JustWatch, Trakt).
- `docs/SPEC-search-page.md`: search page redesign spec.
- No testimonials, user counts or benchmarks exist; do not invent them.

## Product Principles

1. **Language first.** The version the user wants matters more than which site it lives on.
2. **One catalogue, not many sites.** Merge and route across sources; don't make the user compare sites by hand.
3. **Show what exists, including gaps.** List episodes the chosen language lacks instead of hiding them.
4. **Preferences order, never restrict.** Rankings and filters change what's tried first, not what's reachable.
5. **Quiet background work.** Watchers and auto-downloads never get in the way of what the user is doing now.

# Video Streaming Aggregator — UI/UX Feature Investigation

> Research compiled 2026-08-02. Forward-looking product study for evolving **sestudio**
> (currently a single-source `fstream` downloader + casting web UI) into a
> multi-source streaming aggregator platform.

## 0. Where sestudio is today (baseline)

- **One source** (`fstream`), CLI + local web UI.
- Resolves episodes, downloads via `yt-dlp`/`ffmpeg`, proxies streams.
- Casting to TV via **DLNA + Chromecast + AirPlay** (HTTPS self-signed on 8443, plus plain HTTP).
- No library, no metadata, no watch-progress, no discovery, no accounts.

The gap to a "many-functionality aggregator" is essentially **everything above the source
resolver**: a source abstraction, a metadata layer, a library/state layer, discovery, and a
first-class player. The good news is sestudio already owns the two hardest infra pieces most
aggregators bolt on last — **stream proxying** and **casting**.

---

## 1. The market: three philosophies to learn from

| Product | Model | What to steal |
|---|---|---|
| **Stremio** | Client + **addon protocol** — sources are external HTTP web services | The addon architecture (see §3). This is the single most important idea for a multi-source aggregator. |
| **Jellyfin** | Self-hosted media *server* over your own files, open source | Library management, rich metadata scraping, per-user watch state, transcoding, hardware accel, plugin ecosystem. Now the migration target since Plex paywalled remote streaming (mid-2026). |
| **Plex** | Polished server + cloud discovery layer | UX polish, "Plex Discover" universal watchlist/search across services, family sharing, cross-device resume. |
| **JustWatch / Reelgood** | Pure discovery/"where to watch" aggregators (no playback) | Universal search, availability-by-provider, watchlist, price/deep-link routing. |
| **Trakt** | Scrobbling + list/history sync backbone | The de-facto sync API — history, ratings, watchlists, "up next". Integrate rather than reinvent. |

**Key insight for aggregators specifically:** the hard UX problem is *surfacing content from many
providers without bias, clutter, or confusion*, and the #1 performance principle is **instant
playback** — users abandon within ~3 seconds if video doesn't start.

---

## 2. Feature landscape, prioritized

Grouped by domain, tagged **[MUST]** (table stakes), **[DIFF]** (differentiator worth doing early),
**[ADV]** (advanced/later).

### 2.1 Content sources & aggregation
- **[MUST]** Pluggable source abstraction — add/remove sources without touching core (see §3).
- **[MUST]** Per-source result labeling — show *which* source a stream came from, quality, size, language.
- **[DIFF]** Multiple streams per title ranked (quality, seeders/health, language, cached-or-not).
- **[DIFF]** Source health/status indicators (up/down/slow) and graceful per-source failure — one dead source must never break the page. *(You already hit this with the DLNA/HTTPS-only regression — same principle applies to sources.)*
- **[ADV]** Debrid/cached-stream integrations (Real-Debrid pattern) for instant, high-quality playback.
- **[ADV]** Source priority rules & auto-select best stream per user preferences.

### 2.2 Metadata layer
- **[MUST]** TMDB (and/or TVDB) integration: posters, backdrops, synopsis, cast/crew, genres, year, runtime, ratings, trailers.
- **[MUST]** Title matching / ID mapping (source result → canonical TMDB/IMDb id). This is the glue that lets many sources describe *the same* movie/episode.
- **[DIFF]** Collections / franchises, "more like this", cast-based browse.
- **[DIFF]** Localized metadata (FR/VF/VOSTFR is already your domain — lean into language-aware metadata).
- **[ADV]** Metadata caching + background refresh; manual metadata override/correction.

### 2.3 Library & watch-state (the retention engine)
- **[MUST]** **Continue Watching** row with resume position (server-side, cross-device).
- **[MUST]** **Next Up** — next unwatched episode per series.
- **[MUST]** Watched/unwatched flags, per-episode, with a "mark watched at X%" threshold (default ~90%, or end-credits marker).
- **[DIFF]** Watchlist / "Plan to watch", favorites, custom lists.
- **[DIFF]** Watch history + basic stats (time watched, most-watched genres).
- **[DIFF]** **Trakt scrobbling** (two-way sync) — cheap way to get history, watchlist, ratings, and "up next" without building it all.
- **[ADV]** Multi-user profiles with independent state; per-profile recommendations; kid/safe profiles.

### 2.4 Discovery & search
- **[MUST]** Universal search across all sources + metadata, with instant results and posters.
- **[MUST]** Browse rows: Trending, New, By genre, Continue Watching, Recommended.
- **[DIFF]** Filters & sort (genre, year, rating, language, quality available).
- **[DIFF]** "Where can I watch / which source has it" per title (JustWatch pattern).
- **[ADV]** Personalized recommendations (collaborative or content-based); AI/semantic search ("find the movie where…").
- **[ADV]** New-episode notifications / calendar of upcoming releases for tracked shows.

### 2.5 Player (make-or-break)
- **[MUST]** Fast start, HLS/DASH support, adaptive quality, keyboard controls, remember volume/quality.
- **[MUST]** **Subtitle support** — external + embedded, WebVTT/SRT, aggregated from multiple subtitle sources (OpenSubtitles pattern), per-user styling, sync/offset adjustment.
- **[MUST]** **Multi audio track** switching (VF/VO), multi subtitle track switching.
- **[DIFF]** **Skip intro / skip recap / skip credits** markers; **SponsorBlock**-style segment skipping for applicable content.
- **[DIFF]** Chapters, thumbnail scrubbing preview, playback speed.
- **[DIFF]** Auto-play next episode with a countdown / "still watching?".
- **[ADV]** PiP, Watch-together/sync playback, per-scene audio normalization.

### 2.6 Casting & playback targets *(your existing strength)*
- **[MUST]** Chromecast + AirPlay + DLNA (done) — but **unify** the media-URL construction so all three build URLs the same way. *(Your recent bugs came from Chromecast vs DLNA building URLs differently and hardcoded ports — a single "external media URL" resolver would kill that class of bug.)*
- **[DIFF]** Cast the *player state* (resume position, chosen subs/audio) not just the raw stream.
- **[DIFF]** Transcode-on-demand when the target can't play the codec/container.
- **[ADV]** Remote control of an active cast session from any device; cast queue.

### 2.7 Downloads / offline *(your existing strength)*
- **[MUST]** Keep the current download path; add a **download queue** UI with progress, pause/resume, retries.
- **[DIFF]** "Download season", quality selection, subtitle download alongside video.
- **[DIFF]** Downloaded items appear in the library with the same watch-state as streamed items.
- **[ADV]** Storage management (quota, auto-delete watched), bandwidth limits, scheduling.

### 2.8 Cross-cutting UX & platform
- **[MUST]** Responsive design; **TV/10-foot layout** with D-pad/remote navigation is a distinct mode, not just "big phone".
- **[MUST]** Fast perceived load: skeletons, poster lazy-loading, optimistic UI.
- **[MUST]** Accessibility: full keyboard operability, labeled controls (ARIA), captions, sufficient contrast.
- **[DIFF]** Dark/light theme; personalization of home rows.
- **[DIFF]** Onboarding that gets to first playback fast; add-a-source wizard.
- **[ADV]** Native/TV apps (Android TV, tvOS, webOS), PWA install, multi-language UI (FR/EN).

### 2.9 Accounts, sync, security
- **[DIFF]** Optional accounts so state syncs across devices (you're LAN/Tailscale today — a lightweight auth is enough).
- **[DIFF]** Settings sync; per-device vs per-user preferences.
- **[MUST]** Given the proxy/casting model: keep the **CORS + HTTPS + LAN-IP** handling robust (this is exactly where your current pain is). A single well-tested "how do I reach this server from that device" resolver underpins casting, remote access, and multi-device.

---

## 3. Recommended architecture: adopt the addon/source-provider model

The most valuable single decision is to model **sources as a uniform provider interface**, exactly
like Stremio's addon protocol. Stremio addons are just HTTP services that answer four resource types:

- **catalog** → browsable lists (feeds the Discover/home rows)
- **meta** → full details for one item (description, cast, episode list)
- **stream** → the selectable playback sources for a given item/episode
- **subtitles** → subtitle files for a title

Each provider ships a **manifest** declaring which resources + content types it supports; the core
loads catalogs/meta/streams from *all* installed providers and merges them. Benefits:

- New sources = implement an interface, zero core changes.
- Sources can be **in-process plugins** or **remote services** — you can even become
  Stremio-addon-compatible and instantly gain an ecosystem.
- Natural failure isolation: a provider that 500s just drops out of the merge.
- Clean seam for testing (mock providers) and for the metadata layer (metadata is "just another
  provider" of `meta`/`catalog`).

**Suggested internal contract (adapt to Python):**
```
Provider.manifest()                         -> capabilities, content types, id prefixes
Provider.catalog(type, id, extra)           -> [MetaPreview]
Provider.meta(type, id)                      -> MetaDetail (+ episodes)
Provider.streams(type, id)                   -> [Stream]  (quality, lang, size, url, source label)
Provider.subtitles(type, id, extra)         -> [Subtitle]
```
Wrap the current `fstream` logic as the **first provider**. Add TMDB as a **metadata provider**.
The library/watch-state/casting/player layers sit *above* this and are source-agnostic.

Layering:
```
  UI (web / TV / PWA)
    └─ Player · Casting · Downloads   (source-agnostic)
        └─ Library & Watch-State (+ optional Trakt sync)
            └─ Metadata layer (TMDB matching, caching)
                └─ Source Provider registry  ← fstream, others, subtitle providers…
                    └─ Stream proxy + "external media URL" resolver  (existing strength)
```

---

## 4. Suggested phased roadmap (tailored to sestudio)

**Phase 1 — Foundations that unlock everything**
1. Extract the source-provider interface; refactor `fstream` into `Provider #1`.
2. Add TMDB metadata + title→id matching.
3. Server-side watch-state store (positions, watched flags) → **Continue Watching** + **Next Up** rows.
4. Unify the "external media URL" resolver so DLNA/Chromecast/AirPlay share one code path *(fixes your current bug class)*.

**Phase 2 — Aggregator UX**
5. Universal search + browse rows (metadata-driven).
6. First-class player: subtitle + multi-audio switching, resume, auto-next.
7. Download queue UI; downloaded items join the library.

**Phase 3 — Differentiators**
8. Second/third real source provider → prove the abstraction; per-stream source labeling & ranking.
9. Trakt two-way sync (history/watchlist/ratings for near-free).
10. Skip-intro/credits markers, thumbnail scrubbing.

**Phase 4 — Platform & scale**
11. Multi-user profiles + optional lightweight auth for cross-device sync.
12. TV/10-foot layout + remote navigation; PWA.
13. Recommendations, subtitle-provider aggregation, debrid/cached-stream support.

---

## 5. Watch-outs specific to your stack

- **URL/port/CORS is your recurring failure mode.** Casting bugs keep tracing back to media-URL
  construction (hardcoded port 80 in `_local_ip_for`, `http_port` logic breaking under `--no-http`,
  Chromecast vs DLNA building URLs differently). Consolidate into one resolver **before** adding
  more playback targets, or every new source/target multiplies the combinations.
- **Instant playback beats features.** Prioritize time-to-first-frame (stream pre-resolution,
  caching resolved URLs) over breadth.
- **Legal/ToS framing.** A multi-source aggregator invites the same scrutiny as Stremio addons —
  keep the core source-agnostic and let sources be user-added/pluggable rather than bundled.
- **Don't rebuild Trakt/TMDB.** Integrate the standards; spend your effort on the source
  abstraction, the player, and casting — the places you're already differentiated.

---

## Sources
- [Streaming App UX Best Practices: 7 Pillars (2026) — Fora Soft](https://www.forasoft.com/blog/article/streaming-app-ux-best-practices)
- [OTT Aggregators in 2026 — Vodlix](https://vodlix.com/blog/ott-aggregators)
- [UX Design for Video Content 2026 — AdSpyder](https://adspyder.io/blog/ux-design-for-video-content/)
- [Plex vs Jellyfin 2026 — Homedock](https://www.homedock.cloud/blog/self-hosting/plex-vs-jellyfin-2026/)
- [Top Plex Alternatives 2026 — RapidSeedbox](https://www.rapidseedbox.com/blog/plex-alternatives)
- [Stremio Addon SDK — protocol.md](https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/protocol.md)
- [Exploring Stremio's Addon Architecture — Medium](https://mergenc.medium.com/exploring-stremio-from-add-on-architecture-to-the-streaming-service-daeade24e1cd)
- [scrob — self-hosted media tracking (Jellyfin/Plex/Emby sync)](https://github.com/ellite/scrob)
- [Plex Library metadata & watched thresholds — Plex Support](https://support.plex.tv/articles/200289526-library/)
- [Reelgood vs JustWatch vs Plex — TechHive](https://www.techhive.com/article/1428635/reelgood-vs-justwatch-vs-plex-battle-of-the-streaming-guides.html)
- [JustWatch / Letterboxd / Trakt watchlist comparison — TWiT](https://twit.tv/posts/tech/justwatch-letterboxd-trakt-which-app-should-you-use-manage-your-watchlist)
- [SponsorBlock advanced skip options](https://wiki.sponsor.ajay.app/w/Advanced_skip_options)
- [Able Player — accessible HTML5 media player](https://ableplayer.github.io/ableplayer/)
- [Vidstack Player (HLS/DASH, chapters, captions)](https://vidstack.io/)

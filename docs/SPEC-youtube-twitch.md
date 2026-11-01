# Spec: YouTube and Twitch

> Agreed through mockups, 2026-11-01. Decisions: all three jobs (paste a link, follow creators,
> archive Twitch), **no accounts**, and playback through **yt-dlp streams** (not the YouTube embed).
> Channel names in the mockups were *invented*.

## 1. Why

A video from a creator you follow means opening another app, with its ads, and no way to cast it
from here or keep a copy. Twitch deletes past broadcasts after 7–60 days, so a missed stream is gone.
sestudio already has the parts: yt-dlp, the stream proxy, the download queue, watchers, Activity
and casting.

## 2. Goals

1. **Paste a link, get Play / Download / Follow** in the existing search bar (phone: bottom sheet).
2. **Follow a channel like a show**: videos are episodes, so watched state, Next up and auto-download carry over.
3. **Know who is live**, and watch, cast or record it.
4. **Archive Twitch VODs** automatically before Twitch deletes them.
5. No account, no API key, no Google Cloud project.

### Non-goals

- Signing in to Google or Twitch, Watch Later, comments, live chat.
- Searching Twitch (yt-dlp can't do it without the API). You follow a Twitch channel by name or link.
- Mixing videos into **Everything** search results. They get their own **Videos** kind.
- SponsorBlock, Shorts, members-only videos.

## 3. How it maps onto what exists

| Concept | Existing piece | How |
|---|---|---|
| YouTube, Twitch | `ContentSite` (`sites/base.py`) | Two new sites, `youtube` and `twitch`, that override `resolve_candidate` the way UniqueStream does |
| A video | `Episode` | One `Episode`, `embed_urls={"yt-dlp": url}`, `langs=["vo"]` |
| A channel | `PageResult` | `fetch_page(channel_url)` returns its videos as episodes, newest first, `season=0` |
| New video / went live | Watcher kinds (`watchers/kinds.py`) | New kinds `channel_videos` and `channel_live` |
| Auto-download / archive | `watchers/autodownload.py` | Unchanged, works on the new kinds |
| Recording a live stream | Download queue | yt-dlp records live HLS from now on; the job ends when the stream ends |

## 4. Playback (yt-dlp streams)

Checked on 2026-11-01:

- **Twitch** live and VODs are HLS, so they play through the existing proxy and hls.js unchanged.
- **YouTube** with yt-dlp 2026.03.17 only had one file with sound and picture together (360p, format 18),
  and everything above that came as separate DASH files. With **yt-dlp 2026.10.26 and a JS runtime**,
  YouTube also returns an **HLS master** (`manifest.googlevideo.com/.../hls_variant/...`): H.264 from
  144p to 1080p, VP9 up to 2160p, and audio as `EXT-X-MEDIA` groups. It plays through the existing
  proxy like Twitch (verified: 2160p60 in the browser player, with the quality picker).

So `stream_url()` takes the HLS master whenever yt-dlp lists one and only falls back to a single muxed
file without it. The `sidx` → HLS playlist idea from the first draft isn't needed.

- **URL expiry:** googlevideo URLs last about 6 hours. The resolution is cached for 4 hours.
- **VP9:** Chrome plays the VP9 variants. Chromecast, Safari and many TVs can't, so PR 3 drops the VP9
  variants from the master as it passes through the proxy (a `proxy_fix` transform).
- **DLNA:** many TVs can't play fMP4 HLS with a separate audio track. *To confirm on your TV.*
- **Downloads** give yt-dlp the page itself (`StreamSource.extract_url`), so it picks and merges the best
  H.264 + AAC ≤ 1080p.

### JS runtime

YouTube extraction now needs a JavaScript runtime. yt-dlp only enables Deno by default and warns
otherwise. The live Windows machine has Node (`C:\Program Files\nodejs\node.exe`) but no Deno. Rule:
pass `--js-runtimes node` when Deno is missing and Node is on PATH, and show a warning in Settings
when neither is there.

## 5. Following without an account

| | New videos | Live now |
|---|---|---|
| YouTube | Channel RSS `youtube.com/feeds/videos.xml?channel_id=…` (last 15 videos, free, one HTTP GET) | yt-dlp on `youtube.com/channel/<id>/live` |
| Twitch | yt-dlp `--flat-playlist` on `twitch.tv/<name>/videos` | yt-dlp on `twitch.tv/<name>` (only succeeds while live) |

- Live checks every 2 min, new videos every 15 min (reusing the poller). One yt-dlp call takes about 1–2 s, which is fine for a few dozen channels.
- **Import:** upload Google Takeout's `subscriptions.csv` to follow every YouTube channel in it. For Twitch, paste names or links (one per line).
- The VOD "expires in Xd" from the mockup is **dropped**: without the API there is no reliable expiry date. Auto-archive instead.

## 6. UI

See the mockups in the 2026-11-01 discussion. Summary:

| Where | Desktop | Phone |
|---|---|---|
| Paste a link | Card under the search bar: thumbnail, title, channel, **Play · Download · quality · Follow** | Bottom sheet: **Watch · Cast · Record (live) · Follow** |
| Discover | New **Creators** group under Video sources: YouTube, Twitch, with new/live counts | Same, in the Discover menu |
| Channel page | Header (avatar, name, Following, Auto-download toggle), tabs Videos / Past streams, 16:9 grid with progress bars | Same header, video rows with the thumbnail on the left |
| Home | **Live now** strip above New for you | Same; the tab bar stays at 6 |
| Search | New **Videos** kind (YouTube search through `ytsearch20:`) | Same pill |

16:9 thumbnails throughout, not posters. VF/VOSTFR chips are hidden for these sources (`vo` only).

## 7. Risks

- **YouTube breaks yt-dlp every few weeks.** The pinned 2026.03.17 already warns it is "older than 90 days".
  `uvx` installs stay on whatever version they got. A follow-up could add a version check in Settings.
- Downloading from YouTube breaks its terms of service. Add one line to the README.
- Browser cookies are never passed to yt-dlp (that risks a ban on the Google account).

## 8. Plan (one PR each, in order)

| # | PR | Size |
|---|---|---|
| 1 | yt-dlp JS-runtime detection + Settings warning; bump yt-dlp | S |
| 2 | `youtube` + `twitch` sites: resolve a pasted video/live URL, play Twitch through the proxy, download through the queue | M |
| 3 | Drop the VP9 variants from YouTube's HLS master for Chromecast/TVs; video labels in the player | S |
| 4 | Search bar URL detection: desktop card + phone bottom sheet | M |
| 5 | Channel pages (`fetch_page` on a channel URL), 16:9 grid / rows | M |
| 6 | Watcher kinds `channel_videos` + `channel_live`, Follow button, Creators group in Discover | M |
| 7 | Live now strip on Home, Record button (live download job) | S |
| 8 | Auto-archive for Twitch VODs, Takeout CSV import, Twitch name import | S |
| 9 | Videos kind in search (`ytsearch20:`) | S |

PRs 1–4 cover paste a link, 5–8 cover following and archiving, and 9 adds search.
Rough total: 5–8 days of work.

## 9. Files this touches (starting points)

`src/sestudio/sites/` (new `youtube.py`, `twitch.py`, register in `__init__.py`),
`src/sestudio/sites/creators.py`, `src/sestudio/downloader.py` (JS runtime flag, `extract_url`), `src/sestudio/watchers/kinds.py` + `poller.py`,
`frontend/src/components/SearchBar.tsx`, `frontend/src/views/HomeView.tsx`,
`frontend/src/components/discover/DiscoverMenu.tsx`, `frontend/src/components/watch/VideoPane.tsx`.

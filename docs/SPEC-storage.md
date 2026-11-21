# Spec: storage, more than one place your files live

> Draft, 2026-11-21. Approach **A** picked: every storage is a folder the OS can open (a local
> disk, a UNC share `\\nas\media`, an rclone mount of an FTP/SFTP server). The app gets no
> protocol code; it learns that files live in **several** folders instead of one.
> Stories first (§2); screens get drawn from them once the stories are agreed.
> Naming: Settings already has **Sources & search** (content sites), so this feature is **Storage**.

## 1. Why

- **One root for video.** `AppConfig.output_root` is the only folder the Downloaded browser,
  HLS, cast, DLNA, thumbnails and downloads know (`downloaded.resolve(cfg.output_root, path)`).
- **Two registries.** Music has its own list (`music_libraries`: `local_folder`,
  `remote_sestudio`, `ytmusic_account`), where `local` is that same `output_root`. A NAS added
  for music is invisible to video.
- **Path is the id.** A downloaded file is known by its path relative to the one root: in the
  API (`?path=`), the `downloaded_files` table, the thumbnail/HLS/subtitle cache keys and the
  four Downloaded components. Two folders holding `Show/S01E01.mkv` would be the same file.

## 2. User stories

Numbered so feedback can point at them. **Who:** the owner of the server, on a phone or a
desktop; family members just watching.

### Adding and managing

- **S1.** As the owner, I add a NAS share (`\\nas\films`) as a storage, so its films show up in
  Downloaded next to the ones on this PC.
- **S2.** I add an FTP server I already mount with rclone (`M:\` or `/mnt/ftp`), the same way:
  it is just a folder to the app. The add screen tells me how to mount one when the protocol
  isn't a folder yet (a short help link, not a wizard).
- **S3.** I pick the folder with the existing folder browser (drives, `/mnt`, home…) or paste a
  path; a path that does not exist or cannot be read is refused with the reason.
- **S4.** I name each storage ("NAS films", "This PC") and can rename it later.
- **S5.** I say what each storage holds: **video**, **music**, or both. A music-only folder does
  not flood Downloaded with mp3s; a video-only one does not show in the Music page.
- **S6.** I remove a storage. Its files are never touched; they just stop being listed.
  Watch progress is kept (it is keyed by title, not by file), so adding it back restores it.

### Downloading

- **S7.** I choose which storage new downloads go to (one at a time). Default: the one that
  exists today, so nothing changes until I change it.
- **S8.** When the download storage is offline or full, a download fails with that reason
  before it starts, not halfway through, and Home's health widget says so.

### Watching and listening

- **S9.** I browse Downloaded knowing which storage I'm on: the storage is a visible level
  (pick one, or see all with each title marked), not merged away. *(Changed 2026-11-21: "I want
  to be able to browse with the knowledge of which storage I'm on".)*
- **S10.** The storage stays concrete everywhere: its name and real location are shown, not
  hidden behind an abstraction. *(Changed 2026-11-21: "not too much abstraction on what is the
  storage".)*
- **S11.** Everything that works on a local file works on a storage file: play, HLS quality,
  audio and subtitle tracks, thumbnails, cast, DLNA, AI frames, delete (when allowed).
- **S12.** Music libraries are storages with the music role: what Settings › Music lists today
  keeps working, with the same track ids, analysis, playlists and queue.

### When a storage is away

- **S13.** When the NAS is off, the app does not hang: listings come back at once with the
  files of the storages that answer, and the NAS shows **Offline since 21:04**.
- **S14.** Its titles do not vanish from Downloaded while it is offline; they show greyed
  with "on NAS films, offline", so I know they exist and why they won't play.
- **S15.** When it comes back, it is picked up without a restart.

### Phase 2 (were "not in scope"; all wanted, see §7)

- **X1.** Speaking FTP/SMB/SFTP from inside the app, including on Android.
- **X2.** Copying or moving files between storages.
- **X3.** Remote sestudio servers and YouTube Music as *video* storages.
- **X4.** Per-storage credentials (in phase 1, Windows keeps SMB ones and rclone keeps FTP ones).

## 3. What is decided (proposed, from the stories)

| Topic | Decision |
|---|---|
| Model | One list `storages` in the config: `{id, kind, label, path, roles: ["video","music"], download: bool}`. Kinds: `folder` (any path the OS opens), plus the music-only `remote_sestudio` and `ytmusic_account` moved from `music_libraries`. |
| Migration | On load, built from `output_root` (id `local`, roles video+music, download target) and `music_libraries` (same ids, role music). The old keys are still read and still written until the last PR, so a downgrade keeps working. No DB rewrite. |
| Identity | A file is `(storage, path)`. Every `/api/downloaded/*` route takes `storage`, default `local`. `downloaded_files` rows of other storages are keyed `storage:path`; `local` rows keep their bare path. Cache keys hash the storage in, except `local`. Music `track_id` already hashes its library in: unchanged. |
| Offline | Each storage is checked off the request thread with a 3 s timeout (an unreachable UNC path can block `is_dir()` for 20–60 s). Listings never wait on a storage that is offline or still being checked; they use its last listing. |
| Scan | `local` keeps today's 10 s cache. Other folder storages: 60 s, refreshed in the background, last listing kept on disk (`config_dir()/storage/<id>.json`) so S14 works after a restart. |
| Browsing | S9: one storage at a time through the header switcher (§8.1); **All storages** groups titles by folder name across storages, as today inside one root. |
| Settings | A **Storage** category (Server group) of disk cards (§8.2), replacing the "Folder on the server" field in Downloads and the libraries list in Music (Music links to it). Built on the existing folder browser (`music/folders.py`, `AddLibrary`). |

## 4. Building blocks that already exist

- `music/libraries.py`: registry, add/rename/remove, offline state for remotes, `folder_roots()`.
- `music/folders.py` + `GET /api/music/folders`: the folder browser with drives and mounts.
- `downloaded.resolve(root, relative)`: the one confinement check; it gains a storage lookup.
- `downloaded.audio_files(root, library)`: already library-aware track ids.
- Watch state keyed by title/season/episode (S6, S14 for free).

## 5. Traps

- **UNC under a Windows service.** The live server must see the share with the account it runs
  as; checked in PR 1 against the live machine (read only) before anything else is built.
- **Confinement per storage.** `resolve()` must confine to the storage's own root; a `storage`
  value is looked up in the registry, never used as a path.
- **Same relative path in two storages** must stay two files everywhere (keys, caches, React
  keys in `DownloadedBrowser`/`DownloadedTree`).
- **`runner.kick(output_root)`** has ~7 callers; it becomes "kick every music storage".
- **Live server.** Config gains a key; the old ones stay. Restart needed for new routes.

## 6. Build plan (PRs)

1. **Registry.** `storages` in config + migration + `storage.py` (list, get, add, rename,
   remove, roles, download target); `music/libraries.py` reads through it. Backend only.
   Includes the UNC check on the live machine.
2. **Identity.** `resolve(storage, path)`, `storage` param on every `/downloaded/*` route,
   `downloaded_files` keys, cache keys. `local` behaves exactly as today.
3. **Listing + switcher.** Scan every video storage; files carry `storage`; the header
   switcher (§8.1, desktop menu + phone pill), All storages, storages as Tree roots; the four
   Downloaded components and `api.ts` pass `storage` through; storage name in the files modal.
4. **Away.** Background checks with timeout, longer cache, listing kept on disk, offline state
   and greyed titles (S13–S15).
5. **Settings › Storage.** Disk cards and the add form (§8.2): add, rename, remove, roles,
   download target (S1–S7), mobile + desktop.
6. **Downloads.** Write to the target storage; fail early when offline or full; health widget
   per storage (S7, S8).

## 7. Answers (2026-11-21, story review)

- S1–S8, S11–S15 kept as written; S9, S10 changed (above).
- **Q1.** Offline titles stay, greyed out.
- **Q2.** A new storage asks what it holds when added.
- **Q3.** One download target.
- **X1–X4: all wanted**, so §2's "Not in scope" is no longer out of scope: in-app FTP/SMB/SFTP
  (incl. Android), copy/move between storages, remote servers and YouTube Music as video
  storages, per-storage credentials.
- **Phasing:** A first (§6, PRs 1–6), then **phase 2** on the same `storages` model: in-app
  FTP/SMB/SFTP incl. Android (X1) with per-storage credentials kept out of `config.json` (X4),
  copy/move between storages (X2), remote servers and YouTube Music as video storages (X3).
  Phase 1 must not block phase 2: `kind` stays open-ended and `resolve()` stays the one place a
  storage file becomes something ffmpeg can read.

## 8. Screens (mockups round 1, 2026-11-21)

Picked from phone + desktop mockups built on the real app (no notes added). The page is kept at [`docs/proto/storage/mockups-round1.html`](proto/storage/mockups-round1.html) (a page fragment: open it through any static server; saving answers needs the scratch review server and is not part of it).

### 8.1 Media › Collection: **C, storage switcher in the header**

| Topic | Decision |
|---|---|
| Model | You are always *on* one storage, like a drive. The header reads `Media` then a switcher `[icon] This PC  R:\Video\films-series ▾`. |
| Menu | Each storage with its icon, name, title count (or "offline since 21:04" in red) and full path in monospace; a divider; **All storages** with the total. The current one is highlighted. |
| Phone | The switcher is a full-width pill under the title row of the header card, above Collection / Queue. |
| Grid / Details / Browse | Show the selected storage only; the count reads `1,116 titles on This PC`. **All storages** shows every storage's titles (how a title on two storages shows there is a detail for PR 3: one card, both storage names in its meta line). |
| Tree | The storages are the top-level roots (icon, name, path), their folders under them; an offline storage is a greyed root marked "offline". |
| Offline | Its titles stay, greyed (Q1); picking it shows its last listing greyed, with the offline time. |
| Remembered | The selected storage persists per device, like the layout. Default: the download target. |

### 8.2 Settings › Storage: **SB, disk cards**

| Topic | Decision |
|---|---|
| Place | A **Storage** category in the Server group, first. Desktop: category list left, two columns of cards right; phone: one column. |
| Card | Icon + name + state dot (or "Offline since …" pill); full path in monospace; a capacity bar (used / total) with `N titles` and `X free of Y`; **Video** / **Music** toggles; a radio **Send downloads here** (the target reads "New downloads go here" and the card has a green outline). |
| Add | **+ Add a storage** under the cards opens the add form: folder (path field + Browse, checked live: "Found · 412 folders · 5.8 TB free"), name, **What does it hold?** Video / Music / Both with no default (Q2), "Send new downloads here", Cancel / Add storage. A line links how to mount FTP/SFTP with rclone. |
| Edit | Rename and Remove from the card (a menu on the card; remove asks in the page, files untouched). |
| Replaces | The "Folder on the server" field in Settings › Downloads and the Libraries list in Settings › Music (both link here). |

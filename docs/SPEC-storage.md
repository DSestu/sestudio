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

## 9. Phase 2 (decided 2026-11-21)

Phase 1 (PRs 1–6, #571–#576) shipped. Answers to the phase 2 questions:

| Topic | Decision |
|---|---|
| X1 playback | A **local HTTP relay**: the server reads a remote file over its protocol and serves it on its own byte-range URL, `GET /api/storages/{id}/raw/{path}`. ffmpeg (HLS, TV, thumbnails, tracks, subtitles), cast, DLNA and the browser all read that URL, so seeking works the same for every protocol. Libraries: `fsspec` with `smbprotocol` (SMB) and `paramiko` (SFTP); FTP is fsspec's own (stdlib `ftplib`). |
| X4 passwords | A **`secrets.json`** beside `config.json` (owner-only permissions on POSIX), keyed by storage id, never sent to a client, removed with its storage. Existing share tokens stay where they are (the downgrade mirror needs them). |
| X3 | **Another sestudio's films**: a `remote_sestudio` storage may hold video. The other server shares its video listing and files behind the same share tokens; this one lists them (kept like any other listing) and plays them through the relay. YouTube Music stays music-only. |
| X2 | Copy / move between storages from a title's **files list** and from **Tree and Browse** (files and folders), as jobs in Media › Queue. **Mockups first.** |

### 9.1 How a remote file reaches ffmpeg

`resolve()` stays the one place a stored file becomes something readable. For a
folder it is a `Path`, as now. For `ftp`, `sftp`, `smb` and a remote sestudio it
is a `RemoteFile`: a pure POSIX path (name, suffix, stem work as before) whose
`str()` is the relay URL on this server's own HTTP port, whose `stat()` answers
from the listing (size, mtime: the cache keys), and whose parent lists the remote
folder (sidecar subtitles). Nothing else in the media code changes.

### 9.2 Kinds and fields

| Kind | Fields | Secret |
|---|---|---|
| `ftp` | host, port (21), path, username, tls (FTPS) | password |
| `sftp` | host, port (22), path, username | password (or none with an agent key) |
| `smb` | host, share, path, username, domain | password |

Roles: video, music, or both. Downloads still only go to a folder (phase 1 rule).
Reachability: a connect + list of the root within `CHECK_TIMEOUT`. Listing: the
phase 1 background scan, depth 6, kept on disk.

### 9.3 Build plan (phase 2)

7. **Secrets and remote kinds.** `secrets.json`; `ftp`/`sftp`/`smb` in the registry with validation; `GET /api/storages/check` connects and lists for them; dependencies added.
8. **Remote listing.** fsspec scan into the same `DownloadedFile` rows; reachability by connect; kept listing.
9. **Relay.** `/api/storages/{id}/raw/{path}` with Range, from fsspec (and from another sestudio in 14).
10. **`RemoteFile`.** `resolve()` returns it for remote kinds: play, HLS, tracks, subtitles (embedded and sidecar), thumbnails, cast, DLNA, delete (remote delete through fsspec).
11. **Settings › Storage** add form tabs for FTP, SFTP, SMB (host, port, share, path, user, password, Test), and the cards showing host and protocol.
12. **Music on remote storages.** Audio listed as a music library; analysis reads through the relay.
13. **Share video.** The serving side: `/api/share/video` listing and file, behind share tokens.
14. **Another sestudio's films.** `remote_sestudio` with the video role: listing, relay proxy with the token, switcher.
15. **Copy / move: mockups.** Phone + desktop, files list and Tree/Browse.
16. **Copy / move: build** to the picked mockup: transfer jobs (any storage → a folder or a remote storage), progress in Queue, manifest rows follow the file, source deleted only after a verified copy.
17. **Android.** The new dependencies in the APK build; a test on the phone build.

### 9.4 Progress (2026-11-21)

- Shipped: 7 (#577), 8–10 as one (#578, end-to-end test: a real ffmpeg reads through the relay), 11 (#580), 12 (#581), 13–14 as one (#582, end-to-end test over a real HTTP server).
- 16: the transfer engine and API shipped first (#584, `/api/transfers`). The screens follow the round-2 picks (`docs/proto/storage/mockups-round2.html`):
  - title's files list: A + B, a ⋯ per file with Copy all / Move all, plus Select mode with per-season ticks and a bottom bar;
  - Tree and Browse: T1 + T2, a ⋯ on every folder, file and card, plus Select mode with a bottom bar (no drag and drop);
  - picker P2: a full modal (a full page on a phone) with the other storages and their room, a folder chooser inside the one picked ("Same place as now" or another folder, New folder), and Skip / Replace / Keep both;
  - Queue Q: copies and moves sit beside downloads, with progress, Pause, Cancel, and Replace them / Keep both for skipped files.
  "Pick another folder" keeps what is under the item picked: a folder lands as itself, a title keeps its own folder and seasons, a lone file lands by its name (`dests` on `POST /api/transfers`, folders from `GET /api/storages/{id}/folders`).
- 17: the new dependencies resolve to binary wheels on `aarch64` (`uv pip compile --only-binary :all:`), so `uvx sestudio` installs them on the phone; not yet run on a phone build.
- Not done: a sidecar subtitle beside another sestudio's film is not listed (embedded tracks play); a TV burning a sidecar subtitle of a file on a server is not tried.

## 10. Phase 3: a phone as a bridge to another home's network (draft, 2026-11-22)

At the family house their films sit on a Freebox. My home server can't reach their network,
but my phone, on their Wi-Fi, can. The phone's sestudio opens the Freebox and the home server
reaches it through the phone over Tailscale (option 1, picked over a subnet router or the
Freebox VPN). Answers that shaped this: the home server's UI drives it; watch, cast, copy home
and copy to their Freebox are all wanted; Disconnect ends it, the login is kept and the
connection is remembered for that Wi-Fi.

### 10.1 Stories

Pairing (once)
- **B1.** At home, once, I add my phone's sestudio to my home server as a bridge, the way I add
  another sestudio today (X3). After that the home server reaches it whenever the phone is on.
- **B2.** The phone's card in Settings › Storage says whether it answers now and which network
  it is on: "Pixel 7 · online · on Freebox-1A2B3C".

Finding
- **B3.** At the family house, in my home server's UI (on my phone, over Tailscale), I tap
  **Look around Pixel 7** and see what the phone finds on its Wi-Fi: "Freebox Server · SMB ·
  192.168.1.254".
- **B4.** The scan takes seconds and says what it is doing. When it finds nothing, it says so
  and lets me type an address.
- **B5.** Only what can hold files is listed: SMB, FTP and SFTP shares, and media servers. TVs,
  speakers and printers are not.

Opening
- **B6.** I tap **Open**. If the share wants a login I type it once. It opens as a storage named
  after the device and the place ("Freebox · Mum's"), shown as **via Pixel 7**, and I can rename it.
- **B7.** The login is saved, and never shown again or sent to a browser.
- **B8.** Another day, back on the same Wi-Fi, the Freebox opens again by itself with the saved
  login: no scan, no typing.

Using
- **B9.** Its films show in Media like any storage: in the switcher, in All storages, in Tree and
  Browse, with "via Pixel 7".
- **B10.** I play one of its films on my phone, with seeking, like any other storage file.
- **B11.** I cast one of its films to their TV. The TV gets it from my phone on their Wi-Fi, not
  from my home server across the internet.
- **B12.** I copy films from their Freebox to my home disks with the copy screens; the Queue
  shows it going.
- **B13.** I copy films from my home disks onto their Freebox, so they can watch them later.

Ending
- **B14.** I tap **Disconnect**: the Freebox leaves my lists. Its login stays saved.
- **B15.** When the phone leaves their Wi-Fi or stops, the Freebox shows "away since 21:04" like
  any offline storage (S13–S15), with the Wi-Fi it needs: "join Freebox-1A2B3C on Pixel 7".
  A running copy pauses and resumes when it is back.
- **B16.** After Disconnect nothing of theirs stays at home except what I copied: no listing and
  no thumbnails are kept.

Without the phone (were N1 and N3, wanted)
- **B17.** I can also reach their network without my phone there: through a Tailscale subnet
  router at their house, or by joining their Freebox's VPN. Their Freebox then opens from my home
  server directly, as a plain SMB or FTP storage, with the address typed once.
- **B18.** A laptop running sestudio at their house can be the bridge instead of my phone, the
  same way (B1–B16).

### 10.2 Not in scope

- **N2.** Scanning anything beyond the bridge's own Wi-Fi, or devices that hold no files.

### 10.3 Open questions

- **Q4.** When the phone leaves their Wi-Fi, the Freebox: stays listed, greyed "away"
  (proposed, matches B8 and B15), or disappears until opened again.
- **Q5.** "The same Wi-Fi" is recognised by: the Freebox itself answering at its address with the
  same identity (proposed: no Android permission needed), or the Wi-Fi name (Android then asks
  for location permission).
- **Q6.** Move to or from their Freebox: off, Copy only (proposed: a move deletes their files or
  mine across a phone link), or allowed with a confirmation.
- **Q7.** Where their login is kept: on the phone only (proposed: my home server never holds
  their password), or in the home server's `secrets.json`.

### 10.4 Answers (2026-11-22, story review)

- B1–B14 and B16 kept as written. B15 changed: an away bridge storage names the Wi-Fi to join.
- N1 and N3 wanted: now B17 (subnet router or Freebox VPN, no phone) and B18 (a laptop as the
  bridge). N2 stays out.
- **Q4.** When the phone leaves their Wi-Fi, the Freebox stays listed, greyed "away".
- **Q5.** "The same Wi-Fi" is recognised by its name. The Android app asks for location
  permission (Android only gives the Wi-Fi name with it), and says why when it asks.
- **Q6.** Move to or from their Freebox is allowed, after a confirmation.
- **Q7.** Their login is kept in the home server's `secrets.json`, sent to the phone when it opens
  the share, and never to a browser.

### 10.5 Screens (mockups round 3, 2026-11-22: `docs/proto/storage/mockups-round3.html`)

- **Settings › Storage: K1, nested.** The bridge phone has its own card (name, Bridge, online and
  the Wi-Fi it is on, **Look around**). What it opened sits inside that card, each with
  **Disconnect**; under them, "Saved for <Wi-Fi>: opens by itself when <phone> joins it again".
  On a phone the button goes full width and Disconnect drops under the row.
- **Look around: L2, a Nearby tab in Add a storage.** Tabs Folder · Server · Another sestudio ·
  **Nearby**. A **Look from** switch picks this server or a bridge. It says how long it has looked,
  lists what holds files (name, kind, share, address, a lock when a login is needed) with **Open**,
  and takes a typed address under "Not listed?". The phone card's **Look around** opens this tab
  with the phone picked.
- **Open a share: O.** Name (filled in from the device and the place), user and password (empty
  for a guest share), "Saved on your home server, never shown again", Video / Music, and **Open by
  itself on <Wi-Fi>** on by default.
- **In Media: M.** The storage is in the switcher as "<name> · via <phone>". Away, it stays,
  greyed, under a banner: "Away since 21:04. It opens again when <phone> joins <Wi-Fi>."
- **Asks: A.** Android's location question the first time the phone looks around, with sestudio's
  reason in it; a move to or from a bridged storage confirms first: it names whose files are
  deleted, the time through the phone, and offers **Copy instead**.

### 10.6 Build plan (phase 3)

18. **Bridge pairing and status** (B1, B2, K1): a sestudio says what network it is on
    (`/api/share/bridge`: Wi-Fi name, address; Android reads the Wi-Fi name with the location
    permission, Windows and Linux from the OS for B18). A remote sestudio can be marked a bridge;
    its card shows online and Wi-Fi.
19. **Nearby scan** (B3–B5, L2): `GET /api/nearby` on any sestudio: mDNS (`_smb._tcp`, `_ftp._tcp`,
    `_sftp-ssh._tcp`), SSDP media servers, and a port probe of the gateway; TVs, speakers and
    printers left out. Add a storage › Nearby with **Look from**, which asks the bridge when picked.
20. **Open through a bridge** (B6, B7, B9, B14, B16, O): the home server keeps the login in
    `secrets.json` and asks the bridge to open the share in memory only; the bridge lists it through
    its share API; the home server shows it "via <phone>" inside the bridge card. Disconnect closes
    it on the bridge and drops its listing and thumbnails at home.
21. **Play and cast through a bridge** (B10, B11): played through the home relay from the
    bridge's relay; a cast to a TV on their network is started by the bridge, which streams to it
    itself.
22. **Copy and move through a bridge** (B12, B13, A): the transfer engine reads and writes a
    bridged storage through the bridge's API (writes need the share token); a move confirms first.
23. **Remembered Wi-Fi and away** (B8, B15, Q4, Q5, M): the bridge reopens saved shares when it
    joins a saved Wi-Fi; away storages stay, greyed, with the Wi-Fi to join; a running copy pauses
    and resumes.
24. **Without the phone** (B17): a share reached through a subnet router or the Freebox VPN is a
    plain SMB or FTP storage with a typed address (works today); Settings says how, in a short help
    line.

### 10.7 Progress (2026-11-22)

- Shipped: docs (#587), 18 (#588), 19 (#591, replacing #590 after a `frontend/dist` conflict), 20 (#592); 21–24 follow in order.
- 21: B11 works with the phone's sestudio switched to home (remote servers, Settings › Servers): its
  TV is found there, and a film of a share the phone holds is served by the phone itself, not fetched
  back from home. From the home UI in a browser over Tailscale, a TV on their network is not reachable.
- 22: the move confirmation says "it can take a while" but gives no time: nothing measures the link
  through the phone before the move starts.
- 25 (asked 2026-11-22): each place Nearby finds is checked at once with no login (SMB as
  "guest", FTP as "anonymous"), or with one typed in its row when none gets in. Its shares are
  listed (SMB: asked of the box's share service over SMB2/3) with what each allows.
- No sestudio artifact on a share (asked 2026-11-22): nothing is written to find out what a share
  allows. SMB is asked: the share's top folder is opened requesting the right to list, then to add
  files, and closed. FTP and SFTP have no such question: writing shows "not checked". A copy's
  `.part` file is removed when the copy fails or is cancelled, and when its storage was away, as
  soon as it is back. Guest SMB shares open too (signing and the negotiation check are off for a
  guest session only).
- Not done: music through a bridge (O's Music is shown, off); a media server found by Nearby is
  listed but not opened (its box's SMB or FTP share is).

## 11. Modern boxes (asked 2026-11-22: all four)

### 11.1 Stories

- **M1. French boxes.** Nearby finds a current Freebox (Pop, Delta, Ultra, Revolution), Livebox,
  Bbox or SFR box and names it as such ("Freebox", not "192.168.1.254"): by what it announces
  (mDNS, UPnP) and by its usual name on its own network (`mafreebox.freebox.fr`,
  `gestionbbox.lan`, `livebox.home`). Its SMB3 share and its FTP open.
- **M2. Windows PCs and modern NAS.** Nearby finds machines that only announce themselves the
  Windows way (WS-Discovery): Windows 10/11, and NAS boxes with SMB1 and NetBIOS off.
- **M3. Encrypted SMB3.** A share that requires SMB3 encryption or signing opens with a login, and
  Nearby says so ("needs a login: it encrypts") instead of failing on a guest attempt.
- **M4. The box's own API.** A Freebox is paired once, from Nearby: sestudio asks, I press the
  button on the box's screen (or approve in Freebox OS), and from then on it lists the box's disks
  and shares through Freebox OS, and can turn its file sharing on, after asking me. Its token is
  kept like a password (home `secrets.json`, sent to the bridge when it is used).

- **M5. The box's media server** (asked 2026-11-22). A Freebox's "Freebox Server" (or a NAS's
  DLNA server) opens as a read-only storage, here or through a bridge: its folders and films are
  listed, they play and can be copied home; never moved or written. Live TV channels are left out.

### 11.2 Build plan

26. M1 + M2: WS-Discovery in the scan; boxes named by brand; their usual host names looked up.
27. M3: logins tried with SMB3 encryption and signing; the probe says why a guest is refused.
28. M4: screens first (pairing, disks and shares, turning sharing on), then the Freebox OS client.

### 11.3 Progress

- 26: WS-Discovery (Probe to 239.255.255.250:3702 from each LAN address, then each machine's
  metadata for its name); the gateway's UPnP name; `mafreebox.freebox.fr`, `gestionbbox.lan`,
  `livebox.home` looked up; a Freebox recognised by `/api_version` whatever its DNS name, and named
  by generation (v6 Revolution, v7 Delta, v8 Pop, v9 Ultra). A name labels an address that answers
  on a file port; it adds no row by itself. Checked on a real Freebox Pop (v8, API 16.1): named
  "Freebox Pop"; as guest it shares nothing without a USB disk. WS-Discovery is tested with a fake
  responder (multicast could not be tested in WSL without announcing on the home network).
- 27: a share that turns a guest away (named users only, or SMB3 encryption required) says
  "Needs a login", with Log in on it even when other shares let the guest in; a share reached
  with a login says "encrypted" when SMB3 encryption is on. Encrypted shares already opened with a
  login (smbprotocol encrypts on its own). Checked on Samba 4.25 with `smb encrypt = required`.
- 28 (M5): a UPnP media server is a storage kind (`upnp`), read only: its ContentDirectory is
  browsed into a folder tree of the items that have a size (live TV, size 0, left out), files are
  read over HTTP in byte ranges, so they play, seek and copy; a move from it becomes a copy, and
  nothing is written to it. Opens here or through a bridge. A Freebox's media server is also found
  at `http://<box>:52424/device.xml` when SSDP gets nothing (WSL, some Wi-Fi). On Android the app
  holds a multicast lock so mDNS answers reach the scan. Checked on a real Freebox Pop: found,
  named, opened (no disk: 0 titles; TV left out); playing and copying checked on a fake server.
- M4 (the Freebox OS API) waits on its screens: docs/proto/storage/mockups-round4.html.

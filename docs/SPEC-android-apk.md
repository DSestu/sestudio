# Spec: sestudio as an Android app (APK)

> Decided 2026-11-01, after running sestudio on a OnePlus 11 in Termux: **one APK**, the UI in the
> app's **own full-screen WebView** (so no Chromecast; DLNA only), distributed from **GitHub
> Releases** (sideload or Obtainium), not the Play Store.

## 1. Why

The Termux route works (search, film pages, stream resolution and video segments all served from the
phone), but it is three installs, a pasted command and a widget. A non-developer should install one
app, tap it, and watch.

## 2. Goals

1. **One install, one tap.** The first launch sets everything up with a progress screen; later
   launches open sestudio in seconds.
2. **Borderless**: the web UI full screen, with no browser bar, from the first launch.
3. **Keeps running** while the phone is locked or another app is in front, until stopped.
4. **Stays current**, both halves: sestudio (the Python server) from PyPI on every start, and the APK
   from GitHub Releases (§6).

### Non-goals

- AI frame rates (the phone's GPU is out of reach from proot).
- The Play Store (an app that scrapes streaming sites will not pass review).
- iOS.

## 3. How it works

```
APK
├─ MainActivity ── full-screen WebView → http://localhost:8080
│                  first launch: native setup screen with progress
├─ ServerService ── foreground service ("sestudio is running", Stop)
│                   runs: libproot.so … uvx sestudio@latest --host 0.0.0.0
└─ jniLibs/arm64-v8a/
     libproot.so, libproot-loader.so   ← static proot, executable because it is a "native library"
```

The server runs exactly as in Termux, minus Termux: proot over a Debian root filesystem, uv's own
Linux Python, then `uvx sestudio`. Everything below `filesDir/` is downloaded on first launch.

| Piece | Source | Size |
|---|---|---|
| proot + loader | Static Android builds (e.g. `green-green-avk/build-proot-android`), in the APK | ~2 MB |
| Debian root filesystem | The arm64 `debian:stable-slim` image layer, fetched from Docker Hub as proot-distro does | ~30 MB |
| uv | The static `aarch64-unknown-linux-musl` release | ~20 MB |
| Python + sestudio + dependencies | Installed by `uvx` inside proot | ~150 MB |

No `apt` step: uv is static, uv's Python is self-contained, and httpx and curl-cffi carry their own
certificates. Debian only provides glibc and the dynamic loader.

### Lessons from the Termux run that carry over

- `UV_PYTHON_PREFERENCE=only-managed`: never let uv pick a Python that reports Android.
- Android 10+ forbids executing files from app storage; proot must live in `nativeLibraryDir`
  (`android:extractNativeLibs="true"`), and runs everything else through its loader.
- OxygenOS killed the Termux process minutes after the screen locked. Hence a foreground service
  with a wake lock, and a one-time prompt to exempt the app from battery optimisation.

## 4. The WebView shell

- Immersive full screen; the system back button goes back in the web app's history.
- Loads `https://<phone's Wi-Fi IP>:8443`, not `localhost`: media URLs the page hands a TV must reach
  the phone, and HTTPS keeps the secure context (Copy, Share, Cast) a LAN address over HTTP loses. The
  WebView trusts exactly the server's own certificate (`cert.pem`). No Wi-Fi: `http://localhost:8080`.
- **Chromecast, two ways** (the Cast web SDK does not run in a WebView):
  - *Native*: the Google Cast Android SDK, bridged to the web UI's Cast button through a JavaScript
    interface; the TV fetches the same `https://<Wi-Fi IP>:8443/…` media URLs.
  - *Open in Chrome*: a button that opens the current page in Chrome, where web casting already works.
  DLNA works as it does today: the server builds its media URL from the phone's Wi-Fi address.
- Video fullscreen through `WebChromeClient.onShowCustomView`.
- **Picture-in-picture**: leaving the app while a video plays (Home, app switch) shrinks it into
  Android's floating window. PiP takes the whole activity, so on entering it the app tells the page to
  show only the playing video, at the video's aspect ratio; leaving restores the page. Play/pause and
  ±10 s as PiP actions. The page reports play and pause to the app over a JavaScript bridge, so PiP
  triggers only during playback; inside the app, the web player's own PiP button asks for the native
  one (the WebView has no web PiP API).
- **Background play**: playback continues with the screen off or another app in front (the WebView is
  not paused while a video plays), with lock-screen and notification controls (play/pause, ±10 s,
  title, poster) through a MediaSession on the server's notification. The foreground service and its
  Wi-Fi lock (§3) keep the server and the stream alive meanwhile.
- "This device" downloads: `DownloadListener` → Android's `DownloadManager`.
- Links to other sites (TMDB guide, trailers) open in the phone's browser.
- Waits for the server: a native "Starting…" screen until it answers.

## 5. First launch

1. Explain in one screen what will be downloaded (~200 MB) and ask for the battery exemption.
2. Download and unpack proot's root filesystem, then uv. Progress bar per step.
3. Start the service; `uvx sestudio@latest` installs Python and dependencies (the longest step).
4. Open the WebView. Total: about 2–4 minutes on Wi-Fi.

Failure at any step shows the step, the last log lines and a Retry button.

## 6. Updates

Two halves, updated separately:

| Half | How | When |
|---|---|---|
| sestudio (Python) | `uvx sestudio@latest` | Every start of the server |
| The APK | In-app updater against GitHub Releases | On launch, at most once a day |

**Releasing.** The release-please workflow gains a job: on every sestudio release, build a
**release-signed** APK with `versionName` = the release tag and `versionCode` derived from it
(`major * 10000 + minor * 100 + patch`), and attach it to that GitHub Release as `sestudio.apk`.
One version number for both halves.

**Updating.** On launch, the app reads `api.github.com/repos/DSestu/sestudio/releases/latest`.
When its `versionCode` is behind:

1. A small banner: "sestudio 1.3.0 is available — Update".
2. Download `sestudio.apk` from the release, check it is signed with the same key as the running app.
3. Install through Android's `PackageInstaller` (permission `REQUEST_INSTALL_PACKAGES`; Android asks
   once to allow installs from sestudio, then confirms each update with one tap).

From the first in-app update on, sestudio is the app's "installer of record", which on Android 12+
allows later updates without the confirmation tap (`USER_ACTION_NOT_REQUIRED`). To verify on the
OnePlus before relying on it.

**The signing key** is created once and kept as two GitHub secrets (keystore and password). Losing it
means every user must uninstall and reinstall; it gets a second copy outside GitHub.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Vendor background killing beyond what a foreground service survives | Battery exemption prompt; restart the service on next launch |
| Static proot builds go stale or break on a new Android | Pin a version; CI test on an emulator image of the latest Android |
| proot is GPL-2 | Ship its licence and a link to the exact source in the app's About |
| sestudio@latest breaks on ARM | Fall back to the last version that started (`uvx sestudio==<last>`) |
| Datacenter-free, but mobile data | First-launch screen warns about ~200 MB; setting to update on Wi-Fi only |

## 8. Plan (one PR each, in order)

1. **Termux script** (`scripts/termux.sh`) and root-file serving: done separately, the fallback route.
2. **Android project skeleton**: `android/` (Kotlin, Gradle), CI builds a signed APK artifact.
3. **Runtime bootstrap and setup screens**: proot in `jniLibs`, root filesystem + uv download and
   unpack, the first-launch screens (welcome, battery exemption, progress, Retry, Copy log), and a
   check that runs uv inside Debian.
4. **ServerService**: foreground service, wake lock, logs kept in `filesDir/server.log`, and its
   notification: "sestudio is running", tapping it opens the app, **Stop** shuts the server down and
   removes it. Ongoing, so it cannot be swiped away; on Android 14+, where the system lets users
   dismiss even a foreground service's notification, a dismissal re-posts it (`setDeleteIntent`) for
   as long as the server runs.
5. **WebView shell**: full screen, back button, fullscreen video, external links, "Starting…" screen.
6. **Downloads, picture-in-picture and background play** (lock-screen controls).
7. **Chromecast**: native Cast SDK bridge, and "Open in Chrome".
8. **Release and auto-update**: signing key as secrets, APK attached to each release by the
   release-please workflow, in-app updater (on launch, once a day) and a "Check for updates" button
   in Settings (shown only inside the app, next to the app's version), README section.

## 9. Testing

Every PR from 3 on is installed on the OnePlus 11 (Android 15) over `adb` and exercised: a search,
a film page, playback, a download, lock the screen for 15 minutes, unlock, play again.

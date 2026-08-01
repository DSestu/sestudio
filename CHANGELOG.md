# Changelog

## [0.5.0](https://github.com/DSestu/sestudio/compare/v0.4.1...v0.5.0) (2026-08-01)


### New features

* start both an HTTP and an HTTPS server by default ([81d12d7](https://github.com/DSestu/sestudio/commit/81d12d755b426fe935779e7feb9c61c0639bd1a5))

## [0.4.1](https://github.com/DSestu/sestudio/compare/v0.4.0...v0.4.1) (2026-08-01)


### Bug fixes

* bypass fstream's new JS anti-bot challenge in the scraper ([079e697](https://github.com/DSestu/sestudio/commit/079e6975fa6bc36bd9b2853fee431eea19575b0c))
* run a plain-HTTP server alongside HTTPS for cast media (DLNA/Chromecast) ([e338269](https://github.com/DSestu/sestudio/commit/e338269e21151c0b9fec297011b51ad4ea350a30))

## [0.4.0](https://github.com/DSestu/sestudio/compare/v0.3.0...v0.4.0) (2026-08-01)


### New features

* cast controls, provider probing, autoplay, back-button, and fixes ([cb2e838](https://github.com/DSestu/sestudio/commit/cb2e838c8b4cf93bff395e6d185e3343b29f95f8))
* Chromecast controls, session persistence, and media CORS ([9f4e7d3](https://github.com/DSestu/sestudio/commit/9f4e7d33f570fe450246258eaa62efb007f63aa4))
* fix uqload provider and add premium (fsvid.lol) provider ([0d2a581](https://github.com/DSestu/sestudio/commit/0d2a5811d1ef81d5a9b3abb38dcee7290e49a024))
* organise downloads into per-language subfolders (VF/VOSTFR/VO) ([3e0206d](https://github.com/DSestu/sestudio/commit/3e0206db669c187aeb6e20c72e08d5ff5dc9272d))
* **packaging:** bundle ffmpeg via imageio-ffmpeg (Phase 2) ([89f6d5c](https://github.com/DSestu/sestudio/commit/89f6d5ced88e447cccabfb19cbf18d7da79317ef))
* **packaging:** HTTPS by default + release plumbing (Phase 4) ([2b7a38e](https://github.com/DSestu/sestudio/commit/2b7a38eeac9dc5a2cadd5640aec502ba43d5731b))
* **packaging:** make the installed package self-contained (Phase 1) ([244d102](https://github.com/DSestu/sestudio/commit/244d1025258e6764c163f1bf0094d7eb88e8dbe9))
* **packaging:** self-contained HTTPS for casting (Phase 3) ([79cedd3](https://github.com/DSestu/sestudio/commit/79cedd3a259a7fcb42104064011b5f832f4f9679))
* show video providers and test sources in player and cast ([798bd49](https://github.com/DSestu/sestudio/commit/798bd491f40df353939513f039b58c12a6b232b1))


### Bug fixes

* keep the Casting pill above all other overlays ([3c895d0](https://github.com/DSestu/sestudio/commit/3c895d041a826ba013577333e75b8d5b94cbe6e6))
* unblock CI — bump uv, scope pre-commit, format + lint ([ba8eaae](https://github.com/DSestu/sestudio/commit/ba8eaaed052b6e985920b14a30198584415fa83e))


### Code refactoring

* rename package fstream-dl → sestudio ([f7ef7c7](https://github.com/DSestu/sestudio/commit/f7ef7c740a17e0b3b34cdc78c915dec444b443fb))


### CI configuration

* publish to PyPI via OIDC trusted publishing ([6ef3d3c](https://github.com/DSestu/sestudio/commit/6ef3d3c4642b72577a2659bacffcb78cacf8eebf))

## [0.3.0](https://github.com/DSestu/fstream-downloader/compare/v0.2.1...v0.3.0) (2026-07-30)


### New features

* in-browser player and cast-to-device (DLNA + Chromecast) ([6682c4d](https://github.com/DSestu/fstream-downloader/commit/6682c4d1e9c391368e0dd7dce6472796b536f9dd))

## [0.2.1](https://github.com/DSestu/fstream-downloader/compare/v0.2.0...v0.2.1) (2026-07-30)


### Bug fixes

* decode obfuscated Vidzy m3u8 source ([a704528](https://github.com/DSestu/fstream-downloader/commit/a704528745c641e55f28b4a7a564875a4eead850))

## [0.2.0](https://github.com/DSestu/fstream-downloader/compare/v0.1.1...v0.2.0) (2026-07-30)


### New features

* integrate DaisyUI for improved UI components and theming ([b9ee4fb](https://github.com/DSestu/fstream-downloader/commit/b9ee4fb5fc847ab2626aeb1934073a17abc8e1f1))
* update environment configuration and enhance frontend components ([ec43ad5](https://github.com/DSestu/fstream-downloader/commit/ec43ad573cb0f5f0ae3354cfe4ff7149e4232556))


### Bug fixes

* disable TLS verification for scraper HTTP clients ([d35700f](https://github.com/DSestu/fstream-downloader/commit/d35700f321f32d3b2268a4a93ef30c43e73c9033))

## [0.1.1](https://github.com/DSestu/fstream-downloader/compare/0.1.0...v0.1.1) (2026-05-18)


### Miscellaneous Chores

* update bootstrap SHA in release configuration ([b752634](https://github.com/DSestu/fstream-downloader/commit/b752634d30da119fcf7fb17e89ecb420c85e8701))

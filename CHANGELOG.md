# Changelog

## [1.1.0](https://github.com/DSestu/sestudio/compare/v1.0.0...v1.1.0) (2026-10-26)


### New features

* add BFlix as a source, streaming films and series through vidnest ([#130](https://github.com/DSestu/sestudio/issues/130)) ([9fce680](https://github.com/DSestu/sestudio/commit/9fce6801f6ca2dc6b61cd31ff67b3015ef5c03d7))
* list BFlix in Discover, with TMDB's filters and cards that open on BFlix ([#133](https://github.com/DSestu/sestudio/issues/133)) ([df95e50](https://github.com/DSestu/sestudio/commit/df95e5061a652202b21fc8e207576dabee27123e))
* make People its own search kind, and fold people under Everything's titles ([#131](https://github.com/DSestu/sestudio/issues/131)) ([d6ffe7b](https://github.com/DSestu/sestudio/commit/d6ffe7b2f24d9d28d635adec7a9eff09cb277030))
* show BFlix's favicon in the source lists ([#134](https://github.com/DSestu/sestudio/issues/134)) ([74e026d](https://github.com/DSestu/sestudio/commit/74e026d92db5211da42db781275c05ae41791ceb))
* show each source's favicon in the Discover rail and phone menu ([#132](https://github.com/DSestu/sestudio/issues/132)) ([dab2649](https://github.com/DSestu/sestudio/commit/dab26491f2446408451543f6b623176b65f83d30))


### Bug fixes

* catch scene cuts by their jump, so RIFE stops morphing between similar shots ([#128](https://github.com/DSestu/sestudio/issues/128)) ([bcc27b8](https://github.com/DSestu/sestudio/commit/bcc27b80fa754fb0c51ad1ec8071ad31eade52cd))
* keep the bottom padding of modals on desktop, so the Filters sheet isn't cut off ([#124](https://github.com/DSestu/sestudio/issues/124)) ([e38d0ab](https://github.com/DSestu/sestudio/commit/e38d0abc254e2668b3207c86e962e6ba9f0da0bd))
* keep the Ctrl K hint on one line when the search bar is narrow ([#127](https://github.com/DSestu/sestudio/issues/127)) ([5a7e5e5](https://github.com/DSestu/sestudio/commit/5a7e5e5f4a7ed446a549be95fe95fd947c6733fb))
* list a site once in the sources panel when its pages come from two mirror hosts ([#129](https://github.com/DSestu/sestudio/issues/129)) ([c9e7131](https://github.com/DSestu/sestudio/commit/c9e7131e315fd7041fe4fa9cf797a25f1882729d))


### Miscellaneous Chores

* wait for CI and merge from a background shell command, not a subagent ([#126](https://github.com/DSestu/sestudio/issues/126)) ([40cf840](https://github.com/DSestu/sestudio/commit/40cf8409b56d2e6efc885bff2a57b31a44e508e4))

## [1.0.0](https://github.com/DSestu/sestudio/compare/v0.20.0...v1.0.0) (2026-10-25)


### ⚠ BREAKING CHANGES

* remove the senpai stream source; fstream is now the default site ([#98](https://github.com/DSestu/sestudio/issues/98))

### New features

* add KissKH as a source for Asian dramas, films and anime, with its own Home rows and French subtitles ([#99](https://github.com/DSestu/sestudio/issues/99)) ([b719f86](https://github.com/DSestu/sestudio/commit/b719f8614dbf6133714a62819bb28f6662ed81cb))
* add UniqueStream as a source, and browse every catalogue from a new Discover tab ([#100](https://github.com/DSestu/sestudio/issues/100)) ([611e858](https://github.com/DSestu/sestudio/commit/611e8582951611948f740f7a6ae646c26fa2d8f9))
* browse FStream, French-Manga and KissKH from Discover, and link each source to its site ([#102](https://github.com/DSestu/sestudio/issues/102)) ([c43b205](https://github.com/DSestu/sestudio/commit/c43b2055aba5f3c5e50afcd7226bca9c233f94fd))
* cast at another frame rate, and change quality or rate without a restart ([#78](https://github.com/DSestu/sestudio/issues/78)) ([92c8d98](https://github.com/DSestu/sestudio/commit/92c8d98dd9fd12edcb374957f1380df647f44aa1))
* change the browser player's frame rate in place, as a cast does ([#90](https://github.com/DSestu/sestudio/issues/90)) ([72d0fc8](https://github.com/DSestu/sestudio/commit/72d0fc81deaa4f7fd6e23dc8e66fabfbb84e343f))
* fetch the AI runtime on first use, uncap TVs, and move the rate picker ([#80](https://github.com/DSestu/sestudio/issues/80)) ([233a433](https://github.com/DSestu/sestudio/commit/233a433fb31c1f3771c873ed306a0139f73971c6))
* fold the search page's controls behind one Options button ([#114](https://github.com/DSestu/sestudio/issues/114)) ([053098c](https://github.com/DSestu/sestudio/commit/053098ccd41e90a2ec1b48620f54ec072faec9c2))
* give desktop Discover its rail and heading, and search one bar on every page ([#105](https://github.com/DSestu/sestudio/issues/105)) ([f849cf0](https://github.com/DSestu/sestudio/commit/f849cf0312b5e27dc6bda11aa5248287e1582eae))
* give every empty search page a way out, and suggest the title a typo meant ([#123](https://github.com/DSestu/sestudio/issues/123)) ([2e6c5f6](https://github.com/DSestu/sestudio/commit/2e6c5f6d4e33d52547dd8d2b9969806f7c94a868))
* give the phone search its own row and the kinds their own line, with counts ([#113](https://github.com/DSestu/sestudio/issues/113)) ([f712728](https://github.com/DSestu/sestudio/commit/f712728a10a140fc7725c7558794a71c950e3409))
* list a mixed search as one row per kind, each with See all ([#118](https://github.com/DSestu/sestudio/issues/118)) ([955a82f](https://github.com/DSestu/sestudio/commit/955a82f36933ff8a914fb3775f0eaee98f9d087e))
* list every search result in the phone Discover menu, under a frosted button that counts what's left ([#110](https://github.com/DSestu/sestudio/issues/110)) ([cc1c2b4](https://github.com/DSestu/sestudio/commit/cc1c2b48176f66a819d53093b8b0c3a540606236))
* list the episodes on disk whose title matches a search, by show ([#121](https://github.com/DSestu/sestudio/issues/121)) ([9361d19](https://github.com/DSestu/sestudio/commit/9361d19810532d78193f8287a65cae3bce27ec01))
* offer 90 fps, and trim the frame rate picker to numbers and a sparkle ([#83](https://github.com/DSestu/sestudio/issues/83)) ([6382c3a](https://github.com/DSestu/sestudio/commit/6382c3a5dd231040a268da1140e829ba7bd49f92))
* offer every cast quality up to the source's own, above 1080p too ([#75](https://github.com/DSestu/sestudio/issues/75)) ([5c9d409](https://github.com/DSestu/sestudio/commit/5c9d409647cdf7d09c84d8d94995305b3644d07f))
* offer only the frame rates this GPU can draw in time ([#79](https://github.com/DSestu/sestudio/issues/79)) ([3a6c745](https://github.com/DSestu/sestudio/commit/3a6c745392498103f93c2c09d7444a0250a7a115))
* open every source of a search as a histogram, in a side panel or a sheet ([#116](https://github.com/DSestu/sestudio/issues/116)) ([ae14bd9](https://github.com/DSestu/sestudio/commit/ae14bd9768650556ab1f9a9c34a527c05bbef588))
* pick a frame rate up to 144 fps, the frames in between drawn by AI ([#77](https://github.com/DSestu/sestudio/issues/77)) ([f4b2a53](https://github.com/DSestu/sestudio/commit/f4b2a533628e9fcc41352353d4937a1d4a326c85))
* pick the frame rate from a dropdown beside the cast button on a phone ([#84](https://github.com/DSestu/sestudio/issues/84)) ([047b5ad](https://github.com/DSestu/sestudio/commit/047b5ad9ad7066160a6d3ae421269eb1a35d27b1))
* play the source's rate until AI frames are ready, and swap to them as they are ([#91](https://github.com/DSestu/sestudio/issues/91)) ([0199ced](https://github.com/DSestu/sestudio/commit/0199ced97ee160aa27880fbbf885a064c6a3e495))
* put the results page first in every search preview, remember recent searches, and grow the phone menu to the top while searching ([#107](https://github.com/DSestu/sestudio/issues/107)) ([baece96](https://github.com/DSestu/sestudio/commit/baece9617e215adc795fd6c431635a5e77890c4b))
* quality, frame rate, voice and captions as dropdowns, Source by default, and a restart button ([#92](https://github.com/DSestu/sestudio/issues/92)) ([8ed7d80](https://github.com/DSestu/sestudio/commit/8ed7d80275e9258a5a355a80ddc545ec817b042d))
* rate every source's Discover cards by their TMDB match ([#103](https://github.com/DSestu/sestudio/issues/103)) ([b1b1ee9](https://github.com/DSestu/sestudio/commit/b1b1ee9f49cf91704fb7335d85554ee281c79ef6))
* remove the senpai stream source; fstream is now the default site ([#98](https://github.com/DSestu/sestudio/issues/98)) ([dfb57bc](https://github.com/DSestu/sestudio/commit/dfb57bc71b487684403f5013c8a428b505292978))
* report how each source fared in a search, and stop waiting on a slow one ([#111](https://github.com/DSestu/sestudio/issues/111)) ([ece34b0](https://github.com/DSestu/sestudio/commit/ece34b0e1d21f5eeb41bf73c2ab0d7e88e2f646d))
* save Discover cards to the watchlist and favourites again ([#106](https://github.com/DSestu/sestudio/issues/106)) ([2c88aaf](https://github.com/DSestu/sestudio/commit/2c88aafca94350e1978830be75f4cbdde9864b1a))
* show a searched-for person as the top match, and only people with a face ([#122](https://github.com/DSestu/sestudio/issues/122)) ([efddd6e](https://github.com/DSestu/sestudio/commit/efddd6ea0a126a7e60f57dd1fbd4e7e4e1afb661))
* show how many results each source found, and filter by clicking them ([#115](https://github.com/DSestu/sestudio/issues/115)) ([0eaaa9c](https://github.com/DSestu/sestudio/commit/0eaaa9ca9f79d738bb8e29ee6ce542fd9ce2ea5e))
* show live GPU, CPU, memory and buffer graphs while AI draws frames ([#87](https://github.com/DSestu/sestudio/issues/87)) ([f3b144a](https://github.com/DSestu/sestudio/commit/f3b144aaeca221fa16fce661c695a5f9d8a46e15))
* show the AI setup's progress, and run it again or turn it off from the settings ([#88](https://github.com/DSestu/sestudio/issues/88)) ([59e4aea](https://github.com/DSestu/sestudio/commit/59e4aeabf1b8381597f566d4d1b509117640126f))
* show the search's clear top match big, with Play next to it ([#117](https://github.com/DSestu/sestudio/issues/117)) ([7c7b5a8](https://github.com/DSestu/sestudio/commit/7c7b5a86d0f50ee2e3ea9cdd985887ad3aa4b2ac))
* smooth anime's held drawings with AI frames, up to a hold set in Settings and under the player ([#96](https://github.com/DSestu/sestudio/issues/96)) ([0314ec1](https://github.com/DSestu/sestudio/commit/0314ec13ed36cb50dc1f8181be27f17483dde1c7))
* switch Discover sources on phones from a menu that slides out of the tab bar ([#104](https://github.com/DSestu/sestudio/issues/104)) ([556b6ef](https://github.com/DSestu/sestudio/commit/556b6efb8923916e325bad2ab52c952fb32b6542))
* tell a search what's on disk as shows, and resume the top match from there ([#119](https://github.com/DSestu/sestudio/issues/119)) ([59d2579](https://github.com/DSestu/sestudio/commit/59d2579e9cac97b85b1273b2c1564e2d40606e68))
* walk a top match's seasons and episodes on disk from the search page ([#120](https://github.com/DSestu/sestudio/issues/120)) ([d356aa4](https://github.com/DSestu/sestudio/commit/d356aa4f0ca1e663f99223eb7bff1288290d8e97))


### Bug fixes

* call the player's buffer graph what it shows, seconds playable ahead ([#89](https://github.com/DSestu/sestudio/issues/89)) ([6ff7bdd](https://github.com/DSestu/sestudio/commit/6ff7bddb1caf18e0a22fe8fda03fcbddeffbf268))
* cap the player's buffer by size too while AI is on, and show LIVE for segments sent as AI ([#95](https://github.com/DSestu/sestudio/issues/95)) ([5078d94](https://github.com/DSestu/sestudio/commit/5078d945aacba3aee10fef4ab6d74bd81daf964c))
* draw AI frames in time for the player, play Source untouched, and restart with the launch command ([#93](https://github.com/DSestu/sestudio/issues/93)) ([302b0ff](https://github.com/DSestu/sestudio/commit/302b0ff7f3d7cd0e2dfd80414172489846fb24cc))
* keep the position when changing frame rate, and name the TV's rate ([#82](https://github.com/DSestu/sestudio/issues/82)) ([826efb6](https://github.com/DSestu/sestudio/commit/826efb6b7edd1fe0ffadf42f33f97e664b4d8b9e))
* let Discover switch catalogue instead of snapping back to the current one ([#101](https://github.com/DSestu/sestudio/issues/101)) ([840cc5a](https://github.com/DSestu/sestudio/commit/840cc5ab03e405d5863d3e0bb5c72e6a1c8f5032))
* let TensorRT draw frames for 144p pictures narrower than 256 pixels ([#85](https://github.com/DSestu/sestudio/issues/85)) ([6ad37cb](https://github.com/DSestu/sestudio/commit/6ad37cb15c856f3534c80359745611b3ad5a0c2c))
* show FStream titles with their quotes instead of backslashes ([#112](https://github.com/DSestu/sestudio/issues/112)) ([1504269](https://github.com/DSestu/sestudio/commit/15042696c1facb3f5fb9a6046b6c29090e027d6f))
* switch to another site when senpai's ad gate blocks a title, and stop logging players hanging up ([#97](https://github.com/DSestu/sestudio/issues/97)) ([785dcc8](https://github.com/DSestu/sestudio/commit/785dcc8288aaae6e34b5f67f5647e9cb1b9d3299))
* unlock vidzy streams past 90 s with its gate key, and stop hammering a refusing source ([#94](https://github.com/DSestu/sestudio/issues/94)) ([17281ad](https://github.com/DSestu/sestudio/commit/17281add6e77a6fb3b8487914e9cb25e67605c2f))


### Miscellaneous Chores

* add build.sh and build.bat to rebuild the frontend by hand ([#108](https://github.com/DSestu/sestudio/issues/108)) ([ddf4857](https://github.com/DSestu/sestudio/commit/ddf4857d965646e61ec45aff344724768e2b90d1))
* move Claude's repo memories into CLAUDE.md so they follow the repo ([#109](https://github.com/DSestu/sestudio/issues/109)) ([e6d5838](https://github.com/DSestu/sestudio/commit/e6d58387f0aad9074db423261cc2ba76f8e72e28))


### Performance improvements

* draw AI frames on TensorRT on NVIDIA, and convert them on the GPU ([#81](https://github.com/DSestu/sestudio/issues/81)) ([958f3ef](https://github.com/DSestu/sestudio/commit/958f3ef8ac4c1dc6ab462e5a0d9a0f989aebc364))
* stop building segments at a setting the player has left ([#86](https://github.com/DSestu/sestudio/issues/86)) ([10daff5](https://github.com/DSestu/sestudio/commit/10daff56e9be4ba98b0324decb9c79f4ab46cf23))

## [0.20.0](https://github.com/DSestu/sestudio/compare/v0.19.0...v0.20.0) (2026-10-23)


### New features

* encode live transcodes on the GPU when one is available ([#68](https://github.com/DSestu/sestudio/issues/68)) ([19e7187](https://github.com/DSestu/sestudio/commit/19e7187c83dd84d07b9433ad0394ec28b1d362b6))
* pick a quality for downloaded files, and let Auto drop it on a slow link ([#70](https://github.com/DSestu/sestudio/issues/70)) ([5f13245](https://github.com/DSestu/sestudio/commit/5f132450bbd1250150e112c69c5b8918b5ad9208))
* pick the quality a TV is sent, and change it while casting ([#71](https://github.com/DSestu/sestudio/issues/71)) ([1fd7b55](https://github.com/DSestu/sestudio/commit/1fd7b55e7317cf1eaa4f39e05eade26d964b972e))
* re-encode provider streams at every quality too, and send TVs one stream ([#74](https://github.com/DSestu/sestudio/issues/74)) ([563b3c4](https://github.com/DSestu/sestudio/commit/563b3c4d48d75091e861063e50f1b83e45b6805a))


### Bug fixes

* keep the cast quality selector after a page reload, and drop dead code ([#73](https://github.com/DSestu/sestudio/issues/73)) ([4b23ea0](https://github.com/DSestu/sestudio/commit/4b23ea021bd681405f28ddae69173db450c3b0e9))

## [0.19.0](https://github.com/DSestu/sestudio/compare/v0.18.0...v0.19.0) (2026-10-23)


### New features

* cast any downloaded file to a DLNA TV, re-encoded as it plays ([#67](https://github.com/DSestu/sestudio/issues/67)) ([0e8fc3f](https://github.com/DSestu/sestudio/commit/0e8fc3f782d4b2e0224e13d68ba5f4ca33ca753c))


### Bug fixes

* show the frame grab on Watching rows for unmatched downloads ([#65](https://github.com/DSestu/sestudio/issues/65)) ([40c54ef](https://github.com/DSestu/sestudio/commit/40c54ef2b95b700ac5fd851bc7e4683db7f8a005))

## [0.18.0](https://github.com/DSestu/sestudio/compare/v0.17.0...v0.18.0) (2026-10-19)


### New features

* allow deleting downloaded files only from a danger-zone setting ([#64](https://github.com/DSestu/sestudio/issues/64)) ([06c757c](https://github.com/DSestu/sestudio/commit/06c757c137061a36352f59233736542eae876929))
* explain what the player is waiting on when it stalls ([#59](https://github.com/DSestu/sestudio/issues/59)) ([1a85af8](https://github.com/DSestu/sestudio/commit/1a85af8a8eaabd9edfa3459148a1b33118ac0871))
* return to the same downloaded folder and filter when going back ([#63](https://github.com/DSestu/sestudio/issues/63)) ([cfec988](https://github.com/DSestu/sestudio/commit/cfec988f9653829ab8088bd385063d9b1a038030))
* show each step of a cast and why it failed ([#61](https://github.com/DSestu/sestudio/issues/61)) ([8bd16b2](https://github.com/DSestu/sestudio/commit/8bd16b2e8422b0949ed7d33ec0e0f88784d13dae))


### Bug fixes

* keep downloaded files playable when the media disk is asleep ([#57](https://github.com/DSestu/sestudio/issues/57)) ([25da0ab](https://github.com/DSestu/sestudio/commit/25da0ab2de7dea459c39b5ec79f42021108a07e7))
* keep the browser playing when casting to a TV fails ([#60](https://github.com/DSestu/sestudio/issues/60)) ([8da512b](https://github.com/DSestu/sestudio/commit/8da512b95792ce3ed36a0ea6fd66a0c0e45d747b))
* play a download with no language folder whatever site is open ([#62](https://github.com/DSestu/sestudio/issues/62)) ([bb187dd](https://github.com/DSestu/sestudio/commit/bb187dd9b7acc9275901288999d76deac00fe881))

## [0.17.0](https://github.com/DSestu/sestudio/compare/v0.16.3...v0.17.0) (2026-10-19)


### New features

* play files no browser opens by transcoding them as they are watched ([#55](https://github.com/DSestu/sestudio/issues/55)) ([f0f279c](https://github.com/DSestu/sestudio/commit/f0f279cf3ebb9c30bef48d2ecb9db486e7722e0f))


### Bug fixes

* keep downloaded playback working next to the explorer, and make AC-3 rips audible ([#53](https://github.com/DSestu/sestudio/issues/53)) ([3e0e291](https://github.com/DSestu/sestudio/commit/3e0e29121d2e903ffb2646bbf71f4e8179e49d89))
* restore vidzy and luluvid streams and downloads ([#56](https://github.com/DSestu/sestudio/issues/56)) ([168a0b6](https://github.com/DSestu/sestudio/commit/168a0b6ae1bdcb5bc2e33953898717134f4425d7))

## [0.16.3](https://github.com/DSestu/sestudio/compare/v0.16.2...v0.16.3) (2026-09-14)


### Bug fixes

* remount media provider on source-kind swap to unstick downloaded playback ([#51](https://github.com/DSestu/sestudio/issues/51)) ([93279c6](https://github.com/DSestu/sestudio/commit/93279c6372ea157f54b682aee8b8b7ef11211d7f))

## [0.16.2](https://github.com/DSestu/sestudio/compare/v0.16.1...v0.16.2) (2026-09-11)


### Bug fixes

* stop mobile layout scrolling horizontally ([bf8bcd5](https://github.com/DSestu/sestudio/commit/bf8bcd56ea1a50ecc9776f2c42ea5cb119ed258c))
* stop mobile layout scrolling horizontally ([#49](https://github.com/DSestu/sestudio/issues/49)) ([cc412e0](https://github.com/DSestu/sestudio/commit/cc412e004ab828051ebb278e6d3e113a1cfb839b))

## [0.16.1](https://github.com/DSestu/sestudio/compare/v0.16.0...v0.16.1) (2026-08-19)


### Bug fixes

* keep cast media on the page origin when serving HTTPS-only ([c4b3533](https://github.com/DSestu/sestudio/commit/c4b35335b569861f9cd58acf63e2e2d3de8c4225))

## [0.16.0](https://github.com/DSestu/sestudio/compare/v0.15.0...v0.16.0) (2026-08-18)


### New features

* add notifications & watch list ([9d2a75c](https://github.com/DSestu/sestudio/commit/9d2a75c17f1bef9b9da6f8c81e2545a8c54c9bcd))

## [0.15.0](https://github.com/DSestu/sestudio/compare/v0.14.0...v0.15.0) (2026-08-18)


### New features

* add local files in search ([bf3aea7](https://github.com/DSestu/sestudio/commit/bf3aea72dbd2e66a9e5de281c384c148d1fed99e))

## [0.14.0](https://github.com/DSestu/sestudio/compare/v0.13.1...v0.14.0) (2026-08-17)


### New features

* Add local folder and local playing ([7a4560a](https://github.com/DSestu/sestudio/commit/7a4560ac5ba564b9099aef41e84c50f2e0a2fa58))


### Bug fixes

* make senpai's non-faststart mp4s playable over DLNA ([#44](https://github.com/DSestu/sestudio/issues/44)) ([2c7f672](https://github.com/DSestu/sestudio/commit/2c7f6725825682bdfe43ea187aaee7868a0581ef))

## [0.13.1](https://github.com/DSestu/sestudio/compare/v0.13.0...v0.13.1) (2026-08-14)


### Bug fixes

* support vidzy's unpacked embed format and flexible src: spacing ([9c7ce8f](https://github.com/DSestu/sestudio/commit/9c7ce8fbd488db217a5ed68f0b4cd484fb2ded5a))

## [0.13.0](https://github.com/DSestu/sestudio/compare/v0.12.0...v0.13.0) (2026-08-07)


### New features

* dynamic resolving ([103c585](https://github.com/DSestu/sestudio/commit/103c5850e8f7a11c1c76493f17f02a113fee9250))

## [0.12.0](https://github.com/DSestu/sestudio/compare/v0.11.0...v0.12.0) (2026-08-06)


### New features

* abstract the stream site ([d856fa5](https://github.com/DSestu/sestudio/commit/d856fa524630298bc401acc586c7714e69c5b446))
* add new vidzy deobfuscation ([f8b9cab](https://github.com/DSestu/sestudio/commit/f8b9cab2a9c957fde9f1b0095a13c49c76ac84d7))
* multiple searches, added people search, added a provider ([44dcb1a](https://github.com/DSestu/sestudio/commit/44dcb1ac11753f561792077884bbbadac40e79b6))


### Miscellaneous Chores

* add tailscale doc ([f27a367](https://github.com/DSestu/sestudio/commit/f27a3670ec41fa886f59b077142037c47343a131))

## [0.11.0](https://github.com/DSestu/sestudio/compare/v0.10.1...v0.11.0) (2026-08-05)


### New features

* trigger release please ([fbc0397](https://github.com/DSestu/sestudio/commit/fbc039734e20a8ece19d9b05acb03df806642053))

## [0.10.1](https://github.com/DSestu/sestudio/compare/v0.10.0...v0.10.1) (2026-08-05)


### Code refactoring

* improve library ([bea0da2](https://github.com/DSestu/sestudio/commit/bea0da2a8bb89a4b1a3ac1c6993dd312e1b1e266))

## [0.10.0](https://github.com/DSestu/sestudio/compare/v0.9.0...v0.10.0) (2026-08-05)


### New features

* detailed view in search ([0226a99](https://github.com/DSestu/sestudio/commit/0226a99085f92489c8b912ccd379d1772a6be478))
* voe filmoon providers ([#38](https://github.com/DSestu/sestudio/issues/38)) ([4ce9ba5](https://github.com/DSestu/sestudio/commit/4ce9ba52937369c9ce2315a915db913070b40afa))


### Bug fixes

* **vidzy:** execute embeds' inline decoder instead of modelling it ([e51b4f9](https://github.com/DSestu/sestudio/commit/e51b4f9495346548f4f9a5032c2376ecbc2b0abb))

## [0.9.0](https://github.com/DSestu/sestudio/compare/v0.8.0...v0.9.0) (2026-08-04)


### New features

* Improve TMDB experience ([#36](https://github.com/DSestu/sestudio/issues/36)) ([2162e22](https://github.com/DSestu/sestudio/commit/2162e22aee77f4937d3b506e0c92b60adbaf082b))
* settings page and TMDB key ([5d4176a](https://github.com/DSestu/sestudio/commit/5d4176aeee04042bfac167dbe14cd31c8fe29278))


### Bug fixes

* search duplicates ([#35](https://github.com/DSestu/sestudio/issues/35)) ([98f16b5](https://github.com/DSestu/sestudio/commit/98f16b53baf62f0798c975e29369a4d6c8694cba))


### Code refactoring

* Add select all button in favorites ([#33](https://github.com/DSestu/sestudio/issues/33)) ([1f7fc27](https://github.com/DSestu/sestudio/commit/1f7fc27936f6e04c28e1382c937da642b87cbbb6))
* layout of tmdb ([2f93c6e](https://github.com/DSestu/sestudio/commit/2f93c6e9f2bde0f3669c4dc2b8219d5ffa280b9b))

## [0.8.0](https://github.com/DSestu/sestudio/compare/v0.7.1...v0.8.0) (2026-08-04)


### New features

* Improve watching lists ([#30](https://github.com/DSestu/sestudio/issues/30)) ([8c26c8d](https://github.com/DSestu/sestudio/commit/8c26c8d49f42e150aef1643feca2f338f4e6d7cb))


### Bug fixes

* Decode Vidzy embeds across rotating obfuscation schemes ([#32](https://github.com/DSestu/sestudio/issues/32)) ([767496b](https://github.com/DSestu/sestudio/commit/767496b33fc6c80551e26b88dcd9dd3d3e6add86))

## [0.7.1](https://github.com/DSestu/sestudio/compare/v0.7.0...v0.7.1) (2026-08-03)


### Code refactoring

* Put all user data server-side ([#27](https://github.com/DSestu/sestudio/issues/27)) ([b087d63](https://github.com/DSestu/sestudio/commit/b087d6331d1e2c7ccae7f954b02e1ddce7eb2f45))

## [0.7.0](https://github.com/DSestu/sestudio/compare/v0.6.2...v0.7.0) (2026-08-03)


### New features

* Add miniplayer ([#25](https://github.com/DSestu/sestudio/issues/25)) ([5058194](https://github.com/DSestu/sestudio/commit/505819446081c76e5fc5412a136248b5cee0f090))
* Improve casting interface ([#22](https://github.com/DSestu/sestudio/issues/22)) ([4493f67](https://github.com/DSestu/sestudio/commit/4493f67c3554c9e4ffb3de28d8af68e8d18aac5a))

## [0.6.2](https://github.com/DSestu/sestudio/compare/v0.6.1...v0.6.2) (2026-08-02)


### Bug fixes

* Launching command ([3d4667d](https://github.com/DSestu/sestudio/commit/3d4667da397abd78d08e3e9cc6bd49a23a390249))

## [0.6.1](https://github.com/DSestu/sestudio/compare/v0.6.0...v0.6.1) (2026-08-02)


### Code refactoring

* set serve as default command ([6ba60bf](https://github.com/DSestu/sestudio/commit/6ba60bf837b850f327679937492963465d45acff))

## [0.6.0](https://github.com/DSestu/sestudio/compare/v0.5.0...v0.6.0) (2026-08-02)


### New features

* Refactor app layout ([#16](https://github.com/DSestu/sestudio/issues/16)) ([b0cfceb](https://github.com/DSestu/sestudio/commit/b0cfceb0b84fbf1e78c0edb2ac53d27cc0dbb029))

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

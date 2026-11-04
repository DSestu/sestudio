# Changelog

## [1.9.0](https://github.com/DSestu/sestudio/compare/v1.8.0...v1.9.0) (2026-11-04)


### New features

* a lab flag and an empty music lab page for building the music player ([#249](https://github.com/DSestu/sestudio/issues/249)) ([dffe971](https://github.com/DSestu/sestudio/commit/dffe971431c5bd569b741af11c5e4179c4aac967))
* a station spike renders the music player headless at 1080p and encodes it, with measured CPU and frame rate ([#267](https://github.com/DSestu/sestudio/issues/267)) ([2309f51](https://github.com/DSestu/sestudio/commit/2309f51671785140d99240d7315daf594f1b1d2b))
* audio files in the downloads folder show up as music tracks with titles, artists and stable ids ([#250](https://github.com/DSestu/sestudio/issues/250)) ([0225782](https://github.com/DSestu/sestudio/commit/02257826b849bcb4c470d94cbc18aeb7ef4a853f))
* behind the music timeline, a blurred live spectrum glows in the Abyss palette, brighter on the drops (lab) ([#260](https://github.com/DSestu/sestudio/issues/260)) ([2b9bb4e](https://github.com/DSestu/sestudio/commit/2b9bb4ee21ba0a8f6b49123ee449d6e00ffdefda))
* casting music sends one continuous stream mixed on the server, with the player's picture rendered for the TV ([#269](https://github.com/DSestu/sestudio/issues/269)) ([cd727b2](https://github.com/DSestu/sestudio/commit/cd727b2e05cd5f1b6f20e7d71894ee72bcb48817))
* Downloads and Music settings become grouped rows; ranked chips are numbered pills ([#282](https://github.com/DSestu/sestudio/issues/282)) ([2becf38](https://github.com/DSestu/sestudio/commit/2becf38f1906fb8a14756d6cf410fcbbeeb26ba9))
* every music track is analysed once in the background for its bands, loudness, colour and tempo ([#253](https://github.com/DSestu/sestudio/issues/253)) ([092daa7](https://github.com/DSestu/sestudio/commit/092daa72789c016cfdd4d1d9815220201dc717ff))
* music analysis also finds each track's key, genre, energy and structure (intro, buildup, drop, breakdown, outro) ([#258](https://github.com/DSestu/sestudio/issues/258)) ([177634a](https://github.com/DSestu/sestudio/commit/177634a839e130d5eeb10c11db2c50b3e2f2e8ec))
* music can come from several libraries, including other folders, another sestudio server and a YouTube Music account ([#262](https://github.com/DSestu/sestudio/issues/262)) ([832a688](https://github.com/DSestu/sestudio/commit/832a6884173fe9fe6395e993daeb56a0c225f64b))
* music casts to Chromecast and DLNA as one continuous stream, with TV volume control from the player ([#270](https://github.com/DSestu/sestudio/issues/270)) ([74fbe02](https://github.com/DSestu/sestudio/commit/74fbe02230cedba5f892cf1ba36f58d1d35c2b91))
* music genres come from file tags and source metadata, then an offline Discogs model, before the old rules ([#274](https://github.com/DSestu/sestudio/issues/274)) ([d2254e7](https://github.com/DSestu/sestudio/commit/d2254e78ae7e69c75d5a9eb89b0acfd680f12828))
* music libraries are picked from a folder browser, and the Android app adds the phone's Music and Download folders by itself ([#268](https://github.com/DSestu/sestudio/issues/268)) ([15cf9ab](https://github.com/DSestu/sestudio/commit/15cf9ab4eb0a64ce5c127827d5b0d7c05726cb41))
* music playlists live in folders, can be split into parts as DJ sets, and smart lists fill themselves by genre and tempo ([#259](https://github.com/DSestu/sestudio/issues/259)) ([86fbd9d](https://github.com/DSestu/sestudio/commit/86fbd9d5da6aa5bdc42d1797227c579cdc620a55))
* music plays in a full-screen player layer with a player bar on every page (lab) ([#255](https://github.com/DSestu/sestudio/issues/255)) ([3631590](https://github.com/DSestu/sestudio/commit/3631590383676121ba0885c9a7ddfa3e34598a88))
* music search shows each source's results as soon as it answers ([#285](https://github.com/DSestu/sestudio/issues/285)) ([37e4d11](https://github.com/DSestu/sestudio/commit/37e4d1184036c2c21eaedaa102e9e5656b552e80))
* music transitions can mix on the beat with tempo match and bass swap, and the Music tab is out of the lab ([#261](https://github.com/DSestu/sestudio/issues/261)) ([cb5c55a](https://github.com/DSestu/sestudio/commit/cb5c55a4227fef53674e4c2c40f4fda17a9f604b))
* Playback and Subtitles settings become grouped rows with one line of help each ([#280](https://github.com/DSestu/sestudio/issues/280)) ([8cdff17](https://github.com/DSestu/sestudio/commit/8cdff178c1f0ad98d05a3bff7a42565df685d23f))
* playlists open as DJ sets with a tempo and energy curve, auto-ordering, filling from the library, and mixes that avoid drops ([#265](https://github.com/DSestu/sestudio/issues/265)) ([4e25d3f](https://github.com/DSestu/sestudio/commit/4e25d3fd6d723942e00d636f7edc948187183041))
* Server and Share settings become grouped rows ([#283](https://github.com/DSestu/sestudio/issues/283)) ([ffb672a](https://github.com/DSestu/sestudio/commit/ffb672a0fb28401861d62ee8ebcad4407d360dad))
* Settings opens on a list of categories, each its own page; desktop lists them beside the page ([#279](https://github.com/DSestu/sestudio/issues/279)) ([320afc6](https://github.com/DSestu/sestudio/commit/320afc68ece8f4d7709cae37752e462a519fd868))
* Settings' list says what each category is set to, and flags what needs fixing ([#284](https://github.com/DSestu/sestudio/issues/284)) ([4ab765b](https://github.com/DSestu/sestudio/commit/4ab765b5c2b823943d305bba3731856cdad62fa4))
* Sources & search and Notifications settings become grouped rows ([#281](https://github.com/DSestu/sestudio/issues/281)) ([82d7fde](https://github.com/DSestu/sestudio/commit/82d7fde92fcb88fbe8e8e0384a1ce56873e73cbe))
* the lab Music tab lists albums, artists and tracks from the library and plays them into the queue ([#254](https://github.com/DSestu/sestudio/issues/254)) ([4ed51fa](https://github.com/DSestu/sestudio/commit/4ed51faa91ef4d77e0dec84eb781723c95e16e3e))
* the music background follows the track's energy (the Drive look, now the default) ([#287](https://github.com/DSestu/sestudio/issues/287)) ([0762ac2](https://github.com/DSestu/sestudio/commit/0762ac29a9431e7150d34831e986903d3c1ec957))
* the music player draws the whole queue as one continuous bass, mids and highs timeline (lab) ([#257](https://github.com/DSestu/sestudio/issues/257)) ([337a0c1](https://github.com/DSestu/sestudio/commit/337a0c1c70e283d914134ed347e58262e85f1cc3))
* the music player pins its queue into an expanded stage view with one continuous 620 ms motion ([#266](https://github.com/DSestu/sestudio/issues/266)) ([8a2d95d](https://github.com/DSestu/sestudio/commit/8a2d95d75099755bd1067f485f2f9e30febcbab5))
* the music queue lives on the server and pushes every change to all screens ([#252](https://github.com/DSestu/sestudio/issues/252)) ([90598e2](https://github.com/DSestu/sestudio/commit/90598e2997266e4fe77688757d10727d54f08c1d))
* the music search looks through your library, YouTube Music, YouTube and SoundCloud at once, or one source at a time ([#264](https://github.com/DSestu/sestudio/issues/264)) ([1c9e1f3](https://github.com/DSestu/sestudio/commit/1c9e1f301eb2d4fda08f0b70abe2b874eb97f022))
* the music timeline glides when a transition changes and follows the seek bar, and the player gets a volume slider ([#290](https://github.com/DSestu/sestudio/issues/290)) ([91463c8](https://github.com/DSestu/sestudio/commit/91463c8f348124449e52b5c2309145943422f859))
* the music timeline scrubs and glides, the queue animates every add, remove and reorder, and an add panel finds tracks ([#263](https://github.com/DSestu/sestudio/issues/263)) ([b43d744](https://github.com/DSestu/sestudio/commit/b43d744928eec9a67a4899641a0329e0796ac3c5))
* with the lab flag on, the nav gains a Music tab and Activity moves to a bell in the top card ([#251](https://github.com/DSestu/sestudio/issues/251)) ([a45a423](https://github.com/DSestu/sestudio/commit/a45a423059f3c7c0d56ab839e62459f8c2394b13))
* YouTube and YouTube Music links play as music, download as audio only, and playlists fill the queue ([#256](https://github.com/DSestu/sestudio/issues/256)) ([c57194a](https://github.com/DSestu/sestudio/commit/c57194a2c82bc82a7cb6fd82498da60ea5f96312))


### Bug fixes

* a video that cannot be looked up is asked for once, not on every route and retry ([#242](https://github.com/DSestu/sestudio/issues/242)) ([8c612d6](https://github.com/DSestu/sestudio/commit/8c612d670f3227c21e80640048ce8e545c3d42bf))
* **android:** setup requires notifications and all files access, so the server sees the phone's real folders ([#289](https://github.com/DSestu/sestudio/issues/289)) ([423830e](https://github.com/DSestu/sestudio/commit/423830eb28adbee37846036d215fe00d87a3cd43))
* on phones the search header leaves with the top card when scrolling down, instead of leaving a gap above it ([#244](https://github.com/DSestu/sestudio/issues/244)) ([db2aa42](https://github.com/DSestu/sestudio/commit/db2aa4233cfb7130b098af8237d41e56b5e00551))
* the bass under the timeline is a sharp spline like the mids and highs, with no blur pass ([#277](https://github.com/DSestu/sestudio/issues/277)) ([635ff39](https://github.com/DSestu/sestudio/commit/635ff397c27ea1d36868acb4ad7a4208572bd120))
* the bass under the timeline is blurred smooth again instead of drawn in 4 px steps ([#276](https://github.com/DSestu/sestudio/issues/276)) ([4d7162b](https://github.com/DSestu/sestudio/commit/4d7162b8ce98b0d67f8fc27e4649dac535978f9e))
* the built app carries the genre tooltips and the Settings toggle of the genre model ([#275](https://github.com/DSestu/sestudio/issues/275)) ([f124a70](https://github.com/DSestu/sestudio/commit/f124a709e6dfa5c2d72acf636da5ff6179e33401))
* the music background follows every display frame again, so hits land with the punch it was tuned for ([#273](https://github.com/DSestu/sestudio/issues/273)) ([3d558ae](https://github.com/DSestu/sestudio/commit/3d558ae36c917076f40f2d0c2570f9fa48ff5a3e))
* the music page keeps you where you are: Back closes the player, a tap plays without taking over, albums and artists get their own pages ([#286](https://github.com/DSestu/sestudio/issues/286)) ([bab2142](https://github.com/DSestu/sestudio/commit/bab21429fdc32d3ee34606bacb8712d2f0fdf83c))
* the music player matches the prototype again and draws with far less CPU ([#272](https://github.com/DSestu/sestudio/issues/272)) ([c3be89f](https://github.com/DSestu/sestudio/commit/c3be89f5513fe15b01649b2bbe0071c67b5441cd))


### Miscellaneous Chores

* the start scripts rebuild the frontend before serving ([#278](https://github.com/DSestu/sestudio/issues/278)) ([6df1fa5](https://github.com/DSestu/sestudio/commit/6df1fa5dfcddbbd1c523cffab0b3a0e072a3054f))


### Documentation

* spec for music as a media kind, with the stage, the queue and a TV station that crossfades tracks in one stream ([#245](https://github.com/DSestu/sestudio/issues/245)) ([5726532](https://github.com/DSestu/sestudio/commit/5726532549dbaabea7e5ead9efca1762742f5b50))
* the music audio prototype and its data scripts live in docs/proto/music ([#248](https://github.com/DSestu/sestudio/issues/248)) ([fe8b11f](https://github.com/DSestu/sestudio/commit/fe8b11f1249ff9dc1dfeff9a5e18c3d36f88e34c))
* the music player spec now matches the audio prototype, with a 22-PR implementation plan ([#247](https://github.com/DSestu/sestudio/issues/247)) ([8db4453](https://github.com/DSestu/sestudio/commit/8db4453be806a7d967a732436d22fabaa8671c79))


### Performance improvements

* music analysis decodes each file once for its 8 bands (about 5x faster) ([#288](https://github.com/DSestu/sestudio/issues/288)) ([4278878](https://github.com/DSestu/sestudio/commit/427887801dd96e863170e265701a78cb90e9320b))


### Test improvements

* the station test probes its captured stream from a file and says why when ffmpeg finds no streams ([#271](https://github.com/DSestu/sestudio/issues/271)) ([6d58b77](https://github.com/DSestu/sestudio/commit/6d58b772207dd7cbda0f6e1ac567cc377902957f))

## [1.8.0](https://github.com/DSestu/sestudio/compare/v1.7.0...v1.8.0) (2026-11-02)


### New features

* new sestudio logo, an S and a D drawn from two stacked circles, on the favicon, sidebar, web app and Android icons ([#241](https://github.com/DSestu/sestudio/issues/241)) ([6b64215](https://github.com/DSestu/sestudio/commit/6b642159f3443475051024439e3c4e6974d5ff02))
* warn when the firewall keeps phones and TVs out, and keep casting working across network changes ([#239](https://github.com/DSestu/sestudio/issues/239)) ([77ddc49](https://github.com/DSestu/sestudio/commit/77ddc49b492d0386dc2e57b50808efd04b7825ee))


### Bug fixes

* a player error reloads the source, then resolves it again, before the source counts as dead ([#234](https://github.com/DSestu/sestudio/issues/234)) ([d141c04](https://github.com/DSestu/sestudio/commit/d141c04b8bab709b67351aaad58f137f6f053d04))
* a Twitch live stream casts to a DLNA TV ([#228](https://github.com/DSestu/sestudio/issues/228)) ([2a7f342](https://github.com/DSestu/sestudio/commit/2a7f342fed215c602c05b1c170d6cf25d8a01a9c))
* navigating fast no longer hangs the server until it is restarted ([#240](https://github.com/DSestu/sestudio/issues/240)) ([05acce7](https://github.com/DSestu/sestudio/commit/05acce7f6117da7da5a85ac49b508736d39f1daf))
* on phones a carousel's right-edge fade is 2.5rem, not a third of the screen ([#238](https://github.com/DSestu/sestudio/issues/238)) ([c259a4e](https://github.com/DSestu/sestudio/commit/c259a4ef7ae00cdc10bd9540a41fa83d1327be32))
* on phones Continue watching grows with its content, while desktop keeps widgets side by side the same height ([#236](https://github.com/DSestu/sestudio/issues/236)) ([10934ad](https://github.com/DSestu/sestudio/commit/10934ad73c7211c18ca87c45f00fd86beea258aa))
* on phones Continue watching is as short as the titles it holds ([#231](https://github.com/DSestu/sestudio/issues/231)) ([547e521](https://github.com/DSestu/sestudio/commit/547e52103ec6c8182fd68fa81eb62256c2d8b101))
* on phones the cast bar, its controls, the Discover menu and the dock join into one rounded shape, squared where they meet ([#237](https://github.com/DSestu/sestudio/issues/237)) ([0961d09](https://github.com/DSestu/sestudio/commit/0961d092672eff5b3270c251943a9933faadba0e))
* the Android app waits for the HTTPS port before opening sestudio, and a terminal launch opens the browser once the server is ready ([#233](https://github.com/DSestu/sestudio/issues/233)) ([df97c41](https://github.com/DSestu/sestudio/commit/df97c4172266f68e4b97ed44203f11069edc239a))
* the Android notification's Stop kills the server, so the next start runs its latest version ([#230](https://github.com/DSestu/sestudio/issues/230)) ([059e290](https://github.com/DSestu/sestudio/commit/059e290d806432802b01624dbdec43ed8ad76934))
* the cast controls rise out of the Now Casting bar instead of wiping down from their top ([#229](https://github.com/DSestu/sestudio/issues/229)) ([6c4e30b](https://github.com/DSestu/sestudio/commit/6c4e30b8acf40ce6d0460eb113372673c4a46b67))
* the cast controls stay on the Now Casting bar while they open, instead of floating above it and dropping into place ([#235](https://github.com/DSestu/sestudio/issues/235)) ([55ab044](https://github.com/DSestu/sestudio/commit/55ab0444df0717bddf1183a9ab79930d105f846b))
* the rail's Discover flyout stays open when a finger taps into it ([#227](https://github.com/DSestu/sestudio/issues/227)) ([d69e2f8](https://github.com/DSestu/sestudio/commit/d69e2f83c1f72da62d4bd4ab508b8a9d177b037b))
* the watch page's playlist column is pinned to the viewport below the header card, so the two always move together ([#232](https://github.com/DSestu/sestudio/issues/232)) ([8a49462](https://github.com/DSestu/sestudio/commit/8a4946229685ba1cc97a5609f3d3defb61e0ddc6))
* the watch page's playlist column sticks below the header card instead of sliding under it ([#225](https://github.com/DSestu/sestudio/issues/225)) ([4a0f592](https://github.com/DSestu/sestudio/commit/4a0f5928b42cac6374e3e72d0fe9e8531273cea6))

## [1.7.0](https://github.com/DSestu/sestudio/compare/v1.6.0...v1.7.0) (2026-11-02)


### New features

* a film or a video on the watch page drops the one-row playlist: similar titles or more from its channel on the right, Download beside the controls ([#223](https://github.com/DSestu/sestudio/issues/223)) ([d45a383](https://github.com/DSestu/sestudio/commit/d45a383ec1c3329226476ace79b2ec41dee4550a))
* a Nightly switch in the Android app's Settings runs the server on GitHub's main instead of the latest release ([#219](https://github.com/DSestu/sestudio/issues/219)) ([beba4dc](https://github.com/DSestu/sestudio/commit/beba4dcdb8f55dacc2b3334bb7fdd095dd9aca6e))
* the watch playlist starts folded into its rail, and every season's episodes are loaded in the background so their counts show ([#224](https://github.com/DSestu/sestudio/issues/224)) ([1846854](https://github.com/DSestu/sestudio/commit/1846854de636a6c889d2dfa5e21210d0538f21f6))

## [1.6.0](https://github.com/DSestu/sestudio/compare/v1.5.0...v1.6.0) (2026-11-02)


### New features

* an empty Home opens on a welcome lit by trending posters, with two tiles that show what is still to come ([#212](https://github.com/DSestu/sestudio/issues/212)) ([681e70a](https://github.com/DSestu/sestudio/commit/681e70af32232512e55ea349c10f069216cb84ea))
* Home lists your series' episodes airing this week, with a button to be told when the VF lands ([#208](https://github.com/DSestu/sestudio/issues/208)) ([8b4d940](https://github.com/DSestu/sestudio/commit/8b4d94033553fb9894081f08b330a1f2bbb01f67))
* Home shows a health widget only when something is wrong, and a quiet All good line otherwise ([#209](https://github.com/DSestu/sestudio/issues/209)) ([dd21e7c](https://github.com/DSestu/sestudio/commit/dd21e7c31ead2247067a0ca8bd840e78b53509cf))
* Home shows the download queue filling its frame, and what is saved on this device ([#213](https://github.com/DSestu/sestudio/issues/213)) ([8f94db0](https://github.com/DSestu/sestudio/commit/8f94db0ad1eecb9599994681f8d5a6b0689f03c2))
* Home shows the latest videos from your channels, marked when they are new since your last visit ([#210](https://github.com/DSestu/sestudio/issues/210)) ([6c87812](https://github.com/DSestu/sestudio/commit/6c8781260359ac166e247430e4a24f9fab071a10))
* Home suggests titles like one you watched, lit by the top pick's own poster ([#207](https://github.com/DSestu/sestudio/issues/207)) ([ec2b310](https://github.com/DSestu/sestudio/commit/ec2b310c3c911a8da640214775b8e50f0430a52a))
* Home's live channels and new episodes become half-width widgets instead of a full-width feed ([#205](https://github.com/DSestu/sestudio/issues/205)) ([e4a37b6](https://github.com/DSestu/sestudio/commit/e4a37b6fcd66ab59f0e306d276265451b1be4b34))
* playing an episode from another season of the watch playlist keeps the page and the player in place instead of reloading it ([#218](https://github.com/DSestu/sestudio/issues/218)) ([b6a704a](https://github.com/DSestu/sestudio/commit/b6a704a65ab6c82bf51c92bc93a2e04d24a8a296))
* the Android app installs on 32-bit ARM, x86_64 and 16 KB-page phones, and on kernels where proot's seccomp mode fails ([#217](https://github.com/DSestu/sestudio/issues/217)) ([49ae00d](https://github.com/DSestu/sestudio/commit/49ae00d4a577a5844cd28c956ca79453ae29c4a5))
* the collapsed watch playlist is a glass rail that opens over the player on hover, with a pin and a click on its header to keep it open ([#221](https://github.com/DSestu/sestudio/issues/221)) ([948b6e9](https://github.com/DSestu/sestudio/commit/948b6e9d5e2c25f1386faa88e25949e1cd9ba913))
* the watch page joins the glass header: title, status and a ⋯ menu, sliding-pill tabs on phones ([#214](https://github.com/DSestu/sestudio/issues/214)) ([56b8e42](https://github.com/DSestu/sestudio/commit/56b8e42f5ad22069c5e4f13880c9500456582172))
* the watch playlist lists every season in one accordion that opens in place, with pills that scroll to a season on the first click ([#216](https://github.com/DSestu/sestudio/issues/216)) ([3ead933](https://github.com/DSestu/sestudio/commit/3ead93388d4559ffe2d55fe923ae26c95dba4073))


### Bug fixes

* HTML entities in episode titles, even encoded twice, show as the characters they stand for ([#220](https://github.com/DSestu/sestudio/issues/220)) ([f87cb73](https://github.com/DSestu/sestudio/commit/f87cb735333148c67451aaf4d7f6bf1ae850ee8b))
* the phone top card slides away while the search sheet is full screen, so it no longer covers the search field ([#215](https://github.com/DSestu/sestudio/issues/215)) ([6be859e](https://github.com/DSestu/sestudio/commit/6be859ead0e1dbc96e0fb63d20fb2b2004fcd811))

## [1.5.0](https://github.com/DSestu/sestudio/compare/v1.4.0...v1.5.0) (2026-11-01)


### New features

* a "glass" style for the coming nav redesign, and its spec ([#182](https://github.com/DSestu/sestudio/issues/182)) ([04c2741](https://github.com/DSestu/sestudio/commit/04c27410ed58b1e042120a1d7b85f495fc31d9c8))
* a glass top card on phones that carries each page's name, status, actions and tabs, in a flatter look ([#189](https://github.com/DSestu/sestudio/issues/189)) ([9f1cf7b](https://github.com/DSestu/sestudio/commit/9f1cf7b63fb15e390344e564e70ee5e7997ad82a))
* Activity, YouTube & Twitch, channels and people get the phone top card too ([#192](https://github.com/DSestu/sestudio/issues/192)) ([5991828](https://github.com/DSestu/sestudio/commit/599182818e8c0c30e1a3b54e1ba0798bc07d45dc))
* desktop gets a slim glass rail with Search on top and Discover opening beside it ([#195](https://github.com/DSestu/sestudio/issues/195)) ([e82ed0d](https://github.com/DSestu/sestudio/commit/e82ed0dd12b130d390faa129283a324cbe0b3b65))
* desktop's mini-player and casting bar become floating glass docks, and the phone Search sheet unblurs as it opens ([#197](https://github.com/DSestu/sestudio/issues/197)) ([a1f5097](https://github.com/DSestu/sestudio/commit/a1f50977dc9f4befc2e47cfa17c0c099995919c5))
* Downloaded and Downloads become one Media destination, with Collection and Queue tabs ([#179](https://github.com/DSestu/sestudio/issues/179)) ([1519165](https://github.com/DSestu/sestudio/commit/151916539d6b20dad8932aebbe2b24ef2cbb6cf0))
* Home becomes a grid of widgets, led by Continue watching with its progress on the frame ([#190](https://github.com/DSestu/sestudio/issues/190)) ([1c785d2](https://github.com/DSestu/sestudio/commit/1c785d2f701c71c6b769d296e9673a18ad0c12cc))
* Home opens on a strip of what needs you now: live channels, today's episodes, finished downloads and problems ([#202](https://github.com/DSestu/sestudio/issues/202)) ([95053d2](https://github.com/DSestu/sestudio/commit/95053d2b2358af93fb90394c7ccf30fa134eedb7))
* on desktop the search moves into each page's glass card, which slides away while scrolling ([#196](https://github.com/DSestu/sestudio/issues/196)) ([d0340df](https://github.com/DSestu/sestudio/commit/d0340df6476f23996f1aa1e6338947fcd5009724))
* on phones the mini-player and the casting bar join the dock as one glass object ([#185](https://github.com/DSestu/sestudio/issues/185)) ([e80e378](https://github.com/DSestu/sestudio/commit/e80e37849feb60284de53aa1ebc09a9f67dd46e0))
* on phones the top card and the dock slide away while scrolling down ([#194](https://github.com/DSestu/sestudio/issues/194)) ([fd76d3c](https://github.com/DSestu/sestudio/commit/fd76d3cef4c6c1380e3791d0f42bbaac8c1c902d))
* Search and Discover open more softly, the dock always meets the mini-player, and the top card stays off the playing video ([#203](https://github.com/DSestu/sestudio/issues/203)) ([1707081](https://github.com/DSestu/sestudio/commit/170708120fe2eba5708d18929608d2320d663a58))
* the desktop search's results panel slides open and closed instead of popping ([#204](https://github.com/DSestu/sestudio/issues/204)) ([b24656a](https://github.com/DSestu/sestudio/commit/b24656a2993b1529e8be763f723650d3220e4fd5))
* the phone's tab bar becomes a floating glass dock, with Search in the middle ([#184](https://github.com/DSestu/sestudio/issues/184)) ([157fee5](https://github.com/DSestu/sestudio/commit/157fee5d1eb1a8afb7aa689f28e5185bc8e01809))
* the server lists followed series' episodes airing in the next 7 days, for Home's Upcoming widget ([#187](https://github.com/DSestu/sestudio/issues/187)) ([d9df3d2](https://github.com/DSestu/sestudio/commit/d9df3d276d1ecca2ad4aa2d3fc3fae3b5198c75c))
* the server recommends titles like the last five you watched, kept only when a site carries them ([#188](https://github.com/DSestu/sestudio/issues/188)) ([8d3b9f0](https://github.com/DSestu/sestudio/commit/8d3b9f083c72a069ce0d7db8f2c55d5e447d7b7f))
* the server reports site reachability, failing watchers and free disk in one health check ([#186](https://github.com/DSestu/sestudio/issues/186)) ([2b7cd51](https://github.com/DSestu/sestudio/commit/2b7cd51632cdfbf8fe5ca87330cd1385c026a3de))
* YouTube and Twitch play at their own qualities, fetching only the one picked ([#193](https://github.com/DSestu/sestudio/issues/193)) ([b5006b7](https://github.com/DSestu/sestudio/commit/b5006b75ad5ce67ce0658ebb684e38097a3b3d3e))


### Bug fixes

* a long title on the watch page wraps instead of ending in an ellipsis ([#206](https://github.com/DSestu/sestudio/issues/206)) ([5b88e00](https://github.com/DSestu/sestudio/commit/5b88e00263c37cd70b928cf112d50763069c6d5c))
* a long video title no longer makes the phone watch page wider than the screen ([#181](https://github.com/DSestu/sestudio/issues/181)) ([7a67a53](https://github.com/DSestu/sestudio/commit/7a67a538f8020c07b5854540982446e02bcf2fdf))
* DLNA casts of YouTube and Twitch play on LG TVs: the TV gets a short stream URL ([#191](https://github.com/DSestu/sestudio/issues/191)) ([8d1ccdf](https://github.com/DSestu/sestudio/commit/8d1ccdff0fc531b4f346bb6143948fb0e8fa6bdb))
* Home's widgets line up side by side, and a video in Continue watching shows its thumbnail ([#199](https://github.com/DSestu/sestudio/issues/199)) ([2c8c991](https://github.com/DSestu/sestudio/commit/2c8c991ba4a44c8e912e3f68114f776c2c5a23c9))
* on phones Continue watching is no taller than its content ([#201](https://github.com/DSestu/sestudio/issues/201)) ([de5bc93](https://github.com/DSestu/sestudio/commit/de5bc93630312996e9d89e84e747b1b43cb0c99c))
* YouTube and Twitch play on a Chromecast, and the Server log opens in the Android app ([#198](https://github.com/DSestu/sestudio/issues/198)) ([95e5b0d](https://github.com/DSestu/sestudio/commit/95e5b0d2e539fa9b621ecc5363b8334e3f19e5bb))


### Documentation

* Home's first run opens on a welcome hero and two ghost tiles ([#200](https://github.com/DSestu/sestudio/issues/200)) ([e2d5e99](https://github.com/DSestu/sestudio/commit/e2d5e996e7ed68c6bfd70570aa0c4c72412ba8af))
* spec and PR plan for the Home dashboard redesign ([#183](https://github.com/DSestu/sestudio/issues/183)) ([8952680](https://github.com/DSestu/sestudio/commit/8952680e9028f1cd56397c09bd9f047263eb1dc7))

## [1.4.0](https://github.com/DSestu/sestudio/compare/v1.3.0...v1.4.0) (2026-11-01)


### New features

* Chromecast from the Android app, Stop in its Server log, and a picture-in-picture video that fits ([#178](https://github.com/DSestu/sestudio/issues/178)) ([5b8a416](https://github.com/DSestu/sestudio/commit/5b8a416b4294210f4423cbdef4ad11c0e0e22150))
* picture-in-picture, background play and phone downloads in the Android app, and a sestudio-dev build beside it ([#176](https://github.com/DSestu/sestudio/issues/176)) ([0446537](https://github.com/DSestu/sestudio/commit/0446537ca3cee1fec11357624d9908c2d5eb591c))
* the Server log in Settings looks and works like a terminal: status, uptime, Copy, Restart, Stop ([#177](https://github.com/DSestu/sestudio/issues/177)) ([4eb6835](https://github.com/DSestu/sestudio/commit/4eb6835afde669f1d69273f99bb9c57435c90367))


### Bug fixes

* give the phone header room for the screen's safe area instead of squashing it ([#174](https://github.com/DSestu/sestudio/issues/174)) ([d9eee44](https://github.com/DSestu/sestudio/commit/d9eee44244eee4d0c59b9e5f538dd4bd3df4ddf8))

## [1.3.0](https://github.com/DSestu/sestudio/compare/v1.2.0...v1.3.0) (2026-11-01)


### New features

* an Android app QR code beside the Colab one in Settings → Share sestudio ([#172](https://github.com/DSestu/sestudio/issues/172)) ([36c2eca](https://github.com/DSestu/sestudio/commit/36c2eca427e9da5f80a6aefd2dbacfc0fc2dc4b4))
* attach the Android app to every release as sestudio.apk, signed with the release key ([#167](https://github.com/DSestu/sestudio/issues/167)) ([b154716](https://github.com/DSestu/sestudio/commit/b154716e14ff1d9d2ecb2c757400e87aaded7f8a))
* the Android app shows sestudio at the phone's Wi-Fi address over HTTPS, with fullscreen video ([#168](https://github.com/DSestu/sestudio/issues/168)) ([e65a0f0](https://github.com/DSestu/sestudio/commit/e65a0f078230ba338379435bc6a4f2f8efba0155))


### Bug fixes

* say why a Twitch broadcast will not play, and start YouTube videos on their original audio instead of an AI dub ([#170](https://github.com/DSestu/sestudio/issues/170)) ([b703b33](https://github.com/DSestu/sestudio/commit/b703b33fed1864c7422ca1031451b0d811a9d780))
* stop phone pages being 6 px wider than the screen, which let them slide up and down ([#173](https://github.com/DSestu/sestudio/issues/173)) ([df02015](https://github.com/DSestu/sestudio/commit/df020153d9bbe083ee33ce300dc998e31205e374))


### Documentation

* lead the README with the three ways to run sestudio, the Android app's QR code among them ([#171](https://github.com/DSestu/sestudio/issues/171)) ([e5ef410](https://github.com/DSestu/sestudio/commit/e5ef410d15071b9fba32aa1a3f7490fcff2b34d1))

## [1.2.0](https://github.com/DSestu/sestudio/compare/v1.1.1...v1.2.0) (2026-11-01)


### New features

* a Server log in Settings, showing what the server prints in its terminal ([#165](https://github.com/DSestu/sestudio/issues/165)) ([f7c3f3c](https://github.com/DSestu/sestudio/commit/f7c3f3c8c50b794f01dba171817610f6ce09c799))
* an Android app skeleton that shows sestudio full screen, built and linted in CI ([#160](https://github.com/DSestu/sestudio/issues/160)) ([4efe4fc](https://github.com/DSestu/sestudio/commit/4efe4fcad8c23c907b1945da610eca2590816e46))
* find and follow YouTube and Twitch channels from the YouTube & Twitch page, and fold its sidebar rows with Discover ([#164](https://github.com/DSestu/sestudio/issues/164)) ([e3af5a0](https://github.com/DSestu/sestudio/commit/e3af5a0e29b3ec4967e53792a073428cc6b785e5))
* follow a channel straight from a pasted link's card ([#156](https://github.com/DSestu/sestudio/issues/156)) ([244c8d8](https://github.com/DSestu/sestudio/commit/244c8d849a58d84e7b53d01f56cf8a22bf89e5e7))
* follow a YouTube or Twitch channel to hear about new videos and streams, and download them as they land ([#150](https://github.com/DSestu/sestudio/issues/150)) ([4894098](https://github.com/DSestu/sestudio/commit/4894098c4d8f39e17898269f9f7baefb72af392d))
* full-width pages, a clickable top match, a labelled Options button and clearer poster rows ([#138](https://github.com/DSestu/sestudio/issues/138)) ([89e85e6](https://github.com/DSestu/sestudio/commit/89e85e6c14c48feefb0aa56794198da2814d7e40))
* import YouTube subscriptions from Google Takeout and Twitch channels by name ([#152](https://github.com/DSestu/sestudio/issues/152)) ([03dcac9](https://github.com/DSestu/sestudio/commit/03dcac9968470f1cb324562f1d0bc85a9e8e8b11))
* open a YouTube or Twitch channel as a page of its latest videos ([#149](https://github.com/DSestu/sestudio/issues/149)) ([9fe84da](https://github.com/DSestu/sestudio/commit/9fe84dab8c018a9d8de18dfc6e9997dcc13f6c0b))
* paste a YouTube or Twitch link into search to play or download it ([#148](https://github.com/DSestu/sestudio/issues/148)) ([6d82eb1](https://github.com/DSestu/sestudio/commit/6d82eb18419888a217b45ac9a089ebdce7bbaea0))
* play and download YouTube and Twitch links through yt-dlp ([#145](https://github.com/DSestu/sestudio/issues/145)) ([41c875a](https://github.com/DSestu/sestudio/commit/41c875a2dc0b08e0fb8dd36edfc382e93e4db184))
* play YouTube in H.264 so Chromecast and TVs can decode it, and label YouTube and Twitch titles as videos ([#147](https://github.com/DSestu/sestudio/issues/147)) ([5441d5d](https://github.com/DSestu/sestudio/commit/5441d5dd149e770562d8a79a69f77f1724db27bc))
* put the player first in the Watch view, dock it on phones, add the search bar and a denser episode queue ([#142](https://github.com/DSestu/sestudio/issues/142)) ([df6f2b8](https://github.com/DSestu/sestudio/commit/df6f2b8e47d1a81e70190cec6fc726560f81820f))
* put YouTube and Twitch in Discover with a Creators page of who is live, who you follow and their latest videos ([#154](https://github.com/DSestu/sestudio/issues/154)) ([e888b90](https://github.com/DSestu/sestudio/commit/e888b906e08695444c017a14501d9c6df680baa3))
* run sestudio on an Android phone through Termux, and serve the built app's own files ([#166](https://github.com/DSestu/sestudio/issues/166)) ([1adf2f5](https://github.com/DSestu/sestudio/commit/1adf2f5591bd5f4e73e873765be954bf5df28c3b))
* run sestudio on Google Colab from a one-cell notebook, and share it from Settings ([#144](https://github.com/DSestu/sestudio/issues/144)) ([627348a](https://github.com/DSestu/sestudio/commit/627348a3e678bb738072bb9a36244286d151e407))
* run YouTube extraction on Node when Deno is missing, warn in Settings when neither is there, and bump yt-dlp ([#143](https://github.com/DSestu/sestudio/issues/143)) ([19e3d68](https://github.com/DSestu/sestudio/commit/19e3d68eab7fb9547b848b27d424b7da64293f83))
* search Twitch channels, keep YouTube and Twitch in view, and stop tripping YouTube's rate limit ([#161](https://github.com/DSestu/sestudio/issues/161)) ([b9e65d3](https://github.com/DSestu/sestudio/commit/b9e65d37b6581939797dfabe868be699d198a4bd))
* search YouTube from the search bar's new Videos kind ([#153](https://github.com/DSestu/sestudio/issues/153)) ([dc4aa43](https://github.com/DSestu/sestudio/commit/dc4aa436fb51ab547c7b74ad9a7754e91644184d))
* show a followed channel's videos as 16:9 thumbnails in New for you and Activity ([#155](https://github.com/DSestu/sestudio/issues/155)) ([ef27d0b](https://github.com/DSestu/sestudio/commit/ef27d0b712574a08cdf0d9baf0a104f62b8da493))
* show followed Twitch channels that are live on Home, and record a live stream from its channel page ([#151](https://github.com/DSestu/sestudio/issues/151)) ([c533c6c](https://github.com/DSestu/sestudio/commit/c533c6c2d8f0baf51e29d03ca47cfdb7db2e82b2))
* switch the search preview's kind with the arrow keys, and slide the blue between the chips ([#141](https://github.com/DSestu/sestudio/issues/141)) ([6f92393](https://github.com/DSestu/sestudio/commit/6f923935621966415415a85a6a17ed1f95189e86))
* tabs for a channel's past streams and highlights, and how often it posts ([#157](https://github.com/DSestu/sestudio/issues/157)) ([42d166e](https://github.com/DSestu/sestudio/commit/42d166e5453e95e25b4be2d2be9c1951ee8de06f))
* the Android app runs sestudio's server itself, in a foreground service with a Stop notification ([#163](https://github.com/DSestu/sestudio/issues/163)) ([9b0caa9](https://github.com/DSestu/sestudio/commit/9b0caa9ee025ea83ac21df46bd2f88118566047e))
* the Android app sets up its own Linux on first launch, with setup screens, and runs uv in it ([#162](https://github.com/DSestu/sestudio/issues/162)) ([3dcf8c6](https://github.com/DSestu/sestudio/commit/3dcf8c661d02550bd24425f117480787ca2e8ad1))


### Bug fixes

* draw AI frames on a Mac's GPU, through ncnn on Vulkan or CoreML as an ML program ([#140](https://github.com/DSestu/sestudio/issues/140)) ([cdfe954](https://github.com/DSestu/sestudio/commit/cdfe954c2ba0bd9d0aaaffb1e69db2d53d112bec))


### Documentation

* point to the Colab notebook from the README's header and Quick start ([#146](https://github.com/DSestu/sestudio/issues/146)) ([5c99178](https://github.com/DSestu/sestudio/commit/5c99178445a162bf48ea5f555d2a2fe205540476))


### Performance improvements

* cut another 1-2 s off opening a YouTube or Twitch video, and reuse the proxy's upstream connections ([#159](https://github.com/DSestu/sestudio/issues/159)) ([0b24c4e](https://github.com/DSestu/sestudio/commit/0b24c4eeb988344b6afec333e5f4cbf48bd9a952))
* start YouTube and Twitch streams in about 2 s instead of 13 by probing only a master's best variant ([#158](https://github.com/DSestu/sestudio/issues/158)) ([1d2c00b](https://github.com/DSestu/sestudio/commit/1d2c00bae0fd68a8194aaebe12565b87133d5699))

## [1.1.1](https://github.com/DSestu/sestudio/compare/v1.1.0...v1.1.1) (2026-10-26)


### Bug fixes

* stop the player going black over plain HTTP, where crypto.randomUUID does not exist ([#135](https://github.com/DSestu/sestudio/issues/135)) ([b5160dc](https://github.com/DSestu/sestudio/commit/b5160dcc9dbf27d93fa5c69c7e9a1e4364927ab3))

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

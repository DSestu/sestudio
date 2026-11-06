# Flow lab

Interactive prototype of docs/SPEC-music-flows.md: edit a flow, watch the mix it renders, play it with real audio.

```sh
uv run --no-project python prep.py fetch --base https://localhost:8444   # analysis from the test instance -> lib.json (gitignored)
.venv/bin/python prep.py harmony "/mnt/r/Musique/Android/neuro soundcloud"  # tonic + mode per track, when the instance has none
ln -s "/mnt/r/Musique/Android/neuro soundcloud" lib                         # audio for the page (gitignored)
uv run --no-project python ../music/serve.py . 44392                        # then open http://127.0.0.1:44392/index.html
node flowgen.js                                                             # the generator's self-check
```

- `flowgen.js`: the generator (spec §6), shared by the page and the self-check.
- `night.json`: warm-up, a fork (peak with two lifts, or deep with a darker mode), a come-down that breaks then goes to the relative major.
- `house-to-ambient.json`: a flow the neuro test library cannot satisfy, to watch relaxation.

A flow is `chunks`, each with a `share` of the length, `next` chunk ids (two or more = a fork) and `layers`: `tempo` and `energy` as `[[fraction, value], ...]` curves (energy is the library percentile, 0..1); `harmony` as a list of events `{at: fraction, kind: up|down|mode+|mode-|relative|break}` (every other join is a match; no `harmony` key = free); `genre` blocks `{from, to, genres, strict: "must"|"prefer"}`. Without a choice at a fork the generator takes the future it fills with the fewest relaxations.

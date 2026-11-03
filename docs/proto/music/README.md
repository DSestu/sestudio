# Music audio prototype

Reference implementation for `docs/SPEC-music-player.md`: one HTML file (`scrub.html`) with the stage, the
timeline scrub and the crossfade, driven by real audio. `index.html` is the older crossfade-only prototype.
Test music: `R:\Musique\Android\neuro soundcloud`.

## Build the data

The data is not in git (`lib.json`, `lib/` and `audio/` are ignored). Build it from a music folder, with
`<ffmpeg>` the path to an ffmpeg binary and `<dir>` the output folder (the one you serve):

    python prep_lib.py <ffmpeg> <music folder> <dir>
    OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 python prep_bpm.py <ffmpeg> <dir>/lib.json <dir>

`prep_lib.py` writes `lib.json` and `lib/` (duration, loudness, hue, 8 bands). `prep_bpm.py` adds the BPM.
`prep.py` and `prep_bands8.py` are older single-purpose versions; read them for their arguments.

## Serve it

    python serve.py <dir> 44391

Open `http://127.0.0.1:44391/scrub.html`. Add `?tv` for the TV picture, `?bg=<style>` to pick a background style.

from __future__ import annotations

from sestudio.providers.subtitles import extract

BASE = "https://vidzy.org/embed-abc123.html"

# The shape vidzy uses for soft subs: a loadTracks call wired to `loadeddata`,
# whose `src` is an IIFE rewriting the URL to the embed's own origin. The IIFE
# body nests braces several levels deep, which is why entries are split on the
# subtitle URLs rather than on braces.
_LOAD_TRACKS = """
player.on('loadeddata', function(){
  player.loadTracks([{kind: 'subtitles', srclang: 'fre', label: 'French',
    src: (function(u){try{var i=u.indexOf('://');if(i<0){return u;}
      var j=u.indexOf('/',i+3);if(j<0){return u;}
      return location.protocol+'//'+location.host+u.slice(j);}catch(e){return u;}})(
      'https://vidzy.org/srtproxy/abc123_fre.vtt?dx=00056&srv=u14&disk=05'), default: true}]);
});
"""

# The "upload your own SRT" stub both vidzy and premium ship: a real <track>
# element pointing at a file with no cues.
_PLACEHOLDER_TRACK = (
    '<track kind="captions" src="https://fsvid.lol/srt/empty.vtt" '
    'srclang="th" label="Upload SRT" id="x182">'
)


def test_extracts_load_tracks_subtitle():
    subs = extract(_LOAD_TRACKS, BASE)
    assert len(subs) == 1
    assert subs[0].url == (
        "https://vidzy.org/srtproxy/abc123_fre.vtt?dx=00056&srv=u14&disk=05"
    )
    assert subs[0].lang == "fre"
    assert subs[0].label == "French"
    assert subs[0].default is True


def test_takes_the_iife_argument_not_the_rewritten_url():
    """The absolute original is reachable server-side; the rewrite is not."""
    (sub,) = extract(_LOAD_TRACKS, BASE)
    assert sub.url.startswith("https://vidzy.org/srtproxy/")
    assert "location.protocol" not in sub.url


def test_upload_srt_placeholder_is_dropped():
    assert extract(_PLACEHOLDER_TRACK, "https://fsvid.lol/embed-x.html") == []


def test_hardsubbed_embed_yields_nothing():
    assert extract("<html><body>no tracks here</body></html>", BASE) == []


def test_extracts_plain_html_track():
    page = (
        '<track kind="subtitles" src="/subs/ep1_en.vtt" srclang="en" label="English">'
    )
    (sub,) = extract(page, BASE)
    assert sub.url == "https://vidzy.org/subs/ep1_en.vtt"
    assert sub.lang == "en"
    assert sub.label == "English"
    assert sub.default is False


def test_non_text_track_kinds_are_ignored():
    page = '<track kind="thumbnails" src="/t/preview.vtt" srclang="en" label="Thumbs">'
    assert extract(page, BASE) == []


def test_multiple_load_tracks_entries_keep_their_own_attributes():
    page = """
    player.loadTracks([
      {kind:'subtitles', srclang:'fre', label:'French', src:'/a_fre.vtt', default: true},
      {kind:'subtitles', srclang:'eng', label:'English', src:'/b_eng.vtt'}
    ]);
    """
    fre, eng = extract(page, BASE)
    assert (fre.lang, fre.label, fre.default) == ("fre", "French", True)
    assert (eng.lang, eng.label, eng.default) == ("eng", "English", False)


def test_duplicate_declarations_are_collapsed():
    """A track declared both as markup and via loadTracks is one subtitle."""
    page = (
        '<track kind="subtitles" src="https://vidzy.org/s/x.vtt" '
        'srclang="fre" label="French">'
        "player.loadTracks([{kind:'subtitles', srclang:'fre', label:'French', "
        "src:'https://vidzy.org/s/x.vtt'}]);"
    )
    assert len(extract(page, BASE)) == 1


def test_label_falls_back_to_language_then_generic():
    (sub,) = extract("player.loadTracks([{kind:'subtitles', src:'/x.vtt'}]);", BASE)
    assert sub.label == "Subtitles"

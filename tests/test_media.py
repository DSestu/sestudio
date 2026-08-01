from __future__ import annotations

import sys
import types

import sestudio.media as media


def test_prefers_system_ffmpeg(monkeypatch):
    """A system ffmpeg on PATH → None (let yt-dlp use it, no --ffmpeg-location)."""
    monkeypatch.setattr(media.shutil, "which", lambda name: "/usr/bin/ffmpeg")
    assert media.ffmpeg_location() is None


def test_falls_back_to_bundled(monkeypatch):
    """No system ffmpeg → the directory of the imageio-ffmpeg bundled binary."""
    monkeypatch.setattr(media.shutil, "which", lambda name: None)
    fake = types.SimpleNamespace(
        get_ffmpeg_exe=lambda: "/bundle/bin/ffmpeg-linux-x86_64"
    )
    monkeypatch.setitem(sys.modules, "imageio_ffmpeg", fake)
    assert media.ffmpeg_location() == "/bundle/bin"


def test_no_ffmpeg_anywhere(monkeypatch):
    """No system ffmpeg and imageio-ffmpeg absent → None (yt-dlp reports its own error)."""
    monkeypatch.setattr(media.shutil, "which", lambda name: None)
    monkeypatch.delitem(sys.modules, "imageio_ffmpeg", raising=False)
    orig_import = __import__

    def _no_imageio(name, *args, **kwargs):
        if name == "imageio_ffmpeg":
            raise ImportError("stubbed missing")
        return orig_import(name, *args, **kwargs)

    monkeypatch.setattr("builtins.__import__", _no_imageio)
    assert media.ffmpeg_location() is None

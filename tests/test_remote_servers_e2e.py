"""Two real sestudio servers, one in front of the other (docs/SPEC-remote-servers.md).

The "remote" holds a video; the "local" registers it by its Tailscale address,
trusts it, switches to it, then casts the remote's video to a fake DLNA TV
(SSDP-discovered, SOAP-controlled, fetching the media like a TV) and to a fake
Chromecast (fetching the URL the page would hand the receiver). Both fetch from
the local server, which streams from the remote.

Needs this machine's network and Tailscale: not for CI.
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from xml.etree import ElementTree as ET

import httpx
import pytest

pytestmark = pytest.mark.exclude_ci

ROOT = Path(__file__).resolve().parent.parent
REMOTE = {"http": 18080, "https": 18443}
LOCAL = {"http": 18081, "https": 18444}


def _ip(prefix: str, interface: str | None = None) -> str | None:
    """A non-loopback IPv4 of this machine starting with *prefix*, on *interface* if given."""
    out = subprocess.run(
        ["ip", "-4", "-o", "addr"], capture_output=True, text=True
    ).stdout
    for line in out.splitlines():
        parts = line.split()
        ip = parts[3].split("/")[0]
        if ip.startswith(prefix) and (interface is None or parts[1] == interface):
            return ip
    return None


# The tailscale0 interface itself: a mirrored Windows address is not routable here.
TAILSCALE_IP = _ip("100.", "tailscale0")
LAN_IP = _ip("192.168.")


def _video(path: Path) -> None:
    import imageio_ffmpeg

    subprocess.run(
        [
            imageio_ffmpeg.get_ffmpeg_exe(),
            "-y",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=4:size=320x240:rate=25",
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:duration=4",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-shortest",
            str(path),
        ],
        check=True,
    )


class Server:
    """A ``sestudio serve`` of this checkout, on its own config and DB."""

    def __init__(self, name: str, ports: dict[str, int], root: Path):
        self.name, self.ports, self.root = name, ports, root
        root.mkdir(parents=True)
        (root / "downloads").mkdir()
        (root / "config.json").write_text(
            json.dumps({"output_root": str(root / "downloads")})
        )
        self.log = open(root / "server.log", "w")
        self.process: subprocess.Popen | None = None

    def start(self) -> None:
        env = os.environ | {
            "PYTHONPATH": "src",
            "SESTUDIO_CONFIG": str(self.root / "config.json"),
            "SESTUDIO_DB": str(self.root / "library.db"),
            "SESTUDIO_WATCHERS": "0",
            "SESTUDIO_MUSIC_ANALYSIS": "0",
            "SESTUDIO_MUSIC_GENRE_MODEL": "0",
        }
        self.process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "sestudio",
                "serve",
                "--host",
                "0.0.0.0",
                "--http-port",
                str(self.ports["http"]),
                "--https-port",
                str(self.ports["https"]),
                "--no-resolve",
            ],
            cwd=ROOT,
            env=env,
            stdout=self.log,
            stderr=subprocess.STDOUT,
        )
        for _ in range(120):
            try:
                if httpx.get(f"{self.http}/api/health", timeout=2).status_code == 200:
                    httpx.get(f"{self.https}/api/health", timeout=2, verify=False)
                    return
            except httpx.HTTPError:
                time.sleep(0.5)
        raise RuntimeError(
            f"{self.name} did not start:\n{(self.root / 'server.log').read_text()[-2000:]}"
        )

    @property
    def http(self) -> str:
        return f"http://127.0.0.1:{self.ports['http']}"

    @property
    def https(self) -> str:
        return f"https://127.0.0.1:{self.ports['https']}"

    def stop(self) -> None:
        if self.process and self.process.poll() is None:
            self.process.terminate()
            try:
                self.process.wait(10)
            except subprocess.TimeoutExpired:
                self.process.kill()
        self.log.close()


# --- a DLNA TV: SSDP, device description, AVTransport/RenderingControl over SOAP ---

_SSDP_GROUP = ("239.255.255.250", 1900)
_ST = "urn:schemas-upnp-org:device:MediaRenderer:1"
_UDN = "uuid:fake-tv-0001"


def _scpd(
    actions: dict[str, list[tuple[str, str, str]]], variables: dict[str, str]
) -> str:
    """A service description: ``actions`` as name -> [(arg, in|out, variable)]."""
    acts = "".join(
        f"<action><name>{name}</name><argumentList>"
        + "".join(
            f"<argument><name>{a}</name><direction>{d}</direction>"
            f"<relatedStateVariable>{v}</relatedStateVariable></argument>"
            for a, d, v in args
        )
        + "</argumentList></action>"
        for name, args in actions.items()
    )
    vars_ = "".join(
        f'<stateVariable sendEvents="no"><name>{n}</name><dataType>{t}</dataType></stateVariable>'
        for n, t in variables.items()
    )
    return (
        '<?xml version="1.0"?><scpd xmlns="urn:schemas-upnp-org:service-1-0">'
        "<specVersion><major>1</major><minor>0</minor></specVersion>"
        f"<actionList>{acts}</actionList><serviceStateTable>{vars_}</serviceStateTable></scpd>"
    )


_AVT = _scpd(
    {
        "SetAVTransportURI": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("CurrentURI", "in", "AVTransportURI"),
            ("CurrentURIMetaData", "in", "AVTransportURIMetaData"),
        ],
        "Play": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Speed", "in", "TransportPlaySpeed"),
        ],
        "Stop": [("InstanceID", "in", "A_ARG_TYPE_InstanceID")],
        "Pause": [("InstanceID", "in", "A_ARG_TYPE_InstanceID")],
        "Seek": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Unit", "in", "A_ARG_TYPE_SeekMode"),
            ("Target", "in", "A_ARG_TYPE_SeekTarget"),
        ],
        "GetTransportInfo": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("CurrentTransportState", "out", "TransportState"),
            ("CurrentTransportStatus", "out", "TransportStatus"),
            ("CurrentSpeed", "out", "TransportPlaySpeed"),
        ],
        "GetPositionInfo": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Track", "out", "CurrentTrack"),
            ("TrackDuration", "out", "CurrentTrackDuration"),
            ("TrackMetaData", "out", "CurrentTrackMetaData"),
            ("TrackURI", "out", "CurrentTrackURI"),
            ("RelTime", "out", "RelativeTimePosition"),
            ("AbsTime", "out", "AbsoluteTimePosition"),
            ("RelCount", "out", "RelativeCounterPosition"),
            ("AbsCount", "out", "AbsoluteCounterPosition"),
        ],
        "GetMediaInfo": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("NrTracks", "out", "NumberOfTracks"),
            ("MediaDuration", "out", "CurrentMediaDuration"),
            ("CurrentURI", "out", "AVTransportURI"),
            ("CurrentURIMetaData", "out", "AVTransportURIMetaData"),
            ("NextURI", "out", "NextAVTransportURI"),
            ("NextURIMetaData", "out", "NextAVTransportURIMetaData"),
            ("PlayMedium", "out", "PlaybackStorageMedium"),
            ("RecordMedium", "out", "RecordStorageMedium"),
            ("WriteStatus", "out", "RecordMediumWriteStatus"),
        ],
        "GetTransportSettings": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("PlayMode", "out", "CurrentPlayMode"),
            ("RecQualityMode", "out", "CurrentRecordQualityMode"),
        ],
        "GetDeviceCapabilities": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("PlayMedia", "out", "PossiblePlaybackStorageMedia"),
            ("RecMedia", "out", "PossibleRecordStorageMedia"),
            ("RecQualityModes", "out", "PossibleRecordQualityModes"),
        ],
        "GetCurrentTransportActions": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Actions", "out", "CurrentTransportActions"),
        ],
    },
    {
        "A_ARG_TYPE_InstanceID": "ui4",
        "AVTransportURI": "string",
        "AVTransportURIMetaData": "string",
        "TransportPlaySpeed": "string",
        "A_ARG_TYPE_SeekMode": "string",
        "A_ARG_TYPE_SeekTarget": "string",
        "TransportState": "string",
        "TransportStatus": "string",
        "CurrentTrack": "ui4",
        "CurrentTrackDuration": "string",
        "CurrentTrackMetaData": "string",
        "CurrentTrackURI": "string",
        "RelativeTimePosition": "string",
        "AbsoluteTimePosition": "string",
        "RelativeCounterPosition": "i4",
        "AbsoluteCounterPosition": "i4",
        "NumberOfTracks": "ui4",
        "CurrentMediaDuration": "string",
        "NextAVTransportURI": "string",
        "NextAVTransportURIMetaData": "string",
        "PlaybackStorageMedium": "string",
        "RecordStorageMedium": "string",
        "RecordMediumWriteStatus": "string",
        "CurrentPlayMode": "string",
        "CurrentRecordQualityMode": "string",
        "PossiblePlaybackStorageMedia": "string",
        "PossibleRecordStorageMedia": "string",
        "PossibleRecordQualityModes": "string",
        "CurrentTransportActions": "string",
    },
)
_RC = _scpd(
    {
        "GetVolume": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Channel", "in", "A_ARG_TYPE_Channel"),
            ("CurrentVolume", "out", "Volume"),
        ],
        "SetVolume": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Channel", "in", "A_ARG_TYPE_Channel"),
            ("DesiredVolume", "in", "Volume"),
        ],
        "GetMute": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Channel", "in", "A_ARG_TYPE_Channel"),
            ("CurrentMute", "out", "Mute"),
        ],
        "SetMute": [
            ("InstanceID", "in", "A_ARG_TYPE_InstanceID"),
            ("Channel", "in", "A_ARG_TYPE_Channel"),
            ("DesiredMute", "in", "Mute"),
        ],
    },
    {
        "A_ARG_TYPE_InstanceID": "ui4",
        "A_ARG_TYPE_Channel": "string",
        "Volume": "ui2",
        "Mute": "boolean",
    },
)
_CM = _scpd(
    {
        "GetProtocolInfo": [
            ("Source", "out", "SourceProtocolInfo"),
            ("Sink", "out", "SinkProtocolInfo"),
        ]
    },
    {"SourceProtocolInfo": "string", "SinkProtocolInfo": "string"},
)


def _device_xml(base: str) -> str:
    def service(kind: str) -> str:
        return (
            f"<service><serviceType>urn:schemas-upnp-org:service:{kind}:1</serviceType>"
            f"<serviceId>urn:upnp-org:serviceId:{kind}</serviceId>"
            f"<SCPDURL>{base}/{kind}.xml</SCPDURL><controlURL>{base}/{kind}/control</controlURL>"
            f"<eventSubURL>{base}/{kind}/event</eventSubURL></service>"
        )

    return (
        '<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0">'
        "<specVersion><major>1</major><minor>0</minor></specVersion><device>"
        f"<deviceType>{_ST}</deviceType><friendlyName>Fake TV</friendlyName>"
        "<manufacturer>sestudio tests</manufacturer><modelName>FakeTV</modelName>"
        f"<UDN>{_UDN}</UDN><serviceList>{service('AVTransport')}{service('RenderingControl')}{service('ConnectionManager')}</serviceList>"
        "</device></root>"
    )


class FakeTv:
    """What a DLNA renderer does: answers SSDP, takes a URI, fetches it, reports playing."""

    def __init__(self, ip: str, port: int = 18900):
        self.ip, self.port = ip, port
        self.uri = ""
        self.state = "STOPPED"
        self.started = 0.0
        self.fetched: dict = {}
        self.volume, self.mute = 50, False
        self.calls: list[str] = []
        tv = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):  # quiet
                pass

            def _send(self, body: str, ctype="text/xml; charset=utf-8", status=200):
                data = body.encode()
                self.send_response(status)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                docs = {
                    "/device.xml": _device_xml(""),
                    "/AVTransport.xml": _AVT,
                    "/RenderingControl.xml": _RC,
                    "/ConnectionManager.xml": _CM,
                }
                if self.path in docs:
                    self._send(docs[self.path])
                else:
                    self._send("", status=404)

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
                action = self.headers.get("SOAPACTION", "").strip('"').split("#")[-1]
                service = self.path.split("/")[1]
                tv.calls.append(action)
                args = {}
                root = ET.fromstring(body)
                for el in root.iter():
                    if el.tag.endswith(f"}}{action}") or el.tag == action:
                        args = {
                            child.tag.split("}")[-1]: (child.text or "") for child in el
                        }
                out = tv.handle(action, args)
                inner = "".join(f"<{k}>{v}</{k}>" for k, v in out.items())
                ns = f"urn:schemas-upnp-org:service:{service}:1"
                self._send(
                    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
                    's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
                    f'<u:{action}Response xmlns:u="{ns}">{inner}</u:{action}Response></s:Body></s:Envelope>'
                )

        self.httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        self.ssdp = threading.Thread(target=self._ssdp, daemon=True)
        self.ssdp.start()

    @property
    def location(self) -> str:
        return f"http://{self.ip}:{self.port}/device.xml"

    def _ssdp(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("", _SSDP_GROUP[1]))
        mreq = socket.inet_aton(_SSDP_GROUP[0]) + socket.inet_aton("0.0.0.0")
        sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
        sock.settimeout(1)
        while True:
            try:
                data, addr = sock.recvfrom(4096)
            except socket.timeout:
                continue
            except OSError:
                return
            if b"M-SEARCH" in data and (_ST.encode() in data or b"ssdp:all" in data):
                reply = (
                    "HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=1800\r\nEXT:\r\n"
                    f"LOCATION: {self.location}\r\nSERVER: FakeTV/1.0 UPnP/1.0\r\n"
                    f"ST: {_ST}\r\nUSN: {_UDN}::{_ST}\r\n\r\n"
                )
                sock.sendto(reply.encode(), addr)

    def _position(self) -> str:
        s = int(time.time() - self.started) if self.state == "PLAYING" else 0
        return f"0:00:{min(s, 4):02d}"

    def handle(self, action: str, args: dict) -> dict:
        if action == "SetAVTransportURI":
            self.uri = args.get("CurrentURI", "")
            self.state = "STOPPED"
            threading.Thread(target=self._fetch, daemon=True).start()
        elif action == "Play":
            self.state, self.started = "PLAYING", time.time()
        elif action == "Stop":
            self.state = "STOPPED"
        elif action == "Pause":
            self.state = "PAUSED_PLAYBACK"
        elif action == "SetVolume":
            self.volume = int(args.get("DesiredVolume", 50))
        elif action == "SetMute":
            self.mute = args.get("DesiredMute", "0") in ("1", "true")
        elif action == "GetTransportInfo":
            return {
                "CurrentTransportState": self.state,
                "CurrentTransportStatus": "OK",
                "CurrentSpeed": "1",
            }
        elif action == "GetPositionInfo":
            return {
                "Track": "1",
                "TrackDuration": "0:00:04",
                "TrackMetaData": "",
                "TrackURI": self.uri,
                "RelTime": self._position(),
                "AbsTime": self._position(),
                "RelCount": "0",
                "AbsCount": "0",
            }
        elif action == "GetMediaInfo":
            return {
                "NrTracks": "1",
                "MediaDuration": "0:00:04",
                "CurrentURI": self.uri,
                "CurrentURIMetaData": "",
                "NextURI": "",
                "NextURIMetaData": "",
                "PlayMedium": "NETWORK",
                "RecordMedium": "NOT_IMPLEMENTED",
                "WriteStatus": "NOT_IMPLEMENTED",
            }
        elif action == "GetVolume":
            return {"CurrentVolume": str(self.volume)}
        elif action == "GetMute":
            return {"CurrentMute": "1" if self.mute else "0"}
        elif action == "GetProtocolInfo":
            return {
                "Source": "",
                "Sink": "http-get:*:video/mp4:*,http-get:*:video/mpeg:*",
            }
        elif action == "GetTransportSettings":
            return {"PlayMode": "NORMAL", "RecQualityMode": "NOT_IMPLEMENTED"}
        elif action == "GetDeviceCapabilities":
            return {
                "PlayMedia": "NETWORK",
                "RecMedia": "NOT_IMPLEMENTED",
                "RecQualityModes": "NOT_IMPLEMENTED",
            }
        elif action == "GetCurrentTransportActions":
            return {"Actions": "Play,Stop,Pause,Seek"}
        return {}

    def _fetch(self) -> None:
        """Like a TV: a ranged GET of the URI it was given."""
        try:
            with httpx.stream(
                "GET", self.uri, headers={"Range": "bytes=0-"}, timeout=30
            ) as r:
                body = b"".join(r.iter_bytes())
                self.fetched = {
                    "status": r.status_code,
                    "type": r.headers.get("content-type", ""),
                    "bytes": body,
                }
        except Exception as exc:  # noqa: BLE001
            self.fetched = {"error": str(exc)}

    def close(self) -> None:
        self.httpd.shutdown()


# --- the test ----------------------------------------------------------------


@pytest.fixture(scope="module")
def world(tmp_path_factory):
    if not TAILSCALE_IP or not LAN_IP:
        pytest.skip("needs a Tailscale and a LAN address")
    base = tmp_path_factory.mktemp("e2e")
    remote = Server("remote", REMOTE, base / "remote")
    (remote.root / "downloads" / "Test Film (2024)").mkdir()
    _video(remote.root / "downloads" / "Test Film (2024)" / "test.mp4")
    local = Server("local", LOCAL, base / "local")
    remote.start()
    local.start()
    tv = FakeTv(LAN_IP)
    try:
        yield remote, local, tv
    finally:
        tv.close()
        local.stop()
        remote.stop()


def _client(server: Server) -> httpx.Client:
    return httpx.Client(base_url=server.http, timeout=30)


def test_the_remote_lists_its_video(world):
    remote, _, _ = world
    with _client(remote) as c:
        items = c.get("/api/downloaded").json()
    assert any(
        "test.mp4" in json.dumps(i)
        for i in (items if isinstance(items, list) else items.get("items", [items]))
    ), items


def _video_url(server: Server) -> str:
    """The stored file's path as the library knows it, as a play URL."""
    with _client(server) as c:
        text = c.get("/api/downloaded").text
    paths = [p for p in _paths(json.loads(text)) if p.endswith("test.mp4")]
    assert paths, text[:500]
    return f"/api/downloaded/file?path={urllib.parse.quote(paths[0])}"


def _paths(node) -> list[str]:
    if isinstance(node, dict):
        return ([node["path"]] if isinstance(node.get("path"), str) else []) + [
            p for v in node.values() for p in _paths(v)
        ]
    if isinstance(node, list):
        return [p for v in node for p in _paths(v)]
    return []


def test_register_trust_and_switch_over_tailscale(world):
    remote, local, _ = world
    with _client(local) as c:
        row = c.post(
            "/api/servers",
            json={"name": "Remote", "url": f"https://{TAILSCALE_IP}:{REMOTE['https']}"},
        ).json()
        assert row["reachable"] is True, row
        assert row["version"] and row["fingerprint"] and not row["trusted"]
        assert c.put("/api/servers/active", json={"id": row["id"]}).status_code == 409
        assert c.post(f"/api/servers/{row['id']}/trust").json()["trusted"] is True
        assert c.put("/api/servers/active", json={"id": row["id"]}).json() == {
            "active": row["id"]
        }
        # Now the local answers with the remote's library...
        assert "test.mp4" in c.get("/api/downloaded").text
        # ...while the servers page and the LAN check stay its own.
        assert c.get("/api/servers").json()["servers"][0]["in_use"] is True
        assert c.get("/api/server/lan").status_code == 200
        assert c.get("/api/cast/http-port").json()["http_port"] == LOCAL["http"]


def test_the_video_streams_through_the_local_with_ranges(world):
    remote, local, _ = world
    url = _video_url(local)
    whole = (remote.root / "downloads" / "Test Film (2024)" / "test.mp4").read_bytes()
    with _client(local) as c:
        r = c.get(url, headers={"Range": "bytes=0-99"})
        assert r.status_code == 206, r.text
        assert r.content == whole[:100]
        assert r.headers["content-range"].startswith("bytes 0-99/")
        r = c.get(url)
        assert r.content == whole


def test_dlna_cast_of_the_remote_video_reaches_the_tv_through_the_local(world):
    remote, local, tv = world
    url = _video_url(local)
    with _client(local) as c:
        renderers = c.get("/api/cast/dlna/renderers").json()
        assert any(r["udn"] == _UDN for r in renderers), renderers
        r = c.post(
            "/api/cast/dlna/play",
            json={
                "renderer_udn": _UDN,
                "proxy_url": url,
                "kind": "mp4",
                "title": "Test",
            },
        )
        assert r.status_code == 200, r.text
        media_url = r.json()["media_url"]
        # The TV is pointed at this machine, on the local's plain HTTP port.
        assert media_url.startswith(
            f"http://{LAN_IP}:{LOCAL['http']}/api/downloaded/"
        ), media_url
        for _ in range(60):
            if tv.fetched:
                break
            time.sleep(0.5)
        assert "bytes" in tv.fetched, tv.fetched
        whole = (
            remote.root / "downloads" / "Test Film (2024)" / "test.mp4"
        ).read_bytes()
        assert tv.fetched["bytes"] == whole
        assert tv.fetched["type"].startswith("video/")
        assert "SetAVTransportURI" in tv.calls and "Play" in tv.calls
        status = c.get("/api/cast/dlna/status").json()
        assert (
            status["connected"] is True and status["state"].lower() == "playing"
        ), status
        assert c.post("/api/cast/dlna/pause").status_code == 200
        assert tv.state == "PAUSED_PLAYBACK"
        assert c.post("/api/cast/dlna/stop").status_code == 200
        assert tv.state == "STOPPED"


def test_chromecast_fetches_the_remote_video_from_the_local(world):
    remote, local, _ = world
    url = _video_url(local)
    with _client(local) as c:
        port_info = c.get("/api/cast/http-port").json()
    # What the page builds for the receiver (OutputSwitcher / musicCast lanBase):
    # the LAN host on the plain HTTP port, plus the stream's own path.
    base = f"http://{port_info['lan_host']}:{port_info['http_port']}"
    assert port_info["http_port"] == LOCAL["http"]
    whole = (remote.root / "downloads" / "Test Film (2024)" / "test.mp4").read_bytes()
    # A receiver streams in ranges, like Chrome's media stack.
    with httpx.Client(timeout=30) as receiver:
        r = receiver.get(base + url, headers={"Range": "bytes=0-"})
        assert r.status_code in (200, 206), r.text
        assert r.content == whole
        # And the HLS form the page uses for a file a browser cannot play as it is.
        hls = url.replace("/api/downloaded/file?", "/api/downloaded/hls?") + "&audio=0"
        m3u8 = receiver.get(base + hls)
        assert m3u8.status_code == 200, m3u8.text
        assert "#EXTM3U" in m3u8.text
        # A master, then its variant, then the first segment: the hops a
        # receiver makes, each through the local server to the remote.
        playlist, at = m3u8, base + hls
        for _ in range(2):
            first = next(
                line
                for line in playlist.text.splitlines()
                if line and not line.startswith("#")
            )
            at = urllib.parse.urljoin(at, first)
            playlist = receiver.get(at)
            assert playlist.status_code == 200, playlist.text
            if "#EXTM3U" not in playlist.text:
                break
        assert "#EXTM3U" not in playlist.text and len(playlist.content) > 1000


def test_a_remote_gone_is_said_by_name_and_switching_back_works(world):
    remote, local, _ = world
    remote.stop()
    try:
        with _client(local) as c:
            r = c.get("/api/downloaded")
            assert (
                r.status_code == 502 and r.json()["detail"] == "Remote is not answering"
            ), r.text
            row = c.get("/api/servers?check=true").json()["servers"][0]
            assert row["reachable"] is False and row["last_seen"]
            assert c.put("/api/servers/active", json={"id": None}).json() == {
                "active": None
            }
            assert c.get("/api/downloaded").status_code == 200
            assert "test.mp4" not in c.get("/api/downloaded").text
    finally:
        remote.log = open(remote.root / "server.log", "a")
        remote.start()

"""A UPnP media server small enough for tests: a "Fichiers" folder with one film
and a "TV" folder with a live channel (size 0), served like a Freebox's."""

from __future__ import annotations

import html
import http.server
import re
import threading

FILM = b"0123456789" * 100

_SCPD = """<?xml version="1.0"?><scpd xmlns="urn:schemas-upnp-org:service-1-0">
<specVersion><major>1</major><minor>0</minor></specVersion><actionList><action><name>Browse</name><argumentList>
<argument><name>ObjectID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_ObjectID</relatedStateVariable></argument>
<argument><name>BrowseFlag</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_BrowseFlag</relatedStateVariable></argument>
<argument><name>Filter</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Filter</relatedStateVariable></argument>
<argument><name>StartingIndex</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Index</relatedStateVariable></argument>
<argument><name>RequestedCount</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
<argument><name>SortCriteria</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_SortCriteria</relatedStateVariable></argument>
<argument><name>Result</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Result</relatedStateVariable></argument>
<argument><name>NumberReturned</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
<argument><name>TotalMatches</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
<argument><name>UpdateID</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_UpdateID</relatedStateVariable></argument>
</argumentList></action></actionList><serviceStateTable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_ObjectID</name><dataType>string</dataType></stateVariable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_BrowseFlag</name><dataType>string</dataType>
<allowedValueList><allowedValue>BrowseMetadata</allowedValue><allowedValue>BrowseDirectChildren</allowedValue></allowedValueList></stateVariable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_Filter</name><dataType>string</dataType></stateVariable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_Index</name><dataType>ui4</dataType></stateVariable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_Count</name><dataType>ui4</dataType></stateVariable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_SortCriteria</name><dataType>string</dataType></stateVariable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_Result</name><dataType>string</dataType></stateVariable>
<stateVariable sendEvents="no"><name>A_ARG_TYPE_UpdateID</name><dataType>ui4</dataType></stateVariable>
</serviceStateTable></scpd>"""


def _didl(base: str, oid: str) -> tuple[str, int]:
    ns = ('<DIDL-Lite xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/" '
          'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/">')  # fmt: skip
    if oid == "0":
        body = ('<container id="0/1" parentID="0"><dc:title>Fichiers</dc:title></container>'
                '<container id="0/0" parentID="0"><dc:title>TV</dc:title></container>')  # fmt: skip
        return ns + body + "</DIDL-Lite>", 2
    if oid == "0/1":
        body = (f'<item id="0/1/1" parentID="0/1"><dc:title>Heat (1995)</dc:title>'
                f'<res protocolInfo="http-get:*:video/x-matroska:*" size="{len(FILM)}">{base}/film</res></item>')  # fmt: skip
        return ns + body + "</DIDL-Lite>", 1
    if oid == "0/0":
        body = (f'<item id="0/0/1" parentID="0/0"><dc:title>France 2</dc:title>'
                f'<res protocolInfo="http-get:*:video/mpeg:*" size="0">{base}/live</res></item>')  # fmt: skip
        return ns + body + "</DIDL-Lite>", 1
    return ns + "</DIDL-Lite>", 0


def start() -> tuple[http.server.HTTPServer, str]:
    """A running server, and its description's address."""

    class Handler(http.server.BaseHTTPRequestHandler):
        def _send(self, status, body, ctype, extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def do_GET(self):  # noqa: N802
            base = f"http://127.0.0.1:{self.server.server_address[1]}"
            if self.path == "/device.xml":
                xml = (f'<?xml version="1.0"?><root xmlns="urn:schemas-upnp-org:device-1-0">'
                       f"<specVersion><major>1</major><minor>0</minor></specVersion><URLBase>{base}</URLBase>"
                       "<device><deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>"
                       "<friendlyName>Freebox Server</friendlyName><manufacturer>Freebox SAS</manufacturer>"
                       "<modelName>Freebox Media Server</modelName><UDN>uuid:fake</UDN><serviceList><service>"
                       "<serviceType>urn:schemas-upnp-org:service:ContentDirectory:1</serviceType>"
                       "<serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId><SCPDURL>/cd.xml</SCPDURL>"
                       "<controlURL>/cd/control</controlURL><eventSubURL>/cd/event</eventSubURL>"
                       "</service></serviceList></device></root>")  # fmt: skip
                return self._send(200, xml.encode(), "text/xml")
            if self.path == "/cd.xml":
                return self._send(200, _SCPD.encode(), "text/xml")
            if self.path == "/film":
                m = re.match(r"bytes=(\d+)-(\d*)", self.headers.get("Range", ""))
                if m:
                    first = int(m.group(1))
                    last = int(m.group(2)) if m.group(2) else len(FILM) - 1
                    return self._send(206, FILM[first:last + 1], "video/x-matroska",
                                      {"Content-Range": f"bytes {first}-{last}/{len(FILM)}"})  # fmt: skip
                return self._send(200, FILM, "video/x-matroska")
            self._send(404, b"", "text/plain")

        do_HEAD = do_GET

        def do_POST(self):  # noqa: N802
            body = self.rfile.read(int(self.headers["Content-Length"])).decode()
            oid = re.search(r"<ObjectID>([^<]*)</ObjectID>", body).group(1)
            base = f"http://127.0.0.1:{self.server.server_address[1]}"
            didl, n = _didl(base, oid)
            xml = ('<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" '
                   's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>'
                   '<u:BrowseResponse xmlns:u="urn:schemas-upnp-org:service:ContentDirectory:1">'
                   f"<Result>{html.escape(didl)}</Result><NumberReturned>{n}</NumberReturned>"
                   f"<TotalMatches>{n}</TotalMatches><UpdateID>1</UpdateID></u:BrowseResponse></s:Body></s:Envelope>")  # fmt: skip
            self._send(200, xml.encode(), 'text/xml; charset="utf-8"')

        def log_message(self, *a):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/device.xml"

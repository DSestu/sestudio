"""Static server with byte ranges, so audio can seek."""
import http.server, os, re, sys
ROOT = sys.argv[1]; PORT = int(sys.argv[2])
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def send_head(self):
        rng = self.headers.get("Range")
        path = self.translate_path(self.path)
        if not rng or not os.path.isfile(path): return super().send_head()
        m = re.match(r"bytes=(\d*)-(\d*)", rng); size = os.path.getsize(path)
        start = int(m.group(1) or 0); end = int(m.group(2)) if m.group(2) else size - 1
        end = min(end, size - 1); f = open(path, "rb"); f.seek(start)
        self.send_response(206); self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Accept-Ranges", "bytes"); self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1)); self.send_header("Cache-Control", "no-store"); self.end_headers()
        self._left = end - start + 1; return f
    def copyfile(self, src, dst):
        left = getattr(self, "_left", None)
        if left is None: return super().copyfile(src, dst)
        while left > 0:
            b = src.read(min(65536, left))
            if not b: break
            dst.write(b); left -= len(b)
    def end_headers(self):
        if not self.headers.get("Range"): self.send_header("Accept-Ranges", "bytes")
        super().end_headers()
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer.allow_reuse_address = True
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()

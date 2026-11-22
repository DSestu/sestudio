"""Freebox OS, small enough for tests: pairing, a session by challenge, its disks,
its Windows sharing (SPEC-storage §11, M4)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import http.server
import json
import threading


def start(rights: bool = True):
    state = {"polls": 0, "smb": {"file_share_enabled": False, "logon_enabled": False, "logon_user": "freebox"},
             "token": "apptoken123", "session": "sess456", "challenge": "chal789"}  # fmt: skip

    class Handler(http.server.BaseHTTPRequestHandler):
        def _json(self, body, status=200):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _ok(self, result):
            self._json({"success": True, "result": result})

        def _authed(self):
            if self.headers.get("X-Fbx-App-Auth") != state["session"]:
                self._json({"success": False, "error_code": "auth_required"}, 403)
                return False
            return True

        def _body(self):
            n = int(self.headers.get("Content-Length") or 0)
            return json.loads(self.rfile.read(n) or b"{}")

        def do_GET(self):  # noqa: N802
            if self.path == "/api_version":
                return self._json({"box_model_name": "Freebox v8 (r1)", "api_base_url": "/api/",
                                   "device_name": "Freebox Server", "api_version": "16.1", "uid": "box-uid-1"})  # fmt: skip
            if self.path == "/api/v16/login/authorize/7":
                state["polls"] += 1
                return self._ok(
                    {"status": "pending" if state["polls"] < 2 else "granted"}
                )
            if self.path == "/api/v16/login/":
                return self._ok({"logged_in": False, "challenge": state["challenge"]})
            if self.path == "/api/v16/storage/disk/":
                if self._authed():
                    path = base64.b64encode(b"/Disque dur").decode()
                    self._ok([{"id": 1, "type": "usb", "model": "Samsung T7", "partitions": [
                        {"label": "Disque dur", "total_bytes": 1000, "free_bytes": 400, "path": path, "state": "mounted"}]}])  # fmt: skip
                return None
            if self.path == "/api/v16/netshare/samba/":
                if self._authed():
                    self._ok(state["smb"])
                return None
            self._json({"success": False, "error_code": "not_found"}, 404)

        def do_POST(self):  # noqa: N802
            body = self._body()
            if self.path == "/api/v16/login/authorize/":
                assert body["app_id"] and body["device_name"]
                return self._ok({"app_token": state["token"], "track_id": 7})
            if self.path == "/api/v16/login/session/":
                want = hmac.new(
                    state["token"].encode(), state["challenge"].encode(), hashlib.sha1
                ).hexdigest()
                if body.get("password") != want:
                    return self._json(
                        {"success": False, "error_code": "invalid_token"}, 403
                    )
                return self._ok(
                    {
                        "session_token": state["session"],
                        "permissions": {"settings": rights},
                    }
                )
            self._json({"success": False}, 404)

        def do_PUT(self):  # noqa: N802
            if self.path == "/api/v16/netshare/samba/" and self._authed():
                if not rights:
                    return self._json(
                        {
                            "success": False,
                            "error_code": "insufficient_rights",
                            "msg": "no",
                        },
                        403,
                    )
                state["smb"].update(self._body())
                return self._ok(state["smb"])
            return None

        def log_message(self, *a):
            pass

    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"127.0.0.1:{server.server_address[1]}", state

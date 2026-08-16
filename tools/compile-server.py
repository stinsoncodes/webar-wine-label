#!/usr/bin/env python3
"""Serve the project root and accept the compiled .mind file back over POST.

The MindAR compiler only runs in a browser. Rather than route the result through
a browser download, compile.html POSTs the buffer here and we write it to disk.

    python3 tools/compile-server.py        # then open http://localhost:8765/tools/compile.html
"""
import http.server
import os
import socketserver

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8765

# Where a POST to /save/<key> gets written. Explicit allowlist so a stray request
# can't write anywhere it likes.
TARGETS = {
    "spike": os.path.join(ROOT, "tracking-spike", "targets.mind"),
    "app": os.path.join(ROOT, "webar-wine-label", "assets", "targets.mind"),
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        key = self.path.rsplit("/", 1)[-1]
        dest = TARGETS.get(key)
        if not dest:
            self.send_error(404, "unknown save key")
            return
        body = self.rfile.read(int(self.headers["Content-Length"]))
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        with open(dest, "wb") as f:
            f.write(body)
        msg = f"wrote {len(body)} bytes -> {os.path.relpath(dest, ROOT)}"
        print(msg, flush=True)
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.end_headers()
        self.wfile.write(msg.encode())

    def log_message(self, fmt, *args):
        pass  # the POST print above is the only output worth seeing


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("127.0.0.1", PORT), Handler) as httpd:
    print(f"serving {ROOT} on http://localhost:{PORT}", flush=True)
    httpd.serve_forever()

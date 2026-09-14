#!/usr/bin/env python3
"""Serve a compile workspace and accept compiled .mind files back over POST.

    python3 tools/compile-server.py [workspace_dir]

The MindAR compiler only runs in a browser. Rather than route 13 results through
browser downloads, compile.html POSTs each buffer to /save/<id> and we write it
to out/<id>.mind.

Ids are allowlisted by shape, not by an enumerated list, so adding a label needs
no change here — but a stray request still cannot write outside out/.
"""
import http.server
import os
import re
import socketserver
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'out')
PORT = 8765
SAFE_ID = re.compile(r'^[a-z0-9][a-z0-9-]{0,63}$')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def do_POST(self):
        key = self.path.rsplit('/', 1)[-1]
        if not self.path.startswith('/save/') or not SAFE_ID.match(key):
            self.send_error(400, 'bad save id')
            return
        body = self.rfile.read(int(self.headers['Content-Length']))
        os.makedirs(OUT, exist_ok=True)
        dest = os.path.join(OUT, f'{key}.mind')
        with open(dest, 'wb') as f:
            f.write(body)
        msg = f'wrote {len(body)} bytes -> out/{key}.mind'
        print(msg, flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'text/plain')
        self.end_headers()
        self.wfile.write(msg.encode())

    def log_message(self, fmt, *args):
        pass            # the POST print above is the only output worth seeing


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
    print(f'serving {ROOT} on http://localhost:{PORT}', flush=True)
    httpd.serve_forever()

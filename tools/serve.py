#!/usr/bin/env python3
"""Local static server for the webar app: correct MIME types + HTTP Range,
which SimpleHTTPRequestHandler lacks and <video> wants."""
import http.server, os, re, socketserver, sys, mimetypes

ROOT = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
PORT = int(sys.argv[2]) if len(sys.argv) > 2 else 8790
os.chdir(ROOT)
mimetypes.add_type('application/octet-stream', '.mind')
mimetypes.add_type('video/mp4', '.mp4')

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def send_head(self):
        rng = self.headers.get('Range')
        if not rng:
            return super().send_head()
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            size = os.path.getsize(path)
        except OSError:
            self.send_error(404)
            return None
        m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
        if not m:
            return super().send_head()
        a, b = m.group(1), m.group(2)
        start = int(a) if a else 0
        end = int(b) if b else size - 1
        end = min(end, size - 1)
        if start > end:
            self.send_response(416)
            self.send_header('Content-Range', f'bytes */{size}')
            self.end_headers()
            return None
        f = open(path, 'rb')
        f.seek(start)
        self.send_response(206)
        ctype = self.guess_type(path)
        self.send_header('Content-Type', ctype)
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        return _Limited(f, end - start + 1)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))

class _Limited:
    def __init__(self, f, n): self.f, self.n = f, n
    def read(self, k=-1):
        if self.n <= 0: return b''
        if k < 0 or k > self.n: k = self.n
        d = self.f.read(k); self.n -= len(d); return d
    def close(self): self.f.close()

socketserver.ThreadingTCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), H) as s:
    print(f'serving {ROOT} on http://localhost:{PORT}', flush=True)
    s.serve_forever()

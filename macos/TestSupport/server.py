"""Transient backend for the macOS WebKit tests. Publishes only in the test's directory."""
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import sys
from urllib.parse import parse_qs, urlencode, urlsplit


directory = Path(sys.argv[1])
token = 'first'
counts = {'sign_in': 0, 'root_page': 0, 'unauthorized': 0}
failing = False


def publish(mode):
    descriptor = json.dumps({'protocol': 1, 'url': origin, 'token': token, 'mode': 'standalone'})
    if mode == 'replace':
        temporary = directory / 'host.json.tmp'
        temporary.write_text(descriptor)
        temporary.replace(directory / 'host.json')
    elif mode == 'in-place':
        (directory / 'host.json').write_text(descriptor)


class Handler(BaseHTTPRequestHandler):
    def respond(self, body, status=200, content_type='text/html; charset=utf-8'):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body.encode())

    def do_GET(self):
        global token, failing
        request = urlsplit(self.path)
        params = parse_qs(request.query)
        if request.path == '/__test/rotate':
            token = params['token'][0]
            publish(params['mode'][0])
            self.respond('ok')
            return
        if request.path == '/__test/stats':
            self.respond(json.dumps(counts), content_type='application/json')
            return
        if request.path == '/__test/fail':
            failing = params['on'][0] == '1'
            self.respond('ok')
            return
        if failing:
            self.close_connection = True  # drop the request without answering, like an unreachable backend
            return
        supplied = params.get('ide_token')
        if request.path == '/' and supplied:
            counts['sign_in'] += 1
            if supplied == [token]:
                self.send_response(303)
                del params['ide_token']
                self.send_header('Location', '/?' + urlencode(sorted(params.items()), doseq=True))
                self.send_header('Set-Cookie', f'mindfs_local_test={token}; Path=/; HttpOnly; SameSite=Strict')
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                return
        if f'mindfs_local_test={token}' not in self.headers.get('Cookie', '').split('; '):
            counts['unauthorized'] += 1
            self.respond('Local AI Agent session required', 401, 'text/plain')
            return
        if request.path == '/':
            counts['root_page'] += 1
        if request.path == '/attachment':
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', 'attachment; filename="fixture.txt"')
            self.end_headers()
            self.wfile.write(b'mac download fixture\n')
            return
        if request.path == '/viewer':
            self.respond(f'''<!doctype html><title>Viewer</title><body data-token="{html.escape(token)}">
              <a id="save" href="/attachment" download="fixture.txt">Download</a></body>''')
            return
        if request.path == '/frame':
            self.respond('''<!doctype html><script>
              webkit.messageHandlers.mindfsMacApp.postMessage({method:'getAppInfo'}).then(
                () => parent.postMessage('allowed', location.origin), () => parent.postMessage('denied', location.origin));
            </script>''')
            return
        self.respond(f'''<!doctype html><meta name="theme-color" content="#357abc"><title>Mac test</title>
          <body data-token="{html.escape(token)}"><input id="editor" placeholder="Message">
          <input id="files" type="file" multiple>
          <script>window.addEventListener('message', event => window.childBridge = event.data);</script>
          <iframe src="/frame"></iframe></body>''')


with ThreadingHTTPServer(('127.0.0.1', 0), Handler) as server:
    origin = f'http://127.0.0.1:{server.server_port}'
    publish('replace')
    server.serve_forever()

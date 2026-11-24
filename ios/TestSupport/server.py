#!/usr/bin/env python3
"""Simulator fixture only; never included in the app. Bind loopback, no external dependencies."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import argparse
import json
import logging
from urllib.parse import parse_qs, urlparse
from pathlib import Path

PAGE = Path(__file__).with_name("index.html")
SAFE_AREA_PAGE = Path(__file__).with_name("safearea.html")
COMPOSER_PAGE = Path(__file__).with_name("composer.html")



class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        logging.info(format, *args)

    def do_GET(self) -> None:
        if self.path in ('/', '/index.html'):
            payload, content_type = PAGE.read_bytes(), 'text/html; charset=utf-8'
        elif self.path == '/n/composer/':
            payload, content_type = COMPOSER_PAGE.read_bytes(), 'text/html; charset=utf-8'
        elif self.path in ('/safearea.html', '/n/test/'):
            payload, content_type = SAFE_AREA_PAGE.read_bytes(), 'text/html; charset=utf-8'
        elif self.path.split('?')[0] == '/start':
            # A page like Relay's own (no viewport-fit=cover) that moves on by itself, to ?to=<url>.
            target = parse_qs(urlparse(self.path).query).get('to', ['/n/test/'])[0]
            payload = ('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="padding:100px 20px;font:22px -apple-system,sans-serif">Relay-style page without viewport-fit=cover<script>setTimeout(function(){location.href=' + json.dumps(target) + '},1500)</script>').encode()
            content_type = 'text/html; charset=utf-8'
        elif self.path.startswith('/report?'):
            payload, content_type = b'OK', 'text/plain'
        elif self.path == '/popup':
            payload = b'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="padding:100px 20px;font:22px -apple-system;background:white;color:black">Popup reached<button onclick="window.close()">Close popup</button></body>'
            content_type = 'text/html; charset=utf-8'
        elif self.path == '/attachment':
            payload, content_type = b'attachment fixture bytes\n', 'application/octet-stream'
        elif self.path == '/real.txt':
            payload, content_type = b'real file fixture bytes\n', 'text/plain'
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(payload)))
        if self.path == '/attachment':
            self.send_header('Content-Disposition', 'attachment; filename="attachment.txt"')
        self.end_headers()
        self.wfile.write(payload)

if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    args = parser.parse_args()
    HTTPServer(('127.0.0.1', args.port), Handler).serve_forever()

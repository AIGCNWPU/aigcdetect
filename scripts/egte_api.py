#!/usr/bin/env python3
"""Loopback HTTP adapter for the trusted EGTE C-ReD/RAID runtime."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import traceback

from egte_worker import handle


MAX_REQUEST_BYTES = 4 * 1024 * 1024
MODEL_LOCK = threading.Lock()


class EgteHttpHandler(BaseHTTPRequestHandler):
    server_version = "EGTE-HTTP/1.0"

    def send_json(self, status: int, value: dict) -> None:
        body = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # pylint: disable=invalid-name
        if self.path.rstrip("/") == "/health":
            self.send_json(200, {"status": "ok"})
            return
        self.send_json(404, {"ok": False, "message": "not found"})

    def do_POST(self) -> None:  # pylint: disable=invalid-name
        if self.path.rstrip("/") not in {"", "/predict"}:
            self.send_json(404, {"ok": False, "message": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self.send_json(400, {"ok": False, "message": "invalid content length"})
            return
        if length <= 0 or length > MAX_REQUEST_BYTES:
            self.send_json(413, {"ok": False, "message": "request body size is invalid"})
            return
        try:
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError("request body must be an object")
            with MODEL_LOCK:
                response = handle(request)
            self.send_json(200, response)
        except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as error:
            self.send_json(422, {"ok": False, "message": str(error)[:240]})
        except Exception as error:  # model/configuration errors remain server-side
            traceback.print_exc()
            self.send_json(500, {"ok": False, "message": str(error)[:240] or "EGTE failed"})


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve EGTE over loopback HTTP")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8011)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), EgteHttpHandler)
    server.daemon_threads = True
    print(f"EGTE HTTP service listening on http://{args.host}:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()

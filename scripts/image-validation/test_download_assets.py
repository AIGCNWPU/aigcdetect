"""Integrity and resume tests using a local HTTP fixture, without remote downloads."""
import hashlib
import http.server
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

from download_assets import digest


class DownloadIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        self.payload = b"verified fixture bytes"
        self.requests = []
        owner = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                data = owner.payload
                value = self.headers.get("Range")
                owner.requests.append(value)
                if value:
                    start, end = value.removeprefix("bytes=").split("-")
                    start = int(start)
                    end = int(end) if end else len(data) - 1
                    content = data[start:end + 1]
                    self.send_response(206)
                    self.send_header("Content-Range", f"bytes {start}-{end}/{len(data)}")
                else:
                    content = data
                    self.send_response(200)
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def log_message(self, *args):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def run_download(self, filename="weights.bin", expected=None, segments=1):
        sha = hashlib.sha256(self.payload if expected is None else expected).hexdigest()
        metadata = {"id": "fixture/model", "sha": "a" * 40, "siblings": [{
            "rfilename": filename, "size": len(self.payload),
            "blobId": "b" * 40, "lfs": {"sha256": sha, "size": len(self.payload),
                                          "pointerSize": 128}}]}
        meta = self.root / "metadata.json"
        meta.write_text(json.dumps(metadata))
        command = [sys.executable, str(Path(__file__).with_name("download_assets.py")),
                   "--repo", "fixture/model", "--revision", "a" * 40,
                   "--metadata", str(meta), "--target", str(self.root / "target"),
                   "--ledger", str(self.root / "ledger.json"), "--transport", "curl",
                   "--endpoint", f"http://127.0.0.1:{self.server.server_port}",
                   "--workers", "1", "--segments", str(segments)]
        env = dict(os.environ, NO_PROXY="127.0.0.1,localhost", no_proxy="127.0.0.1,localhost")
        result = subprocess.run(command, capture_output=True, text=True, env=env, timeout=45)
        return result, json.loads((self.root / "ledger.json").read_text())

    def test_verified_existing_asset_is_reused_without_network(self):
        result, ledger = self.run_download()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(ledger["state"], "FILES_VERIFIED")
        self.requests.clear()
        result, _ = self.run_download()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.requests, [])

    def test_corrupt_download_is_not_promoted(self):
        result, ledger = self.run_download(expected=b"different contents")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(ledger["state"], "INCOMPLETE")
        self.assertFalse((self.root / "target/weights.bin").exists())

    def test_path_traversal_never_reaches_network(self):
        result, ledger = self.run_download(filename="../escape.bin")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(ledger["errors"][0]["error_type"], "ValueError")
        self.assertEqual(self.requests, [])
        self.assertFalse((self.root / "escape.bin").exists())

    def test_segmented_resume_and_assembly_match_publisher_digest(self):
        self.payload = bytes(range(256)) * (65 * 1024 * 4)
        partial = self.root / "target/.asset-downloads/weights.bin.part"
        partial.parent.mkdir(parents=True)
        partial.write_bytes(self.payload[:64 * 1024 * 1024])
        result, ledger = self.run_download(segments=2)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertEqual(self.requests, [f"bytes={64 * 1024 * 1024}-{len(self.payload) - 1}"])
        self.assertEqual(digest(self.root / "target/weights.bin"),
                         hashlib.sha256(self.payload).hexdigest())
        self.assertEqual(ledger["state"], "FILES_VERIFIED")

    def test_git_blob_digest_uses_git_header(self):
        path = self.root / "readme"
        path.write_bytes(b"hello\n")
        self.assertEqual(digest(path, "sha1"), "ce013625030ba8dba906f756967f9e9ca394464a")


if __name__ == "__main__":
    unittest.main()

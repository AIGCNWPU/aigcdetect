"""Check generic range assembly and hash failures without external network."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import download_range_asset


class RangeAssetTests(unittest.TestCase):
    def test_resume_hash_verification_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            payload = bytes(range(256)) * (33 * 1024 * 4)
            seed = root / "seed"
            seed.write_bytes(payload[:32 * 1024 * 1024])
            target, ledger = root / "asset", root / "ledger.json"
            argv = ["download_range_asset.py", "--url", "https://fixture.invalid/asset",
                    "--size", str(len(payload)), "--sha256", hashlib.sha256(payload).hexdigest(),
                    "--target", str(target), "--seed", str(seed), "--ledger", str(ledger)]
            calls = []

            def transfer(command, **kwargs):
                start, end = map(int, command[command.index("--range") + 1].split("-"))
                calls.append((start, end))
                Path(command[command.index("--output") + 1]).write_bytes(payload[start:end + 1])
                return subprocess.CompletedProcess(command, 0)

            with patch("sys.argv", argv), patch.object(download_range_asset.subprocess, "run", transfer):
                download_range_asset.main()
                with self.assertRaises(FileExistsError):
                    download_range_asset.main()
            self.assertEqual(target.read_bytes(), payload)
            self.assertEqual(calls, [(32 * 1024 * 1024, len(payload) - 1)])
            self.assertEqual(json.loads(ledger.read_text())["state"], "FILES_VERIFIED")

    def test_wrong_hash_never_writes_final_asset(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            seed = root / "seed"
            seed.write_bytes(b"bad bytes")
            target, ledger = root / "asset", root / "ledger.json"
            argv = ["download_range_asset.py", "--url", "https://fixture.invalid/asset",
                    "--size", "9", "--sha256", "0" * 64,
                    "--target", str(target), "--seed", str(seed), "--ledger", str(ledger)]
            with patch("sys.argv", argv), self.assertRaises(RuntimeError):
                download_range_asset.main()
            self.assertFalse(target.exists())
            self.assertFalse(ledger.exists())


if __name__ == "__main__":
    unittest.main()

"""Download official checkpoints and verify the known tested SHA-256 values."""

from pathlib import Path
import hashlib
import json
import urllib.request
import gdown

ROOT = Path(__file__).resolve().parent


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


if __name__ == "__main__":
    target = ROOT / "artifacts"
    target.mkdir(exist_ok=True)
    for item in json.loads((ROOT / "weights.json").read_text()):
        path = target / item["file"]
        if path.exists() and digest(path) == item["sha256"]:
            print(f"Already verified: {path.name}")
            continue
        temporary = path.with_suffix(path.suffix + ".part")
        if "drive.google.com" in item["url"]:
            if not gdown.download(item["url"], str(temporary), quiet=False):
                raise RuntimeError("Official checkpoint download failed")
        else:
            urllib.request.urlretrieve(item["url"], temporary)
        if digest(temporary) != item["sha256"]:
            raise RuntimeError(
                f"Checksum mismatch: {temporary}; official artifact may have changed"
            )
        temporary.replace(path)
        print(f"Verified: {path.name}")

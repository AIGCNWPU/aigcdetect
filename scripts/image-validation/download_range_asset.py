"""Resume a large public asset in ranges, recording the available integrity evidence."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
import subprocess

from download_assets import digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--size", type=int, required=True)
    parser.add_argument("--sha256")
    parser.add_argument("--no-publisher-hash", action="store_true")
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--seed", type=Path)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=8)
    args = parser.parse_args()
    if args.size <= 0 or not 1 <= args.workers <= 16:
        parser.error("Invalid size or worker limit")
    if not args.url.startswith("https://") or bool(args.sha256) == args.no_publisher_hash:
        parser.error("HTTPS and either a publisher hash or explicit no-publisher-hash are required")
    if args.target.exists():
        raise FileExistsError("Refusing to replace an existing final asset")
    chunks = args.target.parent / (args.target.name + ".chunks")
    chunks.mkdir(parents=True, exist_ok=True)
    chunk_size = 32 * 1024 * 1024

    def fetch(start):
        end = min(start + chunk_size, args.size) - 1
        length = end - start + 1
        path = chunks / f"{start:012d}"
        if path.exists() and path.stat().st_size == length:
            return path
        if args.seed and args.seed.is_file() and args.seed.stat().st_size >= end + 1:
            with args.seed.open("rb") as source, path.open("wb") as target:
                source.seek(start)
                target.write(source.read(length))
            return path
        pending = path.with_suffix(".part")
        separator = "&" if "?" in args.url else "?"
        result = subprocess.run([
            "curl", "--fail", "--location", "--silent", "--show-error",
            "--retry", "4", "--retry-all-errors", "--connect-timeout", "25",
            "--speed-time", "120", "--speed-limit", "1024",
            "--range", f"{start}-{end}", "--max-filesize", str(length),
            "--output", str(pending), f"{args.url}{separator}range_start={start}",
        ], capture_output=True, text=True)
        if result.returncode or pending.stat().st_size != length:
            raise RuntimeError(f"Range {start} failed: curl {result.returncode}")
        pending.replace(path)
        return path

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        pieces = list(pool.map(fetch, range(0, args.size, chunk_size)))
    pending = args.target.with_suffix(args.target.suffix + ".assembled")
    with pending.open("wb") as target:
        for piece in pieces:
            with piece.open("rb") as source:
                for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                    target.write(block)
    sha = digest(pending)
    if pending.stat().st_size != args.size or (args.sha256 and sha != args.sha256):
        raise RuntimeError("Assembled asset failed integrity validation; final target not written")
    pending.replace(args.target)
    ledger = {"source": args.url, "target": str(args.target.resolve()), "bytes": args.size,
              "sha256": sha, "publisher_sha256": args.sha256,
              "state": "FILES_VERIFIED" if args.sha256 else "DOWNLOADED",
              "integrity_scope": "publisher_sha256" if args.sha256 else "local_hash_only_no_official_hash",
              "loaded": False, "business_validated": False}
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    args.ledger.write_text(json.dumps(ledger, indent=2) + "\n")
    for piece in pieces:
        piece.unlink()
    chunks.rmdir()
    print(json.dumps({"state": ledger["state"], "bytes": args.size, "sha256": sha}), flush=True)


if __name__ == "__main__":
    main()

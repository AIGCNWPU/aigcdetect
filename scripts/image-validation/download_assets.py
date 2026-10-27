"""Download pinned research assets and write an integrity ledger (never load code)."""
import argparse
import hashlib
import json
import os
import subprocess
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path


def digest(path, algorithm="sha256"):
    h = hashlib.new(algorithm)
    if algorithm == "sha1":
        h.update(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--repo-type", choices=("model", "dataset"), default="model")
    parser.add_argument("--target", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--endpoint", default="https://huggingface.co")
    parser.add_argument("--metadata", type=Path,
                        help="Previously saved official HF API metadata with file hashes")
    parser.add_argument("--transport", choices=("hub", "curl"), default="hub")
    parser.add_argument("--segments", type=int, default=1,
                        help="Concurrent 64 MiB ranges per large curl asset (1-8)")
    args = parser.parse_args()
    if len(args.revision) != 40 or any(c not in "0123456789abcdef" for c in args.revision):
        parser.error("A full commit SHA is required")
    if not 1 <= args.workers <= 8:
        parser.error("workers must be between 1 and 8")
    if not 1 <= args.segments <= 8 or args.workers * args.segments > 32:
        parser.error("segments must be 1-8 and total connections at most 32")
    os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
    os.environ.setdefault("HF_HUB_DOWNLOAD_TIMEOUT", "60")
    from huggingface_hub import HfApi, ModelInfo, DatasetInfo, hf_hub_download

    # Metadata always comes from the publisher endpoint, including for mirrors.
    if args.metadata:
        metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
        if metadata.get("id") != args.repo:
            raise ValueError("Metadata repository mismatch")
        info = (ModelInfo if args.repo_type == "model" else DatasetInfo)(**metadata)
    else:
        info = HfApi(endpoint="https://huggingface.co").repo_info(
            args.repo, revision=args.revision, repo_type=args.repo_type, files_metadata=True
        )
    if info.sha != args.revision:
        raise RuntimeError("Resolved revision mismatch")
    args.target.mkdir(parents=True, exist_ok=True)
    args.ledger.parent.mkdir(parents=True, exist_ok=True)
    ledger = {"repo": args.repo, "revision": info.sha, "repo_type": args.repo_type,
              "target": str(args.target.resolve()), "endpoint": args.endpoint,
              "official_metadata_sha256": digest(args.metadata) if args.metadata else None,
              "started_at": datetime.now(timezone.utc).isoformat(),
              "state": "DOWNLOADING", "loaded": False, "business_validated": False,
              "files": [], "errors": []}

    def save():
        temp = args.ledger.with_suffix(".tmp")
        temp.write_text(json.dumps(ledger, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(args.ledger)

    def fetch(entry):
        rel = Path(entry.rfilename)
        dest = (args.target / rel).resolve()
        if args.target.resolve() not in dest.parents:
            raise ValueError("Unsafe repository path")
        def valid(path):
            if not path.is_file() or path.stat().st_size != entry.size:
                return False
            return (digest(path) == entry.lfs.sha256 if entry.lfs
                    else digest(path, "sha1") == entry.blob_id)

        # Verify existing assets before reusing them. Partial files stay separate.
        if valid(dest):
            path = dest
        elif args.transport == "curl":
            partial = args.target / ".asset-downloads" / (entry.rfilename + ".part")
            partial.parent.mkdir(parents=True, exist_ok=True)
            prefix = "datasets/" if args.repo_type == "dataset" else ""
            url = (f"{args.endpoint.rstrip('/')}/{prefix}{args.repo}/resolve/"
                   f"{args.revision}/{quote(entry.rfilename)}?download=true")
            # A failed check never promotes partial bytes to a final asset.
            curl = ["curl", "--fail", "--location", "--silent", "--show-error",
                    "--retry", "4", "--retry-all-errors", "--connect-timeout", "25",
                    "--speed-time", "120", "--speed-limit", "1024"]
            chunk_size = 64 * 1024 * 1024
            if args.segments > 1 and entry.size > chunk_size:
                chunks = partial.with_suffix(".chunks")
                chunks.mkdir(exist_ok=True)

                def fetch_range(start):
                    end = min(start + chunk_size, entry.size) - 1
                    size = end - start + 1
                    piece = chunks / f"{start:012d}"
                    if piece.exists() and piece.stat().st_size == size:
                        return piece
                    # Reuse complete ranges from a previous sequential download.
                    if partial.exists() and partial.stat().st_size >= end + 1:
                        with partial.open("rb") as source, piece.open("wb") as target:
                            source.seek(start)
                            target.write(source.read(size))
                        return piece
                    pending = piece.with_suffix(".part")
                    result = subprocess.run(curl + [
                        "--range", f"{start}-{end}", "--max-filesize", str(size),
                        "--output", str(pending), f"{url}&range_start={start}",
                    ], capture_output=True, text=True)
                    if result.returncode or pending.stat().st_size != size:
                        raise RuntimeError(f"Range transfer failed (curl {result.returncode})")
                    pending.replace(piece)
                    return piece

                starts = range(0, entry.size, chunk_size)
                with ThreadPoolExecutor(max_workers=args.segments) as ranges:
                    pieces = list(ranges.map(fetch_range, starts))
                assembled = partial.with_suffix(".assembled")
                with assembled.open("wb") as output:
                    for piece in pieces:
                        with piece.open("rb") as source:
                            for block in iter(lambda: source.read(8 * 1024 * 1024), b""):
                                output.write(block)
                if not valid(assembled):
                    raise RuntimeError("Assembled asset failed publisher integrity check")
                assembled.replace(partial)
                for piece in pieces:
                    piece.unlink()
                chunks.rmdir()
            else:
                result = subprocess.run(curl + [
                    "--continue-at", "-", "--output", str(partial), url,
                ], capture_output=True, text=True)
                if result.returncode:
                    raise RuntimeError(f"curl exit {result.returncode}")
            if not valid(partial):
                raise RuntimeError("Downloaded content failed publisher integrity check")
            dest.parent.mkdir(parents=True, exist_ok=True)
            partial.replace(dest)
            path = dest
        else:
            # HF keeps partial downloads resumable. Never execute downloaded Python.
            path = Path(hf_hub_download(args.repo, entry.rfilename, repo_type=args.repo_type,
                                       revision=args.revision, local_dir=str(args.target),
                                       endpoint=args.endpoint))
        if path.stat().st_size != entry.size:
            raise RuntimeError("Size mismatch")
        sha = digest(path)
        if entry.lfs:
            if sha != entry.lfs.sha256:
                raise RuntimeError("LFS SHA-256 mismatch")
            method = "publisher_lfs_sha256"
        else:
            if digest(path, "sha1") != entry.blob_id:
                raise RuntimeError("Git blob digest mismatch")
            method = "publisher_git_blob_sha1"
        return {"path": entry.rfilename, "bytes": entry.size, "sha256": sha,
                "verification": method}

    save()
    print(f"START {args.repo}: {len(info.siblings)} files", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        jobs = {pool.submit(fetch, entry): entry.rfilename for entry in info.siblings}
        for future in as_completed(jobs):
            try:
                result = future.result()
                ledger["files"].append(result)
                count = len(ledger["files"])
                if count % 50 == 0 or len(info.siblings) < 30:
                    print(f"VERIFIED {count}/{len(info.siblings)} {result['path']}", flush=True)
            except Exception as error:
                # Our own validation errors contain no signed CDN URLs or tokens.
                reason = str(error)[:200] if type(error) in (RuntimeError, ValueError) else type(error).__name__
                ledger["errors"].append({"path": jobs[future], "error_type": type(error).__name__,
                                         "reason": reason})
                print(f"FAILED {jobs[future]}: {reason}", flush=True)
            save()
    ledger["files"].sort(key=lambda item: item["path"])
    ledger["state"] = "FILES_VERIFIED" if not ledger["errors"] else "INCOMPLETE"
    ledger["finished_at"] = datetime.now(timezone.utc).isoformat()
    save()
    print(ledger["state"], flush=True)
    return 1 if ledger["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())

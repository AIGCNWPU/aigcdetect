#!/usr/bin/env python
"""只下载 DailyTalkEdit 里 val/test 需要的文件（不打 14.7 GB 全量）。

需要的三份：
    concat_utts/<id>_original.wav
    concat_utts/<id>_modified.wav
    modified_utts/<id>_<target_utterance_idx>_modified.wav

默认走 hf-mirror（HuggingFace 在国内通常直连不通）；已存在的文件跳过，可反复重跑续传。

用法：
    python scripts/fetch_dailytalkedit_subset.py --root data/DailyTalkEdit --splits val test
    python scripts/fetch_dailytalkedit_subset.py --root data/DailyTalkEdit --splits val --endpoint https://huggingface.co
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO = "wsntxxn/DailyTalkEdit"
BASE_PATH = "daily_talk_edit"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="按需下载 DailyTalkEdit 的 val/test 音频")
    parser.add_argument("--root", default="data/DailyTalkEdit", help="快照根目录（下面有 daily_talk_edit/）")
    parser.add_argument("--splits", nargs="+", default=["val", "test"], choices=["val", "test"])
    parser.add_argument("--endpoint", default="https://hf-mirror.com")
    parser.add_argument("--force", action="store_true", help="已存在也重新下载")
    parser.add_argument("--log-every", type=int, default=20)
    parser.add_argument(
        "--pair-ids",
        default=None,
        help="只下载 sample_{split}.json 里列出的对话（抽样评测时用）",
    )
    return parser


def read_jsonl(path: Path) -> list[dict]:
    rows: list[dict] = []
    with open(path, "r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def dialog_id_of(filename: str) -> str:
    stem = Path(filename).stem
    for suffix in ("_modified", "_original"):
        if stem.endswith(suffix):
            return stem[: -len(suffix)]
    return stem


def fetch(url: str, dest: Path, force: bool, retries: int = 4) -> str:
    if dest.is_file() and dest.stat().st_size > 0 and not force:
        return "skip"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(url, timeout=120) as response, open(tmp, "wb") as handle:
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    handle.write(chunk)
            tmp.replace(dest)
            return "ok"
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code in (401, 403, 404):
                break
        except Exception as exc:  # 网络抖动
            last_error = exc
        time.sleep(min(30, 3 * attempt))
    if tmp.exists():
        tmp.unlink()
    raise RuntimeError(f"下载失败 {dest.name}: {last_error}")


def main() -> int:
    args = build_parser().parse_args()
    root = Path(args.root).expanduser().resolve()
    base = root / BASE_PATH
    metadata_dir = base / "metadata"
    if not metadata_dir.is_dir():
        print(f"缺少 {metadata_dir}；先跑 verify_data.py 或手工下载 metadata", file=sys.stderr)
        return 2

    modify_config: dict = {}
    config_path = metadata_dir / "modify_config_pipeline.json"
    if config_path.is_file():
        with open(config_path, "r", encoding="utf-8") as handle:
            modify_config = json.load(handle)

    tasks: list[tuple[str, Path]] = []
    only_pairs: set[str] | None = None
    if args.pair_ids:
        with open(args.pair_ids, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
        pairs = payload.get("pairs") if isinstance(payload, dict) else payload
        only_pairs = {str(item) for item in pairs}
        print(f"只处理 {len(only_pairs)} 个对话（来自 {args.pair_ids}）", flush=True)

    for split in args.splits:
        rows_path = metadata_dir / f"{split}.jsonl"
        if not rows_path.is_file():
            print(f"跳过 {split}：缺少 {rows_path}", file=sys.stderr)
            continue
        for row in read_jsonl(rows_path):
            dialog_id = dialog_id_of(str(row.get("filename", "")))
            if only_pairs is not None and dialog_id not in only_pairs:
                continue
            entry = modify_config.get(str(dialog_id)) or modify_config.get(dialog_id) or {}
            target = entry.get("target_utterance_idx")
            for name in (f"concat_utts/{dialog_id}_original.wav", f"concat_utts/{dialog_id}_modified.wav"):
                tasks.append((name, base / name))
            if target is not None:
                name = f"modified_utts/{dialog_id}_{int(target)}_modified.wav"
                tasks.append((name, base / name))
            else:
                print(f"[warn] {dialog_id} 没有 target_utterance_idx，跳过 modified 单句", file=sys.stderr)

    # 去重
    seen: set[Path] = set()
    unique: list[tuple[str, Path]] = []
    for name, dest in tasks:
        if dest not in seen:
            seen.add(dest)
            unique.append((name, dest))

    print(f"共 {len(unique)} 个文件，endpoint={args.endpoint}", flush=True)
    started = time.time()
    done = skipped = failed = 0
    failures: list[tuple[str, str]] = []
    total_bytes = 0

    for index, (name, dest) in enumerate(unique, 1):
        url = f"{args.endpoint}/datasets/{REPO}/resolve/main/{BASE_PATH}/{name}"
        try:
            status = fetch(url, dest, args.force)
        except RuntimeError as exc:
            failed += 1
            failures.append((name, str(exc)))
            print(f"[{index}/{len(unique)}] FAIL {name}", flush=True)
            continue
        if status == "ok":
            done += 1
            total_bytes += dest.stat().st_size if dest.is_file() else 0
        else:
            skipped += 1
        if index % args.log_every == 0 or index == len(unique):
            elapsed = time.time() - started
            rate = total_bytes / elapsed / 1024 if elapsed > 0 else 0
            print(
                f"[{index}/{len(unique)}] 新下载 {done} 跳过 {skipped} 失败 {failed} "
                f"已用 {elapsed / 60:.1f} min，约 {rate:.0f} KB/s",
                flush=True,
            )

    print(f"完成：新下载 {done}，跳过 {skipped}，失败 {failed}", flush=True)
    for name, error in failures[:20]:
        print(f"  失败 {name}: {error}", flush=True)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

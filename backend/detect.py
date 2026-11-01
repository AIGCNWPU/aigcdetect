"""命令行检测入口（复用 engine.py 的推理逻辑）。

用法：
    python detect.py samples/wav1.wav
    python detect.py "audios/*.wav" --jsonl out.jsonl --threshold 0.6
    python detect.py --dir /path/to/audios
"""
import argparse
import glob
import json
import os
import sys

from engine import Engine


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("inputs", nargs="*", help="音频路径，支持通配符")
    parser.add_argument("--dir", help="目录，递归匹配常见音频格式")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--jsonl", help="逐条结果写入该文件")
    parser.add_argument("--device", default="cuda:0")
    args = parser.parse_args()

    files = []
    for pattern in args.inputs:
        files.extend(sorted(glob.glob(pattern)))
    if args.dir:
        for ext in ("wav", "flac", "mp3", "m4a", "ogg", "opus"):
            files.extend(sorted(glob.glob(os.path.join(args.dir, "**", f"*.{ext}"), recursive=True)))
    files = [f for f in dict.fromkeys(files) if os.path.isfile(f)]
    if not files:
        parser.error("没有匹配到音频文件")

    print("loading engine ...", file=sys.stderr, flush=True)
    engine = Engine(device=args.device)
    engine.load()

    writer = open(args.jsonl, "w", encoding="utf-8") if args.jsonl else None
    hits = 0
    for path in files:
        result = engine.infer_file(path)
        decision = "fake" if result["pFake"] >= args.threshold else "real"
        hits += decision == "fake"
        row = {
            "file": path,
            "pFake": result["pFake"],
            "decision": decision,
            "realOrFake": result["realOrFake"],
            "spoofMethod": result["spoofMethod"],
            "spoofMethodLabel": result["spoofMethodLabel"],
            "fakeRegion": result["fakeRegion"],
            "durationSec": result["durationSec"],
            "latencyMs": result["latencyMs"],
            "raw": result["raw"],
        }
        print(json.dumps(row, ensure_ascii=False))
        if writer:
            writer.write(json.dumps(row, ensure_ascii=False) + "\n")
        sys.stdout.flush()

    print(f"\n{len(files)} files, {hits} judged fake, threshold={args.threshold}", file=sys.stderr)
    if writer:
        writer.close()


if __name__ == "__main__":
    main()

#!/usr/bin/env python
"""打印音频的采样率/声道/时长，用来核实数据集格式。

用法：
    python scripts/probe_audio.py <file-or-dir> [more...]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import soundfile as sf


def describe(path: Path) -> dict:
    info = sf.info(str(path))
    return {
        "path": str(path),
        "name": path.name,
        "samplerate": int(info.samplerate),
        "channels": int(info.channels),
        "subtype": info.subtype,
        "frames": int(info.frames),
        "duration": round(float(info.frames) / float(info.samplerate), 4),
        "bytes": path.stat().st_size,
    }


def main(argv: list[str]) -> int:
    targets: list[Path] = []
    for item in argv:
        path = Path(item)
        if path.is_dir():
            targets.extend(sorted(p for p in path.glob("*.wav"))[:5])
        elif path.is_file():
            targets.append(path)
        else:
            print(json.dumps({"missing": item}), flush=True)
    for path in targets:
        try:
            print(json.dumps(describe(path), ensure_ascii=False), flush=True)
        except Exception as exc:
            print(json.dumps({"path": str(path), "error": f"{type(exc).__name__}: {exc}"}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

#!/usr/bin/env python
"""给前端演示页生成"原音频 / A / B"的波形对比图。

用法：
    python scripts/render_frontend_figures.py --results outputs/test \
        --ids 11_modified 214_modified 443_modified 70_modified 11_original \
        --out outputs/frontend_figures
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from spoofdiar.debug_plots import save_mask_figure  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="生成前端用的波形对比图")
    parser.add_argument("--results", default="outputs/test")
    parser.add_argument("--ids", nargs="+", required=True)
    parser.add_argument("--out", default="outputs/frontend_figures")
    parser.add_argument(
        "--no-title",
        action="store_true",
        help="不写图标题（服务器缺中文字体时中文会变方块，交给页面上的标题说明）",
    )
    args = parser.parse_args()

    root = Path(args.results)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for file_id in args.ids:
        file_dir = root / file_id
        result = json.loads((file_dir / "result.json").read_text(encoding="utf-8"))
        png = out / f"{file_id}.png"
        save_mask_figure(
            result["audio_path"],
            {"A": file_dir / "A.wav", "B": file_dir / "B.wav"},
            int(result.get("samplerate") or 16000),
            png,
            title="" if args.no_title else file_id,
            speaker_segments={
                str(item.get("id")): item.get("segments") or []
                for item in result.get("speakers", [])
            },
        )
        print(f"ok {file_id} -> {png} ({png.stat().st_size / 1024:.0f} KB)", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

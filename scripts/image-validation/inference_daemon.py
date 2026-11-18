#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""常驻推理服务（openspec refine-image-platform-ux T1）。

启动时一次性加载 DDA（整图 AI 检测）与 SEED（文档篡改定位）模型，之后持续提供
本机 HTTP 推理，消除"每次任务重新加载模型"的冷启动等待（网络盘冷缓存实测 40–80s）。

端点：
    GET  /health   → {"status":"ok","models":{"mirror":bool,"seed":bool},"device":...}
    POST /mirror   → body: analyze.py 的 manifest（[{id,path}]）
                     → 返回与 analyze.py 相同结构的报告数组
    POST /seed     → body: evaluate_seed.py 的 manifest（[{sample_id,path,expected_sha256}]）
                     → 返回与 evaluate_seed.py 相同结构的报告对象

仅监听本机回环；调用方（local-runtime.js / general/service.js）在服务不可达时
自动回退到按任务启动模式，输出结构保持一致。

启动（正式服务器 systemd 长挂起，开发机可手动）：
    AIGC_PLATFORM_ROOT=… python3 scripts/image-validation/inference_daemon.py \
        [--gpu 1] [--port 8617] [--models mirror,seed]
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT / "src/modules/image/documents/python"))
sys.path.insert(0, str(PROJECT / "scripts/image-validation"))

STATE = {"mirror": None, "seed": None, "device": None, "loaded_at": None}


def load_models(names, gpu):
    import torch  # noqa: F401 提前触发 CUDA 初始化
    root = Path(os.environ.get("AIGC_PLATFORM_ROOT") or PROJECT.parent)
    if "mirror" in names:
        sys.path.insert(0, str(PROJECT / "src/modules/image/general"))
        from dda_hplus import DDAPredictor  # analyze.py 同款加载
        weights = root / "weights/dda_hplus/dda_hplus_fp32.pth"
        STATE["mirror"] = {"predictor": DDAPredictor(str(weights), str(gpu)), "weights": str(weights)}
        print("[inference] DDA loaded", flush=True)
    if "seed" in names:
        from seed_detector import SeedDetector
        STATE["seed"] = {"detector": SeedDetector(str(root / "third_party/seed"), str(root / "weights/seed"), str(gpu))}
        print("[inference] SEED loaded", flush=True)
    STATE["device"] = str(gpu)
    STATE["loaded_at"] = time.time()


def run_mirror(manifest):
    import torch
    from PIL import Image, ImageOps
    predictor = STATE["mirror"]["predictor"]
    rows = []
    for i, row in enumerate(manifest):
        sample = dict(row, status="failed")
        start = time.perf_counter()
        try:
            path = Path(row["path"])
            sample["input_sha256"] = __import__("hashlib").sha256(path.read_bytes()).hexdigest()
            with Image.open(path) as img:
                sample["exif_orientation"] = img.getexif().get(274, 1)
                image = ImageOps.exif_transpose(img).convert("RGB")
            values = predictor.predict(image)
            sample.update(values)
            sample["seconds"] = time.perf_counter() - start
            sample["status"] = "completed"
        except Exception as error:
            sample["error_type"] = type(error).__name__
            sample["error"] = str(error)[:400]
            sample["seconds"] = time.perf_counter() - start
        rows.append(sample)
    return rows


def run_seed(manifest):
    detector = STATE["seed"]["detector"]
    from PIL import Image, ImageOps
    import numpy as np  # noqa: F401
    report = {"provider": "SEED", "samples": [], "input_mode": "native",
              "threshold": float(__import__("os").environ.get("AIGC_SEED_THRESHOLD", "0.35")),
              "score_semantics": "uncalibrated_max_native_tile_forgery_score",
              "resident": True}
    for i, row in enumerate(manifest):
        sample = dict(row, status="failed")
        start = time.perf_counter()
        try:
            path = Path(row["path"])
            sample["input_sha256"] = __import__("hashlib").sha256(path.read_bytes()).hexdigest()
            with Image.open(path) as img:
                sample["exif_orientation"] = img.getexif().get(274, 1)
                image = ImageOps.exif_transpose(img).convert("RGB")
            values, prob, mask = detector.predict(image, max_pixels=20_000_000)
            sample.update(values)
            sample["seconds"] = time.perf_counter() - start
            sample["status"] = "succeeded"
        except Exception as error:
            sample["error_type"] = type(error).__name__
            sample["error"] = str(error)[:400]
            sample["seconds"] = time.perf_counter() - start
        report["samples"].append(sample)
    return report


def main():
    parser = argparse.ArgumentParser(description="常驻推理服务（DDA + SEED）")
    parser.add_argument("--gpu", default="0")
    parser.add_argument("--port", type=int, default=int(__import__("os").environ.get("AIGC_INFERENCE_PORT", "8617")))
    parser.add_argument("--models", default="mirror,seed")
    args = parser.parse_args()

    names = [n.strip() for n in args.models.split(",") if n.strip()]
    load_models(names, args.gpu)

    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # 安静模式，任务日志由调用方记录
            pass

        def _json(self, code, body):
            payload = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self):
            if self.path == "/health":
                self._json(200, {"status": "ok", "models": {k: bool(v) for k, v in STATE.items() if k in ("mirror", "seed")},
                                 "device": STATE["device"]})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self):
            try:
                length = int(self.headers.get("Content-Length") or 0)
                manifest = json.loads(self.rfile.read(length))
                if self.path == "/mirror":
                    if not STATE["mirror"]:
                        return self._json(503, {"error": "mirror_model_not_loaded"})
                    self._json(200, run_mirror(manifest))
                elif self.path == "/seed":
                    if not STATE["seed"]:
                        return self._json(503, {"error": "seed_model_not_loaded"})
                    self._json(200, run_seed(manifest))
                else:
                    self._json(404, {"error": "not_found"})
            except Exception as error:
                self._json(500, {"error": f"{type(error).__name__}: {error}"})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[inference] listening 127.0.0.1:{args.port} models={names}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

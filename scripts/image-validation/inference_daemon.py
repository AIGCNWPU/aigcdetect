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
import hashlib
import json
import os
import sys
import threading
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src/modules/image/documents/python"))
sys.path.insert(0, str(PROJECT / "scripts/image-validation"))

STATE = {"mirror": None, "seed": None, "device": None, "loaded_at": None}
INFER_LOCK = threading.Lock()  # torch 模型非线程安全：推理串行化


def load_models(names, gpu):
    """精确复刻 analyze.py / evaluate_seed.py 的加载序列（含 CUDA flags 与显存上限）。"""
    import torch
    root = Path(os.environ.get("AIGC_PLATFORM_ROOT") or PROJECT.parent)
    os.environ["CUDA_VISIBLE_DEVICES"] = str(gpu)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    memory_limit = os.environ.get("AIGC_GPU_MEMORY_LIMIT_MB")
    torch.set_num_threads(4)
    torch.manual_seed(0)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.enable_flash_sdp(False)
    torch.backends.cuda.enable_mem_efficient_sdp(False)
    if "mirror" in names:
        if memory_limit:
            limit = int(memory_limit) * 1024 ** 2
            total = torch.cuda.get_device_properties(0).total_memory
            if not 1024 ** 3 <= limit <= total:
                raise ValueError("invalid_gpu_memory_limit")
            torch.cuda.set_per_process_memory_fraction(limit / total, 0)
        sys.path.insert(0, str(root / "third_party/dda_hplus"))
        from dda_hplus import DDAPredictor
        weights = root / "weights/dda_hplus/dda_hplus_fp32.pth"
        digest = (hashlib.file_digest(weights.open("rb"), "sha256").hexdigest()
                  if hasattr(hashlib, "file_digest") else hashlib.sha256(weights.read_bytes()).hexdigest())
        if digest != "f7f8e968cc26b9ad01db99fa985c89c6e5610b1af8d73993eb70490513fc6951":
            raise ValueError("weights_hash_mismatch")
        STATE["mirror"] = {"predictor": DDAPredictor(weights), "digest": digest}
        print("[inference] DDA loaded", flush=True)
    if "seed" in names:
        sys.path.insert(0, str(PROJECT / "src/modules/image/documents/python"))
        from seed_detector import SeedDetector
        STATE["seed"] = {"detector": SeedDetector(str(root / "third_party/seed"), str(root / "weights/seed"), str(gpu))}
        print("[inference] SEED loaded", flush=True)
    STATE["device"] = str(gpu)
    STATE["loaded_at"] = time.time()


def run_mirror(manifest):
    """analyze.py --classify-only 语义：crop parity 校验 + 分数 + model 元数据。"""
    import hashlib
    from PIL import Image, ImageOps
    from torchvision.transforms import functional as F
    predictor = STATE["mirror"]["predictor"]
    digest = STATE["mirror"]["digest"]
    rows = []
    with INFER_LOCK:
        for row in manifest:
          sample = {"id": row.get("sample_id", row.get("id")), "status": "failed"}
          start = time.monotonic()
          try:
              path = Path(row["path"])
              with Image.open(path) as im:
                  im.load()
                  if im.format not in ["JPEG", "PNG", "WEBP"]:
                      raise ValueError("unsupported_format")
                  if im.width * im.height > 40000000:
                      raise ValueError("pixel_limit")
                  diag = {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "dimensions": list(im.size)}
                  rgb = im.convert("RGB")
              result = {"id": row.get("id"), "status": "completed", "diagnostics": diag}
              crop = F.center_crop(rgb, [336, 336])
              baseline = predictor.predict([rgb])[0]
              score = baseline["fake_probability"]
              crop_score = predictor.predict([crop])[0]["fake_probability"]
              if abs(score - crop_score) > 1e-5:
                  raise ValueError("crop_parity_failed")
              threshold = float(os.environ.get("AIGC_DDA_THRESHOLD", "0.25"))
              result.update(score=score, coverage="中心336×336区域",
                            model={"id": predictor.model_id, "weightsSha256": digest,
                                   "threshold": threshold, "precision": "FP32"})
              threshold = float(os.environ.get("AIGC_DDA_THRESHOLD", "0.25"))
              result.update(verdict="likely_ai" if score > threshold else "no_obvious_ai",
                            summary="发现较强的AI生成线索。" if score > threshold else "本次检测未发现明显AI生成线索。")
              result["seconds"] = time.monotonic() - start
              rows.append(result)
          except Exception as error:
              sample["error_type"] = type(error).__name__
              sample["error"] = str(error)[:300]
              sample["seconds"] = time.monotonic() - start
              rows.append(sample)
    return rows


def run_seed(manifest):
    detector = STATE["seed"]["detector"]
    global INFER_LOCK
    from PIL import Image, ImageOps
    import numpy as np  # noqa: F401
    report = {"provider": "SEED", "samples": [], "input_mode": "native",
              "threshold": float(__import__("os").environ.get("AIGC_SEED_THRESHOLD", "0.35")),
              "score_semantics": "uncalibrated_max_native_tile_forgery_score",
              "resident": True}
    with INFER_LOCK:
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

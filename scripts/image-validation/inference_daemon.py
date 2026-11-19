#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""全模型常驻推理服务（openspec refine-image-platform-ux T1 扩展版）。

常驻模型（一次加载、长期在线，消除每任务 40–90s 冷启动）：
  - DDA-H+（自研骨干，整图 AI 检测；2.1 与 2.3 共用；历史阶段键名 mirror 仅兼容保留，MIRROR 已废弃）
  - SEED（DINOv3+LoRA+EoMT，票据文档域篡改定位；2.3）
  - TruFor（通用图像域局部篡改；2.1）
  - VLAForge + YuNet（人像伪造；2.1）
  - RPA OpenFake27（闭集生成来源归因；2.1）
  - 翻拍分类器（document_recapture.RecaptureScorer，纯 numpy；2.3 quality 阶段可选加速）

端点（仅监听 127.0.0.1；调用方不可达时自动回退按任务启动，输出结构一致）：
  GET  /health    模型就绪状态
  POST /mirror    2.3 整图（analyze.py --classify-only 语义：crop parity + verdict/threshold）
  POST /seed      2.3 篡改定位（evaluate_seed.py native 语义，含 oriented_size）
  POST /general   2.1 全链路（analyze.py 完整语义：诊断/遮挡分析/空间分布/TruFor/人脸/来源/声明）
  POST /recapture 单图翻拍打分（document_recapture 特征 + 分类器）

推理串行锁：torch 模型非线程安全，所有 GPU 推理全局互斥。
"""

import argparse
import base64
import hashlib
import io
import json
import os
import sys
import threading
import time
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT / "src/modules/image/documents/python"))
sys.path.insert(0, str(PROJECT / "src/modules/image/general"))
sys.path.insert(0, str(PROJECT / "scripts/image-validation"))

STATE = {"mirror": None, "seed": None, "tamper": None, "face": None, "source": None,
         "recapture": None, "device": None, "loaded_at": None}
INFER_LOCK = threading.Lock()  # torch 模型非线程安全：GPU 推理串行化


def _torch_flags():
    import torch
    torch.set_num_threads(4)
    torch.manual_seed(0)
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    torch.backends.cuda.enable_flash_sdp(False)
    torch.backends.cuda.enable_mem_efficient_sdp(False)


def load_models(names, gpu):
    root = Path(os.environ.get("AIGC_PLATFORM_ROOT") or PROJECT.parent)
    os.environ["CUDA_VISIBLE_DEVICES"] = str(gpu)
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    _torch_flags()
    import torch
    memory_limit = os.environ.get("AIGC_GPU_MEMORY_LIMIT_MB")
    if memory_limit and "mirror" in names:
        limit = int(memory_limit) * 1024 ** 2
        total = torch.cuda.get_device_properties(0).total_memory
        if not 1024 ** 3 <= limit <= total:
            raise ValueError("invalid_gpu_memory_limit")
        torch.cuda.set_per_process_memory_fraction(limit / total, 0)

    if "mirror" in names:
        sys.path.insert(0, str(root / "third_party/dda_hplus"))
        from dda_hplus import DDAPredictor
        weights = root / "weights/dda_hplus/dda_hplus_fp32.pth"
        digest = (hashlib.file_digest(weights.open("rb"), "sha256").hexdigest()
                  if hasattr(hashlib, "file_digest") else hashlib.sha256(weights.read_bytes()).hexdigest())
        if digest != "f7f8e968cc26b9ad01db99fa985c89c6e5610b1af8d73993eb70490513fc6951":
            raise ValueError("weights_hash_mismatch")
        STATE["mirror"] = {"predictor": DDAPredictor(weights), "digest": digest}
        print("[inference] DDA-H+ loaded", flush=True)
    if "seed" in names:
        from seed_detector import SeedDetector
        STATE["seed"] = {"detector": SeedDetector(str(root / "third_party/seed"), str(root / "weights/seed"), "0")}
        print("[inference] SEED loaded", flush=True)
    if "forensics" in names:  # TruFor + VLAForge 人脸 + RPA 来源（analyze.py 的 forensics 三件套）
        # 冲突根因：vlaforge/model 没有 __init__.py（命名空间包），seed/model 是常规包；
        # Python 里常规包优先于命名空间包，仅调整 sys.path 顺序无效。这里把 sys.modules["model"]
        # 显式绑定为 vlaforge 的命名空间包，供 engine.py 的 import_module("model.clip.clip") 使用。
        import types
        vlaforge_root = str(root / "third_party/vlaforge")
        saved_path = list(sys.path)
        for name in [n for n in sys.modules if n == "model" or n.startswith("model.")]:
            del sys.modules[name]
        vlaforge_model = types.ModuleType("model")
        vlaforge_model.__path__ = [str(root / "third_party/vlaforge/model")]
        sys.modules["model"] = vlaforge_model
        sys.path.insert(0, vlaforge_root)
        from tamper import TamperEngine
        from forensics import FaceEngine, SourceEngine
        device = "cuda:0"
        STATE["tamper"] = {"engine": TamperEngine(root, device)}
        print("[inference] TruFor loaded", flush=True)
        STATE["face"] = {"engine": FaceEngine(root, device)}
        print("[inference] VLAForge+YuNet loaded", flush=True)
        # 还原：清掉 vlaforge 的 model.*（含 shim），SEED 侧按自身路径重新导入自己的 model 包
        for name in [n for n in sys.modules if n == "model" or n.startswith("model.")]:
            del sys.modules[name]
        sys.path[:] = saved_path
        STATE["source"] = {"engine": SourceEngine(root, device)}
        print("[inference] RPA loaded", flush=True)
    if "recapture" in names:
        from document_recapture import RecaptureScorer
        scorer = RecaptureScorer()
        if scorer.available:
            STATE["recapture"] = scorer
            print("[inference] recapture scorer loaded", flush=True)
        else:
            print(f"[inference] recapture scorer unavailable: {scorer.reason}", flush=True)
    STATE["device"] = str(gpu)
    STATE["loaded_at"] = time.time()


def _open_rgb(path, validate=None):
    from PIL import Image, ImageOps
    with Image.open(path) as im:
        im.load()
        if validate:
            validate(im)
        return im.format, ImageOps.exif_transpose(im).convert("RGB")


# ---------------------------------------------------------------- /mirror（2.3 整图）

def run_mirror(manifest):
    """analyze.py --classify-only 语义：crop parity 校验 + verdict/threshold。"""
    from torchvision.transforms import functional as F

    def validate(im):
        if im.format not in ["JPEG", "PNG", "WEBP"]:
            raise ValueError("unsupported_format")
        if im.width * im.height > 40000000:
            raise ValueError("pixel_limit")

    predictor = STATE["mirror"]["predictor"]
    digest = STATE["mirror"]["digest"]
    rows = []
    with INFER_LOCK:
        for row in manifest:
            sid = row.get("sample_id", row.get("id"))
            sample = {"id": sid, "status": "failed"}
            start = time.monotonic()
            try:
                path = Path(row["path"])
                input_sha = hashlib.sha256(path.read_bytes()).hexdigest()
                if row.get("expected_sha256") and input_sha != row["expected_sha256"]:
                    raise ValueError("source_changed")
                _, rgb = _open_rgb(path, validate)
                diag = {"sha256": input_sha, "dimensions": list(rgb.size)}
                result = {"id": sid, "status": "completed", "input_sha256": input_sha, "diagnostics": diag}
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


# ---------------------------------------------------------------- /seed（2.3 篡改）

def run_seed(manifest):
    """evaluate_seed.py native 语义（含 oriented_size 供 workflow 几何校验）。"""
    detector = STATE["seed"]["detector"]
    report = {"provider": "SEED", "samples": [], "input_mode": "native",
              "threshold": float(os.environ.get("AIGC_SEED_THRESHOLD", "0.35")),
              "score_semantics": "uncalibrated_max_native_tile_forgery_score",
              "resident": True}
    with INFER_LOCK:
        for row in manifest:
            sample = dict(row, status="failed")
            start = time.perf_counter()
            try:
                path = Path(row["path"])
                sample["input_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
                _, image = _open_rgb(path)
                sample["oriented_size"] = list(image.size)
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


# ---------------------------------------------------------------- /recapture（翻拍打分）

def run_recapture(manifest):
    from document_recapture import extract_features
    scorer = STATE["recapture"]
    rows = []
    for row in manifest:  # 纯 numpy，不占 GPU 锁
        sid = row.get("sample_id", row.get("id"))
        sample = {"id": sid, "status": "failed"}
        start = time.perf_counter()
        try:
            path = Path(row["path"])
            _, rgb = _open_rgb(path)
            prob, detail = scorer.score(extract_features(rgb))
            level, score100 = scorer.level(prob)
            sample.update({"status": "succeeded", "probability": prob,
                          "level": level, "score": score100,
                          "modelVersion": detail.get("modelVersion"),
                          "thresholds": scorer.model.get("thresholds"),
                          "semantics": detail.get("semantics")})
        except Exception as error:
            sample["error_type"] = type(error).__name__
            sample["error"] = str(error)[:300]
        sample["seconds"] = time.perf_counter() - start
        rows.append(sample)
    return rows


# ---------------------------------------------------------------- /general（2.1 全链路）

def _png(image):
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def run_general(manifest):
    """analyze.py 完整语义（非 classify-only）：诊断 + 遮挡 + 空间 + TruFor + 人脸 + 来源 + 声明。"""
    import numpy as np
    from PIL import Image, ImageFilter
    from spatial import full_image_distribution

    predictor = STATE["mirror"]["predictor"]
    digest = STATE["mirror"]["digest"]
    results = []
    with INFER_LOCK:
        for row in manifest:
            start = time.monotonic()
            try:
                path = Path(row["path"])
                with Image.open(path) as im:
                    im.load()
                    if im.format not in ["JPEG", "PNG", "WEBP"]:
                        raise ValueError("unsupported_format")
                    if im.width * im.height > 40000000:
                        raise ValueError("pixel_limit")
                    import analyze as A
                    diag = A.diagnostics(path, im)
                    from PIL import ImageOps
                    rgb = ImageOps.exif_transpose(im).convert("RGB")
                w, h = rgb.size
                result = {"id": row.get("id"), "status": "completed", "diagnostics": diag}

                from torchvision.transforms import functional as F
                crop = F.center_crop(rgb, [336, 336])
                baseline = predictor.predict([rgb])[0]
                score = baseline["fake_probability"]
                crop_score = predictor.predict([crop])[0]["fake_probability"]
                if abs(score - crop_score) > 1e-5:
                    raise ValueError("crop_parity_failed")
                padx = max(0, 336 - w) // 2
                pady = max(0, 336 - h) // 2
                left = round((max(w, 336) - 336) / 2) - padx
                top = round((max(h, 336) - 336) / 2) - pady
                blur = crop.filter(ImageFilter.GaussianBlur(18))
                mean = tuple(int(x) for x in np.asarray(crop).mean((0, 1)))
                flat = Image.new("RGB", crop.size, mean)
                variants, boxes = [], []
                for y in range(4):
                    for x in range(4):
                        box = (x * 84, y * 84, (x + 1) * 84, (y + 1) * 84)
                        boxes.append(box)
                        for fill in [blur, flat]:
                            masked = crop.copy()
                            masked.paste(fill.crop(box), box)
                            variants.append(masked)
                predictions = predictor.predict(variants, batch_size=4)
                cells = []
                from PIL import ImageDraw
                heat = Image.new("RGBA", rgb.size, (0, 0, 0, 0))
                draw = ImageDraw.Draw(heat)
                for i, b in enumerate(boxes):
                    drops = [score - predictions[2 * i + j]["fake_probability"] for j in range(2)]
                    delta = min(drops)
                    rect = [max(0, min(w, b[0] + left)), max(0, min(h, b[1] + top)),
                            max(0, min(w, b[2] + left)), max(0, min(h, b[3] + top))]
                    marked = score > .5 and delta >= .05 and rect[2] > rect[0] and rect[3] > rect[1]
                    if marked:
                        draw.rectangle(rect, fill=(239, 54, 110, int(80 + min(delta, 1) * 130)),
                                       outline=(255, 110, 140, 230), width=2)
                    cells.append({"box": rect, "drops": drops,
                                  "maskedScores": [predictions[2 * i + j]["fake_probability"] for j in range(2)],
                                  "marked": marked})
                heat.thumbnail((1200, 1200))
                diag["layers"]["sensitivity"] = _png(heat)
                field, spatial = full_image_distribution(rgb, predictor)
                diag["layers"]["aiFeatures"] = _png(field)
                result["spatial"] = spatial
                threshold = float(os.environ.get("AIGC_DDA_THRESHOLD", "0.25"))
                result.update(verdict="likely_ai" if score > threshold else "no_obvious_ai",
                             score=score,
                             summary="发现较强的AI生成线索。" if score > threshold else "本次检测未发现明显AI生成线索。",
                             coverage="中心336×336区域；边缘未参与本次模型判断。",
                             model={"id": predictor.model_id, "weightsSha256": digest, "threshold": threshold,
                                    "precision": "FP32",
                                    "preprocess": "RGB; CenterCrop336 with zero padding; CLIP normalization; no resize or EXIF transpose"},
                             sensitivity={"status": "completed", "threshold": .05, "baseline": score,
                                         "cropParityError": abs(score - crop_score),
                                         "crop": [max(0, left), max(0, top), min(w, left + 336), min(h, top + 336)],
                                         "cells": cells, "markedCount": sum(c["marked"] for c in cells),
                                         "method": "blur_and_mean_occlusion_4x4",
                                         "meaning": "classification_response_not_pixel_truth"})
                # forensics（TruFor / 人脸 / 来源）复用已加载的引擎
                forensics = {"schemaVersion": 1}
                for key, holder in [("face", STATE["face"]), ("source", STATE["source"]), ("tamper", STATE["tamper"])]:
                    t0 = time.monotonic()
                    try:
                        out = holder["engine"].score(rgb)
                    except Exception:
                        out = {"status": "failed", "reason": "model_unavailable",
                               "summary": {"face": "本次人像分析未完成。", "source": "本次生成来源分析未完成。",
                                           "tamper": "本次局部篡改分析未完成。"}[key]}
                    out["seconds"] = round(time.monotonic() - t0, 3)
                    forensics[key] = out
                forensics["source"]["applicability"] = (
                    "whole_image_signal_present" if score is not None and score > .5 else "no_whole_image_signal")
                forensics["source"]["inputEncoding"] = diag.get("format")
                forensics["source"]["encodingSensitive"] = diag.get("format") in {"JPEG", "WEBP"}
                result["forensics"] = forensics
                from file_source import apply_source_evidence
                apply_source_evidence(result)
                result["seconds"] = time.monotonic() - start
            except Exception as e:
                result = {"id": row.get("id"), "status": "failed", "error": type(e).__name__,
                          "seconds": time.monotonic() - start}
            results.append(result)
    return results


# ---------------------------------------------------------------- HTTP 服务

def main():
    parser = argparse.ArgumentParser(description="全模型常驻推理服务（DDA-H+/SEED/TruFor/VLAForge/RPA/翻拍）")
    parser.add_argument("--gpu", default="0")
    parser.add_argument("--port", type=int, default=int(os.environ.get("AIGC_INFERENCE_PORT", "8617")))
    parser.add_argument("--models", default="mirror,seed,forensics,recapture",
                        help="逗号分隔：mirror,seed,forensics(=TruFor+人脸+来源),recapture")
    args = parser.parse_args()

    names = [n.strip() for n in args.models.split(",") if n.strip()]
    load_models(names, args.gpu)

    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    ROUTES = {"mirror": run_mirror, "seed": run_seed, "general": run_general, "recapture": run_recapture}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
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
                ready = {k: bool(STATE.get(k)) for k in ("mirror", "seed", "tamper", "face", "source", "recapture")}
                self._json(200, {"status": "ok", "models": ready, "device": STATE["device"],
                                 "uptimeSeconds": None if not STATE["loaded_at"] else int(time.time() - STATE["loaded_at"])})
            else:
                self._json(404, {"error": "not_found"})

        def do_POST(self):
            route = self.path.lstrip("/").split("?")[0]
            try:
                length = int(self.headers.get("Content-Length") or 0)
                manifest = json.loads(self.rfile.read(length))
                handler = ROUTES.get(route)
                if not handler:
                    return self._json(404, {"error": "not_found"})
                if route == "general" and not (STATE.get("mirror") and STATE.get("tamper")):
                    return self._json(503, {"error": "general_models_not_loaded"})
                needed = {"mirror": "mirror", "seed": "seed", "general": "mirror", "recapture": "recapture"}[route]
                if not STATE.get(needed):
                    return self._json(503, {"error": f"{needed}_model_not_loaded"})
                self._json(200, handler(manifest))
            except Exception as error:
                self._json(500, {"error": f"{type(error).__name__}: {error}"})

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"[inference] listening 127.0.0.1:{args.port} models={names}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

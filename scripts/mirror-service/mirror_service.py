"""Private, single-model MIRROR HTTP service. No application data is persisted."""
import argparse
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import time
import warnings

from PIL import Image, ImageFile, ImageOps, UnidentifiedImageError

COMMIT = "7f108fdd5c132e205df6f24954045cc9ba533361"
CHECKPOINT_SHA = "829ef07b52caa26c1cb3917e603a275cfd1c7f494f7b750f86fb218710ac66d5"
MAX_BYTES = 12 * 1024 * 1024
MAX_PIXELS = 40_000_000
Image.MAX_IMAGE_PIXELS = MAX_PIXELS
ImageFile.LOAD_TRUNCATED_IMAGES = False

class InputError(ValueError):
    pass

def digest_file(path):
    result = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for block in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()

def decode_image(data):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as image:
                kind = image.format
                if kind not in {"JPEG", "PNG", "WEBP"}:
                    raise InputError("Only JPEG, PNG and WebP are supported")
                if getattr(image, "n_frames", 1) != 1:
                    raise InputError("Animated/multi-frame images are not supported")
                if min(image.size) < 32 or image.width * image.height > MAX_PIXELS:
                    raise InputError("Image must be at least 32x32 and at most 40 million pixels")
                stored_size = list(image.size)
                orientation = image.getexif().get(274, 1)
                image.load()
                oriented = ImageOps.exif_transpose(image)
                if "A" in oriented.getbands():
                    background = Image.new("RGBA", oriented.size, "white")
                    background.alpha_composite(oriented.convert("RGBA"))
                    rgb = background.convert("RGB")
                else:
                    rgb = oriented.convert("RGB")
        return rgb, {"format": kind, "stored_size": stored_size, "oriented_size": list(rgb.size), "exif_orientation": orientation, "sha256": hashlib.sha256(data).hexdigest()}
    except InputError:
        raise
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError, Image.DecompressionBombWarning, UnidentifiedImageError) as error:
        raise InputError("Image is corrupt, unsupported, or exceeds the pixel limit") from error

class MirrorEngine:
    def __init__(self, config):
        self.config = config
        root = Path(config["source_dir"]).resolve()
        revision = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
        if revision != COMMIT or subprocess.check_output(["git", "-C", str(root), "status", "--porcelain"], text=True).strip():
            raise RuntimeError("MIRROR source revision or working tree does not match the verified source")
        if digest_file(config["checkpoint"]) != CHECKPOINT_SHA:
            raise RuntimeError("Checkpoint integrity verification failed")
        sys.dont_write_bytecode = True
        os.environ["CUDA_VISIBLE_DEVICES"] = config["gpu"]
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
        import numpy as np
        import random
        import torch
        sys.path.insert(0, str(root))
        from models.mirror import build_mirror, load_detector_checkpoint
        from data.datasets import Get_Transforms, compress_image
        ImageFile.LOAD_TRUNCATED_IMAGES = False
        random.seed(0); np.random.seed(0); torch.manual_seed(0)
        torch.set_num_threads(4)
        if not torch.cuda.is_available() or torch.cuda.mem_get_info(0)[0] < 10 * 1024**3:
            raise RuntimeError("Selected GPU is unavailable or has less than 10 GiB free")
        torch.cuda.set_per_process_memory_fraction(float(config.get("gpu_memory_fraction", 0.25)), 0)
        torch.backends.cudnn.benchmark = False
        torch.backends.cudnn.deterministic = True
        torch.use_deterministic_algorithms(True, warn_only=True)
        started = time.monotonic()
        self.model = build_mirror(memory_path=None, backbone_path=config["backbone"])
        with torch.serialization.safe_globals([argparse.Namespace]):
            checkpoint = torch.load(config["checkpoint"], map_location="cpu", weights_only=True, mmap=True)
        loaded = load_detector_checkpoint(self.model, checkpoint)
        self.model.to("cuda:0").eval()
        del checkpoint
        self.torch = torch
        _, self.preprocess = Get_Transforms(argparse.Namespace(), "preprocess")
        _, self.tensorize = Get_Transforms(argparse.Namespace(), "normal")
        self.compress_image = compress_image
        self.info = {
            "model": "MIRROR-DINOv3-H+", "source_commit": revision,
            "checkpoint_sha256": CHECKPOINT_SHA,
            "strict_load": {"missing_keys": loaded.missing_keys, "unexpected_keys": loaded.unexpected_keys},
            "precision": "float32_no_amp", "torch_version": torch.__version__,
            "gpu_name": torch.cuda.get_device_name(0),
            "preprocessing": "EXIF orientation; white alpha background; publisher short-side<=512 then center crop224; PNG to JPEG96; ToTensor",
            "full_image_pixel_coverage": False,
            "score_semantics": "uncalibrated_generated_class_softmax_not_forgery_probability",
            "localization_supported": False, "aftersales_validated": False,
            "load_seconds": round(time.monotonic()-started, 3),
        }

    def infer(self, image, metadata):
        torch = self.torch
        prepared = self.preprocess(image)
        if metadata["format"] == "PNG":
            prepared = self.compress_image(prepared, quality=96)
        tensor = self.tensorize(prepared).unsqueeze(0).to("cuda:0")
        torch.cuda.synchronize()
        started = time.monotonic()
        with torch.inference_mode():
            logits, _, _ = self.model(tensor)
        torch.cuda.synchronize()
        score = float(logits.float().softmax(dim=1)[0, 1])
        if not math.isfinite(score):
            raise RuntimeError("Non-finite model output")
        return {"status": "succeeded", "model": self.info["model"], "source_commit": COMMIT,
                "input": metadata, "generated_score": score,
                "predicted_class": "generated" if int(logits.argmax(dim=1)[0]) == 1 else "real",
                "score_semantics": self.info["score_semantics"],
                "scope": "publisher_preprocessed_center_view", "full_image_pixel_coverage": False,
                "localization_supported": False, "aftersales_validated": False,
                "inference_seconds": round(time.monotonic()-started, 4)}

class State:
    def __init__(self, engine, token):
        self.engine, self.token = engine, token
        self.inference_lock = threading.Lock()
        self.upload_slots = threading.BoundedSemaphore(4)

def make_handler(state):
    class Handler(BaseHTTPRequestHandler):
        server_version = "MirrorService/1.0"
        def setup(self):
            super().setup(); self.connection.settimeout(30)
        def log_message(self, fmt, *args):
            print(json.dumps({"event": "http", "message": fmt % args}), flush=True)
        def respond(self, status, body):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if status == 429:self.send_header("Retry-After", "1")
            self.end_headers(); self.wfile.write(data)
        def authorized(self):
            supplied = self.headers.get("Authorization", "")
            return hmac.compare_digest(supplied.encode(), ("Bearer " + state.token).encode())
        def do_GET(self):
            if self.path in ["/", "/health"]:
                return self.respond(200, {"status":"ok", "ready":True, "model":state.engine.info["model"], "inference_endpoint":"POST /v1/detect", "authentication":"Bearer token", "input":"Raw JPEG, PNG or WebP bytes, maximum 12 MiB", "localization_supported":False})
            if self.path == "/v1/model":
                return self.respond(200,state.engine.info) if self.authorized() else self.respond(401,{"error":"unauthorized"})
            self.respond(404,{"error":"not_found"})
        def do_POST(self):
            if self.path != "/v1/detect":return self.respond(404,{"error":"not_found"})
            if not self.authorized():return self.respond(401,{"error":"unauthorized"})
            if self.headers.get("Transfer-Encoding"):return self.respond(400,{"error":"content_length_required"})
            try:size=int(self.headers.get("Content-Length", "0"))
            except ValueError:return self.respond(400,{"error":"invalid_content_length"})
            if size<=0 or size>MAX_BYTES:return self.respond(413,{"error":"image_size_out_of_range"})
            if not state.upload_slots.acquire(blocking=False):return self.respond(429,{"error":"busy"})
            locked=False
            try:
                data=self.rfile.read(size)
                if len(data)!=size:return self.respond(400,{"error":"incomplete_body"})
                image, metadata=decode_image(data)
                locked=state.inference_lock.acquire(blocking=False)
                if not locked:return self.respond(429,{"error":"model_busy"})
                result=state.engine.infer(image,metadata)
                result["request_id"]=secrets.token_hex(12)
                return self.respond(200,result)
            except InputError as error:return self.respond(422,{"error":"invalid_image","message":str(error)})
            except (BrokenPipeError,ConnectionResetError,TimeoutError):return
            except Exception as error:
                print(json.dumps({"event":"inference_error","type":type(error).__name__}),flush=True)
                return self.respond(503,{"error":"inference_failed","message":"Model inference failed; retry later"})
            finally:
                if locked:state.inference_lock.release()
                state.upload_slots.release()
    return Handler

def main():
    parser=argparse.ArgumentParser(); parser.add_argument("--config",type=Path,required=True)
    args=parser.parse_args(); config=json.loads(args.config.read_text())
    if config.get("host","127.0.0.1")!="127.0.0.1":raise RuntimeError("This deployment only binds the loopback interface")
    token_path=Path(config["token_file"])
    if token_path.stat().st_mode & 0o077:raise RuntimeError("Token file must be private")
    token=token_path.read_text().strip()
    if len(token)<32:raise RuntimeError("Invalid service token")
    engine=MirrorEngine(config)
    server=ThreadingHTTPServer(("127.0.0.1",int(config.get("port",18081))),make_handler(State(engine,token)))
    print(json.dumps({"event":"ready","address":server.server_address,"model":engine.info},ensure_ascii=False),flush=True)
    server.serve_forever()

if __name__=="__main__":main()

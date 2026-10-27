"""Single-GPU MIRROR smoke run using the pinned publisher evaluation transform."""
import argparse
import importlib.metadata
import json
import os
from pathlib import Path
import random
import subprocess
import sys
import time

from smoke_ocr import sha256


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--code", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    parser.add_argument("--backbone", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--gpu", choices=("0", "1", "2", "3"), default="3")
    parser.add_argument("--purpose", choices=("internal_research_smoke", "stratified_baseline"), default="internal_research_smoke")
    args = parser.parse_args()
    revision = subprocess.check_output(["git", "-C", str(args.code), "rev-parse", "HEAD"], text=True).strip()
    if revision != "7f108fdd5c132e205df6f24954045cc9ba533361":
        raise ValueError("Unexpected MIRROR source revision")
    dirty = subprocess.check_output(["git", "-C", str(args.code), "status", "--porcelain"], text=True)
    if dirty:
        raise ValueError("MIRROR source has local modifications; review before testing")
    ledger = json.loads(args.ledger.read_text(encoding="utf-8"))
    if (Path(ledger["target"]).resolve() != args.checkpoint.resolve()
            or ledger["sha256"] != sha256(args.checkpoint)):
        raise ValueError("Checkpoint differs from download ledger")
    samples = json.loads(args.manifest.read_text(encoding="utf-8"))
    os.environ["CUDA_VISIBLE_DEVICES"] = args.gpu
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
    import numpy as np
    import torch
    from PIL import Image, ImageFile
    sys.path.insert(0, str(args.code.resolve()))
    from models.mirror import build_mirror, load_detector_checkpoint
    from data.datasets import Get_Transforms, compress_image

    # Publisher enables truncated-image decoding globally; a service must reject it.
    ImageFile.LOAD_TRUNCATED_IMAGES = False
    random.seed(0)
    np.random.seed(0)
    torch.manual_seed(0)
    torch.set_num_threads(4)
    torch.backends.cudnn.benchmark = False
    torch.backends.cudnn.deterministic = True
    torch.use_deterministic_algorithms(True, warn_only=True)
    if not torch.cuda.is_available() or torch.cuda.mem_get_info(0)[0] < 10 * 1024 ** 3:
        raise RuntimeError("Selected single GPU unavailable or has less than 10 GiB free")
    started = time.perf_counter()
    model = build_mirror(memory_path=None, backbone_path=str(args.backbone))
    with torch.serialization.safe_globals([argparse.Namespace]):
        checkpoint = torch.load(args.checkpoint, map_location="cpu", weights_only=True, mmap=True)
    loaded = load_detector_checkpoint(model, checkpoint)
    model.to("cuda:0").eval()
    _, preprocess = Get_Transforms(argparse.Namespace(), "preprocess")
    _, tensorize = Get_Transforms(argparse.Namespace(), "normal")
    report = {
        "purpose": args.purpose, "business_validated": False,
        "provider": "MIRROR", "source_commit": revision,
        "checkpoint_sha256": ledger["sha256"], "physical_gpu": args.gpu,
        "versions": {p: importlib.metadata.version(p) for p in
                     ("torch", "torchvision", "transformers", "peft", "timm")},
        "strict_load": {"missing_keys": loaded.missing_keys, "unexpected_keys": loaded.unexpected_keys},
        "load_seconds": time.perf_counter() - started,
        "class_mapping": {"0": "real", "1": "generated"},
        "score_semantics": "uncalibrated_generated_class_softmax_not_forgery_probability",
        "preprocess": "publisher_eval: downscale_short_side_if_gt512, center_crop224, PNG/BMP/TIFF_JPEG96, ToTensor; ImageNet_norm_inside_model",
        "decoding_deviation": "reject_truncated_images",
        "precision": "float32_no_amp", "manifest_sha256": sha256(args.manifest),
        "samples": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    unexpected_failures = 0
    for row in samples:
        sample = dict(row, status="failed")
        path = Path(row["path"])
        started = time.perf_counter()
        torch.cuda.reset_peak_memory_stats()
        try:
            sample["input_sha256"] = sha256(path)
            if row.get("expected_sha256") and row["expected_sha256"] != sample["input_sha256"]:
                raise ValueError("Input changed after evaluation manifest was frozen")
            with Image.open(path) as image:
                image.load()
                sample["stored_size"] = list(image.size)
                sample["exif_orientation"] = image.getexif().get(274, 1)
                image = preprocess(image.convert("RGB"))
            if path.suffix.lower() in (".png", ".bmp", ".tiff"):
                image = compress_image(image, quality=96)
            tensor = tensorize(image).unsqueeze(0).to("cuda:0")
            torch.cuda.synchronize()
            inference_started = time.perf_counter()
            with torch.inference_mode():
                logits, _, _ = model(tensor)
            torch.cuda.synchronize()
            score = float(logits.float().softmax(dim=1)[0, 1])
            if not np.isfinite(score):
                raise ValueError("Nonfinite detector output")
            sample.update(status="succeeded", generated_score=score,
                          predicted_class=int(logits.argmax(dim=1)[0]),
                          inference_seconds=time.perf_counter() - inference_started)
            if row.get("expected_error"):
                unexpected_failures += 1
        except Exception as error:
            if not row.get("expected_error"):
                unexpected_failures += 1
            sample.update(error_type=type(error).__name__, error=str(error)[:500])
            torch.cuda.empty_cache()
        sample["seconds"] = time.perf_counter() - started
        sample["peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
        report["samples"].append(sample)
        temp = args.output.with_suffix(".tmp")
        temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(args.output)
        print(json.dumps({"sample_id": row["sample_id"], "status": sample["status"],
                          "seconds": round(sample["seconds"], 3),
                          "score": sample.get("generated_score")}), flush=True)
    return 1 if unexpected_failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

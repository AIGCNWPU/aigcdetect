"""Offline OCR validation; results are research artifacts, not platform reports."""
import argparse
import hashlib
import importlib.metadata
import json
import os
import time
from pathlib import Path


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--image", type=Path, action="append")
    inputs.add_argument("--image-manifest", type=Path)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    # Models must already be local; no optional orientation/dewarp downloads.
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    from PIL import Image, ImageOps
    import numpy as np
    from paddleocr import PaddleOCR
    from paddlex.utils import deps

    if not deps.is_dep_available("opencv-contrib-python"):
        raise RuntimeError("Run prepare_headless_paddlex.py in the isolated OCR environment")

    versions = {p: importlib.metadata.version(p)
                for p in ("paddleocr", "paddlepaddle", "paddlex",
                          "opencv-contrib-python-headless")}
    det = args.weights / "PP-OCRv6_medium_det"
    rec = args.weights / "PP-OCRv6_medium_rec"
    for directory in (det, rec):
        if not (directory / "inference.pdiparams").is_file():
            raise FileNotFoundError(f"Missing local model: {directory}")
    assets = {directory.name: {p.name: sha256(p) for p in sorted(directory.iterdir())
                              if p.is_file() and p.suffix in (".json", ".yml", ".pdiparams")}
              for directory in (det, rec)}
    started = time.perf_counter()
    pipeline = PaddleOCR(
        text_detection_model_name=det.name, text_detection_model_dir=str(det),
        text_recognition_model_name=rec.name, text_recognition_model_dir=str(rec),
        use_doc_orientation_classify=False, use_doc_unwarping=False,
        use_textline_orientation=False, text_rec_score_thresh=0.0,
        device="cpu", cpu_threads=4, enable_mkldnn=False,
    )
    report = {"purpose": "internal_research_smoke", "versions": versions,
              "provider": "PP-OCRv6_medium", "device": "cpu",
              "model_asset_sha256": assets,
              "load_seconds": time.perf_counter() - started,
              "score_semantics": "text_recognition_confidence_not_forgery_risk",
              "business_validated": False, "samples": []}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    rows = json.loads(args.image_manifest.read_text()) if args.image_manifest else [{"path":str(p)} for p in args.image]
    if args.image_manifest:
        report.update(purpose="frozen_dataset_evaluation", manifest_sha256=sha256(args.image_manifest))
    failures = 0
    for row in rows:
        path = Path(row["path"])
        sample = {"input_path": str(path.resolve()), "status": "failed"}
        sample.update({k:v for k,v in row.items() if k != "path"})
        started = time.perf_counter()
        try:
            sample["input_sha256"] = sha256(path)
            if row.get("expected_sha256", sample["input_sha256"]) != sample["input_sha256"]:
                raise ValueError("Frozen input hash mismatch")
            with Image.open(path) as source:
                sample["stored_size"] = list(source.size)
                sample["exif_orientation"] = source.getexif().get(274, 1)
                oriented = ImageOps.exif_transpose(source).convert("RGB")
                sample["oriented_size"] = list(oriented.size)
                # PaddleX ndarray input follows OpenCV BGR convention.
                pixels = np.asarray(oriented)[:, :, ::-1].copy()
            predictions = list(pipeline.predict(pixels))
            if len(predictions) != 1:
                raise ValueError("Expected one page result")
            prediction = predictions[0]
            texts, scores, polys = (prediction[key] for key in
                                   ("rec_texts", "rec_scores", "rec_polys"))
            if not len(texts) == len(scores) == len(polys):
                raise ValueError("Mismatched OCR evidence arrays")
            regions = []
            for index, (text, score, polygon) in enumerate(zip(texts, scores, polys)):
                polygon = np.asarray(polygon, dtype=float)
                if polygon.shape != (4, 2) or not np.isfinite(polygon).all():
                    raise ValueError("Invalid OCR polygon")
                width, height = sample["oriented_size"]
                if (polygon < 0).any() or (polygon[:, 0] > width).any() or (polygon[:, 1] > height).any():
                    raise ValueError("OCR polygon is outside the oriented image")
                if not np.isfinite(score) or not 0 <= float(score) <= 1:
                    raise ValueError("Invalid OCR confidence")
                regions.append({
                    "region_id": f"ocr-{index}", "observed_text": text,
                    "recognition_confidence": float(score), "polygon": polygon.tolist(),
                    "coordinate_space": "exif_oriented_image_pixels",
                    "source": {"provider": "PP-OCRv6_medium", "page": 1,
                               "input_sha256": sample["input_sha256"]},
                })
            sample.update(status="succeeded", regions=regions)
        except Exception as error:
            failures += 1
            sample["error_type"] = type(error).__name__
            sample["error"] = str(error)[:500]
        sample["seconds"] = time.perf_counter() - started
        report["samples"].append(sample)
        temp = args.output.with_suffix(".tmp")
        temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(args.output)
        print(json.dumps({"sample": len(report["samples"]), "status": sample["status"],
                          "regions": len(sample.get("regions", [])),
                          "seconds": round(sample["seconds"], 3)}), flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

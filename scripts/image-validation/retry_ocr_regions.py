"""Re-read selected receipt text crops; preserve competing observations.

This is a research diagnostic. It never replaces the first OCR value or treats
agreement between runs of the same model as independent verification.
"""
import argparse
import json
import math
import os
import time
from pathlib import Path

from receipt_evidence import bounds, digest, validate_ocr
from smoke_ocr import sha256


def map_polygon(polygon, origin, scale):
    if scale <= 0 or not math.isfinite(scale):
        raise ValueError("Invalid crop scale")
    return [[float(x) / scale + origin[0], float(y) / scale + origin[1]] for x, y in polygon]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ocr-report", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--region-id", action="append", required=True)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source = json.loads(args.ocr_report.read_text(encoding="utf-8"))
    image_sha = sha256(args.image)
    matches = [s for s in source["samples"] if s.get("input_sha256") == image_sha]
    if len(matches) != 1:
        raise ValueError("Missing or ambiguous source OCR")
    sample = matches[0]
    regions = validate_ocr(sample)
    if any(key not in regions for key in args.region_id):
        raise ValueError("Unknown selected region")
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    import numpy as np
    from PIL import Image, ImageOps
    from paddleocr import PaddleOCR

    with Image.open(args.image) as original:
        oriented = ImageOps.exif_transpose(original).convert("RGB")
    if list(oriented.size) != sample["oriented_size"]:
        raise ValueError("Image dimensions changed")
    det, rec = (args.weights / name for name in ("PP-OCRv6_medium_det", "PP-OCRv6_medium_rec"))
    assets = {d.name: {p.name: sha256(p) for p in sorted(d.iterdir())
                      if p.is_file() and p.suffix in (".json", ".yml", ".pdiparams")}
              for d in (det, rec)}
    if assets != source.get("model_asset_sha256"):
        raise ValueError("OCR model assets differ from the original run")
    pipeline = PaddleOCR(text_detection_model_name=det.name, text_detection_model_dir=str(det),
                        text_recognition_model_name=rec.name, text_recognition_model_dir=str(rec),
                        use_doc_orientation_classify=False, use_doc_unwarping=False,
                        use_textline_orientation=False, text_rec_score_thresh=0.0,
                        device="cpu", cpu_threads=4, enable_mkldnn=False)
    result = {"purpose": "internal_research_crop_reread", "input_sha256": image_sha,
              "ocr_evidence_sha256": digest(sample), "original_ocr_report_sha256": sha256(args.ocr_report),
              "model_asset_sha256": assets, "same_model_not_independent_evidence": True,
              "automatic_correction": False, "regions": []}
    for key in dict.fromkeys(args.region_id):
        started = time.perf_counter()
        original_region = regions[key]
        x1, y1, x2, y2 = bounds(original_region)
        pad = math.ceil((y2 - y1) * 0.4)
        crop_box = [max(0, math.floor(x1) - pad), max(0, math.floor(y1) - pad),
                    min(oriented.width, math.ceil(x2) + pad), min(oriented.height, math.ceil(y2) + pad)]
        crop = oriented.crop(crop_box)
        scale = 2
        if crop.width * crop.height * scale ** 2 > 4_000_000:
            raise ValueError("Crop exceeds research resource limit")
        enlarged = crop.resize((crop.width * scale, crop.height * scale), Image.Resampling.LANCZOS)
        prediction = list(pipeline.predict(np.asarray(enlarged)[:, :, ::-1].copy()))
        if len(prediction) != 1:
            raise ValueError("Expected one crop prediction")
        texts, scores, polys = (prediction[0][k] for k in ("rec_texts", "rec_scores", "rec_polys"))
        if not len(texts) == len(scores) == len(polys):
            raise ValueError("Mismatched OCR arrays")
        candidates = []
        for i, (text, score, poly) in enumerate(zip(texts, scores, polys)):
            mapped = map_polygon(poly, crop_box[:2], scale)
            candidate = {"region_id": f"retry-{key}-{i}", "observed_text": text,
                         "recognition_confidence": float(score), "polygon": mapped,
                         "coordinate_space": "exif_oriented_image_pixels",
                         "source": {"input_sha256": image_sha, "page": 1, "provider": "PP-OCRv6_medium_crop"}}
            validate_ocr(dict(sample, regions=[candidate]))
            candidates.append(candidate)
        result["regions"].append({"original": original_region, "crop_box": crop_box,
                                  "scale": scale, "resize": "LANCZOS",
                                  "candidates": candidates, "decision": "review_required",
                                  "seconds": time.perf_counter() - started})
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"regions": len(result["regions"]), "output": str(args.output)}))


if __name__ == "__main__":
    main()

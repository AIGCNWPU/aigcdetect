#!/usr/bin/env python3
"""Persistent JSONL bridge for the trusted EGTE C-ReD/RAID bundle."""

from __future__ import annotations

import contextlib
import json
import os
from pathlib import Path
import sys
import traceback


ROOT = Path(os.environ.get(
    "EGTE_ROOT",
    "/mnt/vos-6d37s2q0/users/yh/models/EGTE_CRED_RAID_20261023",
)).resolve()
GPU = os.environ.get("EGTE_GPU", "auto")
PREDICTORS = {}


def load_predictor(classifier: str):
    if classifier not in {"cred", "raid"}:
        raise ValueError("unsupported classifier")
    if classifier in PREDICTORS:
        return PREDICTORS[classifier]
    if not (ROOT / "predict.py").is_file():
        raise RuntimeError("predict.py not found in EGTE_ROOT")
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    with contextlib.redirect_stdout(sys.stderr):
        from predict import EGTEPredictor  # pylint: disable=import-outside-toplevel
        predictor = EGTEPredictor(ROOT / "models" / classifier / "model.joblib", gpu=GPU)
    PREDICTORS[classifier] = predictor
    return predictor


def first_value(result: dict, *keys):
    for key in keys:
        if key in result and result[key] is not None:
            return result[key]
    return None


def score_segment(predictor, segment: dict) -> dict:
    segment_id = str(segment.get("segmentId", ""))
    text = str(segment.get("text", "")).strip()
    if len(text) < 20:
        return {
            "segmentId": segment_id,
            "status": "too-short",
            "reason": "去除首尾空白后少于20个字符，无法可靠评分。",
            "documentTokens": None,
            "aiScore": None,
            "predictedLabel": None,
        }
    try:
        with contextlib.redirect_stdout(sys.stderr):
            result = predictor.predict(text)
        score = first_value(result, "ai_score", "aiScore", "score")
        label = first_value(result, "predicted_label", "predictedLabel", "label")
        if label is None:
            label_zh = str(first_value(result, "label_zh", "labelZh") or "")
            if "AI" in label_zh.upper():
                label = 1
            elif "人工" in label_zh or "HUMAN" in label_zh.upper():
                label = 0
        tokens = first_value(result, "document_tokens", "documentTokens", "token_count")
        return {
            "segmentId": segment_id,
            "status": "success",
            "reason": "",
            "documentTokens": int(tokens) if tokens is not None else None,
            "aiScore": float(score),
            "predictedLabel": int(label),
        }
    except ValueError as error:
        return {
            "segmentId": segment_id,
            "status": "unscored",
            "reason": str(error)[:240] or "文本不满足算法最低输入条件。",
            "documentTokens": None,
            "aiScore": None,
            "predictedLabel": None,
        }
    except Exception:  # one bad sentence must not discard the other results
        traceback.print_exc(file=sys.stderr)
        return {
            "segmentId": segment_id,
            "status": "failed",
            "reason": "该句检测失败。",
            "documentTokens": None,
            "aiScore": None,
            "predictedLabel": None,
        }


def handle(request: dict) -> dict:
    request_id = str(request.get("id", ""))
    classifier = str(request.get("classifier", "cred"))
    segments = request.get("segments")
    if not isinstance(segments, list):
        raise ValueError("segments must be an array")
    predictor = load_predictor(classifier)
    return {
        "id": request_id,
        "ok": True,
        "results": [score_segment(predictor, segment) for segment in segments],
    }


for raw_line in sys.stdin:
    try:
        request = json.loads(raw_line)
        response = handle(request)
    except Exception as error:  # startup/config errors are request-level failures
        traceback.print_exc(file=sys.stderr)
        response = {
            "id": str(locals().get("request", {}).get("id", "")),
            "ok": False,
            "message": str(error)[:240] or "EGTE worker failed",
        }
    sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
    sys.stdout.flush()

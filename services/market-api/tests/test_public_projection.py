# -*- coding: utf-8 -*-
"""对外投影（public.project_public）单测：内部字段必须被剥离，公开字段必须保留。

运行：
    cd services/market-api && python3 -m pytest tests/test_public_projection.py -q
或（无 pytest 时）：
    python3 tests/test_public_projection.py
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from public import project_public, reset_audit, audited_drops  # noqa: E402


def _keys(value, out=None):
    out = [] if out is None else out
    if isinstance(value, dict):
        for key, item in value.items():
            out.append(key)
            _keys(item, out)
    elif isinstance(value, list):
        for item in value:
            _keys(item, out)
    return out


def test_strips_engine_and_thresholds():
    sample = {
        "code": 200,
        "data": {
            "detectionResult": "suspected_ai_generated",
            "aiScore": {"score": 88, "semantics": "uncalibrated_model_signal"},
            "tamper": {"detectionResult": "suspicious", "threshold": 0.2, "tamperedLocation": [{"left": 1}]},
            "engine": {"wholeImage": "DDA-H+", "tamper": "TruFor"},
            "model": {"name": "DDA-H+", "weightsSha256": "deadbeef"},
        },
    }
    reset_audit()
    cleaned = project_public(sample)
    keys = _keys(cleaned)
    for forbidden in ("engine", "model", "threshold", "thresholds", "weightsSha256", "modelVersion", "engineVersion"):
        assert forbidden not in keys, f"{forbidden} 未被剥离"
    assert cleaned["data"]["tamper"]["tamperedLocation"] == [{"left": 1}]
    assert cleaned["data"]["aiScore"]["semantics"] == "uncalibrated_model_signal"
    assert "data.engine" in audited_drops()


def test_keeps_public_evidence_fields():
    sample = {
        "data": {
            "providerChecks": [{"provider": "doubao", "status": "evidence_found", "declarations": []}],
            "image": {"format": "PNG", "sha256": "a" * 64},
            "calibration": "uncalibrated",
            "dataSource": "engine",
        }
    }
    cleaned = project_public(sample)
    assert cleaned["data"]["providerChecks"][0]["provider"] == "doubao"
    assert cleaned["data"]["image"]["sha256"] == "a" * 64
    assert cleaned["data"]["calibration"] == "uncalibrated"
    assert cleaned["data"]["dataSource"] == "engine"


def test_nested_lists_and_none():
    sample = {"data": {"issues": [{"title": "x", "engine": {"k": 1}, "evidence": [{"model": "SEED"}]}]}}
    cleaned = project_public(sample)
    assert "engine" not in _keys(cleaned)
    assert "model" not in _keys(cleaned)
    assert project_public(None) is None


def test_does_not_mutate_input():
    sample = {"data": {"engine": {"wholeImage": "DDA-H+"}, "threshold": 0.5}}
    project_public(sample)
    assert sample["data"]["engine"]["wholeImage"] == "DDA-H+"
    assert sample["data"]["threshold"] == 0.5


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print("ok", name)
    print("all projection tests passed")

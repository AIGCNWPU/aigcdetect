#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""映射层单测：用平台保存的真实检测结果验证市场 schema 的正确性与稳定性。"""

import base64
import io
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from mappers import GENERAL_FEATURES, map_documents_result, map_general_result  # noqa: E402

REVIEWS = Path("/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews")
GENERAL_SAMPLE = "6b36310d-4c17-4f01-a7ac-999fc16fc9fe"       # AI 声明 + 5 人脸 + 来源候选
TAMPER_SAMPLE = "2b15adc7-7224-4a14-96fb-59a72f60498d"        # 局部篡改 suspicious
CLEAN_SAMPLE = "111df18a-f821-452a-82d0-87926a24e0fe"         # 未见明显生成线索
DOCUMENTS_SAMPLE = "5dc6b477-d3f3-47b8-a7b8-6c99ad06280d"     # 双材料发票 15 项问题


def general_result(uuid):
    rows = json.loads((REVIEWS / "general" / uuid / "result.json").read_text(encoding="utf-8"))
    return rows[0]


def documents_result(uuid):
    return json.loads((REVIEWS / uuid / "result.json").read_text(encoding="utf-8"))


def test_general_tamper_score_and_verdict():
    data = map_general_result(general_result(TAMPER_SAMPLE))
    tamper = data["tamper"]
    assert tamper["tamperScore"] == round(tamper["score"] * 100)
    assert tamper["tamperScore"] >= 60 and tamper["tamperVerdict"] == "tampered"  # suspicious 样本应过参考线
    assert tamper["tamperScoreSemantics"] == "uncalibrated_0_100_reference_line_60"
    clean = map_general_result(general_result(CLEAN_SAMPLE))["tamper"]
    assert clean["tamperVerdict"] in ("no_obvious_tamper", "tampered", None)


def test_general_full_shape_and_semantics():
    data = map_general_result(general_result(GENERAL_SAMPLE))
    assert data["detectionResult"] == "ai_generated_declared"
    assert data["aiScore"]["semantics"] == "uncalibrated_model_signal"
    assert 0 <= data["aiScore"]["score"] <= 100
    assert data["tamper"]["detectionResult"] == "no_obvious_signal"
    assert data["tamper"]["heatmap"] and base64.b64decode(data["tamper"]["heatmap"])[:4] == b"\x89PNG"
    assert data["faceForgery"]["status"] == "completed"
    assert data["faceForgery"]["analyzedFaceCount"] == 5
    assert len(data["faceForgery"]["faces"]) == 5
    face = data["faceForgery"]["faces"][0]
    assert set(face["box"]) == {"top", "left", "width", "height"}
    assert data["sourceCandidates"]["closedSet"] is True
    assert data["sourceCandidates"]["candidates"]
    assert data["provenance"]["aiDeclarationsFound"] is True
    assert data["provenance"]["providerChecks"]
    assert data["image"]["sha256"] and data["image"]["width"] > 0
    assert "TruFor" in data["engine"]["tamper"]


def test_general_tamper_locations_are_pixel_boxes():
    source = general_result(TAMPER_SAMPLE)
    data = map_general_result(source, restrict_probability=0.5, max_locations=5)
    assert data["detectionResult"] == "suspected_ai_generated"
    assert data["tamper"]["detectionResult"] == "suspicious"
    width, height = data["image"]["width"], data["image"]["height"]
    assert data["tamper"]["tamperedLocation"], "suspicious 结果应能提取出区域框"
    for box in data["tamper"]["tamperedLocation"]:
        assert 0 <= box["left"] and box["left"] + box["width"] <= width + 2
        assert 0 <= box["top"] and box["top"] + box["height"] <= height + 2
        assert box["width"] > 0 and box["height"] > 0
        assert box["probability"] >= 0.5
    assert len(data["tamper"]["tamperedLocation"]) <= 5
    # 提高阈值：返回的每个框置信度都必须达到该阈值（数量不保证单调，均匀高置信图会被拆分）
    higher = map_general_result(source, restrict_probability=0.9)["tamper"]["tamperedLocation"]
    for box in higher:
        assert box["probability"] >= 0.9


def test_general_clean_verdict_and_feature_filter():
    data = map_general_result(general_result(CLEAN_SAMPLE), features=["base", "tamper"])
    assert data["detectionResult"] == "no_obvious_ai_evidence"
    assert "faceForgery" not in data and "sourceCandidates" not in data and "provenance" not in data
    assert "tamper" in data and "image" in data


def test_general_features_unknown_rejected_by_api_layer_constant():
    assert set(GENERAL_FEATURES) == {"base", "tamper", "face", "source", "provenance"}


def test_documents_full_shape_and_status_translation():
    payload = documents_result(DOCUMENTS_SAMPLE)
    data = map_documents_result(payload)
    assert data["objective"] == "invoice_review"
    assert data["conclusion"]["result"] == "issues_found"
    assert data["conclusion"]["issueCount"] == 15
    stats = data["conclusion"]["checkStats"]
    assert stats["fail"] == 7 and stats["pass"] == 10 and stats["nei"] == 1
    issue = data["issues"][0]
    assert issue["title"] and issue["materials"]
    evidence = issue["evidence"][0]
    assert evidence["observedText"] and evidence["value"]
    assert set(evidence["box"]) == {"top", "left", "width", "height"}
    material = data["materials"][0]
    assert material["role"] == "core" and data["materials"][1]["role"] == "auxiliary"
    assert material["fields"] and material["fields"][0]["key"]
    statuses = {check["status"] for check in material["checks"]}
    assert statuses <= {"pass", "fail", "nei", "not_applicable", "error", "warn"}
    assert all(stage["status"] in {"completed", "failed", "not_run", "partial"} for stage in material["stages"].values())
    assert data["crossChecks"], "双材料样本应含跨材料比对"
    assert data["limitations"]
    # 2026-11-15 增强：mode/tamperScore/逐框置信度（mask_score_mean）/quality
    assert data["mode"] in ("single", "batch")
    material0 = data["materials"][0]
    assert isinstance(material0["tamperScore"], (int, type(None)))
    seed_stage = (documents_result(DOCUMENTS_SAMPLE)["materials"][0]["stages"] or {}).get("seed") or {}
    if seed_stage.get("status") == "completed" and seed_stage.get("score") is not None:
        assert material0["tamperScore"] == round(seed_stage["score"] * 100)
        assert 0 <= material0["tamperScore"] <= 100
    assert material0["quality"] is None or "attributes" in material0["quality"]

    dumped = json.dumps(data, ensure_ascii=False)
    for raw in ('"FAIL"', '"PASS"', '"NEI"', "invoice_net_tax_gross"):
        assert raw not in dumped, f"内部状态/规则码泄漏：{raw}"


def test_documents_preview_toggle():
    payload = documents_result(DOCUMENTS_SAMPLE)
    assert "preview" not in map_documents_result(payload, include_preview=False)["materials"][0]["pages"][0]
    with_preview = map_documents_result(payload, include_preview=True)["materials"][0]["pages"][0]
    assert with_preview.get("preview")
    head = base64.b64decode(with_preview["preview"])[:4]
    assert head in (b"\x89PNG", b"\xff\xd8\xff\xe0"), f"预览应为 PNG/JPEG：{head!r}"


def test_documents_ai_review_mapping():
    """智能复核输出：completed/partial 时给出结论、依据与证据（指针解析）；not_run 时显式原因。"""
    import copy

    payload = copy.deepcopy(documents_result(DOCUMENTS_SAMPLE))
    material = payload["materials"][0]
    material_id, field_id = material["id"], material["fields"][0]["id"]
    payload["presentation"]["aiReview"] = {
        "status": "completed", "summary": "已完成 2 项复核，其中 1 项发现内容问题。",
        "privacyMode": "redacted", "reason": None, "losses": [],
        "findings": [
            {"verdict": "issues_found", "explanation": "发票金额与合同金额不一致。", "warning": "请核对两份材料金额。",
             "recommendation": "补充说明或更正材料。", "assessmentId": "sa-1",
             "evidence": [{"materialId": material_id, "fieldId": field_id}]},
            {"verdict": "reasonable", "explanation": "日期关系在已提供证据内一致。", "warning": "",
             "recommendation": "无需处理。", "assessmentId": "sa-2", "evidence": []},
        ],
    }
    payload["semanticReview"] = {"status": "completed", "engine": "direct", "model": "deepseek-flash"}
    data = map_documents_result(payload)
    ai = data["aiReview"]
    assert ai["status"] == "completed" and ai["privacyMode"] == "redacted"
    assert ai["summary"] and "不构成新增鉴伪证据" in ai["disclaimer"]
    issue = ai["findings"][0]
    assert issue["verdict"] == "issues_found" and issue["warning"]
    assert issue["materials"] == [material["name"]]
    resolved = issue["evidence"][0]
    assert resolved["field"] == material["fields"][0]["key"]
    assert resolved["value"] == material["fields"][0]["value"]
    assert resolved["observedText"] == material["fields"][0]["source"]["observedText"]
    assert data["engine"]["semanticReviewEngine"] == "direct"

    not_run = map_documents_result(documents_result(DOCUMENTS_SAMPLE))["aiReview"]
    assert not_run["status"] == "not_run" and not_run["findings"] == []


def test_documents_ai_review_real_sample():
    """2026-11-12 真机（DeepSeek direct）智能复核样本回归：findings 完整且证据指针可解析。"""
    path = REVIEWS / "8b96e165-3120-40a8-b7a4-2f3fba88759a" / "result.json"
    if not path.exists():
        pytest.skip("真机智能复核样本不存在")
    data = map_documents_result(json.loads(path.read_text(encoding="utf-8")))
    ai = data["aiReview"]
    assert ai["status"] == "completed" and ai["privacyMode"] == "redacted"
    assert ai["summary"]
    assert len(ai["findings"]) >= 3
    for finding in ai["findings"]:
        assert finding["verdict"] in ("reasonable", "issues_found", "needs_more_information")
        assert finding["explanation"]
        if finding["verdict"] == "issues_found":
            assert finding["warning"]
    resolved = ai["findings"][0]["evidence"]
    assert resolved and all(entry["value"] is not None for entry in resolved[:2])
    assert data["engine"]["semanticReviewEngine"] == "direct"


def test_documents_ai_review_real_sample_original_mode():
    """2026-11-12 真机原文模式（privacyMode=original）样本回归：证据实值解析与脱敏模式同构。"""
    path = REVIEWS / "6001b1e7-9bd5-493c-a2e6-1f3dad44c025" / "result.json"
    if not path.exists():
        pytest.skip("真机原文模式智能复核样本不存在")
    data = map_documents_result(json.loads(path.read_text(encoding="utf-8")))
    ai = data["aiReview"]
    assert ai["status"] == "completed" and ai["privacyMode"] == "original"
    assert len(ai["findings"]) >= 3
    values = {entry["value"] for finding in ai["findings"] for entry in finding["evidence"]}
    assert "1999.99" in values and "2024330000123" in values, "原文模式证据应含实值"
    assert all(finding.get("recommendation") is not None for finding in ai["findings"])

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""平台检测结果 → 市场 API schema 映射（纯函数，2.1 与 2.3）。

upstream（真实引擎）与 fixture（离线回放）共用同一映射，保证对外字段恒定：
- 坐标一律原图像素（top/left/width/height）；
- 分数附 semantics 校准说明；
- 未执行 / 失败 / 缺失显式给出，不伪装成通过；
- 不暴露内部规则码与完整权重指纹（截断 16 位）。
"""

import base64
import re

from boxes import locations_from_map

DATA_URL = re.compile(r"^data:image/([a-z]+);base64,(.+)$", re.S)

GENERAL_FEATURES = ("base", "tamper", "face", "source", "provenance")
OBJECTIVES = ("invoice_review", "procurement_review", "merchant_reconciliation",
              "research_reimbursement", "identity_consistency")
OBJECTIVE_ALIASES = {
    "payment_review": "merchant_reconciliation",
    "reimbursement_review": "research_reimbursement",
    "identity_review": "identity_consistency",
}


def _strip_data_url(value):
    if not isinstance(value, str):
        return None
    match = DATA_URL.match(value.strip())
    return match.group(2) if match else (value if re.fullmatch(r"[A-Za-z0-9+/=]+", value.strip()) else None)


def _format_b64(value):
    raw = _strip_data_url(value)
    return base64.b64encode(base64.b64decode(raw)).decode("ascii") if raw else None


def _score100(value):
    try:
        return round(float(value) * 100, 2)
    except (TypeError, ValueError):
        return None


def _tamper_score(value):
    """0-100 篡改总分（未校准）；None 表示未得出。"""
    try:
        return round(min(max(float(value), 0.0), 1.0) * 100)
    except (TypeError, ValueError):
        return None


def _round6(value):
    try:
        return round(float(value), 6)
    except (TypeError, ValueError):
        return None


def _has_ai_declaration(result):
    records = (result.get("diagnostics") or {}).get("sourceDeclarations") or {}
    return any(str((record or {}).get("fields", {}).get("Label")) == "1" for record in records.get("records") or [])


# ---------------------------------------------------------------- 2.1 通用图片

def map_general_result(result, *, features=None, restrict_probability=0.5, max_locations=8):
    """平台 2.1 检测项（result 字段集）→ 市场 data。features 为空表示全部返回。"""
    result = result or {}
    diagnostics = result.get("diagnostics") or {}
    forensics = result.get("forensics") or {}
    keep = set(features or GENERAL_FEATURES)
    keep = keep & set(GENERAL_FEATURES) or set(GENERAL_FEATURES)

    declared = _has_ai_declaration(result)
    if declared:
        detection = "ai_generated_declared"
    elif result.get("verdict") == "likely_ai":
        detection = "suspected_ai_generated"
    elif result.get("verdict") == "no_obvious_ai":
        detection = "no_obvious_ai_evidence"
    else:
        detection = "inconclusive"

    data = {
        "detectionResult": detection,
        "aiScore": {
            "score": _score100(result.get("score")),
            "semantics": "uncalibrated_model_signal",
            "coverage": result.get("coverage") or "整图",
            "decisionBasis": "file_declaration" if declared else (result.get("decisionBasis") or "model_signal"),
        },
        "summary": result.get("summary") or "",
    }

    if "tamper" in keep:
        tamper = forensics.get("tamper") or {}
        image_size = diagnostics.get("dimensions") or tamper.get("imageSize")
        locations = []
        if tamper.get("status") == "completed":
            locations = locations_from_map(
                tamper.get("confidenceMap") or tamper.get("anomalyMap") or tamper.get("overlay"),
                image_size, restrict_probability, max_locations,
            )
        tamper_score = _tamper_score(tamper.get("score"))
        data["tamper"] = {
            "status": tamper.get("status") or "not_run",
            "tamperScore": tamper_score,
            "tamperVerdict": (None if tamper_score is None else
                              ("tampered" if tamper_score >= 60 else "no_obvious_tamper")),
            "tamperScoreSemantics": "uncalibrated_0_100_reference_line_60",
            "detectionResult": {
                "suspicious": "suspicious", "no_obvious_signal": "no_obvious_signal",
            }.get(tamper.get("signal"), "inconclusive" if tamper.get("status") == "completed" else "not_run"),
            "score": _round6(tamper.get("score")),
            "threshold": _round6(tamper.get("threshold")),
            "scoreSemantics": "uncalibrated",
            "heatmap": _format_b64(tamper.get("anomalyMap") or tamper.get("overlay")),
            "heatmapFormat": "png",
            "meanConfidence": _round6(tamper.get("meanConfidence")),
            "tamperedLocation": locations,
            "locationCoordinates": tamper.get("coordinates") or "original_image_pixels",
        }

    if "face" in keep:
        face = forensics.get("face") or {}
        faces = []
        for index, entry in enumerate(face.get("faces") or [], start=1):
            box = entry.get("box") or [None, None, None, None]
            faces.append({
                "index": index,
                "detectionResult": "suspicious" if entry.get("signal") == "suspicious" else "normal",
                "score": _round6(entry.get("score")),
                "threshold": _round6(face.get("threshold")),
                "box": {"top": box[1], "left": box[0], "width": box[2], "height": box[3]},
            })
        data["faceForgery"] = {
            "status": face.get("status") or "not_run",
            "analyzedFaceCount": face.get("analyzedFaceCount", 0 if face.get("status") != "completed" else len(faces)),
            "detectionResult": ("suspicious" if any(f["detectionResult"] == "suspicious" for f in faces)
                                 else "no_obvious_signal" if face.get("status") == "completed" else "not_run"),
            "faces": faces,
        }

    if "source" in keep:
        source = forensics.get("source") or {}
        data["sourceCandidates"] = {
            "status": source.get("status") or "not_run",
            "closedSet": True,
            "calibration": source.get("calibration") or "uncalibrated_closed_set",
            "candidates": [
                {"source": str(item.get("source") or "").replace("_", " "), "score": _round6(item.get("score"))}
                for item in (source.get("candidates") or [])
            ],
            "summary": source.get("summary") or "已知生成器闭集参考，未知来源与混合编辑不能确定归属。",
        }

    if "provenance" in keep:
        credentials = diagnostics.get("credentials") or {}
        declarations = diagnostics.get("sourceDeclarations") or {}
        data["provenance"] = {
            "c2pa": credentials.get("status") or "unknown",
            "aiDeclarationsFound": declared,
            "declarationSummary": declarations.get("summary") or "",
            "providerChecks": [
                {
                    "provider": item.get("provider"),
                    "name": item.get("name"),
                    "status": item.get("status"),
                    "declarations": [
                        {"role": entry.get("role"), "value": entry.get("value"), "location": entry.get("location")}
                        for entry in item.get("declarations") or []
                    ],
                }
                for item in (diagnostics.get("providerChecks") or {}).get("checks") or []
            ],
        }

    dimensions = diagnostics.get("dimensions") or []
    data["image"] = {
        "format": diagnostics.get("format"),
        "width": dimensions[0] if len(dimensions) > 0 else None,
        "height": dimensions[1] if len(dimensions) > 1 else None,
        "sha256": diagnostics.get("sha256"),
    }
    data["timing"] = {"seconds": _round6(result.get("seconds"))}
    engine = {"wholeImage": (result.get("model") or {}).get("name")}
    for key, label in (("tamper", "tamper"), ("face", "faceForgery"), ("source", "sourceCandidates")):
        part = forensics.get(key) or {}
        if part.get("status") == "completed":
            engine[label] = " · ".join(filter(None, [str(part.get("model")),
                                                     f"weights {str(part.get('weightsSha256'))[:16]}…" if part.get("weightsSha256") else ""]))
    data["engine"] = {key: value for key, value in engine.items() if value}
    return data


def general_task_status(job):
    """平台 2.1 任务对象 → (HTTP业务code, 状态文案)。"""
    status = (job or {}).get("status")
    if status in ("queued", "running"):
        return 200, status
    if status == "completed":
        return 200, "completed"
    return 500, "failed"


# ---------------------------------------------------------------- 2.3 材料核验

_STATUS_MAP = {"PASS": "pass", "FAIL": "fail", "NEI": "nei", "NOT_APPLICABLE": "not_applicable",
               "ERROR": "error", "WARN": "warn"}
_STAGE_STATUS = {"completed": "completed", "succeeded": "completed", "failed": "failed",
                 "not_run": "not_run", "partial": "partial", "queued": "queued", "running": "running",
                 "resource_limit": "resource_limit"}


def _stage_status(value):
    return _STAGE_STATUS.get(value, value or "not_run")


def _box_from_polygon(polygon):
    if not isinstance(polygon, list) or len(polygon) < 4:
        return None
    try:
        xs = [float(point[0]) for point in polygon]
        ys = [float(point[1]) for point in polygon]
    except (TypeError, ValueError, IndexError):
        return None
    left, top, right, bottom = min(xs), min(ys), max(xs), max(ys)
    return {"top": int(round(top)), "left": int(round(left)),
            "width": int(round(right - left)), "height": int(round(bottom - top))}


def _region_box(region, page_size):
    """page.regions 的 box([x1,y1,x2,y2]) → top/left/width/height。"""
    box = (region or {}).get("box")
    size = page_size or []
    if not isinstance(box, list) or len(box) != 4 or len(size) != 2:
        return None
    try:
        x1, y1, x2, y2 = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    # 坐标为渲染页像素；若超界且为 0..1 相对值则换算
    if max(x2, y2) <= 1.0:
        x1, x2, y1, y2 = x1 * size[0], x2 * size[0], y1 * size[1], y2 * size[1]
    return {"top": int(round(y1)), "left": int(round(x1)),
            "width": int(round(x2 - x1)), "height": int(round(y2 - y1))}


def map_documents_result(payload, *, include_preview=False):
    """平台 2.3 核验结果 → 市场 data。"""
    payload = payload or {}
    materials = payload.get("materials") or []
    review = payload.get("review") or {}
    plan = review.get("plan") or {}
    presentation = payload.get("presentation") or {}
    core_id = plan.get("coreMaterialId")
    names = {m.get("id"): m.get("name") or m.get("id") for m in materials}

    flat = [*(review.get("checks") or []), *(review.get("results") or [])]
    stats = {key: 0 for key in ("fail", "pass", "nei", "not_applicable", "error")}
    for check in flat:
        status = _STATUS_MAP.get(check.get("status"))
        if status in stats:
            stats[status] += 1
    warnings = presentation.get("warnings") or []
    result = {"issues_found": "issues_found", "no_issues": "no_issues_found"}.get(
        presentation.get("status"), "needs_more_information" if materials else "failed")

    issues = []
    for warning in warnings:
        issues.append({
            "title": warning.get("title") or "需关注事项",
            "message": warning.get("message") or warning.get("detail") or "",
            "materials": [names.get(mid, mid) for mid in warning.get("materialIds") or []],
            "evidence": [
                {
                    "field": (item or {}).get("key"),
                    "value": (item or {}).get("value"),
                    "page": ((item or {}).get("source") or {}).get("page"),
                    "observedText": ((item or {}).get("source") or {}).get("observedText"),
                    "box": _box_from_polygon(((item or {}).get("source") or {}).get("polygon")),
                }
                for item in warning.get("evidence") or []
            ],
        })

    mapped_materials = []
    for index, material in enumerate(materials):
        pages = []
        for page in material.get("pages") or []:
            size = page.get("rendered_size") or []
            pages.append({
                "page": page.get("page") or page.get("number"),
                "status": _stage_status(page.get("status")),
                "tamperedLocation": [
                    dict(box, probability=_round6((region or {}).get("mask_score_mean") or (region or {}).get("score")))
                    for region in page.get("regions") or []
                    if (box := _region_box(region, size))
                ],
                **({"preview": _format_b64(page.get("previewDataUrl"))} if include_preview else {}),
            })
        mapped_materials.append({
            "index": index,
            "id": material.get("id"),
            "name": material.get("name") or material.get("id"),
            "type": material.get("type") or "unknown",
            "role": "core" if material.get("id") == core_id else "auxiliary",
            "status": _stage_status(material.get("status")),
            "pages": pages,
            "fields": [
                {
                    "key": field.get("key"),
                    "value": field.get("value"),
                    "confidence": _round6(field.get("confidence")),
                    "page": (field.get("source") or {}).get("page"),
                    "observedText": (field.get("source") or {}).get("observedText"),
                    "box": _box_from_polygon((field.get("source") or {}).get("polygon")),
                    "extractionAmbiguous": bool(field.get("extractionAmbiguous")),
                }
                for field in material.get("fields") or []
            ],
            "checks": [
                {
                    "title": check.get("title") or check.get("rule") or "核验项",
                    "status": _STATUS_MAP.get(check.get("status"), check.get("status")),
                    "explanation": check.get("explanation") or check.get("message") or "",
                }
                for check in material.get("checks") or []
            ],
            "tamperScore": _tamper_score(((material.get("stages") or {}).get("seed") or {}).get("score")),
            "quality": {
                "attributes": {k: _round6(v) for k, v in ((material.get("quality") or {}).get("attributes") or {}).items()},
                "notes": (material.get("quality") or {}).get("notes") or [],
                "semantics": "uncalibrated_heuristic_hints_not_conclusions",
            } if material.get("quality") else None,
            "stages": {
                key: {"status": _stage_status((stage or {}).get("status")), "reason": (stage or {}).get("reason")}
                for key, stage in (material.get("stages") or {}).items()
            },
        })

    cross = []
    for candidate in review.get("candidates") or []:
        involved = sorted({(item or {}).get("materialId") for item in candidate.get("evidence") or [] if item})
        if len(involved) < 2 and not candidate.get("crossMaterial"):
            continue
        cross.append({
            "title": candidate.get("title") or "跨材料比对",
            "status": _STATUS_MAP.get(candidate.get("status"), candidate.get("status")),
            "materials": [names.get(mid, mid) for mid in involved],
            "explanation": candidate.get("explanation") or candidate.get("reason") or "",
        })

    # 智能复核（semanticReview）：请求 options.semanticReview=true 且平台已配置复核引擎时执行。
    # findings[].evidence 为平台本地指针（materialId + fieldId/blockId），此处解析为实值。
    field_index, block_index = {}, {}
    for material in materials:
        for field in material.get("fields") or []:
            field_index[(material.get("id"), field.get("id"))] = field
        for block in material.get("textBlocks") or []:
            block_index[(material.get("id"), block.get("id"))] = block

    def resolve_evidence(item):
        item = item or {}
        material_id = item.get("materialId")
        if item.get("fieldId") and (material_id, item["fieldId"]) in field_index:
            field = field_index[(material_id, item["fieldId"])]
            return {
                "field": field.get("key"),
                "value": field.get("value"),
                "confidence": _round6(field.get("confidence")),
                "page": (field.get("source") or {}).get("page"),
                "observedText": (field.get("source") or {}).get("observedText"),
                "box": _box_from_polygon((field.get("source") or {}).get("polygon")),
            }
        if item.get("blockId") and (material_id, item["blockId"]) in block_index:
            block = block_index[(material_id, item["blockId"])]
            return {"field": None, "value": block.get("text"), "confidence": _round6(block.get("confidence")),
                    "page": block.get("page"), "observedText": block.get("text"), "box": None}
        if item.get("key") is not None or item.get("value") is not None:  # 兼容已含实值的形态
            return {
                "field": item.get("key"), "value": item.get("value"),
                "page": (item.get("source") or {}).get("page"),
                "observedText": (item.get("source") or {}).get("observedText"),
                "box": _box_from_polygon((item.get("source") or {}).get("polygon")),
            }
        return None

    ai = presentation.get("aiReview") or {}
    findings = []
    for finding in ai.get("findings") or []:
        raw_evidence = finding.get("evidence") or []
        involved = sorted({(item or {}).get("materialId") for item in raw_evidence if item})
        findings.append({
            "verdict": finding.get("verdict"),  # reasonable | issues_found | needs_more_information
            "explanation": finding.get("explanation") or "",
            "warning": finding.get("warning") or "",
            "recommendation": finding.get("recommendation") or "",
            "materials": [names.get(mid, mid) for mid in involved],
            "evidence": [entry for entry in (resolve_evidence(item) for item in raw_evidence) if entry],
        })
    semantic_engine = payload.get("semanticReview") or {}

    return {
        "objective": plan.get("objective"),
        "mode": plan.get("mode") or "batch",
        "conclusion": {
            "result": result,
            "issueCount": len(issues),
            "checkStats": stats,
            "summary": presentation.get("summary") or "",
        },
        "issues": issues,
        "materials": mapped_materials,
        "crossChecks": cross,
        "aiReview": {
            "status": _stage_status(ai.get("status") or "not_run"),
            "summary": ai.get("summary") or "",
            "privacyMode": ai.get("privacyMode"),
            "reason": ai.get("reason"),
            "findings": findings,
            "disclaimer": "智能复核为辅助参考，不构成新增鉴伪证据；本地确定结论不因复核改变。",
        },
        "actions": presentation.get("actions") or [],
        "limitations": payload.get("limitations") or [],
        "engine": {"engineVersion": review.get("engineVersion"), "batchVersion": review.get("batchVersion"),
                   "semanticReviewEngine": semantic_engine.get("engine"),
                   "semanticReviewModel": semantic_engine.get("model")},
    }


def documents_task_status(payload):
    status = (payload or {}).get("status")
    if status in ("queued", "running"):
        return 200, status
    if status in ("completed", "partial"):
        return 200, status
    return 500, "failed"


def compose_overlay(image_data_url, boxes, *, color=(225, 133, 46)):
    """数据URL + 相对/像素框列表 → 叠加可视化图 base64（PNG）；失败返回 None。

    boxes 元素可为 0..1 相对框 {x,y,width,height}（2.1）或像素框 {top,left,width,height}（2.3）。
    """
    import io
    try:
        import base64 as _b64
        from PIL import Image, ImageDraw
        data, mime = decode_map(image_data_url)[1], None
        raw = _strip_data_url(image_data_url)
        if not raw:
            return None
        image = Image.open(io.BytesIO(_b64.b64decode(raw))).convert("RGB")
        draw = ImageDraw.Draw(image)
        w, h = image.size
        line = max(2, int(min(w, h) * 0.004))
        for box in boxes or []:
            if all(k in box for k in ("x", "y", "width", "height")):
                x1, y1 = box["x"] * w, box["y"] * h
                x2, y2 = (box["x"] + box["width"]) * w, (box["y"] + box["height"]) * h
            elif all(k in box for k in ("top", "left", "width", "height")):
                x1, y1 = box["left"], box["top"]
                x2, y2 = box["left"] + box["width"], box["top"] + box["height"]
            else:
                continue
            for offset in range(line):
                draw.rectangle([x1 - offset, y1 - offset, x2 + offset, y2 + offset], outline=color)
        out = io.BytesIO()
        image.save(out, format="JPEG", quality=88)
        return _b64.b64encode(out.getvalue()).decode("ascii")
    except Exception:
        return None

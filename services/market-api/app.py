#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""VERITAS 智鉴 · 2.1/2.3 对外市场 API（Python / FastAPI）。

阿里云市场风格：POST + base64/URL 入参，统一信封 {code, msg, success, taskNo, data}，
篡改区域原图像素坐标 tamperedLocation、热力图 heatmap。设计文档见
docs/image-workstream/market-api-and-mcp-tasks.md。

启动：
    AIGC_MARKET_API_MODE=fixture uvicorn app:app --host 0.0.0.0 --port 8090   # 离线回放（联调/测试）
    AIGC_MARKET_API_MODE=upstream AIGC_MARKET_API_UPSTREAM=http://127.0.0.1:4173 \
        uvicorn app:app --port 8090                                          # 真实引擎（平台 Node 服务）

鉴权：Authorization: APPCODE <code>；合法值配置于 AIGC_MARKET_API_APPCODES（逗号分隔，
未配置时仅接受 dev-apicode，仅供本地联调）。
"""

from __future__ import annotations

import os
import random
import time
from datetime import datetime, timezone, timedelta

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from fixtures import FixtureStore, FixtureTasks
from mappers import (GENERAL_FEATURES, OBJECTIVES, OBJECTIVE_ALIASES,
                     documents_task_status, general_task_status,
                     map_documents_result, map_general_result)
from upstream import IMAGE_MEDIA_TYPES, MarketError, UpstreamClient, load_material_bytes

MODE = os.environ.get("AIGC_MARKET_API_MODE", "upstream").strip().lower()
UPSTREAM_URL = os.environ.get("AIGC_MARKET_API_UPSTREAM", "http://127.0.0.1:4173")
SYNC_TIMEOUT_DEFAULT = int(os.environ.get("AIGC_MARKET_API_SYNC_TIMEOUT", "180"))
POLL_INTERVAL = 2.0
CN_TZ = timezone(timedelta(hours=8))

app = FastAPI(title="VERITAS 智鉴市场 API", version="1.0.0")
_upstream = UpstreamClient(UPSTREAM_URL, timeout=60.0) if MODE == "upstream" else None
_fixture_tasks = FixtureTasks(FixtureStore())


# ---------------------------------------------------------------- 基础设施

def envelope(code, msg, *, task_no=None, data=None, detail=None):
    body = {"code": code, "msg": msg, "success": code == 200}
    if task_no:
        body["taskNo"] = task_no
    if data is not None:
        body["data"] = data
    if detail is not None:
        body["detail"] = detail
    return body


def new_task_no():
    return datetime.now(CN_TZ).strftime("%Y%m%d%H%M%S%f")[:17] + f"{random.randint(0, 999999):06d}"


async def read_params(request: Request):
    """form-urlencoded 与 JSON 双协议读取；全部规整为 dict。"""
    content_type = (request.headers.get("content-type") or "").lower()
    try:
        if content_type.startswith("application/json"):
            payload = await request.json()
            return payload if isinstance(payload, dict) else {}
        form = await request.form()
        return {key: values for key, values in form.multi_items()} if hasattr(form, "multi_items") else dict(form)
    except Exception as error:
        raise MarketError(400, "请求体解析失败", str(error)) from error


def check_auth(request: Request):
    header = request.headers.get("authorization") or ""
    if not header.startswith("APPCODE "):
        raise MarketError(401, "缺少 Authorization: APPCODE <code> 请求头")
    code = header[len("APPCODE "):].strip()
    allowed = [item.strip() for item in (os.environ.get("AIGC_MARKET_API_APPCODES") or "dev-apicode").split(",") if item.strip()]
    if code not in allowed:
        raise MarketError(401, "APPCODE 无效或未授权")


def as_bool(value, default=False):
    if value is None or value == "":
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def as_float(value, default, low, high):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return min(max(number, low), high)


def as_int(value, default, low, high):
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return default
    return min(max(number, low), high)


def first(params, *names, default=None):
    for name in names:
        if name in params and params[name] not in (None, ""):
            value = params[name]
            return value[0] if isinstance(value, list) else value
    return default


@app.exception_handler(MarketError)
async def market_error_handler(_, error: MarketError):
    status = 401 if error.code == 401 else 200
    return JSONResponse(status_code=status, content=envelope(error.code, error.msg, detail=error.detail))


# ---------------------------------------------------------------- 任务表（upstream 模式）

TASKS: dict[str, dict] = {}


def submit_upstream(scenario: str, launch):
    """提交平台任务并登记 taskNo；launch(client) 返回平台任务对象。"""
    task_no = new_task_no()
    if MODE != "upstream" or _upstream is None:
        raise MarketError(500, "服务配置错误", f"当前模式 {MODE} 不支持该操作")
    job = launch(_upstream)
    TASKS[task_no] = {
        "scenario": scenario,
        "platformId": job.get("jobId") or job.get("reviewId"),
        "createdAt": time.time(),
        "data": job,
    }
    return task_no, job


def poll_upstream(task_no, timeout_seconds):
    """轮询至终态或超时；返回 (终态data, status, failed_reason)。"""
    task = TASKS.get(task_no)
    if not task:
        raise MarketError(404, "任务不存在", task_no)
    deadline = time.time() + max(timeout_seconds, 1)
    client = _upstream
    while True:
        if task["scenario"] == "general":
            payload = client.general_status(task["platformId"])
            code, status = general_task_status(payload)
        else:
            payload = client.documents_status(task["platformId"])
            code, status = documents_task_status(payload)
        if status not in ("queued", "running"):
            return payload, status, None if code == 200 else (payload.get("error") or {}).get("message")
        if time.time() >= deadline:
            return payload, status, None
        time.sleep(POLL_INTERVAL)


def task_envelope(task_no, payload, status, *, mapper, data_source, extra=None, **map_kwargs):
    data = mapper(payload, **map_kwargs) if status in ("completed", "partial") else {}
    data["task"] = {
        "taskNo": task_no,
        "platformTaskId": TASKS.get(task_no, {}).get("platformId"),
        "status": status if status != "partial" else "completed_partial",
        "dataSource": data_source,
    }
    for key, value in (extra or {}).items():
        if value is not None:
            data[key] = value
    if status == "failed":
        return envelope(500, "检测处理失败", task_no=task_no,
                        data=data, detail=(payload.get("error") or {}).get("message") if isinstance(payload, dict) else None)
    return envelope(200, "成功", task_no=task_no, data=data)


def _region_pixels(region, size):
    """2.3 page.regions 的 box([x1,y1,x2,y2] 像素或 0..1) → top/left/width/height。"""
    box = (region or {}).get("box")
    if not isinstance(box, list) or len(box) != 4 or len(size or []) != 2:
        return None
    try:
        x1, y1, x2, y2 = (float(v) for v in box)
    except (TypeError, ValueError):
        return None
    if max(x2, y2) <= 1.0:
        x1, x2, y1, y2 = x1 * size[0], x2 * size[0], y1 * size[1], y2 * size[1]
    return {"top": y1, "left": x1, "width": x2 - x1, "height": y2 - y1}


# ---------------------------------------------------------------- 2.1 通用图片检测

async def _general_detection(request: Request):
    check_auth(request)
    params = await read_params(request)
    base64_data, media_type, suffix = load_material_bytes(
        image=first(params, "image", "base64"), image_url=first(params, "imageUrl", "url"))
    if media_type not in IMAGE_MEDIA_TYPES:
        raise MarketError(400, "参数错误：通用图片检测仅支持 JPG/PNG/WebP", media_type)
    features_raw = first(params, "features", default="")
    features = [item.strip() for item in str(features_raw).split(",") if item.strip()] or None
    invalid = set(features or []) - set(GENERAL_FEATURES)
    if invalid:
        raise MarketError(400, f"参数错误：features 含未知项 {sorted(invalid)}", f"可选：{','.join(GENERAL_FEATURES)}")
    restrict = as_float(first(params, "restrictProbability", "restrict_probability"), 0.5, 0.0, 1.0)
    max_locations = as_int(first(params, "maxLocations", "max_locations"), 8, 1, 50)
    sync_timeout = as_int(first(params, "syncTimeoutSeconds"), SYNC_TIMEOUT_DEFAULT, 5, 300)
    map_kwargs = {"features": features, "restrict_probability": restrict, "max_locations": max_locations}
    include_overlay = as_bool(first(params, "includeOverlay", "include_overlay"), False)

    def _finish(task_no, payload, status, data_source):
        extra = {}
        if include_overlay:
            from mappers import compose_overlay
            dims = (payload.get("diagnostics") or {}).get("dimensions") or [1, 1]
            mapped = map_general_result(payload, **map_kwargs)
            boxes = [{"x": b["left"] / max(1, dims[0]), "y": b["top"] / max(1, dims[1]),
                      "width": b["width"] / max(1, dims[0]), "height": b["height"] / max(1, dims[1])}
                     for b in (mapped.get("tamper") or {}).get("tamperedLocation") or []]
            src = ((payload.get("diagnostics") or {}).get("layers") or {}).get("original")
            overlay = compose_overlay(src, boxes) if src else None
            extra = {"tamperOverlay": overlay, "tamperOverlayFormat": "jpeg" if overlay else None}
        return task_envelope(task_no, payload, status, mapper=map_general_result,
                             data_source=data_source, extra=extra, **map_kwargs)

    if MODE == "fixture":
        task_no = _fixture_tasks.submit("general", new_task_no())
        payload = _fixture_tasks.result(task_no)
        return _finish(task_no, payload, payload.get("status"), "fixture")

    task_no, job = submit_upstream("general", lambda client: client.general_detect(base64_data, media_type, f"image{suffix}"))
    if as_bool(first(params, "asyncSubmit", "async_submit"), False):
        data = {"task": {"taskNo": task_no, "platformTaskId": job.get("jobId"),
                         "status": job.get("status") or "queued", "dataSource": "engine"}}
        return envelope(200, "成功", task_no=task_no, data=data)
    payload, status, _ = poll_upstream(task_no, sync_timeout)
    return _finish(task_no, payload, status, "engine")


async def _general_result(request: Request):
    check_auth(request)
    params = await read_params(request)
    task_no = first(params, "taskNo", "task_no")
    if not task_no:
        raise MarketError(400, "参数错误：缺少 taskNo")
    features = [item.strip() for item in str(first(params, "features", default="")).split(",") if item.strip()] or None
    map_kwargs = {
        "features": features,
        "restrict_probability": as_float(first(params, "restrictProbability", "restrict_probability"), 0.5, 0.0, 1.0),
        "max_locations": as_int(first(params, "maxLocations", "max_locations"), 8, 1, 50),
    }
    if MODE == "fixture":
        payload = _fixture_tasks.result(task_no)
        if payload is None:
            raise MarketError(404, "任务不存在", task_no)
        return task_envelope(task_no, payload, payload.get("status"), mapper=map_general_result,
                             data_source="fixture", **map_kwargs)
    if task_no not in TASKS:
        raise MarketError(404, "任务不存在", task_no)
    payload, status, _ = poll_upstream(task_no, 2)
    return task_envelope(task_no, payload, status, mapper=map_general_result, data_source="engine", **map_kwargs)


# ---------------------------------------------------------------- 2.3 材料核验

def _documents_payload_from_params(params):
    """JSON 完整形态 / form 快捷模式 → 平台 review 请求体。"""
    objective = OBJECTIVE_ALIASES.get(first(params, "objective", default=""), first(params, "objective", default=""))
    if objective and objective not in OBJECTIVES:
        raise MarketError(400, f"参数错误：objective 必须是 {OBJECTIVES} 之一", objective)
    materials_json = params.get("materials")
    files, material_index = [], 0
    if isinstance(materials_json, list) and materials_json:
        for index, entry in enumerate(materials_json or []):
            if not isinstance(entry, dict):
                raise MarketError(400, "参数错误：materials[] 元素必须是对象")
            base64_data, media_type, suffix = load_material_bytes(
                image=entry.get("image"), image_url=entry.get("imageUrl"), file=entry.get("file"))
            raw_type = entry.get("type") or "unknown"
            files.append({
                "id": f"material-{index + 1}", "name": entry.get("name") or f"material-{index + 1}{suffix}",
                "mediaType": media_type,
                # auto=平台按 OCR 分类结果自动回填（以 unknown 提交，由分类器决定真实类型）。
                "materialType": "unknown" if raw_type == "auto" else raw_type,
                "contentBase64": base64_data,
            })
            material_index = index
    else:
        base64_data, media_type, suffix = load_material_bytes(
            image=first(params, "image", "base64"), image_url=first(params, "imageUrl", "url"),
            file=first(params, "file"))
        raw_type = first(params, "materialType", "type", default="unknown")
        files.append({
            "id": "material-1", "name": first(params, "name", default=f"material-1{suffix}"),
            "mediaType": media_type,
            "materialType": "unknown" if raw_type == "auto" else raw_type,
            "contentBase64": base64_data,
        })
    if not files:
        raise MarketError(400, "参数错误：至少提供一份材料")

    core_index = as_int(first(params, "coreMaterialIndex", "core_material_index"), 0, 0, len(files) - 1)
    confirmations = []
    for entry in params.get("confirmations") or []:
        if not isinstance(entry, dict):
            continue
        confirmations.append({
            "materialId": f"material-{as_int(entry.get('materialIndex'), 0, 0, len(files) - 1) + 1}",
            "kind": "same_transaction", "coreRole": "transaction", "auxiliaryRole": "transaction",
            "reason": str(entry.get("reason") or "").strip() or "调用方确认同一交易",
            "amountScopeConfirmed": bool(entry.get("sameAmountScope")),
            "dateScopeConfirmed": False,
            "documentScopeConfirmed": bool(entry.get("sameInvoice")),
        })
    options_json = params.get("options") if isinstance(params.get("options"), dict) else {}
    mode = first(params, "mode", default="batch")
    mode = mode if mode in ("single", "batch") else "batch"
    payload = {
        "objective": objective or "invoice_review",
        "mode": mode,
        "confirmations": [] if mode == "single" else [item for item in confirmations if item],
        "jurisdiction": first(params, "jurisdiction", default="CN"),
        "coreMaterialId": files[core_index]["id"],
        "context": {},
        "files": files,
        "relations": [],
        "options": {
            "runModels": as_bool(options_json.get("runModels", first(params, "runModels")), True),
            "explain": False,
            "semanticReview": as_bool(options_json.get("semanticReview", first(params, "semanticReview")), False),
            "privacyMode": options_json.get("privacyMode", first(params, "privacyMode")) or "redacted",
        },
    }
    return payload


async def _document_review(request: Request):
    check_auth(request)
    params = await read_params(request)
    platform_payload = _documents_payload_from_params(params)
    include_preview = as_bool(first(params, "includePreview", "include_preview"), False)
    include_overlay = as_bool(first(params, "includeOverlay", "include_overlay"), False)
    sync_timeout = as_int(first(params, "syncTimeoutSeconds"), SYNC_TIMEOUT_DEFAULT, 5, 300)

    def _finish(task_no, payload, status, data_source):
        body = task_envelope(task_no, payload, status, mapper=map_documents_result,
                             data_source=data_source, include_preview=include_preview)
        if include_overlay:
            from mappers import compose_overlay
            mapped_ids = {m.get("id"): m for m in (body.get("data") or {}).get("materials") or []}
            for source in payload.get("materials") or []:
                target = mapped_ids.get(source.get("id"))
                if not target:
                    continue
                page0 = (source.get("pages") or [{}])[0]
                size = page0.get("rendered_size") or [1, 1]
                pixel_boxes = [b for b in (_region_pixels(r, size) for r in (page0.get("regions") or [])) if b]
                target["tamperOverlay"] = compose_overlay(page0.get("previewDataUrl"), pixel_boxes)
        return body

    if MODE == "fixture":
        task_no = _fixture_tasks.submit("documents", new_task_no())
        payload = _fixture_tasks.result(task_no)
        return _finish(task_no, payload, payload.get("status"), "fixture")

    task_no, job = submit_upstream("documents", lambda client: client.documents_review(platform_payload))
    if as_bool(first(params, "asyncSubmit", "async_submit"), False):
        data = {"task": {"taskNo": task_no, "platformTaskId": job.get("reviewId"),
                         "status": job.get("status") or "queued", "dataSource": "engine"}}
        return envelope(200, "成功", task_no=task_no, data=data)
    payload, status, _ = poll_upstream(task_no, sync_timeout)
    return _finish(task_no, payload, status, "engine")


async def _document_result(request: Request):
    check_auth(request)
    params = await read_params(request)
    task_no = first(params, "taskNo", "task_no")
    if not task_no:
        raise MarketError(400, "参数错误：缺少 taskNo")
    include_preview = as_bool(first(params, "includePreview", "include_preview"), False)
    if MODE == "fixture":
        payload = _fixture_tasks.result(task_no)
        if payload is None:
            raise MarketError(404, "任务不存在", task_no)
        return task_envelope(task_no, payload, payload.get("status"), mapper=map_documents_result,
                             data_source="fixture", include_preview=include_preview)
    if task_no not in TASKS:
        raise MarketError(404, "任务不存在", task_no)
    payload, status, _ = poll_upstream(task_no, 2)
    return task_envelope(task_no, payload, status, mapper=map_documents_result,
                         data_source="engine", include_preview=include_preview)


async def _document_fields(request: Request):
    """单份材料字段提取（复用核验链路，关闭视觉模型，仅解析与 OCR）。"""
    check_auth(request)
    params = await read_params(request)
    base64_data, media_type, suffix = load_material_bytes(
        image=first(params, "image", "base64"), image_url=first(params, "imageUrl", "url"), file=first(params, "file"))
    objective = OBJECTIVE_ALIASES.get(first(params, "objective", default=""), first(params, "objective", default=""))
    if objective and objective not in OBJECTIVES:
        raise MarketError(400, f"参数错误：objective 必须是 {OBJECTIVES} 之一", objective)
    sync_timeout = as_int(first(params, "syncTimeoutSeconds"), SYNC_TIMEOUT_DEFAULT, 5, 300)

    if MODE == "fixture":
        task_no = _fixture_tasks.submit("documents", new_task_no())
        payload = _fixture_tasks.result(task_no)
        data = _fields_data(payload, data_source="fixture")
        return envelope(200, "成功", task_no=task_no, data=data)

    platform_payload = {
        "objective": objective or "invoice_review", "confirmations": [], "jurisdiction": "CN",
        "coreMaterialId": "material-1",
        "context": {"region": "unspecified"},
        "files": [{"id": "material-1", "name": first(params, "name", default=f"material-1{suffix}"),
                   "mediaType": media_type, "materialType": first(params, "materialType", "type", default="unknown"),
                   "contentBase64": base64_data}],
        "relations": [],
        "options": {"runModels": False, "explain": False, "semanticReview": False, "privacyMode": "redacted"},
    }
    task_no, job = submit_upstream("documents", lambda client: client.documents_review(platform_payload))
    if as_bool(first(params, "asyncSubmit", "async_submit"), False):
        data = {"task": {"taskNo": task_no, "platformTaskId": job.get("reviewId"),
                         "status": job.get("status") or "queued", "dataSource": "engine"}}
        return envelope(200, "成功", task_no=task_no, data=data)
    payload, status, _ = poll_upstream(task_no, sync_timeout)
    if status == "failed":
        return task_envelope(task_no, payload, status, mapper=map_documents_result, data_source="engine")
    return envelope(200, "成功", task_no=task_no, data=_fields_data(payload, data_source="engine", task_no=task_no,
                                                                    platform_id=TASKS.get(task_no, {}).get("platformId")))


def _fields_data(payload, *, data_source, task_no=None, platform_id=None):
    mapped = map_documents_result(payload, include_preview=False)
    return {
        "objective": mapped["objective"],
        "materials": [
            {"index": item["index"], "name": item["name"], "type": item["type"],
             "status": item["status"], "pages": [{"page": p["page"], "status": p["status"]} for p in item["pages"]],
             "fields": item["fields"], "ocrStage": item["stages"].get("ocr", {"status": "not_run"})}
            for item in mapped["materials"]
        ],
        "task": {"taskNo": task_no, "platformTaskId": platform_id, "status": "completed", "dataSource": data_source},
    }


# ---------------------------------------------------------------- 路由

def with_duration(handler):
    """路由包装：信封统一附带 duration（毫秒）。"""
    async def wrapped(request: Request):
        started = time.perf_counter()
        result = await handler(request)
        if isinstance(result, dict):
            result["duration"] = round((time.perf_counter() - started) * 1000)
        return result
    wrapped.__name__ = handler.__name__
    return wrapped


@app.get("/health")
def health():
    return envelope(200, "成功", data={"status": "ok", "service": "veritas-market-api",
                                       "mode": MODE, "upstream": UPSTREAM_URL if MODE == "upstream" else None})


@app.post("/v1/image/general/detection")
@with_duration
async def general_detection(request: Request):
    return await _general_detection(request)


@app.post("/v1/image/general/detection/result")
@with_duration
async def general_detection_result(request: Request):
    return await _general_result(request)


@app.get("/v1/image/general/detection/result")
@with_duration
async def general_detection_result_get(request: Request):
    return await _general_result_with(request, {"taskNo": request.query_params.get("taskNo", "")})


@app.post("/v1/document/review")
@with_duration
async def document_review(request: Request):
    return await _document_review(request)


@app.post("/v1/document/review/result")
@with_duration
async def document_review_result(request: Request):
    return await _document_result(request)


@app.get("/v1/document/review/result")
@with_duration
async def document_review_result_get(request: Request):
    return await _document_result_with(request, {"taskNo": request.query_params.get("taskNo", "")})


@app.post("/v1/document/fields")
@with_duration
async def document_fields(request: Request):
    return await _document_fields(request)


async def _general_result_with(request: Request, params):
    check_auth(request)
    map_kwargs = {"features": None, "restrict_probability": 0.5, "max_locations": 8}
    task_no = params.get("taskNo")
    if not task_no:
        raise MarketError(400, "参数错误：缺少 taskNo")
    if MODE == "fixture":
        payload = _fixture_tasks.result(task_no)
        if payload is None:
            raise MarketError(404, "任务不存在", task_no)
        return task_envelope(task_no, payload, payload.get("status"), mapper=map_general_result,
                             data_source="fixture", **map_kwargs)
    if task_no not in TASKS:
        raise MarketError(404, "任务不存在", task_no)
    payload, status, _ = poll_upstream(task_no, 2)
    return task_envelope(task_no, payload, status, mapper=map_general_result, data_source="engine", **map_kwargs)


async def _document_result_with(request: Request, params):
    check_auth(request)
    task_no = params.get("taskNo")
    if not task_no:
        raise MarketError(400, "参数错误：缺少 taskNo")
    if MODE == "fixture":
        payload = _fixture_tasks.result(task_no)
        if payload is None:
            raise MarketError(404, "任务不存在", task_no)
        return task_envelope(task_no, payload, payload.get("status"), mapper=map_documents_result,
                             data_source="fixture", include_preview=False)
    if task_no not in TASKS:
        raise MarketError(404, "任务不存在", task_no)
    payload, status, _ = poll_upstream(task_no, 2)
    return task_envelope(task_no, payload, status, mapper=map_documents_result,
                         data_source="engine", include_preview=False)

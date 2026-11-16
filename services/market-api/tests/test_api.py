#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""接口测试（fixture 模式）：鉴权、参数校验、六个端点、错误码与信封。"""

import base64
import io
import json
import os
import sys
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from PIL import Image

os.environ["AIGC_MARKET_API_MODE"] = "fixture"
os.environ["AIGC_MARKET_API_APPCODES"] = "test-apicode"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import app  # noqa: E402

client = TestClient(app)
AUTH = {"Authorization": "APPCODE test-apicode"}


def png_b64(color=(255, 0, 0), size=(6, 6)):
    image = Image.new("RGB", size, color)
    buffer = io.BytesIO()
    image.save(buffer, "PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


PDF_HEAD = b"%PDF-1.4\n%%EOF"


def test_health_open():
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200 and body["data"]["mode"] == "fixture"


def test_auth_required_and_validated():
    response = client.post("/v1/image/general/detection", data={"image": png_b64()})
    assert response.status_code == 401 and response.json()["code"] == 401
    response = client.post("/v1/image/general/detection", data={"image": png_b64()},
                           headers={"Authorization": "APPCODE wrong-code"})
    assert response.status_code == 401


def test_general_detection_sync_fixture():
    response = client.post("/v1/image/general/detection", data={"image": png_b64()}, headers=AUTH)
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200 and body["success"] is True and body["taskNo"]
    data = body["data"]
    assert data["detectionResult"] in ("suspected_ai_generated", "no_obvious_ai_evidence", "ai_generated_declared")
    assert data["task"]["dataSource"] == "fixture"
    assert data["task"]["status"] == "completed"
    assert data["tamper"]["tamperedLocation"] is not None  # 字段恒在，列表可为空


def test_general_detection_features_and_params():
    response = client.post("/v1/image/general/detection",
                           data={"image": png_b64(), "features": "base", "restrictProbability": "0.9", "maxLocations": "2"},
                           headers=AUTH)
    data = response.json()["data"]
    assert "tamper" not in data and "faceForgery" not in data
    response = client.post("/v1/image/general/detection", data={"image": png_b64(), "features": "nope"}, headers=AUTH)
    assert response.json()["code"] == 400


def test_general_result_roundtrip_and_404():
    body = client.post("/v1/image/general/detection", data={"image": png_b64()}, headers=AUTH).json()
    task_no = body["taskNo"]
    for call in (
        lambda: client.post("/v1/image/general/detection/result", data={"taskNo": task_no}, headers=AUTH),
        lambda: client.get("/v1/image/general/detection/result", params={"taskNo": task_no}, headers=AUTH),
    ):
        result = call().json()
        assert result["code"] == 200 and result["data"]["task"]["taskNo"] == task_no
        assert result["data"]["detectionResult"]
    assert client.post("/v1/image/general/detection/result", data={"taskNo": "none"}, headers=AUTH).json()["code"] == 404
    assert client.post("/v1/image/general/detection/result", data={}, headers=AUTH).json()["code"] == 400


def test_general_input_validation():
    assert client.post("/v1/image/general/detection", data={}, headers=AUTH).json()["code"] == 400
    both = {"image": png_b64(), "imageUrl": "https://example.com/a.png"}
    assert client.post("/v1/image/general/detection", data=both, headers=AUTH).json()["code"] == 400
    assert client.post("/v1/image/general/detection", data={"image": "!!!not-base64"}, headers=AUTH).json()["code"] == 400
    pdf_b64 = base64.b64encode(PDF_HEAD).decode("ascii")
    body = client.post("/v1/image/general/detection", data={"image": pdf_b64}, headers=AUTH).json()
    assert body["code"] == 400 and "JPG/PNG/WebP" in body["msg"]


def test_general_url_download():
    served = {"png": base64.b64decode(png_b64())}

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(served["png"])))
            self.end_headers()
            self.wfile.write(served["png"])

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/x.png"
        body = client.post("/v1/image/general/detection", data={"imageUrl": url}, headers=AUTH).json()
        assert body["code"] == 200 and body["data"]["detectionResult"]
    finally:
        server.shutdown()


def test_document_review_json_and_form():
    payload = {
        "objective": "invoice_review", "coreMaterialIndex": 0,
        "materials": [
            {"name": "发票A.png", "type": "invoice", "image": png_b64((0, 255, 0))},
            {"name": "合同.pdf", "file": base64.b64encode(PDF_HEAD).decode("ascii")},
        ],
        "confirmations": [{"materialIndex": 1, "reason": "同一笔付款", "sameInvoice": True}],
        "options": {"runModels": True, "semanticReview": False, "privacyMode": "redacted"},
    }
    body = client.post("/v1/document/review", json=payload, headers=AUTH).json()
    assert body["code"] == 200 and body["taskNo"]
    data = body["data"]
    assert data["task"]["dataSource"] == "fixture"
    assert data["conclusion"]["result"] in ("issues_found", "no_issues_found", "needs_more_information")
    assert data["materials"] and data["materials"][0]["fields"] is not None
    assert "preview" not in data["materials"][0]["pages"][0]

    form_body = client.post("/v1/document/review",
                            data={"image": png_b64(), "materialType": "invoice", "objective": "merchant_reconciliation"},
                            headers=AUTH).json()
    assert form_body["code"] == 200


def test_document_review_validation():
    assert client.post("/v1/document/review", data={"image": png_b64(), "objective": "bad_one"}, headers=AUTH).json()["code"] == 400
    assert client.post("/v1/document/review", data={}, headers=AUTH).json()["code"] == 400
    assert client.post("/v1/document/review", data={"imageUrl": "https://no-host/x.png"}, headers=AUTH).json()["code"] == 400


def test_document_result_roundtrip():
    task_no = client.post("/v1/document/review", data={"image": png_b64()}, headers=AUTH).json()["taskNo"]
    body = client.post("/v1/document/review/result", data={"taskNo": task_no}, headers=AUTH).json()
    assert body["code"] == 200 and body["data"]["materials"]
    body = client.get("/v1/document/review/result", params={"taskNo": task_no, "includePreview": "true"}, headers=AUTH).json()
    assert body["code"] == 200
    assert client.post("/v1/document/review/result", data={"taskNo": "ghost"}, headers=AUTH).json()["code"] == 404


def test_document_fields_endpoint():
    body = client.post("/v1/document/fields", data={"image": png_b64(), "materialType": "invoice"}, headers=AUTH).json()
    assert body["code"] == 200
    material = body["data"]["materials"][0]
    assert set(material) >= {"index", "name", "type", "status", "pages", "fields", "ocrStage"}
    assert material["fields"] is not None and "issues" not in body["data"]


def test_envelope_error_shape_consistent():
    for path, payload in (
        ("/v1/image/general/detection", {}),
        ("/v1/image/general/detection/result", {"taskNo": "x"}),
        ("/v1/document/review", {}),
    ):
        body = client.post(path, data=payload, headers=AUTH).json()
        assert set(body) >= {"code", "msg", "success"} and body["success"] is False

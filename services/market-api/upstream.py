#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""平台 Node 服务客户端（upstream 真实引擎模式）与图片 URL 下载。

平台契约（见 src/modules/image/general/service.js 与 documents/server/review-service.js）：
- 2.1 POST /api/v1/image/general  {action:'detect',id,file:{name,mediaType,contentBase64}} → 202 {data:{jobId,...}}
       {action:'status',jobId} → 完整检测项
- 2.3 POST /api/v1/image/documents {action:'review',...} → 202 {data:{reviewId,...}}
       {action:'status',reviewId} → 完整核验结果
"""

import re

import httpx

MEDIA_TYPES = {
    "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp",
    "application/pdf": ".pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}
IMAGE_MEDIA_TYPES = ("image/jpeg", "image/png", "image/webp")
MAX_IMAGE_BYTES = 20 * 1024 * 1024
MAX_DOC_BYTES = 12 * 1024 * 1024
BASE64_RE = re.compile(r"^[A-Za-z0-9+/]+={0,2}$")


class MarketError(Exception):
    def __init__(self, code, msg, detail=None):
        super().__init__(msg)
        self.code, self.msg, self.detail = code, msg, detail


class UpstreamClient:
    def __init__(self, base_url, timeout=30.0):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def _post(self, path, payload):
        try:
            with httpx.Client(timeout=self.timeout) as client:
                response = client.post(f"{self.base_url}{path}", json=payload)
        except httpx.HTTPError as error:
            raise MarketError(503, "平台服务暂不可达", str(error)) from error
        try:
            body = response.json()
        except ValueError as error:
            raise MarketError(500, "平台服务返回异常", f"HTTP {response.status_code}") from error
        if response.status_code >= 400 or body.get("error"):
            error = body.get("error") or {}
            raise MarketError(response.status_code if response.status_code >= 400 else 500,
                              error.get("message") or "平台服务处理失败", error.get("code"))
        return body.get("data") or body

    # ---- 2.1
    def general_detect(self, content_base64, media_type, name="image"):
        return self._post("/api/v1/image/general", {
            "action": "detect", "id": f"market-{len(content_base64) % 97}",
            "file": {"name": name, "mediaType": media_type, "contentBase64": content_base64},
        })

    def general_status(self, job_id):
        return self._post("/api/v1/image/general", {"action": "status", "jobId": job_id})

    # ---- 2.3
    def documents_review(self, payload):
        return self._post("/api/v1/image/documents", {"action": "review", **payload})

    def documents_status(self, review_id):
        return self._post("/api/v1/image/documents", {"action": "status", "reviewId": review_id})


def sniff_image_media_type(head: bytes, url: str = ""):
    if head[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if head[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head[:5] == b"%PDF-":
        return "application/pdf"
    if head[:2] == b"PK":
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if url.lower().split("?")[0].endswith((".jpg", ".jpeg")):
        return "image/jpeg"
    if url.lower().split("?")[0].endswith(".png"):
        return "image/png"
    if url.lower().split("?")[0].endswith(".webp"):
        return "image/webp"
    return None


def load_material_bytes(*, image=None, image_url=None, file=None):
    """base64 / URL / 文件 base64 → (base64_str, media_type, name)；校验大小与格式。"""
    if sum(bool(v) for v in (image, image_url, file)) != 1:
        raise MarketError(400, "参数错误：image、imageUrl、file 必须且只能提供一个")
    if image_url:
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                response = client.get(image_url)
        except httpx.HTTPError as error:
            raise MarketError(400, "图片 URL 下载失败", str(error)) from error
        if response.status_code != 200:
            raise MarketError(400, "图片 URL 下载失败", f"HTTP {response.status_code}")
        raw = response.content
        media_type = sniff_image_media_type(raw[:16], image_url)
    else:
        text = (image or file).strip()
        if text.startswith("data:") and "," in text:
            text = text.split(",", 1)[1]
        text = "".join(text.split())
        if not text or len(text) % 4 != 0 or not BASE64_RE.match(text):
            raise MarketError(400, "参数错误：base64 内容无效")
        try:
            import base64
            raw = base64.b64decode(text)
        except Exception as error:
            raise MarketError(400, "参数错误：base64 解码失败", str(error))
        media_type = sniff_image_media_type(raw[:16])
    if not media_type:
        raise MarketError(400, "参数错误：无法识别的文件格式（支持 JPG/PNG/WebP/PDF/DOCX）")
    limit = MAX_IMAGE_BYTES if media_type.startswith("image/") else MAX_DOC_BYTES
    if not raw or len(raw) > limit:
        raise MarketError(413, f"文件超过大小限制（{limit // 1024 // 1024} MB）")
    import base64
    return base64.b64encode(raw).decode("ascii"), media_type, media_type and MEDIA_TYPES[media_type]

"""3.1 通用AI生成视频检测 · ReStraV 推理服务。

提供两个接口：
- GET  /health  健康检查（模型与训练产物是否就绪）
- POST /detect  multipart 上传视频（字段名 video），返回前端契约结构的结果

环境变量：
- RESTRAV_DEVICE      推理设备，默认 cuda:0（无 GPU 时回退 CPU）
- RESTRAV_ARTIFACTS   训练产物目录，默认 ./artifacts
- TORCH_HOME          torch.hub 缓存目录（DINOv2 权重）
"""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from restrav_core import ReStraVDetector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("restrav-service")

ARTIFACTS_DIR = Path(os.environ.get("RESTRAV_ARTIFACTS", Path(__file__).parent / "artifacts"))
ALLOWED_EXT = {".mp4", ".webm", ".mov", ".avi", ".mkv"}
MAX_BYTES = 500 * 1024 * 1024

app = FastAPI(title="VERITAS 视频检测 · ReStraV", version="1.0.0")
# Node 网关（127.0.0.1:4173）与本机调试页面都可能访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

detector: ReStraVDetector | None = None
detector_error: str | None = None


def get_detector() -> ReStraVDetector:
    global detector, detector_error
    if detector is None:
        try:
            detector = ReStraVDetector(ARTIFACTS_DIR, os.environ.get("RESTRAV_DEVICE"))
            log.info("ReStraV 检测器就绪：device=%s artifacts=%s", detector.device, ARTIFACTS_DIR)
        except Exception as exc:
            detector_error = str(exc)
            log.exception("检测器初始化失败")
            raise
    return detector


@app.get("/health")
def health() -> dict:
    ready = False
    detail = detector_error
    try:
        get_detector()
        ready = detector is not None
    except Exception:
        pass
    return {
        "status": "ok" if ready else "degraded",
        "service": "restrav-video-general",
        "modelReady": ready,
        "artifactsDir": str(ARTIFACTS_DIR),
        "error": detail,
    }


@app.post("/detect")
async def detect(video: UploadFile = File(...)) -> dict:
    suffix = Path(video.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise HTTPException(400, f"不支持的视频格式 {suffix or '(无后缀)'}，请上传 MP4/WebM。")
    try:
        get_detector()
    except Exception:
        raise HTTPException(503, "检测模型未就绪，请先完成训练并放置产物。")

    # 落盘后再交给 torchcodec 解码，避免大文件全量驻留内存
    with tempfile.NamedTemporaryFile(suffix=suffix, dir=os.environ.get("RESTRAV_TMP", None)) as tmp:
        size = 0
        while chunk := await video.read(4 * 1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(413, "视频超过 500 MiB 限制。")
            tmp.write(chunk)
        tmp.flush()
        try:
            result = get_detector().detect(tmp.name)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except Exception as exc:  # 解码器等底层错误
            log.exception("检测失败：%s", video.filename)
            raise HTTPException(500, f"检测处理失败：{str(exc)[:200]}")
    result["meta"]["filename"] = video.filename
    return result

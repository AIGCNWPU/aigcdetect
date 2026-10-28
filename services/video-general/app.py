"""3.1 通用AI生成视频检测 · 推理服务（Native-Scale 主引擎，ReStraV 回退）。

提供两个接口：
- GET  /health  健康检查（当前引擎、模型与产物是否就绪）
- POST /detect  multipart 上传视频（字段名 video），返回前端契约结构的结果

引擎选择（VIDEO_GENERAL_ENGINE）：
- auto（默认）：官方 Native-Scale 权重存在则用 Native-Scale，否则回退到本地训练的 ReStraV
- native-scale：仅用 Native-Scale，权重缺失即报错
- restrav：仅用 ReStraV
检测结果的 meta.method 会标明实际运行的引擎，前端“检测模型”字段据此显示。

环境变量：
- NATIVE_SCALE_DEVICE      推理设备，默认 cuda:0（无 GPU 时回退 CPU）
- NATIVE_SCALE_ARTIFACTS   模型目录（config.json、Qwen2.5-ViT_140k_224p_448p.pth、model.pt），默认 ./artifacts
- RESTRAV_DEVICE           ReStraV 回退引擎的设备，默认跟随 NATIVE_SCALE_DEVICE
- VIDEO_TORCH_THREADS      CPU线程数，默认4
"""

from __future__ import annotations

import logging
import os
import tempfile
import threading

import torch

torch.set_num_threads(int(os.environ.get("VIDEO_TORCH_THREADS", "4")))
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from native_scale_core import NativeScaleDetector
from restrav_core import ReStraVDetector

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("video-general-service")

ARTIFACTS_DIR = Path(os.environ.get("NATIVE_SCALE_ARTIFACTS", Path(__file__).parent / "artifacts"))
NATIVE_SCALE_CHECKPOINT = ARTIFACTS_DIR / "Qwen2.5-ViT_140k_224p_448p.pth"
RESTRAV_CHECKPOINT = ARTIFACTS_DIR / "model.pt"
ENGINE_PREFERENCE = os.environ.get("VIDEO_GENERAL_ENGINE", "auto").strip().lower()
ALLOWED_EXT = {".mp4", ".webm", ".mov", ".avi", ".mkv"}
MAX_BYTES = 500 * 1024 * 1024

detector: object | None = None
engine: str | None = None  # 'native-scale' | 'restrav'
detector_error: str | None = None
_init_lock = threading.Lock()
# GPU 推理串行化：线程池里并发跑多路推理既抢显存也无吞吐收益
_detect_lock = threading.Lock()


def detect_in_threadpool(det: object, path: str) -> dict:
    with _detect_lock:
        return det.detect(path)


def _choose_engine() -> str:
    """按环境变量与权重可用性决定引擎；auto 优先 Native-Scale 并回退 ReStraV。"""
    if ENGINE_PREFERENCE == "native-scale":
        return "native-scale"
    if ENGINE_PREFERENCE == "restrav":
        return "restrav"
    if NATIVE_SCALE_CHECKPOINT.is_file():
        return "native-scale"
    if RESTRAV_CHECKPOINT.is_file():
        log.warning(
            "未找到 Native-Scale 官方权重 %s，自动回退 ReStraV（%s）。"
            "如需 Native-Scale：从官方 448p 链接下载该文件放入 %s，重启服务即可自动切换。",
            NATIVE_SCALE_CHECKPOINT.name, RESTRAV_CHECKPOINT.name, ARTIFACTS_DIR,
        )
        return "restrav"
    return "native-scale"  # 两者都缺：按主引擎初始化，让 health 报出缺失原因


def load_detector() -> None:
    """启动时同步加载模型，失败不阻断进程、health 如实上报。"""
    global detector, engine, detector_error
    with _init_lock:
        if detector is not None:
            return
        engine = _choose_engine()
        try:
            if engine == "restrav":
                detector = ReStraVDetector(
                    ARTIFACTS_DIR, os.environ.get("RESTRAV_DEVICE") or os.environ.get("NATIVE_SCALE_DEVICE")
                )
            else:
                detector = NativeScaleDetector(ARTIFACTS_DIR, os.environ.get("NATIVE_SCALE_DEVICE"))
            log.info("检测器就绪：engine=%s device=%s artifacts=%s", engine, detector.device, ARTIFACTS_DIR)
        except Exception as exc:
            detector_error = str(exc)
            log.exception("检测器初始化失败：engine=%s", engine)


@asynccontextmanager
async def lifespan(_: FastAPI):
    load_detector()
    yield


app = FastAPI(title="VERITAS 视频检测 · 通用AI生成视频检测", version="1.1.0", lifespan=lifespan)
# Node 网关（127.0.0.1:4173）与本机调试页面都可能访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4173", "http://localhost:4173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_detector() -> object:
    if detector is None:
        load_detector()
        if detector is None:
            raise HTTPException(503, f"检测模型未就绪：{detector_error or '初始化失败'}")
    return detector


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok" if detector is not None else "degraded",
        "service": "video-general-detection",
        "engine": engine,
        "modelReady": detector is not None,
        "artifactsDir": str(ARTIFACTS_DIR),
        "nativeScaleCheckpoint": NATIVE_SCALE_CHECKPOINT.is_file(),
        "restravCheckpoint": RESTRAV_CHECKPOINT.is_file(),
        "error": detector_error,
    }


@app.post("/detect")
async def detect(video: UploadFile = File(...)) -> dict:
    suffix = Path(video.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXT:
        raise HTTPException(400, f"不支持的视频格式 {suffix or '(无后缀)'}，请上传 MP4/WebM。")
    try:
        get_detector()
    except Exception:
        raise HTTPException(503, "检测模型未就绪，请检查模型权重及运行依赖。")

    # 落盘后再交给 torchcodec 解码，避免大文件全量驻留内存
    with tempfile.NamedTemporaryFile(suffix=suffix, dir=os.environ.get("VIDEO_TMP", None)) as tmp:
        size = 0
        while chunk := await video.read(4 * 1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise HTTPException(413, "视频超过 500 MiB 限制。")
            tmp.write(chunk)
        tmp.flush()
        try:
            # 推理放线程池执行：async 处理器里同步推理会卡住事件循环，
            # 导致检测期间 /health 无响应、网关误报服务不可用（页面显示“未接入”）
            result = await run_in_threadpool(detect_in_threadpool, get_detector(), tmp.name)
        except ValueError as exc:
            raise HTTPException(422, str(exc))
        except Exception as exc:  # 解码器等底层错误
            log.exception("检测失败：%s", video.filename)
            raise HTTPException(500, f"检测处理失败：{str(exc)[:200]}")
    result["meta"]["filename"] = video.filename
    return result

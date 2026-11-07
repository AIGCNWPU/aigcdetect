"""VERITAS 音频伪造检测 HTTP 服务

启动：
    uvicorn server:app --host 0.0.0.0 --port 8000

接口：
    GET  /api/v1/health
    POST /api/v1/audio/forgery    {"sampleId": "wav1"} 或 {"audioBase64": "...", "fileName": "a.wav"}
"""
import base64
import binascii
import os
import tempfile
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from engine import Engine, MediaTooLong, MAX_MEDIA_SECONDS

MAX_BYTES = 80 * 1024 * 1024
SAMPLE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "samples")
ALLOWED_EXT = {
    # 音频
    ".wav", ".flac", ".mp3", ".m4a", ".ogg", ".opus",
    # 视频（服务端会先抽出音轨）
    ".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v", ".flv", ".ts",
}

engine = Engine()


@asynccontextmanager
async def lifespan(_: FastAPI):
    seconds = engine.load()
    print(f"[engine] loaded in {seconds}s on {engine.device}", flush=True)
    yield


app = FastAPI(title="VERITAS Audio Anti-Spoof API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ForgeryRequest(BaseModel):
    sampleId: str | None = None
    fileName: str | None = None
    audioBase64: str | None = None


def error(status: int, code: str, message: str, request_id: str):
    return JSONResponse(status_code=status,
                        content={"error": {"code": code, "message": message}, "requestId": request_id})


def resolve_audio(payload: ForgeryRequest, request_id: str):
    """返回 (临时文件路径, 是否需要清理, 原始文件名)。"""
    if payload.sampleId:
        safe = os.path.basename(payload.sampleId)
        path = os.path.join(SAMPLE_DIR, safe if safe.endswith(".wav") else f"{safe}.wav")
        if not os.path.isfile(path):
            raise FileNotFoundError(f"样例不存在: {payload.sampleId}")
        return path, False, os.path.basename(path)

    if payload.audioBase64:
        data = payload.audioBase64
        if "," in data[:100] and data.lstrip().startswith("data:"):
            data = data.split(",", 1)[1]
        try:
            raw = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("audioBase64 不是合法的 base64") from exc
        if len(raw) > MAX_BYTES:
            raise MemoryError(f"音频超过 {MAX_BYTES // (1024 * 1024)} MB 上限")
        name = payload.fileName or "upload.wav"
        ext = os.path.splitext(name)[1].lower()
        if ext not in ALLOWED_EXT:
            ext = ".wav"
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
        tmp.write(raw)
        tmp.close()
        return tmp.name, True, name

    raise ValueError("需要提供 sampleId 或 audioBase64")


@app.get("/api/v1/health")
def health():
    return {"status": "ok", "engine": "audio-antispoof", "version": "v1",
            "device": engine.device, "modelLoaded": engine.model is not None,
            "loadSeconds": getattr(engine, "load_seconds", None),
            "maxMediaSeconds": MAX_MEDIA_SECONDS,
            "maxUploadMB": MAX_BYTES // (1024 * 1024)}


@app.post("/api/v1/audio/forgery")
def audio_forgery(payload: ForgeryRequest):
    request_id = str(uuid.uuid4())
    temp_path, cleanup, name = None, False, None
    try:
        temp_path, cleanup, name = resolve_audio(payload, request_id)
    except FileNotFoundError as exc:
        return error(404, "SAMPLE_NOT_FOUND", str(exc), request_id)
    except MemoryError as exc:
        return error(413, "AUDIO_TOO_LARGE", str(exc), request_id)
    except ValueError as exc:
        return error(400, "BAD_REQUEST", str(exc), request_id)

    try:
        result = engine.infer_media(temp_path)
    except MediaTooLong as exc:          # 时长超限，快速失败
        return error(413, "MEDIA_TOO_LONG", str(exc), request_id)
    except ValueError as exc:            # 无音轨、容器损坏等可预期问题
        return error(422, "MEDIA_UNREADABLE", str(exc), request_id)
    except Exception as exc:             # 解码失败、推理异常统一暴露为可读错误
        return error(422, "AUDIO_UNREADABLE", f"{type(exc).__name__}: {exc}", request_id)
    finally:
        if cleanup and temp_path and os.path.exists(temp_path):
            os.remove(temp_path)

    data = {
        "fileName": name,
        "media": result.get("media", "audio"),
        "audioExtracted": result.get("audioExtracted", False),
        "audioDurationSec": result.get("audioDurationSec", result["durationSec"]),
        "containerDurationSec": result.get("containerDurationSec"),
        "verdict": "fake" if result["pFake"] >= 0.5 else "real",
        "pFake": result["pFake"],
        "realOrFake": result["realOrFake"],
        "spoofMethod": result["spoofMethod"],
        "spoofMethodLabel": result["spoofMethodLabel"],
        "fakeRegion": result["fakeRegion"],
        "semanticInfluence": result["semanticInfluence"],
        "durationSec": result["durationSec"],
        "coverage": result["coverage"],
        "windows": result["windows"],
        "latencyMs": result["latencyMs"],
        "raw": result["raw"],
        "engine": {"name": "audio-antispoof", "version": "v1", "threshold": 0.5},
    }
    return {"data": data, "requestId": request_id}


@app.exception_handler(Exception)
async def unhandled(_: Request, exc: Exception):
    return JSONResponse(status_code=500,
                        content={"error": {"code": "INTERNAL_ERROR", "message": str(exc)},
                                 "requestId": str(uuid.uuid4())})

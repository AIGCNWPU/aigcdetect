import base64, tempfile, threading
from contextlib import asynccontextmanager
import cv2, numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from engine import Engine
from faces import FaceDetector, crop_face

engine = None
lock = threading.Lock()


@asynccontextmanager
async def lifespan(app):
    global engine
    engine = Engine()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "ready": engine is not None,
        "model": "VLAForge",
        "device": "cpu",
        "parameters": engine.params if engine else None,
    }


def risk(score):
    return "high" if score >= 0.8 else "medium" if score >= 0.5 else "low"


def iou(a, b):
    x = max(a[0], b[0])
    y = max(a[1], b[1])
    r = min(a[0] + a[2], b[0] + b[2])
    bot = min(a[1] + a[3], b[1] + b[3])
    inter = max(0, r - x) * max(0, bot - y)
    return inter / max(1, a[2] * a[3] + b[2] * b[3] - inter)


def analyze(path):
    cap = cv2.VideoCapture(str(path))
    try:
        fps = cap.get(cv2.CAP_PROP_FPS)
        total = cap.get(cv2.CAP_PROP_FRAME_COUNT)
        duration = total / fps if fps > 0 else 0
        if not duration or duration > 120:
            raise ValueError("本地试运行仅支持不超过120秒的可解码视频")
        detector = FaceDetector()
        orientation = None
        oriented = False
        tracks = []
        previous = None
        count = 0
        faces = 0
        processed = 0
        for t in np.linspace(
            0, max(0, duration - 1 / fps), min(12, max(1, int(total)))
        ):
            cap.set(cv2.CAP_PROP_POS_MSEC, float(t) * 1000)
            ok, frame = cap.read()
            if not ok:
                continue
            count += 1
            if not oriented:
                orientation = detector.orient(frame)
                candidate = (
                    frame if orientation is None else cv2.rotate(frame, orientation)
                )
                oriented = bool(detector.detect(candidate))
            if orientation is not None:
                frame = cv2.rotate(frame, orientation)
            small = cv2.resize(frame, (320, 180))
            shot = previous is not None and np.mean(cv2.absdiff(small, previous)) > 45
            previous = small
            if shot:
                for tr in tracks:
                    tr["active"] = False
            boxes = detector.detect(frame)
            used = set()
            for box in sorted(boxes, key=lambda b: b[2] * b[3], reverse=True)[:3]:
                if processed >= 24:
                    break
                crop = crop_face(frame, box)
                if (
                    cv2.Laplacian(
                        cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY), cv2.CV_64F
                    ).var()
                    < 20
                ):
                    continue
                candidates = [
                    tr
                    for tr in tracks
                    if tr["active"]
                    and tr["id"] not in used
                    and t - tr["last"] <= duration / 11 * 1.5 + 1
                    and iou(tr["box"], box) > 0.3
                ]
                tr = (
                    max(candidates, key=lambda z: iou(z["box"], box))
                    if candidates
                    else None
                )
                if tr is None:
                    if len(tracks) >= 20:
                        continue
                    tr = {
                        "id": f"track-{len(tracks) + 1}",
                        "box": box,
                        "last": float(t),
                        "active": True,
                        "items": [],
                    }
                    tracks.append(tr)
                used.add(tr["id"])
                tr["box"] = box
                tr["last"] = float(t)
                score = engine.score(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
                processed += 1
                faces += 1
                _, jpeg = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, 80])
                tr["items"].append(
                    {
                        "id": f"face-{faces}",
                        "time": float(t),
                        "risk": risk(score),
                        "score": score,
                        "caption": f"VLAForge未校准伪造分数 {score:.3f}；仅对应此采样人脸",
                        "image": "data:image/jpeg;base64,"
                        + base64.b64encode(jpeg).decode(),
                    }
                )
        persons = []
        for tr in tracks:
            items = tr["items"]
            score = float(np.mean([f["score"] for f in items]))
            segments = []
            for f in items:
                if f["score"] >= 0.5:
                    end = min(duration, f["time"] + 1 / fps)
                    start = min(f["time"], end - 1 / fps)
                    segments.append(
                        {
                            "id": "seg-" + f["id"],
                            "start": max(0, start),
                            "end": end,
                            "risk": f["risk"],
                            "summary": "采样人脸分数偏高；此标记不表示前后未采样区间均被伪造。",
                            "frameId": f["id"],
                            "signals": [],
                        }
                    )
            persons.append(
                {
                    "id": tr["id"],
                    "label": f"人物轨迹 {len(persons) + 1}",
                    "risk": risk(score),
                    "coverage": "partial",
                    "summary": f"抽样人脸平均分 {score:.3f}。试运行阈值未经业务校准，不能作为真实性证明。",
                    "firstSeen": items[0]["time"],
                    "lastSeen": items[-1]["time"],
                    "faceFrames": len(items),
                    "findings": ["仅作镜头内位置关联；跨镜头身份及遮挡恢复未验证。"],
                    "frames": items,
                    "segments": segments,
                }
            )
        levels = {"low": 1, "medium": 2, "high": 3}
        overall = max(
            (p["risk"] for p in persons), key=lambda r: levels[r], default="unknown"
        )
        return {
            "risk": overall,
            "summary": "VLAForge本地CPU试运行；结果仅供复核，未做独立准确率验证。"
            if persons
            else "未找到足够清晰的正面人脸，无法判断。",
            "coverage": "partial",
            "scope": f"全片均匀读取{count}帧，实际分析{faces}张人脸；最多12个采样位置/24张人脸，非逐帧检测。",
            "duration": duration,
            "sampledFrames": count,
            "faceFrames": faces,
            "findings": [
                "模型已加载官方权重；0.5/0.8为试运行分档阈值，未校准。",
                "YuNet整脸与五官结构检查；侧脸、遮挡和小脸仍可能漏检。",
            ],
            "persons": persons,
            "meta": {"model": "VLAForge", "parameters": engine.params, "device": "cpu"},
        }
    finally:
        cap.release()


@app.post("/detect")
def detect(video: UploadFile = File(...)):
    if not lock.acquire(False):
        raise HTTPException(429, "CPU正在检测另一任务，请稍后再试")
    try:
        with tempfile.NamedTemporaryFile(suffix=".mp4") as f:
            size = 0
            while chunk := video.file.read(1024 * 1024):
                size += len(chunk)
                if size > 100 * 1024 * 1024:
                    raise HTTPException(413, "本地试运行视频不能超过100MiB")
                f.write(chunk)
            f.flush()
            try:
                return {"data": analyze(f.name)}
            except ValueError as e:
                raise HTTPException(422, str(e))
    finally:
        lock.release()

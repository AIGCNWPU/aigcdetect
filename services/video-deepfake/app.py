import base64, logging, tempfile, threading
from contextlib import asynccontextmanager
import cv2, numpy as np
from fastapi import FastAPI, UploadFile, File, HTTPException
from engine import Engine
from faces import FaceDetector, crop_face
from metadata_scan import scan_video_metadata
from vision_review import (
    explain_segments,
    load_config as load_review_config,
    review_result,
    scan_visual_marker,
)

log = logging.getLogger("video-deepfake")
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
    review = load_review_config()
    return {
        "ready": engine is not None,
        "model": "智鉴",
        "device": str(engine.device) if engine else None,
        "parameters": engine.params if engine else None,
        "visionReview": {
            "enabled": bool(review.get("api_key")) and review.get("mode") != "off",
            "mode": review.get("mode"),
            "model": review.get("model") if review.get("api_key") else None,
        },
    }


def risk(score):
    return "high" if score >= 0.8 else "medium" if score >= 0.5 else "low"


RISK_LEVELS = {"low": 1, "medium": 2, "high": 3}
RISK_LABELS = {"low": "低风险", "medium": "中风险", "high": "高风险"}


def summarize(persons, face_count):
    if not persons:
        return "未找到足够清晰的正面人脸，无法判断。"
    segments = [
        (person, segment)
        for person in persons
        for segment in person.get("segments") or []
    ]
    if not segments:
        return (
            f"共识别{len(persons)}位人物、{face_count}张人脸画面；"
            "本次检测未发现可定位的可疑时间段。"
            "结果仅覆盖已分析的人脸画面，未覆盖部分不代表安全，仅供参考。"
        )
    top_person, top_segment = max(
        segments,
        key=lambda item: (
            RISK_LEVELS.get(item[1]["risk"], 0),
            -float(item[1]["start"]),
        ),
    )
    signals = "、".join((top_segment.get("signals") or [])[:2])
    clue = f"（{signals}）" if signals else ""
    risk_label = RISK_LABELS.get(top_segment["risk"], "可疑")
    return (
        f"共识别{len(persons)}位人物、{len(segments)}个可疑时间段；"
        f"{top_person['label']} 在{float(top_segment['start']):.1f}–"
        f"{float(top_segment['end']):.1f}秒出现{risk_label}线索{clue}。"
        "结果仅供复核，未做独立准确率验证。"
    )


def iou(a, b):
    x = max(a[0], b[0])
    y = max(a[1], b[1])
    r = min(a[0] + a[2], b[0] + b[2])
    bot = min(a[1] + a[3], b[1] + b[3])
    inter = max(0, r - x) * max(0, bot - y)
    return inter / max(1, a[2] * a[3] + b[2] * b[3] - inter)


def metadata_payload(marker):
    return {
        "detected": True,
        "source": str(marker.get("source") or "")[:200],
        "value": str(marker.get("value") or "")[:500],
        "markers": [str(item)[:100] for item in (marker.get("markers") or [])][:10],
    }


def metadata_finding(marker):
    source = str(marker.get("source") or "").strip()
    value = str(marker.get("value") or "").strip()
    parts = ["文件元数据包含AI生成标识"]
    if source:
        parts.append(f"来源：{source}")
    if value:
        parts.append(f"内容：{value}")
    return "；".join(parts)[:500]


def visual_marker_payload(marker):
    return {
        "detected": True,
        "time": round(float(marker.get("time") or 0.0), 3),
        "text": str(marker.get("text") or "")[:200],
        "location": str(marker.get("location") or "")[:100],
        "confidence": round(float(marker.get("confidence") or 0.0), 3),
    }


def visual_marker_finding(marker):
    time_value = float(marker.get("time") or 0.0)
    text = str(marker.get("text") or "").strip()
    location = str(marker.get("location") or "").strip()
    confidence = float(marker.get("confidence") or 0.0)
    parts = [f"画面在{time_value:.1f}秒出现AI生成标识"]
    if text:
        parts.append(f"「{text}」")
    if location:
        parts.append(f"位置：{location}")
    if confidence > 0:
        parts.append(f"置信度 {confidence * 100:.0f}%")
    return "；".join(parts)[:500]


def visual_marker_summary(marker, persons, base_summary):
    time_value = float(marker.get("time") or 0.0)
    text = str(marker.get("text") or "").strip()
    label = f"「{text}」" if text else ""
    prefix = f"画面在{time_value:.1f}秒出现AI生成标识{label}，已直接判定为AI生成。"
    if persons:
        return prefix + " " + base_summary
    return prefix + "模型检测未识别到可用于分析的人脸画面。"


def analyze(path):
    metadata_scan = scan_video_metadata(path)
    marker = metadata_scan if metadata_scan.get("detected") else None
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
        visual_frames = []
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
            if len(visual_frames) < 12:
                height, width = frame.shape[:2]
                thumb = frame
                if width > 800:
                    scale = 800.0 / width
                    thumb = cv2.resize(
                        frame, (800, max(1, round(height * scale)))
                    )
                okj, jpeg = cv2.imencode(
                    ".jpg", thumb, [cv2.IMWRITE_JPEG_QUALITY, 85]
                )
                if okj:
                    visual_frames.append(
                        {
                            "id": f"visual-{count}",
                            "time": float(t),
                            "image": "data:image/jpeg;base64,"
                            + base64.b64encode(jpeg).decode(),
                        }
                    )
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
                        "caption": f"智鉴未校准伪造分数 {score:.3f}；仅对应该张人脸画面",
                        "image": "data:image/jpeg;base64,"
                        + base64.b64encode(jpeg).decode(),
                    }
                )
        persons = []
        person_scores = []
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
                            "summary": "该人脸画面被标记为可疑，建议结合代表画面核查面部边缘、纹理与光影是否连续；此标记不表示前后未覆盖区间均被伪造。",
                            "frameId": f["id"],
                            "signals": [],
                        }
                    )
            person_scores.append(score)
            persons.append(
                {
                    "id": tr["id"],
                    "label": f"人物轨迹 {len(persons) + 1}",
                    "risk": risk(score),
                    "coverage": "partial",
                    "summary": f"该人物已分析人脸的平均伪造分数 {score:.3f}。试运行阈值未经业务校准，不能作为真实性证明。",
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
        base_summary = summarize(persons, faces)
        if marker:
            if persons:
                summary = "文件元数据包含AI生成标识，已直接判定为AI生成。 " + base_summary
            else:
                summary = "文件元数据包含AI生成标识，已直接判定为AI生成。模型检测未识别到可用于分析的人脸画面。"
        else:
            summary = base_summary
        result = {
            "risk": "high" if marker else overall,
            "aiProbability": 1.0
            if marker
            else (round(max(person_scores), 3) if person_scores else None),
            "summary": summary,
            "coverage": "partial",
            "scope": f"全片均匀读取{count}帧，实际分析{faces}张人脸；最多12个检测位置/24张人脸，非逐帧检测。",
            "duration": duration,
            "sampledFrames": count,
            "faceFrames": faces,
            "findings": [],
            "persons": persons,
            "meta": {
                "model": "智鉴",
                "parameters": engine.params,
                "device": str(engine.device),
                "notes": [
                    "模型已加载官方权重；0.5/0.8为试运行分档阈值，未校准。",
                    "YuNet整脸与五官结构检查；侧脸、遮挡和小脸仍可能漏检。",
                ],
                "metadataScan": {
                    "status": metadata_scan.get("status", "ok"),
                    "detected": bool(marker),
                    "source": (marker or {}).get("source", ""),
                    "value": (marker or {}).get("value", ""),
                    "markers": (marker or {}).get("markers", []),
                    "fields": metadata_scan.get("fields", 0),
                    "error": metadata_scan.get("error", ""),
                },
            },
        }
        visual_marker = None
        visual_scan = {
            "status": "skipped",
            "detected": False,
            "reason": "metadata_marker",
        }
        if marker:
            result["aiGeneratedMarker"] = metadata_payload(marker)
            result["meta"]["review"] = {"status": "skipped", "reason": "metadata_marker"}
        else:
            try:
                visual_scan = scan_visual_marker(visual_frames)
            except Exception:
                log.exception("画面标识检查异常，保留本地检测结果")
                visual_scan = {"status": "error", "detected": False}
            if visual_scan.get("detected"):
                visual_marker = visual_scan
                result["visualAiMarker"] = visual_marker_payload(visual_marker)
                result["risk"] = "high"
                result["aiProbability"] = 0.99
                result["summary"] = visual_marker_summary(
                    visual_marker, persons, base_summary
                )
                result["meta"]["review"] = {"status": "skipped", "reason": "visual_marker"}
            else:
                try:
                    result = review_result(result)
                except Exception:
                    log.exception("视觉复核异常，保留本地检测结果")
        result["meta"]["visualMarker"] = {
            "status": visual_scan.get("status", "ok"),
            "detected": bool(visual_marker),
            "reason": visual_scan.get("reason", ""),
            "requested": visual_scan.get("requested", 0),
            "succeeded": visual_scan.get("succeeded", 0),
            "failed": visual_scan.get("failed", 0),
            "confidence": visual_scan.get("confidence", 0),
            "time": visual_scan.get("time"),
            "text": visual_scan.get("text", ""),
            "location": visual_scan.get("location", ""),
            "error": visual_scan.get("error", ""),
        }
        try:
            result = explain_segments(result)
        except Exception:
            log.exception("视觉解释异常，保留原检测结果")
        forced_findings = []
        if marker:
            forced_findings.append(metadata_finding(marker))
        if visual_marker:
            forced_findings.append(visual_marker_finding(visual_marker))
        if forced_findings:
            existing = [
                item
                for item in result.get("findings") or []
                if item not in forced_findings
            ]
            result["findings"] = (forced_findings + existing)[:12]
            result["risk"] = "high"
            result["aiProbability"] = 1.0 if marker else 0.99
        return result
    finally:
        cap.release()


@app.post("/detect")
def detect(video: UploadFile = File(...)):
    if not lock.acquire(False):
        raise HTTPException(429, "检测服务正在处理另一任务，请稍后再试")
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

"""本地检测后的 DeepSeek 视觉复核：补充本地模型可能漏掉的换脸/合成线索。

复核只用于“升级”结论：本地判为低风险时，若视觉模型给出更高风险，则提升
对应人脸、人物和整片风险，并补充线索；不会把已有的中/高风险降为低风险。
未配置 Key、复核超时或返回异常时，检测结果保持原样，不阻断检测。
"""
from __future__ import annotations

import json
import logging
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger("video-deepfake.review")

ENV_FILE = Path(__file__).with_name(".env")
DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
DEFAULT_MODE = "low"
DEFAULT_TIMEOUT = 25.0
DEFAULT_MAX_FRAMES = 4
DEFAULT_WORKERS = 4
DEFAULT_MEDIUM_THRESHOLD = 0.5
DEFAULT_HIGH_THRESHOLD = 0.8
MAX_SIGNALS = 3
MAX_SIGNAL_CHARS = 80

RISK_LEVELS = {"unknown": 0, "low": 1, "medium": 2, "high": 3}
RISK_LABELS = {1: "low", 2: "medium", 3: "high"}
VERDICT_LABELS = {
    "fake": "疑似AI生成",
    "uncertain": "存在不确定的合成线索",
    "real": "未发现明显伪造痕迹",
}

SYSTEM_PROMPT = (
    "你是人脸深度伪造鉴证助手。只根据这张人脸裁剪图判断是否存在换脸或面部合成痕迹。"
    "只输出一个JSON对象，不要Markdown、不要额外文字。格式："
    '{"fake_probability": 0到1之间的小数, "verdict": "fake"|"uncertain"|"real", '
    '"signals": ["最多3条简短中文依据"]}。'
    "没有明显痕迹时概率接近0；存在边缘融合、纹理重复、光影或人体结构异常时给出较高概率；"
    "画面模糊、过暗或遮挡导致无法判断时给中间值。不要复述检测分数，不要编造画面中不存在的内容。"
)


def load_config() -> dict[str, Any]:
    """读取环境变量与 .env；环境变量优先，每次检测重新读取。"""
    file_values = _read_env_file()

    def get(name: str, default: str = "") -> str:
        return (os.environ.get(name) or file_values.get(name) or default).strip()

    def get_int(name: str, default: int, lower: int, upper: int) -> int:
        try:
            return max(lower, min(upper, int(get(name, str(default)))))
        except ValueError:
            return default

    def get_float(name: str, default: float, lower: float, upper: float) -> float:
        try:
            return max(lower, min(upper, float(get(name, str(default)))))
        except ValueError:
            return default

    mode = get("DEEPSEEK_REVIEW_MODE", DEFAULT_MODE).lower()
    if mode not in {"off", "low", "always"}:
        mode = DEFAULT_MODE
    try:
        timeout = float(get("DEEPSEEK_TIMEOUT", str(DEFAULT_TIMEOUT)))
    except ValueError:
        timeout = DEFAULT_TIMEOUT
    medium = get_float(
        "DEEPSEEK_MEDIUM_THRESHOLD", DEFAULT_MEDIUM_THRESHOLD, 0.05, 0.95
    )
    high = get_float(
        "DEEPSEEK_HIGH_THRESHOLD", DEFAULT_HIGH_THRESHOLD, medium, 1.0
    )
    return {
        "api_key": get("DEEPSEEK_API_KEY"),
        "base_url": get("DEEPSEEK_BASE_URL", DEFAULT_BASE_URL).rstrip("/"),
        "model": get("DEEPSEEK_VISION_MODEL", DEFAULT_MODEL),
        "mode": mode,
        "timeout": max(5.0, timeout),
        "max_frames": get_int("DEEPSEEK_MAX_FRAMES", DEFAULT_MAX_FRAMES, 1, 6),
        "workers": get_int("DEEPSEEK_WORKERS", DEFAULT_WORKERS, 1, 8),
        "medium_threshold": medium,
        "high_threshold": high,
    }


def _read_env_file() -> dict[str, str]:
    path = Path(os.environ.get("DEEPSEEK_ENV_FILE") or ENV_FILE)
    values: dict[str, str] = {}
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return values
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key.startswith("DEEPSEEK_"):
            values[key] = value
    return values


def review_result(result: dict[str, Any], config: dict[str, Any] | None = None) -> dict[str, Any]:
    """在本地结果上叠加视觉复核；任何异常都回退到原结果。"""
    if not isinstance(result, dict):
        return result
    meta = result.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        result["meta"] = meta

    persons = [item for item in (result.get("persons") or []) if isinstance(item, dict)]
    cfg = config or load_config()
    existing = meta.get("review")
    if isinstance(existing, dict) and existing.get("status") in {"ok", "partial"}:
        return result
    if cfg["mode"] == "off":
        meta["review"] = _status(cfg, "disabled")
        return result
    if not cfg.get("api_key"):
        meta["review"] = _status(cfg, "not_configured")
        return result
    if cfg["mode"] == "low" and str(result.get("risk") or "unknown") != "low":
        meta["review"] = _status(cfg, "skipped", reason="local_risk_not_low")
        return result

    frames = _select_frames(persons, int(cfg["max_frames"]))
    if not frames:
        meta["review"] = _status(cfg, "skipped", reason="no_frames")
        return result

    started = time.perf_counter()
    reviews: dict[str, dict[str, Any]] = {}
    errors: list[str] = []
    workers = min(int(cfg["workers"]), len(frames))
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        futures = {pool.submit(_review_frame, cfg, frame): frame for frame in frames}
        for future in as_completed(futures):
            frame = futures[future]
            try:
                reviews[str(frame.get("id"))] = future.result()
            except Exception as exc:  # 单张失败不影响其余帧
                message = _safe_error(exc)
                errors.append(message)
                log.warning("视觉复核失败 frame=%s：%s", frame.get("id"), message)

    elapsed_ms = round((time.perf_counter() - started) * 1000)
    if not reviews:
        meta["review"] = _status(
            cfg,
            "failed",
            requested=len(frames),
            succeeded=0,
            failed=len(frames),
            durationMs=elapsed_ms,
            error=errors[0] if errors else "",
        )
        result["summary"] = _append_text(
            result.get("summary"), "视觉复核未完成，本次结论仅基于本地检测。", 4000
        )
        findings = _strings(result.get("findings"))
        result["findings"] = (findings + ["视觉复核未完成，本次结论仅基于本地检测。"])[:12]
        return result

    flagged, escalated = _merge_reviews(result, persons, reviews, cfg)
    failed = len(frames) - len(reviews)
    if failed:
        result["summary"] = _append_text(
            result.get("summary"),
            f"另有 {failed} 张代表画面复核未完成。",
            4000,
        )
    status = "ok" if not failed else "partial"
    meta["review"] = _status(
        cfg,
        status,
        requested=len(frames),
        succeeded=len(reviews),
        failed=failed,
        flagged=flagged,
        escalated=escalated,
        durationMs=elapsed_ms,
        error=errors[0] if errors else "",
    )
    return result


def _status(cfg: dict[str, Any], status: str, **extra: Any) -> dict[str, Any]:
    payload = {
        "status": status,
        "mode": cfg.get("mode"),
        "model": cfg.get("model"),
    }
    payload.update(extra)
    return payload


def _merge_reviews(
    result: dict[str, Any],
    persons: list[dict[str, Any]],
    reviews: dict[str, dict[str, Any]],
    cfg: dict[str, Any],
) -> tuple[int, int]:
    flagged: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    escalated = 0
    reviewed = len(reviews)

    for person in persons:
        person_flags: list[tuple[dict[str, Any], dict[str, Any], str]] = []
        for frame in person.get("frames") or []:
            if not isinstance(frame, dict):
                continue
            review = reviews.get(str(frame.get("id")))
            if not review:
                continue
            frame["review"] = {
                "probability": review["probability"],
                "verdict": review["verdict"],
                "signals": review["signals"],
            }
            review_risk = _risk_for(review, cfg)
            if RISK_LEVELS[review_risk] <= RISK_LEVELS["low"]:
                continue
            local_risk = str(frame.get("risk") or "low")
            if RISK_LEVELS[review_risk] > RISK_LEVELS.get(local_risk, 0):
                frame["risk"] = review_risk
                escalated += 1
            frame["caption"] = _append_text(
                frame.get("caption"), _frame_note(review), 500, sep="；"
            )
            person_flags.append((frame, review, review_risk))
            flagged.append((person, frame, review))

        if not person_flags:
            continue
        _upsert_segments(person, person_flags, result.get("duration"))
        review_level = max(RISK_LEVELS[risk] for _, _, risk in person_flags)
        if review_level > RISK_LEVELS.get(str(person.get("risk") or "low"), 0):
            person["risk"] = RISK_LABELS[review_level]
        person["summary"] = _append_text(
            person.get("summary"),
            f"视觉复核提示 {_frame_time(person_flags[0][0])} 附近存在可疑线索。",
            2000,
        )
        lines = [_finding_line(frame, review)[:300] for frame, review, _ in person_flags[:3]]
        person["findings"] = (lines + _strings(person.get("findings")))[:8]

    if not flagged:
        result["summary"] = _append_text(
            result.get("summary"),
            f"视觉模型复核 {reviewed} 张代表画面，未发现额外可疑线索。",
            4000,
        )
        return 0, 0

    overall_level = max(
        [RISK_LEVELS.get(str(person.get("risk") or "low"), 0) for person in persons] or [0]
    )
    result["risk"] = RISK_LABELS.get(overall_level, "unknown")
    max_probability = max(review["probability"] for _, _, review in flagged)
    result["aiProbability"] = round(
        max(float(result.get("aiProbability") or 0.0), max_probability), 3
    )
    result["summary"] = _append_text(
        result.get("summary"),
        f"视觉模型复核 {reviewed} 张代表画面，其中 {len(flagged)} 张存在可疑线索。",
        4000,
    )
    lines = [_finding_line(frame, review) for _, frame, review in flagged[:6]]
    result["findings"] = (lines + _strings(result.get("findings")))[:12]
    return len(flagged), escalated


def _select_frames(persons: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    if limit <= 0:
        return []
    all_frames: list[dict[str, Any]] = []
    for person in persons:
        for frame in person.get("frames") or []:
            if _valid_frame(frame):
                all_frames.append(frame)
    if not all_frames:
        return []

    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    tops: list[tuple[float, dict[str, Any]]] = []
    for person in persons:
        frames = [frame for frame in person.get("frames") or [] if _valid_frame(frame)]
        if not frames:
            continue
        top = max(frames, key=lambda item: _float(item.get("score")))
        tops.append((_float(top.get("score")), top))
    tops.sort(key=lambda item: item[0], reverse=True)
    for _, frame in tops:
        if len(selected) >= limit:
            break
        if str(frame["id"]) not in selected_ids:
            selected.append(frame)
            selected_ids.add(str(frame["id"]))

    remaining = sorted(
        [frame for frame in all_frames if str(frame.get("id")) not in selected_ids],
        key=lambda item: _float(item.get("time")),
    )
    need = limit - len(selected)
    if need > 0 and remaining:
        if need == 1:
            picks = [remaining[len(remaining) // 2]]
        else:
            indexes = sorted(
                {
                    round(index * (len(remaining) - 1) / (need - 1))
                    for index in range(need)
                }
            )
            picks = [remaining[index] for index in indexes]
        for frame in picks:
            if str(frame.get("id")) not in selected_ids:
                selected.append(frame)
                selected_ids.add(str(frame.get("id")))
    return sorted(selected, key=lambda item: _float(item.get("time")))


def _valid_frame(frame: Any) -> bool:
    return (
        isinstance(frame, dict)
        and isinstance(frame.get("image"), str)
        and frame["image"].startswith("data:image/")
        and isinstance(frame.get("time"), (int, float))
        and frame.get("id") is not None
    )


def _review_frame(cfg: dict[str, Any], frame: dict[str, Any]) -> dict[str, Any]:
    body = _post_completion(cfg, _build_messages(frame))
    try:
        content = body["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise RuntimeError("视觉模型返回格式异常") from exc
    data = _parse_payload(content)
    try:
        probability = _to_probability(data.get("fake_probability"))
    except (TypeError, ValueError) as exc:
        raise RuntimeError("视觉模型未返回有效概率") from exc
    verdict = _normalize_verdict(data.get("verdict"), probability, cfg)
    signals = _normalize_signals(data.get("signals"))
    return {"probability": probability, "verdict": verdict, "signals": signals}


def _build_messages(frame: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        f"这张人脸裁剪图来自视频 {_frame_time(frame)} 处的采样帧。"
                        "请判断它是否存在换脸或AI生成痕迹。"
                    ),
                },
                {"type": "image_url", "image_url": {"url": frame["image"], "detail": "high"}},
            ],
        },
    ]


def _post_completion(cfg: dict[str, Any], messages: list[dict[str, Any]]) -> dict[str, Any]:
    payload = {
        "model": cfg["model"],
        "messages": messages,
        "temperature": 0,
        "max_tokens": 1200,
    }
    response = None
    for attempt in range(2):
        response = requests.post(
            f"{cfg['base_url']}/chat/completions",
            headers={
                "Authorization": f"Bearer {cfg['api_key']}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=(5, float(cfg["timeout"])),
        )
        if response.status_code != 429 and response.status_code < 500:
            break
        if attempt == 0:
            delay = _retry_delay(response)
            log.warning("视觉复核临时失败 HTTP %s，%.1f 秒后重试", response.status_code, delay)
            time.sleep(delay)
    if response is None:
        raise RuntimeError("视觉复核请求未发送")
    if response.status_code == 401:
        raise RuntimeError("视觉复核鉴权失败，请检查 API Key")
    if response.status_code == 429:
        raise RuntimeError("视觉复核接口限流，请稍后重试")
    response.raise_for_status()
    return response.json()


def _retry_delay(response: Any) -> float:
    try:
        retry_after = float(response.headers.get("Retry-After", ""))
    except (AttributeError, TypeError, ValueError):
        retry_after = 0.0
    return min(5.0, retry_after) if retry_after > 0 else 1.5


def _parse_payload(content: Any) -> dict[str, Any]:
    if isinstance(content, list):
        content = "".join(
            str(part.get("text", "")) for part in content if isinstance(part, dict)
        )
    text = str(content or "").strip()
    if not text:
        raise RuntimeError("视觉模型返回空内容")
    text = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).replace("```", "")
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end <= start:
        raise RuntimeError("视觉模型未返回JSON")
    try:
        data = json.loads(text[start : end + 1])
    except json.JSONDecodeError as exc:
        raise RuntimeError("视觉模型返回的JSON无法解析") from exc
    if not isinstance(data, dict):
        raise RuntimeError("视觉模型返回格式异常")
    return data


def _to_probability(value: Any) -> float:
    if isinstance(value, bool):
        raise TypeError("布尔值不是有效概率")
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str):
        text = value.strip()
        is_percent = text.endswith("%")
        text = text.rstrip("%").strip()
        number = float(text)
        if is_percent or number > 1:
            number /= 100
    else:
        raise TypeError("缺少概率字段")
    if not math.isfinite(number):
        raise ValueError("概率不是有限数值")
    return min(1.0, max(0.0, number))


def _normalize_verdict(value: Any, probability: float, cfg: dict[str, Any]) -> str:
    text = str(value or "").strip().lower()
    if text in VERDICT_LABELS:
        return text
    if probability >= float(cfg["high_threshold"]):
        return "fake"
    if probability >= float(cfg["medium_threshold"]):
        return "uncertain"
    return "real"


def _normalize_signals(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    signals = []
    for item in value:
        text = re.sub(r"\s+", " ", str(item or "")).strip()
        if text:
            signals.append(text[:MAX_SIGNAL_CHARS])
        if len(signals) >= MAX_SIGNALS:
            break
    return signals


def _risk_for(review: dict[str, Any], cfg: dict[str, Any]) -> str:
    if review["verdict"] == "real":
        return "low"
    probability = float(review["probability"])
    if probability >= float(cfg["high_threshold"]):
        return "high"
    if probability >= float(cfg["medium_threshold"]):
        return "medium"
    return "low"


def _upsert_segments(
    person: dict[str, Any],
    flags: list[tuple[dict[str, Any], dict[str, Any], str]],
    duration: Any,
) -> None:
    segments = person.setdefault("segments", [])
    for frame, review, review_risk in flags:
        frame_id = str(frame.get("id"))
        existing = next(
            (
                segment
                for segment in segments
                if isinstance(segment, dict) and segment.get("frameId") == frame_id
            ),
            None,
        )
        note = _segment_note(review)
        signals = [str(item) for item in review.get("signals") or []][:8]
        if existing:
            if RISK_LEVELS[review_risk] > RISK_LEVELS.get(
                str(existing.get("risk") or "low"), 0
            ):
                existing["risk"] = review_risk
            existing["summary"] = _append_text(existing.get("summary"), note, 2000)
            combined = _strings(existing.get("signals")) + signals
            existing["signals"] = list(dict.fromkeys(combined))[:8]
            continue
        start, end = _segment_bounds(frame, duration)
        segments.append(
            {
                "id": f"seg-review-{frame_id}",
                "start": start,
                "end": end,
                "risk": review_risk,
                "summary": note[:2000],
                "frameId": frame_id,
                "signals": signals,
            }
        )


def _segment_bounds(frame: dict[str, Any], duration: Any) -> tuple[float, float]:
    try:
        total = float(duration)
    except (TypeError, ValueError):
        total = 0.0
    time_value = _float(frame.get("time"))
    half = 0.5
    start = max(0.0, time_value - half)
    end = min(total, time_value + half) if total > 0 else time_value + half
    if end <= start:
        start = max(0.0, min(time_value, max(0.0, total - 0.1)))
        end = min(total, start + 0.1) if total > 0 else start + 0.1
    if end <= start:
        end = start + 0.1
    return round(start, 3), round(end, 3)


def _frame_note(review: dict[str, Any]) -> str:
    probability = float(review["probability"]) * 100
    return f"视觉复核概率 {probability:.0f}%（{VERDICT_LABELS[review['verdict']]}）"


def _segment_note(review: dict[str, Any]) -> str:
    probability = float(review["probability"]) * 100
    label = VERDICT_LABELS[review["verdict"]]
    signals = "、".join(review.get("signals") or [])
    text = f"视觉复核在该采样人脸提示{label}（概率 {probability:.0f}%）。"
    if signals:
        text += f"线索：{signals}。"
    return text + "此标记不表示前后未采样区间均被伪造。"


def _finding_line(frame: dict[str, Any], review: dict[str, Any]) -> str:
    probability = float(review["probability"]) * 100
    label = VERDICT_LABELS[review["verdict"]]
    signals = "、".join((review.get("signals") or [])[:2])
    line = f"视觉复核：{_frame_time(frame)} 的人脸画面{label}（概率 {probability:.0f}%）"
    if signals:
        line += f"；{signals}"
    return line[:500]


def _frame_time(frame: dict[str, Any]) -> str:
    return f"{_float(frame.get('time')):.1f}s"


def _append_text(existing: Any, addition: Any, limit: int, sep: str = " ") -> str:
    base = str(existing or "").strip()
    extra = str(addition or "").strip()
    if not extra:
        return base[:limit]
    text = f"{base}{sep}{extra}" if base else extra
    return text[:limit]


def _strings(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if isinstance(item, str) and item.strip()]


def _float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _safe_error(exc: Exception) -> str:
    text = re.sub(r"Bearer\s+\S+", "Bearer ***", str(exc))
    return text[:200]

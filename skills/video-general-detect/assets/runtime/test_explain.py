"""DeepSeek 视觉复核的离线单元测试（不发起真实网络请求）。"""
from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

import explain

CFG = {
    "api_key": "test-key",
    "base_url": "http://mock.local",
    "model": "deepseek-flash",
    "timeout": 5,
    "max_segments": 12,
    "max_frames": 4,
    "workers": 4,
}
EXPLANATION = "人物手指与杯壁交界处边缘发虚，局部纹理重复，建议人工复核。"
CLEAN_EXPLANATION = "人物手指与杯壁交界处边缘发虚，局部纹理重复。"


class FakeResponse:
    def __init__(self, status_code: int = 200, content: str = EXPLANATION, headers: dict | None = None):
        self.status_code = status_code
        self._content = content
        self.headers = headers or {}

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self) -> dict:
        return {"choices": [{"message": {"content": self._content}}]}


def make_segment(index: int, score: float, risk: str = "medium") -> dict:
    return {
        "id": f"segment-{index}",
        "start": index * 10.0,
        "end": index * 10.0 + 2.0,
        "risk": risk,
        "score": score,
        "summary": f"第{index}窗口的视觉检测得分达到提示阈值，AI生成模型得分 {score * 100:.0f}%。",
        "frameId": f"frame-{index}",
    }


def make_frame(index: int, risk: str = "medium", time: float | None = None) -> dict:
    return {
        "id": f"frame-{index}",
        "time": index * 10.0 + 1.0 if time is None else time,
        "risk": risk,
        "caption": f"第{index}个采样窗口中帧",
        "image": "data:image/jpeg;base64,AAAA",
    }


def make_result() -> dict:
    return {
        "risk": "medium",
        "summary": "检测结论",
        "coverage": "partial",
        "scope": "仅覆盖采样窗口",
        "duration": 100,
        "sampledFrames": 48,
        "findings": ["采样窗口模型得分均值 40%，最大 67%。"],
        "segments": [make_segment(5, 0.67), make_segment(2, 0.20, "low")],
        "frames": [make_frame(5), make_frame(2, "low")],
        "meta": {},
    }


class ExplainTests(unittest.TestCase):
    def test_without_key_keeps_result_unchanged(self) -> None:
        result = make_result()
        output = explain.explain_result(copy.deepcopy(result), {**CFG, "api_key": ""})
        self.assertEqual(output["meta"]["explanation"]["status"], "not_configured")
        self.assertNotIn("explanation", output["segments"][0])
        self.assertEqual(output["findings"], result["findings"])

    @patch("explain.requests.post", return_value=FakeResponse())
    def test_success_adds_segment_explanation_and_finding(self, post) -> None:
        output = explain.explain_result(make_result(), CFG)
        segment = output["segments"][0]
        self.assertEqual(segment["explanation"], CLEAN_EXPLANATION)
        self.assertEqual(output["meta"]["explanation"]["status"], "ok")
        self.assertEqual(output["meta"]["explanation"]["requested"], 1)
        self.assertEqual(output["meta"]["explanation"]["succeeded"], 1)
        self.assertEqual(output["findings"], ["50.0s–52.0s：" + CLEAN_EXPLANATION])
        self.assertNotIn("采样窗口模型得分均值 40%，最大 67%。", output["findings"])
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["model"], "deepseek-flash")
        self.assertEqual(payload["max_tokens"], 1500)
        content = payload["messages"][1]["content"]
        self.assertTrue(any(block["type"] == "image_url" for block in content))
        self.assertIsInstance(payload["messages"][0]["content"], str)

    @patch("explain.requests.post", return_value=FakeResponse(content="画面边缘出现明显异常，" + "纹理重复" * 40))
    def test_long_explanation_is_shortened(self, _post) -> None:
        output = explain.explain_result(make_result(), CFG)
        text = output["segments"][0]["explanation"]
        self.assertLessEqual(len(text), 90)
        self.assertTrue(text.endswith("。"))

    @patch("explain.requests.post", return_value=FakeResponse(content="未见明显异常，建议人工复核。"))
    def test_no_anomaly_stays_concise(self, _post) -> None:
        output = explain.explain_result(make_result(), CFG)
        self.assertEqual(output["segments"][0]["explanation"], "未见明显异常。")

    @patch("explain.requests.post", side_effect=RuntimeError("connection failed"))
    def test_failure_keeps_original_result(self, _post) -> None:
        output = explain.explain_result(make_result(), CFG)
        self.assertEqual(output["meta"]["explanation"]["status"], "failed")
        self.assertNotIn("explanation", output["segments"][0])
        self.assertEqual(output["segments"][0]["summary"], make_result()["segments"][0]["summary"])

    @patch("explain.requests.post", return_value=FakeResponse())
    def test_explains_every_suspicious_segment_by_default(self, post) -> None:
        result = {
            "segments": [make_segment(index, score) for index, score in ((1, 0.55), (2, 0.90), (3, 0.62), (4, 0.80))],
            "frames": [make_frame(index) for index in (1, 2, 3, 4)],
            "findings": ["总体得分线索"],
            "meta": {},
        }
        output = explain.explain_result(result, CFG)
        self.assertEqual(post.call_count, 4)
        self.assertTrue(all(item.get("explanation") == CLEAN_EXPLANATION for item in output["segments"]))
        self.assertEqual(output["meta"]["explanation"]["requested"], 4)
        self.assertEqual(output["meta"]["explanation"]["succeeded"], 4)
        self.assertEqual(output["meta"]["explanation"]["status"], "ok")
        self.assertEqual(len(output["findings"]), 4)
        self.assertNotIn("总体得分线索", output["findings"])

    @patch("explain.requests.post", return_value=FakeResponse())
    def test_explicit_segment_limit_still_works(self, post) -> None:
        result = {
            "segments": [make_segment(index, score) for index, score in ((1, 0.55), (2, 0.90), (3, 0.62), (4, 0.80))],
            "frames": [make_frame(index) for index in (1, 2, 3, 4)],
            "findings": [],
            "meta": {},
        }
        output = explain.explain_result(result, {**CFG, "max_segments": 2})
        self.assertEqual(post.call_count, 2)
        explained = {item["id"] for item in output["segments"] if item.get("explanation")}
        self.assertEqual(explained, {"segment-2", "segment-4"})

    @patch("explain.requests.post", return_value=FakeResponse())
    def test_falls_back_to_segment_frame_id(self, post) -> None:
        segment = make_segment(3, 0.7)
        segment["frameId"] = "frame-3"
        result = {
            "segments": [segment],
            # 帧时间故意不在片段范围内，验证按 frameId 兜底而不是静默跳过
            "frames": [make_frame(3, time=90.0)],
            "findings": [],
            "meta": {},
        }
        output = explain.explain_result(result, CFG)
        self.assertEqual(post.call_count, 1)
        self.assertEqual(output["segments"][0]["explanation"], CLEAN_EXPLANATION)

    def test_no_frames_is_skipped(self) -> None:
        result = make_result()
        result["frames"] = []
        output = explain.explain_result(result, CFG)
        self.assertEqual(output["meta"]["explanation"]["status"], "skipped")
        self.assertEqual(output["meta"]["explanation"]["reason"], "no_frames")

    @patch("explain.time.sleep")
    @patch("explain.requests.post")
    def test_retries_rate_limit(self, post, _sleep) -> None:
        post.side_effect = [
            FakeResponse(429, headers={"Retry-After": "1"}),
            FakeResponse(200),
        ]
        output = explain.explain_result(make_result(), CFG)
        self.assertEqual(post.call_count, 2)
        self.assertEqual(output["segments"][0]["explanation"], CLEAN_EXPLANATION)
        self.assertEqual(output["meta"]["explanation"]["status"], "ok")

    @patch("explain.requests.post", return_value=FakeResponse(content=""))
    def test_empty_response_counts_as_failure(self, _post) -> None:
        output = explain.explain_result(make_result(), CFG)
        self.assertEqual(output["meta"]["explanation"]["status"], "failed")
        self.assertNotIn("explanation", output["segments"][0])


if __name__ == "__main__":
    unittest.main()

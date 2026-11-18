import sys
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import vision_review as review


def config(**overrides):
    values = {
        "api_key": "test-key",
        "base_url": "http://127.0.0.1:1",
        "model": "test-model",
        "mode": "low",
        "timeout": 5.0,
        "max_frames": 4,
        "workers": 2,
        "medium_threshold": 0.5,
        "high_threshold": 0.8,
        "explain_segments": True,
        "max_segments": 12,
        "explain_frames": 2,
        "explain_workers": 2,
        "visual_marker": True,
        "visual_marker_frames": 6,
        "visual_marker_workers": 2,
        "visual_marker_confidence": 0.6,
    }
    values.update(overrides)
    return values


def frame(frame_id, time_value, score, risk="low"):
    return {
        "id": frame_id,
        "time": time_value,
        "risk": risk,
        "score": score,
        "caption": f"本地分数 {score}",
        "image": "data:image/jpeg;base64,AA==",
    }


def person(frames, risk="low"):
    return {
        "id": "p1",
        "label": "人物 1",
        "risk": risk,
        "coverage": "partial",
        "summary": "本地人物结论。",
        "firstSeen": 1.0,
        "lastSeen": 9.0,
        "faceFrames": len(frames),
        "findings": ["本地人物线索。"],
        "frames": frames,
        "segments": [],
    }


def result(persons=None, risk="low"):
    return {
        "risk": risk,
        "aiProbability": 0.1,
        "summary": "本地检测结论。",
        "coverage": "partial",
        "scope": "测试范围",
        "duration": 10.0,
        "sampledFrames": 2,
        "faceFrames": 2,
        "findings": ["本地线索。"],
        "persons": persons if persons is not None else [person([frame("f1", 2.0, 0.1)])],
    }


class VisionReviewTests(unittest.TestCase):
    def test_escalates_low_risk_and_adds_segment(self):
        data = result()
        with mock.patch.object(
            review,
            "_review_frame",
            return_value={
                "probability": 0.92,
                "verdict": "fake",
                "signals": ["边缘融合", "纹理重复"],
            },
        ):
            output = review.review_result(data, config())
        self.assertEqual(output["risk"], "high")
        self.assertEqual(output["persons"][0]["risk"], "high")
        self.assertEqual(output["persons"][0]["frames"][0]["risk"], "high")
        self.assertEqual(output["aiProbability"], 0.92)
        self.assertIn("视觉模型复核 1 张代表画面，其中 1 张存在可疑线索。", output["summary"])
        self.assertTrue(output["findings"][0].startswith("视觉复核："))
        self.assertTrue(output["persons"][0]["findings"][0].startswith("视觉复核："))
        self.assertIn("视觉复核概率", output["persons"][0]["frames"][0]["caption"])
        segments = output["persons"][0]["segments"]
        self.assertEqual(len(segments), 1)
        self.assertEqual(segments[0]["frameId"], "f1")
        self.assertEqual(segments[0]["risk"], "high")
        self.assertIn("边缘融合", segments[0]["signals"])
        self.assertEqual(output["meta"]["review"]["status"], "ok")
        self.assertEqual(output["meta"]["review"]["flagged"], 1)
        self.assertEqual(output["meta"]["review"]["escalated"], 1)

    def test_never_downgrades_existing_high_risk(self):
        data = result(
            persons=[person([frame("f1", 2.0, 0.9, risk="high")], risk="high")],
            risk="high",
        )
        data["aiProbability"] = 0.9
        with mock.patch.object(
            review,
            "_review_frame",
            return_value={"probability": 0.05, "verdict": "real", "signals": []},
        ):
            output = review.review_result(data, config(mode="always"))
        self.assertEqual(output["risk"], "high")
        self.assertEqual(output["persons"][0]["risk"], "high")
        self.assertEqual(output["persons"][0]["frames"][0]["risk"], "high")
        self.assertEqual(output["aiProbability"], 0.9)
        self.assertIn("未发现额外可疑线索", output["summary"])
        self.assertEqual(output["meta"]["review"]["flagged"], 0)
        self.assertEqual(output["meta"]["review"]["escalated"], 0)

    def test_not_configured_skips_without_request(self):
        data = result()
        before = dict(data)
        with mock.patch.object(
            review, "_review_frame", side_effect=AssertionError("must not call")
        ):
            output = review.review_result(data, config(api_key=""))
        self.assertEqual(output["summary"], before["summary"])
        self.assertEqual(output["meta"]["review"]["status"], "not_configured")

    def test_low_mode_skips_medium_local_risk(self):
        data = result(
            persons=[person([frame("f1", 2.0, 0.6, risk="medium")], risk="medium")],
            risk="medium",
        )
        with mock.patch.object(
            review, "_review_frame", side_effect=AssertionError("must not call")
        ):
            output = review.review_result(data, config(mode="low"))
        self.assertEqual(output["meta"]["review"]["status"], "skipped")
        self.assertEqual(output["meta"]["review"]["reason"], "local_risk_not_low")

    def test_partial_failure_keeps_successful_review(self):
        data = result(persons=[person([frame("f1", 2.0, 0.2), frame("f2", 8.0, 0.1)])])

        def fake(cfg, item):
            if item["id"] == "f1":
                raise RuntimeError("timeout")
            return {"probability": 0.9, "verdict": "fake", "signals": ["合成边缘"]}

        with mock.patch.object(review, "_review_frame", side_effect=fake):
            output = review.review_result(data, config())
        self.assertEqual(output["risk"], "high")
        self.assertEqual(output["meta"]["review"]["status"], "partial")
        self.assertEqual(output["meta"]["review"]["failed"], 1)
        self.assertEqual(output["meta"]["review"]["flagged"], 1)
        self.assertIn("另有 1 张代表画面复核未完成", output["summary"])

    def test_risk_mapping_uses_verdict(self):
        cfg = config()
        self.assertEqual(
            review._risk_for({"probability": 0.95, "verdict": "real"}, cfg), "low"
        )
        self.assertEqual(
            review._risk_for({"probability": 0.85, "verdict": "fake"}, cfg), "high"
        )
        self.assertEqual(
            review._risk_for({"probability": 0.6, "verdict": "uncertain"}, cfg), "medium"
        )

    def test_parse_payload_and_percentage(self):
        data = review._parse_payload(
            '```json\n{"fake_probability": "85%", "verdict": "fake", '
            '"signals": ["边缘融合"]}\n```'
        )
        self.assertEqual(review._to_probability(data["fake_probability"]), 0.85)
        self.assertEqual(data["signals"], ["边缘融合"])
        self.assertEqual(review._to_probability(0.4), 0.4)

    def test_select_frames_limits_and_spreads(self):
        persons = [
            person([frame("f1", 1.0, 0.1), frame("f2", 5.0, 0.2)]),
            {
                **person([frame("f3", 8.0, 0.3)]),
                "id": "p2",
                "label": "人物 2",
            },
        ]
        selected = review._select_frames(persons, 2)
        self.assertEqual([item["id"] for item in selected], ["f2", "f3"])
        selected = review._select_frames(persons, 3)
        self.assertEqual([item["id"] for item in selected], ["f1", "f2", "f3"])

    def test_explain_segments_writes_explanation_and_findings(self):
        data = result(
            persons=[person([frame("f1", 2.0, 0.9, risk="high")], risk="high")],
            risk="high",
        )
        data["persons"][0]["segments"] = [
            {
                "id": "s1",
                "start": 1.9,
                "end": 2.1,
                "risk": "high",
                "summary": "旧说明",
                "frameId": "f1",
                "signals": [],
            }
        ]
        with mock.patch.object(
            review, "_explain_segment", return_value="下颌边缘出现重复纹理。"
        ) as explain:
            output = review.explain_segments(data, config())
        self.assertEqual(
            output["persons"][0]["segments"][0]["explanation"], "下颌边缘出现重复纹理。"
        )
        self.assertIn("下颌边缘出现重复纹理。", output["findings"][0])
        self.assertEqual(output["meta"]["explanation"]["status"], "ok")
        self.assertEqual(output["meta"]["explanation"]["succeeded"], 1)
        explain.assert_called_once()

    def test_explain_segments_respects_config_and_skips_targets(self):
        data = result(
            persons=[person([frame("f1", 2.0, 0.9, risk="high")], risk="high")],
            risk="high",
        )
        data["persons"][0]["segments"] = [
            {
                "id": "s1",
                "start": 1.9,
                "end": 2.1,
                "risk": "high",
                "summary": "旧说明",
                "frameId": "f1",
                "signals": [],
            }
        ]
        with mock.patch.object(
            review, "_explain_segment", side_effect=AssertionError("must not call")
        ):
            output = review.explain_segments(data, config(api_key=""))
            self.assertEqual(output["meta"]["explanation"]["status"], "not_configured")
            output = review.explain_segments(data, config(mode="off"))
            self.assertEqual(output["meta"]["explanation"]["status"], "disabled")
        empty = result()
        output = review.explain_segments(empty, config())
        self.assertEqual(output["meta"]["explanation"]["status"], "skipped")
        self.assertEqual(output["meta"]["explanation"]["reason"], "no_segments")

    def test_select_explanation_targets_filters_and_prioritizes(self):
        first = person([frame("f1", 1.0, 0.2)])
        first["segments"] = [
            {"id": "low", "start": 1.0, "end": 1.1, "risk": "low", "summary": "低"},
            {"id": "medium", "start": 2.0, "end": 2.1, "risk": "medium", "summary": "中"},
        ]
        second = {
            **person([frame("f2", 3.0, 0.9)], risk="high"),
            "id": "p2",
            "label": "人物 2",
            "segments": [
                {"id": "high", "start": 3.0, "end": 3.1, "risk": "high", "summary": "高"}
            ],
        }
        targets = review._select_explanation_targets([first, second], 2)
        self.assertEqual([item[1]["id"] for item in targets], ["high", "medium"])
        self.assertEqual(
            [item[1]["id"] for item in review._select_explanation_targets([first, second], 0)],
            [],
        )

    def test_frames_for_segment_prefers_linked_frame(self):
        p = person(
            [
                frame("f1", 1.0, 0.1),
                frame("f2", 2.0, 0.9, risk="high"),
                frame("f3", 3.0, 0.1),
            ],
            risk="high",
        )
        segment = {
            "id": "s1",
            "start": 1.9,
            "end": 2.1,
            "risk": "high",
            "summary": "测试",
            "frameId": "f2",
        }
        frames = review._frames_for_segment(p, segment, 2)
        self.assertEqual([item["id"] for item in frames], ["f2"])


    def test_scan_visual_marker_detects_best_frame(self):
        frames = [frame("v1", 1.0, 0.0), frame("v2", 2.0, 0.0)]

        def check(cfg, item):
            if item["id"] == "v2":
                return {
                    "found": True,
                    "text": "AI generated",
                    "location": "右下角",
                    "confidence": 0.92,
                }
            return {"found": False}

        with mock.patch.object(review, "_check_visual_marker", side_effect=check):
            output = review.scan_visual_marker(frames, config())
        self.assertTrue(output["detected"])
        self.assertEqual(output["time"], 2.0)
        self.assertIn("AI generated", output["text"])
        self.assertGreaterEqual(output["confidence"], 0.9)
        self.assertEqual(output["status"], "ok")

    def test_scan_visual_marker_ignores_low_confidence(self):
        frames = [frame("v1", 1.0, 0.0)]
        with mock.patch.object(
            review,
            "_check_visual_marker",
            return_value={
                "found": True,
                "text": "AI",
                "location": "",
                "confidence": 0.4,
            },
        ):
            output = review.scan_visual_marker(frames, config())
        self.assertFalse(output["detected"])

    def test_scan_visual_marker_respects_config(self):
        frames = [frame("v1", 1.0, 0.0)]
        with mock.patch.object(
            review, "_check_visual_marker", side_effect=AssertionError("must not call")
        ):
            output = review.scan_visual_marker(frames, config(api_key=""))
            self.assertEqual(output["status"], "not_configured")
            output = review.scan_visual_marker(frames, config(visual_marker=False))
            self.assertEqual(output["status"], "disabled")
            output = review.scan_visual_marker([], config())
            self.assertEqual(output["status"], "skipped")

    def test_select_marker_frames_spreads_across_video(self):
        frames = [frame(f"v{i}", float(i), 0.0) for i in range(1, 5)]
        selected = review._select_marker_frames(frames, 2)
        self.assertEqual([item["id"] for item in selected], ["v1", "v4"])

    def test_clean_explanation_strips_prefix_and_boilerplate(self):
        self.assertEqual(
            review._clean_explanation("视觉复核：下颌边缘出现重复纹理，建议人工复核。"),
            "下颌边缘出现重复纹理。",
        )
        self.assertEqual(
            review._clean_explanation("- DeepSeek 检测到边缘融合"),
            "检测到边缘融合。",
        )


if __name__ == "__main__":
    unittest.main()

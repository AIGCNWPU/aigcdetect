"""画面可见 AI 标识检测的离线单元测试（不发起真实网络请求）。"""
from __future__ import annotations

import unittest
from unittest.mock import patch

import visual_marker

CFG = {
    "api_key": "test-key",
    "base_url": "http://mock.local",
    "model": "deepseek-flash",
    "timeout": 5,
}
FRAMES = [
    {"time": 1.0, "image": "data:image/jpeg;base64,AAAA"},
    {"time": 7.0, "image": "data:image/jpeg;base64,BBBB"},
]


def completion(content: str) -> dict:
    return {"choices": [{"message": {"content": content}}]}


class VisualMarkerTests(unittest.TestCase):
    @patch('visual_marker.post_completion')
    def test_without_key_skips_request(self, post) -> None:
        self.assertIsNone(visual_marker.detect_visible_ai_label(FRAMES, {**CFG, 'api_key': ''}))
        post.assert_not_called()

    @patch('visual_marker.post_completion')
    def test_detects_visible_label(self, post) -> None:
        post.return_value = completion('{"has_label": true, "label_text": "AI生成", "frame_index": 2}')
        marker = visual_marker.detect_visible_ai_label(FRAMES, CFG)
        self.assertIsNotNone(marker)
        self.assertEqual(marker.source, 'visual')
        self.assertIn('7.0s', marker.label)
        self.assertIn('AI生成', marker.label)
        messages = post.call_args.args[1]
        self.assertTrue(any(block.get('type') == 'image_url' for block in messages[1]['content']))
        self.assertEqual(post.call_args.kwargs['temperature'], 0.1)

    @patch('visual_marker.post_completion')
    def test_no_label_returns_none(self, post) -> None:
        post.return_value = completion('{"has_label": false, "label_text": "", "frame_index": null}')
        self.assertIsNone(visual_marker.detect_visible_ai_label(FRAMES, CFG))

    @patch('visual_marker.post_completion')
    def test_non_strong_text_is_rejected(self, post) -> None:
        post.return_value = completion('{"has_label": true, "label_text": "普通文字", "frame_index": 1}')
        self.assertIsNone(visual_marker.detect_visible_ai_label(FRAMES, CFG))

    @patch('visual_marker.post_completion')
    def test_parses_fenced_json_and_string_index(self, post) -> None:
        post.return_value = completion(
            '```json\n{"has_label": "true", "label_text": "AI Generated", "frame_index": "1"}\n```'
        )
        marker = visual_marker.detect_visible_ai_label(FRAMES, CFG)
        self.assertIsNotNone(marker)
        self.assertIn('1.0s', marker.label)
        self.assertIn('AI Generated', marker.label)

    @patch('visual_marker.post_completion')
    def test_invalid_json_returns_none(self, post) -> None:
        post.return_value = completion('not json')
        self.assertIsNone(visual_marker.detect_visible_ai_label(FRAMES, CFG))

    def test_no_frames_returns_none(self) -> None:
        self.assertIsNone(visual_marker.detect_visible_ai_label([], CFG))


if __name__ == '__main__':
    unittest.main()

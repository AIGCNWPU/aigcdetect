"""AI 生成标识前置判定的离线单元测试（不依赖真实视频解码）。"""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import aigc_marker


class MarkerDetectionTests(unittest.TestCase):
    def test_filename_marker(self) -> None:
        marker = aigc_marker.detect_aigc_marker('/tmp/not-needed.mp4', 'AI生成-演示视频.mp4')
        self.assertIsNotNone(marker)
        self.assertEqual(marker.source, 'filename')
        self.assertIn('AI生成', marker.label)

    def test_aigc_filename(self) -> None:
        marker = aigc_marker.detect_aigc_marker('/tmp/not-needed.mp4', 'clip_AIGC_final.mp4')
        self.assertIsNotNone(marker)
        self.assertEqual(marker.source, 'filename')

    def test_generic_ai_filename_is_not_matched(self) -> None:
        with patch('aigc_marker._probe_metadata', return_value=[]):
            marker = aigc_marker.detect_aigc_marker('/tmp/not-needed.mp4', 'AI教程.mp4')
        self.assertIsNone(marker)

    def test_metadata_marker(self) -> None:
        with tempfile.NamedTemporaryFile(suffix='.mp4') as handle:
            handle.write(b'not a real video')
            handle.flush()
            with patch('aigc_marker._probe_metadata', return_value=[('comment', 'AIGC generated video')]):
                marker = aigc_marker.detect_aigc_marker(handle.name, 'clean-name.mp4')
        self.assertIsNotNone(marker)
        self.assertEqual(marker.source, 'metadata')
        self.assertIn('comment', marker.label)

    def test_embedded_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            video = Path(directory) / "clean-name.mp4"
            video.write_bytes(b'xxxxAIGCxxxx')
            with patch('aigc_marker._probe_metadata', return_value=[]):
                marker = aigc_marker.detect_aigc_marker(video, 'clean-name.mp4')
        self.assertIsNotNone(marker)
        self.assertEqual(marker.source, 'embedded')
        self.assertIn('AIGC', marker.label)

    def test_apply_marker_overrides_risk_and_probability(self) -> None:
        result = {
            'risk': 'low',
            'summary': '模型结论。',
            'findings': ['模型线索'],
            'meta': {'videoScore': 0.2, 'method': '智鉴'},
        }
        marker = aigc_marker.AigcMarker(source='filename', label='文件名包含“AI生成”')
        output = aigc_marker.apply_aigc_marker(result, marker)
        self.assertEqual(output['risk'], 'high')
        self.assertEqual(output['meta']['videoScore'], 1.0)
        self.assertEqual(output['meta']['modelVideoScore'], 0.2)
        self.assertEqual(output['meta']['modelRisk'], 'low')
        self.assertEqual(output['meta']['aiMarker']['source'], 'filename')
        self.assertTrue(output['summary'].startswith('检测到 AI 生成标识'))
        self.assertEqual(output['findings'][0], '检测到 AI 生成标识（文件名包含“AI生成”），已直接判定为 AI 生成视频（AI概率 100%）。')
        self.assertIn('模型线索', output['findings'])

    def test_apply_visual_marker_uses_99_percent(self) -> None:
        result = {
            'risk': 'low',
            'summary': '模型结论。',
            'findings': [],
            'meta': {'videoScore': 0.2, 'method': '智鉴'},
        }
        marker = aigc_marker.AigcMarker(source='visual', label='画面 7.0s 出现“AI生成”')
        output = aigc_marker.apply_aigc_marker(result, marker, probability=0.99)
        self.assertEqual(output['risk'], 'high')
        self.assertEqual(output['meta']['videoScore'], 0.99)
        self.assertEqual(output['meta']['modelVideoScore'], 0.2)
        self.assertEqual(output['meta']['aiMarker']['source'], 'visual')
        self.assertIn('AI概率 99%', output['summary'])
        self.assertIn('AI概率 99%', output['findings'][0])

    def test_apply_without_marker_keeps_result(self) -> None:
        result = {'risk': 'low', 'summary': '模型结论。', 'findings': [], 'meta': {'videoScore': 0.2}}
        output = aigc_marker.apply_aigc_marker(result, None)
        self.assertIs(output, result)
        self.assertEqual(output['risk'], 'low')
        self.assertEqual(output['meta']['videoScore'], 0.2)
        self.assertNotIn('aiMarker', output['meta'])


if __name__ == '__main__':
    unittest.main()

"""分人判定的纯逻辑单测（不需要模型、不需要 GPU）。

    python -m unittest backend/test_dialogue.py
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import dialogue  # noqa: E402


class SpeakerStatsTest(unittest.TestCase):
    def test_sums_only_speech_span(self):
        stats = dialogue._speaker_stats([[0.0, 3.0], [7.0, 9.5], [20.0, 20.2]])
        self.assertAlmostEqual(stats["speech"], 3.0 + 2.5 + 0.2, places=3)
        self.assertEqual(len(stats["segments"]), 3)

    def test_ignores_reversed_spans(self):
        stats = dialogue._speaker_stats([[5.0, 1.0]])
        self.assertEqual(stats["speech"], 0.0)


class RealDialogueTest(unittest.TestCase):
    def test_single_speaker_is_not_dialogue(self):
        stats = {"A": {"speech": 12.0, "segments": []}}
        self.assertFalse(dialogue._is_real_dialogue(stats, 30.0))

    def test_second_speaker_too_short_is_not_dialogue(self):
        stats = {
            "A": {"speech": 20.0, "segments": []},
            "B": {"speech": 0.8, "segments": []},
        }
        self.assertFalse(dialogue._is_real_dialogue(stats, 30.0))

    def test_second_speaker_ratio_floor(self):
        # 30 秒 * 5% = 1.5 秒，1.2 秒仍然算"伪多人"
        stats = {
            "A": {"speech": 28.0, "segments": []},
            "B": {"speech": 1.2, "segments": []},
        }
        self.assertFalse(dialogue._is_real_dialogue(stats, 30.0))

    def test_two_real_speakers(self):
        stats = {
            "A": {"speech": 16.6, "segments": []},
            "B": {"speech": 12.5, "segments": []},
        }
        self.assertTrue(dialogue._is_real_dialogue(stats, 34.5))


class UnavailableTest(unittest.TestCase):
    def test_missing_spoofdiar_root(self):
        old = os.environ.pop("SPOOFDIAR_ROOT", None)
        try:
            with self.assertRaises(dialogue.DialogueUnavailable):
                dialogue._load_spoofdiar()
        finally:
            if old is not None:
                os.environ["SPOOFDIAR_ROOT"] = old

    def test_bad_spoofdiar_root(self):
        os.environ["SPOOFDIAR_ROOT"] = "/nonexistent/spoof-diarization"
        try:
            with self.assertRaises(dialogue.DialogueUnavailable):
                dialogue._load_spoofdiar()
        finally:
            os.environ.pop("SPOOFDIAR_ROOT", None)


class ConfigTest(unittest.TestCase):
    def test_auto_speaker_count_by_default(self):
        cfg = dialogue._diarization_config("cuda:0")
        self.assertEqual(cfg["diarization"]["num_speakers"], 0)
        self.assertEqual(cfg["diarization"]["device"], "cuda:0")

    def test_threshold_matches_offline_eval(self):
        self.assertAlmostEqual(dialogue.DIALOGUE_THRESHOLD, 0.99593, places=5)


if __name__ == "__main__":
    unittest.main()

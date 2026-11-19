"""不依赖模型与数据集的单元测试。

    python -m unittest discover -s tests -v
"""
from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from spoofdiar import audio as audio_io
from spoofdiar import config as config_mod
from spoofdiar import decision, gtbuild, masking, metrics, parsing, utils
from spoofdiar.detector import Detection, run_detection
from spoofdiar.masking import MaskParams, build_masks, build_noise_track, plan_kept_intervals


class TestIntervals(unittest.TestCase):
    def test_merge(self):
        self.assertEqual(
            utils.merge_intervals([(3, 4), (0, 1), (0.5, 2)]), [(0.0, 2.0), (3.0, 4.0)]
        )
        self.assertEqual(utils.merge_intervals([]), [])

    def test_complement(self):
        self.assertEqual(utils.complement_intervals([(1, 2)], 0, 4), [(0.0, 1.0), (2.0, 4.0)])
        self.assertEqual(utils.complement_intervals([(0, 4)], 0, 4), [])

    def test_overlap_and_total(self):
        self.assertAlmostEqual(utils.overlap_duration([(0, 2)], [(1, 3)]), 1.0)
        self.assertAlmostEqual(utils.total_duration([(0, 1), (0.5, 2)]), 2.0)

    def test_subtract(self):
        self.assertEqual(utils.subtract_intervals([(0, 4)], [(1, 2)]), [(0.0, 1.0), (2.0, 4.0)])


class TestMaskPlan(unittest.TestCase):
    def test_pad_is_clamped_by_other_speaker(self):
        # A 说 1.0-2.0；B 在 0.95 结束、2.05 开始，外扩必须被截断
        kept = plan_kept_intervals([(1.0, 2.0)], [(0.5, 0.95), (2.05, 3.0)], 0.2, 5.0)
        self.assertEqual(kept, [(0.95, 2.05)])

    def test_pad_respects_audio_bounds(self):
        kept = plan_kept_intervals([(0.05, 0.3)], [], 0.2, 1.0)
        self.assertEqual(kept, [(0.0, 0.5)])


class TestMaskBuild(unittest.TestCase):
    def setUp(self):
        self.sr = 16000
        self.rng = np.random.default_rng(0)
        self.samples = (self.rng.standard_normal((48000, 1)) * 0.1).astype(np.float32)
        self.segments = {"A": [(0.2, 0.4), (0.8, 0.9)], "B": [(0.5, 0.7)]}

    def test_lengths_match_exactly(self):
        masks, meta = build_masks(self.samples, self.sr, self.segments, MaskParams(), seed=0)
        self.assertEqual(meta["frames"], 48000)
        for name in ("A", "B"):
            self.assertEqual(masks[name].audio.shape, self.samples.shape)
            self.assertEqual(masks[name].audio.shape[0], self.samples.shape[0])

    def test_keep_never_enters_other_speaker(self):
        masks, _ = build_masks(self.samples, self.sr, self.segments, MaskParams(), seed=0)
        for start, end in masks["A"].kept:
            for other_start, other_end in self.segments["B"]:
                overlap = min(end, other_end) - max(start, other_start)
                self.assertLessEqual(overlap, 1e-9, f"A 的保留区间 {start}-{end} 吃进了 B")

    def test_zero_fill_is_digital_silence(self):
        masks, meta = build_masks(
            self.samples, self.sr, self.segments, MaskParams(fill="zero"), seed=0
        )
        self.assertEqual(meta["noise"]["source"], "zeros")
        index = int(0.6 * self.sr)  # B 说话、A 被替换
        self.assertEqual(float(masks["A"].audio[index, 0]), 0.0)

    def test_noise_comes_from_mutual_silence(self):
        masks, meta = build_masks(self.samples, self.sr, self.segments, MaskParams(), seed=0)
        self.assertEqual(meta["noise"]["source"], "silence_bank")
        self.assertGreater(meta["noise"]["bank_seconds"], 0.5)

    def test_gaussian_fallback_when_no_silence(self):
        track, info = build_noise_track(
            self.samples, self.sr, [], MaskParams(), np.random.default_rng(0)
        )
        self.assertEqual(info["source"], "gaussian")
        self.assertEqual(track.shape, self.samples.shape)
        self.assertLess(audio_io.rms_dbfs(track), -40.0)

    def test_single_speaker_still_works(self):
        masks, meta = build_masks(
            self.samples, self.sr, {"A": [(0.2, 0.4)]}, MaskParams(), seed=0
        )
        self.assertIn("A", masks)
        self.assertEqual(masks["A"].audio.shape[0], 48000)


class TestParsing(unittest.TestCase):
    def test_json_with_surrounding_text(self):
        raw = 'Sure. {"real_or_fake": "fake", "spoof_method": "tts", "fake_region": [[1.0, 2.5]]} done'
        parsed, error = parsing.parse_model_output(raw)
        self.assertIsNone(error)
        self.assertEqual(parsed["real_or_fake"], "fake")
        self.assertEqual(parsing.extract_regions(parsed, 10.0), [(1.0, 2.5)])

    def test_nested_region_key(self):
        parsed = {"real_or_fake": "fake", "spoofing": {"region": [[0.5, 1.5]]}}
        self.assertEqual(parsing.extract_regions(parsed, 5.0), [(0.5, 1.5)])

    def test_region_strings(self):
        self.assertEqual(parsing.normalize_regions("all", 10.0), [(0.0, 10.0)])
        self.assertEqual(parsing.normalize_regions("2.0 - 3.5", 10.0), [(2.0, 3.5)])
        self.assertEqual(parsing.normalize_regions({"start": 1.0, "end": 2.0}), [(1.0, 2.0)])
        self.assertEqual(parsing.normalize_regions("none"), [])

    def test_regions_are_clipped_to_duration(self):
        self.assertEqual(parsing.normalize_regions([[1.0, 99.0]], 5.0), [(1.0, 5.0)])

    def test_filter_by_overlap_drops_false_alarms(self):
        kept = parsing.filter_regions_by_overlap(
            [(1.0, 2.0), (5.0, 6.0)], [(1.2, 1.8)], min_ratio=0.1, min_seconds=0.05
        )
        self.assertEqual(kept, [(1.0, 2.0)])

    def test_decision_text_fallback(self):
        parsed, error = parsing.parse_model_output('real_or_fake: fake, spoof_method: "vc"')
        self.assertIsNotNone(error)
        self.assertEqual(parsing.decision_text(parsed), "fake")


class TestDecision(unittest.TestCase):
    def test_eer_on_separable_scores(self):
        eer, threshold = decision.eer_and_threshold([0, 0, 1, 1], [0.1, 0.2, 0.8, 0.9])
        self.assertAlmostEqual(eer, 0.0, places=9)
        self.assertAlmostEqual(threshold, 0.8, places=6)

    def test_eer_requires_two_classes(self):
        with self.assertRaises(ValueError):
            decision.eer_and_threshold([0, 0, 0], [0.1, 0.2, 0.3])

    def test_verdict_and_apply(self):
        self.assertEqual(decision.verdict_from_flags(True, True), "both_fake")
        self.assertEqual(decision.verdict_from_flags(False, True), "B_fake")
        self.assertEqual(decision.verdict_from_flags(False, False), "both_real")
        result = {
            "speakers": [
                {"id": "A", "p_fake": 0.9, "is_fake": False},
                {"id": "B", "p_fake": 0.1, "is_fake": True},
            ],
            "verdict": "both_real",
        }
        updated = decision.apply_threshold(result, 0.5)
        self.assertTrue(updated["speakers"][0]["is_fake"])
        self.assertFalse(updated["speakers"][1]["is_fake"])
        self.assertEqual(updated["verdict"], "A_fake")

    def test_threshold_scope(self):
        units = [
            {"condition": "modified", "label": 1, "p_fake": 0.9},
            {"condition": "modified", "label": 0, "p_fake": 0.1},
            {"condition": "original", "label": 0, "p_fake": 0.2},
        ]
        payload = decision.select_threshold(units, "modified")
        self.assertEqual(payload["n_units"], 2)
        self.assertAlmostEqual(payload["threshold"], 0.9, places=6)
        self.assertIn("all", payload["variants"])


class TestMetrics(unittest.TestCase):
    def test_auc(self):
        self.assertAlmostEqual(metrics.roc_auc([0, 0, 1, 1], [0.1, 0.4, 0.35, 0.8]), 0.75)
        self.assertIsNone(metrics.roc_auc([0, 0], [0.1, 0.2]))

    def test_classification_metrics(self):
        payload = metrics.classification_metrics([0, 0, 1, 1], [False, True, True, True])
        self.assertEqual(payload["tp"], 2)
        self.assertEqual(payload["fp"], 1)
        self.assertAlmostEqual(payload["precision"], 2 / 3, places=6)
        self.assertAlmostEqual(payload["balanced_accuracy"], 0.75, places=6)

    def test_pairing(self):
        turns = [
            {"start": 0.0, "end": 1.0, "speaker": 0},
            {"start": 1.0, "end": 2.0, "speaker": 1},
        ]
        same = metrics.pair_speakers({"A": [(0.0, 1.0)], "B": [(1.0, 2.0)]}, turns)
        self.assertEqual(same["mapping"], {"A": 0, "B": 1})
        swapped = metrics.pair_speakers({"A": [(1.0, 2.0)], "B": [(0.0, 1.0)]}, turns)
        self.assertEqual(swapped["mapping"], {"A": 1, "B": 0})

    def test_der_perfect_and_wrong(self):
        turns = [
            {"start": 0.0, "end": 1.0, "speaker": 0},
            {"start": 1.0, "end": 2.0, "speaker": 1},
        ]
        perfect = metrics.diarization_error_rate(
            turns, {"A": [(0.0, 1.0)], "B": [(1.0, 2.0)]}, 3.0, collar=0.0, step=0.01
        )
        self.assertAlmostEqual(perfect["der"], 0.0, places=6)

        swapped = metrics.diarization_error_rate(
            turns, {"A": [(1.0, 2.0)], "B": [(0.0, 1.0)]}, 3.0, collar=0.0, step=0.01
        )
        # 配对会把 A/B 换过来，所以仍然是对的
        self.assertAlmostEqual(swapped["der"], 0.0, places=6)

        empty = metrics.diarization_error_rate(turns, {}, 3.0, collar=0.0, step=0.01)
        self.assertAlmostEqual(empty["der"], 1.0, places=6)

    def test_category(self):
        self.assertEqual(metrics.category_of([]), "both_real")
        self.assertEqual(metrics.category_of([0]), "A_fake")
        self.assertEqual(metrics.category_of([1]), "B_fake")
        self.assertEqual(metrics.category_of([0, 1]), "both_fake")


class TestConfig(unittest.TestCase):
    def test_defaults_and_overrides(self):
        cfg = config_mod.load_config(None, ["mask.pad=0.3", "detect.backend=http"])
        self.assertAlmostEqual(cfg["mask"]["pad"], 0.3)
        self.assertEqual(cfg["detect"]["backend"], "http")
        self.assertEqual(config_mod.summary(cfg)["fill"], "noise")

    def test_invalid_values_rejected(self):
        with self.assertRaises(ValueError):
            config_mod.load_config(None, ["mask.fill=bogus"])
        with self.assertRaises(ValueError):
            config_mod.load_config(None, ["detect.backend=bogus"])
        with self.assertRaises(ValueError):
            config_mod.load_config(None, ["diarization.num_speakers=3"])

    def test_overrides_dict(self):
        cfg = config_mod.load_config(None, {"mask": {"fade": 0.05}})
        self.assertAlmostEqual(cfg["mask"]["fade"], 0.05)
        self.assertAlmostEqual(cfg["mask"]["pad"], 0.2)

    def test_coerce(self):
        self.assertEqual(config_mod.coerce("3"), 3)
        self.assertEqual(config_mod.coerce("0.5"), 0.5)
        self.assertIs(config_mod.coerce("true"), True)
        self.assertIsNone(config_mod.coerce("null"))


class TestAlign(unittest.TestCase):
    def test_recovers_positions_with_gaps(self):
        sr = 16000
        rng = np.random.default_rng(0)
        utt1 = (rng.standard_normal(8000) * 0.3).astype(np.float32)
        utt2 = (rng.standard_normal(6400) * 0.3).astype(np.float32)
        concat = np.zeros(int(sr * 2.0), dtype=np.float32)
        concat[int(0.2 * sr) : int(0.2 * sr) + utt1.size] = utt1
        concat[int(1.0 * sr) : int(1.0 * sr) + utt2.size] = utt2

        starts, scores, accepted = gtbuild.align_starts(
            concat, sr, [utt1, utt2], [0.0, 0.5]
        )
        self.assertAlmostEqual(starts[0], 0.2, places=2)
        self.assertAlmostEqual(starts[1], 1.0, places=2)
        self.assertTrue(all(accepted))
        self.assertGreater(min(scores), 0.8)


class TestGroundTruthHelpers(unittest.TestCase):
    def test_cumulative_starts(self):
        self.assertEqual(gtbuild.cumulative_starts([1.0, 2.0, 0.5]), [0.0, 1.0, 3.0])

    def test_dialog_id_from_filename(self):
        self.assertEqual(gtbuild.split_dialog_id("7_modified.wav"), "7")
        self.assertEqual(gtbuild.split_dialog_id("1234_original.wav"), "1234")

    def test_dialogue_length_hint(self):
        entry = {"original_dialogue": "[0] Speaker 0: hi\n[1] Speaker 1: hello\n"}
        self.assertEqual(gtbuild.dialogue_length_hint(entry), 2)
        self.assertIsNone(gtbuild.dialogue_length_hint({}))


class TestDetectionCache(unittest.TestCase):
    class FakeDetector:
        backend = "fake"

        def __init__(self):
            self.calls = 0

        def load(self):
            return None

        def detect(self, path):
            self.calls += 1
            return Detection(
                p_fake=0.87,
                real_logit=-1.0,
                fake_logit=1.9,
                logit_step=6,
                parsed={"real_or_fake": "fake", "fake_region": [[0.3, 0.6]]},
                raw_text='{"real_or_fake": "fake", "fake_region": [[0.3, 0.6]]}',
            )

    def test_second_call_hits_cache(self):
        cfg = config_mod.load_config(None)
        detector = self.FakeDetector()
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "A.wav"
            audio_io.write_audio(
                wav, np.zeros((16000, 1), dtype=np.float32), 16000
            )
            out = Path(tmp) / "detection_A.json"
            first = run_detection(
                detector, wav, out, cfg, speaker="A", segments=[[0.1, 0.9]], duration=1.0
            )
            second = run_detection(
                detector, wav, out, cfg, speaker="A", segments=[[0.1, 0.9]], duration=1.0
            )
            self.assertEqual(detector.calls, 1)
            self.assertEqual(first["p_fake"], second["p_fake"])
            self.assertAlmostEqual(first["p_fake"], 0.87, places=6)
            # 区域与说话人片段有交集，保留
            self.assertEqual(first["fake_regions"], [[0.3, 0.6]])
            self.assertTrue(out.is_file())


class TestPipelineSmoke(unittest.TestCase):
    """用假的分离器/检测器把整条链路跑一遍，验证产物结构与等长约束。"""

    class FakeDiarizer:
        def run(self, wav_path, out_dir, force=False):
            payload = {
                "file": str(wav_path),
                "duration": 1.6,
                "samplerate": 16000,
                "speakers": {"A": [[0.2, 0.5]], "B": [[0.8, 1.2]]},
                "pyannote_labels": {"A": "SPEAKER_01", "B": "SPEAKER_00"},
                "warnings": [],
                "diarization_warning": None,
            }
            utils.write_json(Path(out_dir) / "diarization.json", payload)
            return payload

    class FakeDetector:
        backend = "fake"

        def detect(self, path):
            fake = Path(path).stem == "B"
            return Detection(
                p_fake=0.93 if fake else 0.04,
                real_logit=-2.0 if fake else 2.0,
                fake_logit=2.0 if fake else -2.0,
                logit_step=6,
                parsed={"real_or_fake": "fake" if fake else "real"},
                raw_text='{"real_or_fake": "%s"}' % ("fake" if fake else "real"),
            )

    def test_end_to_end_without_models(self):
        from spoofdiar import pipeline

        cfg = config_mod.load_config(None)
        rng = np.random.default_rng(1)
        audio = np.zeros((int(16000 * 1.6), 1), dtype=np.float32)
        audio[int(0.2 * 16000) : int(0.5 * 16000), 0] = 0.2
        audio[int(0.8 * 16000) : int(1.2 * 16000), 0] = -0.2
        audio += (rng.standard_normal(audio.shape) * 0.001).astype(np.float32)

        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "dialog.wav"
            audio_io.write_audio(wav, audio, 16000)
            out = Path(tmp) / "out"
            result = pipeline.run_file(
                wav,
                out,
                cfg,
                threshold=0.5,
                detector=self.FakeDetector(),
                diarizer=self.FakeDiarizer(),
            )

            self.assertEqual(result["verdict"], "B_fake")
            self.assertEqual(result["file_id"], "dialog")
            self.assertEqual([item["id"] for item in result["speakers"]], ["A", "B"])
            self.assertAlmostEqual(result["speakers"][1]["p_fake"], 0.93, places=6)
            self.assertTrue(result["speakers"][1]["is_fake"])
            self.assertFalse(result["speakers"][0]["is_fake"])

            for name in ("A", "B"):
                info = audio_io.audio_info(out / f"{name}.wav")
                self.assertEqual(info["frames"], audio.shape[0])
                self.assertEqual(info["samplerate"], 16000)
                self.assertEqual(info["channels"], 1)

            meta = utils.read_json(out / "mask_meta.json")
            self.assertTrue(all(item["ok"] for item in meta["length_check"].values()))
            for name in ("A", "B"):
                self.assertTrue((out / f"detection_{name}.json").is_file())
            self.assertTrue((out / "result.json").is_file())

    def test_settings_are_written_to_result(self):
        from spoofdiar import pipeline

        cfg = config_mod.load_config(None, ["mask.pad=0.35", "mask.fade=0.03", "mask.fill=zero"])
        audio = np.zeros((int(16000 * 1.6), 1), dtype=np.float32)
        with tempfile.TemporaryDirectory() as tmp:
            wav = Path(tmp) / "dialog.wav"
            audio_io.write_audio(wav, audio, 16000)
            result = pipeline.run_file(
                wav,
                Path(tmp) / "out",
                cfg,
                threshold=0.5,
                detector=self.FakeDetector(),
                diarizer=self.FakeDiarizer(),
            )
            self.assertAlmostEqual(result["config"]["pad"], 0.35)
            self.assertAlmostEqual(result["config"]["fade"], 0.03)
            self.assertEqual(result["config"]["fill"], "zero")


if __name__ == "__main__":
    unittest.main()

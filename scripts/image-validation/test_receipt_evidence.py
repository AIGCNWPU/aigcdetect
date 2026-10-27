"""Synthetic adversarial fixtures; no research images or personal data bundled."""
import copy
import json
import unittest

from receipt_evidence import (arithmetic, digest, focused_visual_prompt, fuse, receipt_rules, rule_focus, strict_json,
                              validate_ocr, visual_prompt, visual_review)
from retry_ocr_regions import map_polygon


def region(key, text, x=10, y=10, width=80, confidence=0.99):
    return {"region_id": key, "observed_text": text, "recognition_confidence": confidence,
            "polygon": [[x, y], [x + width, y], [x + width, y + 20], [x, y + 20]],
            "coordinate_space": "exif_oriented_image_pixels",
            "source": {"input_sha256": "a" * 64, "page": 1, "provider": "synthetic"}}


def sample(regions=None):
    return {"status": "succeeded", "input_sha256": "a" * 64,
            "oriented_size": [600, 600], "regions": regions if regions is not None else [region("r1", "100.00")]}


def observation():
    return {"ocr_region_ids": ["r1"], "observed_values": ["100.00"],
            "description": "字边缘模糊，可能是拍摄造成，需复核。"}


def model(ocr, observations=None):
    return {"status": "succeeded", "input_sha256": ocr["input_sha256"],
            "oriented_size": ocr["oriented_size"], "ocr_evidence_sha256": digest(ocr),
            "token_limit_reached": False,
            "raw_output": json.dumps({"observations": observations if observations is not None else [observation()]}) + "<|im_end|>\n<|endoftext|>"}


class EvidenceTests(unittest.TestCase):
    def test_crop_mapping_returns_to_original_image(self):
        self.assertEqual(map_polygon([[0, 0], [40, 0], [40, 20], [0, 20]], [100, 200], 2),
                         [[100, 200], [120, 200], [120, 210], [100, 210]])
        with self.assertRaises(ValueError):
            map_polygon([[0, 0]], [100, 200], 0)

    def test_references_map_to_ocr_not_generated_coordinates(self):
        ocr = sample()
        result = visual_review(ocr, model(ocr))
        self.assertEqual(result["execution"], "succeeded")
        candidate = result["candidates"][0]
        self.assertEqual(candidate["evidence"][0]["polygon"], ocr["regions"][0]["polygon"])
        self.assertFalse(candidate["description_verified"])
        self.assertIsNone(result["forgery_probability"])

    def test_bad_or_invented_candidates_rejected(self):
        modifications = [
            {"ocr_region_ids": ["missing"]}, {"observed_values": ["100.01"]},
            {"observed_values": [""]}, {"ocr_region_ids": []},
            {"ocr_region_ids": ["r1", "r1"]}, {"description": ""},
            {"coordinates": [1, 2, 3, 4]}, {"risk_score": 0.99},
        ]
        for patch in modifications:
            with self.subTest(patch=patch):
                ocr = sample()
                obs = dict(observation(), **patch)
                result = visual_review(ocr, model(ocr, [obs]))
                self.assertEqual(result["execution"], "partial")
                self.assertEqual(result["candidates"], [])
                self.assertEqual(len(result["rejected"]), 1)

    def test_missing_required_field_not_silently_filled(self):
        ocr = sample()
        obs = observation()
        del obs["description"]
        self.assertEqual(visual_review(ocr, model(ocr, [obs]))["candidates"], [])

    def test_echoed_rule_context_is_not_an_observation(self):
        ocr = sample()
        generated = model(ocr)
        generated["raw_output"] = json.dumps({"crop_box": [0, 0, 100, 100], "candidate_checks": []})
        self.assertEqual(visual_review(ocr, generated)["execution"], "rejected")

    def test_focus_prompt_omits_rule_verdicts_and_repeats_output_contract(self):
        text = focused_visual_prompt(sample(), {"ocr_region_ids": ["r1"],
            "candidate_checks": [{"status": "FAIL"}], "crop_box": [0, 0, 100, 100]})
        self.assertNotIn("candidate_checks", text)
        self.assertNotIn("FAIL", text)
        self.assertNotIn("crop_box", text)
        self.assertIn("唯一顶层键必须为observations", text)

    def test_sources_and_truncation_fail_closed(self):
        ocr = sample()
        for patch in ({"input_sha256": "b" * 64}, {"oriented_size": [100, 100]},
                      {"ocr_evidence_sha256": "changed"}, {"token_limit_reached": True},
                      {"token_limit_reached": None}, {"status": "failed"}):
            with self.subTest(patch=patch):
                self.assertEqual(visual_review(ocr, dict(model(ocr), **patch))["execution"], "rejected")

    def test_unstructured_duplicate_or_truncated_json_rejected(self):
        for raw in (None, [], '{"observations":[],"observations":[]}', '{"observations": [',
                    'explanation\n```json\n{"observations":[]}\n```',
                    '```json\n{"observations":[]}\n', '{"observations":NaN}'):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                strict_json(raw)

    def test_complete_fence_is_logged_not_repaired(self):
        ocr = sample()
        generated = model(ocr, [])
        generated["raw_output"] = '```json\n{"observations":[]}\n```<|im_end|>\n<|endoftext|>'
        reviewed = visual_review(ocr, generated)
        self.assertEqual(reviewed["execution"], "succeeded")
        self.assertIn("removed_complete_json_fence", reviewed["format_normalizations"])

    def test_changed_ocr_invalidates_model_reuse(self):
        ocr = sample()
        old = model(ocr)
        ocr["regions"][0]["observed_text"] = "100.01"
        self.assertEqual(visual_review(ocr, old)["execution"], "rejected")

    def test_ocr_geometry_source_and_scores_validated(self):
        for patch in ({"recognition_confidence": float("nan")}, {"recognition_confidence": 1.2},
                      {"source": {"input_sha256": "b" * 64, "page": 1}},
                      {"coordinate_space": "unknown"},
                      {"polygon": [[-1, 0], [10, 0], [10, 10], [0, 10]]},
                      {"polygon": [[0, 0]] * 4}):
            with self.subTest(patch=patch):
                ocr = sample([dict(region("r1", "100"), **patch)])
                with self.assertRaises(ValueError):
                    validate_ocr(ocr)
        with self.assertRaises(ValueError):
            validate_ocr(sample([region("dup", "a"), region("dup", "b")]))

    def test_no_findings_never_means_authentic(self):
        ocr = sample()
        fused = fuse(ocr, model(ocr, []))
        self.assertIsNone(fused["overall_authenticity"])
        self.assertIsNone(fused["visual"]["authenticity_verdict"])
        self.assertEqual(fused["content"]["template_status"], "not_covered")

    def test_model_narrative_never_becomes_verified_explanation(self):
        ocr = sample()
        obs = dict(observation(), description="已从90改为100，肯定伪造")
        c = visual_review(ocr, model(ocr, [obs]))["candidates"][0]
        self.assertNotIn("90", c["display_explanation"])
        self.assertFalse(c["description_verified"])
        self.assertEqual(c["status"], "needs_review")

    def test_prompt_uses_per_sample_evidence(self):
        self.assertIn("100.00", visual_prompt(sample()))
        self.assertIn("不判定真伪", __import__('receipt_evidence').VISUAL_SYSTEM)


class ArithmeticTests(unittest.TestCase):
    def test_decimal_red_credit_and_tolerance(self):
        for values, status in [(["0.10", "0.20", "0.30"], "PASS"),
                               (["-100", "-6", "-106"], "PASS"),
                               (["100", "6", "106.01"], "PASS"),
                               (["100", "6", "106.02"], "FAIL")]:
            with self.subTest(values=values):
                self.assertEqual(arithmetic("net_plus_tax_equals_gross", values, currency="CNY")["status"], status)

    def test_ambiguous_numbers_and_missing_scope_never_repaired(self):
        for value in ("9..747", "1O0.00", "1,000.00", "NaN", "1e2", "100元", ""):
            with self.subTest(value=value):
                r = arithmetic("net_plus_tax_equals_gross", [value, "6", "106"], currency="CNY")
                self.assertEqual(r["status"], "NEI")
        self.assertEqual(arithmetic("net_plus_tax_equals_gross", ["100", "6", "106"], currency=None)["status"], "NEI")
        self.assertEqual(arithmetic("net_plus_tax_equals_gross", ["100", "6", "106"], currency="CNY", complete=False)["status"], "NEI")

    def test_inclusive_exclusive_unknown_and_rounding(self):
        for values, basis, expected, status in [
            (["106", "6", "6"], "tax_inclusive", "6.00", "PASS"),
            (["106", "6", "6"], "tax_exclusive", "6.36", "FAIL"),
            (["106", "6", "6"], None, None, "NEI"),
            (["20.382", "0", "2.03"], None, "0.00", "FAIL"),
            (["1.50", "1", "0.02"], "tax_exclusive", "0.02", "PASS"),
        ]:
            with self.subTest(values=values, basis=basis):
                r = arithmetic("displayed_rate_times_base", values, currency="CNY", basis=basis)
                self.assertEqual(r["status"], status)
                self.assertEqual(r.get("expected"), expected)

    def test_chinese_fields_keep_source_and_recompute(self):
        ocr = sample([region("net", "金额（不含税）：￥100.00", y=10, width=300),
                      region("tax", "税额：￥6.00", y=50, width=300),
                      region("gross", "价税合计（小写）：￥106.00", y=90, width=300)])
        result = receipt_rules(ocr)["checks"][0]
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(len(result["evidence"]), 3)
        before = digest(ocr)
        revised = copy.deepcopy(ocr)
        revised["regions"][2]["observed_text"] = "价税合计（小写）：￥107.00"
        self.assertEqual(receipt_rules(revised)["checks"][0]["status"], "FAIL")
        self.assertEqual(digest(ocr), before)
        self.assertNotEqual(digest(revised), before)

    def test_chinese_missing_or_low_confidence_is_nei(self):
        ocr = sample([region("net", "金额（不含税）：￥100.00"), region("tax", "税额：￥6.00", y=50)])
        self.assertEqual(receipt_rules(ocr)["checks"][0]["status"], "NEI")
        ocr["regions"].append(region("gross", "价税合计（小写）：￥106.00", y=90, confidence=0.6))
        self.assertEqual(receipt_rules(ocr)["checks"][0]["status"], "NEI")

    def test_ambiguous_field_is_queued_not_corrected(self):
        ocr = sample([region("net", "金额（不含税）：￥100.00"),
                      region("tax", "税额：￥6..00", y=50),
                      region("gross", "价税合计（小写）：￥106.00", y=90)])
        fused = fuse(ocr)
        self.assertEqual(fused["content"]["checks"][0]["status"], "NEI")
        self.assertEqual(fused["reread_requests"], [{"region_id": "tax",
            "reasons": ["ambiguous_numeric_text"], "automatic_correction": False}])
        self.assertEqual(ocr["regions"][1]["observed_text"], "税额：￥6..00")

    def test_model_echo_of_numeric_problem_is_not_visual_corroboration(self):
        ocr = sample([region("net", "金额（不含税）：￥100.00"),
                      region("tax", "税额：￥6..00", y=50),
                      region("gross", "价税合计（小写）：￥106.00", y=90)])
        obs = {"ocr_region_ids": ["tax"], "observed_values": ["6..00"],
               "description": "OCR文本包含两个点，金额格式异常。"}
        fused = fuse(ocr, model(ocr, [obs]))
        candidate = fused["visual"]["candidates"][0]
        self.assertEqual(candidate["finding_type"], "unclassified_model_observation")
        self.assertEqual(candidate["overlapping_ocr_review_reasons"], ["ambiguous_numeric_text"])
        self.assertFalse(candidate["independent_corroboration"])
        self.assertEqual(fused["visual"]["confirmed_visual_findings"], [])

    def test_chinese_separate_label_and_ambiguous_row(self):
        ocr = sample([region("net", "金额（不含税）", y=10), region("nv", "￥100", x=150, y=10),
                      region("tax", "税额", y=60), region("tv", "￥6", x=150, y=60),
                      region("gross", "价税合计（小写）", y=110), region("gv", "￥106", x=150, y=110)])
        self.assertEqual(receipt_rules(ocr)["checks"][0]["status"], "PASS")
        ocr["regions"].append(region("other", "￥10", x=300, y=10))
        self.assertEqual(receipt_rules(ocr)["checks"][0]["status"], "NEI")

    def test_visual_and_arithmetic_are_independent(self):
        ocr = sample([region("r1", "不含税金额：￥100"), region("tax", "税额：￥6", y=50),
                      region("gross", "价税合计（小写）：￥106", y=90)])
        obs = dict(observation(), observed_values=["100"])
        fused = fuse(ocr, model(ocr, [obs]))
        self.assertEqual(len(fused["visual"]["candidates"]), 1)
        self.assertEqual(fused["content"]["checks"][0]["status"], "PASS")
        ocr["regions"][2]["observed_text"] = "价税合计（小写）：￥107"
        fused = fuse(ocr, model(ocr, []))
        self.assertEqual(fused["visual"]["candidates"], [])
        self.assertEqual(fused["content"]["checks"][0]["status"], "FAIL")

    def test_rule_focus_has_provenance_and_does_not_crop_passing_receipt(self):
        ocr = sample([region("net", "不含税金额：￥100", y=10),
                      region("tax", "税额：￥6", y=50),
                      region("gross", "价税合计（小写）：￥106", y=90)])
        self.assertIsNone(rule_focus(ocr))
        ocr["regions"][2]["observed_text"] = "价税合计（小写）：￥107"
        selected = rule_focus(ocr)
        self.assertEqual(set(selected["ocr_region_ids"]), {"net", "tax", "gross"})
        self.assertEqual(selected["crop_box"], [0, 0, 106, 126])
        self.assertEqual(selected["candidate_checks"][0]["status"], "FAIL")
        self.assertIn("not_evidence", selected["meaning"])


if __name__ == "__main__":
    unittest.main()

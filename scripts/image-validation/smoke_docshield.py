"""Run pinned DocShield locally on one visible GPU and retain raw evidence."""
import argparse
import importlib.metadata
import json
import os
import time
from pathlib import Path

from smoke_ocr import sha256
from receipt_evidence import VISUAL_SYSTEM, digest, focused_visual_prompt, rule_focus, visual_prompt


SYSTEM_PROMPT = (
    "你是一个图像鉴伪专家，擅长结合视觉，文字结合伪造特征分析手段鉴别输入图像的真假。"
    "分析过程中，你会逐步分析，抽丝剥茧，找到图像伪造的蛛丝马迹，"
    "最终给出专业的鉴别结果及分析。"
)
USER_PROMPT = "请分析这张文档图片是否存在伪造或篡改风险，并输出一份专业、精炼、准确的防伪分析报告。"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--weights", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, required=True)
    inputs_group = parser.add_mutually_exclusive_group(required=True)
    inputs_group.add_argument("--image", type=Path, action="append")
    inputs_group.add_argument("--image-manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--gpu", choices=("0", "1", "2", "3"), default="3")
    parser.add_argument("--max-new-tokens", type=int, default=1024)
    parser.add_argument("--max-pixels", type=int, default=1024 * 1024)
    prompts = parser.add_mutually_exclusive_group()
    prompts.add_argument("--prompt-file", type=Path)
    prompts.add_argument("--ocr-report", type=Path,
                         help="Use per-image OCR evidence and a visual-only review prompt")
    parser.add_argument("--rule-guided", action="store_true",
                        help="Add a source-tracked crop of regions requiring rule review")
    args = parser.parse_args()
    image_rows = json.loads(args.image_manifest.read_text(encoding="utf-8")) if args.image_manifest else [
        {"path": str(p)} for p in args.image]
    if args.rule_guided and not args.ocr_report:
        parser.error("--rule-guided requires --ocr-report")
    if not 1 <= args.max_new_tokens <= 2048 or not 32 * 32 <= args.max_pixels <= 2048 * 2048:
        parser.error("Invalid inference resource limit")
    ledger = json.loads(args.ledger.read_text(encoding="utf-8"))
    if (ledger.get("state") != "FILES_VERIFIED"
            or ledger.get("repo") != "vankey/DocShield-9B"
            or ledger.get("revision") != "be48c35e645e4c9382f33c67d492172823b2be8d"
            or Path(ledger["target"]).resolve() != args.weights.resolve()):
        raise ValueError("A verified fixed-version DocShield asset ledger is required")
    for item in ledger["files"]:
        path = args.weights / item["path"]
        if not path.is_file() or sha256(path) != item["sha256"]:
            raise ValueError(f"Asset changed since download: {item['path']}")

    os.environ["CUDA_VISIBLE_DEVICES"] = args.gpu
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import torch
    from PIL import Image, ImageOps
    from qwen_vl_utils import process_vision_info
    from transformers import AutoProcessor, AutoModelForImageTextToText

    if not torch.cuda.is_available():
        raise RuntimeError("Requested GPU is not available")
    free, total = torch.cuda.mem_get_info(0)
    if free < 26 * 1024 ** 3:
        raise RuntimeError("Less than 26 GiB free on the selected GPU; no automatic multi-GPU allocation")
    prompt = args.prompt_file.read_text(encoding="utf-8") if args.prompt_file else USER_PROMPT
    ocr_samples = json.loads(args.ocr_report.read_text(encoding="utf-8"))["samples"] if args.ocr_report else None
    system_prompt = VISUAL_SYSTEM if args.ocr_report else SYSTEM_PROMPT
    started = time.perf_counter()
    processor = AutoProcessor.from_pretrained(
        args.weights, local_files_only=True, trust_remote_code=False)
    model, loading_info = AutoModelForImageTextToText.from_pretrained(
        args.weights, local_files_only=True, trust_remote_code=False,
        dtype=torch.bfloat16, device_map={"": "cuda:0"}, attn_implementation="sdpa",
        output_loading_info=True,
    )
    strict_load = {key: list(loading_info.get(key, [])) for key in
                   ("missing_keys", "unexpected_keys", "mismatched_keys", "error_msgs")}
    if any(strict_load.values()):
        raise ValueError("Incomplete DocShield parameter loading: " + json.dumps(strict_load))
    model.eval()
    report = {
        "purpose": "training_related_diagnostic" if args.image_manifest else "internal_research_smoke", "business_validated": False,
        "manifest_sha256": sha256(args.image_manifest) if args.image_manifest else None,
        "provider": "DocShield-9B", "revision": ledger["revision"],
        "asset_ledger_sha256": sha256(args.ledger), "physical_gpu": args.gpu,
        "versions": {p: importlib.metadata.version(p) for p in
                     ("torch", "transformers", "qwen-vl-utils", "accelerate")},
        "load_seconds": time.perf_counter() - started,
        "strict_load": strict_load,
        "generation": {"max_new_tokens": args.max_new_tokens, "do_sample": False,
                       "enable_thinking": False, "dtype": "bfloat16",
                       "max_pixels": args.max_pixels, "image_patch_size": 16},
        "system_prompt": system_prompt, "user_prompt": None if args.ocr_report else prompt,
        "ocr_report_sha256": sha256(args.ocr_report) if args.ocr_report else None,
        "rule_guided": args.rule_guided,
        "coordinate_status": "raw_model_output_pending_coordinate_calibration",
        "score_semantics": "generated_assessment_not_calibrated_probability_or_ocr_confidence",
        "samples": [],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    failures = 0
    for row in image_rows:
        path = Path(row["path"])
        sample = dict(row, input_path=str(path.resolve()), status="failed")
        started = time.perf_counter()
        torch.cuda.reset_peak_memory_stats()
        try:
            sample["input_sha256"] = sha256(path)
            if row.get("expected_sha256") and row["expected_sha256"] != sample["input_sha256"]:
                raise ValueError("Image changed since manifest freeze")
            with Image.open(path) as image:
                sample["stored_size"] = list(image.size)
                sample["exif_orientation"] = image.getexif().get(274, 1)
                oriented = ImageOps.exif_transpose(image).convert("RGB")
            sample["oriented_size"] = list(oriented.size)
            sample_prompt = prompt
            image_content = [{"type": "image", "image": oriented, "max_pixels": args.max_pixels}]
            if ocr_samples is not None:
                matches = [s for s in ocr_samples if s.get("input_sha256") == sample["input_sha256"]]
                if len(matches) != 1 or matches[0].get("oriented_size") != sample["oriented_size"]:
                    raise ValueError("Missing, ambiguous or dimension-mismatched OCR evidence")
                sample_prompt = visual_prompt(matches[0])
                sample["ocr_evidence_sha256"] = digest(matches[0])
                if args.rule_guided:
                    focus = rule_focus(matches[0])
                    sample["rule_focus"] = focus
                    if focus:
                        image_content.append({"type": "image", "image": oriented.crop(focus["crop_box"]),
                                              "max_pixels": args.max_pixels})
                        sample_prompt = focused_visual_prompt(matches[0], focus)
            sample["user_prompt"] = sample_prompt
            messages = [
                {"role": "system", "content": [{"type": "text", "text": system_prompt}]},
                {"role": "user", "content": image_content + [{"type": "text", "text": sample_prompt}]},
            ]
            text = processor.apply_chat_template(messages, tokenize=False,
                add_generation_prompt=True, enable_thinking=False)
            images, videos = process_vision_info(messages, image_patch_size=16)
            sample["vision_input_sizes"] = [list(image.size) for image in images]
            inputs = processor(text=[text], images=images, videos=videos,
                               padding=True, return_tensors="pt").to("cuda:0")
            torch.cuda.synchronize()
            generated_at = time.perf_counter()
            with torch.inference_mode():
                output = model.generate(**inputs, max_new_tokens=args.max_new_tokens,
                                        do_sample=False)
            torch.cuda.synchronize()
            generated = output[:, inputs["input_ids"].shape[1]:]
            sample.update(
                status="succeeded",
                input_tokens=int(inputs["input_ids"].shape[1]),
                output_tokens=int(generated.shape[1]),
                token_limit_reached=int(generated.shape[1]) >= args.max_new_tokens,
                generation_seconds=time.perf_counter() - generated_at,
                raw_output=processor.batch_decode(generated, skip_special_tokens=False)[0],
            )
            del inputs, output, generated
        except Exception as error:
            failures += 1
            sample.update(error_type=type(error).__name__, error=str(error)[:1000])
            torch.cuda.empty_cache()
        sample["seconds"] = time.perf_counter() - started
        sample["peak_allocated_bytes"] = torch.cuda.max_memory_allocated()
        report["samples"].append(sample)
        temp = args.output.with_suffix(".tmp")
        temp.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temp.replace(args.output)
        print(json.dumps({"sample": len(report["samples"]), "status": sample["status"],
                          "seconds": round(sample["seconds"], 3),
                          "output_tokens": sample.get("output_tokens")}), flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())

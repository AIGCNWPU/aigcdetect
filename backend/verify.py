"""迁移验证：在新服务器上跑 4 条演示样例，比对迁移前的 p_fake。

用法：
    python verify.py                # 跑 samples/ 下全部 wav
    CUDA_VISIBLE_DEVICES=0 python verify.py
"""
import os
import re
import sys
import time

import torch
from transformers import Qwen2_5OmniProcessor, Qwen2_5OmniThinkerForConditionalGeneration
from peft import PeftModel
from qwen_omni_utils import process_mm_info

BASE = os.environ.get("MODEL_ROOT", "/mnt/vos-6d37s2q0/users/zqy/models")
MODEL_DIR = os.path.join(BASE, "Qwen2.5-Omni-7B")
ADAPTER_DIR = os.path.join(BASE, "HoliAntiSpoof")

# 迁移前（老服务器）的实测值，用于一致性比对
EXPECTED = {
    "wav1.wav": 0.999,
    "wav2.wav": 0.001,
    "wav3.wav": 1.000,
    "wav4.wav": 0.000,
}

PROMPT = ("Determine whether this audio clip is a spoof or not. If it is a spoof, "
          "determine the spoofing method and the spoofing region.")
SYSTEM = ("You are Qwen, a virtual human developed by the Qwen Team, Alibaba Group, "
          "capable of perceiving auditory and visual inputs, as well as generating text and speech.")


def conversation(path):
    return [
        {"role": "system", "content": [{"type": "text", "text": SYSTEM}]},
        {"role": "user", "content": [{"type": "audio", "audio": path},
                                     {"type": "text", "text": PROMPT}]},
    ]


def main():
    files = sys.argv[1:] or sorted(
        os.path.join("samples", name) for name in os.listdir("samples") if name.endswith(".wav")
    )

    print(f"loading base {MODEL_DIR} ...", flush=True)
    t0 = time.time()
    model = Qwen2_5OmniThinkerForConditionalGeneration.from_pretrained(
        MODEL_DIR, torch_dtype="auto", device_map="cuda:0", attn_implementation="sdpa")
    model = PeftModel.from_pretrained(model, ADAPTER_DIR)
    model.eval()
    processor = Qwen2_5OmniProcessor.from_pretrained(MODEL_DIR)
    tok = processor.tokenizer
    real_id = tok.convert_tokens_to_ids("real")
    fake_id = tok.convert_tokens_to_ids("fake")
    stop = re.compile(r"<\|im_end\|>|<\|endoftext\|>")
    print(f"loaded in {time.time() - t0:.1f}s  vram={torch.cuda.memory_allocated() / 2**30:.1f}GiB", flush=True)

    worst = 0.0
    for index, path in enumerate(files):
        t1 = time.time()
        conv = conversation(path)
        text = processor.apply_chat_template(conv, add_generation_prompt=True, tokenize=False)
        audios, _, _ = process_mm_info(conv, use_audio_in_video=False)
        inputs = processor(text=text, audio=audios, images=None, videos=None,
                           return_tensors="pt", padding=True, use_audio_in_video=False)
        inputs = inputs.to(model.device).to(model.dtype)
        with torch.no_grad():
            out = model.generate(**inputs, max_new_tokens=192, tokenizer=tok,
                                 stop_strings=["<|im_end|>", "<|endoftext|>"],
                                 output_scores=True, return_dict_in_generate=True)
        dt = time.time() - t1
        trimmed = out.sequences[0, len(inputs["input_ids"][0]):]
        txt = tok.decode(trimmed, skip_special_tokens=True)
        match = stop.search(txt)
        if match:
            txt = txt[:match.start()]
        real_logit = out.scores[6][0, real_id].item()
        fake_logit = out.scores[6][0, fake_id].item()
        p_fake = torch.softmax(torch.tensor([real_logit, fake_logit]), 0)[1].item()

        name = os.path.basename(path)
        expect = EXPECTED.get(name)
        gap = abs(p_fake - expect) if expect is not None else 0.0
        worst = max(worst, gap)
        flag = "OK  " if gap <= 0.05 else "DIFF"
        print(f"{flag} {name:10s} p_fake={p_fake:.4f} (was {expect}) "
              f"{dt:.1f}s  {txt.strip()[:90]}", flush=True)

    print(f"\nmax |delta| = {worst:.4f}")


if __name__ == "__main__":
    main()

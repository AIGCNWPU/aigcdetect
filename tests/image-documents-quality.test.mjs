import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 图像属性鉴别 v1.2 回归：OCR 空间融合后的模糊分级/类型/定位。
// 用合成"文字笔画"图（随机短横条模拟字形墨迹）生成清晰/失焦/运动模糊/放大四类样本，
// 阈值断言全部来自 2026-11-17 在真实票据上的标定结果。
const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "scripts/image-validation/quality_check.py");
const python = process.env.AIGC_REPORT_PYTHON || "python3";

const probe = spawnSync(python, ["-c", "import numpy, PIL; from PIL import Image"], { stdio: "pipe" });
const available = probe.status === 0;

const FIXTURE = String.raw`
import json, os, sys, hashlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(11)
W, H = 900, 1200
img = Image.new("RGB", (W, H), "white")
draw = ImageDraw.Draw(img)
boxes = []
y = 60
for _ in range(14):
    h = 20
    x = 60
    while x < W - 90:
        # 字形轮廓：6x12 方框 + 可选横笔，含横竖两个方向的笔画（贴近真实文字的方向分布）
        draw.rectangle([x, y + 4, x + 6, y + h - 4], outline="black", width=1)
        if rng.random() < 0.5:
            draw.line([x, y + h // 2, x + 6, y + h // 2], fill="black", width=1)
        x += int(rng.integers(10, 16))
    boxes.append({"polygon": [[50, y], [W - 50, y], [W - 50, y + h], [50, y + h]],
                  "observed_text": "测试文字行" * 3, "recognition_confidence": 0.99})
    y += 40

variants = {"clear": img}
variants["gauss"] = img.filter(ImageFilter.GaussianBlur(2.6))
def box_blur_x(a, k=13):
    """水平方向盒式模糊（运动模糊近似），仅用 numpy 累积和，避免测试依赖 scipy。"""
    pad = k // 2
    p = np.pad(a, ((0, 0), (pad, k - 1 - pad), (0, 0)), mode="edge")
    c = np.cumsum(p, axis=1, dtype=np.float64)
    c = np.concatenate([np.zeros((c.shape[0], 1, c.shape[2])), c], axis=1)
    return (c[:, k:, :] - c[:, :-k, :]) / k

arr = np.asarray(img).astype(np.float32)
variants["motion_h"] = Image.fromarray(box_blur_x(arr).clip(0, 255).astype(np.uint8))
variants["lowres_nn"] = img.resize((W // 4, H // 4), Image.BICUBIC).resize((W, H), Image.NEAREST)

manifest, ocr_samples = [], []
for name, im in variants.items():
    p = os.path.join(out, name + ".png")
    im.save(p)
    manifest.append({"sample_id": name, "path": p,
                     "expected_sha256": hashlib.sha256(open(p, "rb").read()).hexdigest()})
    ocr_samples.append({"sample_id": name, "status": "succeeded",
                        "regions": [dict(r, region_id="ocr-%d" % i) for i, r in enumerate(boxes)]})
json.dump(manifest, open(os.path.join(out, "manifest.json"), "w"))
json.dump({"samples": ocr_samples}, open(os.path.join(out, "ocr.json"), "w"))
`;

function buildFixture() {
  const dir = mkdtempSync(path.join(tmpdir(), "quality-fixture-"));
  const fixture = spawnSync(python, ["-c", FIXTURE, dir], { encoding: "utf8" });
  assert.equal(fixture.status, 0, fixture.stderr);
  return dir;
}

function runQuality(dir, { withOcr = true } = {}) {
  const out = path.join(dir, "quality.json");
  const args = [script, "--image-manifest", path.join(dir, "manifest.json"), "--output", out];
  if (withOcr) args.push("--ocr", path.join(dir, "ocr.json"));
  const result = spawnSync(python, args, { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(out, "utf8"));
  return Object.fromEntries(report.samples.map((s) => [s.sample_id, s]));
}

test("模糊分级：清晰图判 clear 且无区域，失焦图随程度上升并判 defocus", { skip: !available }, () => {
  const dir = buildFixture();
  try {
    const samples = runQuality(dir);
    const clear = samples.clear;
    assert.equal(clear.status, "succeeded");
    assert.equal(clear.blur.level, "clear", `clear 应判清晰，实际 ${clear.blur.level} (${clear.blur.score})`);
    assert.deepEqual(clear.blur.regions, []);
    assert.ok(clear.blur.details.relInkRun < 0.12, `清晰图笔画/行高应低于 0.12，实际 ${clear.blur.details.relInkRun}`);
    assert.equal(clear.blur.ocrFused, true);

    const gauss = samples.gauss;
    assert.ok(gauss.blur.score > clear.blur.score, "失焦图分数必须高于清晰图");
    assert.ok(gauss.blur.score >= 0.45, `高斯模糊应达 moderate 以上，实际 ${gauss.blur.score}`);
    assert.equal(gauss.blur.type, "defocus");
    assert.ok(gauss.blur.regions.length > 0, "失焦图应能定位到模糊文字行");
    assert.ok(gauss.blur.details.relInkRun > clear.blur.details.relInkRun * 1.5, "相对笔画宽度应明显增大");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("模糊类型：水平运动模糊判 motion 并给出方向，最近邻放大判 low_resolution", { skip: !available }, () => {
  const dir = buildFixture();
  try {
    const samples = runQuality(dir);
    const motion = samples.motion_h;
    assert.equal(motion.blur.type, "motion", `实际类型 ${motion.blur.type}`);
    assert.ok(motion.blur.score >= 0.5, `运动模糊分数应达到 moderate 以上，实际 ${motion.blur.score}`);
    assert.equal(motion.blur.details.motionDirection, "horizontal");
    assert.ok(motion.blur.reasons.includes("directional_motion_blur"));

    const lowres = samples.lowres_nn;
    assert.equal(lowres.blur.type, "low_resolution", `实际类型 ${lowres.blur.type}`);
    assert.ok(lowres.blur.reasons.includes("upscaled_or_low_resolution"));
    assert.ok(lowres.blur.score >= 0.2, "放大图应至少提示轻微模糊");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("OCR 缺失时降级为全局判据并标注 no_text_evidence（分数有上限）", { skip: !available }, () => {
  const dir = buildFixture();
  try {
    const samples = runQuality(dir, { withOcr: false });
    const clear = samples.clear;
    assert.equal(clear.blur.ocrFused, false);
    assert.ok(clear.blur.reasons.includes("no_text_evidence"));
    assert.equal(clear.blur.regions.length, 0, "无文字证据时不应输出逐行定位");
    assert.ok(clear.blur.score <= 0.6, "无文字证据时分数不应超过提示级上限");
    const gauss = samples.gauss;
    assert.ok(gauss.blur.score <= 0.6);
    assert.ok(gauss.blur.score >= clear.blur.score, "即使降级，模糊图也不应低于清晰图");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("手写属性在规则基线中不评估（返回 null，避免假分数）", { skip: !available }, () => {
  const dir = buildFixture();
  try {
    const samples = runQuality(dir);
    for (const sample of Object.values(samples)) assert.equal(sample.attributes.handwritten, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

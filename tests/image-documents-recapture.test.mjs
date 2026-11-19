import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 屏幕翻拍模型接线回归：权重存在时走模型（输出分数/分级），缺失时降级为启发式。
const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "scripts/image-validation/quality_check.py");
const python = process.env.AIGC_REPORT_PYTHON || "python3";
const modelPath = process.env.AIGC_RECAPTURE_MODEL
  || "/sdb/data_public/lvjiawen/aigc_platform/weights/recapture/recapture_v1.json";
const sample = path.join(root, "public/image-examples/invoice/invoice-a.jpg");

const probe = spawnSync(python, ["-c", "import numpy, PIL"], { stdio: "pipe" });
const available = probe.status === 0;
const modelAvailable = existsSync(modelPath);
const sampleAvailable = existsSync(sample);

function qualityRun(model) {
  const dir = mkdtempSync(path.join(tmpdir(), "recapture-"));
  const sha = createHash("sha256").update(readFileSync(sample)).digest("hex");
  const manifest = path.join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify([{ sample_id: "m1-p1", path: sample, expected_sha256: sha }]));
  const out = path.join(dir, "quality.json");
  const args = [script, "--image-manifest", manifest, "--output", out];
  if (model) args.push("--recapture-model", model);
  const result = spawnSync(python, args, { encoding: "utf8", timeout: 180000 });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(readFileSync(out, "utf8"));
  rmSync(dir, { recursive: true, force: true });
  return report;
}

test("清晰电子发票不应被模型判为翻拍（分数低于阈值）", { skip: !(available && modelAvailable && sampleAvailable) }, () => {
  const report = qualityRun(modelPath);
  assert.equal(report.recapture_model.available, true);
  const sample0 = report.samples[0];
  assert.equal(sample0.status, "succeeded");
  const recapture = sample0.recapture;
  assert.equal(recapture.source, "model", `应走模型，实际 ${recapture.source}`);
  assert.ok(Number.isFinite(recapture.score), "应输出 0-100 分数");
  assert.equal(recapture.level, "unlikely", `清晰发票应判 unlikely，实际 ${recapture.level}（${recapture.score}）`);
  assert.ok(recapture.probability < (recapture.thresholds?.medium ?? 0.85),
    `概率应低于阈值，实际 ${recapture.probability}`);
  assert.ok(!sample0.notes.some((n) => n.includes("翻拍")), "不应出现翻拍提示");
});

test("模型缺失时降级为启发式并明确标注来源", { skip: !(available && sampleAvailable) }, () => {
  const report = qualityRun("/nonexistent/recapture.json");
  assert.equal(report.recapture_model.available, false);
  const recapture = report.samples[0].recapture;
  assert.equal(recapture.source, "heuristic");
  assert.ok(Number.isFinite(recapture.score));
  assert.match(recapture.semantics, /heuristic/);
});

test("翻拍结论结构完整：分数/分级/概率/阈值/语义", { skip: !(available && modelAvailable && sampleAvailable) }, () => {
  const recapture = qualityRun(modelPath).samples[0].recapture;
  for (const key of ["score", "level", "probability", "source", "thresholds", "semantics"]) {
    assert.ok(key in recapture, `缺少字段 ${key}`);
  }
  assert.ok(["unlikely", "suspected", "likely"].includes(recapture.level));
  assert.ok(recapture.score >= 0 && recapture.score <= 100);
  assert.match(recapture.semantics, /uncalibrated/);
});

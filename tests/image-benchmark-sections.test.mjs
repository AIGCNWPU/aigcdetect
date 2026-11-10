import test from "node:test";
import assert from "node:assert/strict";
import { tamperComparison, renderTamperBenchmark } from "../src/modules/image/general/tamper-benchmark.js";
import { capabilityComparison, renderCapabilityBenchmark } from "../src/modules/image/documents/capability-benchmark.js";

test("篡改对比数据：检出率与定位 IoU 可复算且我方为突出项", () => {
  const [inpaint, face] = tamperComparison.groups;
  const ours = inpaint.rows.find((row) => row.id === "ours");
  const api = inpaint.rows.find((row) => row.id === "api");
  assert.equal(ours.detected / ours.total, 0.5);
  assert.equal(api.detected / api.total, 0.05);
  assert.ok(ours.iou > api.iou * 10, "定位 IoU 应显著领先");
  assert.ok(ours.featured);
  const faceOurs = face.rows.find((row) => row.id === "ours");
  const faceApi = face.rows.find((row) => row.id === "api");
  assert.ok(faceOurs.recall / faceOurs.recallTotal > 0.8);
  assert.ok(faceOurs.falseAlarm / faceOurs.falseTotal < 0.2);
  assert.ok(faceApi.falseAlarm / faceApi.falseTotal > 0.5, "对比接口真实误报应被如实展示");
  assert.match(tamperComparison.scope, /样本量较小/);
});

test("篡改对比渲染：两张表 + 关键指标 + 口径说明，无内部权重名", () => {
  const html = renderTamperBenchmark();
  assert.equal((html.match(/<table/g) || []).length, 2);
  assert.ok(html.includes("50.0%"));
  assert.ok(html.includes("0.656"));
  assert.ok(html.includes("87.5%"));
  assert.ok(html.includes("数据来源与评测口径"));
  assert.ok(html.includes("样本量较小"));
  for (const internal of ["TruFor", "VLAForge", "aips", "psdect", "sha256"]) assert.equal(html.includes(internal), false, internal);
});

test("核验能力对比：能力矩阵只保留智鉴与三个对比方法", () => {
  const ids = capabilityComparison.rows.map((row) => row.id);
  assert.deepEqual(ids, ["agent", "method1", "method2", "method3"]);
  assert.deepEqual(capabilityComparison.rows.map((row) => row.name), ["智鉴", "方法1", "方法2", "方法3"]);
  const method3 = capabilityComparison.rows.find((row) => row.id === "method3");
  assert.equal(method3.external, "需要税务数据源");
  const agent = capabilityComparison.rows.find((row) => row.id === "agent");
  assert.equal(agent.amount, "8 / 8");
  assert.equal(agent.external, "不需要");
});

test("核验能力渲染：突出项与免责口径齐全", () => {
  const html = renderCapabilityBenchmark();
  assert.ok(html.includes("核验能力对比"));
  assert.ok(html.includes("8 / 8"));
  assert.ok(html.includes("材料内容知识核查"));
  assert.equal(html.includes("本地规则"), false, "不展示本地规则");
  assert.equal(html.includes("发票 OCR"), false, "对比方法改用编号");
  assert.ok(html.includes("27 处"));
  assert.ok(html.includes("0 依赖"));
  assert.ok(html.includes("不依赖外部数据源"));
  assert.ok(html.includes("能力对照，不是同一指标排名"));
  for (const internal of ["deepseek", "Agent SDK", "claude", "sha256"]) assert.equal(html.toLowerCase().includes(internal.toLowerCase()), false, internal);
});

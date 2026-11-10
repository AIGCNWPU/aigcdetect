import test from "node:test";
import assert from "node:assert/strict";
import { capabilityComparison, renderCapabilityBenchmark } from "../src/modules/image/documents/capability-benchmark.js";

test("核验能力对比：只保留智鉴与三个对比方法，不出现分数", () => {
  const ids = capabilityComparison.rows.map((row) => row.id);
  assert.deepEqual(ids, ["agent", "method1", "method2", "method3"]);
  assert.deepEqual(capabilityComparison.rows.map((row) => row.name), ["智鉴", "方法1", "方法2", "方法3"]);
  const agent = capabilityComparison.rows.find((row) => row.id === "agent");
  assert.equal(agent.content, "支持");
  assert.equal(agent.external, "不需要");
  const method3 = capabilityComparison.rows.find((row) => row.id === "method3");
  assert.equal(method3.external, "需要税务数据源");
});

test("核验能力渲染：标题与徽标按对外文案，表格不含分数与说明列", () => {
  const html = renderCapabilityBenchmark();
  assert.ok(html.includes("全能助手 · 能力展示"));
  assert.ok(html.includes("能力矩阵 · 强大而全面的核验助手"));
  assert.ok(html.includes("材料内容知识核查"));
  assert.equal(html.includes("说明</th>"), false, "说明列已删除");
  assert.equal(html.includes("8 / 8"), false, "不展示分数");
  assert.equal(html.includes("27 处"), false, "不展示差异计数");
  assert.equal(html.includes("数据来源与评测口径"), false, "不展示口径段");
  assert.equal(html.includes("本地规则"), false, "不展示本地规则");
  assert.equal(html.includes("发票 OCR"), false, "对比方法改用编号");
  const head = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
  assert.equal((head.match(/<th>/g) || []).length, 5, "表头五列");
  for (const internal of ["deepseek", "Agent SDK", "claude", "sha256"]) assert.equal(html.toLowerCase().includes(internal.toLowerCase()), false, internal);
});

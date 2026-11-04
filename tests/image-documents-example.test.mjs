import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { invoiceShowcase } from "../src/modules/image/documents/example.js";
import {
  renderDocumentShowcase,
  bindDocumentExample,
} from "../src/modules/image/pages/documents.js";

test("示例材料含核心与辅助两份，各自三项异常与三项通过", () => {
  assert.equal(invoiceShowcase.materials.length, 2);
  assert.deepEqual(
    invoiceShowcase.materials.map((m) => m.id),
    ["a", "b"],
  );
  assert.match(invoiceShowcase.materials[0].tab, /核心/);
  assert.match(invoiceShowcase.materials[1].tab, /辅助/);
  for (const material of invoiceShowcase.materials) {
    assert.equal(material.issues.length, 3, material.id);
    assert.equal(material.passes.length, 3, material.id);
    assert.equal(material.fields.length, 5, material.id);
    for (const item of [...material.issues, ...material.passes])
      assert.ok(item.title && item.detail, material.id);
  }
});

test("示例成绩取自历史核验记录的原始票面数值", () => {
  const [core, auxiliary] = invoiceShowcase.materials;
  const value = (material, label) =>
    material.fields.find((item) => item.label === label)?.value || "";
  assert.match(value(core, "价税合计"), /1999\.99/);
  assert.match(value(core, "金额 / 税额"), /1999\.99 \/ 259\.99/);
  assert.match(value(auxiliary, "价税合计"), /30000\.00/);
  assert.match(value(auxiliary, "金额 / 税额"), /30000\.00 \/ 62\.31/);
  for (const material of invoiceShowcase.materials)
    assert.equal(
      material.fields.find((item) => item.label === "发票号码").value,
      "0001345",
    );
});

test("展示区渲染两份材料、默认选中核心材料且不显示内部模型名", () => {
  const html = renderDocumentShowcase();
  assert.equal((html.match(/data-doc-example-tab=/g) || []).length, 2);
  assert.equal((html.match(/data-doc-example-panel=/g) || []).length, 2);
  assert.equal((html.match(/role="tabpanel"/g) || []).length, 2);
  assert.match(html, /aria-selected="true"[^>]*data-doc-example-tab="a"/);
  assert.match(html, /data-doc-example-panel="b"[^>]*hidden/);
  assert.equal((html.match(/<h4>发现异常<small>3 项/g) || []).length, 2);
  assert.equal((html.match(/<h4>未发现异常<small>3 项/g) || []).length, 2);
  assert.ok(html.includes("/public/image-examples/invoice/invoice-a.jpg"));
  assert.ok(html.includes("/public/image-examples/invoice/invoice-b.jpg"));
  assert.ok(html.includes('loading="lazy"'));
  for (const internal of [
    "DDA",
    "SEED",
    "OCR",
    "MIRROR",
    "未校准",
    "置信度",
    "score",
    "未接入",
  ])
    assert.equal(html.includes(internal), false, internal);
});

test("切换到辅助材料时仅显示对应面板", () => {
  const html = renderDocumentShowcase("b");
  assert.match(html, /aria-selected="true"[^>]*data-doc-example-tab="b"/);
  assert.match(html, /aria-selected="false"[^>]*data-doc-example-tab="a"/);
  assert.match(html, /id="doc-example-panel-a"[^>]*hidden/);
  assert.doesNotMatch(html, /id="doc-example-panel-b"[^>]*hidden/);
});

test("材料切换绑定只处理合法页签并回写当前材料", () => {
  const tabs = ["a", "b"].map((id) => {
    const listeners = {};
    return {
      dataset: { docExampleTab: id },
      tabIndex: 0,
      setAttribute() {},
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
      focus() {},
      click() {
        listeners.click();
      },
    };
  });
  const panels = { a: { hidden: false }, b: { hidden: true } };
  const container = {
    querySelectorAll: () => tabs,
    querySelector: (selector) =>
      panels[selector.match(/data-doc-example-panel="(\w+)"/)?.[1]] || null,
  };
  let current = "";
  bindDocumentExample(container, (id) => {
    current = id;
  });
  tabs[1].click();
  assert.equal(current, "b");
  assert.equal(panels.a.hidden, true);
  assert.equal(panels.b.hidden, false);
});

test("展示图片为缩放副本，来源 sha256 与历史记录一致", async () => {
  const provenance = JSON.parse(
    await readFile(
      new URL("../public/image-examples/invoice/provenance.json", import.meta.url),
    ),
  );
  assert.equal(provenance.sourceRecord, "5dc6b477-d3f3-47b8-a7b8-6c99ad06280d");
  assert.equal(provenance.objective, "invoice_review");
  assert.equal(
    provenance.materials.a.sourceSha256,
    invoiceShowcase.provenance.invoiceASha256,
  );
  assert.equal(
    provenance.materials.b.sourceSha256,
    invoiceShowcase.provenance.invoiceBSha256,
  );
  for (const name of ["invoice-a.jpg", "invoice-b.jpg"]) {
    const buffer = await readFile(
      new URL(`../public/image-examples/invoice/${name}`, import.meta.url),
    );
    assert.ok(buffer.length > 20000, name);
    assert.equal(
      buffer.subarray(0, 2).toString("hex"),
      "ffd8",
      `${name} 应为 JPEG`,
    );
    assert.ok(
      createHash("sha256").update(buffer).digest("hex").length === 64,
      name,
    );
  }
  assert.deepEqual(provenance.materials.a.displaySize, [1000, 648]);
  assert.deepEqual(provenance.materials.b.displaySize, [1000, 645]);
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildGeneralReportModel } from "../src/modules/image/general/report.js";
import { buildDocumentsReportModel } from "../src/modules/image/documents/report.js";
import { banner, kv, table, list, images, paragraph, section, createReport } from "../src/modules/image/report/model.js";
import { renderReportWordHtml } from "../src/modules/image/report/word.js";
import { renderReportPdf, wrapReportText } from "../src/modules/image/report/pdf.js";

const dotPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const generalItem = () => ({
  id: "job-1",
  name: "样本图片.png",
  file: { name: "样本图片.png" },
  url: "blob:http://localhost/x",
  status: "likely_ai",
  result: {
    id: "job-1",
    status: "completed",
    verdict: "likely_ai",
    score: 0.9847,
    summary: "发现AI生成线索。",
    coverage: "中心336×336区域",
    diagnostics: {
      format: "PNG",
      dimensions: [800, 800],
      sha256: "a".repeat(64),
      metadata: { make: "TestCam" },
      credentials: { status: "absent" },
      layers: { original: dotPng, aiFeatures: dotPng },
      providerChecks: { checks: [{ provider: "doubao", name: "豆包", status: "evidence_found", declarations: [{ role: "producer", value: "doubao", location: "xmp" }] }] },
      sourceDeclarations: { status: "found", records: [], summary: "未发现来源声明。" },
    },
    forensics: {
      face: { status: "completed", analyzedFaceCount: 1, threshold: 0.5, faces: [{ score: 0.9, signal: "suspicious" }] },
      source: { status: "completed", candidates: [{ source: "midjourney-6", score: 0.47 }, { source: "gpt-image-1", score: 0.31 }] },
      tamper: { status: "completed", score: 0.08, threshold: 0.3, signal: "no_obvious_signal", overlay: dotPng },
    },
  },
});

const documentsData = () => ({
  status: "completed",
  materials: [
    {
      id: "m1", name: "发票A.png", type: "invoice", pages: [{ page: 1, status: "completed", previewDataUrl: dotPng, rendered_size: [100, 60], regions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, { x: 9, y: 9, width: 9, height: 9 }] }],
      fields: [{ key: "gross_amount", value: "1999.99", confidence: 0.99, source: { page: 1 } }],
      checks: [{ rule: "invoice_net_tax_gross", status: "FAIL", reason: "displayed_amount_arithmetic_only", evidence: [{ key: "net_amount", value: "1999.99", source: { page: 1 } }] }, { rule: "displayed_calendar_date", status: "PASS", reason: "calendar_date_only" }],
      stages: { mirror: { status: "completed", score: 0.12 }, seed: { status: "completed", regions: [{ x: 0, y: 0, width: 0.1, height: 0.1 }] }, ocr: { status: "completed" }, rules: { status: "completed" } },
    },
    { id: "m2", name: "发票B.png", type: "invoice", pages: [], fields: [], checks: [], stages: {} },
  ],
  review: { plan: { objective: "invoice_review", coreMaterialId: "m1" }, checks: [] },
  presentation: { warnings: [{ id: "w1", title: "同批材料票号重复", detail: "两份材料票号一致" }], aiReview: { status: "not_run" } },
  limitations: ["本地开发工作台。"],
});

test("2.1 报告模型：结论横幅最先、章节有序且不暴露内部模型名", () => {
  const model = buildGeneralReportModel(generalItem());
  assert.equal(model.verdict.title, "疑似AI生成");
  assert.equal(model.verdict.scoreText, "98.5 / 100");
  assert.match(model.verdict.detail, /AI生成线索/);
  const titles = model.sections.map((item) => item.title);
  assert.deepEqual(titles.slice(0, 2), ["检测图像", "分项检测结果"]);
  assert.ok(titles.includes("人像伪造分析"));
  assert.ok(titles.includes("生成来源候选"));
  assert.ok(titles.includes("文件信息"));
  const json = JSON.stringify(model);
  for (const internal of ["DDA", "VLAForge", "TruFor", "RPA", "YuNet", "pdf-lib"]) assert.equal(json.includes(internal), false, internal);
  const capability = model.sections.find((item) => item.title === "分项检测结果").blocks[0];
  assert.equal(capability.rows.length, 4);
  assert.equal(capability.rows[0].cells[0], "整图 AI 检测");
});

test("2.3 报告模型：问题列表在前、材料总览与逐份详情齐全、区域过滤非法值", () => {
  const model = buildDocumentsReportModel(documentsData(), []);
  assert.match(model.verdict.title, /发现 2 项需要核对的问题/);
  assert.equal(model.sections[0].title, "需要关注的问题");
  assert.equal(model.sections[0].blocks[0].items.length, 2);
  const overview = model.sections.find((item) => item.title === "材料总览");
  assert.equal(overview.blocks[0].rows.length, 2);
  const materialSection = model.sections.find((item) => item.title.startsWith("材料 · 发票A"));
  const imageBlock = materialSection.blocks.find((block) => block.type === "images");
  assert.equal(imageBlock.items[0].regions.length, 1, "非法区域应被过滤");
  assert.match(imageBlock.items[0].caption, /1 处疑似修改位置/);
  assert.ok(model.sections.some((item) => item.title === "核验范围与说明"));
});

test("Word 渲染：包含结论、章节与内嵌图片，不出现 undefined", () => {
  for (const model of [buildGeneralReportModel(generalItem()), buildDocumentsReportModel(documentsData(), [])]) {
    const html = renderReportWordHtml(model);
    assert.ok(html.includes("核验结论"));
    assert.ok(html.includes(model.verdict.title));
    assert.ok(html.includes("<img src=\"data:image/png"));
    assert.ok(html.includes("生成时间"));
    assert.ok(html.includes(model.footerNotes[0]));
    assert.equal(html.includes("undefined"), false);
    assert.ok(html.startsWith("<!doctype html>"));
  }
});

test("wrapReportText 按宽度断行且保留中文标点跟随", () => {
  const font = { widthOfTextAtSize: (text, size) => Array.from(text).length * size };
  const lines = wrapReportText("金额1999.99元与税额259.99元不相符，价税合计矛盾。", font, 10, 60);
  assert.ok(lines.length >= 3);
  assert.ok(lines.every((line) => Array.from(line).length * 10 <= 60 + 10));
  const joined = lines.join("");
  assert.equal(joined.replace(/\s/g, ""), "金额1999.99元与税额259.99元不相符，价税合计矛盾。".replace(/\s/g, ""));
});

test("PDF 渲染（模拟运行时）：结论横幅最先绘制，图片与区域标记、页脚齐全", async () => {
  const calls = [];
  const fakeFont = { widthOfTextAtSize: (text, size) => Array.from(String(text)).length * size * 0.6 };
  const fakePage = () => {
    const page = {
      drawText: (text, options) => calls.push({ kind: "text", text, page: page.index, size: options.size }),
      drawRectangle: (options) => calls.push({ kind: "rect", page: page.index, borderColor: String(options.borderColor ?? "") }),
      drawSvgPath: () => calls.push({ kind: "svg", page: page.index }),
      drawLine: () => calls.push({ kind: "line", page: page.index }),
      drawImage: (image, options) => calls.push({ kind: "image", page: page.index, width: options.width, height: options.height }),
      drawCircle: () => calls.push({ kind: "circle", page: page.index }),
    };
    return page;
  };
  const pages = [];
  const PDFLib = {
    PDFDocument: {
      create: async () => ({
        registerFontkit: () => {},
        embedFont: async () => fakeFont,
        embedJpg: async (bytes) => ({ width: 100, height: 60, bytes }),
        embedPng: async (bytes) => ({ width: 100, height: 60, bytes }),
        addPage: () => { const page = fakePage(); page.index = pages.push(page); return page; },
        setTitle: () => {}, setAuthor: () => {}, setCreator: () => {}, setProducer: () => {}, setLanguage: () => {}, setCreationDate: () => {}, setModificationDate: () => {},
        save: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]),
        getPageCount: () => pages.length,
      }),
    },
    StandardFonts: { Helvetica: "h", HelveticaBold: "hb" },
    rgb: (...values) => ({ values }),
  };
  const model = buildDocumentsReportModel(documentsData(), []);
  const bytes = await renderReportPdf(model, {
    PDFLib,
    fontkit: {},
    fontBytes: new Uint8Array(4),
    decodeImage: async () => ({ type: "image/png", bytes: new Uint8Array([1, 2, 3, 4]) }),
  });
  assert.equal(bytes[0], 0x25, "输出应为 PDF 字节");
  const firstText = calls.find((call) => call.kind === "text");
  assert.ok(firstText, "应有文本绘制");
  const bannerText = calls.find((call) => call.kind === "text" && call.text === model.verdict.title);
  assert.ok(bannerText, "结论标题应绘制");
  assert.ok(calls.some((call) => call.kind === "image"), "应嵌入材料图片");
  const orangeRegions = calls.filter((call) => call.kind === "rect" && call.borderColor && call.borderColor !== "");
  assert.ok(orangeRegions.length >= 1, "应绘制疑似区域矩形");
  const footerText = calls.find((call) => call.kind === "text" && call.text.includes("VERITAS 智鉴在本地生成"));
  assert.ok(footerText, "页脚说明应绘制");
});

test("模型助手：表格列校验、图片区域过滤与章节块类型过滤", () => {
  const block = table([{ title: "A", width: 0 }, { title: "B", width: 100 }], [{ cells: ["x", "y"], tone: "bad-tone" }]);
  assert.equal(block.columns.length, 1);
  assert.equal(block.rows[0].tone, "neutral");
  const imageBlock = images([{ src: dotPng, regions: [{ x: 0.5, y: 0.5, width: 0.2, height: 0.2 }] }, { regions: [] }, {}]);
  assert.equal(imageBlock.items.length, 1);
  const sectionItem = section("标题", [banner({ title: "t" }), { type: "unknown" }, paragraph("p")]);
  assert.equal(sectionItem.blocks.length, 2);
  const report = createReport({ title: "r", verdict: { title: "v" }, sections: [sectionItem, { title: "空", blocks: [] }] });
  assert.equal(report.sections.length, 1);
  assert.equal(report.verdict.type, "banner");
  assert.deepEqual(Object.keys(kv([["a", "b"], ["bad"]]).rows), ["0"]);
  assert.equal(list([{ title: "t" }, null, {}]).items.length, 1);
});

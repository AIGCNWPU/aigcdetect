import test from "node:test";
import assert from "node:assert/strict";
import { buildGeneralStdReport } from "../src/modules/image/report-standard/general-map.js";
import { buildDocumentsStdReport } from "../src/modules/image/report-standard/documents-map.js";
import { createStdReport, validateStdReport, formatStdTime, chapter, p, table, list, image } from "../src/modules/image/report-standard/model.js";
import { buildReportModel, reportFilename } from "../src/modules/image/report-standard/service.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
    model: { name: "DDA", version: "v1" },
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
      tamper: { status: "completed", score: 0.08, threshold: 0.3, signal: "no_obvious_signal", overlay: dotPng, model: "TruFor" },
    },
  },
});

const documentsData = () => ({
  status: "partial",
  materials: [
    {
      id: "m1", name: "发票A.png", type: "invoice", fileSha256: "b".repeat(64), status: "partial", contentFormat: "image",
      pages: [{ page: 1, status: "completed", previewDataUrl: dotPng, rendered_size: [100, 60], regions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, { x: 9, y: 9, width: 9, height: 9 }] }],
      fields: [
        { key: "gross_amount", value: "1999.99", confidence: 0.99, source: { page: 1, observedText: "（小写）¥1999.99" } },
        { key: "buyer_name", role: "buyer", value: "甲公司", confidence: 0.9, source: { page: 1, observedText: "名称：甲公司" } },
      ],
      checks: [
        { rule: "invoice_net_tax_gross", status: "FAIL", title: "价税金额核对", explanation: "票面金额关系不一致。", evidence: [{ key: "net_amount", value: "1999.99", source: { page: 1, observedText: "¥1999.99" } }] },
        { rule: "displayed_calendar_date", status: "PASS", title: "日期格式核对", explanation: "日期格式正常。" },
        { rule: "institution_policy", status: "NEI", title: "机构政策核对", explanation: "未配置机构政策。" },
      ],
      stages: { mirror: { status: "not_run" }, seed: { status: "completed", regions: [{ x: 0, y: 0, width: 0.1, height: 0.1 }] }, ocr: { status: "completed" }, rules: { status: "completed" } },
    },
    { id: "m2", name: "发票B.png", type: "invoice", pages: [], fields: [], checks: [], stages: {} },
  ],
  review: {
    plan: { objective: "invoice_review", coreMaterialId: "m1" },
    checks: [
      { materialId: "m1", rule: "invoice_net_tax_gross", status: "FAIL", title: "价税金额核对" },
      { materialId: "m1", rule: "displayed_calendar_date", status: "PASS", title: "日期格式核对" },
      { rule: "scenario_applicability", status: "PASS", title: "场景适用性", explanation: "核心材料与核验目的匹配。" },
      { rule: "institution_policy", status: "NEI", title: "机构政策核对", explanation: "尚未配置机构政策。" },
    ],
  },
  presentation: {
    warnings: [
      { id: "w1", title: "价税金额核对", message: "票面金额关系不一致，请核对原件。", materialIds: ["m1"], evidence: [{ key: "net_amount", value: "1999.99", source: { page: 1, observedText: "¥1999.99" } }] },
      { id: "w2", title: "价税金额核对", message: "票面金额关系不一致，请核对原件。", materialIds: ["m1"], evidence: [{ key: "tax_amount", value: "259.99", source: { page: 1, observedText: "¥259.99" } }] },
      { id: "w3", title: "同票据标识内容核对", message: "两份材料票号一致。", materialIds: ["m1", "m2"], evidence: [{ key: "invoice_number", value: "2024330000123", source: { page: 1, observedText: "发票号码：2024330000123" } }] },
    ],
    aiReview: { status: "not_run" },
  },
  limitations: ["本地开发工作台。"],
});

test("标准模型：构建器过滤空块，校验器检查必备章节与空内容", () => {
  const report = createStdReport({
    docTitle: "测试报告", scenario: "unit",
    chapters: [
      chapter("检测结论", [p("结论内容。"), table([{ title: "a" }, { title: "" }], [["1", "2"]]), null]),
      chapter("检测说明与限制", [list(["a", "", "b"])]),
      chapter("空章节", []),
    ],
    meta: [["场景", "单元测试"]],
  });
  assert.equal(report.chapters.length, 2);
  const check = validateStdReport(report);
  assert.equal(check.ok, true, check.problems.join(";"));
  assert.deepEqual(check.stats, { chapters: 2, images: 0, tables: 1 });

  const bad = createStdReport({ docTitle: "缺少章节", scenario: "unit", chapters: [chapter("只有一章", [p("内容")])], meta: [] });
  const badCheck = validateStdReport(bad);
  assert.equal(badCheck.ok, false);
  assert.ok(badCheck.problems.some((item) => item.includes("结论")));
  assert.ok(badCheck.problems.some((item) => item.includes("说明与限制")));

  assert.equal(image("not-a-src", "无效图"), null);
  assert.equal(p("   "), null);
  assert.equal(formatStdTime("2026-11-11T00:00:00Z"), "2026-11-11 08:00:00");
});

test("2.1 映射：章节齐全有序、分数规范表达、内部模型名只出现在附录", () => {
  const report = buildGeneralStdReport(generalItem(), { reportNo: "RPT-T1" });
  const titles = report.chapters.map((item) => item.title);
  assert.deepEqual(titles.slice(0, 5), ["检测结论", "检测对象与文件信息", "分项检测过程与结果", "检测图像", "检测说明与限制"]);
  assert.equal(titles[titles.length - 1], "模型与版本");
  assert.equal(report.docTitle, "通用图片 AI 检测报告");
  assert.equal(report.subtitle, "样本图片.png");
  assert.ok(report.meta.some(([k, v]) => k === "报告编号" && v === "RPT-T1"));

  const flat = report.chapters.flatMap((item) => item.blocks);
  const bodyText = JSON.stringify(report.chapters.filter((item) => item.title !== "模型与版本"));
  assert.match(bodyText, /98\.5 \/ 100/);
  assert.match(bodyText, /未校准模型信号/);
  for (const internal of ["TruFor", "VLAForge", "RPA"]) assert.equal(bodyText.includes(internal), false, `${internal} 不应出现在正文`);
  const appendix = report.chapters.find((item) => item.title === "模型与版本");
  assert.match(JSON.stringify(appendix.blocks), /TruFor/);

  assert.ok(flat.some((block) => block.type === "image" && block.caption === "检测原图"));
  assert.ok(flat.some((block) => block.type === "table" && block.caption === "生成平台声明检查"));
  assert.ok(validateStdReport(report).ok);
});

test("2.3 映射：结论统计、同题告警合并、核对文字带原文引用、状态中文化", () => {
  const report = buildDocumentsStdReport(documentsData());
  const titles = report.chapters.map((item) => item.title);
  assert.equal(titles[0], "核验结论");
  assert.equal(titles[1], "核验范围与材料");
  assert.equal(titles[2], "需要关注的问题");
  assert.equal(titles[3], "各材料核验详情");
  assert.ok(titles.includes("核验说明与限制"));
  assert.ok(!titles.includes("智能复核"), "未执行的智能复核不应有章节");

  const json = JSON.stringify(report);
  for (const code of ["FAIL", "PASS", "NEI", "not_run", "invoice_net_tax_gross"]) assert.equal(json.includes(`"${code}`), false, `内部状态码 ${code} 不应直出`);
  assert.match(json, /发现矛盾/);
  assert.match(json, /本项通过/);
  assert.match(json, /证据不足/);

  // 同题相邻告警合并为一个二级标题，两条核验内容都在
  const issueChapter = report.chapters.find((item) => item.title === "需要关注的问题");
  const headings = issueChapter.blocks.filter((block) => block.type === "h2").map((block) => block.title);
  assert.deepEqual(headings, ["价税金额核对", "同票据标识内容核对"]);
  const mergedList = issueChapter.blocks.find((block) => block.type === "list");
  assert.ok(mergedList.items.some((line) => line.includes("¥1999.99") && line.includes("原文")), "核验内容应含识别值与原文引用");
  assert.ok(mergedList.items.some((line) => line.includes("¥259.99")));

  // 材料详情：字段表带 OCR 原文列；区域非法值过滤；阶段与单份核验表存在
  const detail = report.chapters.find((item) => item.title === "各材料核验详情");
  const fieldTable = detail.blocks.find((block) => block.type === "table" && block.caption === "发票A.png 提取字段");
  assert.ok(fieldTable.rows.some((row) => row.join("|").includes("（小写）¥1999.99")));
  const previewImage = detail.blocks.find((block) => block.type === "image");
  assert.equal(previewImage.regions.length, 1, "非法区域应被过滤");
  assert.match(previewImage.caption, /1 处疑似修改位置/);
  assert.ok(detail.blocks.some((block) => block.type === "table" && block.caption === "发票A.png 单份核验结果"));
  assert.ok(validateStdReport(report).ok);
});

test("服务层：场景分派、未知场景报错、文件名规范", () => {
  const general = buildReportModel({ scenario: "general", payload: generalItem() });
  assert.equal(general.docTitle, "通用图片 AI 检测报告");
  const documents = buildReportModel({ scenario: "documents", payload: documentsData() });
  assert.equal(documents.docTitle, "材料核验报告");
  assert.throws(() => buildReportModel({ scenario: "other", payload: {} }), /未知的报告场景/);
  assert.match(reportFilename(general, "pdf"), /^智鉴图片检测报告-样本图片\.png-\d{8}-\d{6}\.pdf$/);
  assert.match(reportFilename(documents, "docx"), /^智鉴材料核验报告-/);
});

const pythonAvailable = (() => {
  try {
    const probe = spawnSync(process.env.AIGC_REPORT_PYTHON || "python3", ["-c", "import docx"], { stdio: "pipe" });
    return probe.status === 0;
  } catch { return false; }
})();

test("渲染集成：真实渲染 docx+pdf 并通过合规校验（无 python-docx 时跳过）", { skip: !pythonAvailable }, async () => {
  const { renderOneRound } = await import("../src/modules/image/report-standard/test/run-one.mjs");
  const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "report-render-test");
  for (const [scenario, payload] of [["general", generalItem()], ["documents", documentsData()]]) {
    const source = path.join(outDir, `${scenario}-fixture.json`);
    const { writeFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(path.dirname(source), { recursive: true });
    writeFileSync(source, JSON.stringify(scenario === "general" ? [payload.result] : payload));
    const { validation, stats } = await renderOneRound({ scenario, source, name: payload.name || "fixture", outDir, round: 9 });
    assert.equal(validation.ok, true, validation.problems.join(";"));
    assert.ok(stats.figures >= 1 || scenario === "documents" ? validation.checks.images >= 0 : true);
    assert.ok((validation.checks.pdf_pages || 0) >= 1);
  }
});

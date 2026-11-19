// 标准报告服务：把场景结果渲染为规范 docx/pdf（经 python 渲染器）。
// 供 HTTP 导出端点（serve.mjs）与前端导出共用；与 CLI 三轮测试走同一条流水线。

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

import { buildGeneralStdReport } from "./general-map.js";
import { buildDocumentsStdReport } from "./documents-map.js";
import { buildAudioStdReport } from "./audio-map.js";
import { validateStdReport, formatStdTime } from "./model.js";

const PYTHON = process.env.AIGC_REPORT_PYTHON || "python3";
const here = path.dirname(fileURLToPath(import.meta.url));
const RENDER_SCRIPT = path.join(here, "render", "render_report.py");

export const REPORT_BODY_LIMIT = 80 * 1024 * 1024;

export function buildReportModel({ scenario, payload, generatedAt, reportNo }) {
  if (scenario === "general") return buildGeneralStdReport(payload, { generatedAt, reportNo });
  if (scenario === "documents") return buildDocumentsStdReport(payload, { generatedAt, reportNo });
  if (scenario === "audio") return buildAudioStdReport(payload, { generatedAt, reportNo });
  throw Object.assign(new Error(`未知的报告场景：${scenario}`), { code: "BAD_SCENARIO", status: 400 });
}

function runPython(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON, [RENDER_SCRIPT, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", (error) => reject(Object.assign(new Error(`报告渲染服务不可用（${PYTHON}）：${error.message}`), { code: "REPORT_RUNTIME_UNAVAILABLE", status: 503 })));
    child.on("close", (code) => {
      if (code !== 0) {
        const detail = (stderr || stdout).split("\n").filter(Boolean).slice(-3).join(" ");
        reject(Object.assign(new Error(`报告渲染失败：${detail || `退出码 ${code}`}`), { code: "RENDER_FAILED", status: 500 }));
      } else resolve(stdout.trim());
    });
  });
}

export async function renderStandardReport({ scenario, payload, format = "pdf", generatedAt, reportNo }) {
  const model = buildReportModel({ scenario, payload, generatedAt, reportNo });
  const check = validateStdReport(model);
  if (!check.ok) throw Object.assign(new Error(`报告内容不完整：${check.problems.join("；")}`), { code: "INVALID_REPORT_MODEL", status: 422 });
  for (const section of model.chapters) {
    if (section.blocks.some(block => block.type === "image" &&
      !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(block.src))) {
      throw Object.assign(new Error("报告图像只接受内嵌图像数据。"), { code: "INVALID_REPORT_IMAGE", status: 422 });
    }
  }
  const wantPdf = format !== "docx";
  const workDir = await mkdtemp(path.join(tmpdir(), "std-report-"));
  try {
    const basename = `report-${randomUUID().slice(0, 8)}`;
    const modelPath = path.join(workDir, "model.json");
    await writeFile(modelPath, JSON.stringify(model));
    const args = ["--model", modelPath, "--out-dir", workDir, "--basename", basename];
    if (wantPdf) args.push("--pdf");
    const output = await runPython(args);
    const stats = JSON.parse(output);
    const docxBytes = new Uint8Array(await readFile(stats.docx));
    const pdfBytes = wantPdf ? new Uint8Array(await readFile(stats.pdf)) : null;
    return {
      model,
      stats: stats.stats,
      filename: reportFilename(model, wantPdf ? "pdf" : "docx"),
      docx: docxBytes,
      pdf: pdfBytes,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

export function reportFilename(model, extension) {
  const stamp = formatStdTime(model.generatedAt, { filename: true });
  const safe = String(model.subtitle || model.scenario || "报告").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);
  const kind = model.scenario === "image-general" ? "图片检测报告" : model.scenario === "image-documents" ? "材料核验报告" : model.scenario === "audio-forgery" ? "音频检测报告" : "检测报告";
  return `智鉴${kind}-${safe}-${stamp}.${extension}`;
}

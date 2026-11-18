#!/usr/bin/env node
// 标准报告流水线命令行测试入口：
//   node run-one.mjs --scenario general --source <saved-result.json> --name <文件名> --out-dir <dir> [--round N]
// 流程：读取保存的检测结果 → 构建标准报告模型 → python 渲染 docx+pdf → python 合规校验。
// 前端 / HTTP 导出与本地三轮测试共用同一映射器与渲染器。

import { parseArgs } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildGeneralStdReport } from "../general-map.js";
import { buildDocumentsStdReport } from "../documents-map.js";
import { validateStdReport, formatStdTime } from "../model.js";

const PYTHON = process.env.AIGC_REPORT_PYTHON || "python3";
const here = path.dirname(fileURLToPath(import.meta.url));
const renderScript = path.join(here, "..", "render", "render_report.py");
const validateScript = path.join(here, "..", "render", "validate_report.py");

function runPython(script, args) {
  const result = spawnSync(PYTHON, [script, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`无法启动 ${PYTHON}：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${path.basename(script)} 失败：${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

export async function renderOneRound({ scenario, source, name, outDir, round = 1, generatedAt }) {
  await mkdir(outDir, { recursive: true });
  const raw = JSON.parse(await readFile(source, "utf8"));
  const reportNo = `RPT-${formatStdTime(generatedAt || new Date().toISOString(), { filename: true })}-${round}`;
  const options = { generatedAt: generatedAt || new Date().toISOString(), reportNo };
  const report = scenario === "general"
    ? buildGeneralStdReport({ name: name || raw?.name || "image.png", result: Array.isArray(raw) ? raw[0] : raw }, options)
    : buildDocumentsStdReport(raw, options);

  const modelCheck = validateStdReport(report);
  if (!modelCheck.ok) throw new Error(`模型校验未通过：${modelCheck.problems.join("；")}`);

  const basename = `round${round}-${scenario === "general" ? "general" : "documents"}`;
  const modelPath = path.join(outDir, `${basename}.model.json`);
  await writeFile(modelPath, JSON.stringify(report, null, 1));
  const stats = JSON.parse(runPython(renderScript, ["--model", modelPath, "--out-dir", outDir, "--basename", basename, "--pdf"]));

  const validation = JSON.parse(runPython(validateScript, [
    "--docx", stats.docx, "--pdf", stats.pdf, "--expect-title", report.docTitle,
  ]));
  return { report, stats: stats.stats, validation, files: { model: modelPath, docx: stats.docx, pdf: stats.pdf } };
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const { values } = parseArgs({
    options: {
      scenario: { type: "string" }, source: { type: "string" }, name: { type: "string" },
      "out-dir": { type: "string" }, round: { type: "string", default: "1" },
    },
  });
  if (values.scenario && values.source && values["out-dir"]) {
    renderOneRound({
      scenario: values.scenario, source: values.source, name: values.name,
      outDir: values["out-dir"], round: Number(values.round || 1),
    }).then(({ stats, validation }) => {
      console.log(JSON.stringify({ stats, validation }, null, 1));
      process.exit(validation.ok ? 0 : 1);
    }).catch((error) => { console.error(error.message); process.exit(1); });
  }
}

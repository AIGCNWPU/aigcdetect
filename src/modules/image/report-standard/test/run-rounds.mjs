#!/usr/bin/env node
// 标准报告三轮测试 harness：
//   node run-rounds.mjs [--out <dir>] [--keep-png]
// 对 2.1 / 2.3 各选 3 份服务器内部数据集的真实检测结果，逐轮
// 构建 → 渲染 docx+pdf → 合规校验 → 输出 manifest 与结论。
// 任何一轮校验不通过即整体失败（退出码 1）。

import { parseArgs } from "node:util";
import { mkdir, writeFile, readFile, cp } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

import { renderOneRound } from "./run-one.mjs";

// 服务器内部数据集（真实检测的保存结果）。覆盖：
//  2.1 R1 AI声明+人脸+来源候选齐全；R2 局部篡改可疑信号；R3 未见明显生成线索；
//  2.3 R1 双材料发票（15 项问题）；R2 单材料发票；R3 三材料混合。
const ROUNDS = {
  general: [
    { source: "/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews/general/6b36310d-4c17-4f01-a7ac-999fc16fc9fe/result.json", name: "doubao-declared.png", note: "AI声明优先+人脸5张+来源候选3" },
    { source: "/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews/general/2b15adc7-7224-4a14-96fb-59a72f60498d/result.json", name: "tamper-suspicious.png", note: "局部篡改线索可疑" },
    { source: "/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews/general/111df18a-f821-452a-82d0-87926a24e0fe/result.json", name: "no-obvious-ai.jpg", note: "未见明显生成线索" },
  ],
  documents: [
    { source: "/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews/5dc6b477-d3f3-47b8-a7b8-6c99ad06280d/result.json", name: "", note: "双材料发票·15项问题" },
    { source: "/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews/01289fbd-e50e-4b59-b741-1ba1b22be7cd/result.json", name: "", note: "单材料发票" },
    { source: "/sdb/data_public/lvjiawen/aigc_platform/runtime/reviews/3535d7f7-61c6-446b-96e5-bf0ac3a857a6/result.json", name: "", note: "数电发票+证明·无问题通过路径" },
  ],
};

async function main() {
  const { values } = parseArgs({
    options: {
      "out": { type: "string" },
      "png": { type: "boolean" },          // 渲染 PDF 首页为 PNG（视觉验收用）
      "png-pages": { type: "string", default: "1,3" },
    },
  });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const outDir = values.out || path.resolve("/sdb/data_public/lvjiawen/aigc_platform/runtime/test-artifacts", `report-standard-${stamp}`);
  await mkdir(outDir, { recursive: true });

  const manifest = { startedAt: new Date().toISOString(), rounds: [], allOk: true };
  for (const scenario of ["general", "documents"]) {
    for (let index = 0; index < ROUNDS[scenario].length; index += 1) {
      const config = ROUNDS[scenario][index];
      const round = index + 1;
      const roundDir = path.join(outDir, `${scenario}-round${round}`);
      const entry = { scenario, round, source: config.source, note: config.note };
      try {
        const raw = JSON.parse(await readFile(config.source, "utf8"));
        const generatedAt = new Date(Date.now() - (6 - (scenario === "general" ? 3 : 0) * 60000)).toISOString();
        const result = await renderOneRound({
          scenario, source: config.source, name: config.name || raw?.materials?.[0]?.name, outDir: roundDir, round, generatedAt,
        });
        entry.ok = result.validation.ok;
        entry.problems = result.validation.problems;
        entry.stats = {
          chapters: result.stats?.chapters,
          tables: result.stats?.tables,
          figures: result.validation.checks?.images ?? 0,
          pdfPages: result.validation.checks?.pdf_pages,
        };
        entry.files = result.files;
        if (values.png) {
          const pages = values["png-pages"].split(",").map((value) => value.trim()).filter(Boolean);
          for (const page of pages) {
            const prefix = path.join(roundDir, `page${page}`);
            const rendered = spawnSync("pdftoppm", ["-png", "-r", "80", "-f", page, "-l", page, "-singlefile", result.files.pdf, prefix], { stdio: "pipe" });
            if (rendered.status === 0) entry.png = [...(entry.png || []), `${prefix}.png`];
          }
        }
      } catch (error) {
        entry.ok = false;
        entry.error = error.message;
      }
      manifest.rounds.push(entry);
      manifest.allOk = manifest.allOk && entry.ok === true;
      console.log(`${entry.ok ? "PASS" : "FAIL"}  ${scenario} round${round}  ${entry.note}  (${entry.stats ? `chapters=${entry.stats.chapters} figures=${entry.stats.figures} tables=${entry.stats.tables} pdfPages=${entry.stats.pdfPages}` : entry.error})`);
    }
  }
  await writeFile(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
  console.log(`\n${manifest.allOk ? "三轮测试全部通过" : "存在失败轮次"} → ${outDir}`);
  process.exit(manifest.allOk ? 0 : 1);
}

main().catch((error) => { console.error(error); process.exit(1); });

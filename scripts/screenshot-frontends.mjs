#!/usr/bin/env node
// 前端截图：加载本地平台两个结果页（含真实示例数据），输出全页 PNG 供视觉审查。
// 用法：node scripts/screenshot-frontends.mjs [baseUrl] [outDir]
import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const base = process.argv[2] || "http://127.0.0.1:4173";
const outDir = process.argv[3] || path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tmp", "ux-screens");
import { fileURLToPath } from "node:url";
await mkdir(outDir, { recursive: true });

// 注入真实示例：直接打开页面并触发示例加载（documents 页有"查看真实材料核验示例"按钮，
// general 页有内置 showcase）。为稳定截图，直接截整页首屏 + 点击示例后的结果区。
const pages = [
  { name: "general-desktop", url: `${base}/#/image/general`, width: 1440, height: 900, fullPage: true },
  { name: "documents-desktop", url: `${base}/#/image/documents`, width: 1440, height: 900, fullPage: true },
];

const chrome = "/usr/bin/google-chrome";
for (const page of pages) {
  const out = path.join(outDir, `${page.name}.png`);
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox",
    `--window-size=${page.width},${page.height}`,
    "--virtual-time-budget=12000",
    "--hide-scrollbars", `--screenshot=${out}`, page.url,
  ];
  const r = spawnSync(chrome, args, { encoding: "utf8", timeout: 120000 });
  console.log(page.name, "->", out, r.status === 0 ? "ok" : `exit ${r.status}`);
}

// 点击示例后的 2.3 结果截图（用 ?example 直达参数；页面在 hash 路由内读取）
const exampleOut = path.join(outDir, "documents-result.png");
const r2 = spawnSync(chrome, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--window-size=1440,1600",
  "--virtual-time-budget=15000", "--hide-scrollbars", `--screenshot=${exampleOut}`,
  `${base}/#/image/documents`,
], { encoding: "utf8", timeout: 120000 });
console.log("documents-result ->", exampleOut, r2.status === 0 ? "ok" : `exit ${r2.status}`);

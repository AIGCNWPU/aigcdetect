#!/usr/bin/env node
// VERITAS MCP server（openspec refine-image-platform-ux T9）。
// 同一进程双模式：--stdio（本地客户端）或 --http --port（远程 streamable HTTP + APPCODE）。
// 5 个工具与市场 API 同源映射；输出"结论摘要置顶 + 结构化数据附后"。
// 零外部依赖：JSON-RPC 2.0 最小集（initialize / tools/list / tools/call）。

import { spawnSync } from "node:child_process";
import http from "node:http";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PY = process.env.AIGC_MARKET_PYTHON || "python3";
const MARKET = path.join(here, "market-api");

function marketCall(route, payload) {
  // 通过 uvicorn 子进程太重：直接以 --self-test 形式调用市场 API 内部逻辑不可行，
  // 因此 MCP server 以"市场 API HTTP 客户端"身份工作（upstream 指向平台或市场服务）。
  const base = process.env.AIGC_MCP_MARKET_BASE || "http://127.0.0.1:8091";
  const headers = { "Content-Type": "application/json", Authorization: `APPCODE ${process.env.AIGC_MCP_APPCODE || "dev-apicode"}` };
  const res = spawnSync("curl", ["-s", "--noproxy", "*", "-X", "POST", base + route,
    "-H", JSON.stringify(headers).replace(/"/g, '\\"'), "--data-binary", "@-"],
    { input: JSON.stringify(payload), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (res.error) throw new Error(`市场服务不可达：${res.error.message}`);
  const body = JSON.parse(res.stdout || "{}");
  if (body.code && body.code !== 200) throw new Error(body.msg || `市场返回 ${body.code}`);
  return body;
}

function summarizeGeneral(data) {
  const t = data.tamper || {};
  const lines = [
    `结论：${data.detectionResult === "ai_generated_declared" ? "AI 生成（文件内含生成声明）" : data.detectionResult === "suspected_ai_generated" ? "疑似 AI 生成" : data.detectionResult === "no_obvious_ai_evidence" ? "未见明显 AI 生成线索" : "未能判定"}`,
    data.aiScore ? `AI 来源信号 ${data.aiScore.score} / 100（未校准）` : "",
    t.detectionResult ? `局部篡改：${t.detectionResult === "suspicious" ? "发现疑似篡改线索" : t.detectionResult === "no_obvious_signal" ? "未见篡改线索" : "未执行"}${t.tamperScore != null ? `（篡改分 ${t.tamperScore}/100）` : ""}${(t.tamperedLocation || []).length ? `，${t.tamperedLocation.length} 处可定位区域` : ""}` : "",
    data.faceForgery?.status === "completed" ? `人像：分析 ${data.faceForgery.analyzedFaceCount} 张${data.faceForgery.detectionResult === "suspicious" ? "，发现疑似伪造" : ""}` : "",
    data.sourceCandidates?.candidates?.length ? `来源候选（闭集参考）：${data.sourceCandidates.candidates.slice(0, 3).map(c => c.source).join("、")}` : "",
    data.provenance?.aiDeclarationsFound ? "文件内含 AI 生成声明" : "",
  ];
  return lines.filter(Boolean).join("\n");
}

function summarizeDocuments(data) {
  const c = data.conclusion || {};
  const lines = [
    `核验目的：${data.objective || "材料核验"}｜结论：${c.result === "issues_found" ? `发现 ${c.issueCount} 项需关注问题` : c.result === "no_issues_found" ? "未发现问题" : "信息不足待确认"}`,
    `检查统计：矛盾 ${c.checkStats?.fail ?? 0} / 通过 ${c.checkStats?.pass ?? 0} / 证据不足 ${c.checkStats?.nei ?? 0}`,
  ];
  for (const issue of (data.issues || []).slice(0, 5)) {
    lines.push(`· ${issue.title}（${(issue.materials || []).join("、")}）：${(issue.message || "").slice(0, 80)}`);
  }
  if ((data.issues || []).length > 5) lines.push(`… 共 ${data.issues.length} 项，详见 structuredContent`);
  const ai = data.aiReview || {};
  if (ai.status === "completed") lines.push(`智能核验：${(ai.summary || "").slice(0, 160)}`);
  return lines.join("\n");
}

const TOOLS = [
  {
    name: "image_general_detect",
    description: "判断一张图片是否为 AI 生成，并同步检查局部篡改、人像伪造与生成来源（闭集参考）。适用于用户给出图片并要求鉴别真伪/来源的场景。图片建议以 imageUrl 提供以降低传输成本；分数为未校准模型信号。同步模式约 40–90 秒。",
    inputSchema: {
      type: "object",
      properties: {
        imageUrl: { type: "string", description: "图片 URL（与 image 二选一）" },
        image: { type: "string", description: "图片 base64（不带 data: 前缀，≤20MB）" },
        restrictProbability: { type: "number", description: "篡改区域置信度阈值 0~1，默认 0.5" },
        asyncSubmit: { type: "boolean", description: "true 时立即返回 taskNo，配合 image_general_task_result 轮询" },
      },
    },
    route: "/v1/image/general/detection",
    summarize: (d) => summarizeGeneral(d.data || {}),
  },
  {
    name: "image_general_task_result",
    description: "查询通用图片检测异步任务的结果（taskNo 来自 image_general_detect 的 asyncSubmit 提交）。",
    inputSchema: {
      type: "object",
      properties: { taskNo: { type: "string", description: "检测任务编号" } },
      required: ["taskNo"],
    },
    route: "/v1/image/general/detection/result",
    summarize: (d) => summarizeGeneral(d.data || {}),
  },
  {
    name: "document_review",
    description: "核验一批票据/证件/收据材料：篡改定位、字段提取与 OCR、算术与条款矛盾、跨材料比对、可选大模型智能核验。支持单材料鉴伪（mode=single，零散票据逐份独立）与多材料业务核验（mode=batch，需 coreMaterialIndex）。同步约 1–2 分钟。",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["single", "batch"], description: "single=零散票据逐份鉴伪；batch=围绕核心材料交叉核对" },
        objective: { type: "string", enum: ["invoice_review", "procurement_review", "merchant_reconciliation", "research_reimbursement", "identity_consistency"], description: "核验目的" },
        coreMaterialIndex: { type: "integer", description: "核心材料下标（batch 模式必填）" },
        materials: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" }, type: { type: "string", description: "auto=自动识别" },
              image: { type: "string", description: "图片 base64" }, imageUrl: { type: "string" },
              file: { type: "string", description: "PDF/DOCX base64" },
            },
          },
        },
        options: { type: "object", properties: { runModels: { type: "boolean" }, semanticReview: { type: "boolean" }, privacyMode: { type: "string", enum: ["redacted", "original"] } } },
        includeOverlay: { type: "boolean" },
        syncTimeoutSeconds: { type: "integer" },
      },
      required: ["materials"],
    },
    route: "/v1/document/review",
    summarize: (d) => summarizeDocuments(d.data || {}),
  },
  {
    name: "document_review_task_result",
    description: "查询材料核验异步任务的结果（taskNo 来自 document_review 的 asyncSubmit 提交）。",
    inputSchema: {
      type: "object",
      properties: { taskNo: { type: "string" }, includePreview: { type: "boolean" } },
      required: ["taskNo"],
    },
    route: "/v1/document/review/result",
    summarize: (d) => summarizeDocuments(d.data || {}),
  },
  {
    name: "document_extract_fields",
    description: "从单张票据/证件图片提取结构化字段（OCR，附识别置信度、页码与原文），不做核验判断。约 30 秒。",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "图片 base64" },
        imageUrl: { type: "string" },
        materialType: { type: "string", description: "invoice/receipt/identity/certificate/…" },
      },
    },
    route: "/v1/document/fields",
    summarize: (d) => {
      const m = (d.materials || [])[0] || {};
      const fields = (m.fields || []).slice(0, 12).map((f) => `${f.key}=${f.value}`).join("；");
      return `提取 ${m.fields?.length ?? 0} 个字段：${fields}`;
    },
  },
];

function callTool(name, args) {
  const tool = TOOLS.find((tool) => tool.name === name);
  if (!tool) throw new Error(`未知工具 ${name}`);
  const route = tool.route;
  if (route.startsWith("/v1/image")) {
    const bodyForm = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) bodyForm.set(key, String(value));
    const res = spawnSync("curl", ["-s", "--noproxy", "*", "-X", "POST", `${marketBase()}${route}`,
      "-H", `Authorization: APPCODE ${process.env.AIGC_MCP_APPCODE || "dev-apicode"}`,
      "-H", "Content-Type: application/x-www-form-urlencoded",
      "--data-binary", "@-"], { input: bodyForm.toString(), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
    const body = JSON.parse(res.stdout || "{}");
    if (body.code && body.code !== 200) throw new Error(body.msg || "调用失败");
    return { summary: tool.summarize(body.data || {}), structured: body };
  }
  const payloadIn = { ...args, asyncSubmit: false };
  const res = spawnSync("curl", ["-s", "--noproxy", "*", "-X", "POST", `${marketBase()}${route}`,
    "-H", `Authorization: APPCODE ${process.env.AIGC_MCP_APPCODE || "dev-apicode"}`,
    "-H", "Content-Type: application/json", "--data-binary", "@-"],
    { input: JSON.stringify(payloadIn), encoding: "utf8", timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  const body = JSON.parse(res.stdout || "{}");
  if (body.code && body.code !== 200) throw new Error(body.msg || "调用失败");
  return { summary: tool.summarize(body.data || {}), structured: body };
}

let marketBaseCache = "";
function marketBase() {
  return marketBaseCache || (marketBaseCache = process.env.AIGC_MCP_MARKET_BASE || "http://127.0.0.1:8091");
}

function toolResult(payload) {
  return {
    content: [{ type: "text", text: payload.summary || "调用完成，但未能生成摘要；详见 structuredContent。" }],
    structuredContent: payload.structured,
  };
}

process.on("uncaughtException", (error) => {
  // stdio 模式下进程崩溃会让客户端失联；记录并保活（stdout 交给 JSON-RPC 协议）。
  process.stderr.write(`[mcp] uncaught: ${error && error.stack ? error.stack.slice(0, 400) : error}\n`);
});

function handleRpc(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion || "2025-03-26",
      capabilities: { tools: {} },
      serverInfo: { name: "veritas-image-mcp", version: "1.0.0" },
    } };
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
  }
  if (method === "tools/call") {
    try {
      const payload = toolResult(callTool(params.name, params.arguments || {}));
      return { jsonrpc: "2.0", id, result: { ...payload, isError: false } };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `调用失败：${error.message}` }], isError: true } };
    }
  }
  if (id !== undefined) return { jsonrpc: "2.0", id, error: { code: -32601, message: `未知方法 ${method}` } };
  return null;
}

function readArgs() {
  const args = process.argv.slice(2);
  return {
    stdio: args.includes("--stdio") || !args.includes("--http"),
    http: args.includes("--http"),
    port: Number(args[args.indexOf("--port") + 1] ?? process.env.AIGC_MCP_PORT ?? 8620),
  };
}

const args = readArgs();
if (args.http) {
  const checkAuth = (headers) => {
    const code = (headers.authorization || "").replace(/^APPCODE\s*/i, "").trim();
    const allowed = (process.env.AIGC_MARKET_API_APPCODES || "dev-apicode").split(",").map((s) => s.trim());
    return allowed.includes(code);
  };
  http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", service: "veritas-mcp" }));
    }
    if (req.method !== "POST" || !req.url.startsWith("/mcp")) { res.writeHead(404); return res.end(); }
    if (!checkAuth(req.headers)) { res.writeHead(401); return res.end(JSON.stringify({ error: "unauthorized" })); }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let reply = null;
      try { reply = handleRpc(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) { reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: String(error) } }; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply ?? { jsonrpc: "2.0", method: "notifications/initialized" }));
    });
  }).listen(args.port, "127.0.0.1", () => console.log(`[mcp] http 127.0.0.1:${args.port}/mcp`));
} else {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      let reply = null;
      try { reply = handleRpc(JSON.parse(line)); } catch (error) { reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: String(error) } }; }
      if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
    }
  });
}

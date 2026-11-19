#!/usr/bin/env node
// VERITAS 智鉴 MCP server —— 只暴露 2.1 通用图片 与 2.3 证件票据 两个子模块。
//
// 设计要点：
//  1. 按子模块命名工具（image_general_* / image_documents_*），一个子模块一组，
//     不把内部阶段（规则引擎/模型阶段）暴露成工具。
//  2. 零外部依赖，Node >=20：stdio 与 streamable HTTP 双模式，用全局 fetch 调市场层。
//  3. 双层脱敏：市场层 envelope 出口已剥离内部字段，这里再做一次防御性投影，
//     保证 structuredContent 里不会出现模型名/权重指纹/阈值/引擎版本。
//  4. 不暴露调参入口（阈值/区域数/图层），避免把内部工作点变成调用方可变项。

import http from "node:http";
import process from "node:process";

const MARKET_BASE = (process.env.AIGC_MCP_MARKET_BASE || "http://127.0.0.1:8091").replace(/\/$/, "");
const APPCODE = process.env.AIGC_MCP_APPCODE || "dev-apicode";
const CALL_TIMEOUT_MS = Number(process.env.AIGC_MCP_CALL_TIMEOUT_MS || 300000);

// 与 market-api/public.py 的 INTERNAL_KEYS 保持同步：双保险，任一环节漏剥都能兜住。
const INTERNAL_KEYS = new Set([
  "engine", "model", "modelId", "model_id", "modelVersion", "model_version",
  "engineVersion", "engine_version", "batchVersion", "batch_version",
  "weightsSha256", "weights_sha256", "weights", "checkpoint", "checkpointSha256",
  "threshold", "thresholds", "semanticReviewEngine", "semanticReviewModel",
  "promptVersion", "prompts",
]);
const ALLOW_KEYS = new Set(["calibration", "semantics", "signal", "dataSource"]);

export function stripInternal(value) {
  if (Array.isArray(value)) return value.map(stripInternal);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (ALLOW_KEYS.has(key)) { out[key] = stripInternal(item); continue; }
      if (INTERNAL_KEYS.has(key)) continue;
      out[key] = stripInternal(item);
    }
    return out;
  }
  return value;
}

async function marketCall(route, payload, { form = false } = {}) {
  const headers = { Authorization: `APPCODE ${APPCODE}` };
  let body;
  if (form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(Object.entries(payload).filter(([, v]) => v !== undefined && v !== null)).toString();
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(payload);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(MARKET_BASE + route, { method: "POST", headers, body, signal: controller.signal });
  } catch (error) {
    throw new Error(`检测服务不可达：${error.name === "AbortError" ? "调用超时" : "网络错误"}`);
  } finally {
    clearTimeout(timer);
  }
  let parsed;
  try { parsed = await response.json(); } catch { throw new Error("检测服务返回非 JSON 响应"); }
  if (!response.ok || (parsed.code && parsed.code !== 200)) {
    throw new Error(parsed.msg || `检测服务返回 ${response.status}`);
  }
  return stripInternal(parsed);
}

// ---------------------------------------------------------------- 摘要（给客户端 LLM 直接引用）

function summarizeGeneral(data = {}) {
  const verdict = {
    ai_generated_declared: "AI 生成（文件内含生成声明）",
    suspected_ai_generated: "疑似 AI 生成",
    no_obvious_ai_evidence: "未见明显 AI 生成线索",
  }[data.detectionResult] || "未能判定";
  const lines = [`结论：${verdict}`];
  if (data.aiScore?.score != null) lines.push(`AI 来源信号 ${data.aiScore.score} / 100（未校准，不代表真实概率）`);
  const tamper = data.tamper || {};
  if (tamper.detectionResult) {
    const label = { suspicious: "发现疑似局部篡改线索", no_obvious_signal: "未见明显篡改线索", inconclusive: "结论不明确" }[tamper.detectionResult] || "未执行";
    const count = (tamper.tamperedLocation || []).length;
    lines.push(`局部篡改：${label}${count ? `，${count} 处可定位区域` : ""}`);
  }
  if (data.faceForgery?.status === "completed") {
    lines.push(`人像：分析 ${data.faceForgery.analyzedFaceCount ?? 0} 张${data.faceForgery.detectionResult === "suspicious" ? "，发现疑似伪造" : ""}`);
  }
  const candidates = data.sourceCandidates?.candidates || [];
  if (candidates.length) lines.push(`来源候选（闭集参考，非确定归属）：${candidates.slice(0, 3).map((c) => c.source).join("、")}`);
  if (data.provenance?.aiDeclarationsFound) lines.push("文件内含 AI 生成声明");
  return lines.join("\n");
}

function summarizeDocuments(data = {}) {
  const conclusion = data.conclusion || {};
  const resultLabel = {
    issues_found: `发现 ${conclusion.issueCount ?? 0} 项需关注问题`,
    no_issues_found: "未发现问题",
  }[conclusion.result] || "信息不足待确认";
  const stats = conclusion.checkStats || {};
  const lines = [
    `核验目的：${data.objective || "材料核验"}｜结论：${resultLabel}`,
    `检查统计：矛盾 ${stats.fail ?? 0} / 通过 ${stats.pass ?? 0} / 证据不足 ${stats.nei ?? 0}`,
  ];
  for (const issue of (data.issues || []).slice(0, 5)) {
    const materials = (issue.materials || []).join("、");
    lines.push(`· ${issue.title}${materials ? `（${materials}）` : ""}：${(issue.message || "").slice(0, 80)}`);
  }
  if ((data.issues || []).length > 5) lines.push(`… 共 ${data.issues.length} 项，详见 structuredContent`);
  if (data.aiReview?.status === "completed") lines.push(`智能核验：${(data.aiReview.summary || "").slice(0, 160)}`);
  return lines.join("\n");
}

function summarizeFields(data = {}) {
  const material = (data.materials || [])[0] || {};
  const fields = (material.fields || []);
  const preview = fields.slice(0, 12).map((f) => `${f.key}=${f.value}`).join("；");
  return `提取 ${fields.length} 个字段${preview ? `：${preview}` : ""}`;
}

// ---------------------------------------------------------------- 工具定义（2.1 / 2.3）

export const TOOLS = [
  {
    name: "image_general_detect",
    description: "【2.1 通用AI生成图片检测】判断一张图片是否由 AI 生成，同时给出局部篡改线索、人像伪造分析与生成来源候选（闭集参考）。适用于用户给出图片并要求鉴别真伪、判断是否 P 图、识别换脸或来源的场景。图片建议用 imageUrl 降低传输成本；分数为未校准信号，不可当作真实概率。同步等待通常 20–90 秒；超时可用 asyncSubmit 后轮询 image_general_result。",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "图片 base64（不带 data: 前缀；与 imageUrl 二选一，≤20MB）" },
        imageUrl: { type: "string", description: "图片可下载 URL（与 image 二选一，优先使用）" },
        asyncSubmit: { type: "boolean", description: "true 时立即返回 taskNo，用 image_general_result 轮询" },
      },
    },
    route: "/v1/image/general/detection",
    summarize: summarizeGeneral,
  },
  {
    name: "image_general_result",
    description: "【2.1】按 taskNo 查询通用图片检测任务的结果（taskNo 来自 image_general_detect 的 asyncSubmit 提交）。",
    inputSchema: {
      type: "object",
      properties: { taskNo: { type: "string", description: "检测任务编号" } },
      required: ["taskNo"],
    },
    route: "/v1/image/general/detection/result",
    summarize: summarizeGeneral,
  },
  {
    name: "image_documents_review",
    description: "【2.3 证件与票据材料核验】核验一批票据/证件/合同材料：局部篡改定位、文字与字段提取、算术与条款矛盾、跨材料交叉核对，可选智能核验。两种用法：mode=single 逐份独立鉴伪（零散票据）；mode=batch 围绕一份核心材料交叉核对（需 coreMaterialIndex）。结论按“需要关注的问题”返回，信息不足会显式标为待确认而不是判通过。同步通常 1–2 分钟；建议 asyncSubmit 后轮询 image_documents_result。",
    inputSchema: {
      type: "object",
      properties: {
        mode: { type: "string", enum: ["single", "batch"], description: "single=逐份独立鉴伪；batch=围绕核心材料交叉核对" },
        objective: {
          type: "string",
          enum: ["invoice_review", "procurement_review", "merchant_reconciliation", "research_reimbursement", "identity_consistency"],
          description: "核验目的：发票核验/采购履约/收付款核对/科研报销/身份一致性",
        },
        coreMaterialIndex: { type: "integer", description: "核心材料下标（batch 模式必填）" },
        materials: {
          type: "array",
          description: "材料列表（1–10 份）",
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "文件名（用于结果里指代材料）" },
              type: { type: "string", description: "材料类型，auto=自动识别" },
              image: { type: "string", description: "图片 base64" },
              imageUrl: { type: "string", description: "图片 URL（与 image 二选一）" },
              file: { type: "string", description: "PDF/DOCX 文件 base64" },
            },
          },
        },
        semanticReview: { type: "boolean", description: "是否启用智能核验（多轮取证）。默认 false，开启会增加耗时与外部调用" },
        privacyMode: { type: "string", enum: ["redacted", "original"], description: "智能核验内容处理：redacted=脱敏（默认）；original=原文" },
        asyncSubmit: { type: "boolean", description: "true 时立即返回 taskNo，用 image_documents_result 轮询" },
      },
      required: ["materials"],
    },
    route: "/v1/document/review",
    summarize: summarizeDocuments,
  },
  {
    name: "image_documents_result",
    description: "【2.3】按 taskNo 查询材料核验任务的结果（taskNo 来自 image_documents_review 的 asyncSubmit 提交）。",
    inputSchema: {
      type: "object",
      properties: { taskNo: { type: "string", description: "核验任务编号" } },
      required: ["taskNo"],
    },
    route: "/v1/document/review/result",
    summarize: summarizeDocuments,
  },
  {
    name: "image_documents_fields",
    description: "【2.3】从单张票据/证件图片提取结构化字段（OCR，附识别置信度与页码），不做核验判断。适用于用户只想把票面信息读成结构化数据、不需要真伪结论的场景。约 30 秒。",
    inputSchema: {
      type: "object",
      properties: {
        image: { type: "string", description: "图片 base64（与 imageUrl 二选一）" },
        imageUrl: { type: "string", description: "图片 URL（与 image 二选一）" },
        materialType: { type: "string", description: "材料类型提示：invoice/receipt/identity/certificate/contract/…，不确定可留空" },
      },
    },
    route: "/v1/document/fields",
    summarize: summarizeFields,
  },
];

// ---------------------------------------------------------------- 调用与协议

async function callTool(name, args = {}) {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) throw new Error(`未知工具：${name}`);

  if (tool.route.startsWith("/v1/image")) {
    const payload = {};
    if (args.image) payload.image = args.image;
    if (args.imageUrl) payload.imageUrl = args.imageUrl;
    if (!payload.image && !payload.imageUrl) throw new Error("缺少 image 或 imageUrl");
    if (args.asyncSubmit) payload.asyncSubmit = "true";
    const body = await marketCall(tool.route, payload, { form: true });
    return { summary: tool.summarize(body.data || {}), structured: body };
  }

  if (tool.route === "/v1/document/fields") {
    const payload = {};
    if (args.image) payload.image = args.image;
    if (args.imageUrl) payload.imageUrl = args.imageUrl;
    if (!payload.image && !payload.imageUrl) throw new Error("缺少 image 或 imageUrl");
    if (args.materialType) payload.materialType = args.materialType;
    const body = await marketCall(tool.route, payload);
    return { summary: tool.summarize(body.data || {}), structured: body };
  }

  const materials = Array.isArray(args.materials) ? args.materials : [];
  if (!materials.length) throw new Error("缺少 materials");
  const mode = args.mode === "batch" ? "batch" : "single";
  const payload = {
    mode,
    objective: args.objective,
    materials,
    options: {
      runModels: true,
      semanticReview: args.semanticReview === true,
      privacyMode: args.privacyMode === "original" ? "original" : "redacted",
      renderWord: false,
    },
  };
  if (mode === "batch") {
    if (!Number.isInteger(args.coreMaterialIndex)) throw new Error("batch 模式必须提供 coreMaterialIndex");
    payload.coreMaterialIndex = args.coreMaterialIndex;
  }
  if (args.asyncSubmit) payload.asyncSubmit = true;
  const body = await marketCall(tool.route, payload);
  return { summary: tool.summarize(body.data || {}), structured: body };
}

function toolResult(payload) {
  return {
    content: [{ type: "text", text: payload.summary || "调用完成，详见 structuredContent。" }],
    structuredContent: stripInternal(payload.structured),
  };
}

function handleRpc(message) {
  const { id, method, params } = message || {};
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: {
      protocolVersion: params?.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "veritas-image-mcp", version: "2.0.0" },
      instructions: "本服务提供 2.1 通用AI生成图片检测与 2.3 证件票据材料核验。图片/材料通过 base64 或 URL 提供；分数为未校准模型信号。",
    } };
  }
  if (method === "notifications/initialized" || method === "notifications/cancelled") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } };
  }
  if (method === "tools/call") {
    return (async () => {
      try {
        const payload = toolResult(await callTool(params?.name, params?.arguments || {}));
        return { jsonrpc: "2.0", id, result: { ...payload, isError: false } };
      } catch (error) {
        return { jsonrpc: "2.0", id, result: {
          content: [{ type: "text", text: `调用失败：${error.message}` }],
          isError: true,
        } };
      }
    })();
  }
  return id === undefined ? null : { jsonrpc: "2.0", id, error: { code: -32601, message: `未知方法：${method}` } };
}

async function dispatch(message) {
  return await handleRpc(message);
}

function startHttp(port) {
  const allowed = (process.env.AIGC_MARKET_API_APPCODES || process.env.AIGC_MCP_APPCODES || "dev-apicode")
    .split(",").map((item) => item.trim()).filter(Boolean);
  const authorized = (headers) => {
    const code = String(headers.authorization || "").replace(/^APPCODE\s*/i, "").trim();
    return allowed.includes(code);
  };
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ status: "ok", service: "veritas-image-mcp", tools: TOOLS.length }));
    }
    if (!req.url.startsWith("/mcp")) { res.writeHead(404); return res.end(); }
    // 防 DNS rebinding：只接受同源或非浏览器调用（无 Origin）。
    const origin = req.headers.origin;
    if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "origin_not_allowed" }));
    }
    if (!authorized(req.headers)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "unauthorized" }));
    }
    if (req.method !== "POST") { res.writeHead(405); return res.end(); }
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > 64 * 1024 * 1024) { req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      let reply;
      try { reply = await dispatch(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (error) { reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: String(error) } }; }
      if (!reply) { res.writeHead(202); return res.end(); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  server.listen(port, "127.0.0.1", () => process.stderr.write(`[mcp] http://127.0.0.1:${port}/mcp\n`));
  return server;
}

function startStdio() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      (async () => {
        let reply;
        try { reply = await dispatch(JSON.parse(line)); }
        catch (error) { reply = { jsonrpc: "2.0", id: null, error: { code: -32700, message: String(error) } }; }
        if (reply) process.stdout.write(JSON.stringify(reply) + "\n");
      })();
    }
  });
}

const argv = process.argv.slice(2);
if (argv.includes("--http")) {
  startHttp(Number(argv[argv.indexOf("--port") + 1] || process.env.AIGC_MCP_PORT || 8620));
} else {
  startStdio();
}

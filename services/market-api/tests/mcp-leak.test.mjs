import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, "..", "mcp_server.mjs");

// 故意在响应里埋满内部字段：市场层应剥一次、MCP 层再剥一次。
const LEAKY_GENERAL = {
  code: 200, msg: "成功", success: true, taskNo: "T-GEN-1",
  data: {
    detectionResult: "suspected_ai_generated",
    aiScore: { score: 88, semantics: "uncalibrated_model_signal", coverage: "整图" },
    tamper: {
      detectionResult: "suspicious", tamperScore: 46, threshold: 0.2,
      tamperedLocation: [{ left: 10, top: 20, width: 30, height: 40 }],
    },
    faceForgery: { status: "completed", analyzedFaceCount: 1, detectionResult: "suspicious", threshold: 0.5, model: "VLAForge", weightsSha256: "abc123def456" },
    sourceCandidates: { status: "completed", candidates: [{ source: "midjourney-6", score: 0.47 }], model: "RPA OpenFake27" },
    providerChecks: [{ provider: "doubao", status: "evidence_found" }],
    image: { format: "PNG", width: 800, height: 800, sha256: "a".repeat(64) },
    engine: { wholeImage: "DDA-H+", tamper: "TruFor · weights abc123…", engineVersion: "x/1.0" },
    model: { name: "DDA-H+", weightsSha256: "deadbeef", threshold: 0.25 },
    timing: { seconds: 12.5 },
  },
};

const LEAKY_DOCUMENTS = {
  code: 200, msg: "成功", success: true, taskNo: "T-DOC-1",
  data: {
    objective: "发票核验",
    conclusion: { result: "issues_found", issueCount: 1, checkStats: { fail: 1, pass: 3, nei: 0 } },
    issues: [{ title: "价税合计与金额税额不符", message: "金额与税额之和不等于价税合计", materials: ["E01.png"] }],
    engine: { engineVersion: "core-material-review/0.1", batchVersion: "material-batch/0.3", semanticReviewEngine: "claude-agent-sdk", semanticReviewModel: "deepseek-flash" },
    aiReview: { status: "completed", summary: "金额存在矛盾", modelVersion: "deepseek-flash" },
    materials: [{ name: "E01.png", stages: { seed: { status: "completed", threshold: 0.35, model: "SEED" } } }],
    limitations: ["本地工作台"],
  },
};

const FORBIDDEN_TOKENS = ["DDA", "TruFor", "SEED", "VLAForge", "OpenFake", "deepseek", "claude", "weights", "checkpoint", "agent-sdk"];
const FORBIDDEN_KEYS = ["engine", "model", "threshold", "thresholds", "weightsSha256", "engineVersion", "batchVersion", "semanticReviewModel", "modelVersion"];

function startStub() {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = req.url.includes("/v1/document/") ? LEAKY_DOCUMENTS : LEAKY_GENERAL;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  return server;
}

function collectKeys(value, out = []) {
  if (Array.isArray(value)) { for (const item of value) collectKeys(item, out); return out; }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) { out.push(key); collectKeys(item, out); }
  }
  return out;
}

async function withMcp(fn) {
  const stub = startStub();
  stub.listen(0, "127.0.0.1");
  await once(stub, "listening");
  const stubPort = stub.address().port;
  const child = spawn(process.execPath, [SERVER, "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, AIGC_MCP_MARKET_BASE: `http://127.0.0.1:${stubPort}`, AIGC_MCP_APPCODE: "dev-apicode", no_proxy: "*" },
  });
  let buffer = "";
  const queue = [];
  const waiters = [];
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      const parsed = JSON.parse(line);
      if (waiters.length) waiters.shift()(parsed); else queue.push(parsed);
    }
  });
  const rpc = (message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP 响应超时")), 20000);
    const done = (value) => { clearTimeout(timer); resolve(value); };
    if (queue.length) done(queue.shift());
    else waiters.push(done);
    child.stdin.write(JSON.stringify(message) + "\n");
  });
  try {
    await fn({ rpc, child });
  } finally {
    child.kill();
    stub.close();
  }
}

test("tools/list 只暴露 2.1 与 2.3 两个子模块的五个工具", async () => {
  await withMcp(async ({ rpc }) => {
    const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    assert.equal(init.result.serverInfo.name, "veritas-image-mcp");
    assert.ok(init.result.capabilities.tools);
    const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = list.result.tools.map((tool) => tool.name);
    assert.deepEqual(names, [
      "image_general_detect",
      "image_general_result",
      "image_documents_review",
      "image_documents_result",
      "image_documents_fields",
    ]);
    for (const tool of list.result.tools) {
      const text = JSON.stringify(tool);
      for (const token of FORBIDDEN_TOKENS) assert.equal(text.includes(token), false, `${tool.name} 描述泄露 ${token}`);
    }
  });
});

test("2.1 工具输出零内部字段：engine/model/阈值/权重名全部剥离", async () => {
  await withMcp(async ({ rpc }) => {
    const reply = await rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "image_general_detect", arguments: { image: "aGVsbG8=" } } });
    assert.equal(reply.result.isError, false);
    const payload = JSON.stringify(reply.result);
    for (const token of FORBIDDEN_TOKENS) assert.equal(payload.includes(token), false, `输出泄露 ${token}`);
    for (const key of FORBIDDEN_KEYS) assert.equal(collectKeys(reply.result.structuredContent).includes(key), false, `输出含内部键 ${key}`);
    // 业务字段必须完整保留
    const data = reply.result.structuredContent.data;
    assert.equal(data.detectionResult, "suspected_ai_generated");
    assert.equal(data.aiScore.score, 88);
    assert.equal(data.tamper.tamperedLocation.length, 1);
    assert.equal(data.image.sha256.length, 64);
    // 文件内的 AI 生成声明是公开证据，不能被过度剥离
    assert.equal(data.providerChecks[0].provider, "doubao");
    assert.match(reply.result.content[0].text, /疑似 AI 生成/);
  });
});

test("2.3 工具输出零内部字段：复核引擎与阈值不出现", async () => {
  await withMcp(async ({ rpc }) => {
    const reply = await rpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "image_documents_review", arguments: { mode: "single", materials: [{ name: "E01.png", image: "aGVsbG8=" }] } } });
    assert.equal(reply.result.isError, false);
    const payload = JSON.stringify(reply.result);
    for (const token of FORBIDDEN_TOKENS) assert.equal(payload.includes(token), false, `输出泄露 ${token}`);
    const keys = collectKeys(reply.result.structuredContent);
    for (const key of FORBIDDEN_KEYS) assert.equal(keys.includes(key), false, `输出含内部键 ${key}`);
    assert.equal(reply.result.structuredContent.data.conclusion.result, "issues_found");
    assert.match(reply.result.content[0].text, /需关注问题/);
  });
});

test("参数缺失与未知工具返回 isError 而不是抛异常终止进程", async () => {
  await withMcp(async ({ rpc }) => {
    const missing = await rpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "image_general_detect", arguments: {} } });
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /缺少 image/);
    const unknown = await rpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "video_detect", arguments: {} } });
    assert.equal(unknown.result.isError, true);
    assert.match(unknown.result.content[0].text, /未知工具/);
    const batch = await rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "image_documents_review", arguments: { mode: "batch", materials: [{ image: "aGVsbG8=" }] } } });
    assert.equal(batch.result.isError, true);
    assert.match(batch.result.content[0].text, /coreMaterialIndex/);
  });
});

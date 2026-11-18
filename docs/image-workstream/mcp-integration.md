# MCP 接入调研与实施结论（openspec refine-image-platform-ux T8/T9）

> 2026-11-18 · 回答师兄两个问题：①MCP 接入的模式与方法；②我们的算法能否在 MCP 生态里被"推荐"。

## 1. MCP 是什么、为什么接

Model Context Protocol：Anthropic 开放的客户端—工具协议，被 Claude Desktop/Code、Cursor、Windsurf 及
大量自建 Agent 采用。接成 MCP server 后，用户在**对话里说"帮我查这张发票"**，客户端 LLM 会依据
工具描述自动选择并调用我们的检测——这是把平台能力送进"Agent 自动推荐"入口的最短路径。

## 2. 接入模式（两种，同一 server 双支持）

| 模式 | 适用 | 说明 |
| --- | --- | --- |
| **stdio** | 本地 CLI / Claude Desktop / IDE 插件 | MCP 客户端把 server 作为子进程拉起，stdin/stdout JSON-RPC；零网络配置 |
| **Streamable HTTP** | 远程共享 / 团队部署 | server 常驻 HTTP 端点（`/mcp`），支持多客户端与鉴权头；我们复用 APPCODE |

协议要点（2025-03-26 spec 起）：`initialize` 握手 → `tools/list` 声明工具与 JSON Schema 入参 →
`tools/call` 执行。工具输出为 `content[]`（text/图片）+ `structuredContent`（机器可读）。

## 3. "能否取得较高的算法推荐"——取决于三件事

1. **工具描述质量**：客户端 LLM 完全依据 `description` 决定何时调用。描述必须写清
   适用场景（"用户给出疑似 AI 生成图片/要求鉴别真伪时"）、输入约束、能力边界（未校准、闭集归因）。
2. **工具粒度**：按任务而非按内部阶段暴露（检测/查询/字段提取 5 个工具），名称用任务语言
   （`document_review` 而非 `run_rules_engine`）。
3. **返回结构**：结论摘要置顶的纯文本（LLM 直接引用）+ structuredContent（程序消费），
   避免客户端需要二次整理大 JSON。

## 4. 工具面（与市场 API 同源映射，共用 mapper）

| Tool | 描述要点 | 后端 |
| --- | --- | --- |
| `image_general_detect` | 用户给图片要求判断是否 AI 生成；base64/URL；返回结论+分数+篡改区域 | `/v1/image/general/detection` |
| `image_general_task_result` | 查询异步任务结果 | `/result` |
| `document_review` | 多张票据/证件核验（矛盾、篡改、字段）；单/多材料模式 | `/v1/document/review` |
| `document_review_task_result` | 查询核验结果 | `/result` |
| `document_extract_fields` | 只要 OCR 字段不要核验 | `/v1/document/fields` |

## 5. 实现

`services/market-api/mcp_server.mjs`（零依赖，实现 MCP JSON-RPC 最小集）：
- `node mcp_server.mjs --http --port 8620` → streamable HTTP（POST /mcp，JSON-RPC；APPCODE 头鉴权）
- `node mcp_server.mjs --stdio` → 本地 stdio 模式（Claude Desktop 配置示例见 README）
- 工具定义与市场 API 同文件映射（直接调 `renderStandardReport`/市场路由的内部函数），工具输出：
  `content: [{type:"text",text:摘要}]` + `structuredContent: {code,msg,data}`。

Claude Desktop 配置示例：
```json
{"mcpServers": {"veritas": {"command": "node",
  "args": ["…/services/market-api/mcp_server.mjs", "--stdio"],
  "env": {"AIGC_MARKET_API_UPSTREAM": "http://127.0.0.1:4173"}}}}
```

## 6. 风险与边界

- 大图 base64 经 LLM 上下文转发成本高 → 工具接受图片**文件路径/URL**（stdio 模式）或 URL（HTTP 模式），
  避免 LLM 转录 base64；纯 base64 仍支持但文档提示优先 URL。
- 长任务（2.3 整批核验 1–2 分钟）→ 工具描述写明预计耗时，并提供 `*_task_result` 配套查询工具。
- 未校准分数在工具输出中保留 `semantics` 声明，防止客户端 LLM 把分数转述为"确定概率"。

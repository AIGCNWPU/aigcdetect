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

## 7. 模型口径（2026-11-18 定论，汇报与文档统一使用）

- **整图 AI 检测（2.1/2.3）= 自研 DDA-H+ 骨干**（`weights/dda_hplus`，FP32，官方权重哈希校验）。历史阶段键名 `mirror` 仅为兼容保留，**MIRROR 模型已废弃**，不再出现在任何对外文案。
- **2.1 局部篡改 = TruFor**（通用图像域）；**2.3 局部篡改 = SEED**（DINOv3+LoRA+EoMT，票据文档域）。
- 人像伪造 VLAForge、来源归因 RPA-OpenFake27（闭集参考）。
- **DocShield-9B 仅离线对照评测**（60 张同输入：SEED 召回 100%/误报 43% vs DocShield 召回 43%/误报 7%），不在线上判定。

## 8. 常驻推理（2026-11-18 上线）

- `scripts/image-validation/inference_daemon.py`：DDA-H+ 与 SEED 常驻加载，`127.0.0.1:8617` 提供 `/mirror` `/seed`；
- `local-runtime.js`/`general/service.js` 优先调用常驻服务，不可达回退按任务启动（输出结构一致）；
- 正式服务器：`aigc-inference.service`（user 级 systemd，`Restart=always`，GPU2 常驻 ≈6GB）；
- 推理串行锁（torch 模型非线程安全）；预热脚本 `warm-model-cache.sh`（10 分钟 timer，防网络盘冷读）；
- 实测：2.3 单材料全链路 **22.1s**（spawn 模式 40–90s），mirror/seed 全 completed。

## 9. 实施记录（2026-11-19）：按子模块收敛 + 零泄露

### 9.1 工具面（只做 2.1 / 2.3，按子模块命名）

| 工具 | 子模块 | 说明 |
|---|---|---|
| `image_general_detect` | 2.1 | 整图生成判定 + 局部篡改 + 人像 + 来源候选 |
| `image_general_result` | 2.1 | 异步 taskNo 查询 |
| `image_documents_review` | 2.3 | 单/多材料核验（single / batch + coreMaterialIndex） |
| `image_documents_result` | 2.3 | 异步 taskNo 查询 |
| `image_documents_fields` | 2.3 | 仅 OCR 字段提取 |

去掉了原实现的错配与冗余：`features` / `restrictProbability` / `maxLocations` / `includeOverlay` / `includePreview` / `syncTimeoutSeconds` 不再作为工具参数暴露——这些是内部调参与工作点，交给服务端默认值；同时删除 `video/text` 相关未实现声明。工具总数 5（原 5 个中 3 个重命名、2 个新增）。

### 9.2 零泄露：单出口 + 双层剥离

- **市场层**：新增 `services/market-api/public.py`，`project_public()` 递归剥离内部键；接入 `app.py` 的 `envelope()`——所有对外响应（含 MCP 上游）都过同一出口。剥离键：`engine/model/modelId/modelVersion/engineVersion/batchVersion/weightsSha256/weights/checkpoint/threshold/thresholds/semanticReviewEngine/semanticReviewModel/promptVersion/prompts`；放行 `calibration/semantics/signal/dataSource`；`providerChecks[].provider`（文件内 AI 声明来源）属公开证据，显式保留。剥离记录只写服务端 stderr。
- **MCP 层**：`mcp_server.mjs` 内置同名单（`stripInternal`）对 `structuredContent` 再做一次，任一环节漏剥都能兜住。
- **测试**：`services/market-api/tests/test_public_projection.py`（4 项，Python 层）+ `services/market-api/tests/mcp-leak.test.mjs`（4 项，注入含 engine/model/weights/threshold 的假响应断言零泄露）。

### 9.3 真实端到端（本机 8092 市场层 → 4186 平台）

| 工具 | 样本 | 结果 | 耗时 | 泄露 |
|---|---|---|---|---|
| `image_general_detect` | 印尼打码小票 | 未见明显 AI 生成（24.73/100）；局部篡改 1 处 | 99.8s | 无 |
| `image_documents_review` | E01 数电发票 + 销售合同（batch） | 4 项需关注；矛盾 2 / 通过 6 / 证据不足 3；价税合计不符、票号 7 位 | 173.3s | 无 |

`dataSource:"engine"` 保留（区分真实引擎与 fixture 回放），不属于模型内容。

### 9.4 已知边界

- 只接 2.1/2.3；文本/视频场景未声明工具（未实现或未接入时声明会误导客户端选择）。
- 图像 base64 经客户端上下文成本高：优先 `imageUrl`；纯 base64 仍支持。
- 长任务（2.3 全链 ~3 分钟）建议 `asyncSubmit` + `*_result` 轮询；MCP 调用超时默认 300s，可用 `AIGC_MCP_CALL_TIMEOUT_MS` 调整。
